/**
 * Интеграция с Modeus ТюмГУ (https://utmn.modeus.org).
 *
 * Официального публичного API нет. Мы повторяем то, что делает сам сайт:
 *   1. OIDC implicit flow:  <authUrl>?response_type=id_token&client_id=...&redirect_uri=https://utmn.modeus.org/
 *   2. Modeus уводит на SSO вуза (форма логина) — отправляем логин/пароль студента.
 *   3. SSO возвращает цепочку редиректов/SAML-форм, в конце в URL-фрагменте приходит id_token (JWT).
 *   4. С этим токеном делаем POST /schedule-calendar-v2/api/calendar/events/search.
 *
 * Пароль используется один раз и нигде не сохраняется и не логируется.
 * Сохраняется только токен и cookie сессии SSO — в зашифрованном виде (см. crypto.ts).
 */
import crypto from 'crypto';
import { config } from '../config';

const M = config.modeus;
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

// ───────────────────────── Ошибки ─────────────────────────

export class ModeusBadCredentials extends Error {
  constructor(msg = 'Неверный логин или пароль') {
    super(msg);
  }
}
/** Токен истёк и тихо обновить его не удалось — нужен повторный вход */
export class ModeusSessionExpired extends Error {
  constructor() {
    super('Сессия Modeus истекла, войди заново');
  }
}
export class ModeusUpstreamError extends Error {}

// ───────────────────────── Типы ─────────────────────────

export type Cookie = { name: string; value: string; domain: string; exp?: number };
export type ModeusSession = { token: string; cookies: Cookie[]; authUrl: string; clientId: string };

export type Lesson = {
  id: string;
  title: string;
  shortTitle: string | null;
  kind: 'lecture' | 'seminar' | 'lab' | 'consult' | 'exam' | 'test' | 'other';
  kindLabel: string;
  start: string; // ISO c offset
  end: string;
  room: string | null;
  building: string | null;
  online: string | null;
  teachers: string[];
  status: string | null;
  cancelled: boolean;
};

export type Grade = {
  id: string;
  subject: string;
  kind: 'exam' | 'credit' | 'coursework' | 'test' | 'other';
  kindLabel: string;
  value: string; // «5», «Зачтено», «87» — как отдал Modeus
  numeric: number | null;
  max: number | null;
  date: string | null;
  semester: string | null;
  teacher: string | null;
};

