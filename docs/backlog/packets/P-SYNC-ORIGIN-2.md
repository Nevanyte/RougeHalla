# P-SYNC-ORIGIN-2: merge origin's integration branch into the local one again, as protocol 22

- **Serves:** the integration branch itself (coordinator, 2026-11-20). The owner asked to push and merge the augment
  rework; origin moved on after P-SYNC-ORIGIN-1, so the two lines must be one again before the push.
- **Tier:** `implementer-opus` (a merge, a wire renumber, and tick-step conversions in `rh-sim`). Reviewer: `reviewer-opus`.
- **Base:** `feature/unity-rework` at the commit that adds this brief. Merge `origin/feature/unity-rework` @ `1dd79a938`
  (fetched 2026-11-20; merge base `81866e9c4`, 95 commits). Do not fetch a newer origin: the coordinator re-syncs later.
- **Precedent:** P-SYNC-ORIGIN-1 (`docs/backlog/packets/P-SYNC-ORIGIN-1.md`, integration 71 in `docs/MIGRATION.md`).
  Same rules unless this brief says otherwise.
- **Oracle (coordinator decision):** the union of both lines' existing suites, plus the one new test in decision 6.
  Every test either line has must pass on the merged tree; no test may be weakened or deleted. Version-stamp moves are
  the only edits allowed in an existing test, and each is listed in the hand-off.

## What origin added since `81866e9c4`

- P-COLISEUM-HEALS-2 (PR 76): heal pickups on the wire as prop kind 8, **protocol 20**, policy contract 27.
- P-TICK-1b and 1b-fix (PR 77): every `rh-sim` system reads the sim's own step (`tick_ms`, P-TICK-1a); tick-counted
  constants became milliseconds; the deprecated `TICK_MS`/`TICK_RATE` aliases left `rh-sim` (registry rows keep the
  names for the content hash). Origin's brief: `git show origin/feature/unity-rework:docs/backlog/packets/P-TICK-1b.md`.
- P-TICK-2 (bots and headless read the step), P-TICK-3 and 3-fix (**protocol 21**: snapshot time read at the Welcome's
  tick rate in Rust, C# and JS; the encoder writes at the connection's rate), P-TICK-4 (Unity library follows the
  session's step), P-TICK-5 (rooms pace at the sim's step; `--tick-ms` / `RH_TICK_MS`) (PRs 77, 78).
- Open, not merged, not part of this packet: PR 79 (P-TICK-6) flips the server default to 25 ms. Once it lands, live
  rooms run the rework at 25 ms; decision 6 exists for that.

| | Local (`feature/unity-rework`) | Origin (`1dd79a938`) | Merged |
|---|---|---|---|
| Protocol | 20 (walk hint, WIRE19-A/B, Marked Man key 15) | 21 (heal props 20, tick rate 21) | **22** |
| Observation | 34 | 31 | **35** |
| Policy contract | 30 | 27 | **31** |
| Checkpoint | `rh-checkpoint/36` | `rh-checkpoint/32` | 37 by default (decision 3) |
| Content hash | `d43155e2ed7d1c68` | `7a542a13187f034c` | the regolden script's |

## Decisions

1. **Wire: protocol 22** carries origin's 20 and 21 and the local 20.
   - The server refuses 21 and below.
   - `protocol/fixtures/v22.json` comes only from `cargo run -p rh-protocol --bin protocol-fixtures`.
   - `v20.json` and `v21.json` take origin's files (origin's wires, possibly deployed). The local v20 vectors were never
     deployed: local tests that read them read v22.
   - The Rust, C# and JS decoders carry all three changes. The Unity copy of the net library moves only through
     `bash client-unity/sync-net.sh`.
2. **Observation 35 and policy contract 31.**
3. **Checkpoint:** `rh-checkpoint/37` is the default. It may stay 36 only if origin added no serialized field, enum
   variant or format change since `81866e9c4`; say which and why. Every serialized field reaches save, restore and the
   state hash; the refused-format lists add the retired format.
