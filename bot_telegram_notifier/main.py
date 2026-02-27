from __future__ import annotations

import asyncio
import logging
from typing import Any

from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

from config import Config, load_config
from notifier import build_notification_text
from state_store import StateStore
from supabase_client import SupabaseClient


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
LOGGER = logging.getLogger("bot_telegram_notifier")

MAX_NOTIFICATIONS_PER_CYCLE = 5


class BotRuntime:
    def __init__(self, config: Config):
        self.config = config
        self.state = StateStore(config.state_file)
        self.supabase = SupabaseClient(
            base_url=config.supabase_url,
            service_role_key=config.supabase_service_role_key,
            table_name=config.table_name,
            select_fields=config.select_fields,
            order_by=config.order_by,
            limit=config.limit,
        )

    def get_effective_owner_chat_id(self) -> int | None:
        if self.config.telegram_chat_id is not None:
            return self.config.telegram_chat_id
        return self.state.get_owner_chat_id()


async def start_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    runtime: BotRuntime = context.application.bot_data["runtime"]
    chat_id = update.effective_chat.id if update.effective_chat else None

    if chat_id is None:
        return

    fixed_owner = runtime.config.telegram_chat_id
    if fixed_owner is not None and chat_id != fixed_owner:
        await update.message.reply_text("⛔ Доступ запрещен")
        LOGGER.warning("Unauthorized /start from chat_id=%s", chat_id)
        return

    if fixed_owner is None:
        runtime.state.set_owner_chat_id(chat_id)

    await update.message.reply_text("✅ Уведомления включены. Я буду присылать новые заявки.")
    LOGGER.info("Owner chat configured: %s", chat_id)


async def initialize_last_seen_if_needed(runtime: BotRuntime) -> None:
    last_seen_created_at, _ = runtime.state.get_last_seen()
    if last_seen_created_at is not None:
        return

    if not runtime.config.start_from_now:
        LOGGER.info("START_FROM_NOW disabled: starting from oldest tracked state")
        return

    rows = await asyncio.to_thread(runtime.supabase.fetch_latest_rows)
    if not rows:
        LOGGER.info("No rows found while initializing state")
        return

    latest = rows[0]
    created_at = latest.get(runtime.config.created_at_field)
    record_id = latest.get("id")
    if created_at:
        runtime.state.set_last_seen(str(created_at), record_id)
        LOGGER.info("State initialized from latest row id=%s", record_id)


def _is_new_record(
    row: dict[str, Any],
    last_seen_created_at: str | None,
    last_seen_id: str | None,
    created_at_field: str,
) -> bool:
    created_at = row.get(created_at_field)
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
                await asyncio.sleep(runtime.config.poll_interval_seconds)
                continue

            rows = await asyncio.to_thread(runtime.supabase.fetch_latest_rows)
            last_seen_created_at, last_seen_id = runtime.state.get_last_seen()

            new_rows = [
                row
                for row in rows
                if _is_new_record(
                    row,
                    last_seen_created_at=last_seen_created_at,
                    last_seen_id=last_seen_id,
                    created_at_field=runtime.config.created_at_field,
                )
            ]

            if not new_rows:
                await asyncio.sleep(runtime.config.poll_interval_seconds)
                continue

            # Supabase query is desc. Send oldest first for readable timeline.
            new_rows_sorted = sorted(
                new_rows,
                key=lambda x: (str(x.get(runtime.config.created_at_field, "")), str(x.get("id", ""))),
            )

            batch = new_rows_sorted[:MAX_NOTIFICATIONS_PER_CYCLE]
            for row in batch:
                text = build_notification_text(
                    row,
                    timezone_name=runtime.config.timezone,
                    web_app_url=runtime.config.web_app_url,
                )
                await application.bot.send_message(chat_id=owner_chat_id, text=text)

                created_at = str(row.get(runtime.config.created_at_field))
                record_id = row.get("id")
                runtime.state.set_last_seen(created_at, record_id)

            if len(new_rows_sorted) > MAX_NOTIFICATIONS_PER_CYCLE:
                LOGGER.info(
                    "Rate limit applied. Sent %s of %s new rows in this cycle",
                    MAX_NOTIFICATIONS_PER_CYCLE,
                    len(new_rows_sorted),
                )

        except Exception as exc:  # keep bot alive
            LOGGER.exception("Polling iteration failed: %s", exc)

        await asyncio.sleep(runtime.config.poll_interval_seconds)


async def post_init(application: Application) -> None:
    runtime: BotRuntime = application.bot_data["runtime"]
    application.create_task(poll_and_notify(application, runtime))


def main() -> None:
    config = load_config()
    runtime = BotRuntime(config)

    app = Application.builder().token(config.bot_token).post_init(post_init).build()
    app.bot_data["runtime"] = runtime
    app.add_handler(CommandHandler("start", start_handler))

    LOGGER.info("Bot started. Polling interval: %ss", config.poll_interval_seconds)
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
