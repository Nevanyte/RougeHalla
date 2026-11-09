#!/usr/bin/env bash
# Offline only: tmpdir-backed tests with fake PID1/PG/S3/kernel models. No host, cloud or service action.
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PYTHONDONTWRITEBYTECODE=1
python3 -B -m unittest discover -s tools/staging-full-runtime/installer -p test_host_executor.py
python3 -B -m unittest discover -s tools/staging-full-runtime/installer -p 'test_*.py'
python3 -B -m unittest discover -s tools/staging-full-runtime -p 'test_*.py'
python3 -B - <<'PY'
import ast
from pathlib import Path
for name in ('host_executor.py', 'test_host_executor.py'):
    path = Path('tools/staging-full-runtime/installer') / name
    ast.parse(path.read_text(), filename=str(path))
    print('AST PASS:', path)
PY
if command -v sha256sum >/dev/null; then sha256sum -c docs/evidence/staging-host-executor/SHA256SUMS
else shasum -a 256 -c docs/evidence/staging-host-executor/SHA256SUMS; fi
