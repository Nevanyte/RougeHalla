#!/usr/bin/env bash
# Offline synthetic packager/selection/probe-boundary tests only; no Rust, PG or native executable.
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PYTHONDONTWRITEBYTECODE=1
python3 -B -m unittest discover -s tools/staging-native-artifact -p 'test_*.py' -v
python3 -B - <<'PY'
import ast
from pathlib import Path
for path in sorted(Path('tools/staging-native-artifact').glob('*.py')):
    ast.parse(path.read_text(), filename=str(path))
    print('AST PASS:', path)
PY
git diff --check
