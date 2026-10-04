import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiError, CATEGORIES, EventItem } from '../api';
import { fmtDateTime } from '../dates';
import { haptic } from '../tg';

export function Events() {
  const [items, setItems] = useState<EventItem[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () =>
    api<EventItem[]>('/events')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  useEffect(() => {
    load();
  }, []);

  const shown = filter ? items.filter((e) => e.category === filter) : items;

  return (
    <main>
      <div className="row">
        <h2 style={{ margin: 0 }}>Ивенты</h2>
        <button className="btn small" onClick={() => setCreating(!creating)}>
          <Plus size={16} /> Создать
        </button>
      </div>

      {creating && <CreateEvent onDone={() => { setCreating(false); load(); }} />}

      <div className="chips">
        <button className={filter === null ? 'active' : ''} onClick={() => setFilter(null)}>Все</button>
        {CATEGORIES.map((c) => (
          <button key={c} className={filter === c ? 'active' : ''} onClick={() => setFilter(filter === c ? null : c)}>{c}</button>
        ))}
      </div>

      {loading && <p className="muted center">Загружаем…</p>}
      {!loading && shown.length === 0 && <p className="muted center">Здесь пока пусто</p>}
      {shown.map((e) => (
        <div className="event col" key={e.id}>
          <div className="row">
            <b>{e.title}</b>
            {e.category && <span className="badge">{e.category}</span>}
          </div>
          <p>{fmtDateTime(e.date)} · {e.place || 'Место не указано'}</p>
          {e.description && <p className="desc">{e.description}</p>}
          <p className="muted">Организатор: {e.creator.name || 'студент'}</p>
        </div>
      ))}
    </main>
  );
}

function CreateEvent({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [place, setPlace] = useState('');
  const [category, setCategory] = useState<string>('Другое');
  const [description, setDescription] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim() || !date) return setErr('Укажи название и дату');
    setBusy(true);
    setErr('');
    try {
      await api('/events', {
        method: 'POST',
        body: {
          title: title.trim(),
          date: new Date(date).toISOString(),
          place: place.trim() || undefined,
          category,
          description: description.trim() || undefined,
        },
      });
      haptic('success');
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <input placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      <input placeholder="Место" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} />
      <textarea placeholder="Описание (необязательно)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} />
      <div className="chips">
        {CATEGORIES.map((c) => (
          <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>
      <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Создаём…' : 'Опубликовать'}</button>
      {err && <p className="msg err">{err}</p>}
    </section>
  );
}
