#!/usr/bin/env python3
"""Generate and inspect representative NSW Courts+ PDF combinations."""

from __future__ import annotations

import json
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from service.autofill.pdf_forms import (  # noqa: E402
    MANUAL_CHECK_OVERLAY_KEY,
    MEDIA_DOC_TO_FIELD,
    NON_PARTY_FIELD_FONT_SIZES,
    fill_pdf,
    media_2026_values,
    non_party_values,
)
from service.autofill.models import Matter, Profile  # noqa: E402


MEDIA_TEMPLATE = ROOT / "extension/forms/access_application_2026.pdf"
NON_PARTY_TEMPLATE = ROOT / "extension/forms/application_non_party_access.pdf"
OUT_DIR = ROOT / ".tmp/pdf-matrix"

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

MEDIA_REASON_PHRASE = "significant public interest in accredited media"


@dataclass(frozen=True)
class PdfCase:
    name: str
    template: Path
    matter: Matter
    docs: set[str]
    expected_text: tuple[str, ...]
    forbidden_text: tuple[str, ...] = ()
    expected_checked_fields: tuple[str, ...] = ()
    expected_manual_overlays: tuple[str, ...] = ()
    values_kind: str = "non_party"


def template_checkbox_rects(path: Path) -> dict[str, tuple[int, tuple[float, float, float, float]]]:
    reader = PdfReader(str(path))
    rects: dict[str, tuple[int, tuple[float, float, float, float]]] = {}
    for page_index, page in enumerate(reader.pages):
        for ref in page.get("/Annots") or []:
            widget = ref.get_object()
            parent = widget.get("/Parent")
            parent_obj = parent.get_object() if parent else None
            field_type = widget.get("/FT") or (parent_obj and parent_obj.get("/FT"))
            name = widget.get("/T") or (parent_obj and parent_obj.get("/T"))
            if str(field_type) != "/Btn" or name is None:
                continue
            raw_rect = widget.get("/Rect")
            if not raw_rect or len(raw_rect) < 4:
                continue
            x0, y0, x1, y1 = [float(value) for value in raw_rect]
            rects[str(name)] = (page_index, (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)))
    return rects


MEDIA_CHECKBOX_RECTS = template_checkbox_rects(MEDIA_TEMPLATE)
NON_PARTY_CHECKBOX_RECTS = template_checkbox_rects(NON_PARTY_TEMPLATE)
MANUAL_OVERLAY_RECTS: dict[str, tuple[int, tuple[float, float, float, float]]] = {
    "non_party_district_civil": (0, (241.125, 608.2188, 249.0, 614.9688)),
}


def normalize_text(value: str) -> str:
    return " ".join((value or "").split())


def pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    return normalize_text("\n".join(page.extract_text() or "" for page in reader.pages))


def count_annots(path: Path) -> int:
    reader = PdfReader(str(path))
    return sum(len(page.get("/Annots") or []) for page in reader.pages)


def field_count(path: Path) -> int:
    return len(PdfReader(str(path)).get_fields() or {})


def count_x_text_ops(path: Path) -> int:
    text = "\n".join(page.extract_text() or "" for page in PdfReader(str(path)).pages)
    return sum(1 for token in text.replace("\r", "\n").split() if token == "X")


def rendered_x_positions(path: Path) -> list[tuple[int, float, float]]:
    reader = PdfReader(str(path))
    positions: list[tuple[int, float, float]] = []
    for page_index, page in enumerate(reader.pages):
        contents = page.get_contents()
        if contents is None:
            continue
        stream = ContentStream(contents, reader)
        current_text_matrix: tuple[float, float] | None = None
        for operands, operator in stream.operations:
            if operator == b"Tm" and len(operands) >= 6:
                try:
                    current_text_matrix = (float(operands[4]), float(operands[5]))
                except (TypeError, ValueError):
                    current_text_matrix = None
            elif operator in (b"Tj", b"'", b'"') and len(operands) > 0 and str(operands[0]) == "X":
                if current_text_matrix is not None:
                    positions.append((page_index, current_text_matrix[0], current_text_matrix[1]))
            elif operator == b"TJ" and current_text_matrix is not None:
                if any(str(item) == "X" for item in operands[0]):
                    positions.append((page_index, current_text_matrix[0], current_text_matrix[1]))
    return positions


def rect_for_overlay(
    name: str,
    checkbox_rects: dict[str, tuple[int, tuple[float, float, float, float]]],
) -> tuple[int, tuple[float, float, float, float]] | None:
    if name in checkbox_rects:
        return checkbox_rects[name]
    return MANUAL_OVERLAY_RECTS.get(name)


