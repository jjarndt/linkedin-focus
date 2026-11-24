#!/usr/bin/env python3
"""Build and check the Safari download from the current Git commit."""

import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def manifest_paths(manifest):
    required = {
        "manifest.json",
        manifest["action"]["default_popup"],
        f"_locales/{manifest['default_locale']}/messages.json",
        *manifest["icons"].values(),
        *manifest["background"]["scripts"],
    }
    for content_script in manifest["content_scripts"]:
        required.update(content_script.get("js", []))
        required.update(content_script.get("css", []))
    return required


def build(output, tag):
    commit = git("rev-parse", "HEAD").decode().strip()
    manifest = json.loads(git("show", f"{commit}:extension/manifest.json"))
    package = json.loads(git("show", f"{commit}:package.json"))
    lockfile = json.loads(git("show", f"{commit}:package-lock.json"))
    version = manifest["version"]
    if not re.fullmatch(r"(0|[1-9]\d*)(\.(0|[1-9]\d*)){2}", version, flags=re.ASCII):
        raise ValueError(f"Unexpected manifest version: {version}")
    if tag and tag != f"v{version}":
        raise ValueError(f"Tag {tag} does not match manifest version {version}")
    if any(value != version for value in (
        package["version"], lockfile["version"], lockfile["packages"][""]["version"],
    )):
        raise ValueError(f"Manifest version {version} does not match the npm package and lockfile")

    tree = f"{commit}:extension"
    tracked = set(git("ls-tree", "-r", "--name-only", "-z", tree).decode().split("\0")) - {""}
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as directory:
        archive = Path(directory) / output.name
        timestamp = git("show", "-s", "--format=%cI", commit).decode().strip()
        subprocess.run(
            ["git", "archive", "--format=zip", f"--mtime={timestamp}", f"--output={archive}", tree],
            check=True,
            cwd=ROOT,
            env={**os.environ, "TZ": "UTC"},
        )
        with ZipFile(archive) as package_zip:
            invalid_file = package_zip.testzip()
            if invalid_file:
                raise ValueError(f"Unreadable file in Safari ZIP: {invalid_file}")
            files = [item.filename for item in package_zip.infolist() if not item.is_dir()]
            if sorted(files) != sorted(tracked):
                raise ValueError("Safari ZIP contents do not match the committed extension tree")
            missing = sorted(manifest_paths(manifest) - tracked)
            if missing:
                raise ValueError(f"Manifest resources missing from Safari ZIP: {', '.join(missing)}")
        archive.replace(output)
    print(f"Verified {output.name} for v{version} from {commit} ({len(tracked)} files)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--tag", default="", help="Expected release tag, for example v1.3.1")
    args = parser.parse_args()
    try:
        build(args.output.resolve(), args.tag)
    except (KeyError, ValueError) as error:
        parser.exit(1, f"{error}\n")
