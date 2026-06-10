#!/usr/bin/env python3
import argparse
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from tempfile import TemporaryDirectory
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright, expect

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
ARGUS_JSON = """{
  "items": [{
    "title": "SMITH ACME PTY LTD Courtlens Smoke Argus Result",
    "caseNumbers": ["2025/00490454"],
    "court": "Supreme Court of NSW",
    "location": "Sydney",
    "listingType": "Directions",
    "date": "2026-06-09",
    "rowId": "smoke-argus"
  }],
  "hasMore": false
}
"""
ABN_JSONP = "callback({\"Names\":[{\"Abn\":\"51824753556\",\"Name\":\"Courtlens Smoke ABN Pty Ltd\",\"State\":\"NSW\",\"Postcode\":\"2000\"}]})"
ABN_CURRENT_HTML = """
<table><tbody>
<tr><th>Entity name:</th><td>Courtlens Smoke ABN Pty Ltd</td></tr>
<tr><th>ABN status:</th><td>Active from 01 Jan 2020</td></tr>
<tr><th>Entity type:</th><td>Australian Private Company</td></tr>
<tr><th>Goods &amp; Services Tax (GST):</th><td>Registered from 01 Jan 2020</td></tr>
<tr><th>Main business location:</th><td>NSW 2000</td></tr>
</tbody></table>
<ul><li><strong>ABN last updated:</strong> 9 June 2026</li><li><strong>Record extracted:</strong> 10 June 2026</li></ul>
"""
ABN_HISTORY_HTML = """
<table><tbody>
<tr><th colspan="3">Entity name</th></tr><tr><td>Courtlens Smoke ABN Pty Ltd</td><td>01 Jan 2020</td><td>(current)</td></tr>
<tr><th colspan="3">ABN status</th></tr><tr><td>Active</td><td>01 Jan 2020</td><td>(current)</td></tr>
<tr><th colspan="3">Goods &amp; Services Tax (GST)</th></tr><tr><td>Registered</td><td>01 Jan 2020</td><td>(current)</td></tr>
<tr><th colspan="3">Main business location</th></tr><tr><td>NSW 2000</td><td>01 Jan 2020</td><td>(current)</td></tr>
</tbody></table>
"""
FEDERAL_HTML = '<html><body><a href="/judgment/1">Courtlens Smoke Federal Result</a></body></html>'
NSW_CASELAW_HTML = '<html><body><a href="/decision/smoke">Courtlens Smoke NSW Caselaw Result</a></body></html>'
LOCAL_NER_JSON = '{"entities":[{"text":"Jane Citizen","label":"PERSON","score":0.96},{"text":"Courtlens Local Legal","label":"LAW_FIRM","score":0.91},{"text":"Courtlens Local NER Pty Ltd","label":"ORG","score":0.89},{"text":"Harrison J","label":"JUDGE","score":0.93}]}'
GMAIL_HTML = '<html><body><h1>Routed Gmail compose smoke</h1></body></html>'


def fulfill_fixture(route, fixture_name):
    route.fulfill(
        status=200,
        content_type="text/html; charset=utf-8",
        body=(FIXTURES / fixture_name).read_text(encoding="utf-8"),
    )


def fulfill_text(route, body, content_type="text/plain; charset=utf-8"):
    route.fulfill(status=200, content_type=content_type, body=body)


def shadow_click(page, exact_text):
    page.locator("#argus-delta-courtlens-root").evaluate(
        """(el, exactText) => {
          const button = [...el.shadowRoot.querySelectorAll('button')].find((candidate) => candidate.textContent === exactText);
          if (!button) throw new Error(`Shadow button not found: ${exactText}`);
          button.click();
        }""",
        exact_text,
    )


def shadow_text(page):
    return page.locator("#argus-delta-courtlens-root").evaluate("el => el.shadowRoot.textContent")


def shadow_wait_text(page, text, timeout=20_000):
    try:
        page.wait_for_function(
            """(expected) => document.querySelector('#argus-delta-courtlens-root')
              ?.shadowRoot?.textContent?.includes(expected)""",
            arg=text,
            timeout=timeout,
        )
    except PlaywrightTimeoutError:
        print(f"Extension load smoke: timed out waiting for {text!r}. Sidebar text was: {shadow_text(page)!r}")
        raise


