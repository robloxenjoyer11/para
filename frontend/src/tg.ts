type TgWebApp = {
  initData: string;
  ready(): void;
  expand(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  HapticFeedback?: { impactOccurred(s: 'light' | 'medium' | 'heavy'): void; notificationOccurred(t: 'error' | 'success' | 'warning'): void };
};
declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export const tg = window.Telegram?.WebApp;
/** true только когда приложение реально открыто из Telegram (есть подписанные данные) */
export const inTelegram = Boolean(tg?.initData);

export function initTelegram() {
  try {
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor?.('#1455D9');
    tg?.setBackgroundColor?.('#F5F7FB');
  } catch {
    /* старые клиенты */
  }
}
export const haptic = (t: 'success' | 'error' = 'success') => {
  try {
    tg?.HapticFeedback?.notificationOccurred(t);
  } catch {
    /* ignore */
  }
};
/** Вход/регистрация по email. Включается переменной VITE_EMAIL_AUTH=1 (нужна рабочая отправка почты). */
export const EMAIL_AUTH = import.meta.env.VITE_EMAIL_AUTH === '1';
/** Имя бота без @ — для кнопки «Открыть в Telegram» */
export const BOT_USERNAME: string = import.meta.env.VITE_BOT_USERNAME || 'para_tyumgu_bot';
