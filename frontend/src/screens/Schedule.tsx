import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, User as UserIcon, Video } from 'lucide-react';
import { api, ApiError, Lesson } from '../api';
import { addDays, fmtDayLong, fmtDayNum, fmtDayShort, fmtTime, fmtWeek, mondayOf, toYmd, todayYmd } from '../dates';
import { ModeusLogin } from './ModeusLogin';

export function LessonCard({ l }: { l: Lesson }) {
  return (
    <div className={`lesson ${l.cancelled ? 'cancelled' : ''}`}>
      <div className="lt">
        <b>{fmtTime(l.start)}</b>
        <span>{fmtTime(l.end)}</span>
      </div>
      <div className={`bar k-${l.kind}`} />
      <div className="lb">
        <div className="ltitle">{l.title}</div>
        <div className="lmeta">
          <span className={`badge k-${l.kind}`}>{l.cancelled ? 'Отменено' : l.kindLabel}</span>
          {l.room && (
            <span>
              <MapPin size={12} /> {l.room}
              {l.building ? `, ${l.building}` : ''}
            </span>
          )}
          {l.online && (
            <a href={l.online} target="_blank" rel="noreferrer">
              <Video size={12} /> Онлайн
            </a>
          )}
        </div>
        {l.teachers.length > 0 && (
          <div className="lmeta">
            <span>
              <UserIcon size={12} /> {l.teachers.join(', ')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function Schedule({ onLinked }: { onLinked: () => void }) {
  const [week, setWeek] = useState(() => mondayOf(todayYmd()));
  const [day, setDay] = useState(todayYmd());
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'notlinked' | 'relogin' | 'error'>('loading');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api<{ lessons: Lesson[]; stale?: boolean }>(`/schedule?from=${week}&to=${addDays(week, 6)}`);
      setLessons(r.lessons);
      setStale(Boolean(r.stale));
      setState('ok');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === 'MODEUS_NOT_LINKED') setState('notlinked');
      else if (code === 'MODEUS_RELOGIN') setState('relogin');
      else {
        setError(e instanceof Error ? e.message : 'Ошибка');
        setState('error');
      }
    }
  }, [week]);

  useEffect(() => {
    load();
  }, [load]);

  // при смене недели выбираем сегодняшний день (если он в неделе) или понедельник
  useEffect(() => {
    const t = todayYmd();
    setDay(t >= week && t <= addDays(week, 6) ? t : week);
  }, [week]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const byDay = useMemo(() => {
    const m = new Map<string, Lesson[]>();
    for (const l of lessons) {
      const k = toYmd(l.start);
      m.set(k, [...(m.get(k) ?? []), l]);
    }
    return m;
  }, [lessons]);

  if (state === 'notlinked' || state === 'relogin')
    return (
      <main>
        <ModeusLogin relogin={state === 'relogin'} onLinked={() => { onLinked(); load(); }} />
      </main>
    );

  const today = todayYmd();
  const list = byDay.get(day) ?? [];

  return (
    <main>
      <div className="weekbar">
        <button aria-label="Предыдущая неделя" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft size={20} /></button>
        <div>
          <b>{fmtWeek(week)}</b>
          {week !== mondayOf(today) && <span className="link" onClick={() => setWeek(mondayOf(today))}> сегодня</span>}
        </div>
        <button aria-label="Следующая неделя" onClick={() => setWeek(addDays(week, 7))}><ChevronRight size={20} /></button>
      </div>

      <div className="days">
        {days.map((d) => (
          <button key={d} className={`${d === day ? 'active' : ''} ${d === today ? 'today' : ''}`} onClick={() => setDay(d)}>
            <span>{fmtDayShort(d)}</span>
            <b>{fmtDayNum(d)}</b>
            {(byDay.get(d)?.length ?? 0) > 0 && <i />}
          </button>
        ))}
      </div>

      <h3 className="dayhead">{fmtDayLong(day)}</h3>
      {stale && <p className="msg">Modeus сейчас недоступен — показаны сохранённые данные.</p>}
      {state === 'loading' && <p className="muted center">Загружаем расписание…</p>}
      {state === 'error' && (
        <div className="panel">
          <p className="msg err">{error}</p>
          <button className="btn" onClick={load}>Повторить</button>
        </div>
      )}
      {state === 'ok' && list.length === 0 && <p className="muted center">В этот день пар нет 🎉</p>}
      {state === 'ok' && list.map((l) => <LessonCard key={l.id} l={l} />)}
    </main>
  );
}