def position_in_rect(position: tuple[int, float, float], rect_ref: tuple[int, tuple[float, float, float, float]]) -> bool:
    page_index, x, y = position
    rect_page, (left, bottom, right, top) = rect_ref
    pad = 2.5
    return (
        page_index == rect_page
        and left - pad <= x <= right + pad
        and bottom - pad <= y <= top + pad
    )


def missing_expected_x_positions(
    expected_names: set[str],
    positions: list[tuple[int, float, float]],
    checkbox_rects: dict[str, tuple[int, tuple[float, float, float, float]]],
) -> list[str]:
    missing = []
    for name in sorted(expected_names):
        rect_ref = rect_for_overlay(name, checkbox_rects)
        if rect_ref is None:
            missing.append(name)
            continue
        if not any(position_in_rect(position, rect_ref) for position in positions):
            missing.append(name)
    return missing


def unexpected_x_positions(
    allowed_names: set[str],
    positions: list[tuple[int, float, float]],
    checkbox_rects: dict[str, tuple[int, tuple[float, float, float, float]]],
) -> list[str]:
    unexpected = []
    for name, rect_ref in sorted(checkbox_rects.items()):
        if name in allowed_names:
            continue
        if any(position_in_rect(position, rect_ref) for position in positions):
            unexpected.append(name)
    return unexpected


def expected_short_date() -> str:
    now = datetime.now().astimezone()
    return f"{now.day}/{now.month}/{now.year}"


def expected_long_date() -> str:
    now = datetime.now().astimezone()
    return f"{now.day} {now.strftime('%B %Y')}"


