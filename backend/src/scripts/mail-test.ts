// npm run mail:test -- you@example.com
import { verifySmtp, sendVerificationEmail, smtpConfigured } from '../mail';

(async () => {
  const to = process.argv[2];
  if (!smtpConfigured) return console.error('SMTP_HOST не задан в .env');
  const v = await verifySmtp();
  console.log(v.ok ? '✔ соединение и авторизация SMTP — OK' : `✘ SMTP: ${v.error}`);
  if (!v.ok) process.exit(1);
  if (to) {
    await sendVerificationEmail(to, 'Тест', 'https://example.com/verify?token=test');
    console.log(`✔ тестовое письмо отправлено на ${to}`);
  } else console.log('Добавь адрес, чтобы отправить письмо: npm run mail:test -- you@example.com');
})().catch((e) => {
  console.error('✘', e.message);
  process.exit(1);
});
