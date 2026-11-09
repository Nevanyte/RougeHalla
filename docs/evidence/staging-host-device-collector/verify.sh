#!/usr/bin/env bash
# New synthetic tests only. This does not invoke the Linux collector's real CLI.
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PYTHONDONTWRITEBYTECODE=1
python3 -B -m unittest discover -s tools/staging-full-runtime/installer -p test_host_device.py -v
python3 -B - <<'PY'
import ast
from pathlib import Path
for name in ('host_device.py', 'test_host_device.py'):
    path = Path('tools/staging-full-runtime/installer') / name
    ast.parse(path.read_text(), filename=str(path))
    print('AST PASS:', path)
PY
git diff --check
