import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { z, ZodError } from 'zod';

import { config } from './config';
import { verifyInitData } from './telegram';
import { sendVerificationEmail, smtpConfigured, verifySmtp } from './mail';
import { startBot, botUsername } from './bot';
import { encrypt, decrypt } from './crypto';
import {
  Grade,
  Lesson,
  ModeusBadCredentials,
  ModeusSession,
  ModeusSessionExpired,
  ModeusUpstreamError,
  ensureFreshSession,
  fetchGrades,
  fetchLessons,
  gradesConfigured,
  nameFromToken,
  modeusLogin,
} from './integrations/modeus';

const db = new PrismaClient();
const app = express();
app.set('trust proxy', 1); // за ngrok / cloudflared / nginx
app.disable('x-powered-by');
app.use(cors({ origin: config.appOrigin, credentials: true }));
app.use(express.json({ limit: '400kb' })); // аватарки приходят сжатыми data-URL (≈20–40 КБ)

// ───────────────────────── утилиты ─────────────────────────

const sign = (id: string) => jwt.sign({ sub: id }, config.jwtSecret, { expiresIn: '30d' });
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const uid = (res: Response): string => res.locals.userId;

function auth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.locals.userId = (jwt.verify(h.slice(7), config.jwtSecret) as { sub: string }).sub;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