4. **Content hash:** after the merge, `scripts/regolden-content.sh` only. On a conflict in any copy, take either side
   and rerun it. Merge `crates/rh-sim/tests/content.rs` tables by hand (both sides' rows); the script writes the golden
   line. Hash tape: `observationVersion` only through its recorder
   (`cargo test -p rh-sim --lib record_ability_hash_tape -- --ignored`), `contentHash` and `checkpoint` only through
   the script; no case digest may move (if one does, stop and report).
5. **The local rework reads the sim's step.** Origin converted every `rh-sim` system; code that exists only on the local
   line still assumes 50 ms. Convert each such site the way P-TICK-1b converted its neighbours (read the match's
   `tick_ms`, keep milliseconds as milliseconds, keep per-step amounts per second). Known sites, recorded at
   integration 71 (line numbers from integration 73; the files have moved since):
   - `abilities/checkpoint.rs`: the Wish Engine restore lattice and every other local `% TICK_MS` / `+ TICK_MS` line
     (origin converted the rest of this file; at 25 ms the unconverted lattice refuses valid checkpoints);
   - `abilities/mod.rs` (the Wish Engine grid);
   - `cards/native/hooks.rs` (Glacier's chill milliseconds) and the rest of `cards/native/`;
   - `systems/buffs.rs` (barrier decay);
   - every other local-only `rh-sim`, `rh-policy` or `rh-server` line that steps by a fixed 50 ms or counts steps as
     time: search the merged tree, and list every site you convert in the hand-off.
   At 50 ms nothing may change: `crates/rh-headless/tests/tick_ms_digest_guard.rs` and every parity fixture stay green.
6. **New test (the only new oracle):** `crates/rh-headless/tests/rework_at_25ms.rs`. A live-content world
   (`SimConfig::live_content()`, Rework rules) at `tick_ms` 25 with bots, for at least 2400 steps on at least two
   seeds. Grant native and retuned cards to some fighters through the existing trusted setup (P-SIM-BENCH-SEAM-1).
   Checkpoint and restore every 200 steps: each restore succeeds and its state hash equals the original's. If a
   restore is refused as `invalid mob rewind`, that is the known P-MOB-REWIND-RESTORE-1 defect, not yours: choose
   seeds that avoid it, and name the refused seed and step in the hand-off. Fix any other refusal.
7. **Card provenance: change no pinned file.**
   - P-CI-GREEN-7 runs in parallel against this brief's base. Every file in the catalog's `protectedSha256` map
     (`parity/card-catalog/source.json`) must end byte-identical to the base. Today the two lines differ in exactly one
     pinned file, `tools/protocol-js/check-vectors.mjs`: keep the local file.
   - If protocol 22 needs a new JS check, put it in a new file that `tools/protocol-js/check-map-anchors.mjs` runs, the
     way origin runs `check-tick-rate.mjs`.
   - After the merge, `node tools/provenance/check-card-chain.mjs` reports exactly one failure, the waived
     `check-vectors.mjs` pin. Any other failure: stop and report.
8. **`docs/MIGRATION.md`:** keep the local file. Origin rewrote its top section in place ("40 Hz tick, P-TICK-1a to
   5"): replace the copy of that section that P-SYNC-ORIGIN-1 put under the local heading
   `## From origin (merged by P-SYNC-ORIGIN-1, 2026-11-20)` with origin's current text, verbatim. Rename the heading to
   `## From origin (merged by P-SYNC-ORIGIN-1 and P-SYNC-ORIGIN-2, 2026-11-20)`. Edit no other shared record.
9. **Every other conflict keeps both sides.**
   - Version-stamp tests take the new numbers.
   - A digest pin that hashes a whole observation moves only because of the version; prove it by forcing the old
     version, as P-WIRE19-A did.
   - A behaviour conflict (both lines changing one rule differently) is not resolved here: stop and report it.
10. **`Cargo.lock`:** only if the merge itself conflicts there; take the union and say so.

## Write scope

The merge commit and the commits after it on `agent/opus/P-SYNC-ORIGIN-2`:
- the conflicted files;
- the wire files of all three changes (rh-protocol, the C# library and tests, the JS probe and checks, the rh-server
  version check, the rh-policy contract);
- the version-stamp tests;
- the fixtures, through their commands;
- the content-hash copies, through the script;
- the checkpoint format and its refused lists;
- the step conversions of decision 5;
- `crates/rh-headless/tests/rework_at_25ms.rs` (new);
- `docs/MIGRATION.md`, as in decision 8.

Never: `packages/`, `hosting/`, `.github/`, `.claude/`, `scripts/gate.sh`, any `AGENTS.md`/`CLAUDE.md`, any pinned
file of decision 7, `parity/**` outside the hash tape.

## Gate

`scripts/gate.sh --coordinator --keep-going --allow-artefacts --regen-fixtures --base feature/unity-rework`, with
Postgres. Start it with `RH_PGTEST_STATE=<a directory of your own> eval "$(tools/pgtest/start.sh)"` and stop it when
done. The only waived red is the card provenance pin of `check-vectors.mjs`. Also run:
- `dotnet test client-unity/RoguehallaNet.Tests`
- `node tools/protocol-js/check-vectors.mjs` and `node tools/protocol-js/check-map-anchors.mjs`
- `bash client-unity/sync-net.sh --check`
- `cargo test --release -p rh-headless --test rework_at_25ms`

## Done

A merge commit of `1dd79a938` into the base, then the renumber and conversions, on `agent/opus/P-SYNC-ORIGIN-2`. The
gate above is green except the waived pin. The hand-off lists:
- every conflict and how it was resolved;
- every version-stamp move;
- the checkpoint decision;
- every step conversion (file, line, what it read before);
- the new content hash;
- anything stopped and reported.