/** «Новгородов Александр Сергеевич» → «Александр Новгородов» (в Modeus ФИО идёт в порядке Ф-И-О) */
export function prettyName(full: string, first?: string, last?: string): string | null {
  const f = (first ?? '').trim(), l = (last ?? '').trim();
  if (f && l) return `${f} ${l}`;
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[1]} ${parts[0]}`;
  return parts[0] ?? null;
}

// ───────────────────────── HTTP с cookie ─────────────────────────

const log = (...a: unknown[]) => M.debug && console.log('[modeus]', ...a);
/** В логи — только хост и путь, без query/fragment (там токены и state) */
const safeUrl = (u: string) => {
  try {
    const x = new URL(u);
    return x.origin + x.pathname;
  } catch {
    return '?';
  }
};

class Http {
  jar: Cookie[];
  constructor(initial: Cookie[] = []) {
    this.jar = initial.map((c) => ({ ...c }));
  }

  private cookieHeader(url: URL) {
    const now = Date.now();
    return this.jar
      .filter((c) => (!c.exp || c.exp > now) && (url.hostname === c.domain || url.hostname.endsWith('.' + c.domain)))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  private store(url: URL, res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const c: Cookie = { name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: url.hostname };
      for (const a of attrs) {
        const [k, v = ''] = a.split('=');
        const key = k.toLowerCase();
        if (key === 'domain' && v) {
          const d = v.replace(/^\./, '').toLowerCase();
          if (url.hostname === d || url.hostname.endsWith('.' + d)) c.domain = d; // чужой домен не принимаем
        } else if (key === 'max-age') c.exp = Date.now() + Number(v) * 1000;
        else if (key === 'expires' && c.exp === undefined) {
          const t = Date.parse(v);
          if (!Number.isNaN(t)) c.exp = t;
        }
      }
      this.jar = this.jar.filter((x) => !(x.name === c.name && x.domain === c.domain));
      if (!c.exp || c.exp > Date.now()) this.jar.push(c);
    }
  }

  async send(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
    const u = new URL(url);
    const cookie = this.cookieHeader(u);
    const res = await fetch(u, {
      method: init.method ?? 'GET',
      body: init.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'ru-RU,ru;q=0.9',
        ...(cookie ? { cookie } : {}),
        ...init.headers,
      },
    });
    this.store(u, res);
    return res;
  }
}

// ───────────────────────── Разбор HTML-форм ─────────────────────────

type Form = { action: string; method: string; inputs: { name: string; type: string; value: string }[] };

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const v = m ? (m[1] ?? m[2] ?? m[3] ?? '') : undefined;
  return v === undefined ? undefined : decodeEntities(v);
};

export function parseForms(html: string, baseUrl: string): Form[] {
  const forms: Form[] = [];
  for (const fm of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const action = attr(fm[1], 'action');
    const inputs: Form['inputs'] = [];
    for (const im of fm[2].matchAll(/<input\b[^>]*>/gi)) {
      const name = attr(im[0], 'name');
      if (!name) continue;
      inputs.push({ name, type: (attr(im[0], 'type') || 'text').toLowerCase(), value: attr(im[0], 'value') ?? '' });
    }
    forms.push({
      action: new URL(action || baseUrl, baseUrl).toString(),
      method: (attr(fm[1], 'method') || 'GET').toUpperCase(),
      inputs,
    });
  }
  return forms;
}

/** Текст ошибки входа со страницы IdP (ADFS: #errorText, Keycloak: .kc-feedback-text, и т.п.) */
function extractLoginError(html: string): string | null {
  const m =
    /id=["']errorText["'][^>]*>([\s\S]*?)<\//i.exec(html) ||
    /class=["'][^"']*(?:kc-feedback-text|alert-error|pf-m-danger|error-message)[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(html) ||
    /id=["']input-error["'][^>]*>([\s\S]*?)<\//i.exec(html);
  const text = m ? decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
  return text || null;
}

// ───────────────────────── OIDC flow ─────────────────────────

const tokenRe = /[#&?]id_token=([A-Za-z0-9\-_.]+)/;
const extractToken = (u: string) => tokenRe.exec(u)?.[1] ?? null;
const hasAuthError = (u: string) => /[#&?]error=/.test(u);

async function getAuthConfig(http: Http): Promise<{ authUrl: string; clientId: string }> {
  if (M.authUrl && M.clientId) return { authUrl: M.authUrl, clientId: M.clientId };
  for (const p of ['/schedule-calendar-v2/assets/app.config.json', '/schedule-calendar/assets/app.config.json']) {
    try {
      const res = await http.send(M.baseUrl + p, { headers: { accept: 'application/json' } });
      if (!res.ok) continue;
      const j: any = await res.json();
      const a = j?.legacy?.appConfig?.httpAuth ?? j?.appConfig?.httpAuth ?? j?.httpAuth;
      if (a?.authUrl && a?.clientId) return { authUrl: a.authUrl, clientId: a.clientId };
    } catch (e) {
      log('app.config', p, 'failed', (e as Error).message);
    }
  }
  throw new ModeusUpstreamError(
    'Не удалось получить настройки авторизации Modeus. Задай MODEUS_AUTH_URL и MODEUS_CLIENT_ID вручную (смотри Network в DevTools на utmn.modeus.org).'
  );
}

function authStartUrl(authUrl: string, clientId: string, silentToken?: string) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: M.baseUrl + '/',
    response_type: 'id_token',
    scope: 'openid',
    nonce: crypto.randomBytes(16).toString('hex'),
    state: crypto.randomBytes(16).toString('hex'),
  });
  if (silentToken) {
    q.set('prompt', 'none');
    q.set('id_token_hint', silentToken);
  }
  return authUrl + (authUrl.includes('?') ? '&' : '?') + q.toString();
}

/**
 * Идём по цепочке редиректов и форм до id_token.
 * Если creds не переданы — работаем «тихо» (ошибка, если IdP просит логин).
 */
async function runFlow(http: Http, startUrl: string, creds?: { login: string; password: string }): Promise<string> {
  let url = startUrl;
  let method = 'GET';
  let body: string | undefined;
  let submittedPassword = false;

  for (let hop = 0; hop < 25; hop++) {
    const res = await http.send(url, {
      method,
      body,
      headers: body ? { 'content-type': 'application/x-www-form-urlencoded', referer: url } : {},
    });
    log(hop, res.status, method, safeUrl(url));

    // ── редирект
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new ModeusUpstreamError('Редирект без Location');
      const next = new URL(loc, url).toString();
      const token = extractToken(next);
      if (token) return token;
      if (hasAuthError(next)) throw creds ? new ModeusUpstreamError('Modeus отклонил авторизацию') : new ModeusSessionExpired();
      url = next;
      method = 'GET';
      body = undefined;
      continue;
    }

    if (!res.ok) throw new ModeusUpstreamError(`SSO ответил HTTP ${res.status}`);
    const html = await res.text();

    // ── страница с формой
    const forms = parseForms(html, url);
    const pwForm = forms.find((f) => f.inputs.some((i) => i.type === 'password'));
    const loginOnlyForm = forms.find(
      (f) => !f.inputs.some((i) => i.type === 'password') && f.inputs.some((i) => ['text', 'email'].includes(i.type))
    );

    if (pwForm || loginOnlyForm) {
      if (!creds) throw new ModeusSessionExpired();
      if (submittedPassword) throw new ModeusBadCredentials(extractLoginError(html) || undefined);
      const form = (pwForm ?? loginOnlyForm)!;
      const data = new URLSearchParams();
      for (const i of form.inputs) {
        if (i.type === 'submit' || i.type === 'button' || i.type === 'image') continue;
        if ((i.type === 'checkbox' || i.type === 'radio') && !i.value) continue;
        let v = i.value;
        if (i.type === 'password') v = creds.password;
        else if (['text', 'email'].includes(i.type) && /user|login|email|name/i.test(i.name)) v = creds.login;
        else if (i.name === 'AuthMethod' && !v) v = 'FormsAuthentication';
        data.set(i.name, v);
      }
      // если не нашли подходящее поле логина по имени — подставим в первое текстовое
      if (![...data.values()].includes(creds.login)) {
        const first = form.inputs.find((i) => ['text', 'email'].includes(i.type));
        if (first) data.set(first.name, creds.login);
      }
      if (pwForm) submittedPassword = true;
      url = form.action;
      method = form.method === 'GET' ? 'GET' : 'POST';
      if (method === 'GET') {
        url += (url.includes('?') ? '&' : '?') + data.toString();
        body = undefined;
      } else body = data.toString();
      continue;
    }

    // ── авто-submit форма (SAMLRequest/SAMLResponse, wresult, id_token и т.п.)
    const auto = forms.find((f) => f.inputs.length > 0 && f.inputs.every((i) => i.type === 'hidden' || i.type === 'submit'));
    if (auto) {
      const data = new URLSearchParams();
      for (const i of auto.inputs) if (i.type === 'hidden') data.set(i.name, i.value);
      url = auto.action;
      method = 'POST';
      body = data.toString();
      continue;
    }

    // ── <meta http-equiv="refresh"> / JS location
    const meta = /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i.exec(html);
    if (meta) {
      url = new URL(decodeEntities(meta[1]), url).toString();
      method = 'GET';
      body = undefined;
      continue;
    }

    throw new ModeusUpstreamError('SSO вернул неожиданную страницу — формат входа мог измениться');
  }
  throw new ModeusUpstreamError('Слишком длинная цепочка редиректов при входе');
}

function decodeJwt(token: string): Record<string, any> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    throw new ModeusUpstreamError('Modeus вернул некорректный токен');
  }
}

/** Имя студента из claims токена (если Modeus их туда кладёт). В debug пишем только НАЗВАНИЯ полей. */
export function nameFromToken(token: string): string | null {
  try {
    const c = decodeJwt(token);
    log('claims в токене:', Object.keys(c).join(', '));
    const full = String(c.name ?? c.fullName ?? c.full_name ?? c.displayName ?? '').trim();
    const first = String(c.given_name ?? c.firstName ?? '').trim();
    const last = String(c.family_name ?? c.lastName ?? '').trim();
    return full || (first && last) ? prettyName(full, first, last) : null;
  } catch {
    return null;
  }
}

export const tokenInfo = (token: string) => {
  const p = decodeJwt(token);
  return { personId: String(p.person_id ?? ''), exp: Number(p.exp ?? 0) * 1000 };
};

// ───────────────────────── Публичный API модуля ─────────────────────────

function sessionCookies(http: Http, authUrl: string): Cookie[] {
  const hosts = [new URL(authUrl).hostname, new URL(M.baseUrl).hostname];
  const now = Date.now();
  return http.jar.filter((c) => (!c.exp || c.exp > now) && hosts.some((h) => h === c.domain || h.endsWith('.' + c.domain)));
}

export async function modeusLogin(login: string, password: string): Promise<{ session: ModeusSession; personId: string }> {
  if (M.mock) {
    const session: ModeusSession = { token: 'mock', cookies: [], authUrl: '', clientId: '' };
    return { session, personId: 'mock-person' };
  }
  const http = new Http();
  const { authUrl, clientId } = await getAuthConfig(http);
  const token = await runFlow(http, authStartUrl(authUrl, clientId), { login, password });
  const { personId } = tokenInfo(token);
  if (!personId) throw new ModeusUpstreamError('В токене Modeus нет person_id');
  // Сохраняем только cookie домена авторизации Modeus — их достаточно для тихого обновления токена
  return { session: { token, cookies: sessionCookies(http, authUrl), authUrl, clientId }, personId };
}

/** Возвращает сессию с живым токеном (обновляет тихо, если надо) */
export async function ensureFreshSession(s: ModeusSession): Promise<ModeusSession> {
  if (M.mock) return s;
  const { exp } = tokenInfo(s.token);
  if (exp - Date.now() > 60_000) return s;
  const http = new Http(s.cookies);
  try {
    const token = await runFlow(http, authStartUrl(s.authUrl, s.clientId, s.token));
    return { ...s, token, cookies: sessionCookies(http, s.authUrl) };
  } catch (e) {
    log('silent refresh failed:', (e as Error).message);
    throw new ModeusSessionExpired();
  }
}

// ───────────────────────── Расписание ─────────────────────────

const KIND: [RegExp, Lesson['kind'], string][] = [
  [/^LECT/i, 'lecture', 'Лекция'],
  [/^SEMI|PRACT/i, 'seminar', 'Семинар'],
  [/^LAB/i, 'lab', 'Лабораторная'],
  [/^CONS/i, 'consult', 'Консультация'],
  [/FINAL|EXAM/i, 'exam', 'Экзамен'],
  [/MID_CHECK|CUR_CHECK|TEST|CHECK/i, 'test', 'Контроль'],
];

const idFromHref = (l: any): string | undefined => {
  const h: string | undefined = l?.href;
  return h ? h.split('?')[0].split('/').filter(Boolean).pop() : undefined;
};
const index = (arr: any[] | undefined) => new Map<string, any>((arr ?? []).filter((x) => x?.id).map((x) => [x.id, x]));
const withOffset = (s: string) => (/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : s + M.utcOffset);

/** Свой профиль в ответе расписания (если Modeus кладёт студента в persons) */
export function selfNameFrom(data: any, personId: string): string | null {
  const p = (data?._embedded?.persons ?? []).find((x: any) => x?.id === personId);
  return p ? prettyName(String(p.fullName ?? ''), p.firstName, p.lastName) : null;
}

export function normalizeLessons(data: any): Lesson[] {
  const e = data?._embedded ?? {};
  const cru = index(e['course-unit-realizations']);
  const rooms = index(e['rooms']);
  const persons = index(e['persons']);

  const roomsByEvent = new Map<string, string[]>();
  for (const er of e['event-rooms'] ?? []) {
    const ev = er.eventId ?? idFromHref(er._links?.event);
    const rm = er.roomId ?? idFromHref(er._links?.room);
    if (ev && rm) roomsByEvent.set(ev, [...(roomsByEvent.get(ev) ?? []), rm]);
  }
  const teachersByEvent = new Map<string, string[]>();
  for (const o of e['event-organizers'] ?? []) {
    const ev = o.eventId ?? idFromHref(o._links?.event);
    const p = o.personId ?? idFromHref(o._links?.person);
    if (ev && p) teachersByEvent.set(ev, [...(teachersByEvent.get(ev) ?? []), p]);
  }
  const locByEvent = new Map<string, string>();
  for (const l of e['event-locations'] ?? []) {
    const ev = l.eventId ?? idFromHref(l._links?.event);
    if (ev && l.customLocation) locByEvent.set(ev, String(l.customLocation));
  }

  const out: Lesson[] = [];
  for (const ev of e['events'] ?? []) {
    if (!ev?.id || !(ev.start || ev.startsAtLocal) || !(ev.end || ev.endsAtLocal)) continue;
    const c = cru.get(idFromHref(ev._links?.['course-unit-realization']) ?? '');
    const typeId = String(ev.typeId ?? '');
    const [, kind, kindLabel] = KIND.find(([re]) => re.test(typeId)) ?? [null, 'other' as const, 'Занятие'];

    const roomList = (roomsByEvent.get(ev.id) ?? []).map((id) => rooms.get(id)).filter(Boolean);
    const room = roomList[0];
    const custom = locByEvent.get(ev.id) ?? null;
    const isUrl = custom && /^https?:\/\//i.test(custom);
    const status: string | null = ev.holdingStatus?.name ?? null;

    out.push({
      id: ev.id,
      title: c?.name || ev.name || 'Без названия',
      shortTitle: c?.nameShort || ev.nameShort || null,
      kind,
      kindLabel,
      start: withOffset(ev.start ?? ev.startsAtLocal),
      end: withOffset(ev.end ?? ev.endsAtLocal),
      room: room?.nameShort || room?.name || (!isUrl ? custom : null),
      building: room?.building?.nameShort || room?.building?.name || null,
      online: isUrl ? custom : null,
      teachers: (teachersByEvent.get(ev.id) ?? []).map((id) => persons.get(id)?.fullName).filter(Boolean),
      status,
      cancelled: /отмен|cancel/i.test(status ?? '') || ev.holdingStatus?.id === 'CANCELLED',
    });
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** from/to — даты YYYY-MM-DD (включительно) в часовом поясе вуза */
export async function fetchLessons(
  session: ModeusSession,
  personId: string,
  from: string,
  to: string
): Promise<{ lessons: Lesson[]; selfName: string | null }> {
  if (M.mock) return { lessons: mockLessons(from), selfName: 'Александр Новгородов' };

  const res = await fetch(`${M.baseUrl}${M.searchPath}?tz=${encodeURIComponent(M.tz)}`, {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${session.token}`,
      'user-agent': UA,
    },
    body: JSON.stringify({
      size: 500,
      timeMin: `${from}T00:00:00${M.utcOffset}`,
      timeMax: `${to}T23:59:59${M.utcOffset}`,
      attendeePersonId: [personId],
    }),
  });
  log('search', res.status);
  if (res.status === 401 || res.status === 403) throw new ModeusSessionExpired();
  if (!res.ok) throw new ModeusUpstreamError(`Modeus ответил HTTP ${res.status}`);
  const data = await res.json();
  const selfName = selfNameFrom(data, personId);
  log('persons в ответе:', (data?._embedded?.persons ?? []).length, ', себя нашли:', Boolean(selfName));
  return { lessons: normalizeLessons(data), selfName };
}

