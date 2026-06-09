#!/usr/bin/env python3
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
FIXTURES = ROOT / "fixtures"


def install_chrome_stub(page):
    page.add_init_script(
        """
        window.chrome = {
          runtime: {
            id: 'courtlens-smoke',
            sendMessage: async (message) => {
              if (message.type === 'COURTLENS_SEARCH') {
                return { ok: true, data: { providerId: message.providerId, query: message.query, items: [], hasMore: false } };
              }
              if (message.type === 'COURTLENS_SAVE_SETTINGS') return { ok: true, data: { saved: true } };
              if (message.type === 'COURTLENS_GENERATE_DOCUMENTS') {
                return { ok: true, data: { attachments: [{ name: 'fixture_media_access_2026.pdf', mime: 'application/pdf', base64: 'JVBERi0=' }] } };
              }
              if (message.type === 'COURTLENS_OPEN_GMAIL_DRAFT') return { ok: true, data: { tabId: 99 } };
              return { ok: true, data: {} };
            }
          },
          storage: { local: { get: (_key, cb) => cb({}), set: (_items, cb) => cb && cb() } }
        };
        """
    )


def add_bundle(page, base_url, name):
    page.add_script_tag(url=f"{base_url}/dist/{name}", type="module")
    page.wait_for_timeout(500)


def smoke_courtlist(page, base_url):
    page.goto(f"{base_url}/fixtures/courtlist.html")
    page.wait_for_load_state("networkidle")
    add_bundle(page, base_url, "courtlist.js")
    expect(page.locator("[data-courtlens-open]")).to_have_count(1)
    page.locator("[data-courtlens-open]").click()
    host = page.locator("#argus-delta-courtlens-root")
    expect(host).to_have_count(1)
    matter_title = page.locator("#argus-delta-courtlens-root").evaluate("el => el.shadowRoot.textContent")
    assert "SMITH v ACME PTY LTD" in matter_title
    assert "2025/00490454" in matter_title
    assert "Research" in matter_title
    page.locator("#argus-delta-courtlens-root").evaluate("el => [...el.shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Documents').click()")
    page.locator("#argus-delta-courtlens-root").evaluate("el => [...el.shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Generate PDFs').click()")
    page.wait_for_function("document.querySelector('#argus-delta-courtlens-root').shadowRoot.textContent.includes('fixture_media_access_2026.pdf')")
    page.locator("#argus-delta-courtlens-root").evaluate("el => [...el.shadowRoot.querySelectorAll('button')].find(b => b.textContent === 'Open Gmail draft').click()")
    page.wait_for_function("document.querySelector('#argus-delta-courtlens-root').shadowRoot.textContent.includes('Gmail draft opened')")


def smoke_caselaw(page, base_url):
    page.goto(f"{base_url}/fixtures/caselaw.html")
    page.wait_for_load_state("networkidle")
    add_bundle(page, base_url, "caselaw.js")
    expect(page.locator("[data-courtlens-caselaw-launcher]")).to_have_count(1)
    page.locator("[data-courtlens-caselaw-launcher]").click()
    text = page.locator("#argus-delta-courtlens-root").evaluate("el => el.shadowRoot.textContent")
    assert "Mitchell v State of New South Wales" in text
    assert "2025/00490454" in text
    assert "Documents" in text


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return


def main():
    if not (DIST / "courtlist.js").exists():
        raise SystemExit("dist/courtlist.js missing; run npm run build first")
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 900})
                install_chrome_stub(page)
                smoke_courtlist(page, base_url)
                smoke_caselaw(page, base_url)
            finally:
                browser.close()
    finally:
        server.shutdown()
    print("Browser smoke passed: bundles mount Courtlens sidebar and document generation UI on fixtures.")


if __name__ == "__main__":
    main()