def shadow_fill_input(page, aria_label, value):
    field = page.locator(f'#argus-delta-courtlens-root input[aria-label="{aria_label}"]')
    field.fill(value)
    expect(field).to_have_value(value, timeout=5_000)


def shadow_input_value(page, aria_label):
    return page.locator(f'#argus-delta-courtlens-root input[aria-label="{aria_label}"]').input_value()


def exercise_settings_ui(context, page):
    print("Extension load smoke: exercising Settings save/mask/persist")
    smoke_token = "courtlens-smoke-token-do-not-leak"
    shadow_click(page, "Settings")
    expect(page.locator('#argus-delta-courtlens-root input[aria-label="Argus Delta token"]')).to_be_visible(timeout=5_000)
    page.wait_for_timeout(500)
    shadow_fill_input(page, "Argus Delta token", smoke_token)
    shadow_fill_input(page, "ABN GUID", "00000000-0000-4000-8000-000000000000")
    shadow_fill_input(page, "Applicant name", "Courtlens Smoke Applicant")
    shadow_fill_input(page, "Applicant organisation", "Argus Delta Smoke Org")
    shadow_fill_input(page, "Applicant email", "smoke@example.invalid")
    shadow_fill_input(page, "Local NER endpoint", "http://127.0.0.1:8766/extract")
    page.wait_for_timeout(250)
    assert shadow_input_value(page, "Argus Delta token") == smoke_token
    assert shadow_input_value(page, "ABN GUID") == "00000000-0000-4000-8000-000000000000"
    shadow_click(page, "Save settings")
    shadow_wait_text(page, "Settings saved locally")
    settings = get_extension_storage(context, "courtlensSettings")
    assert settings["argusDeltaToken"] == smoke_token
    assert settings["abnGuid"] == "00000000-0000-4000-8000-000000000000"
    assert settings["applicantName"] == "Courtlens Smoke Applicant"
    assert settings["localNerEndpoint"] == "http://127.0.0.1:8766/extract"
    assert shadow_input_value(page, "Argus Delta token") == "••••••••"
    assert shadow_input_value(page, "ABN GUID") == "••••••••"
    assert smoke_token not in shadow_text(page)


def exercise_gmail_handoff(context, page):
    print("Extension load smoke: exercising Gmail compose handoff")
    with context.expect_page(timeout=10_000) as gmail_page_info:
        shadow_click(page, "Open Gmail draft")
    gmail_page = gmail_page_info.value
    gmail_page.wait_for_load_state("domcontentloaded")
    gmail_url = gmail_page.url
    parsed = urlparse(gmail_url)
    target_url = gmail_url
    if parsed.netloc == "accounts.google.com":
        target_url = parse_qs(parsed.query).get("continue", [""])[0]
    if not target_url.startswith("https://mail.google.com/mail/?"):
        print(f"Extension load smoke: Gmail tab URL was {gmail_url!r}; target compose URL was {target_url!r}")
    assert target_url.startswith("https://mail.google.com/mail/?")
    compose_params = parse_qs(urlparse(target_url).query)
    assert compose_params.get("view") == ["cm"]
    assert compose_params.get("to") == ["sc.enquiries@justice.nsw.gov.au"]
    assert compose_params.get("su") == ["2025/00490454 SMITH v ACME PTY LTD"]
    assert compose_params.get("body") and "Courtlens Smoke Applicant" in compose_params["body"][0]
    shadow_wait_text(page, "Gmail draft opened")
    gmail_page.close()


def exercise_research_providers(page):
    shadow_click(page, "Research")
    provider_expectations = [
        ("Search Argus Delta", "Courtlens Smoke Argus Result"),
        ("Search news", "Courtlens Smoke News Result"),
        ("Search federal-court", "Courtlens Smoke Federal Result"),
        ("Search nsw-caselaw", "Courtlens Smoke NSW Caselaw Result"),
        ("Search abn", "Courtlens Smoke ABN Pty Ltd"),
    ]
    for button_text, expected_text in provider_expectations:
        print(f"Extension load smoke: exercising {button_text}")
        shadow_click(page, button_text)
        shadow_wait_text(page, expected_text)

    shadow_click(page, "Show ABN history")
    shadow_wait_text(page, "ABN history loaded")
    shadow_wait_text(page, "Active from 01 Jan 2020")


