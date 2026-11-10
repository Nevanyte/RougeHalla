#!/usr/bin/env bash
# Only new offline tests; fake systemd runner and private temporary files.
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PYTHONDONTWRITEBYTECODE=1
python3 -B -m unittest discover -s tools/staging-full-runtime/installer -p test_expiry_executor.py -v
python3 -B - <<'PY'
import ast
from pathlib import Path
for name in ('expiry_executor.py', 'test_expiry_executor.py'):
    path = Path('tools/staging-full-runtime/installer') / name
    ast.parse(path.read_text(), filename=str(path))
    print('AST PASS:', path)
PY
git diff --check
