from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_STATE_PATH = BASE_DIR / "state.json"


@dataclass(frozen=True)
class Config:
    bot_token: str
    supabase_url: str
    supabase_service_role_key: str
    table_name: str
    poll_interval_seconds: int
    telegram_chat_id: int | None
    start_from_now: bool
    created_at_field: str
    select_fields: str
    order_by: str
    limit: int
    timezone: str
    web_app_url: str | None
    state_file: Path


def _parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_optional_int(value: str | None) -> int | None:
    if value is None or value.strip() == "":
        return None
    return int(value.strip())


def _normalize_order(order_value: str) -> str:
    cleaned = order_value.strip()
    if not cleaned:
        return "created_at.desc"

    if "." in cleaned and not cleaned.endswith(")"):
        return cleaned

    # Supports formats like: created_at (desc) or created_at desc
    cleaned = cleaned.replace("(", " ").replace(")", " ")
    parts = [p for p in cleaned.split() if p]
    if len(parts) == 1:
        return f"{parts[0]}.desc"
    column, direction = parts[0], parts[1].lower()
    direction = "asc" if direction == "asc" else "desc"
    return f"{column}.{direction}"


def load_config() -> Config:
    load_dotenv(BASE_DIR / ".env")

    bot_token = os.getenv("BOT_TOKEN", "").strip()
    supabase_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if not bot_token:
        raise ValueError("BOT_TOKEN is required")
    if not supabase_url:
        raise ValueError("SUPABASE_URL is required")
    if not supabase_key:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required")

    poll_interval = int(os.getenv("POLL_INTERVAL_SECONDS", "15"))
    poll_interval = max(10, poll_interval)

    limit = int(os.getenv("LIMIT", "10"))
    if limit < 1:
        raise ValueError("LIMIT must be >= 1")

    return Config(
        bot_token=bot_token,
        supabase_url=supabase_url,
        supabase_service_role_key=supabase_key,
        table_name=os.getenv("TABLE_NAME", "client_leads").strip(),
        poll_interval_seconds=poll_interval,
        telegram_chat_id=_parse_optional_int(os.getenv("TELEGRAM_CHAT_ID")),
        start_from_now=_parse_bool(os.getenv("START_FROM_NOW"), default=True),
        created_at_field=os.getenv("CREATED_AT_FIELD", "created_at").strip(),
        select_fields=os.getenv(
            "SELECT_FIELDS",
            "id,created_at,name,phone,message,brand,model,year,vin",
        ).strip(),
        order_by=_normalize_order(os.getenv("ORDER_BY", "created_at (desc)")),
        limit=limit,
        timezone=os.getenv("TIMEZONE", "Asia/Dubai").strip(),
        web_app_url=(os.getenv("WEB_APP_URL") or "").strip() or None,
        state_file=Path(os.getenv("STATE_FILE", str(DEFAULT_STATE_PATH))).resolve(),
    )
