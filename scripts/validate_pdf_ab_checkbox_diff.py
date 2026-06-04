#!/usr/bin/env python3
"""Verify A/B checkbox determinism for a single requested document."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.verify_pdf_matrix import (  # noqa: E402
    NON_PARTY_CHECKBOX_RECTS,
    count_x_text_ops,
    missing_expected_x_positions,
    rendered_x_positions,
    unexpected_x_positions,
)


CASES = (
    (
        "service_local_police_fact_sheet",
        ROOT / ".tmp/pdf-matrix/exhaustive_local_crime_none.pdf",
        ROOT / ".tmp/pdf-matrix/exhaustive_local_crime_police_fact_sheet.pdf",
    ),
    (
        "extension_local_police_fact_sheet",
        ROOT / ".tmp/extension-pdf-matrix/extension_exhaustive_local_crime_none.pdf",
        ROOT / ".tmp/extension-pdf-matrix/extension_exhaustive_local_crime_police_fact_sheet.pdf",
    ),
)

BASE_CHECKED = {
    "Button1",
    "Button4",
    "Button6",
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
}
ADDED_CHECKED = BASE_CHECKED | {"Button13"}


def verify_pair(label: str, base_path: Path, added_path: Path) -> list[str]:
    failures: list[str] = []
    if not base_path.exists():
        failures.append(f"{label}: missing base PDF {base_path}")
    if not added_path.exists():
        failures.append(f"{label}: missing added-doc PDF {added_path}")
    if failures:
        return failures

    base_x = count_x_text_ops(base_path)
    added_x = count_x_text_ops(added_path)
    if added_x - base_x != 1:
        failures.append(f"{label}: expected exactly one additional X, got base={base_x} added={added_x}")

    base_positions = rendered_x_positions(base_path)
    added_positions = rendered_x_positions(added_path)
    base_missing = missing_expected_x_positions(BASE_CHECKED, base_positions, NON_PARTY_CHECKBOX_RECTS)
    base_unexpected = unexpected_x_positions(BASE_CHECKED, base_positions, NON_PARTY_CHECKBOX_RECTS)
    added_missing = missing_expected_x_positions(ADDED_CHECKED, added_positions, NON_PARTY_CHECKBOX_RECTS)
    added_unexpected = unexpected_x_positions(ADDED_CHECKED, added_positions, NON_PARTY_CHECKBOX_RECTS)
    if base_missing:
        failures.append(f"{label}: base missing expected X fields: {', '.join(base_missing)}")
    if base_unexpected:
        failures.append(f"{label}: base has unexpected X fields: {', '.join(base_unexpected)}")
    if added_missing:
        failures.append(f"{label}: added-doc missing expected X fields: {', '.join(added_missing)}")
    if added_unexpected:
        failures.append(f"{label}: added-doc has unexpected X fields: {', '.join(added_unexpected)}")
    return failures


def main() -> int:
    failures = []
    for label, base_path, added_path in CASES:
        failures.extend(verify_pair(label, base_path, added_path))
    for failure in failures:
        print(f"FAIL {failure}")
    if failures:
        return 1
    print("PASS A/B checkbox diff police_fact_sheet adds exactly one rendered X in service and extension PDFs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
