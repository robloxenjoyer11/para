const BASE: string = import.meta.env.VITE_API_URL || '/api';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

const KEY = 'para_token';
let token: string | null = null;
try {
  token = localStorage.getItem(KEY);
} catch {
  /* localStorage может быть недоступен */
}
export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  try {
    t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(`Нет соединения с сервером (${BASE})`, 0, 'NETWORK');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Ошибка сервера (HTTP ${res.status}) — проверь VITE_API_URL`, res.status, data.code);
  return data as T;
}

// ───── типы ─────
export type User = {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
  faculty: string | null;
  course: number | null;
  bio: string | null;
  avatarUrl: string | null;
  interests: string[];
  modeusLinkedAt: string | null;
};

export type Lesson = {
  id: string;
  title: string;
  shortTitle: string | null;
  kind: 'lecture' | 'seminar' | 'lab' | 'consult' | 'exam' | 'test' | 'other';
  kindLabel: string;
  start: string;
  end: string;
  room: string | null;
  building: string | null;
  online: string | null;
  teachers: string[];
  status: string | null;
  cancelled: boolean;
};

export type EventItem = {
  id: string;
  title: string;
  description: string | null;
  date: string;
  place: string | null;
  category: string | null;
  creator: { id: string; name: string | null };
};

export const CATEGORIES = ['Вечеринка', 'Спорт', 'Игры', 'Учёба', 'Клубы', 'Другое'] as const;
