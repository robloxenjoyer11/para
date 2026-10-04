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
