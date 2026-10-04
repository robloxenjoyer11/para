# ПАРА — Telegram Mini App для студентов ТюмГУ

React/Vite (фронт) + Express/TypeScript (бэкенд) + Prisma/PostgreSQL.

Что работает:
- **Telegram Mini App**: вход автоматически по подписанным данным Telegram (`initData`), бот с кнопкой «Открыть ПАРА» и кнопкой меню.
- **SMTP**: письма подтверждения почты (регистрация, привязка почты из Telegram, повторная отправка), проверка соединения при старте.
- **Расписание из Modeus ТюмГУ** (utmn.modeus.org): студент один раз вводит логин/пароль ТюмГУ, дальше расписание подтягивается само.

## Быстрый старт (локально)

```bash
docker compose up -d                       # PostgreSQL

cd backend
cp .env.example .env                       # заполни (см. ниже)
npm install
npx prisma generate
npx prisma migrate deploy                  # или migrate dev
npm run dev                                # API :3001

cd ../frontend
npm install
npm run dev                                # фронт :5173 (/api проксируется на :3001)
```

### 1. Telegram

Telegram открывает мини-апп **только по HTTPS**, поэтому локально нужен туннель:

```bash
cloudflared tunnel --url http://localhost:5173      # или: ngrok http 5173
```

1. В `@BotFather` → `/newbot` (или `/revoke`, если токен где-то светился) → токен в `BOT_TOKEN`.
2. Адрес туннеля (`https://xxxx.trycloudflare.com`) → в `WEBAPP_URL` в `backend/.env`.
3. Перезапусти бэкенд — он сам настроит команды и кнопку меню бота. Напиши боту `/start` → «Открыть ПАРА».
4. (Необязательно) В BotFather → `/mybots` → Bot Settings → Menu Button / `/newapp` — для ссылки вида `t.me/бот/app`.

Адрес туннеля меняется при каждом запуске (на бесплатных тарифах) — обновляй `WEBAPP_URL`.

### 2. SMTP

В `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (примеры хостов — в `.env.example`). Для Яндекса/Mail.ru/Gmail нужен **пароль приложения**, а не обычный.
Порт 465 → SSL, 587 → STARTTLS (определяется автоматически).

Проверка:
```bash
cd backend
npm run mail:test                          # проверит логин и пароль SMTP
npm run mail:test -- you@example.com       # и отправит тестовое письмо
```
Если `SMTP_HOST` пуст, в dev-режиме письма печатаются в консоль бэкенда; в production регистрация без SMTP отключена.

Ссылка в письме ведёт на `PUBLIC_URL/api/auth/verify?token=…` и показывает страницу «Почта подтверждена».

### 3. Modeus (расписание)

Публичного API у Modeus нет. Бэкенд повторяет то, что делает сайт: OIDC-вход через SSO вуза → `id_token` → `POST /schedule-calendar-v2/api/calendar/events/search`.

**Перед первым запуском проверь на своём аккаунте** (я не мог проверить это на живом utmn.modeus.org):
```bash
cd backend
MODEUS_DEBUG=1 MODEUS_LOGIN='твой_логин' MODEUS_PASSWORD='твой_пароль' npm run modeus:test
```
Скрипт покажет цепочку входа (без паролей и токенов) и список пар на неделю. Если что-то не сошлось:
- `Не удалось получить настройки авторизации` → открой utmn.modeus.org, DevTools → Network, найди запрос к `…/oauth2/authorize` и впиши `MODEUS_AUTH_URL` и `MODEUS_CLIENT_ID` в `.env`.
- `SSO вернул неожиданную страницу` → у ТюмГУ на входе есть шаг, которого нет в разборе (капча, 2FA, согласие). Смотри вывод `MODEUS_DEBUG=1` — на каком адресе остановились.
- Расписание пустое/поля не заполнены → формат ответа Modeus мог отличаться; разбор — функция `normalizeLessons` в `backend/src/integrations/modeus.ts`.

Чтобы проверить интерфейс без входа в Modeus: `MODEUS_MOCK=1` (тестовые пары).

**Безопасность и приватность**
- Пароль студента используется один раз и не сохраняется и не логируется. В БД лежит только токен Modeus и cookie сессии — зашифрованные AES-256-GCM ключом `ENCRYPTION_KEY`.
- Пользователь может отключить Modeus в профиле — сессия удаляется.
- Приложение просит у студентов пароль от учётной записи вуза. Согласуй это с ТюмГУ (условия использования Modeus/ЕЛК) и добавь в приложение политику конфиденциальности. Если у вуза будет официальный API/OAuth-клиент для приложений — переходи на него.

## Продакшн

```bash
cd frontend && npm install && npm run build
cd ../backend && npm install && npm run build && npm run db:deploy
NODE_ENV=production npm start
```
В production бэкенд сам отдаёт `frontend/dist` и API с одного адреса (`:3001`) — поставь перед ним nginx/Caddy с HTTPS и пропиши этот адрес в `WEBAPP_URL`.
В production обязательны `JWT_SECRET` (≥ 24 символов) и `ENCRYPTION_KEY`: `openssl rand -hex 32`.

## Структура

```
backend/src/
  server.ts               API: auth (Telegram/email), профиль, ивенты, Modeus
  telegram.ts             проверка подписи initData
  bot.ts                  бот (long polling), кнопка меню
  mail.ts                 SMTP (nodemailer), шаблон письма
  crypto.ts               шифрование сессий Modeus
  integrations/modeus.ts  вход через SSO и расписание
  scripts/                mail-test, modeus-test
frontend/src/
  main.tsx, api.ts, tg.ts, dates.ts, style.css
  screens/                Home, Schedule, Events, Profile, Auth, ModeusLogin
```
