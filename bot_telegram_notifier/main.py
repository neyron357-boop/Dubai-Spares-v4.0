#!/usr/bin/env python3
import json
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError

# ============ CONFIG (ALL IN ONE FILE) ============
BOT_TOKEN = "8649391903:AAEm9TT1i1yXLwSw_FRX6j1JASFbJTqbfyY"
SUPABASE_URL = "https://nbnfaxsvdlcdycnuzieu.supabase.co"
SUPABASE_KEY = "sb_publishable_LBtkQ3o98MWr0GCSi-ImTw_N5pMpk7V"

# Все подписчики получают уведомления (без владельца)
SUBSCRIBERS_FILE = Path(__file__).with_name("telegram_subscribers.json")
POLL_INTERVAL_SECONDS = 2
LIMIT = 30

# Пытаемся читать лиды/заказы из разных таблиц, чтобы бот работал даже при изменениях схемы.
TRACKED_SOURCES = [
    {
        "table": "client_leads",
        "select": "id,created_at,name,phone,message,brand,model,year,vin",
        "order_fields": ["created_at", "id"],
    },
    {
        "table": "orders",
        "select": "id,created_at,name,phone,message,brand,model,year,vin,customer_name,customer_phone,notes",
        "order_fields": ["created_at", "updated_at", "id"],
    },
]

# ============ RUNTIME STATE ============
subscribers: set[int] = set()
last_seen_per_source: dict[str, tuple[str, str]] = {}
offset = 0
last_supabase_error = ""


