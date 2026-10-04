import { useState } from 'react';
import { api, ApiError } from '../api';
import { haptic } from '../tg';

export function ModeusLogin({ onLinked, relogin }: { onLinked: () => void; relogin?: boolean }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!login || !password || busy) return;
    setBusy(true);
    setErr('');
    try {
      await api('/modeus/link', { method: 'POST', body: { login, password } });
      setPassword('');
      haptic('success');
      onLinked();
    } catch (e) {
      haptic('error');
      setErr(e instanceof ApiError ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>{relogin ? 'Войди в Modeus заново' : 'Подключи расписание'}</h3>
      <p className="muted">
        Логин и пароль от единой учётной записи ТюмГУ (как на utmn.modeus.org). Пароль используется один раз для входа и
        не сохраняется.
      </p>
      <input placeholder="Логин ТюмГУ" autoComplete="username" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} />
      <input
        placeholder="Пароль"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button className="btn" disabled={busy || !login || !password} onClick={submit}>
        {busy ? 'Входим… (до 20 секунд)' : 'Подключить Modeus'}
      </button>
      {err && <p className="msg err">{err}</p>}
    </section>
  );
}
