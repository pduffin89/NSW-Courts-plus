#!/usr/bin/env python3
"""Verify content-script requested-document options match PDF-supported keys."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "extension/content.js"

sys.path.insert(0, str(ROOT))

from scripts.verify_pdf_matrix import (  # noqa: E402
    NON_PARTY_CIVIL_DOCS,
    NON_PARTY_CRIME_DOCS,
    SUPREME_BAIL_DOCS,
    SUPREME_GENERAL_DOCS,
)


EXPECTED = {
    "SUPREME_BAIL_DOC_OPTIONS": set(SUPREME_BAIL_DOCS),
    "SUPREME_ALL_DOC_OPTIONS": set(SUPREME_GENERAL_DOCS),
    "NON_PARTY_CRIME_DOC_OPTIONS": set(NON_PARTY_CRIME_DOCS),
    "NON_PARTY_CIVIL_DOC_OPTIONS": set(NON_PARTY_CIVIL_DOCS),
}


def option_keys(source: str, const_name: str) -> set[str]:
    match = re.search(rf"const\s+{re.escape(const_name)}\s*=\s*\[(.*?)\];", source, re.S)
    if not match:
        raise ValueError(f"missing {const_name}")
    return set(re.findall(r'key:\s*"([^"]+)"', match.group(1)))


def main() -> int:
    source = CONTENT.read_text(encoding="utf-8")
    failures = []
    for const_name, expected in EXPECTED.items():
        actual = option_keys(source, const_name)
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        if missing:
            failures.append(f"{const_name} missing supported keys: {', '.join(missing)}")
        if extra:
            failures.append(f"{const_name} has unsupported keys: {', '.join(extra)}")
    for failure in failures:
        print(f"FAIL {failure}")
    if failures:
        return 1
    print("PASS content document options match PDF-supported keys")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
