import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, CalendarPlus, Home as HomeIcon, UserRound, Users } from 'lucide-react';
import { api, getToken, setToken, User } from './api';
import { initTelegram, inTelegram, tg } from './tg';
import { Auth } from './screens/Auth';
import { Home, Tab } from './screens/Home';
import { Schedule } from './screens/Schedule';
import { Events } from './screens/Events';
import { Profile } from './screens/Profile';
import './style.css';

const NAV: { id: Tab; icon: ReactNode; text: string }[] = [
  { id: 'home', icon: <HomeIcon size={22} />, text: 'Главная' },
  { id: 'schedule', icon: <CalendarDays size={22} />, text: 'Расписание' },
  { id: 'people', icon: <Users size={22} />, text: 'Люди' },
  { id: 'events', icon: <CalendarPlus size={22} />, text: 'Ивенты' },
  { id: 'profile', icon: <UserRound size={22} />, text: 'Профиль' },
];

function App() {
  const [me, setMe] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootErr, setBootErr] = useState('');
  const [tab, setTab] = useState<Tab>('home');

  async function boot() {
    setBooting(true);
    setBootErr('');
    try {
      if (inTelegram) {
        // Внутри Telegram: логинимся подписанными данными initData (пароль не нужен)
        const r = await api<{ token: string; user: User }>('/auth/telegram', { method: 'POST', body: { initData: tg!.initData } });
        setToken(r.token);
        setMe(r.user);
      } else if (getToken()) {
        setMe(await api<User>('/me'));
      }
    } catch (e) {
      if (inTelegram) setBootErr((e as Error).message);
      else setToken(null);
    }
    setBooting(false);
  }

  useEffect(() => {
    initTelegram();
    boot();
  }, []);

  if (booting)
    return (
      <div className="auth">
        <div className="logo">ПАРА</div>
      </div>
    );

  if (!me) {
    if (inTelegram)
      return (
        <div className="auth">
          <div className="auth-card">
            <h1>Не удалось войти</h1>
            <p className="msg err">{bootErr}</p>
            <button onClick={boot}>Повторить</button>
          </div>
        </div>
      );
    return <Auth onAuth={setMe} />;
  }

  const refreshMe = () => api<User>('/me').then(setMe).catch(() => {});

  return (
    <div className="app">
      <header>
        <div>
          <span className="mini">ПАРА</span>
          <h2>Привет, {me.name?.split(' ')[0] || 'студент'} 👋</h2>
        </div>
        {me.avatarUrl ? <img className="avatar" src={me.avatarUrl} alt="" /> : <div className="avatar">{(me.name || 'П').slice(0, 1)}</div>}
      </header>

      {tab === 'home' && <Home me={me} go={setTab} />}
      {tab === 'schedule' && <Schedule onLinked={refreshMe} />}
      {tab === 'people' && (
        <main>
          <section className="panel">
            <h3>Люди</h3>
            <p className="muted">Скоро здесь можно будет найти студентов своего факультета и интересов.</p>
          </section>
        </main>
      )}
      {tab === 'events' && <Events />}
      {tab === 'profile' && <Profile me={me} setMe={setMe} />}

      <nav>
        {NAV.map((n) => (
          <button key={n.id} className={tab === n.id ? 'active' : ''} onClick={() => setTab(n.id)}>
            {n.icon}
            <span>{n.text}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
