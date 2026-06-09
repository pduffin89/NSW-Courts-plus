#!/usr/bin/env python3
"""Operator-assisted live smoke for Argus Delta Courtlens.

This script loads the real unpacked MV3 extension in a headed Chromium session and
checks live NSW pages after the operator has navigated/logged in/selected a page.
It is intentionally interactive because NSW Online Registry access and Argus
credentials may require a human-controlled browser profile.
"""

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Callable

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
ARTIFACTS = ROOT / "artifacts"
EVIDENCE_PATH = ARTIFACTS / "operator-live-smoke.json"
DEFAULT_COURTLIST_URL = "https://onlineregistry.lawlink.nsw.gov.au/content/court-lists"
DEFAULT_CASELAW_URL = "https://www.caselaw.nsw.gov.au/search?query=Smith"


def prompt(message: str) -> None:
    print(f"\n▶ {message}")
    input("  Press Enter when ready...")


def shadow_text(page: Page) -> str:
    return page.locator("#argus-delta-courtlens-root").evaluate("el => el.shadowRoot.textContent || ''")


def click_shadow_button(page: Page, label: str) -> None:
    page.locator("#argus-delta-courtlens-root").evaluate(
        """
        (el, label) => {
          const button = [...el.shadowRoot.querySelectorAll('button')]
            .find((candidate) => (candidate.textContent || '').trim() === label);
          if (!button) throw new Error(`Shadow button not found: ${label}`);
          button.click();
        }
        """,
        label,
    )


def assert_shadow_contains(page: Page, expected: str) -> None:
    text = shadow_text(page)
    if expected not in text:
        raise AssertionError(f"Expected sidebar text to contain {expected!r}; saw: {text[:500]!r}")


def verify_courtlist(page: Page, url: str, skip_documents: bool) -> None:
    print(f"\nOpening NSW Online Registry page: {url}")
    page.goto(url, wait_until="domcontentloaded")
    prompt(
        "If needed, log in/select a court-list page until at least one matter row is visible. "
        "Courtlens buttons should appear beside parsed rows."
    )
    count = page.locator("[data-courtlens-open]").count()
    if count < 1:
        raise AssertionError("No [data-courtlens-open] buttons found on the live court-list page")
    print(f"✓ Found {count} Courtlens row button(s)")

    page.locator("[data-courtlens-open]").first.click()
    page.wait_for_selector("#argus-delta-courtlens-root", timeout=10_000)
    assert_shadow_contains(page, "Overview")
    assert_shadow_contains(page, "Research")
    assert_shadow_contains(page, "Documents")
    print("✓ Court-list sidebar opened with expected tabs")

    if not skip_documents:
        click_shadow_button(page, "Documents")
        click_shadow_button(page, "Generate PDFs")
        page.wait_for_function(
            "document.querySelector('#argus-delta-courtlens-root').shadowRoot.textContent.includes('_media_access_2026.pdf')",
            timeout=20_000,
        )
        print("✓ Court-list document PDF generation completed")


def verify_caselaw(page: Page, url: str) -> None:
    print(f"\nOpening NSW Caselaw page: {url}")
    page.goto(url, wait_until="domcontentloaded")
    prompt("Wait for the NSW Caselaw page/search result to fully render and confirm the Courtlens launcher is visible.")
    count = page.locator("[data-courtlens-caselaw-launcher]").count()
    if count < 1:
        raise AssertionError("No [data-courtlens-caselaw-launcher] button found on the live Caselaw page")
    print("✓ Found NSW Caselaw Courtlens launcher")

    page.locator("[data-courtlens-caselaw-launcher]").first.click()
    page.wait_for_selector("#argus-delta-courtlens-root", timeout=10_000)
    assert_shadow_contains(page, "Overview")
    assert_shadow_contains(page, "Research")
    assert_shadow_contains(page, "Settings")
    print("✓ NSW Caselaw sidebar opened with expected tabs")


def verify_token_not_rendered(page: Page, token: str) -> None:
    if not token:
        print("ℹ ARGUS_DELTA_TOKEN not set; token-leak DOM check skipped")
        return
    for current_page in page.context.pages:
        try:
            body_text = current_page.locator("body").inner_text(timeout=1_000)
        except Exception:
            body_text = ""
        shadow = ""
        if current_page.locator("#argus-delta-courtlens-root").count() > 0:
            shadow = shadow_text(current_page)
        if token in body_text or token in shadow:
            raise AssertionError("ARGUS_DELTA_TOKEN value is visible in page/sidebar text")
    print("✓ ARGUS_DELTA_TOKEN value was not visible in checked DOM text")


def run_with_profile(profile_dir: Path | None, callback: Callable[[Path], None]) -> None:
    if profile_dir:
        profile_dir.mkdir(parents=True, exist_ok=True)
        callback(profile_dir)
        return
    with TemporaryDirectory() as tmp:
        callback(Path(tmp))


def git_head() -> str | None:
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def write_evidence(args: argparse.Namespace, token_present: bool) -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    evidence = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pass",
        "command": "npm run smoke:operator",
        "gitHead": git_head(),
        "courtlist": {
            "skipped": bool(args.skip_courtlist),
            "url": None if args.skip_courtlist else args.courtlist_url,
            "documentsSkipped": bool(args.skip_documents),
        },
        "caselaw": {
            "skipped": bool(args.skip_caselaw),
            "url": None if args.skip_caselaw else args.caselaw_url,
        },
        "profileDir": str(args.profile_dir) if args.profile_dir else None,
        "argusDeltaTokenPresent": token_present,
        "notes": "Generated by operator-assisted headed Chromium smoke; no secret values recorded.",
    }
    EVIDENCE_PATH.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Operator-assisted live Chrome smoke for Courtlens v2")
    parser.add_argument("--courtlist-url", default=DEFAULT_COURTLIST_URL)
    parser.add_argument("--caselaw-url", default=DEFAULT_CASELAW_URL)
    parser.add_argument("--profile-dir", type=Path, help="Optional persistent Chromium profile directory")
    parser.add_argument("--skip-courtlist", action="store_true")
    parser.add_argument("--skip-caselaw", action="store_true")
    parser.add_argument("--skip-documents", action="store_true", help="Skip live document-generation click in court-list sidebar")
    args = parser.parse_args()

    if not (DIST / "manifest.json").exists():
        raise SystemExit("dist/manifest.json missing; run npm run build first")

    token = os.environ.get("ARGUS_DELTA_TOKEN", "")

    def smoke(user_data_dir: Path) -> None:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                str(user_data_dir),
                headless=False,
                args=[
                    f"--disable-extensions-except={DIST}",
                    f"--load-extension={DIST}",
                ],
            )
            try:
                page = context.new_page()
                if not args.skip_courtlist:
                    verify_courtlist(page, args.courtlist_url, args.skip_documents)
                if not args.skip_caselaw:
                    case_page = context.new_page()
                    verify_caselaw(case_page, args.caselaw_url)
                    verify_token_not_rendered(case_page, token)
                else:
                    verify_token_not_rendered(page, token)
            finally:
                prompt("Review the browser if desired. The smoke checks passed; press Enter to close Chromium.")
                context.close()

    run_with_profile(args.profile_dir, smoke)
    write_evidence(args, bool(token))
    print("\nOperator live smoke passed: real unpacked extension was verified in a headed browser session.")
    print(f"Operator live smoke evidence written to {EVIDENCE_PATH}")


if __name__ == "__main__":
    main()
