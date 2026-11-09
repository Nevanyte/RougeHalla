#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 0 ] || exit 2
exec bash "$(dirname "$0")/capture.sh" --mutants
