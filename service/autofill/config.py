import os
from pathlib import Path
from zoneinfo import ZoneInfo


APP_TZ = ZoneInfo(os.environ.get("AUTOFILL_TZ", "Australia/Sydney"))

# Keep defaults under the app folder to avoid macOS Documents permissions issues
# when running as a LaunchAgent service.
APP_HOME = Path(
    os.environ.get(
        "AUTOFILL_APP_HOME", str(Path.home() / "Applications" / "NSW Court Autofill")
    )
).expanduser()
DATA_ROOT = Path(os.environ.get("AUTOFILL_DATA_ROOT", str(APP_HOME / "data"))).expanduser()
USER_DOCS_ROOT = Path.home() / "Documents"
USER_OUTPUT_ROOT = Path(
    os.environ.get(
        "AUTOFILL_USER_OUTPUT_ROOT",
        str(USER_DOCS_ROOT / "Court Application Forms" / "Generated"),
    )
).expanduser()

LEGACY_FORM_ROOT = Path.home() / "Documents" / "Court Application Forms"
DEFAULT_FORM_ROOT = DATA_ROOT / "forms"
FORM_ROOT = Path(
    os.environ.get("AUTOFILL_FORM_ROOT", str(DEFAULT_FORM_ROOT))
).expanduser()

OUTPUT_ROOT = Path(
    os.environ.get("AUTOFILL_OUTPUT_ROOT", str(DATA_ROOT / "Generated"))
).expanduser()
CONFIG_PATH = Path(
    os.environ.get("AUTOFILL_CONFIG_PATH", str(DATA_ROOT / "profile.json"))
).expanduser()
AUDIT_LOG_PATH = Path(
    os.environ.get("AUTOFILL_AUDIT_LOG_PATH", str(OUTPUT_ROOT / "audit-log.jsonl"))
).expanduser()


def _fallback_path(env_name: str, preferred: Path, legacy: Path) -> Path:
    explicit = os.environ.get(env_name)
    if explicit:
        return Path(explicit).expanduser()
    if preferred.exists():
        return preferred
    if legacy.exists():
        return legacy
    return preferred


MEDIA_FORM_PATH = _fallback_path(
    "AUTOFILL_MEDIA_FORM_PATH",
    FORM_ROOT / "access_application_2026.pdf",
    LEGACY_FORM_ROOT / "access_application_2026.pdf",
)
NON_PARTY_FORM_PATH = _fallback_path(
    "AUTOFILL_NON_PARTY_FORM_PATH",
    FORM_ROOT / "Application by non-party for access to court file.pdf",
    LEGACY_FORM_ROOT / "Application by non-party for access to court file.pdf",
)

GMAIL_OAUTH_CLIENT_FILE = Path(
    os.environ.get(
        "GMAIL_OAUTH_CLIENT_FILE", str(DATA_ROOT / "gmail-oauth-client.json")
    )
).expanduser()
GMAIL_TOKEN_FILE = Path(
    os.environ.get("GMAIL_TOKEN_FILE", str(DATA_ROOT / ".gmail-token.json"))
).expanduser()

EMAIL_BODY = (
    "Hey folks\n"
    "Can I please get the latest outcomes, next dates, NPOs or any other orders, suburb and YOB.\n"
    "Applying for the following docs as well.\n"
    "Thanks heaps"
)

DEFAULT_REQUESTED_DOCS = {"originating_process", "transcript", "exhibits"}

MEDIA_DOC_TO_FIELD = {
    "crown_bundle": "Check Box39",
    "submissions": "Check Box40",
    "selected_images": "Check Box41",
    "originating_process": "Check Box50",
    "transcript": "Check Box51",
    "exhibits": "Check Box52",
    "notice_of_appeal": "Check Box53",
    "other": "Check Box54",
}

NON_PARTY_ACK_FIELDS = [
    "Button39",
    "Button40",
    "Button41",
    "Button42",
    "Button43",
    "Button44",
    "Button45",
    "Button46",
    "Button47",
]
