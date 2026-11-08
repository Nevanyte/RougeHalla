# Quest data source witness (P-QUEST-1)

Actual-source corpus for the K1 quest **data layer** (catalog rows, reward rules, roster selection, map placement and
wording), captured from the unmodified legacy source in the pinned linux/amd64 Node 22.23.4 container
(`node:22.23.4-bookworm-slim@sha256:aaa4b5...`) by `tools/quest-fixtures/capture.mts`.

- `data.json` — `rh-quest-data-source/1`, 79,403 bytes, SHA256
  `c01c045f9ddac21cbe95244c21d9b8d9332db7b2d793ac85df8767b2a6297e03`.
  Cases: `catalog` (all 20 rows plus tier points, parity GV, tier, base, fed/unfed reward card, copies, stat payout and
  reward text), `rosters` (three declared quest salts), `placements` (real generated maps for seeds 1 and 2 × the three
  salts: candidate count/fold, home component, and every placement with its tokens/parcel), and `phrases` (the five
  refusals and the accept wording for every offer).
- Maps are pinned by seed + attempt + `mapHashU32` (the source generation path, `decor: false`); the native test
  regenerates the same map through the ported generator and requires the same hash before comparing placement.
- Checkout: `bash tools/quest-fixtures/capture.sh --check` re-runs the capture in the pinned container and requires the
  checked-in bytes to be identical.
- The native consumer is `crates/rh-sim/src/quests/tests.rs`; the committed mutant controls live in
  `tools/quest-fixtures/mutants/` with `run-mutants.sh`.
- Evidence and scope: [docs/evidence/stage2-quest-1](../../docs/evidence/stage2-quest-1/README.md).
## Lifecycle witness

- `lifecycle.json` — `rh-quest-lifecycle-source/1`, 10 cases, 633,814 bytes, SHA256
  `c292c637c8a76ea3a524465b44ec0b2d66dcdaeee1316e44aeeebdcef2b4b1de`, captured by `tools/quest-fixtures/lifecycle.mts` in
  the same pinned image from the unmodified source harness (`createGameWorld`: production module order, quests on, map
  `generateMap(1, attempt 0, {decor:false})`, reward salt `[1,2,3,4]`, world random `mulberry32(12)`). Each case records,
  per captured tick: the public quest rows (status/doneBy/expiresAt/carrier/progress/accepted/visitedRegions), the private
  offer table (published, giver presence, finder, publishAt, tokens/parcel, lastCarrier), the giver mobs, the quest
  containers, each player's GV breakdown and mob-stat counts, plus the ordered action script (declared setup helpers and
  ordinary input-queue messages) and the per-frame action count the native replay consumes.
- Cases: `spawn`, `accept` (far refusal → accept with deadline → repeat refusal), `reveal` (radius discovery, 4 s head
  start, publication + pieces), `collect` (token pickups, one captured refusal, automatic turn-in paying GV and the
  mob-stat row), `fetch` (parcel pickup, real sword kill of the carrier, dropBody drop, steal by another player, turn-in),
  `player-kill` (real sword kill advancing the player-kill offer), `expiry` (declared deadline nudge, expiry + linger
  sweep), `teleport-close` (the real coliseum teleport producer closing every open offer), `run-end-close` (two real
  sword kills down to one standing player; the real arena end producer's `endRun` closes every open offer) and
  `camp-clear-close` (a hidden region cull is revealed, then EVERY live mob of its region is wiped through the source's
  real kill producer with no credited killer; the camps clear and the impossible-kill closure expires the public offer).
  The two new cases' declared setup (victim hp, weapon, place and the whole-region producer call) is marked in the
  action scripts; all other values are source-written.
- Native replay: `crates/rh-sim/src/quests/lifecycle_tests.rs` regenerates the same map, replays the recorded actions
  through the real C-INPUT door (declared setup, teleport and whole-region kill-producer helpers marked as such; the
  region wipe calls the port's real mob-kill path) and compares every captured surface.
- `bash tools/quest-fixtures/capture.sh --check` re-runs both corpora in the pinned container and requires identical bytes.