def build_cases() -> list[PdfCase]:
    media_matter = Matter(
        case_number="2026/100001",
        matter_name="R v Alexandra Example",
        court="Supreme Court",
        jurisdiction="Criminal",
        court_location="Sydney Supreme Court",
        plaintiff="R",
        defendant="Alexandra Example",
    )
    local_crime = Matter(
        case_number="2026/200001",
        matter_name="R v Benjamin Crime",
        court="Local Court",
        jurisdiction="Criminal",
        court_location="Downing Centre Local Court",
        plaintiff="R",
        defendant="Benjamin Crime",
    )
    district_crime = Matter(
        case_number="2026/200002",
        matter_name="R v Charlotte District",
        court="District Court",
        jurisdiction="Criminal",
        court_location="Sydney District Court",
        plaintiff="R",
        defendant="Charlotte District",
    )
    children_crime = Matter(
        case_number="2026/200003",
        matter_name="R v Child Example",
        court="Children's Court",
        jurisdiction="Criminal",
        court_location="Parramatta Children's Court",
        plaintiff="R",
        defendant="Child Example",
    )
    coroner_crime = Matter(
        case_number="2026/200004",
        matter_name="Inquest into Example",
        court="Coroner's Court",
        jurisdiction="Criminal",
        court_location="Lidcombe Coroner's Court",
    )
    local_civil = Matter(
        case_number="2026/300001",
        matter_name="Acme Pty Ltd v Beta Pty Ltd",
        court="Local Court",
        jurisdiction="Civil",
        court_location="Downing Centre Local Court Civil",
        plaintiff="Acme Pty Ltd",
        defendant="Beta Pty Ltd",
    )
    district_civil = Matter(
        case_number="2026/300002",
        matter_name="Gamma Pty Ltd v Delta Pty Ltd",
        court="District Court",
        jurisdiction="Civil",
        court_location="Sydney District Court Civil",
        plaintiff="Gamma Pty Ltd",
        defendant="Delta Pty Ltd",
    )

    media_base = (PROFILE.applicant_name, PROFILE.organisation, "2026/100001", "R", "Alexandra Example", expected_long_date(), MEDIA_REASON_PHRASE)
    cases: list[PdfCase] = [
        PdfCase(
            name="supreme_bail_all",
            template=MEDIA_TEMPLATE,
            matter=media_matter,
            docs={"crown_bundle", "submissions", "selected_images"},
            expected_text=media_base + (DETAILS["selected_images"],),
            expected_checked_fields=("Check Box39", "Check Box40", "Check Box41", "Check Box63", "Check Box64", "Check Box65"),
            values_kind="media",
        ),
        PdfCase(
            name="supreme_general_all",
            template=MEDIA_TEMPLATE,
            matter=media_matter,
            docs={"originating_process", "transcript", "exhibits", "notice_of_appeal", "other"},
            expected_text=media_base + (DETAILS["transcript_dates"], DETAILS["exhibits"], DETAILS["other"]),
            expected_checked_fields=("Check Box50", "Check Box51", "Check Box52", "Check Box53", "Check Box54", "Check Box63", "Check Box64", "Check Box65"),
            values_kind="media",
        ),
        PdfCase(
            name="local_crime_all",
            template=NON_PARTY_TEMPLATE,
            matter=local_crime,
            docs={"indictment_can", "witness_statements", "police_fact_sheet", "transcript", "record_conviction_or_order", "other"},
            expected_text=(PROFILE.applicant_name, "P.Duffin", "2026/200001", "R v Benjamin Crime", "Downing Centre Local Ct", DETAILS["transcript_dates"], DETAILS["other"], expected_short_date()),
            forbidden_text=("John Smith", "{GENERATED SIGNATURE}", "13/2/2026"),
            expected_checked_fields=("Button1", "Button4", "Button6", "Button11", "Button12", "Button13", "Button14", "Button15", "Button16", "Button37", "Button39", "Button40", "Button41", "Button42", "Button43", "Button44", "Button45", "Button46", "Button47"),
        ),
        PdfCase(
            name="district_crime_all",
            template=NON_PARTY_TEMPLATE,
            matter=district_crime,
            docs={"indictment_can", "witness_statements", "police_fact_sheet", "transcript", "record_conviction_or_order", "other"},
            expected_text=(PROFILE.applicant_name, "P.Duffin", "2026/200002", "R v Charlotte District", "Sydney District Ct", DETAILS["transcript_dates"], DETAILS["other"], expected_short_date()),
            forbidden_text=("John Smith", "{GENERATED SIGNATURE}", "13/2/2026"),
            expected_checked_fields=("Button1", "Button4", "Button7", "Button11", "Button12", "Button13", "Button14", "Button15", "Button16", "Button37", "Button39", "Button40", "Button41", "Button42", "Button43", "Button44", "Button45", "Button46", "Button47"),
        ),
        PdfCase(
            name="children_crime_core",
            template=NON_PARTY_TEMPLATE,
            matter=children_crime,
            docs={"police_fact_sheet", "record_conviction_or_order"},
            expected_text=(PROFILE.applicant_name, "P.Duffin", "2026/200003", "R v Child Example", "Parramatta Children's Ct", expected_short_date()),
            forbidden_text=("John Smith", "{GENERATED SIGNATURE}", "13/2/2026"),
            expected_checked_fields=("Button1", "Button4", "Button8", "Button13", "Button15", "Button37", "Button39", "Button40", "Button41", "Button42", "Button43", "Button44", "Button45", "Button46", "Button47"),
        ),
        PdfCase(
            name="coroner_crime_core",
            template=NON_PARTY_TEMPLATE,
            matter=coroner_crime,
            docs={"transcript", "other"},
            expected_text=(PROFILE.applicant_name, "P.Duffin", "2026/200004", "Inquest into Example", "Lidcombe Coroner's Ct", DETAILS["transcript_dates"], DETAILS["other"], expected_short_date()),
            forbidden_text=("John Smith", "{GENERATED SIGNATURE}", "13/2/2026"),
            expected_checked_fields=("Button1", "Button4", "Button6", "Button14", "Button16", "Button37", "Button39", "Button40", "Button41", "Button42", "Button43", "Button44", "Button45", "Button46", "Button47"),
        ),
        PdfCase(
            name="local_civil_all",
            template=NON_PARTY_TEMPLATE,
            matter=local_civil,
            docs={"sealed_copy_judgment", "certified_copy_reasons", "civil_pleading", "civil_other_filed"},
            expected_text=(PROFILE.applicant_name, "P.Duffin", "2026/300001", "Acme Pty Ltd v Beta Pty Ltd", "Local Ct", DETAILS["civil_pleading"], DETAILS["civil_other_filed"], expected_short_date()),
            forbidden_text=("John Smith", "{GENERATED SIGNATURE}", "13/2/2026"),
            expected_checked_fields=("Button1", "Button4", "Button10", "Button17", "Button18", "Button20", "Button21", "Button37", "Button39", "Button40", "Button41", "Button42", "Button43", "Button44", "Button45", "Button46", "Button47"),
        ),
        PdfCase(
            name="district_civil_all",
            template=NON_PARTY_TEMPLATE,
            matter=district_civil,
            docs={"sealed_copy_judgment", "certified_copy_reasons", "civil_pleading", "civil_other_filed"},
            expected_text=(PROFILE.applicant_name, "P.Duffin", "2026/300002", "Gamma Pty Ltd v Delta Pty Ltd", "Sydney District Ct Civil", DETAILS["civil_pleading"], DETAILS["civil_other_filed"], expected_short_date()),
            forbidden_text=("John Smith", "{GENERATED SIGNATURE}", "13/2/2026"),
            expected_checked_fields=("Button1", "Button4", "Button17", "Button18", "Button20", "Button21", "Button37", "Button39", "Button40", "Button41", "Button42", "Button43", "Button44", "Button45", "Button46", "Button47"),
            expected_manual_overlays=("non_party_district_civil",),
        ),
    ]
    return cases


