const MIN_VISIBLE_MS = 900; // чтобы заставка не мигала на быстрых соединениях
const started = performance.now();

/** Плавно убирает заставку из index.html (когда приложение готово показать экран) */
export function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - started));
  setTimeout(() => {
    clearTimeout((window as unknown as { __splashHint?: number }).__splashHint);
    el.classList.add('hide');
    setTimeout(() => el.remove(), 500);
  }, wait);
}
