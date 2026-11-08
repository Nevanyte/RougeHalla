#!/usr/bin/env bash
# Host entry for the P-QUEST-HUMAN-ELIGIBILITY source semantic mutants, pinned linux/amd64 Node 22.23.4. The read-only
# /repo checkout is mounted at /repo; every mutation happens in the container's writable /tmp/repo copy. The inner script
# creates and verifies a complete backup before arming EXIT/INT/TERM/HUP restoration and fails nonzero on any restore or
# verification failure. The host also asserts the protected source paths were untouched before and after.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
DISCOVER=$(printenv RH_QUEST_MUTANTS_DISCOVER || true)
fail() { echo "MUTANTS FAIL: $*" >&2; exit 1; }
for f in packages/server/src/sim/quests.ts crates/rh-sim Cargo.lock; do
  git -C "$REPO" diff --quiet -- "$f" || fail "protected path is already modified before the run: $f"
done
[ -d "$REPO/parity/quest-human-eligibility" ] || fail "missing baseline parity/quest-human-eligibility"
[ -f "$REPO/tools/quest-human-eligibility-fixtures/mutants/expected.txt" ] || fail "missing mutants/expected.txt"
BEFORE=$(git -C "$REPO" status --porcelain -- packages/server/src/sim/quests.ts crates/rh-sim Cargo.lock)
docker run --rm --platform linux/amd64 -e RH_QUEST_MUTANTS_DISCOVER="$DISCOVER" \
 -e RH_QUEST_MUTANT_SELFTEST="$(printenv RH_QUEST_MUTANT_SELFTEST || true)" \
 -e RH_QUEST_MUTANT_SIGNAL_TEST="$(printenv RH_QUEST_MUTANT_SIGNAL_TEST || true)" \
 --tmpfs /repo/node_modules:rw,exec,size=1500m \
 --mount "type=bind,src=$REPO,dst=/repo,readonly" \
 --mount "type=bind,src=$REPO/tools/quest-human-eligibility-fixtures,dst=/capture,readonly" \
 --mount "type=bind,src=$REPO/parity/quest-human-eligibility,dst=/baseline,readonly" \
 -w /repo "$IMAGE" sh /capture/run-mutants-inner.sh
AFTER=$(git -C "$REPO" status --porcelain -- packages/server/src/sim/quests.ts crates/rh-sim Cargo.lock)
[ "$BEFORE" = "$AFTER" ] || fail "protected source/status paths changed during the mutation run"
for f in packages/server/src/sim/quests.ts crates/rh-sim Cargo.lock; do
  git -C "$REPO" diff --quiet -- "$f" || fail "protected path changed during the mutation run: $f"
done
echo "HOST GUARD PASS: packages/server/src/sim/quests.ts, crates/rh-sim and Cargo.lock are unchanged"
