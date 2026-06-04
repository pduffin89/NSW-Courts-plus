#!/usr/bin/env python3
"""Verify service-level generation routing, defaults, PDFs, and audit entries."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TMP_ROOT = ROOT / ".tmp/service-generate-route"
OUTPUT_DIR = TMP_ROOT / "generated"
AUDIT_LOG = TMP_ROOT / "audit-log.jsonl"
CONFIG_PATH = TMP_ROOT / "profile.json"

sys.path.insert(0, str(ROOT))

from service.autofill.models import GenerateRequest, Matter, Profile  # noqa: E402
from scripts.verify_pdf_matrix import (  # noqa: E402
    MEDIA_CHECKBOX_RECTS,
    NON_PARTY_CHECKBOX_RECTS,
    acroform_field_count,
    count_annots,
    count_x_text_ops,
    field_count,
    missing_expected_x_positions,
    page_count,
    pdf_text,
    rendered_x_positions,
    unexpected_x_positions,
)


PROFILE = Profile(
    applicant_name="Perry Duffin",
    organisation="The Sydney Morning Herald",
    contact_number="0466 208 099",
    email="perry.duffin@example.com",
    occupation="Journalist",
)

DETAILS = {
    "transcript_dates": "1-2 June 2026",
    "exhibits": "Exhibit A and Exhibit B",
    "selected_images": "CCTV stills tendered in open court",
    "other": "Statement of agreed facts",
    "civil_pleading": "Statement of claim filed 4 June 2026",
    "civil_other_filed": "Notice of motion filed 4 June 2026",
    "additional_details": "Current proceedings, media access requested for reporting.",
}


def patch_service_paths():
    import service.autofill.config as config
    import service.autofill.orchestrator as orchestrator
    import service.autofill.storage as storage

    for module in (config, orchestrator, storage):
        if hasattr(module, "OUTPUT_ROOT"):
            module.OUTPUT_ROOT = OUTPUT_DIR
        if hasattr(module, "USER_OUTPUT_ROOT"):
            module.USER_OUTPUT_ROOT = OUTPUT_DIR
        if hasattr(module, "AUDIT_LOG_PATH"):
            module.AUDIT_LOG_PATH = AUDIT_LOG
        if hasattr(module, "CONFIG_PATH"):
            module.CONFIG_PATH = CONFIG_PATH
    orchestrator.MEDIA_FORM_PATH = ROOT / "extension/forms/access_application_2026.pdf"
    orchestrator.NON_PARTY_FORM_PATH = ROOT / "extension/forms/application_non_party_access.pdf"
    orchestrator.create_gmail_draft_with_attachments = lambda **_kwargs: "draft-test"
    return orchestrator


def assert_pdf(path: Path, expected_text: tuple[str, ...], checked: set[str], rects: dict) -> list[str]:
    text = pdf_text(path)
    x_positions = rendered_x_positions(path)
    failures = []
    missing_text = [item for item in expected_text if item and item not in text]
    missing_x = missing_expected_x_positions(checked, x_positions, rects)
    unexpected_x = unexpected_x_positions(checked, x_positions, rects)
    fields = field_count(path)
    acroform_fields = acroform_field_count(path)
    annots = count_annots(path)
    pages = page_count(path)
    x_ops = count_x_text_ops(path)
    if missing_text:
        failures.append(f"{path.name}: missing text: {', '.join(missing_text)}")
    if missing_x:
        failures.append(f"{path.name}: missing visual X at expected fields: {', '.join(missing_x)}")
    if unexpected_x:
        failures.append(f"{path.name}: unexpected visual X at unchecked fields: {', '.join(unexpected_x)}")
    if fields != 0:
        failures.append(f"{path.name}: PDF still has {fields} form fields")
    if acroform_fields != 0:
        failures.append(f"{path.name}: PDF catalog still has {acroform_fields} AcroForm field references")
    if annots != 0:
        failures.append(f"{path.name}: PDF still has {annots} annotations")
    expected_pages = 3 if rects is MEDIA_CHECKBOX_RECTS else 2
    if pages != expected_pages:
        failures.append(f"{path.name}: PDF page count {pages} does not match expected routed page count {expected_pages}")
    if x_ops < len(checked):
        failures.append(f"{path.name}: visual X count {x_ops} below expected minimum {len(checked)}")
    return failures


def audit_entries() -> list[dict]:
    return [json.loads(line) for line in AUDIT_LOG.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    if TMP_ROOT.exists():
        shutil.rmtree(TMP_ROOT)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    orchestrator = patch_service_paths()

    supreme_result = orchestrator.generate_forms_and_draft(
        GenerateRequest(
            matter=Matter(
                case_number="2026/500001",
                matter_name="R v Service Default Docs",
                court="Supreme Court",
                jurisdiction="Criminal",
                court_location="Sydney Supreme Court",
                plaintiff="R",
                defendant="Service Default Docs",
            ),
            profile=PROFILE,
            applications={"media_access_2026": True, "non_party_access": False},
            requested_documents=[],
            document_details=DETAILS,
        )
    )
    local_result = orchestrator.generate_forms_and_draft(
        GenerateRequest(
            matter=Matter(
                case_number="2026/500002",
                matter_name="R v Service Local Docs",
                court="Local Court",
                jurisdiction="Criminal",
                court_location="Downing Centre Local Court",
                plaintiff="R",
                defendant="Service Local Docs",
            ),
            profile=PROFILE,
            applications={"media_access_2026": True, "non_party_access": False},
            requested_documents=["police_fact_sheet"],
            document_details=DETAILS,
        )
    )

    failures = []
    supreme_pdf = Path(supreme_result["generated_files"][0])
    local_pdf = Path(local_result["generated_files"][0])
    failures.extend(
        assert_pdf(
            supreme_pdf,
            (
                "Perry Duffin",
                "P.Duffin",
                "The Sydney Morning Herald",
                "0466 208 099",
                "perry.duffin@example.com",
                "2026/500001",
                "R",
                "Service Default Docs",
                "1-2 June 2026",
                "Exhibit A and Exhibit B",
            ),
            {"Check Box50", "Check Box51", "Check Box52", "Check Box63", "Check Box64", "Check Box65"},
            MEDIA_CHECKBOX_RECTS,
        )
    )
    failures.extend(
        assert_pdf(
            local_pdf,
            (
                "Perry Duffin",
                "P.Duffin",
                "Journalist",
                "The Sydney Morning Herald",
                "0466 208 099",
                "perry.duffin@example.com",
                "2026/500002",
                "R v Service Local Docs",
                "Downing Centre Local Ct",
                "Current proceedings, media access requested for reporting.",
            ),
            {
                "Button1",
                "Button4",
                "Button6",
                "Button13",
                "Button37",
                "Button39",
                "Button40",
                "Button41",
                "Button42",
                "Button43",
                "Button44",
                "Button45",
                "Button46",
                "Button47",
            },
            NON_PARTY_CHECKBOX_RECTS,
        )
    )

    entries = audit_entries()
    if len(entries) != 2:
        failures.append(f"expected 2 audit entries, found {len(entries)}")
    else:
        if entries[0]["requested_documents"] != ["exhibits", "originating_process", "transcript"]:
            failures.append(f"supreme audit requested_documents mismatch: {entries[0]['requested_documents']}")
        if entries[0]["applications_effective"] != {"media_access_2026": True, "non_party_access": False}:
            failures.append(f"supreme applications_effective mismatch: {entries[0]['applications_effective']}")
        if entries[1]["requested_documents"] != ["police_fact_sheet"]:
            failures.append(f"local audit requested_documents mismatch: {entries[1]['requested_documents']}")
        if entries[1]["applications_effective"] != {"media_access_2026": False, "non_party_access": True}:
            failures.append(f"local applications_effective mismatch: {entries[1]['applications_effective']}")

    for failure in failures:
        print(f"FAIL {failure}")
    if failures:
        return 1
    print(f"PASS service generate route outputs={len(supreme_result['generated_files']) + len(local_result['generated_files'])} audit_entries={len(entries)}")
    print(f"output={OUTPUT_DIR}")
    print(f"audit={AUDIT_LOG}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
