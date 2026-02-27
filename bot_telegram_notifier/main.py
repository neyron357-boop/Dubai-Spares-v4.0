from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

# --- ALL CONFIG / KEYS IN ONE FILE ---
BOT_TOKEN = "8649391903:AAEm9TT1i1yXLwSw_FRX6j1JASFbJTqbfyY"
SUPABASE_URL = "https://nbnfaxsvdlcdycnuzieu.supabase.co"
SUPABASE_KEY = "sb_publishable_LBtkQ3o98MWr0GCSi-ImTw_N5pMpk7V"
TABLE_NAME = "client_leads"
TELEGRAM_CHAT_ID: int | None = None
POLL_INTERVAL_SECONDS = 15
START_FROM_NOW = True
CREATED_AT_FIELD = "created_at"
SELECT_FIELDS = "id,created_at,name,phone,message,brand,model,year,vin"
ORDER_BY = "created_at.desc"
LIMIT = 10
TIMEZONE = "Asia/Dubai"
WEB_APP_URL: str | None = None
STATE_FILE = Path(__file__).resolve().parent / "state.json"
MAX_NOTIFICATIONS_PER_CYCLE = 5

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
LOGGER = logging.getLogger("bot_telegram_notifier")


class StateStore:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._state: dict[str, Any] = {
            "owner_chat_id": None,
            "last_seen_created_at": None,
            "last_seen_id": None,
        }
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._flush()
            return
        try:
            self._state.update(json.loads(self.path.read_text(encoding="utf-8")))
        except Exception:
            pass

    def _flush(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._state, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def get_owner_chat_id(self) -> int | None:
        with self._lock:
            value = self._state.get("owner_chat_id")
            return int(value) if value is not None else None

    def set_owner_chat_id(self, chat_id: int) -> None:
        with self._lock:
            self._state["owner_chat_id"] = int(chat_id)
            self._flush()

    def get_last_seen(self) -> tuple[str | None, str | None]:
        with self._lock:
            created_at = self._state.get("last_seen_created_at")
            record_id = self._state.get("last_seen_id")
            return created_at, str(record_id) if record_id is not None else None

    def set_last_seen(self, created_at: str, record_id: str | int | None) -> None:
        with self._lock:
            self._state["last_seen_created_at"] = created_at
            self._state["last_seen_id"] = str(record_id) if record_id is not None else None
            self._flush()


class SupabaseClient:
    def __init__(self):
        self.base_url = SUPABASE_URL.rstrip("/")
        self.table_name = TABLE_NAME
        self.session = requests.Session()
        self.session.headers.update(
            {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Accept": "application/json",
            }
        )

    def fetch_latest_rows(self, retries: tuple[int, ...] = (5, 15, 60)) -> list[dict[str, Any]]:
        params = {
            "select": SELECT_FIELDS,
            "order": ORDER_BY,
            "limit": str(LIMIT),
        }
        url = f"{self.base_url}/rest/v1/{self.table_name}"

        for attempt in range(len(retries) + 1):
            try:
                response = self.session.get(url, params=params, timeout=15)
                response.raise_for_status()
                data = response.json()
                if not isinstance(data, list):
                    raise RuntimeError("Unexpected response from Supabase")
                return data
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                if attempt >= len(retries):
                    raise RuntimeError("Supabase fetch failed after retries") from exc
                delay = retries[attempt]
                LOGGER.warning("Supabase request failed (%s). retry in %ss", exc, delay)
                time.sleep(delay)
        return []


def _safe(record: dict[str, Any], key: str, fallback: str = "—") -> str:
    value = record.get(key)
    if value is None:
        return fallback
    text = str(value).strip()
    return text if text else fallback


def _to_local_time(created_at: str | None) -> str:
    if not created_at:
        return "—"
    normalized = created_at.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return created_at
    if dt.tzinfo is None:
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    return dt.astimezone(ZoneInfo(TIMEZONE)).strftime("%Y-%m-%d %H:%M:%S %Z")


def build_notification_text(record: dict[str, Any]) -> str:
    record_id = _safe(record, "id")
    created_local = _to_local_time(record.get("created_at"))
    name = _safe(record, "name")
    phone = _safe(record, "phone")
    message = _safe(record, "message")
    brand = _safe(record, "brand", fallback="")
    model = _safe(record, "model", fallback="")
    year = _safe(record, "year", fallback="")
    vin = _safe(record, "vin", fallback="")
    car_line = " ".join([x for x in [brand, model, year] if x]) or "—"

    lines = [
        "🆕 New order",
        f"🆔 ID: {record_id}",
        f"🕒 Created: {created_local}",
        f"👤 Name: {name}",
        f"📞 Phone: {phone}",
        f"💬 Message: {message}",
        f"🚘 Car: {car_line}",
        f"🔢 VIN: {vin if vin else '—'}",
    ]
    if WEB_APP_URL:
        lines.append(f"🔗 {WEB_APP_URL.rstrip('/')}/#/orders/{record_id}")
    return "\n".join(lines)


class BotRuntime:
    def __init__(self):
        self.state = StateStore(STATE_FILE)
        self.supabase = SupabaseClient()

    def get_effective_owner_chat_id(self) -> int | None:
        if TELEGRAM_CHAT_ID is not None:
            return TELEGRAM_CHAT_ID
        return self.state.get_owner_chat_id()


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    runtime: BotRuntime = context.application.bot_data["runtime"]
    chat_id = update.effective_chat.id if update.effective_chat else None
    if chat_id is None:
        return

    if TELEGRAM_CHAT_ID is not None and chat_id != TELEGRAM_CHAT_ID:
        await update.message.reply_text("⛔ Доступ запрещен")
        LOGGER.warning("Unauthorized /start from chat_id=%s", chat_id)
        return

    if TELEGRAM_CHAT_ID is None:
        runtime.state.set_owner_chat_id(chat_id)

    await update.message.reply_text("✅ Уведомления включены. Я буду присылать новые заявки.")
    LOGGER.info("Owner chat configured: %s", chat_id)


async def initialize_last_seen_if_needed(runtime: BotRuntime) -> None:
    last_seen_created_at, _ = runtime.state.get_last_seen()
    if last_seen_created_at is not None or not START_FROM_NOW:
        return

    rows = await asyncio.to_thread(runtime.supabase.fetch_latest_rows)
    if not rows:
        return

    latest = rows[0]
    created_at = latest.get(CREATED_AT_FIELD)
    record_id = latest.get("id")
    if created_at:
        runtime.state.set_last_seen(str(created_at), record_id)
        LOGGER.info("State initialized from latest row id=%s", record_id)


def _is_new_record(row: dict[str, Any], last_seen_created_at: str | None, last_seen_id: str | None) -> bool:
    created_at = row.get(CREATED_AT_FIELD)
    if created_at is None:
        return False

    created_at = str(created_at)
    row_id = str(row.get("id")) if row.get("id") is not None else None

    if last_seen_created_at is None:
        return True
    if created_at > last_seen_created_at:
        return True
    if created_at == last_seen_created_at and row_id is not None and row_id != last_seen_id:
        return True
    return False


async def poll_and_notify(application: Application, runtime: BotRuntime) -> None:
    await initialize_last_seen_if_needed(runtime)

    while True:
        try:
            owner_chat_id = runtime.get_effective_owner_chat_id()
            if owner_chat_id is None:
                LOGGER.info("Waiting for /start from owner before sending notifications")
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                continue

            rows = await asyncio.to_thread(runtime.supabase.fetch_latest_rows)
            last_seen_created_at, last_seen_id = runtime.state.get_last_seen()

            new_rows = [row for row in rows if _is_new_record(row, last_seen_created_at, last_seen_id)]
            if not new_rows:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                continue

            new_rows_sorted = sorted(
                new_rows,
                key=lambda x: (str(x.get(CREATED_AT_FIELD, "")), str(x.get("id", ""))),
            )

            for row in new_rows_sorted[:MAX_NOTIFICATIONS_PER_CYCLE]:
                await application.bot.send_message(
                    chat_id=owner_chat_id,
                    text=build_notification_text(row),
                )
                runtime.state.set_last_seen(str(row.get(CREATED_AT_FIELD)), row.get("id"))

        except Exception as exc:
            LOGGER.exception("Polling iteration failed: %s", exc)

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def post_init(application: Application) -> None:
    runtime: BotRuntime = application.bot_data["runtime"]
    application.create_task(poll_and_notify(application, runtime))


def main() -> None:
    runtime = BotRuntime()
    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()
    app.bot_data["runtime"] = runtime
    app.add_handler(CommandHandler("start", start_handler))
    LOGGER.info("Bot started. Polling interval: %ss", POLL_INTERVAL_SECONDS)
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