def values_for(case: PdfCase) -> dict[str, Any]:
    if case.values_kind == "media":
        return media_2026_values(PROFILE, case.matter, case.docs, DETAILS)
    return non_party_values(PROFILE, case.matter, case.docs, DETAILS)


def verify_case(case: PdfCase) -> dict[str, Any]:
    values = values_for(case)
    checkbox_rects = MEDIA_CHECKBOX_RECTS if case.values_kind == "media" else NON_PARTY_CHECKBOX_RECTS
    expected_checked = set(case.expected_checked_fields)
    expected_manual = set(case.expected_manual_overlays)
    expected_overlay_names = expected_checked | expected_manual

    actual_checked = {name for name in expected_checked if values.get(name)}
    missing_value_checks = sorted(expected_checked - actual_checked)
    unexpected_district_crime = case.name == "district_civil_all" and bool(values.get("Button7"))
    manual = tuple(values.get(MANUAL_CHECK_OVERLAY_KEY) or ())
    missing_manual = sorted(expected_manual - set(manual))

    output = OUT_DIR / f"{case.name}.pdf"
    fill_pdf(
        case.template,
        output,
        values,
        NON_PARTY_FIELD_FONT_SIZES if case.values_kind != "media" else None,
    )

    text = pdf_text(output)
    missing_text = [item for item in case.expected_text if item and item not in text]
    forbidden_text = [item for item in case.forbidden_text if item and item in text]
    fields = field_count(output)
    annots = count_annots(output)
    x_ops = count_x_text_ops(output)
    x_positions = rendered_x_positions(output)
    expected_min_x = len(expected_overlay_names)
    missing_x_positions = missing_expected_x_positions(expected_overlay_names, x_positions, checkbox_rects)
    unexpected_x_fields = unexpected_x_positions(expected_overlay_names, x_positions, checkbox_rects)

    failures = []
    if missing_value_checks:
        failures.append(f"missing checked values: {', '.join(missing_value_checks)}")
    if missing_manual:
        failures.append(f"missing manual overlays: {', '.join(missing_manual)}")
    if unexpected_district_crime:
        failures.append("District Civil incorrectly ticks Button7 / District Court Crime")
    if missing_text:
        failures.append(f"missing text: {', '.join(missing_text)}")
    if forbidden_text:
        failures.append(f"forbidden stale text present: {', '.join(forbidden_text)}")
    if fields != 0:
        failures.append(f"PDF still has {fields} form fields")
    if annots != 0:
        failures.append(f"PDF still has {annots} annotations")
    if x_ops < expected_min_x:
        failures.append(f"visual X count {x_ops} below expected minimum {expected_min_x}")
    if missing_x_positions:
        failures.append(f"missing visual X at expected fields: {', '.join(missing_x_positions)}")
    if unexpected_x_fields:
        failures.append(f"unexpected visual X at unchecked fields: {', '.join(unexpected_x_fields)}")

    return {
        "case": case.name,
        "output": str(output),
        "fields": fields,
        "annots": annots,
        "x_ops": x_ops,
        "expected_min_x": expected_min_x,
        "x_positions": x_positions,
        "manual_overlays": list(manual),
        "ok": not failures,
        "failures": failures,
    }


def main() -> int:
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    results = [verify_case(case) for case in build_cases()]
    summary_path = OUT_DIR / "summary.json"
    summary_path.write_text(json.dumps(results, indent=2) + "\n")

    failed = [result for result in results if not result["ok"]]
    for result in results:
        status = "PASS" if result["ok"] else "FAIL"
        print(f"{status} {result['case']} fields={result['fields']} annots={result['annots']} x_ops={result['x_ops']}")
        for failure in result["failures"]:
            print(f"  - {failure}")
    print(f"summary={summary_path}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