def load_subscribers() -> set[int]:
    if not SUBSCRIBERS_FILE.exists():
        return set()
    try:
        raw = json.loads(SUBSCRIBERS_FILE.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            return set()
        return {int(x) for x in raw}
    except Exception as e:
        print(f"[WARN] cannot load subscribers: {e}")
        return set()


def save_subscribers():
    try:
        SUBSCRIBERS_FILE.write_text(
            json.dumps(sorted(subscribers), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as e:
        print(f"[WARN] cannot save subscribers: {e}")


def http_json(url: str, method: str = "GET", headers=None, data=None, timeout: int = 30):
    req = urllib.request.Request(url=url, method=method, headers=headers or {}, data=data)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", errors="replace")
        except Exception:
            detail = str(e)
        raise RuntimeError(f"HTTP {e.code} {e.reason}: {detail}") from e
    except URLError as e:
        raise RuntimeError(f"Network error: {e}") from e


def tg_api(method: str, payload: dict | None = None):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    return http_json(url=url, method="POST" if payload is not None else "GET", headers=headers, data=data, timeout=60)


def send_message(chat_id: int, text: str):
    try:
        tg_api("sendMessage", {"chat_id": chat_id, "text": text})
    except Exception as e:
        print(f"[TELEGRAM ERROR] sendMessage failed for {chat_id}: {e}")


def broadcast_message(text: str):
    if not subscribers:
        return
    for chat_id in list(subscribers):
        send_message(chat_id, text)


def to_local_time(created_at: str | None) -> str:
    if not created_at:
        return "—"
    try:
        dt = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return str(created_at)


def pick_first(row: dict, keys: list[str], default: str = "—") -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip() != "":
            return str(value)
    return default


def format_notification(row: dict, source_table: str) -> str:
    brand = pick_first(row, ["brand"])
    model = pick_first(row, ["model"])
    year = pick_first(row, ["year"], default="")
    car = " ".join([x for x in [brand, model, year] if x and x != "—"]).strip() or "—"

    return "\n".join(
        [
            "🆕 Новый заказ",
            f"📦 Таблица: {source_table}",
            f"🆔 ID: {pick_first(row, ['id'])}",
            f"🕒 Created: {to_local_time(pick_first(row, ['created_at', 'updated_at'], default=''))}",
            f"👤 Name: {pick_first(row, ['name', 'customer_name'])}",
            f"📞 Phone: {pick_first(row, ['phone', 'customer_phone'])}",
            f"💬 Message: {pick_first(row, ['message', 'notes'])}",
            f"🚘 Car: {car}",
            f"🔢 VIN: {pick_first(row, ['vin'])}",
        ]
    )


def fetch_rows(table: str, select_fields: str, order_field: str) -> list[dict]:
    params = urllib.parse.urlencode(
        {
            "select": select_fields,
            "order": f"{order_field}.desc",
            "limit": str(LIMIT),
        }
    )
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{table}?{params}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
    }
    data = http_json(url=url, method="GET", headers=headers, timeout=30)
    return data if isinstance(data, list) else []


def fetch_with_fallbacks(source: dict) -> tuple[list[dict], str | None]:
    table = source["table"]
    select_variants = [source["select"], "*"]
    for select_fields in select_variants:
        for order_field in source["order_fields"]:
            try:
                rows = fetch_rows(table=table, select_fields=select_fields, order_field=order_field)
                return rows, order_field
            except Exception as e:
                text = str(e)
                if "HTTP 400" in text or "PGRST" in text:
                    continue
                raise
    return [], None


def row_sort_key(row: dict, order_field: str) -> tuple[str, str]:
    primary = str(row.get(order_field) or "")
    rid = str(row.get("id") or "")
    return primary, rid


def find_new_rows(source_name: str, rows: list[dict], order_field: str) -> list[dict]:
    marker = last_seen_per_source.get(source_name)
    if marker is None:
        if rows:
            last_seen_per_source[source_name] = row_sort_key(rows[0], order_field)
        return []

    new_rows = []
    for row in rows:
        key = row_sort_key(row, order_field)
        if key[0] and key > marker:
            new_rows.append(row)

    if rows:
        last_seen_per_source[source_name] = row_sort_key(rows[0], order_field)

    return list(reversed(new_rows))


def bootstrap_last_seen():
    for source in TRACKED_SOURCES:
        name = source["table"]
        try:
            rows, order_field = fetch_with_fallbacks(source)
            if rows and order_field:
                last_seen_per_source[name] = row_sort_key(rows[0], order_field)
                print(f"[BOOT] {name}: marker={last_seen_per_source[name]}")
            else:
                print(f"[BOOT] {name}: no rows or unavailable")
        except Exception as e:
            print(f"[BOOT ERROR] {name}: {e}")


def supabase_poll_loop():
    global last_supabase_error
    while True:
        try:
            any_success = False
            for source in TRACKED_SOURCES:
                source_name = source["table"]
                rows, order_field = fetch_with_fallbacks(source)
                if not order_field:
                    continue

                any_success = True
                new_rows = find_new_rows(source_name, rows, order_field)
                for row in new_rows:
                    broadcast_message(format_notification(row, source_name))
                    print(f"[SENT] {source_name} id={row.get('id')}")

            if not any_success:
                msg = "No tracked table could be fetched. Check SUPABASE_URL/SUPABASE_KEY/table names."
                if msg != last_supabase_error:
                    print(f"[SUPABASE WARNING] {msg}")
                    last_supabase_error = msg
            else:
                last_supabase_error = ""
        except Exception as e:
            msg = str(e)
            if msg != last_supabase_error:
                print(f"[SUPABASE ERROR] {msg}")
                last_supabase_error = msg

        time.sleep(POLL_INTERVAL_SECONDS)


def cmd_start(chat_id: int):
    is_new = chat_id not in subscribers
    subscribers.add(chat_id)
    save_subscribers()
    if is_new:
        send_message(chat_id, "✅ Подписка включена. Теперь вы будете получать новые заказы.")
    else:
        send_message(chat_id, "✅ Вы уже подписаны на уведомления о новых заказах.")


def cmd_stop(chat_id: int):
    if chat_id in subscribers:
        subscribers.remove(chat_id)
        save_subscribers()
        send_message(chat_id, "🛑 Подписка отключена.")
    else:
        send_message(chat_id, "ℹ️ У вас и так нет активной подписки.")


def cmd_status(chat_id: int):
    status = "подписаны" if chat_id in subscribers else "не подписаны"
    send_message(
        chat_id,
        f"ℹ️ Вы {status}.\n"
        f"👥 Всего подписчиков: {len(subscribers)}\n"
        f"🗂 Отслеживаемые таблицы: {', '.join(s['table'] for s in TRACKED_SOURCES)}",
    )


def handle_update(upd: dict):
    message = upd.get("message") or {}
    text = (message.get("text") or "").strip()
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if chat_id is None:
        return
    chat_id = int(chat_id)

    if text.startswith("/start"):
        cmd_start(chat_id)
    elif text.startswith("/stop"):
        cmd_stop(chat_id)
    elif text.startswith("/status"):
        cmd_status(chat_id)
    elif text.startswith("/"):
        send_message(
            chat_id,
            "Доступные команды:\n"
            "/start — включить уведомления\n"
            "/stop — отключить уведомления\n"
            "/status — текущий статус",
        )


def telegram_updates_loop():
    global offset
    while True:
        try:
            result = tg_api(
                "getUpdates",
                {
                    "timeout": 30,
                    "offset": offset,
                    "allowed_updates": ["message"],
                },
            )
            updates = result.get("result", []) if isinstance(result, dict) else []
            for upd in updates:
                upd_id = upd.get("update_id")
                if upd_id is not None:
                    offset = int(upd_id) + 1
                handle_update(upd)
        except Exception as e:
            print(f"[TELEGRAM ERROR] getUpdates failed: {e}")
            time.sleep(2)


def main():
    global subscribers
    subscribers = load_subscribers()

    print("[START] Telegram notifier started")
    me = tg_api("getMe")
    print(f"[BOT] @{me.get('result', {}).get('username', 'unknown')}")
    print(f"[SUBSCRIBERS] loaded: {len(subscribers)}")

    bootstrap_last_seen()

    th = threading.Thread(target=supabase_poll_loop, daemon=True)
    th.start()

    telegram_updates_loop()


if __name__ == "__main__":
    main()
