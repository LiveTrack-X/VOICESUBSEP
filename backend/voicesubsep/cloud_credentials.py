"""Provider API keys live only in this application process, never in jobs or files."""
from __future__ import annotations

import re
import threading
import uuid

PROVIDERS = ("groq", "xai")


class ProviderCredentials:
    def __init__(self):
        self._keys: dict[str, str] = {}
        self._generations: dict[str, str] = {}
        self._lock = threading.RLock()

    def set_provider_key(self, provider: str, key: str) -> None:
        if provider not in PROVIDERS or not isinstance(key, str) or not re.fullmatch(r"[!-~]{12,512}", key):
            raise ValueError("API 키 형식이 올바르지 않습니다.")
        with self._lock:
            self._keys[provider] = key
            self._generations[provider] = uuid.uuid4().hex

    def get_provider_key(self, provider: str) -> str:
        with self._lock:
            key = self._keys.get(provider)
        if not key:
            raise ValueError("클라우드 API 키를 먼저 등록하세요. 키는 앱을 종료하면 지워집니다.")
        return key

    def bind_provider_key(self, provider: str, expected_generation: str | None = None):
        """Bind an authorized operation to this registration without keeping another key copy."""
        with self._lock:
            self.get_provider_key(provider)
            generation = self._generations.get(provider)
            if expected_generation is not None and generation != expected_generation:
                raise ValueError("API 키가 삭제되거나 변경되었습니다. 제공자를 확인하고 새 작업을 시작하세요.")

        def bound_key() -> str:
            with self._lock:
                if provider not in self._keys or self._generations.get(provider) != generation:
                    raise ValueError("API 키가 삭제되거나 변경되었습니다. 제공자를 확인하고 새 분석을 시작하세요.")
                return self._keys[provider]
        return bound_key

    def clear(self, provider: str | None = None) -> None:
        with self._lock:
            if provider is None:
                self._keys.clear()
                self._generations.clear()
            else:
                self._keys.pop(provider, None)
                self._generations.pop(provider, None)

    def status(self) -> dict:
        with self._lock:
            return {provider: {"configured": provider in self._keys,
                               **({"generation": self._generations[provider]} if provider in self._keys else {})}
                    for provider in PROVIDERS}
