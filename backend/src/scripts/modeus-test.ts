// MODEUS_LOGIN=... MODEUS_PASSWORD=... npm run modeus:test
// Логин/пароль берутся из переменных окружения (не из аргументов — чтобы не попасть в history).
import { modeusLogin, fetchLessons, ensureFreshSession, tokenInfo } from '../integrations/modeus';

(async () => {
  const login = process.env.MODEUS_LOGIN, password = process.env.MODEUS_PASSWORD;
  if (!login || !password) return console.error('Задай MODEUS_LOGIN и MODEUS_PASSWORD');
  const { session, personId } = await modeusLogin(login, password);
  console.log('✔ вход выполнен, person_id =', personId, ', токен истекает:', new Date(tokenInfo(session.token).exp).toISOString());
  const fresh = await ensureFreshSession(session);
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const { lessons, selfName } = await fetchLessons(fresh, personId, from, to);
  console.log('имя из расписания:', selfName ?? '— не найдено');
  console.log(`✔ занятий за ${from}…${to}: ${lessons.length}`);
  for (const l of lessons.slice(0, 15)) console.log(`${l.start.slice(0, 16)}  [${l.kindLabel}] ${l.title} — ${l.room ?? l.online ?? '?'} — ${l.teachers.join(', ')}`);
})().catch((e) => {
  console.error('✘', e.constructor.name + ':', e.message);
  process.exit(1);
});
