from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo


def _safe(record: dict[str, Any], key: str, fallback: str = "—") -> str:
    value = record.get(key)
    if value is None:
        return fallback
    text = str(value).strip()
    return text if text else fallback


def _to_local_time(created_at: str | None, timezone_name: str) -> str:
    if not created_at:
        return "—"

    normalized = created_at.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return created_at

    if dt.tzinfo is None:
        return dt.strftime("%Y-%m-%d %H:%M:%S")

    local_dt = dt.astimezone(ZoneInfo(timezone_name))
    return local_dt.strftime("%Y-%m-%d %H:%M:%S %Z")


def build_notification_text(record: dict[str, Any], timezone_name: str, web_app_url: str | None) -> str:
    record_id = _safe(record, "id")
    created_local = _to_local_time(record.get("created_at"), timezone_name)

    name = _safe(record, "name")
    phone = _safe(record, "phone")
    message = _safe(record, "message")

    brand = _safe(record, "brand", fallback="")
    model = _safe(record, "model", fallback="")
    year = _safe(record, "year", fallback="")
    vin = _safe(record, "vin", fallback="")
    car_parts = [part for part in [brand, model, year] if part]
    car_line = " ".join(car_parts) if car_parts else "—"

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

    if web_app_url:
        base = web_app_url.rstrip("/")
        lines.append(f"🔗 {base}/#/orders/{record_id}")

    return "\n".join(lines)
