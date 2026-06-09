#!/usr/bin/env python3
import argparse
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
FIXTURES = ROOT / "fixtures"

COURTLIST_URL = "https://onlineregistry.lawlink.nsw.gov.au/content/court-lists/mock"
CASELAW_URL = "https://www.caselaw.nsw.gov.au/decision/mock"
NEWS_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Google News</title><item>
<title>Courtlens Smoke News Result</title>
<link>https://example.test/courtlens-smoke-news</link>
<pubDate>Tue, 09 Jun 2026 00:00:00 GMT</pubDate>
<description>Deterministic routed RSS item for extension research smoke.</description>
</item></channel></rss>
"""


def fulfill_fixture(route, fixture_name):
    route.fulfill(
        status=200,
        content_type="text/html; charset=utf-8",
        body=(FIXTURES / fixture_name).read_text(encoding="utf-8"),
    )


def fulfill_news(route):
    route.fulfill(status=200, content_type="application/rss+xml; charset=utf-8", body=NEWS_RSS)


def run_extension_load_smoke(extension_dir: Path, label: str):
    extension_dir = extension_dir.resolve()
    if not (extension_dir / "manifest.json").exists():
        raise SystemExit(f"{extension_dir}/manifest.json missing; run npm run build/package first")
    with TemporaryDirectory() as user_data_dir:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir,
                headless=False,
                args=[
                    f"--disable-extensions-except={extension_dir}",
                    f"--load-extension={extension_dir}",
                ],
            )
            try:
                context.route("https://news.google.com/rss/search**", fulfill_news)
                page = context.new_page()
                page.route(COURTLIST_URL, lambda route: fulfill_fixture(route, "courtlist.html"))
                page.goto(COURTLIST_URL)
                page.wait_for_load_state("networkidle")
                expect(page.locator("[data-courtlens-open]")).to_have_count(1, timeout=10_000)
                page.locator("[data-courtlens-open]").click()
                text = page.locator("#argus-delta-courtlens-root").evaluate("el => el.shadowRoot.textContent")
                assert "SMITH v ACME PTY LTD" in text
                page.locator("#argus-delta-courtlens-root").evaluate("el => [...el.shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Research').click()")
                page.locator("#argus-delta-courtlens-root").evaluate("el => [...el.shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Search news').click()")
                page.wait_for_function("document.querySelector('#argus-delta-courtlens-root').shadowRoot.textContent.includes('Courtlens Smoke News Result')", timeout=20_000)
                page.locator("#argus-delta-courtlens-root").evaluate("el => [...el.shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Documents').click()")
                page.locator("#argus-delta-courtlens-root").evaluate("el => [...el.shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Generate PDFs').click()")
                page.wait_for_function("document.querySelector('#argus-delta-courtlens-root').shadowRoot.textContent.includes('_media_access_2026.pdf')", timeout=20_000)

                case_page = context.new_page()
                case_page.route(CASELAW_URL, lambda route: fulfill_fixture(route, "caselaw.html"))
                case_page.goto(CASELAW_URL)
                case_page.wait_for_load_state("networkidle")
                expect(case_page.locator("[data-courtlens-caselaw-launcher]")).to_have_count(1, timeout=10_000)
                case_page.locator("[data-courtlens-caselaw-launcher]").click()
                case_text = case_page.locator("#argus-delta-courtlens-root").evaluate("el => el.shadowRoot.textContent")
                assert "Mitchell v State of New South Wales" in case_text
                assert "Acme Pty Ltd" in case_text
                assert "Byron Shire Council" in case_text
            finally:
                context.close()
    print(f"Extension load smoke passed: {label} ran content scripts, routed Research provider search, and generated document attachments on routed NSW URLs.")


def main():
    parser = argparse.ArgumentParser(description="Load an unpacked Courtlens extension in Chromium and verify routed NSW workflows.")
    parser.add_argument("--extension-dir", type=Path, default=DIST, help="Unpacked extension directory to load. Defaults to dist/.")
    parser.add_argument("--label", default="unpacked dist extension", help="Human-readable extension label for smoke output.")
    args = parser.parse_args()
    run_extension_load_smoke(args.extension_dir, args.label)


if __name__ == "__main__":
    main()
