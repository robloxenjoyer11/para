import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Award, CalendarDays, CalendarPlus, Home as HomeIcon, UserRound } from 'lucide-react';
import { api, getToken, setToken, User } from './api';
import { initTelegram, inTelegram, tg, tick } from './tg';
import { hideSplash } from './splash';
import { Avatar } from './ui';
import { Auth } from './screens/Auth';
import { Home, Tab } from './screens/Home';
import { Schedule } from './screens/Schedule';
import { Grades } from './screens/Grades';
import { Events } from './screens/Events';
import { Profile } from './screens/Profile';
import './style.css';

const NAV: { id: Tab; icon: ReactNode; text: string }[] = [
  { id: 'home', icon: <HomeIcon size={22} />, text: 'Главная' },
  { id: 'schedule', icon: <CalendarDays size={22} />, text: 'Расписание' },
  { id: 'grades', icon: <Award size={22} />, text: 'Оценки' },
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

  // Когда всё готово — плавно убираем заставку из index.html
  useEffect(() => {
    if (!booting) hideSplash();
  }, [booting]);

  const go = (t: Tab) => {
    if (t !== tab) tick();
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  if (booting) return null; // пока идёт запуск, виден экран-заставка

  if (!me) {
    if (inTelegram)
      return (
        <div className="auth">
          <img className="logo-img" src="/logo-white.png" alt="ПАРА" />
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
  const idx = NAV.findIndex((n) => n.id === tab);

  return (
    <div className="app">
      <header>
        <div>
          <img className="hd-logo" src="/logo-blue.png" alt="ПАРА" />
          <span className="hi">Привет 👋</span>
          <h2>{me.name || 'Студент'}</h2>
        </div>
        <button className="hd-av" aria-label="Профиль" onClick={() => go('profile')}>
          <Avatar src={me.avatarUrl} name={me.name} size={46} />
        </button>
      </header>

      {tab === 'home' && <Home me={me} go={go} />}
      {tab === 'schedule' && <Schedule onLinked={refreshMe} />}
      {tab === 'grades' && <Grades onLinked={refreshMe} />}
      {tab === 'people' && (
        <main className="view">
          <section className="panel">
            <h3>Люди</h3>
            <p className="muted">Скоро здесь можно будет найти студентов своего факультета и интересов.</p>
          </section>
        </main>
      )}
      {tab === 'events' && <Events />}
      {tab === 'profile' && <Profile me={me} setMe={setMe} />}

      <nav>
        <i className="nav-ind" style={{ transform: `translateX(${Math.max(idx, 0) * 100}%)`, opacity: idx < 0 ? 0 : 1 }} />
        {NAV.map((n) => (
          <button key={n.id} className={tab === n.id ? 'active' : ''} onClick={() => go(n.id)}>
            {n.icon}
            <span>{n.text}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
