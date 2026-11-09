"""Push keys (ADR-0010): each key belongs to one station and lets its holder push as that station.

A key is shown once, when it is made; the store keeps its SHA-256 only. Keys are high-entropy
random strings, so a plain hash is enough (no password hashing needed). Keys made on the keys
plate live in a JSON file on the gateway's volume; keys from `MARS_PUSH_KEYS` live in the
environment and can't be revoked from the display.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path

# The same pattern as the probe's and the agent's station names (ADR-0003).
STATION = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
PREFIX = "mars_"
NAME_MAX = 48


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass
class Key:
    id: str
    name: str
    station: str
    created: float
    hash: str
    source: str = "display"  # or "env": from MARS_PUSH_KEYS, not revocable

    def public(self) -> dict:
        d = asdict(self)
        del d["hash"]
        return d


def parse_env(text: str) -> list[Key]:
    """`MARS_PUSH_KEYS`: `<station>:<key>` pairs, separated by commas or whitespace."""
    keys = []
    for i, pair in enumerate(re.split(r"[\s,]+", text.strip())):
        if not pair:
            continue
        station, sep, token = pair.partition(":")
        if not sep or not STATION.match(station) or len(token) < 8:
            raise ValueError(f"MARS_PUSH_KEYS entry {i + 1}: want <station>:<key of 8+ characters>")
        name = f"{station} (environment)"
        keys.append(Key(f"env-{i + 1}", name, station, 0, digest(token), "env"))
    return keys


class KeyStore:
    """The keys of one gateway. Thread-safe; every change is written to `path` at once."""

    def __init__(self, path: str | os.PathLike | None, env: str = ""):
        self.path = Path(path) if path else None
        self._lock = threading.Lock()
        self._env = parse_env(env)
        self._keys: list[Key] = []
        if self.path and self.path.exists():
            self._keys = [Key(**k) for k in json.loads(self.path.read_text())["keys"]]
        self._index()

    def _index(self) -> None:
        self._by_hash = {k.hash: k for k in self._env + self._keys}

    def _save(self) -> None:
        if not self.path:
            return
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"keys": [asdict(k) for k in self._keys]}, indent=1))
        os.chmod(tmp, 0o600)
        tmp.replace(self.path)

    def all(self) -> list[Key]:
        with self._lock:
            return self._env + self._keys

    def check(self, token: str) -> Key | None:
        return self._by_hash.get(digest(token))

    def create(self, name: str, station: str) -> tuple[Key, str]:
        """A new key for `station`; returns it and the token, which is never shown again."""
        name = name.strip()
        if not name or len(name) > NAME_MAX:
            raise ValueError(f"name: 1 to {NAME_MAX} characters")
        if not STATION.match(station):
            raise ValueError("station: lower case letters, digits and dashes, max 32")
        token = PREFIX + secrets.token_urlsafe(24)
        key = Key(secrets.token_hex(4), name, station, round(time.time(), 3), digest(token))
        with self._lock:
            self._keys.append(key)
            self._save()
            self._index()
        return key, token

    def update_station(self, key_id: str, station: str) -> Key | None:
        """Change a display key's station without rotating its token."""
        if not STATION.match(station):
            raise ValueError("station: lower case letters, digits and dashes, max 32")
        with self._lock:
            key = next((k for k in self._keys if k.id == key_id), None)
            if key:
                old = key.station
                key.station = station
                try:
                    self._save()
                except OSError:
                    key.station = old
                    raise
            return key

    def revoke(self, key_id: str) -> Key | None:
        """Removes a key made on the display; None if there is none (env keys can't go)."""
        with self._lock:
            key = next((k for k in self._keys if k.id == key_id), None)
            if key:
                self._keys.remove(key)
                self._save()
                self._index()
            return key
