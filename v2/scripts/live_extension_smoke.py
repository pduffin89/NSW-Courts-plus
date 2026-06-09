#!/usr/bin/env python3
"""Non-interactive live-site extension smoke for public NSW pages.

This complements fixture/routed extension smoke by loading the unpacked MV3
extension against real public NSW Caselaw and NSW Online Registry URLs.
Authenticated/operator-specific workflows remain covered by
scripts/operator_live_smoke.py.
"""

import os
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
CASELAW_URL = os.environ.get("CASELAW_LIVE_URL", "https://www.caselaw.nsw.gov.au/search?query=Smith&page=1")
COURTLIST_URL = os.environ.get("ONLINEREGISTRY_LIVE_URL", "https://onlineregistry.lawlink.nsw.gov.au/content/court-lists")


def shadow_text(page) -> str:
    return page.locator("#argus-delta-courtlens-root").evaluate("el => el.shadowRoot.textContent || ''")


def click_shadow_button(page, label: str) -> None:
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


def assert_shadow_tabs(page, labels: tuple[str, ...], label_for_error: str) -> None:
    text = shadow_text(page)
    for expected in labels:
        if expected not in text:
            raise AssertionError(f"Expected {label_for_error} sidebar to include {expected!r}; saw {text[:500]!r}")


def verify_caselaw(context) -> None:
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
    assert_shadow_tabs(page, ("Overview", "Research", "Documents", "Settings"), "live Caselaw")
    page.close()
    print(f"Live extension smoke: Courtlens mounted on public NSW Caselaw URL {CASELAW_URL}")


def verify_courtlist(context) -> None:
    page = context.new_page()
    response = page.goto(COURTLIST_URL, wait_until="networkidle", timeout=45_000)
    if response is None:
        raise AssertionError("NSW Online Registry live page did not return a response")
    if response.status >= 400:
        raise AssertionError(f"NSW Online Registry live page returned HTTP {response.status}")
    expect(page.locator("[data-courtlens-open]").first).to_be_visible(timeout=20_000)
    count = page.locator("[data-courtlens-open]").count()
    if count < 1:
        raise AssertionError("Expected at least one Courtlens row button on live NSW Online Registry")
    page.locator("[data-courtlens-open]").first.click()
    page.wait_for_selector("#argus-delta-courtlens-root", state="attached", timeout=10_000)
    page.wait_for_function(
        "document.querySelector('#argus-delta-courtlens-root')?.shadowRoot?.textContent?.includes('Overview')",
        timeout=10_000,
    )
    assert_shadow_tabs(page, ("Overview", "Research", "Documents", "Settings"), "live court-list")
    click_shadow_button(page, "Documents")
    click_shadow_button(page, "Generate PDFs")
    page.wait_for_function(
        "document.querySelector('#argus-delta-courtlens-root')?.shadowRoot?.textContent?.includes('_media_access_2026.pdf')",
        timeout=20_000,
    )
    page.close()
    print(f"Live extension smoke: Courtlens mounted on public NSW Online Registry URL {COURTLIST_URL} with {count} row button(s)")


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
                verify_caselaw(context)
                verify_courtlist(context)
            finally:
                context.close()

    print("Live extension smoke passed: Courtlens mounted on public NSW Caselaw and NSW Online Registry pages")


if __name__ == "__main__":
    main()
