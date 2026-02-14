from datetime import datetime
from pathlib import Path
from typing import Any
import re

from fastapi import HTTPException

from .attachments import register
from .config import (
    APP_TZ,
    CONFIG_PATH,
    DEFAULT_REQUESTED_DOCS,
    EMAIL_BODY,
    FORM_ROOT,
    MEDIA_FORM_PATH,
    NON_PARTY_FORM_PATH,
    OUTPUT_ROOT,
    USER_OUTPUT_ROOT,
)
from .emailing import (
    compose_gmail_url,
    create_gmail_draft_with_attachments,
    resolve_court_recipient,
)
from .models import GenerateRequest
from .pdf_forms import (
    NON_PARTY_FIELD_FONT_SIZES,
    fill_pdf,
    media_2026_values,
    non_party_values,
    slug,
)
from .storage import ensure_dirs, load_profile, path_exists, save_profile, write_audit


def _normalize_matter_name(case_number: str, matter_name: str) -> str:
    text = " ".join((matter_name or "").split()).strip()
    if not text:
        return case_number

    text = re.sub(rf"^\s*{re.escape(case_number)}\s*", "", text).strip()
    text = re.sub(
        r"^\s*[A-Za-z]{3}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    text = re.sub(
        r"^\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    text = re.sub(rf"^\s*{re.escape(case_number)}\s*", "", text).strip()
    text = re.sub(
        r"\s+(Criminal|Civil)\s+(Local Court|District Court|Supreme Court).*$",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()

    if not text:
        return case_number
    return text


def _effective_applications(court_text: str, requested: dict[str, bool]) -> dict[str, bool]:
    lower_court = (court_text or "").lower()
    is_supreme = "supreme" in lower_court
    media_selected = bool(requested.get("media_access_2026", True))
    non_party_selected = bool(requested.get("non_party_access", False))

    if not is_supreme and media_selected:
        media_selected = False
        non_party_selected = True

    return {
        "media_access_2026": media_selected,
        "non_party_access": non_party_selected,
    }


def _effective_requested_docs(
    court_text: str, jurisdiction_text: str, requested_docs: set[str]
) -> set[str]:
    court = (court_text or "").lower()
    jurisdiction = (jurisdiction_text or "").lower()
    if "local" in court and "criminal" in jurisdiction:
        # Match the validated local-court exemplar by default.
        return {"indictment_can"}
    return requested_docs


def generate_forms_and_draft(request: GenerateRequest) -> dict[str, Any]:
    ensure_dirs()

    profile = request.profile or load_profile()
    if request.profile:
        try:
            save_profile(request.profile)
        except OSError:
            # Do not block generation if profile persistence fails.
            pass
    if not profile:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "PROFILE_MISSING",
                "message": (
                    "Profile missing. Set applicant details in the extension drawer "
                    f"or create {CONFIG_PATH}."
                ),
            },
        )

    requested_docs = set(request.requested_documents) or set(DEFAULT_REQUESTED_DOCS)
    matter = request.matter
    requested_docs = _effective_requested_docs(
        matter.court, matter.jurisdiction, requested_docs
    )
    now = datetime.now(APP_TZ)
    stamp = now.strftime("%Y%m%d_%H%M%S")
    safe_case = slug(matter.case_number)
    safe_name = slug(matter.matter_name)[:60]

    generated_files: list[str] = []
    attachment_paths: list[Path] = []

    applications = _effective_applications(matter.court, request.applications)

    if applications.get("media_access_2026", True) and not path_exists(MEDIA_FORM_PATH):
        raise HTTPException(
            status_code=500,
            detail=(
                f"Missing media form template: {MEDIA_FORM_PATH}. "
                f"Place the file in {FORM_ROOT}."
            ),
        )
    if applications.get("non_party_access", False) and not path_exists(NON_PARTY_FORM_PATH):
        raise HTTPException(
            status_code=500,
            detail=(
                f"Missing non-party form template: {NON_PARTY_FORM_PATH}. "
                f"Place the file in {FORM_ROOT}."
            ),
        )

    if applications.get("media_access_2026", True):
        media_output = OUTPUT_ROOT / f"{stamp}_{safe_case}_{safe_name}_media_access_2026.pdf"
        try:
            fill_pdf(
                MEDIA_FORM_PATH,
                media_output,
                media_2026_values(profile, matter, requested_docs, request.document_details),
            )
        except PermissionError as exc:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Cannot read media form template: {MEDIA_FORM_PATH}. "
                    f"Move templates to {FORM_ROOT}. ({exc})"
                ),
            ) from exc
        generated_files.append(str(media_output))
        attachment_paths.append(media_output)

    if applications.get("non_party_access", False):
        non_party_output = OUTPUT_ROOT / f"{stamp}_{safe_case}_{safe_name}_non_party_access.pdf"
        try:
            fill_pdf(
                NON_PARTY_FORM_PATH,
                non_party_output,
                non_party_values(profile, matter, requested_docs, request.document_details),
                field_font_sizes=NON_PARTY_FIELD_FONT_SIZES,
            )
        except PermissionError as exc:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Cannot read non-party form template: {NON_PARTY_FORM_PATH}. "
                    f"Move templates to {FORM_ROOT}. ({exc})"
                ),
            ) from exc
        generated_files.append(str(non_party_output))
        attachment_paths.append(non_party_output)

    if not generated_files:
        raise HTTPException(status_code=400, detail="No forms selected for generation.")

    recipient, court_key = resolve_court_recipient(matter.court)
    subject_matter = _normalize_matter_name(matter.case_number, matter.matter_name)
    subject = f"{matter.case_number} {subject_matter}".strip()
    compose_url = compose_gmail_url(recipient, subject, EMAIL_BODY)
    draft_id = create_gmail_draft_with_attachments(
        to=recipient,
        subject=subject,
        body=EMAIL_BODY,
        attachment_paths=attachment_paths,
    )
    open_email_url = (
        "https://mail.google.com/mail/u/0/#drafts" if draft_id else compose_url
    )

    attachment_urls = [
        {
            "name": path.name,
            "url": f"http://127.0.0.1:8765/attachment/{register(path)}",
        }
        for path in attachment_paths
    ]

    write_audit(
        {
            "timestamp": now.isoformat(),
            "court": matter.court,
            "court_routing_key": court_key,
            "case_number": matter.case_number,
            "matter_name": matter.matter_name,
            "recipient": recipient,
            "subject": subject,
            "requested_documents": sorted(requested_docs),
            "generated_files": generated_files,
            "applications_effective": applications,
            "gmail_draft_id": draft_id,
        }
    )

    return {
        "generated_files": generated_files,
        "output_folder": str(USER_OUTPUT_ROOT),
        "attachment_urls": attachment_urls,
        "email_to": recipient,
        "email_subject": subject,
        "email_body": EMAIL_BODY,
        "gmail_compose_url": compose_url,
        "gmail_draft_id": draft_id,
        "open_email_url": open_email_url,
    }
