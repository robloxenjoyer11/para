import { config } from './config';

const api = (method: string, body?: unknown) =>
  fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 40_000 : 15_000),
  }).then(async (r) => {
    const j: any = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
    return j.result;
  });

export let botUsername = '';

const openKeyboard = () => ({
  inline_keyboard: [[{ text: 'Открыть ПАРА', web_app: { url: config.webappUrl } }]],
});

async function handle(update: any) {
  const m = update.message;
  if (!m?.text) return;
  const text: string = m.text;
  if (text.startsWith('/start') || text.startsWith('/app')) {
    await api('sendMessage', {
      chat_id: m.chat.id,
      text: 'Привет! Это ПАРА — расписание, оценки и ивенты ТюмГУ в одном месте.',
      reply_markup: openKeyboard(),
    });
  } else if (text.startsWith('/help')) {
    await api('sendMessage', {
      chat_id: m.chat.id,
      text: 'Нажми «Открыть ПАРА», чтобы увидеть расписание и ближайшие ивенты.',
      reply_markup: openKeyboard(),
    });
  }
}

export async function startBot() {
  if (!config.botToken) return console.warn('[bot] BOT_TOKEN не задан — бот отключён');
  if (config.botMode === 'off') return console.log('[bot] BOT_MODE=off');
  if (!/^https:\/\//.test(config.webappUrl)) {
    console.warn('[bot] WEBAPP_URL должен быть https:// (Telegram не открывает http). Сейчас:', config.webappUrl);
  }

  try {
    const me = await api('getMe');
    botUsername = me.username;
    console.log(`[bot] @${botUsername} подключён`);
    await api('deleteWebhook', { drop_pending_updates: false });
    await api('setMyCommands', {
      commands: [
        { command: 'start', description: 'Открыть ПАРА' },
        { command: 'help', description: 'Помощь' },
      ],
    });
    if (/^https:\/\//.test(config.webappUrl)) {
      await api('setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'ПАРА', web_app: { url: config.webappUrl } },
      });
    }
  } catch (e) {
    return console.error('[bot] не удалось инициализировать:', (e as Error).message);
  }

  // long polling
  let offset = 0;
  (async function loop() {
    for (;;) {
      try {
        const updates: any[] = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          handle(u).catch((e) => console.error('[bot] handler:', e.message));
        }
      } catch (e) {
        console.error('[bot] polling:', (e as Error).message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
}
