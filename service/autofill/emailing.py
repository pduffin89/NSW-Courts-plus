import base64
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode

from .config import GMAIL_OAUTH_CLIENT_FILE, GMAIL_TOKEN_FILE


def resolve_court_recipient(matter_court: str) -> tuple[str, str]:
    text = matter_court.lower()
    if "supreme" in text:
        return "media@courts.nsw.gov.au", "supreme"
    if "district" in text:
        return "mediadistrictcourt@dcj.nsw.gov.au", "district"
    if any(token in text for token in ("local", "children", "childrens", "coroner")):
        return "localcourtmedia@courts.nsw.gov.au", "local_children_coroner"
    return "media@courts.nsw.gov.au", "supreme"


def compose_gmail_url(to: str, subject: str, body: str) -> str:
    query = urlencode(
        {
            "view": "cm",
            "fs": "1",
            "to": to,
            "su": subject,
            "body": body,
        }
    )
    return f"https://mail.google.com/mail/?{query}"


def create_gmail_draft_with_attachments(
    *,
    to: str,
    subject: str,
    body: str,
    attachment_paths: list[Path],
) -> Optional[str]:
    if not GMAIL_OAUTH_CLIENT_FILE.exists():
        return None

    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError:
        return None

    scopes = ["https://www.googleapis.com/auth/gmail.compose"]
    creds: Optional["Credentials"] = None
    if GMAIL_TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(GMAIL_TOKEN_FILE), scopes)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                str(GMAIL_OAUTH_CLIENT_FILE), scopes
            )
            creds = flow.run_local_server(port=0)
        GMAIL_TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")

    mime = MIMEMultipart()
    mime["To"] = to
    mime["Subject"] = subject
    mime.attach(MIMEText(body, "plain", "utf-8"))

    for attachment in attachment_paths:
        payload = MIMEApplication(attachment.read_bytes(), Name=attachment.name)
        payload["Content-Disposition"] = f'attachment; filename="{attachment.name}"'
        mime.attach(payload)

    raw = base64.urlsafe_b64encode(mime.as_bytes()).decode("ascii")
    service = build("gmail", "v1", credentials=creds)
    created = (
        service.users()
        .drafts()
        .create(userId="me", body={"message": {"raw": raw}})
        .execute()
    )
    return created.get("id")

