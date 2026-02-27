from __future__ import annotations

import logging
import time
from typing import Any

import requests


LOGGER = logging.getLogger(__name__)


class SupabaseClient:
    def __init__(
        self,
        base_url: str,
        service_role_key: str,
        table_name: str,
        select_fields: str,
        order_by: str,
        limit: int,
        timeout_seconds: int = 15,
    ):
        self.base_url = base_url.rstrip("/")
        self.table_name = table_name
        self.select_fields = select_fields
        self.order_by = order_by
        self.limit = limit
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()
        self.session.headers.update(
            {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Accept": "application/json",
            }
        )

    def fetch_latest_rows(self, retries: tuple[int, ...] = (5, 15, 60)) -> list[dict[str, Any]]:
        params = {
            "select": self.select_fields,
            "order": self.order_by,
            "limit": str(self.limit),
        }
        url = f"{self.base_url}/rest/v1/{self.table_name}"

        for attempt in range(len(retries) + 1):
            try:
                response = self.session.get(url, params=params, timeout=self.timeout_seconds)
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, list):
                    raise RuntimeError("Unexpected response from Supabase")
                return payload
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                if attempt >= len(retries):
                    raise RuntimeError("Supabase fetch failed after retries") from exc
                delay = retries[attempt]
                LOGGER.warning("Supabase request failed (%s). retry in %ss", exc, delay)
                time.sleep(delay)

        return []