def extension_worker(context):
    workers = [worker for worker in context.service_workers if worker.url.startswith("chrome-extension://")]
    return workers[0] if workers else context.wait_for_event("serviceworker", timeout=10_000)


def seed_extension_storage(context, items):
    worker = extension_worker(context)
    worker.evaluate(
        """(items) => new Promise((resolve, reject) => {
          chrome.storage.local.set(items, () => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(true);
          });
        })""",
        items,
    )


def get_extension_storage(context, key):
    return extension_worker(context).evaluate(
        """(key) => new Promise((resolve, reject) => {
          chrome.storage.local.get(key, (items) => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(items[key]);
          });
        })""",
        key,
    )


def install_provider_routes(context):
    context.route("https://be-api.argusdelta.com/public/court-lists/search**", lambda route: fulfill_text(route, ARGUS_JSON, "application/json; charset=utf-8"))
    context.route("https://news.google.com/rss/search**", lambda route: fulfill_text(route, NEWS_RSS, "application/rss+xml; charset=utf-8"))
    context.route("https://search.judgments.fedcourt.gov.au/s/search.html**", lambda route: fulfill_text(route, FEDERAL_HTML, "text/html; charset=utf-8"))
    context.route("https://www.caselaw.nsw.gov.au/search**", lambda route: fulfill_text(route, NSW_CASELAW_HTML, "text/html; charset=utf-8"))
    context.route("https://abr.business.gov.au/json/MatchingNames.aspx**", lambda route: fulfill_text(route, ABN_JSONP, "application/javascript; charset=utf-8"))
    context.route("https://abr.business.gov.au/ABN/View**", lambda route: fulfill_text(route, ABN_CURRENT_HTML, "text/html; charset=utf-8"))
    context.route("https://abr.business.gov.au/AbnHistory/View**", lambda route: fulfill_text(route, ABN_HISTORY_HTML, "text/html; charset=utf-8"))
    context.route("http://127.0.0.1:8766/extract", lambda route: fulfill_text(route, LOCAL_NER_JSON, "application/json; charset=utf-8"))
    context.route("https://mail.google.com/mail/**", lambda route: fulfill_text(route, GMAIL_HTML, "text/html; charset=utf-8"))


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
                install_provider_routes(context)
                page = context.new_page()
                page.route(COURTLIST_URL, lambda route: fulfill_fixture(route, "courtlist.html"))
                page.goto(COURTLIST_URL)
                page.wait_for_load_state("networkidle")
                expect(page.locator("[data-courtlens-open]")).to_have_count(1, timeout=10_000)
                page.locator("[data-courtlens-open]").click()
                text = page.locator("#argus-delta-courtlens-root").evaluate("el => el.shadowRoot.textContent")
                assert "SMITH v ACME PTY LTD" in text
                exercise_settings_ui(context, page)
                exercise_research_providers(page)
                shadow_click(page, "Documents")
                shadow_click(page, "Generate PDFs")
                shadow_wait_text(page, "_media_access_2026.pdf")
                exercise_gmail_handoff(context, page)

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
                shadow_click(case_page, "Enhance entities")
                shadow_wait_text(case_page, "Jane Citizen")
                shadow_wait_text(case_page, "Courtlens Local Legal")
                shadow_wait_text(case_page, "Harrison J")
                assert "Courtlens Local NER Pty Ltd" not in shadow_text(case_page)
            finally:
                context.close()
    print(f"Extension load smoke passed: {label} ran content scripts, Settings save/mask/persist, all routed Research providers, ABN history, local NER enhancement, document generation, and Gmail handoff on routed NSW URLs.")


def main():
    parser = argparse.ArgumentParser(description="Load an unpacked Courtlens extension in Chromium and verify routed NSW workflows.")
    parser.add_argument("--extension-dir", type=Path, default=DIST, help="Unpacked extension directory to load. Defaults to dist/.")
    parser.add_argument("--label", default="unpacked dist extension", help="Human-readable extension label for smoke output.")
    args = parser.parse_args()
    run_extension_load_smoke(args.extension_dir, args.label)


if __name__ == "__main__":
    main()
