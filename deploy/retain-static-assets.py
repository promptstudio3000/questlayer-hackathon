"""Retain only public, hashed build assets so open tabs survive a release change."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--app-root", required=True)
parser.add_argument("--release", required=True)
args = parser.parse_args()
app = Path(args.app_root).resolve()
release = Path(args.release).resolve()
assert release.parent == app / "releases", "Release must belong to this app"
pool = app / "assets"
assert not pool.is_symlink(), "Asset pool must not be a symlink"
pool.mkdir(mode=0o755, exist_ok=True)
pool.chmod(0o755)
valid = re.compile(r"[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|jpe?g|webp|svg|gif)\Z")
releases = sorted(
    (p for p in (app / "releases").iterdir()
     if p.is_dir() and not p.is_symlink() and re.fullmatch(r"\d{8}T\d{6}Z", p.name)),
    key=lambda p: p.name, reverse=True,
)
cutoff = time.time() - 7 * 86400
sources = [p for p in releases if p == release or p in releases[:5] or p.stat().st_mtime >= cutoff]
referenced = set()
copied = 0
for source in sources:
    directory = source / "dist" / "assets"
    if not directory.is_dir() or directory.is_symlink():
        continue
    for file in directory.iterdir():
        if not valid.fullmatch(file.name) or not file.is_file() or file.is_symlink():
            continue
        assert file.stat().st_size <= 32 * 1024 * 1024, "Build asset exceeds retention limit"
        target = pool / file.name
        assert not target.is_symlink(), "Retained assets must not be symlinks"
        if target.exists():
            assert hashlib.sha256(target.read_bytes()).digest() == hashlib.sha256(file.read_bytes()).digest(), "Hashed asset contents changed"
        else:
            temporary = pool / (".pending-" + str(uuid.uuid4()))
            try:
                shutil.copyfile(file, temporary)
                temporary.chmod(0o644)
                os.replace(temporary, target)
                copied += 1
            finally:
                temporary.unlink(missing_ok=True)
        if source == release or source in releases[:5]:
            referenced.add(file.name)
removed = 0
for file in pool.iterdir():
    if valid.fullmatch(file.name) and file.is_file() and not file.is_symlink() and file.name not in referenced and file.stat().st_mtime < cutoff:
        file.unlink()
        removed += 1
total = sum(p.stat().st_size for p in pool.iterdir() if p.is_file() and not p.is_symlink())
assert total <= 256 * 1024 * 1024, "Public asset pool exceeds its 256 MiB budget"
print(json.dumps({"publicAssetsCopied": copied, "expiredAssetsRemoved": removed, "assetPoolBytes": total, "retentionDays": 7, "protectedRecentReleases": 5}))
