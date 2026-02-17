#!/usr/bin/env python3
import os
import platform
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str]) -> int:
    return subprocess.call(cmd, cwd=str(Path(__file__).resolve().parent))


def main() -> int:
    installer_dir = Path(__file__).resolve().parent
    system = platform.system().lower()

    if system == "darwin":
        target = installer_dir / "install.command"
        if not target.exists():
            print("install.command is missing from installer payload.")
            return 1
        return run(["bash", str(target)])

    if system == "windows":
        target = installer_dir / "install.ps1"
        if not target.exists():
            print("install.ps1 is missing from installer payload.")
            return 1
        return run([
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(target),
        ])

    print(f"Unsupported operating system: {platform.system()}")
    print("This installer currently supports macOS and Windows.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
