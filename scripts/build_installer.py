#!/usr/bin/env python3
from pathlib import Path
import shutil
import stat


def make_executable(path: Path) -> None:
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    dist_dir = repo_root / "dist"
    stage_dir = dist_dir / "NSW-Court-Autofill-Installer"
    zip_base = dist_dir / "NSW-Court-Autofill-Installer"

    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    zip_file = zip_base.with_suffix(".zip")
    if zip_file.exists():
        zip_file.unlink()

    (stage_dir / "payload").mkdir(parents=True, exist_ok=True)
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")
    shutil.copytree(
        repo_root / "service",
        stage_dir / "payload" / "service",
        ignore=ignore,
    )
    shutil.copytree(
        repo_root / "extension",
        stage_dir / "payload" / "extension",
        ignore=ignore,
    )
    shutil.copy2(repo_root / "installer" / "install.command", stage_dir / "install.command")
    shutil.copy2(repo_root / "installer" / "README.txt", stage_dir / "README.txt")

    make_executable(stage_dir / "install.command")

    shutil.make_archive(str(zip_base), "zip", root_dir=dist_dir, base_dir=stage_dir.name)
    shutil.rmtree(stage_dir)
    print(f"Created installer: {zip_file}")


if __name__ == "__main__":
    main()
