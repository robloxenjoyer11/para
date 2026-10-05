import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { api, ApiError, setToken, User } from '../api';
import { EMAIL_AUTH, haptic, inTelegram } from '../tg';
import { Avatar } from '../ui';
import { ModeusLogin } from './ModeusLogin';

/** Обрезает до квадрата по центру, сжимает до 256×256 JPEG — так фото весит ~20 КБ */
async function toAvatarDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Не удалось открыть картинку');
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const url = c.toDataURL('image/jpeg', q);
    if (url.length < 150_000) return url;
  }
  throw new Error('Фото слишком большое');
}

export function Profile({ me, setMe }: { me: User; setMe: (u: User) => void }) {
  const [faculty, setFaculty] = useState(me.faculty ?? '');
  const [course, setCourse] = useState(me.course ? String(me.course) : '');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showModeus, setShowModeus] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const say = (m: string, isErr = false) => {
    setMsg(isErr ? '' : m);
    setErr(isErr ? m : '');
  };
  const fail = (e: unknown) => say(e instanceof ApiError ? e.message : 'Ошибка', true);
  const refresh = () => api<User>('/me').then(setMe).catch(() => {});

  async function pickAvatar(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return say('Выбери картинку', true);
    setUploading(true);
    try {
      const dataUrl = await toAvatarDataUrl(file);
      setMe(await api<User>('/me/avatar', { method: 'PUT', body: { dataUrl } }));
      haptic('success');
      say('Фото обновлено');
    } catch (e) {
      haptic('error');
      fail(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  async function removeAvatar() {
    try {
      setMe(await api<User>('/me/avatar', { method: 'DELETE' }));
      say('Фото удалено');
    } catch (e) {
      fail(e);
    }
  }

  async function saveProfile() {
    try {
      const u = await api<User>('/me', { method: 'PATCH', body: { faculty: faculty.trim() || undefined, course: course ? Number(course) : undefined } });
      setMe(u);
      say('Сохранено');
    } catch (e) {
      fail(e);
    }
  }
  async function linkEmail() {
    try {
      const r = await api<{ message: string }>('/me/email', { method: 'POST', body: { email } });
      say(r.message);
      refresh();
    } catch (e) {
      fail(e);
    }
  }
  async function resend() {
    try {
      const r = await api<{ message: string }>('/auth/resend', { method: 'POST', body: { email: me.email } });
      say(r.message);
    } catch (e) {
      fail(e);
    }
  }
  async function unlinkModeus() {
    try {
      await api('/modeus/link', { method: 'DELETE' });
      await refresh();
      say('Modeus отключён');
    } catch (e) {
      fail(e);
    }
  }

  return (
    <main className="view">
      <section className="profile">
        <div className="av-wrap">
          <Avatar src={me.avatarUrl} name={me.name} size={104} className={uploading ? 'busy' : ''} />
          <button className="av-edit" aria-label="Сменить фото" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Camera size={18} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
        </div>
        {me.avatarUrl && (
          <span className="link" onClick={removeAvatar}>
            <Trash2 size={12} style={{ verticalAlign: -1 }} /> Удалить фото
          </span>
        )}
        <h1>{me.name || 'Студент'}</h1>
        <p className="muted">{me.faculty || 'Факультет не указан'} · {me.course ? `${me.course} курс` : 'курс не указан'}</p>
      </section>

      <section className="panel">
        <h3>О себе</h3>
        <input placeholder="Факультет / институт" value={faculty} onChange={(e) => setFaculty(e.target.value)} maxLength={120} />
        <input placeholder="Курс (1–8)" inputMode="numeric" value={course} onChange={(e) => setCourse(e.target.value.replace(/\D/g, '').slice(0, 1))} />
        <button className="btn" onClick={saveProfile}>Сохранить</button>
      </section>

      {EMAIL_AUTH && (
      <section className="panel">
        <h3>Почта</h3>
        {me.email ? (
          <>
            <p>{me.email} — {me.emailVerified ? '✅ подтверждена' : '⏳ ждёт подтверждения'}</p>
            {!me.emailVerified && (
              <button className="btn ghost" onClick={resend}>Отправить письмо ещё раз</button>
            )}
          </>
        ) : (
          <>
            <input placeholder="you@example.com" type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn" disabled={!email.includes('@')} onClick={linkEmail}>Привязать и подтвердить</button>
          </>
        )}
      </section>
      )}

      <section className="panel">
        <h3>Modeus</h3>
        {me.modeusLinkedAt ? (
          <>
            <p>✅ Расписание подключено</p>
            <button className="btn ghost" onClick={unlinkModeus}>Отключить</button>
          </>
        ) : showModeus ? (
          <ModeusLogin onLinked={() => { setShowModeus(false); refresh(); }} />
        ) : (
          <button className="btn" onClick={() => setShowModeus(true)}>Подключить расписание</button>
        )}
      </section>

      {msg && <p className="msg">{msg}</p>}
      {err && <p className="msg err">{err}</p>}

      {!inTelegram && (
        <button className="btn ghost" onClick={() => { setToken(null); location.reload(); }}>Выйти</button>
      )}
    </main>
  );
}
