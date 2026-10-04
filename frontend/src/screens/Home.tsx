import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, CalendarDays, CalendarPlus, ChevronRight, Star, Users } from 'lucide-react';
import { api, ApiError, EventItem, Lesson, User } from '../api';
import { addDays, fmtDateTime, fmtTime, todayYmd } from '../dates';

export type Tab = 'home' | 'schedule' | 'people' | 'events' | 'profile';

function Card(p: { icon: ReactNode; title: string; text: string; onClick?: () => void }) {
  return (
    <div className="card" onClick={p.onClick} role="button">
      <div className="ico">{p.icon}</div>
      <b>{p.title}</b>
      <span>{p.text}</span>
    </div>
  );
}

export function Home({ me, go }: { me: User; go: (t: Tab) => void }) {
  const [next, setNext] = useState<Lesson | null | undefined>(undefined); // undefined — грузим
  const [linked, setLinked] = useState(true);
  const [events, setEvents] = useState<EventItem[]>([]);

  useEffect(() => {
    api<EventItem[]>('/events').then((e) => setEvents(e.slice(0, 3))).catch(() => {});
    const t = todayYmd();
    api<{ lessons: Lesson[] }>(`/schedule?from=${t}&to=${addDays(t, 7)}`)
      .then((r) => {
        const now = Date.now();
        setNext(r.lessons.find((l) => !l.cancelled && Date.parse(l.end) > now) ?? null);
      })
      .catch((e) => {
        if (e instanceof ApiError && (e.code === 'MODEUS_NOT_LINKED' || e.code === 'MODEUS_RELOGIN')) setLinked(false);
        setNext(null);
      });
  }, [me.modeusLinkedAt]);

  return (
    <main>
      <section className="next" onClick={() => go('schedule')}>
        <div>
          <span>СЛЕДУЮЩАЯ ПАРА</span>
          {next ? (
            <>
              <h1>{next.title}</h1>
              <p>
                {new Date(next.start).toLocaleDateString('ru-RU', { timeZone: 'Asia/Yekaterinburg', weekday: 'short', day: 'numeric', month: 'short' })},{' '}
                {fmtTime(next.start)}–{fmtTime(next.end)}
                {next.room ? ` · ${next.room}` : ''}
              </p>
            </>
          ) : !linked ? (
            <>
              <h1>Подключи расписание</h1>
              <p>Войди в Modeus ТюмГУ — и пары появятся здесь.</p>
            </>
          ) : next === undefined ? (
            <h1>Загружаем…</h1>
          ) : (
            <>
              <h1>Ближайших пар нет</h1>
              <p>В ближайшие 7 дней занятий не найдено.</p>
            </>
          )}
        </div>
        <CalendarDays size={42} />
      </section>

      <div className="grid">
        <Card icon={<BookOpen />} title="Пары" text="Расписание" onClick={() => go('schedule')} />
        <Card icon={<Star />} title="Оценки" text="Скоро" />
        <Card icon={<Users />} title="Люди" text="Найди своих" onClick={() => go('people')} />
        <Card icon={<CalendarPlus />} title="Ивенты" text="Мероприятия" onClick={() => go('events')} />
      </div>

      <h3>Ближайшие ивенты</h3>
      {events.length === 0 && <p className="muted">Пока ничего нет — создай первый ивент!</p>}
      {events.map((e) => (
        <div className="event" key={e.id} onClick={() => go('events')}>
          <div>
            <b>{e.title}</b>
            <p>{fmtDateTime(e.date)} · {e.place || 'Место не указано'}</p>
          </div>
          <ChevronRight />
        </div>
      ))}
    </main>
  );
}
