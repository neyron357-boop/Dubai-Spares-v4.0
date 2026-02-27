#!/usr/bin/env python3
import json
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ============ CONFIG (ALL IN ONE FILE) ============
BOT_TOKEN = "8649391903:AAEm9TT1i1yXLwSw_FRX6j1JASFbJTqbfyY"
SUPABASE_URL = "https://nbnfaxsvdlcdycnuzieu.supabase.co"
SUPABASE_KEY = "sb_publishable_LBtkQ3o98MWr0GCSi-ImTw_N5pMpk7V"
TABLE_NAME = "client_leads"

# Если известен chat_id, можно сразу вставить сюда числом.
# Если None — отправьте боту /start, и он запомнит первого пользователя как владельца.
TELEGRAM_CHAT_ID = None

# Почти мгновенная проверка новых заказов
POLL_INTERVAL_SECONDS = 1
LIMIT = 20

# Поля, которые тянем из Supabase
SELECT_FIELDS = "id,created_at,name,phone,message,brand,model,year,vin"
ORDER_BY = "created_at.desc"

# ============ RUNTIME STATE ============
owner_chat_id = TELEGRAM_CHAT_ID
last_seen_created_at = None
last_seen_id = None
offset = 0


def http_json(url: str, method: str = "GET", headers=None, data=None, timeout: int = 30):
    req = urllib.request.Request(url=url, method=method, headers=headers or {}, data=data)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body)


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
        print(f"[TELEGRAM ERROR] sendMessage failed: {e}")


def to_local_time(created_at: str | None) -> str:
    if not created_at:
        return "—"
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return created_at


def format_notification(row: dict) -> str:
    brand = (row.get("brand") or "").strip()
    model = (row.get("model") or "").strip()
    year = str(row.get("year") or "").strip()
    car = " ".join([x for x in [brand, model, year] if x]) or "—"

    return "\n".join(
        [
            "🆕 Новый заказ",
            f"🆔 ID: {row.get('id', '—')}",
            f"🕒 Created: {to_local_time(row.get('created_at'))}",
            f"👤 Name: {row.get('name') or '—'}",
            f"📞 Phone: {row.get('phone') or '—'}",
            f"💬 Message: {row.get('message') or '—'}",
            f"🚘 Car: {car}",
            f"🔢 VIN: {row.get('vin') or '—'}",
        ]
    )


def fetch_latest_rows() -> list[dict]:
    params = urllib.parse.urlencode(
        {
            "select": SELECT_FIELDS,
            "order": ORDER_BY,
            "limit": str(LIMIT),
        }
    )
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{TABLE_NAME}?{params}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
    }
    data = http_json(url=url, method="GET", headers=headers, timeout=30)
    if not isinstance(data, list):
        return []
    return data


def is_newer(created_at: str, record_id: str) -> bool:
    global last_seen_created_at, last_seen_id
    if last_seen_created_at is None:
        return False
    if created_at > last_seen_created_at:
        return True
    if created_at == last_seen_created_at and last_seen_id is not None and str(record_id) > str(last_seen_id):
        return True
    return False


def set_last_seen_from_rows(rows: list[dict]):
    global last_seen_created_at, last_seen_id
    if not rows:
        return
    newest = rows[0]
    created = str(newest.get("created_at") or "")
    rid = str(newest.get("id") or "")
    if created:
        last_seen_created_at = created
        last_seen_id = rid


def bootstrap_last_seen():
    global last_seen_created_at, last_seen_id
    try:
        rows = fetch_latest_rows()
        if rows:
            last_seen_created_at = str(rows[0].get("created_at") or "")
            last_seen_id = str(rows[0].get("id") or "")
        print(f"[BOOT] baseline set: created_at={last_seen_created_at}, id={last_seen_id}")
    except Exception as e:
        print(f"[BOOT ERROR] {e}")


def supabase_poll_loop():
    global owner_chat_id
    while True:
        try:
            rows = fetch_latest_rows()

            if last_seen_created_at is None:
                set_last_seen_from_rows(rows)
            else:
                # rows in desc order -> соберем новые и отправим по возрастанию времени
                new_rows = []
                for row in rows:
                    created_at = str(row.get("created_at") or "")
                    record_id = str(row.get("id") or "")
                    if not created_at or not record_id:
                        continue
                    if is_newer(created_at, record_id):
                        new_rows.append(row)

                if new_rows and owner_chat_id is not None:
                    for row in reversed(new_rows):
                        send_message(owner_chat_id, format_notification(row))
                        print(f"[SENT] order id={row.get('id')}")

                if rows:
                    set_last_seen_from_rows(rows)

        except Exception as e:
            print(f"[SUPABASE ERROR] {e}")

        time.sleep(POLL_INTERVAL_SECONDS)


def handle_update(upd: dict):
    global owner_chat_id
    message = upd.get("message") or {}
    text = (message.get("text") or "").strip()
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if chat_id is None:
        return

    if text.startswith("/start"):
        if owner_chat_id is None:
            owner_chat_id = int(chat_id)
            send_message(owner_chat_id, "✅ Бот подключен. Новые заказы будут приходить сразу.")
            print(f"[OWNER] set owner_chat_id={owner_chat_id}")
        elif int(chat_id) == int(owner_chat_id):
            send_message(owner_chat_id, "✅ Бот уже активен. Уведомления включены.")
        else:
            send_message(int(chat_id), "⛔ Доступ запрещен")


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
    print("[START] Telegram notifier started")
    me = tg_api("getMe")
    print(f"[BOT] @{me.get('result', {}).get('username', 'unknown')}")

    bootstrap_last_seen()

    th = threading.Thread(target=supabase_poll_loop, daemon=True)
    th.start()

    telegram_updates_loop()


if __name__ == "__main__":
    main()