/** Простейший in-memory rate limit (достаточно для одного инстанса) */
const hits = new Map<string, { n: number; reset: number }>();
function limit(name: string, max: number, windowMs: number, by: 'ip' | 'user' = 'ip') {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${by === 'user' ? res.locals.userId : req.ip}`;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) return res.status(429).json({ error: 'Слишком много попыток, попробуй позже' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}, 60_000).unref();

const userSelect = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  faculty: true,
  course: true,
  bio: true,
  avatarUrl: true,
  interests: true,
  modeusLinkedAt: true,
} as const;

/** Создаёт токен подтверждения и отправляет письмо */
async function issueVerification(user: { id: string; email: string; name: string | null }) {
  const raw = crypto.randomBytes(32).toString('hex');
  await db.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  await db.emailVerificationToken.create({
    data: { userId: user.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
  });
  await sendVerificationEmail(user.email, user.name, `${config.publicUrl}/api/auth/verify?token=${raw}`);
}

// ───────────────────────── health ─────────────────────────

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    app: 'ПАРА',
    smtp: smtpConfigured ? 'configured' : 'dev-console',
    bot: botUsername || (config.botToken ? 'starting' : 'off'),
    modeus: config.modeus.mock ? 'mock' : 'live',
  });
});

// ───────────────────────── авторизация: Telegram ─────────────────────────

app.post('/api/auth/telegram', limit('tg', 30, 60_000), async (req, res) => {
  const { initData } = z.object({ initData: z.string().min(10) }).parse(req.body);
  const tg = verifyInitData(initData, config.botToken);
  if (!tg) return res.status(401).json({ error: 'Не удалось проверить данные Telegram' });

  const name = [tg.first_name, tg.last_name].filter(Boolean).join(' ') || tg.username || null;
  const existing = await db.user.findUnique({ where: { telegramId: BigInt(tg.id) }, select: { id: true, avatarUrl: true } });
  let user;
  if (existing) {
    // Загруженную пользователем аватарку (data:) не трогаем, фото из Telegram обновляем
    const custom = existing.avatarUrl?.startsWith('data:');
    user = await db.user.update({
      where: { id: existing.id },
      data: !custom && tg.photo_url ? { avatarUrl: tg.photo_url } : {},
      select: userSelect,
    });
  } else {
    user = await db.user.create({ data: { telegramId: BigInt(tg.id), name, avatarUrl: tg.photo_url ?? null }, select: userSelect });
  }
  res.json({ token: sign(user.id), user });
});

// ───────────────────────── авторизация: через ТюмГУ (Modeus) ─────────────────────────
// Успешный вход в Modeus = подтверждение, что человек учится в ТюмГУ. Почта и письма не нужны.

app.post('/api/auth/modeus', limit('modeus-auth', 6, 10 * 60_000), async (req, res) => {
  const p = z.object({ login: z.string().min(1).max(128), password: z.string().min(1).max(256) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Введи логин и пароль' });
  try {
    const { session, personId } = await modeusLogin(p.data.login.trim(), p.data.password);
    const name = await resolveModeusName(session, personId);
    const linked = { modeusPersonId: personId, modeusSession: encrypt(JSON.stringify(session)), modeusLinkedAt: new Date() };
    const existing = await db.user.findFirst({ where: { modeusPersonId: personId } });
    const user = existing
      ? await db.user.update({ where: { id: existing.id }, data: { ...linked, ...(name ? { name } : {}) }, select: userSelect })
      : await db.user.create({ data: { ...linked, name }, select: userSelect });
    scheduleCache.clear();
    res.json({ token: sign(user.id), user });
  } catch (e) {
    if (e instanceof ModeusBadCredentials) return res.status(401).json({ error: e.message, code: 'MODEUS_BAD_CREDENTIALS' });
    console.error('[modeus] auth:', (e as Error).message); // пароль сюда не попадает
    res.status(502).json({ error: 'Не получилось войти в Modeus. Попробуй позже.', code: 'MODEUS_UPSTREAM' });
  }
});

// ───────────────────────── авторизация: email + SMTP ─────────────────────────

app.post('/api/auth/register', limit('register', 10, 60 * 60_000), async (req, res) => {
  const p = z
    .object({ email: z.string().email().toLowerCase(), password: z.string().min(8).max(128), name: z.string().min(1).max(80) })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Некорректные данные' });

  if (!smtpConfigured && config.isProd) return res.status(503).json({ error: 'Почта на сервере не настроена' });

  const exists = await db.user.findUnique({ where: { email: p.data.email } });
  if (exists) return res.status(409).json({ error: 'Email уже зарегистрирован' });

  const user = await db.user.create({
    data: { email: p.data.email, passwordHash: await bcrypt.hash(p.data.password, 12), name: p.data.name },
  });
  try {
    await issueVerification({ id: user.id, email: p.data.email, name: user.name });
  } catch (e) {
    console.error('[mail] register:', (e as Error).message);
    return res.status(502).json({ error: 'Аккаунт создан, но письмо не отправилось. Нажми «Отправить письмо ещё раз».', code: 'MAIL_FAILED' });
  }
  res.json({ message: 'Аккаунт создан. Проверь почту — мы отправили ссылку для подтверждения.' });
});

app.post('/api/auth/resend', limit('resend', 5, 60 * 60_000), async (req, res) => {
  const { email } = z.object({ email: z.string().email().toLowerCase() }).parse(req.body);
  const u = await db.user.findUnique({ where: { email } });
  if (u && !u.emailVerified) {
    try {
      await issueVerification({ id: u.id, email, name: u.name });
    } catch (e) {
      console.error('[mail] resend:', (e as Error).message);
      return res.status(502).json({ error: 'Не удалось отправить письмо' });
    }
  }
  // Одинаковый ответ — чтобы нельзя было перебирать чужие почты
  res.json({ message: 'Если такой аккаунт есть и не подтверждён — письмо отправлено.' });
});

const page = (title: string, text: string, ok: boolean) => {
  const tgLink = botUsername ? `https://t.me/${botUsername}` : '';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ПАРА</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1455D9;font-family:Arial,sans-serif;color:#0B1630}
.c{background:#fff;border-radius:28px;padding:32px;max-width:380px;margin:20px;text-align:center}.l{height:auto;margin-bottom:6px}
h1{font-size:22px}p{color:#4b5568;line-height:1.5}a{display:inline-block;margin-top:12px;background:#1455D9;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:14px}</style></head>
<body><div class="c"><img class="l" src="${config.webappUrl}/logo-blue.png" alt="ПАРА" width="150"><h1>${ok ? '✅' : '⚠️'} ${title}</h1><p>${text}</p>${tgLink ? `<a href="${tgLink}">Открыть в Telegram</a>` : ''}</div></body></html>`;
};

app.get('/api/auth/verify', async (req, res) => {
  const raw = String(req.query.token || '');
  const t = await db.emailVerificationToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!t || t.usedAt || t.expiresAt < new Date()) {
    return res.status(400).type('html').send(page('Ссылка недействительна', 'Она устарела или уже использована. Запроси новое письмо в приложении.', false));
  }
  await db.$transaction([
    db.emailVerificationToken.update({ where: { id: t.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: t.userId }, data: { emailVerified: true } }),
  ]);
  res.type('html').send(page('Почта подтверждена', 'Теперь можно вернуться в приложение.', true));
});

app.post('/api/auth/login', limit('login', 20, 15 * 60_000), async (req, res) => {
  const p = z.object({ email: z.string().email().toLowerCase(), password: z.string() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Некорректные данные' });
  const u = await db.user.findUnique({ where: { email: p.data.email } });
  if (!u?.passwordHash || !(await bcrypt.compare(p.data.password, u.passwordHash)))
    return res.status(401).json({ error: 'Неверный email или пароль' });
  if (!u.emailVerified) return res.status(403).json({ error: 'Подтверди email — письмо уже в почте', code: 'EMAIL_NOT_VERIFIED' });
  res.json({ token: sign(u.id), user: await db.user.findUnique({ where: { id: u.id }, select: userSelect }) });
});

// ───────────────────────── профиль ─────────────────────────

app.get('/api/me', auth, async (_req, res) => {
  const u = await db.user.findUnique({ where: { id: uid(res) }, select: userSelect });
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  res.json(u);
});

app.patch('/api/me', auth, async (req, res) => {
  const data = z
    .object({
      name: z.string().min(1).max(80).optional(),
      faculty: z.string().max(120).optional(),
      course: z.number().int().min(1).max(8).optional(),
      bio: z.string().max(500).optional(),
      avatarUrl: z.string().url().optional(),
      interests: z.array(z.string().max(30)).max(20).optional(),
    })
    .parse(req.body);
  res.json(await db.user.update({ where: { id: uid(res) }, data, select: userSelect }));
});

/** Привязка почты (для Telegram-пользователей): шлём письмо, после клика email считается подтверждённым */
app.post('/api/me/email', auth, limit('me-email', 5, 60 * 60_000, 'user'), async (req, res) => {
  const { email } = z.object({ email: z.string().email().toLowerCase() }).parse(req.body);
  const taken = await db.user.findUnique({ where: { email } });
  if (taken && taken.id !== uid(res)) return res.status(409).json({ error: 'Эта почта уже используется' });
  const u = await db.user.update({ where: { id: uid(res) }, data: { email, emailVerified: false } });
  try {
    await issueVerification({ id: u.id, email, name: u.name });
  } catch (e) {
    console.error('[mail] link:', (e as Error).message);
    return res.status(502).json({ error: 'Не удалось отправить письмо' });
  }
  res.json({ message: `Письмо отправлено на ${email}` });
});

// ───────────────────────── ивенты ─────────────────────────

const CATEGORIES = ['Вечеринка', 'Спорт', 'Игры', 'Учёба', 'Клубы', 'Другое'] as const;

app.get('/api/events', async (_req, res) => {
  res.json(
    await db.event.findMany({
      where: { date: { gte: new Date(Date.now() - 3 * 3600_000) } },
      orderBy: { date: 'asc' },
      take: 50,
      include: { creator: { select: { id: true, name: true } } },
    })
  );
});

app.post('/api/events', auth, limit('events', 20, 60 * 60_000, 'user'), async (req, res) => {
  const p = z
    .object({
      title: z.string().min(1).max(120),
      description: z.string().max(1000).optional(),
      date: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'bad date'),
      place: z.string().max(120).optional(),
      category: z.enum(CATEGORIES).optional(),
    })
    .parse(req.body);
  const ev = await db.event.create({
    data: { ...p, date: new Date(p.date), creatorId: uid(res) },
    include: { creator: { select: { id: true, name: true } } },
  });
  res.json(ev);
});

// ───────────────────────── Modeus: привязка и расписание ─────────────────────────

function loadSession(u: { modeusSession: string | null }): ModeusSession | null {
  if (!u.modeusSession) return null;
  try {
    return JSON.parse(decrypt(u.modeusSession));
  } catch {
    return null;
  }
}

const scheduleCache = new Map<string, { at: number; lessons: Lesson[] }>();
const CACHE_TTL = 2 * 60_000;

/**
 * Имя студента, как оно записано в Modeus («Александр Новгородов»).
 * Сначала из токена; если там нет — из ответа расписания (если Modeus кладёт туда самого студента).
 */
async function resolveModeusName(session: ModeusSession, personId: string): Promise<string | null> {
  const fromToken = nameFromToken(session.token);
  if (fromToken) return fromToken;
  try {
    const { from, to } = defaultRange();
    const r = await fetchLessons(session, personId, from, to);
    return r.selfName;
  } catch {
    return null; // имя — приятный бонус, привязку из-за него не ломаем
  }
}

app.post('/api/modeus/link', auth, limit('modeus-link', 5, 10 * 60_000, 'user'), async (req, res) => {
  const p = z.object({ login: z.string().min(1).max(128), password: z.string().min(1).max(256) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Введи логин и пароль' });
  try {
    const { session, personId } = await modeusLogin(p.data.login.trim(), p.data.password);
    const modeusName = await resolveModeusName(session, personId);
    await db.user.update({
      where: { id: uid(res) },
      data: {
        modeusPersonId: personId,
        modeusSession: encrypt(JSON.stringify(session)),
        modeusLinkedAt: new Date(),
        ...(modeusName ? { name: modeusName } : {}),
      },
    });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof ModeusBadCredentials) return res.status(401).json({ error: e.message, code: 'MODEUS_BAD_CREDENTIALS' });
    console.error('[modeus] link:', (e as Error).message); // пароль сюда не попадает
    res.status(502).json({ error: 'Не получилось войти в Modeus. Попробуй позже.', code: 'MODEUS_UPSTREAM' });
  }
});

app.delete('/api/modeus/link', auth, async (_req, res) => {
  await db.user.update({ where: { id: uid(res) }, data: { modeusPersonId: null, modeusSession: null, modeusLinkedAt: null } });
  scheduleCache.clear();
  res.json({ ok: true });
});

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Понедельник–воскресенье текущей недели в часовом поясе вуза */
function defaultRange() {
  const offsetH = parseInt(config.modeus.utcOffset, 10) || 0;
  const local = new Date(Date.now() + offsetH * 3600_000);
  const dow = (local.getUTCDay() + 6) % 7;
  const mon = new Date(local.getTime() - dow * 86400_000);
  return { from: ymd(mon), to: ymd(new Date(mon.getTime() + 6 * 86400_000)) };
}

app.get('/api/schedule', auth, async (req, res) => {
  const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
  const q = z.object({ from: z.string().regex(ymdRe).optional(), to: z.string().regex(ymdRe).optional() }).safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: 'from/to должны быть в формате YYYY-MM-DD' });
  const def = defaultRange();
  const range = { from: q.data.from ?? def.from, to: q.data.to ?? def.to };
  if (Date.parse(range.to) - Date.parse(range.from) > 62 * 86400_000) return res.status(400).json({ error: 'Слишком большой период' });

  const user = await db.user.findUnique({ where: { id: uid(res) } });
  const session = user && loadSession(user);
  if (!user || !session || !user.modeusPersonId) {
    return res.status(409).json({ error: 'Modeus не подключён', code: 'MODEUS_NOT_LINKED' });
  }

  const key = `${user.id}:${range.from}:${range.to}`;
  const cached = scheduleCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return res.json({ ...range, lessons: cached.lessons });

  try {
    const fresh = await ensureFreshSession(session);
    if (fresh.token !== session.token) {
      await db.user.update({ where: { id: user.id }, data: { modeusSession: encrypt(JSON.stringify(fresh)) } });
    }
    const { lessons, selfName } = await fetchLessons(fresh, user.modeusPersonId, range.from, range.to);
    scheduleCache.set(key, { at: Date.now(), lessons });
    if (selfName && selfName !== user.name) await db.user.update({ where: { id: user.id }, data: { name: selfName } }).catch(() => {});
    res.json({ ...range, lessons });
  } catch (e) {
    if (e instanceof ModeusSessionExpired) {
      return res.status(409).json({ error: e.message, code: 'MODEUS_RELOGIN' });
    }
    console.error('[modeus] schedule:', (e as Error).message);
    // Modeus лёг — отдаём последнее удачное, если есть
    if (cached) return res.json({ ...range, lessons: cached.lessons, stale: true });
    res.status(502).json({
      error: e instanceof ModeusUpstreamError ? 'Modeus сейчас недоступен или изменился формат ответа' : 'Не удалось получить расписание',
      code: 'MODEUS_UPSTREAM',
    });
  }
});

// ───────────────────────── аватарка ─────────────────────────

const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

app.put('/api/me/avatar', auth, limit('avatar', 12, 10 * 60_000, 'user'), async (req, res) => {
  const { dataUrl } = z.object({ dataUrl: z.string().max(220_000) }).parse(req.body);
  if (!AVATAR_RE.test(dataUrl)) return res.status(400).json({ error: 'Нужна картинка JPG, PNG или WebP' });
  res.json(await db.user.update({ where: { id: uid(res) }, data: { avatarUrl: dataUrl }, select: userSelect }));
});

app.delete('/api/me/avatar', auth, async (_req, res) => {
  res.json(await db.user.update({ where: { id: uid(res) }, data: { avatarUrl: null }, select: userSelect }));
});

// ───────────────────────── оценки ─────────────────────────

const gradesCache = new Map<string, { at: number; grades: Grade[] }>();

app.get('/api/grades', auth, async (_req, res) => {
  if (!gradesConfigured()) {
    return res.status(501).json({ error: 'Оценки пока не подключены', code: 'GRADES_NOT_CONFIGURED' });
  }
  const user = await db.user.findUnique({ where: { id: uid(res) } });
  const session = user && loadSession(user);
  if (!user || !session || !user.modeusPersonId) {
    return res.status(409).json({ error: 'Modeus не подключён', code: 'MODEUS_NOT_LINKED' });
  }
  const cached = gradesCache.get(user.id);
  if (cached && Date.now() - cached.at < 5 * 60_000) return res.json({ grades: cached.grades });
  try {
    const fresh = await ensureFreshSession(session);
    if (fresh.token !== session.token) {
      await db.user.update({ where: { id: user.id }, data: { modeusSession: encrypt(JSON.stringify(fresh)) } });
    }
    const grades = await fetchGrades(fresh, user.modeusPersonId);
    gradesCache.set(user.id, { at: Date.now(), grades });
    res.json({ grades });
  } catch (e) {
    if (e instanceof ModeusSessionExpired) return res.status(409).json({ error: e.message, code: 'MODEUS_RELOGIN' });
    console.error('[modeus] grades:', (e as Error).message);
    if (cached) return res.json({ grades: cached.grades, stale: true });
    res.status(502).json({ error: 'Не удалось получить оценки', code: 'MODEUS_UPSTREAM' });
  }
});

// ───────────────────────── фронтенд (прод) ─────────────────────────

const dist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// ───────────────────────── ошибки ─────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Некорректные данные' });
  console.error('[error]', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(config.port, async () => {
  console.log(`ПАРА API: http://localhost:${config.port}`);
  if (smtpConfigured) {
    const r = await verifySmtp();
    console.log(r.ok ? '[smtp] соединение OK' : `[smtp] ОШИБКА: ${r.error}`);
  } else {
    console.log('[smtp] SMTP_HOST не задан — письма печатаются в консоль (только для разработки)');
  }
  if (config.modeus.mock) console.log('[modeus] MODEUS_MOCK=1 — отдаётся тестовое расписание');
  startBot();
});
