import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';
const env = (k: string, d = '') => (process.env[k] ?? d).trim();

export const config = {
  isProd,
  port: Number(env('PORT', '3001')),
  databaseUrl: env('DATABASE_URL'),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),
  encryptionKey: env('ENCRYPTION_KEY') || env('JWT_SECRET', 'dev-secret-change-me'),
  // Публичный HTTPS-адрес мини-аппа (то, что открывается внутри Telegram)
  webappUrl: env('WEBAPP_URL') || env('APP_ORIGIN', 'http://localhost:5173'),
  appOrigin: env('APP_ORIGIN', 'http://localhost:5173'),
  // Публичный адрес API (для ссылок в письмах). Если фронт отдаётся тем же сервером — тот же URL.
  publicUrl: (env('PUBLIC_URL') || env('WEBAPP_URL') || `http://localhost:${env('PORT', '3001')}`).replace(/\/$/, ''),
  botToken: env('BOT_TOKEN'),
  botMode: env('BOT_MODE', 'polling') as 'polling' | 'off',
  smtp: {
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PORT', '587')),
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS'),
    from: env('MAIL_FROM', 'ПАРА <no-reply@example.com>'),
  },
  modeus: {
    baseUrl: env('MODEUS_BASE_URL', 'https://utmn.modeus.org').replace(/\/$/, ''),
    authUrl: env('MODEUS_AUTH_URL'), // необязательно: подхватывается из app.config.json
    clientId: env('MODEUS_CLIENT_ID'), // необязательно
    tz: env('MODEUS_TZ', 'Asia/Tyumen'),
    utcOffset: env('MODEUS_UTC_OFFSET', '+05:00'),
    searchPath: env('MODEUS_SEARCH_PATH', '/schedule-calendar-v2/api/calendar/events/search'),
    // Оценки: адрес берётся из DevTools (см. README). Пока не задан — раздел показывает заглушку.
    gradesPath: env('MODEUS_GRADES_PATH'), // например /students-app/api/...  (относительно MODEUS_BASE_URL)
    gradesMethod: env('MODEUS_GRADES_METHOD', 'GET').toUpperCase(),
    gradesBody: env('MODEUS_GRADES_BODY'), // JSON-строка; {personId} заменится на id студента
    mock: env('MODEUS_MOCK') === '1',
    debug: env('MODEUS_DEBUG') === '1',
  },
};

if (isProd) {
  if (config.jwtSecret === 'dev-secret-change-me' || config.jwtSecret.length < 24) {
    console.error('JWT_SECRET не задан или слишком короткий (нужно ≥ 24 символов)');
    process.exit(1);
  }
}
