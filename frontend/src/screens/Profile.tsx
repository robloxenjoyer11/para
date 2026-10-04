import { useState } from 'react';
import { api, ApiError, setToken, User } from '../api';
import { inTelegram } from '../tg';
import { ModeusLogin } from './ModeusLogin';

export function Profile({ me, setMe }: { me: User; setMe: (u: User) => void }) {
  const [faculty, setFaculty] = useState(me.faculty ?? '');
  const [course, setCourse] = useState(me.course ? String(me.course) : '');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showModeus, setShowModeus] = useState(false);

  const say = (m: string, isErr = false) => {
    setMsg(isErr ? '' : m);
    setErr(isErr ? m : '');
  };
  const fail = (e: unknown) => say(e instanceof ApiError ? e.message : 'Ошибка', true);
  const refresh = () => api<User>('/me').then(setMe).catch(() => {});

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
    <main>
      <section className="profile">
        {me.avatarUrl ? <img className="big-avatar" src={me.avatarUrl} alt="" /> : <div className="big-avatar">{(me.name || 'П').slice(0, 1)}</div>}
        <h1>{me.name || 'Студент'}</h1>
        <p className="muted">{me.faculty || 'Факультет не указан'} · {me.course ? `${me.course} курс` : 'курс не указан'}</p>
      </section>

      <section className="panel">
        <h3>О себе</h3>
        <input placeholder="Факультет / институт" value={faculty} onChange={(e) => setFaculty(e.target.value)} maxLength={120} />
        <input placeholder="Курс (1–8)" inputMode="numeric" value={course} onChange={(e) => setCourse(e.target.value.replace(/\D/g, '').slice(0, 1))} />
        <button className="btn" onClick={saveProfile}>Сохранить</button>
      </section>

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
