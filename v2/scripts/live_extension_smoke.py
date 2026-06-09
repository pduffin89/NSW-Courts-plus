#!/usr/bin/env python3
"""Non-interactive live-site extension smoke for public NSW Caselaw.

This complements fixture/routed extension smoke by loading the unpacked MV3
extension against a real public NSW Caselaw URL. It intentionally avoids NSW
Online Registry because live court-list rows may require human navigation or an
authenticated browser session; use scripts/operator_live_smoke.py for that.
"""

import os
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
CASELAW_URL = os.environ.get("CASELAW_LIVE_URL", "https://www.caselaw.nsw.gov.au/search?query=Smith&page=1")


def shadow_text(page) -> str:
    return page.locator("#argus-delta-courtlens-root").evaluate("el => el.shadowRoot.textContent || ''")


def main() -> None:
    if not (DIST / "manifest.json").exists():
        raise SystemExit("dist/manifest.json missing; run npm run build first")

    with TemporaryDirectory() as user_data_dir:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir,
                headless=False,
                args=[
                    f"--disable-extensions-except={DIST}",
                    f"--load-extension={DIST}",
                ],
            )
            try:
                page = context.new_page()
                response = page.goto(CASELAW_URL, wait_until="domcontentloaded", timeout=30_000)
                if response is None:
                    raise AssertionError("NSW Caselaw live page did not return a response")
                if response.status >= 400:
                    raise AssertionError(f"NSW Caselaw live page returned HTTP {response.status}")
                expect(page.locator("[data-courtlens-caselaw-launcher]")).to_have_count(1, timeout=15_000)
                page.locator("[data-courtlens-caselaw-launcher]").click()
                page.wait_for_selector("#argus-delta-courtlens-root", state="attached", timeout=10_000)
                page.wait_for_function(
                    "document.querySelector('#argus-delta-courtlens-root')?.shadowRoot?.textContent?.includes('Overview')",
                    timeout=10_000,
                )
                text = shadow_text(page)
                for expected in ("Overview", "Research", "Documents", "Settings"):
                    if expected not in text:
                        raise AssertionError(f"Expected live Caselaw sidebar to include {expected!r}; saw {text[:500]!r}")
            finally:
                context.close()

    print(f"Live extension smoke passed: Courtlens mounted on public NSW Caselaw URL {CASELAW_URL}")


if __name__ == "__main__":
    main()
