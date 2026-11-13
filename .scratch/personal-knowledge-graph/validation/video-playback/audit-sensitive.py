"""Scan only this validation's publishable artifacts without printing secrets."""
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parent
excluded = {'.local', 'target', 'gen', '__pycache__'}
credentials = [line.split('=', 1)[1].encode() for line in (root / '.local/service.env').read_text().splitlines() if '=' in line]
patterns = [re.compile(rb'X-Amz-Signature=[0-9a-fA-F]{32,}'), re.compile(rb'http://127\.0\.0\.1:19310/[0-9a-f]{64}/')]
scanned = 0
violations = []
for file in root.rglob('*'):
    relative = file.relative_to(root)
    if not file.is_file() or any(part in excluded for part in relative.parts):
        continue
    content = file.read_bytes()
    scanned += 1
    if any(secret and secret in content for secret in credentials) or any(pattern.search(content) for pattern in patterns):
        violations.append(str(relative))
report = {'verdict': 'FAIL' if violations else 'PASS', 'filesScanned': scanned, 'violatingPaths': violations, 'checks': ['actual local trial credential values', 'complete presigned signature URLs', 'session media capability tokens'], 'excluded': sorted(excluded)}
(root / 'evidence/sensitive-scan.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
raise SystemExit(1 if violations else 0)
