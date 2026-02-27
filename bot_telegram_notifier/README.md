# Telegram Supabase Notifier Bot

Автономный Telegram-бот, который опрашивает таблицу Supabase и отправляет уведомления о новых заявках/лидах **только одному владельцу** в личные сообщения.

> Бот изолирован от веб-приложения: это отдельная папка/процесс на PythonAnywhere.

## Что умеет

- Polling Supabase REST каждые `POLL_INTERVAL_SECONDS` (по умолчанию 15 сек).
- Отслеживание новых записей по `created_at` + `id`.
- Защита от дублей после рестарта через `state.json`.
- Режим `START_FROM_NOW=true` (по умолчанию): старые записи при старте не отправляются.
- Ограничение анти-спам: максимум 5 уведомлений за цикл.
- Retry/backoff при сетевых сбоях Supabase: 5s → 15s → 60s.
- Доступ только владельцу:
  - либо фиксированный `TELEGRAM_CHAT_ID`;
  - либо первый `/start` сохраняется как owner в `state.json`.

## Структура

- `main.py` — запуск Telegram-бота, `/start`, фоновый polling цикл.
- `config.py` — загрузка и валидация ENV.
- `supabase_client.py` — чтение данных из Supabase REST (`requests`).
- `notifier.py` — форматирование уведомления и локальное время.
- `state_store.py` — хранение owner/last_seen в `state.json`.
- `requirements.txt` — зависимости.
- `.env.example` — пример ENV без секретов.
- `run.sh` — удобный запуск.

## Переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

```env
BOT_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
TABLE_NAME=client_leads
POLL_INTERVAL_SECONDS=15
TELEGRAM_CHAT_ID=
START_FROM_NOW=true
CREATED_AT_FIELD=created_at
SELECT_FIELDS=id,created_at,name,phone,message,brand,model,year,vin
ORDER_BY=created_at (desc)
LIMIT=10
TIMEZONE=Asia/Dubai
WEB_APP_URL=
STATE_FILE=./state.json
```

## Локальный запуск

```bash
cd bot_telegram_notifier
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python main.py
```

## Поведение /start

- Если `TELEGRAM_CHAT_ID` **не задан**: первый пользователь, отправивший `/start`, сохраняется как owner.
- Если `TELEGRAM_CHAT_ID` **задан**: бот отвечает только этому chat_id, остальным — `⛔ Доступ запрещен`.

## PythonAnywhere deployment

1. Загрузите папку `bot_telegram_notifier/` в ваш аккаунт PythonAnywhere.
2. Создайте виртуальное окружение:
   ```bash
   mkvirtualenv tg-notifier --python=python3.11
   workon tg-notifier
   pip install -r /home/<username>/bot_telegram_notifier/requirements.txt
   ```
3. Создайте `.env` из `.env.example` и заполните секреты.
4. Проверка запуска:
   ```bash
   cd /home/<username>/bot_telegram_notifier
   workon tg-notifier
   python main.py
   ```
5. Автозапуск:
   - Если доступна вкладка **Always-on tasks** — создайте задачу:
     ```bash
     bash /home/<username>/bot_telegram_notifier/run.sh
     ```
   - Если Always-on недоступно, используйте периодический task + supervisor/screen/tmux (по тарифу и возможностям аккаунта).

## Тест-план

1. Запустить локально: `python main.py`.
2. Открыть бота в Telegram и отправить `/start`.
3. Добавить тестовую запись в `TABLE_NAME` через Supabase UI.
4. Проверить, что уведомление пришло владельцу.
5. Перезапустить бота и убедиться, что старые записи не дублируются.

## Безопасность

- Не коммитьте `.env`, `state.json`, ключи и токены.
- `SUPABASE_SERVICE_ROLE_KEY` используется только в серверном процессе бота.
- Бот выполняет только чтение таблицы (REST GET), без insert/update/delete.
