import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, BookOpenCheck, RefreshCw } from 'lucide-react';
import { api, ApiError, Grade } from '../api';
import { CountUp, SkeletonList } from '../ui';
import { ModeusLogin } from './ModeusLogin';

type State = 'loading' | 'ok' | 'notlinked' | 'relogin' | 'soon' | 'error';

/** Цвет «пилюли» оценки */
function tone(g: Grade): string {
  const v = g.value.toLowerCase();
  if (/^(не\s?зачт|неуд|не\s?явил|2$)/.test(v)) return 'bad';
  if (/(зачт|отл|^5$|^100$)/.test(v)) return 'great';
  if (/(хор|^4$)/.test(v)) return 'good';
  if (/(удовл|^3$)/.test(v)) return 'mid';
  if (g.numeric !== null && g.max) {
    const r = g.numeric / g.max;
    return r >= 0.85 ? 'great' : r >= 0.65 ? 'good' : r >= 0.5 ? 'mid' : 'bad';
  }
  return 'good';
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export function Grades({ onLinked }: { onLinked: () => void }) {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [state, setState] = useState<State>('loading');
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api<{ grades: Grade[]; stale?: boolean }>('/grades');
      setGrades(r.grades);
      setStale(Boolean(r.stale));
      setState('ok');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === 'MODEUS_NOT_LINKED') setState('notlinked');
      else if (code === 'MODEUS_RELOGIN') setState('relogin');
      else if (code === 'GRADES_NOT_CONFIGURED') setState('soon');
      else {
        setError(e instanceof Error ? e.message : 'Ошибка');
        setState('error');
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Средний балл по пятибалльным оценкам
  const avg = useMemo(() => {
    const five = grades.filter((g) => g.numeric !== null && g.numeric >= 2 && g.numeric <= 5 && !g.max).map((g) => g.numeric as number);
    return five.length ? five.reduce((a, b) => a + b, 0) / five.length : null;
  }, [grades]);

  // Группируем по семестрам (новые сверху), внутри — по дате
  const groups = useMemo(() => {
    const m = new Map<string, Grade[]>();
    for (const g of grades) m.set(g.semester || 'Без семестра', [...(m.get(g.semester || 'Без семестра') ?? []), g]);
    return [...m.entries()]
      .map(([sem, list]) => ({ sem, list: list.sort((a, b) => Date.parse(b.date ?? '0') - Date.parse(a.date ?? '0')) }))
      .sort((a, b) => Date.parse(b.list[0]?.date ?? '0') - Date.parse(a.list[0]?.date ?? '0'));
  }, [grades]);

  if (state === 'notlinked' || state === 'relogin')
    return (
      <main className="view">
        <ModeusLogin relogin={state === 'relogin'} onLinked={() => { onLinked(); load(); }} />
      </main>
    );

  return (
    <main className="view">
      <div className="row">
        <h2 style={{ margin: 0 }}>Оценки</h2>
        {state !== 'loading' && (
          <button className="icon-btn" aria-label="Обновить" onClick={load}>
            <RefreshCw size={18} />
          </button>
        )}
      </div>

      {state === 'loading' && (
        <div style={{ marginTop: 14 }}>
          <div className="skel" style={{ height: 112, borderRadius: 26, marginBottom: 14 }} />
          <SkeletonList n={4} h={72} />
        </div>
      )}

      {state === 'soon' && (
        <section className="panel pop">
          <div className="empty-ico"><Award size={30} /></div>
          <h3 style={{ marginTop: 14 }}>Оценки скоро появятся</h3>
          <p className="muted">Мы подключаем раздел успеваемости из Modeus. Как только он заработает, здесь появятся все твои оценки и средний балл.</p>
        </section>
      )}

      {state === 'error' && (
        <div className="panel pop">
          <p className="msg err">{error}</p>
          <button className="btn" onClick={load}>Повторить</button>
        </div>
      )}

      {state === 'ok' && grades.length === 0 && (
        <section className="panel pop">
          <div className="empty-ico"><BookOpenCheck size={30} /></div>
          <h3 style={{ marginTop: 14 }}>Оценок пока нет</h3>
          <p className="muted">Когда преподаватели выставят оценки в Modeus, они появятся здесь.</p>
        </section>
      )}

      {state === 'ok' && grades.length > 0 && (
        <>
          {stale && <p className="msg">Modeus сейчас недоступен — показаны сохранённые данные.</p>}
          <section className="gpa pop">
            <div>
              <span>{avg !== null ? 'СРЕДНИЙ БАЛЛ' : 'ВСЕГО ОЦЕНОК'}</span>
              <b>{avg !== null ? <CountUp to={avg} decimals={2} /> : <CountUp to={grades.length} />}</b>
            </div>
            <div className="gpa-side">
              <b><CountUp to={grades.length} /></b>
              <span>{avg !== null ? 'оценок' : 'записей'}</span>
            </div>
          </section>

          {groups.map(({ sem, list }) => (
            <div key={sem}>
              <h3 className="dayhead">{sem}</h3>
              <div className="stagger">
                {list.map((g) => (
                  <div className="grade" key={g.id}>
                    <div className="gl">
                      <div className="gtitle">{g.subject}</div>
                      <div className="lmeta">
                        <span className="badge">{g.kindLabel}</span>
                        {g.date && <span>{fmtDate(g.date)}</span>}
                        {g.teacher && <span>{g.teacher}</span>}
                      </div>
                    </div>
                    <div className={`gval ${tone(g)}`}>{g.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
