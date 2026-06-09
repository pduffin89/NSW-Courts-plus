#!/usr/bin/env python3
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import rmtree
from threading import Thread
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
FIXTURES = ROOT / "fixtures"
SCREENSHOTS = ROOT / "artifacts" / "screenshots"


def install_chrome_stub(page):
    page.add_init_script(
        """
        window.chrome = {
          runtime: {
            id: 'courtlens-screenshot',
            sendMessage: async (message) => {
              if (message.type === 'COURTLENS_SEARCH') {
                return { ok: true, data: {
                  providerId: message.providerId,
                  query: message.query,
                  items: [{
                    id: 'screenshot-result-1',
                    title: 'Courtlens screenshot research result',
                    subtitle: 'Non-sensitive fixture result for store screenshots',
                    url: 'https://example.invalid/courtlens-screenshot',
                    badges: ['fixture', 'safe'],
                    source: message.providerId
                  }],
                  hasMore: false
                } };
              }
              if (message.type === 'COURTLENS_SAVE_SETTINGS') return { ok: true, data: { saved: true } };
              if (message.type === 'COURTLENS_GENERATE_DOCUMENTS') {
                return { ok: true, data: { attachments: [
                  { name: 'fixture_media_access_2026.pdf', mime: 'application/pdf', base64: 'JVBERi0=' },
                  { name: 'fixture_non_party_access.pdf', mime: 'application/pdf', base64: 'JVBERi0=' }
                ] } };
              }
              if (message.type === 'COURTLENS_OPEN_GMAIL_DRAFT') return { ok: true, data: { tabId: 99 } };
              if (message.type === 'COURTLENS_EXTRACT_ENTITIES') {
                return { ok: true, data: [
                  { id: 'local-ner-person-jane-citizen', name: 'Jane Citizen', originalText: 'Jane Citizen', type: 'person', group: 'Person', confidence: 0.96, source: 'local-ner' },
                  { id: 'local-ner-org-courtlens', name: 'Courtlens Local NER Pty Ltd', originalText: 'Courtlens Local NER Pty Ltd', type: 'organisation', group: 'Organisation', confidence: 0.93, source: 'local-ner' }
                ] };
              }
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


def shadow_text(page):
    return page.locator("#argus-delta-courtlens-root").evaluate("el => el.shadowRoot.textContent")


def shadow_click(page, text):
    page.locator("#argus-delta-courtlens-root").evaluate(
        """(host, exactText) => {
          const button = [...host.shadowRoot.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === exactText);
          if (!button) throw new Error(`Button not found: ${exactText}`);
          button.click();
        }""",
        text,
    )


def sidebar_shell(page):
    return page.locator("#argus-delta-courtlens-root").locator(".cl-shell")


def screenshot_sidebar(page, name):
    shell = sidebar_shell(page)
    expect(shell).to_be_visible(timeout=5_000)
    shell.screenshot(path=str(SCREENSHOTS / name))


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return


def main():
    if not (DIST / "courtlist.js").exists():
        raise SystemExit("dist/courtlist.js missing; run npm run build first")
    if not (FIXTURES / "courtlist.html").exists():
        raise SystemExit("fixtures/courtlist.html missing")

    rmtree(SCREENSHOTS, ignore_errors=True)
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)

    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
                install_chrome_stub(page)
                page.goto(f"{base_url}/fixtures/courtlist.html")
                page.wait_for_load_state("networkidle")
                add_bundle(page, base_url, "courtlist.js")
                expect(page.locator("[data-courtlens-open]")).to_have_count(1)
                page.locator("[data-courtlens-open]").click()
                expect(sidebar_shell(page)).to_be_visible(timeout=5_000)
                assert "SMITH v ACME PTY LTD" in shadow_text(page)
                screenshot_sidebar(page, "01-overview.png")

                shadow_click(page, "Research")
                shadow_click(page, "Search news")
                page.wait_for_function("document.querySelector('#argus-delta-courtlens-root').shadowRoot.textContent.includes('Courtlens screenshot research result')")
                screenshot_sidebar(page, "02-research.png")

                shadow_click(page, "Documents")
                shadow_click(page, "Generate PDFs")
                page.wait_for_function("document.querySelector('#argus-delta-courtlens-root').shadowRoot.textContent.includes('fixture_media_access_2026.pdf')")
                screenshot_sidebar(page, "03-documents.png")

                shadow_click(page, "Settings")
                page.wait_for_function("document.querySelector('#argus-delta-courtlens-root').shadowRoot.textContent.includes('Secrets are masked after save')")
                screenshot_sidebar(page, "04-settings.png")
            finally:
                browser.close()
    finally:
        server.shutdown()

    expected = ["01-overview.png", "02-research.png", "03-documents.png", "04-settings.png"]
    missing = [name for name in expected if not (SCREENSHOTS / name).exists()]
    if missing:
        raise SystemExit(f"missing screenshot(s): {', '.join(missing)}")
    print(f"Release screenshots captured: {', '.join(str(SCREENSHOTS / name) for name in expected)}")


if __name__ == "__main__":
    main()
