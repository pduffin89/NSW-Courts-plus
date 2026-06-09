#!/usr/bin/env python3
import shutil
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from extension_load_smoke import run_extension_load_smoke

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "artifacts" / "argus-delta-courtlens.zip"


def main():
    if not ARCHIVE.exists():
        raise SystemExit(f"Release archive missing: {ARCHIVE}. Run npm run package:extension or node scripts/package_extension.mjs first.")
    if not zipfile.is_zipfile(ARCHIVE):
        raise SystemExit(f"Release archive is not a valid zip: {ARCHIVE}")

    with TemporaryDirectory() as tmp:
        extension_dir = Path(tmp) / "argus-delta-courtlens"
        extension_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(ARCHIVE) as archive:
            archive.extractall(extension_dir)
        if any(path.name == ".DS_Store" or path.suffix == ".map" for path in extension_dir.rglob("*")):
            raise SystemExit("Release archive extraction contained forbidden .DS_Store or .map files")
        run_extension_load_smoke(extension_dir, "extracted release archive")
        shutil.rmtree(extension_dir)

    print(f"Release extension smoke passed: extracted and loaded {ARCHIVE}")


if __name__ == "__main__":
    main()
