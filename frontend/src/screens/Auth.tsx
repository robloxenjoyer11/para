import { useState } from 'react';
import { api, ApiError, setToken, User } from '../api';

/** Вход по email — для запуска вне Telegram (браузер). Внутри Telegram вход автоматический. */
export function Auth({ onAuth }: { onAuth: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [needVerify, setNeedVerify] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setMsg('');
    setErr('');
    setNeedVerify(false);
    setBusy(true);
    try {
      if (mode === 'register') {
        const r = await api<{ message: string }>('/auth/register', { method: 'POST', body: { email, password, name } });
        setMsg(r.message);
        setMode('login');
      } else {
        const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { email, password } });
        setToken(r.token);
        onAuth(r.user);
      }
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.message || 'Ошибка');
      if (ae.code === 'EMAIL_NOT_VERIFIED' || ae.code === 'MAIL_FAILED') setNeedVerify(true);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try {
      const r = await api<{ message: string }>('/auth/resend', { method: 'POST', body: { email } });
      setErr('');
      setMsg(r.message);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="auth">
      <div className="logo">ПАРА</div>
      <div className="auth-card">
        <div className="eyebrow">ТЮМГУ · СТУДЕНЧЕСКОЕ ПРИЛОЖЕНИЕ</div>
        <h1>{mode === 'login' ? 'С возвращением' : 'Создай аккаунт'}</h1>
        {mode === 'register' && <input placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />}
        <input placeholder="Email" type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          placeholder="Пароль (минимум 8 символов)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button disabled={busy} onClick={submit}>{mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
        {msg && <p className="msg">{msg}</p>}
        {err && <p className="msg err">{err}</p>}
        {needVerify && email && <span className="switch" onClick={resend}>Отправить письмо ещё раз</span>}
        <span className="switch" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}
        </span>
      </div>
    </div>
  );
}
