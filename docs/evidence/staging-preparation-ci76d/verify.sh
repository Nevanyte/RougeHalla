#!/usr/bin/env bash
# Offline preparation contracts and syntax only; no artifact/native build or host commands.
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PYTHONDONTWRITEBYTECODE=1
python3 -B -m unittest discover -s tools/staging-full-runtime -p 'test_*.py' -v
python3 -B - <<'PY'
import ast
import json
from pathlib import Path

root = Path('tools/staging-full-runtime')
for name in ('prepare.py', 'run-runtime.py', 'test_preparation.py'):
    ast.parse((root / name).read_text(), filename=str(root / name))
    print('AST PASS:', root / name)
for name in ('native-pins.json', 'plan.unverified.json'):
    json.loads((root / name).read_text())
    print('JSON PASS:', root / name)
PY
git diff --check
printf '%s\n' 'Whitespace PASS'
