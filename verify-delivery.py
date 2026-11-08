#!/usr/bin/env python3
"""Verify this review pack without running game code or contacting a network."""
from pathlib import Path
import hashlib
import json
import sys
import zipfile

root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent
manifest = json.loads((root/'delivery-files.json').read_text())
issues=[]
for name, expected in manifest['files'].items():
    p=(root/name).resolve()
    if not p.is_relative_to(root) or not p.is_file():
        issues.append({'path':name,'problem':'missing or unsafe path'}); continue
    data=p.read_bytes()
    if len(data)!=expected['bytes'] or hashlib.sha256(data).hexdigest()!=expected['sha256']:
        issues.append({'path':name,'problem':'digest or size mismatch'})
status=json.loads((root/'output/qa/claude-return-2026-11-07/security-status.json').read_text())
for item in status['archives']:
    archive=root/'output/qa/claude-return-2026-11-07'/item['copy']
    original=json.loads(archive.with_suffix('.manifest.json').read_text())
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None: issues.append({'path':str(archive),'problem':'ZIP CRC'})
        hashes={i.filename:hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist() if not i.is_dir()}
        if hashes!=original['entrySha256']:issues.append({'path':str(archive),'problem':'member digest mismatch'})
print(json.dumps({'status':'failed' if issues else 'passed','filesChecked':len(manifest['files']),
                  'securityArchivesChecked':len(status['archives']),'issues':issues},indent=2))
sys.exit(bool(issues))
