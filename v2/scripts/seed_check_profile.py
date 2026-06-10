#!/usr/bin/env python3
"""Seed a persistent local Chromium profile with Courtlens private settings.

This does not modify source, dist, or the release ZIP. It writes only to the
Chrome extension storage inside the requested browser profile.

Secrets:
- Argus token is read from COURTLENS_ARGUS_DELTA_TOKEN or prompted via getpass.
- ABN GUID is read from ~/Documents/ABN GUID.rtf unless --abn-guid is supplied.
- Values are never printed.
"""

from __future__ import annotations

import argparse
import getpass
import os
import re
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
DEFAULT_PROFILE = ROOT / "artifacts" / "courtlens-check-profile"
DEFAULT_GUID_FILE = Path.home() / "Documents" / "ABN GUID.rtf"
DEFAULT_NER_ENDPOINT = "http://100.89.36.94:8766/extract"
COURTLIST_URL = "https://onlineregistry.lawlink.nsw.gov.au/content/court-lists#/"


def extract_guid(path: Path) -> str:
    text = path.read_text(errors="ignore")
    match = re.search(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32}|[A-Za-z0-9]{24,64}", text)
    if not match:
        raise SystemExit(f"No ABN GUID-like value found in {path}")
    return match.group(0)


def extension_worker(context: Any):
    workers = [worker for worker in context.service_workers if worker.url.startswith("chrome-extension://")]
    return workers[0] if workers else context.wait_for_event("serviceworker", timeout=15_000)


def seed_extension_storage(context: Any, items: dict[str, str]) -> None:
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


def read_extension_storage(context: Any, keys: list[str]) -> dict[str, Any]:
    worker = extension_worker(context)
    return worker.evaluate(
        """(keys) => new Promise((resolve, reject) => {
          chrome.storage.local.get(keys, (items) => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(items);
          });
        })""",
        keys,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed and open a local Courtlens check profile")
    parser.add_argument("--profile-dir", type=Path, default=DEFAULT_PROFILE)
    parser.add_argument("--extension-dir", type=Path, default=DIST)
    parser.add_argument("--abn-guid-file", type=Path, default=DEFAULT_GUID_FILE)
    parser.add_argument("--abn-guid", default="")
    parser.add_argument("--local-ner-endpoint", default=DEFAULT_NER_ENDPOINT)
    parser.add_argument("--keep-open", action="store_true", help="Keep the browser open after seeding")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    extension_dir = args.extension_dir.resolve()
    if not (extension_dir / "manifest.json").exists():
        raise SystemExit(f"{extension_dir}/manifest.json missing; run npm run build first")

    token = os.environ.get("COURTLENS_ARGUS_DELTA_TOKEN") or getpass.getpass("Argus Delta token: ")
    if not token.strip():
        raise SystemExit("Argus Delta token is required")
    abn_guid = args.abn_guid or extract_guid(args.abn_guid_file)

    args.profile_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(args.profile_dir),
            headless=False,
            args=[
                f"--disable-extensions-except={extension_dir}",
                f"--load-extension={extension_dir}",
            ],
        )
        try:
            page = context.new_page()
            page.route(COURTLIST_URL, lambda route: route.fulfill(
                status=200,
                content_type="text/html; charset=utf-8",
                body=(ROOT / "fixtures" / "courtlist.html").read_text(encoding="utf-8"),
            ))
            page.goto(COURTLIST_URL, wait_until="domcontentloaded", timeout=30_000)
            page.wait_for_selector("[data-courtlens-open]", timeout=15_000)
            seed_extension_storage(
                context,
                {
                    "argusDeltaToken": token,
                    "abnGuid": abn_guid,
                    "localNerEndpoint": args.local_ner_endpoint,
                },
            )
            stored = read_extension_storage(context, ["argusDeltaToken", "abnGuid", "localNerEndpoint"])
            assert bool(stored.get("argusDeltaToken"))
            assert bool(stored.get("abnGuid"))
            assert stored.get("localNerEndpoint") == args.local_ner_endpoint
            print(f"Courtlens profile seeded: {args.profile_dir}")
            print(f"Extension dir: {extension_dir}")
            print(f"Local NER endpoint: {args.local_ner_endpoint}")
            print("Argus token and ABN GUID are present in chrome.storage.local; values not printed.")
            if args.keep_open:
                print("Browser left open for checking. Press Ctrl+C here when finished.")
                page.wait_for_timeout(24 * 60 * 60 * 1000)
        finally:
            context.close()


if __name__ == "__main__":
    main()
