# tools/trophy-format-fixtures - P-TROPHY-NATIVE-CONSUMER-1 formatting corpus capture

Additive, evidence-only actual-source capture for the Trophy formatting paths. It adds no native/client/protocol or gameplay
implementation and does not read, write or regenerate the older trophy-witness / card-runtime / ability corpora.

## What it captures

capture.mts runs the unmodified shared implementation in the pinned linux/amd64 Node 22.23.4 container
(node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292) and calls the
ACTUAL helpers: encodeKillAugment, parseKillAugment, killAugmentText, rollKillAugments and
combatReadability({lasting:true}) from packages/shared/src/index.ts. No formula is copied and no expected state is
installed. The single canonical corpus is parity/trophy-format/format.json (rh-trophy-format-source/1), always
JSON.stringify(body) + "\n".

Cases:

- keys: all nine KILL_STAT_KEYS, flat (toFixed(1)) and percentage (toFixed(4) encode, one-decimal percentage text)
  actual ids/parse/text.
- ties: exact decimal ties and their immediate binary64 neighbours (previous/at/next) for the 1-decimal flat text path,
  the 4-decimal encode/percentage path and the percentage-text 1-decimal path. Neighbours are constructed by IEEE-754
  BigUint64 bit steps (nextDown/nextUp for positive values); the raw bits are recorded for every row.
  - flat 1-decimal ties are m/4 (e.g. 0.25, 3.25), exact in binary64;
  - 4-decimal ties are q/32 (e.g. 1/32, 5/32), exact in binary64;
  - percentage-text 1-decimal ties are q/16 gains (0.0625, 1.1875), exact in binary64.
- tiny: positive tiny gains, including values whose encoded id rounds to zero and no longer parses (kill:ad:0.0,
  kill:damage:0.0000).
- refusals: parse/refusal boundaries (kill:, unknown key, missing segment, non-positive, NaN/Infinity, overflow,
  subnormal and extra segments).
- rolls: a few declared ReadableFighter rolls (flat tie order, tiny scores filtered, percentage rounding), each option
  re-encoded and re-worded by the actual helpers.

Rows are declared formatting inputs. They are NOT runtime lifecycle state and do not imply a reachable gain.

## Provenance and canonical checks

format.json records the image, platform and Node version; tool SHA256 (capture.mts, capture.sh); package-lock.json,
package.json and tsconfig.base.json SHA256; the internal shared source closure (all files transitively imported from
packages/shared/src/index.ts, with per-file SHA256 and a digest); the declared capture config and its SHA256; and
captureSha256, the SHA256 of the canonical body without that field.

capture.sh guards the output path to this worktree (REPO/**), mounts the repo read-only and node_modules as tmpfs,
runs npm ci --ignore-scripts, and then one Node process. --check mounts the corpus read-only and requires identical
bytes (and recomputes captureSha256). bash tools/trophy-format-fixtures/capture.sh rewrites
parity/trophy-format/format.json byte-identically.

In this worktree the recorded corpus is 47,713 bytes, SHA256
b75078a3286913391d5c7f309536bc6e8e8c4ea2f101a8ad939ad1f235e4673c, captureSha256
0f1e3d04b013771758e1a8f8462f050d23fcfcacb62c75b305119fdc29940f48, with 28 tie groups, 9 key rows, 9 tiny rows,
19 refusal rows and 3 declared rolls. The source closure is 73 files, digest
2ac73144203dcad4985ce1ba8cdfec8f3013a193478df0d60ca43e6131a8539d.

## Consumer

crates/rh-sim/src/kill_augments/format_consumer.rs (cfg(test)-only) compares native js_to_fixed/encode/parse/text
and the exact neighbour bits against every row, plus compiled semantic controls (rounding, bits and wording mutations are
reported; provenance-only changes are not).
