from datetime import datetime, timedelta
from pathlib import Path
import secrets
from typing import Dict, Tuple, Optional

from .config import APP_TZ


_STORE: Dict[str, Tuple[Path, datetime]] = {}
_TTL_MINUTES = 20


def register(path: Path) -> str:
    token = secrets.token_urlsafe(18)
    expires = datetime.now(APP_TZ) + timedelta(minutes=_TTL_MINUTES)
    _STORE[token] = (path, expires)
    return token


def resolve(token: str) -> Optional[Path]:
    entry = _STORE.get(token)
    if not entry:
        return None
    path, expires = entry
    if datetime.now(APP_TZ) > expires:
        _STORE.pop(token, None)
        return None
    if not path.exists():
        _STORE.pop(token, None)
        return None
    return path

