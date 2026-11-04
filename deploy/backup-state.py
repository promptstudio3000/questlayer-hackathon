"""Private, consistent SQLite + capped award-attestor snapshots. No network access."""
import argparse
from datetime import datetime, timezone, timedelta
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import time
from urllib.parse import quote
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--state", required=True)
parser.add_argument("--destination", required=True)
parser.add_argument("--retention-days", type=int, default=14)
# The mainnet slice service keeps questlayer-mainnet.sqlite in its own state directory.
parser.add_argument("--database-name", default="questlayer-hackathon.sqlite")
parser.add_argument("--build-id", default="development-unrecorded")
parser.add_argument("--config-sha256")
args = parser.parse_args()
assert 2 <= args.retention_days <= 90, "Invalid retention window"
assert args.database_name in ("questlayer-hackathon.sqlite", "questlayer-mainnet.sqlite"), "Unknown state database"
assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,95}", args.build_id), "Invalid reviewed build identifier"
assert args.config_sha256 is None or re.fullmatch(r"[a-f0-9]{64}", args.config_sha256), "Invalid public configuration digest"
os.umask(0o077)
state = Path(args.state).resolve()
database = state / args.database_name
legacy_database = state / "auratrail.sqlite"
assert not (database.exists() and legacy_database.exists()), "Ambiguous state databases"
if not database.exists() and legacy_database.exists():
    database = legacy_database
assert database.is_file() and not database.is_symlink(), "Expected this app's regular state database"
destination = Path(args.destination)
assert not destination.is_symlink(), "Snapshot destination must not be a symlink"
destination.mkdir(mode=0o700, parents=True, exist_ok=True)
destination = destination.resolve()
destination.chmod(0o700)
assert destination != state and state not in destination.parents, "Snapshots must be separate from live state"
with open(destination / ".backup.lock", "a") as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(json.dumps({"status": "already_running"}))
        raise SystemExit(0)
    now = datetime.now(timezone.utc)
    identifier = now.strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    pending = destination / (".pending-" + identifier)
    completed = destination / identifier
    pending.mkdir(mode=0o700)
    try:
        source = sqlite3.connect("file:" + quote(str(database)) + "?mode=ro", uri=True, timeout=10)
        target = sqlite3.connect(pending / "database.sqlite")
        deadline = time.monotonic() + 90
        def check_deadline():
            if time.monotonic() > deadline:
                raise TimeoutError("Snapshot deadline exceeded")
        def progress(_status, _remaining, _total):
            check_deadline()
        try:
            source.backup(target, pages=256, progress=progress, sleep=0.02)
            target.execute("PRAGMA journal_mode=DELETE")
            assert target.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "Snapshot integrity failed"
            tables = {row[0] for row in target.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            media_references = {row[0] for row in target.execute("SELECT image FROM messages WHERE image IS NOT NULL")} if "messages" in tables else set()
            def normalized_sql(sql):
                literals = []
                def save_literal(match):
                    literals.append(match.group(0))
                    return "__literal%d__" % (len(literals) - 1)
                value = re.sub(r"'(?:[^']|'')*'", save_literal, sql)
                value = re.sub(r"\bif\s+not\s+exists\b", "", value, flags=re.I)
                value = re.sub(r'[\s"`\[\]]', "", value).lower()
                value = re.sub(r"__literal(\d+)__", lambda match: literals[int(match.group(1))], value)
                return value.removesuffix(";")
            table_shapes = {name: normalized_sql(sql) for name, sql in target.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")}
            ledger = dict(target.execute("SELECT name,version FROM questlayer_schema_modules")) if "questlayer_schema_modules" in tables else {}
            schema_compatibility = {"coreVersion": ledger.get("core", 0),
                                    "moduleVersions": {name: version for name, version in sorted(ledger.items()) if name != "core"},
                                    "fingerprint": hashlib.sha256(json.dumps(table_shapes, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()}
            target.commit()
        finally:
            target.close()
            source.close()
        snapshot = pending / "database.sqlite"
        snapshot.chmod(0o600)
        digest = hashlib.sha256()
        with open(snapshot, "rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
        signer = state / "award-attestor.pem"
        assert not signer.is_symlink(), "Award attestor must be a regular state file"
        included = signer.is_file() and not signer.is_symlink()
        if included:
            with open(signer, "rb") as src, open(pending / "award-attestor.pem", "xb") as dst:
                shutil.copyfileobj(src, dst)
                dst.flush()
                os.fsync(dst.fileno())
        native_keys = []
        for name in ("reward-attestor.pem", "reward-worker.json"):
            key = state / name
            assert not key.is_symlink(), "Native service key must be a regular state file"
            if key.is_file():
                assert key.stat().st_size <= 4096, "Unexpected service key size"
                with open(key, "rb") as src, open(pending / name, "xb") as dst:
                    shutil.copyfileobj(src, dst)
                    dst.flush()
                    os.fsync(dst.fileno())
                (pending / name).chmod(0o600)
                native_keys.append(name)
        media = []
        for reference in sorted(media_references):
            check_deadline()
            match = re.fullmatch(r"/api/media/(image_[a-f0-9-]{1,80}\.jpg)", reference)
            assert match, "Unsupported referenced media path"
            source_media = state / ".data" / "media" / match.group(1)
            assert source_media.is_file() and not source_media.is_symlink() and state in source_media.resolve().parents, "Referenced media is missing or outside state"
            assert source_media.stat().st_size <= 512 * 1024, "Referenced media exceeds its bound"
            content = source_media.read_bytes()
            directory = pending / "media"
            directory.mkdir(mode=0o700, exist_ok=True)
            with open(directory / match.group(1), "xb") as file:
                file.write(content)
                file.flush()
                os.fsync(file.fileno())
            media.append({"file": match.group(1), "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
        check_deadline()
        metadata = {"application": "QuestLayer", "format": 1, "snapshotId": identifier,
                    "createdAt": now.isoformat(), "integrity": "ok", "databaseBytes": snapshot.stat().st_size,
                    "schemaCompatibility": schema_compatibility, "sourceBuildId": args.build_id, "publicConfigDigest": args.config_sha256,
                    "databaseSha256": digest.hexdigest(), "awardAttestorIncluded": included,
                    "nativeServiceKeysIncluded": native_keys,
                    "referencedMedia": media,
                    "playerWalletSigningKeysIncluded": False}
        with open(pending / "metadata.json", "x") as file:
            json.dump(metadata, file, indent=2)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        pending.rename(completed)
        snapshots = []
        for path in destination.iterdir():
            if path.is_dir() and not path.is_symlink() and re.fullmatch(r"\d{8}T\d{6}Z-[a-f0-9]{8}", path.name):
                try:
                    record = json.loads((path / "metadata.json").read_text())
                    if record.get("application") == "QuestLayer" and record.get("format") == 1 and record.get("snapshotId") == path.name:
                        created = datetime.fromisoformat(record["createdAt"])
                        if created.tzinfo is not None and created <= now + timedelta(days=1):
                            snapshots.append((created, path))
                except (OSError, ValueError, KeyError, TypeError):
                    continue
        snapshots.sort(key=lambda item: item[0], reverse=True)
        removed = 0
        for created, path in snapshots[2:]:
            if created < now - timedelta(days=args.retention_days):
                shutil.rmtree(path)
                removed += 1
        print(json.dumps({"status": "ok", **metadata, "expiredSnapshotsRemoved": removed}))
    finally:
        if pending.exists():
            shutil.rmtree(pending)