function mockLessons(from: string): Lesson[] {
  const day = (offset: number, h: number, m: number, mins = 90) => {
    const d = new Date(`${from}T00:00:00${M.utcOffset}`);
    d.setUTCDate(d.getUTCDate() + offset);
    d.setUTCHours(h - 5, m);
    return [d.toISOString(), new Date(d.getTime() + mins * 60_000).toISOString()] as const;
  };
  const mk = (i: number, off: number, h: number, m: number, title: string, kind: Lesson['kind'], label: string, room: string, t: string): Lesson => {
    const [start, end] = day(off, h, m);
    return { id: `mock-${i}`, title, shortTitle: null, kind, kindLabel: label, start, end, room, building: 'Корпус 1', online: null, teachers: [t], status: null, cancelled: false };
  };
  return [
    mk(1, 0, 8, 30, 'Математический анализ', 'lecture', 'Лекция', 'ауд. 201', 'Иванов И. И.'),
    mk(2, 0, 10, 10, 'Программирование', 'lab', 'Лабораторная', 'ауд. 305', 'Петрова А. С.'),
    mk(3, 1, 12, 0, 'Английский язык', 'seminar', 'Семинар', 'ауд. 112', 'Смирнова Е. В.'),
    mk(4, 2, 8, 30, 'Дискретная математика', 'lecture', 'Лекция', 'ауд. 201', 'Козлов Д. А.'),
    mk(5, 3, 13, 40, 'Базы данных', 'seminar', 'Семинар', 'ауд. 307', 'Орлов П. Н.'),
  ];
}


