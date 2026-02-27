#!/usr/bin/env python3
import json
import ast
import re
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

TRACKED_SOURCES = [
    {
        "table": "orders",
        "select": "id,created_at,updated_at,name,phone,message,brand,model,year,vin,customer_name,customer_phone,notes,car_photo_url,car_photos,vin_photo_url,vin_photos,parts",
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


def send_message(chat_id: int, text: str, reply_markup: dict | None = None):
    try:
        payload = {"chat_id": chat_id, "text": text}
        if reply_markup:
            payload["reply_markup"] = reply_markup
        tg_api("sendMessage", payload)
    except Exception as e:
        print(f"[TELEGRAM ERROR] sendMessage failed for {chat_id}: {e}")


def send_photo(chat_id: int, photo_url: str, caption: str = "", reply_markup: dict | None = None):
    try:
        payload = {
            "chat_id": chat_id,
            "photo": photo_url,
        }
        if caption:
            payload["caption"] = caption
        if reply_markup:
            payload["reply_markup"] = reply_markup
        tg_api("sendPhoto", payload)
    except Exception as e:
        print(f"[TELEGRAM ERROR] sendPhoto failed for {chat_id}: {e}")


def send_document(chat_id: int, file_url: str, caption: str = ""):
    try:
        payload = {"chat_id": chat_id, "document": file_url}
        if caption:
            payload["caption"] = caption
        tg_api("sendDocument", payload)
    except Exception as e:
        print(f"[TELEGRAM ERROR] sendDocument failed for {chat_id}: {e}")


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


def parse_structured(value):
    if isinstance(value, (dict, list)):
        return value
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    try:
        return ast.literal_eval(text)
    except Exception:
        return None



def extract_from_note_lines(lines: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in lines:
        cleaned = line.strip()
        lower = cleaned.lower()
        if cleaned and "name" not in result and not any(x in lower for x in ["источник", "vin", "contact", "time", "engine", "country"]):
            result["name"] = cleaned
        if "primary contact:" in lower:
            contact = cleaned.split(":", 1)[-1].strip()
            match = re.search(r"(\+?\d[\d\s\-]{6,}\d)", contact)
            if match:
                result["phone"] = match.group(1).replace(" ", "")
            if "whatsapp" in lower:
                result["channel"] = "WhatsApp"
            elif "telegram" in lower:
                result["channel"] = "Telegram"
    return result


def normalize_phone(raw: str) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    cleaned = re.sub(r"[^\d+]", "", text)
    if cleaned.startswith("00"):
        cleaned = f"+{cleaned[2:]}"
    return cleaned


def build_whatsapp_url(contact: str) -> str:
    phone = normalize_phone(contact)
    phone = phone.replace("+", "")
    return f"https://wa.me/{phone}" if phone else ""


def build_telegram_url(contact: str) -> str:
    value = str(contact or "").strip()
    if not value:
        return ""
    if value.startswith("@"):
        return f"https://t.me/{value[1:]}"
    if re.fullmatch(r"[A-Za-z0-9_]{5,}", value):
        return f"https://t.me/{value}"
    return ""


def extract_contact_details(row: dict, message_data, note_details: dict[str, str]) -> tuple[str, str, str]:
    phone = pick_first(row, ["phone", "customer_phone"], default="")
    if phone in {"", "—"}:
        phone = note_details.get("phone", "")

    channel = note_details.get("channel", "")
    if isinstance(message_data, dict):
        channel = channel or str(message_data.get("preferredContactChannel") or message_data.get("source") or "")

    channel = channel.strip().lower()
    contact_value = phone
    if isinstance(message_data, dict):
        for key in ["telegram", "telegramContact", "email", "phone", "whatsapp", "customerContact"]:
            value = message_data.get(key)
            if value and str(value).strip():
                if key.startswith("telegram") and channel in {"telegram", ""}:
                    contact_value = str(value).strip()
                if key in {"phone", "whatsapp", "customerContact"} and channel in {"whatsapp", "phone", ""}:
                    contact_value = str(value).strip()

    if not channel:
        low = str(contact_value).lower()
        channel = "telegram" if "@" in low else "whatsapp"

    return phone or "—", channel, contact_value or ""


def build_requested_parts(message_data) -> str:
    if not isinstance(message_data, dict):
        return "—"
    parts = message_data.get("requestedParts")
    if not isinstance(parts, list) or not parts:
        return "—"
    rendered = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        name = str(part.get("name") or "деталь").strip()
        comment = str(part.get("comment") or "").strip()
        rendered.append(f"{name} ({comment})" if comment else name)
    return ", ".join(rendered) if rendered else "—"


def as_list(value) -> list:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    parsed = parse_structured(value)
    return parsed if isinstance(parsed, list) else []


def collect_media_urls(row: dict) -> tuple[list[str], list[str]]:
    photos: list[str] = []
    audios: list[str] = []

    def add_photo(url):
        if isinstance(url, str) and url.startswith(("http://", "https://")) and url not in photos:
            photos.append(url)

    def add_audio(url):
        if isinstance(url, str) and url.startswith(("http://", "https://")) and url not in audios:
            audios.append(url)

    add_photo(row.get("car_photo_url"))
    add_photo(row.get("vin_photo_url"))
    for item in as_list(row.get("car_photos")):
        add_photo(item)
    for item in as_list(row.get("vin_photos")):
        add_photo(item)

    for note in as_list(row.get("notes")):
        if not isinstance(note, dict):
            continue
        for item in as_list(note.get("photos")):
            add_photo(item)
        for item in as_list(note.get("audios")):
            add_audio(item)

    for part in as_list(row.get("parts")):
        if not isinstance(part, dict):
            continue
        add_photo(part.get("photoUrl") or part.get("photo_url"))
        for item in as_list(part.get("photos")):
            add_photo(item)

    return photos, audios


def build_reply_markup(row: dict, channel: str, contact_value: str) -> dict | None:
    buttons = []
    channel_norm = channel.lower().strip()
    if channel_norm == "whatsapp":
        wa_url = build_whatsapp_url(contact_value)
        if wa_url:
            buttons.append({"text": "WhatsApp", "url": wa_url})
    elif channel_norm == "telegram":
        tg_url = build_telegram_url(contact_value)
        if tg_url:
            buttons.append({"text": "Telegram", "url": tg_url})

    photos, audios = collect_media_urls(row)
    if photos or audios:
        buttons.append({"text": "📎 Медиа", "callback_data": f"media:{row.get('id')}"})

    if not buttons:
        return None
    return {"inline_keyboard": [[button] for button in buttons]}


def format_notification(row: dict) -> tuple[str, dict | None, str | None]:
    message_data = parse_structured(row.get("message"))
    notes_data = parse_structured(row.get("notes"))

    note_lines: list[str] = []
    if isinstance(message_data, list):
        for item in message_data:
            if isinstance(item, dict):
                text = item.get("text")
                if text:
                    note_lines.extend(str(text).splitlines())
    if isinstance(notes_data, list):
        for item in notes_data:
            if isinstance(item, dict):
                text = item.get("text")
                if text:
                    note_lines.extend(str(text).splitlines())

    note_details = extract_from_note_lines(note_lines)

    brand = pick_first(row, ["brand"], default="")
    model = pick_first(row, ["model"], default="")
    year = pick_first(row, ["year"], default="")
    if isinstance(message_data, dict):
        brand = brand or str(message_data.get("brand") or "")
        model = model or str(message_data.get("model") or "")
        year = year or str(message_data.get("year") or "")

    car = " ".join([x for x in [brand, model, year] if x and x != "—"]).strip() or "—"

    name = pick_first(row, ["name", "customer_name"], default="")
    if name in {"", "—"}:
        name = note_details.get("name", "—")

    phone, channel, contact_value = extract_contact_details(row, message_data, note_details)

    vin = pick_first(row, ["vin"], default="")
    if vin in {"", "—"} and isinstance(message_data, dict):
        vin = str(message_data.get("vin") or "—")

    requested_parts = build_requested_parts(message_data)
    contact_line = f"{phone} ({channel})" if channel else phone
    text = "\n".join(
        [
            "🆕 Новый заказ",
            f"🕒 Дата: {to_local_time(pick_first(row, ['created_at', 'updated_at'], default=''))}",
            f"👤 Клиент: {name}",
            f"📞 Контакт: {contact_line or '—'}",
            f"🚘 Авто: {car}",
            f"🔢 VIN: {vin or '—'}",
            f"🔧 Запрос: {requested_parts}",
        ]
    )
    reply_markup = build_reply_markup(row, channel, contact_value)
    car_photo = ""
    for candidate in [row.get("car_photo_url"), *(as_list(row.get("car_photos")))]:
        if isinstance(candidate, str) and candidate.startswith(("http://", "https://")):
            car_photo = candidate
            break
    return text, reply_markup, car_photo or None


def fetch_order_by_id(order_id: str) -> dict | None:
    params = urllib.parse.urlencode({"select": "*", "id": f"eq.{order_id}", "limit": "1"})
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/orders?{params}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
    }
    rows = http_json(url=url, method="GET", headers=headers, timeout=30)
    if isinstance(rows, list) and rows:
        return rows[0]
    return None


def send_order_media(chat_id: int, order_id: str):
    try:
        row = fetch_order_by_id(order_id)
        if not row:
            send_message(chat_id, "⚠️ Заказ не найден")
            return
        photos, audios = collect_media_urls(row)
        if not photos and not audios:
            send_message(chat_id, "ℹ️ Для этого заказа нет медиа")
            return
        for idx, photo_url in enumerate(photos, start=1):
            send_photo(chat_id, photo_url, caption=f"Фото {idx}/{len(photos)}")
        for idx, audio_url in enumerate(audios, start=1):
            send_document(chat_id, audio_url, caption=f"Аудио {idx}/{len(audios)}")
    except Exception as e:
        print(f"[MEDIA ERROR] order={order_id}: {e}")
        send_message(chat_id, "⚠️ Не удалось отправить медиа")


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
                    text, reply_markup, car_photo = format_notification(row)
                    if not subscribers:
                        continue
                    for chat_id in list(subscribers):
                        if car_photo:
                            send_photo(chat_id, car_photo, caption=text, reply_markup=reply_markup)
                        else:
                            send_message(chat_id, text, reply_markup=reply_markup)
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
    callback = upd.get("callback_query") or {}
    if callback:
        data = str(callback.get("data") or "")
        callback_id = callback.get("id")
        callback_chat_id = (((callback.get("message") or {}).get("chat") or {}).get("id"))
        if callback_id:
            try:
                tg_api("answerCallbackQuery", {"callback_query_id": callback_id})
            except Exception:
                pass
        if callback_chat_id is not None and data.startswith("media:"):
            send_order_media(int(callback_chat_id), data.split(":", 1)[1])
        return

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
                    "allowed_updates": ["message", "callback_query"],
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
