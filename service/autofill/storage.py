import json
from pathlib import Path
from typing import Any, Optional

from .config import AUDIT_LOG_PATH, CONFIG_PATH, OUTPUT_ROOT
from .models import Profile


def ensure_dirs() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)


def load_profile() -> Optional[Profile]:
    if not CONFIG_PATH.exists():
        return None
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return Profile.model_validate(data)


def save_profile(profile: Profile) -> None:
    CONFIG_PATH.write_text(
        json.dumps(profile.model_dump(), indent=2, ensure_ascii=True),
        encoding="utf-8",
    )


def write_audit(payload: dict[str, Any]) -> None:
    line = json.dumps(payload, ensure_ascii=True)
    with AUDIT_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def path_exists(path: Path) -> bool:
    return path.exists()