// ───────────────────────── Оценки ─────────────────────────

const GRADE_KIND: [RegExp, Grade['kind'], string][] = [
  [/экзамен|exam/i, 'exam', 'Экзамен'],
  [/зач[её]т|credit/i, 'credit', 'Зачёт'],
  [/курсов|course.?work/i, 'coursework', 'Курсовая'],
  [/тест|контрол|check|test/i, 'test', 'Контроль'],
];
const SUBJECT_KEYS = ['courseUnitName', 'courseName', 'subjectName', 'disciplineName', 'discipline', 'subject', 'name', 'title'];
const VALUE_KEYS = ['grade', 'mark', 'score', 'result', 'resultName', 'totalScore', 'finalGrade', 'assessment', 'points', 'value'];

const pickStr = (o: any, keys: string[]): string | null => {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
    if (v && typeof v === 'object') {
      const inner = pickStr(v, ['name', 'nameShort', 'title', 'value', 'text']);
      if (inner) return inner;
    }
  }
  return null;
};

/**
 * Эвристический разбор: ищем во всём JSON объекты, где есть и «название предмета», и «оценка».
 * Формат ответа Modeus по оценкам заранее неизвестен — после первой проверки на реальных данных
 * этот разбор нужно уточнить под точную структуру.
 */
export function normalizeGrades(data: any): Grade[] {
  const out: Grade[] = [];
  const seen = new Set<string>();
  const walk = (node: any, depth: number) => {
    if (depth > 8 || node == null) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    if (typeof node !== 'object') return;
    const subject = pickStr(node, SUBJECT_KEYS);
    const value = pickStr(node, VALUE_KEYS);
    if (subject && value && !/^(true|false)$/i.test(value)) {
      const kindText = pickStr(node, ['controlType', 'controlForm', 'type', 'typeName', 'form', 'kind']) ?? '';
      const [, kind, kindLabel] = GRADE_KIND.find(([re]) => re.test(kindText)) ?? [null, 'other' as const, kindText || 'Оценка'];
      const num = Number(value.replace(',', '.'));
      const max = Number(node.maxScore ?? node.max ?? node.maxPoints);
      const date = pickStr(node, ['date', 'gradeDate', 'passDate', 'updatedAt', 'createdAt']);
      const id = String(node.id ?? `${subject}|${kindText}|${value}|${date ?? ''}`);
      if (!seen.has(id)) {
        seen.add(id);
        out.push({
          id,
          subject,
          kind,
          kindLabel,
          value,
          numeric: Number.isFinite(num) ? num : null,
          max: Number.isFinite(max) && max > 0 ? max : null,
          date: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
          semester: pickStr(node, ['semester', 'semesterName', 'term', 'period']),
          teacher: pickStr(node, ['teacher', 'teacherName', 'examiner', 'lecturer']),
        });
      }
      return; // внутрь найденной оценки не спускаемся — иначе вложенный {name, value} превратится в «ещё одну оценку»
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  walk(data, 0);
  return out;
}

export const gradesConfigured = () => M.mock || Boolean(M.gradesPath);

export async function fetchGrades(session: ModeusSession, personId: string): Promise<Grade[]> {
  if (M.mock) return mockGrades();
  if (!M.gradesPath) throw new ModeusUpstreamError('GRADES_NOT_CONFIGURED');
  const hasBody = M.gradesMethod !== 'GET' && M.gradesBody;
  const res = await fetch(M.baseUrl + M.gradesPath.replace('{personId}', encodeURIComponent(personId)), {
    method: M.gradesMethod,
    signal: AbortSignal.timeout(20_000),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${session.token}`,
      'user-agent': UA,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    },
    body: hasBody ? M.gradesBody.replaceAll('{personId}', personId) : undefined,
  });
  log('grades', res.status);
  if (res.status === 401 || res.status === 403) throw new ModeusSessionExpired();
  if (!res.ok) throw new ModeusUpstreamError(`Modeus ответил HTTP ${res.status}`);
  const grades = normalizeGrades(await res.json());
  log('оценок распознано:', grades.length);
  return grades;
}

function mockGrades(): Grade[] {
  const g = (i: number, subject: string, kind: Grade['kind'], kindLabel: string, value: string, sem: string, teacher: string, daysAgo: number): Grade => ({
    id: `mock-g${i}`,
    subject,
    kind,
    kindLabel,
    value,
    numeric: Number.isFinite(Number(value)) ? Number(value) : null,
    max: null,
    date: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
    semester: sem,
    teacher,
  });
  return [
    g(1, 'Математический анализ', 'exam', 'Экзамен', '5', '2 семестр 2025/26', 'Иванов И. И.', 120),
    g(2, 'Программирование', 'exam', 'Экзамен', '4', '2 семестр 2025/26', 'Петрова А. С.', 115),
    g(3, 'Английский язык', 'credit', 'Зачёт', 'Зачтено', '2 семестр 2025/26', 'Смирнова Е. В.', 110),
    g(4, 'Дискретная математика', 'exam', 'Экзамен', '5', '1 семестр 2025/26', 'Козлов Д. А.', 280),
    g(5, 'Базы данных', 'coursework', 'Курсовая', '4', '1 семестр 2025/26', 'Орлов П. Н.', 270),
    g(6, 'История России', 'credit', 'Зачёт', 'Зачтено', '1 семестр 2025/26', 'Белов С. К.', 265),
    g(7, 'Физика', 'exam', 'Экзамен', '3', '1 семестр 2025/26', 'Громов В. Л.', 262),
  ];
}
