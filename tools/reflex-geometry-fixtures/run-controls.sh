#!/usr/bin/env bash
# Source semantic controls: every mutation is applied to the actual source text in-memory, bundled and
# re-executed by capture.mts. The raw original (canonical) arm and restored arm are included there.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUTPUT=$(printenv RH_REFLEX_GEOMETRY_CONTROLS_OUT || true)
[ -n "$OUTPUT" ] || OUTPUT=/tmp/reflex-geometry-controls
rm -rf "$OUTPUT"
RH_REFLEX_GEOMETRY_OUTPUT="$OUTPUT" bash "$REPO/tools/reflex-geometry-fixtures/capture.sh" controls
