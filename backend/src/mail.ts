import nodemailer from 'nodemailer';
import { config } from './config';

// На бесплатном Render исходящие SMTP-порты (25/465/587) заблокированы — там почту шлём по HTTPS через API.
const RESEND_KEY = (process.env.RESEND_API_KEY ?? '').trim();
const BREVO_KEY = (process.env.BREVO_API_KEY ?? '').trim();
const apiProvider: 'resend' | 'brevo' | null = RESEND_KEY ? 'resend' : BREVO_KEY ? 'brevo' : null;

/** true, если настроен хоть один способ отправки (HTTP API или SMTP) */
export const smtpConfigured = Boolean(apiProvider || config.smtp.host);

function parseFrom(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].replace(/^"|"$/g, '') || undefined, email: m[2] } : { email: from.trim() };
}

async function sendViaApi(to: string, subject: string, html: string, text?: string) {
  const from = parseFrom(config.smtp.from);
  const res =
    apiProvider === 'resend'
      ? await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${RESEND_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: config.smtp.from, to: [to], subject, html, text }),
          signal: AbortSignal.timeout(15_000),
        })
      : await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': BREVO_KEY, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sender: from, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
          signal: AbortSignal.timeout(15_000),
        });
  if (!res.ok) throw new Error(`${apiProvider} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!transporter) {
    const { host, port, user, pass } = config.smtp;
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 — SSL, 587/25 — STARTTLS
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

/** Проверка соединения с SMTP при старте и из скрипта mail:test */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  if (apiProvider) return { ok: true }; // HTTP API заранее не проверить без отправки письма
  if (!smtpConfigured) return { ok: false, error: 'SMTP_HOST не задан' };
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function sendMail(to: string, subject: string, html: string, text?: string) {
  if (!smtpConfigured) {
    if (config.isProd) throw new Error('SMTP не настроен');
    console.log(`\n[DEV MAIL → ${to}] ${subject}\n${text ?? html}\n`);
    return;
  }
  if (apiProvider) return sendViaApi(to, subject, html, text);
  await getTransporter().sendMail({ from: config.smtp.from, to, subject, html, text });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function sendVerificationEmail(to: string, name: string | null, link: string) {
  const hi = name ? `, ${esc(name)}` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#EAF1FF;font-family:Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:28px 16px">
 <div style="background:#1455D9;color:#fff;border-radius:20px 20px 0 0;padding:22px 26px;font-size:28px;font-weight:800;letter-spacing:-1px">ПАРА</div>
 <div style="background:#fff;border-radius:0 0 20px 20px;padding:26px;color:#0B1630">
  <h2 style="margin:0 0 12px">Подтверди почту${hi}</h2>
  <p style="line-height:1.5;margin:0 0 22px">Нажми на кнопку, чтобы подтвердить email в приложении ПАРА. Ссылка действует 30 минут.</p>
  <a href="${esc(link)}" style="display:inline-block;background:#1455D9;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:14px">Подтвердить email</a>
  <p style="color:#6b7488;font-size:12px;margin:22px 0 0">Если это был не ты — просто проигнорируй письмо.</p>
 </div></div></body></html>`;
  return sendMail(to, 'ПАРА — подтверждение почты', html, `Подтверди почту в ПАРА: ${link}`);
}
