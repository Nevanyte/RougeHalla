# P-FROST-WALL-2a: the Frost Wall's numbers enter the content registry (the content hash moves, nothing else)

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze") and the owner
  decision of 2026-11-12 ("the wall's numbers stay out of content until P-FROST-WALL-2"), which staged this step; the
  first part of P-FROST-WALL-2 (its section 5c), cut out so the content move lands and is reviewed alone
- **Implementer tier:** implementer-opus (`rh-sim` content and hash; every pinned copy across `crates/`, `parity/`,
  `protocol/`, `tools/`)
- **Reviewer:** reviewer-opus
- **Integration base:** `feature/unity-rework`; oracle written on the coordinator base `47a886495` (staging head plus
  P-FROST-WALL-1c's implementation @ `0938f5380`, whose review and full gate were in progress)
- **D-rules touched:** D1 no gameplay change (every number keeps its value; loose proof not applicable: the oracle pins
  the values against legacy patch `78dd8bd4` exactly) · D2 n/a · D5/D6/D9 none. One identity moves: the content hash.

## 1. ID and outcome
The eleven numbers Frost Wall plays with become named rows of the `content!` registry, so `content_hash` covers them.
In game terms nothing changes: every number keeps its value, the switch `SimConfig::frost_wish` stays `Freeze` by
default, and no profile selects the wall. What changes is identity: the content hash moves from `4674a176a28e3c7a` to
`7a542a13187f034c`, once, and every pinned copy moves with it in this branch.

**Decisions already taken (not reopened here):**
- ONE identity moves, the content hash. Protocol 17, observation 29, policy contract 23, checkpoint `rh-checkpoint/32`
  and replay `rh-replay/25` do not move. No profile flips to the wall; the wire is not touched (P-FROST-WALL-2 does both).
- The edit of the existing test `crates/rh-sim/tests/content.rs` (delete the eight `NON_GAMEPLAY` wall rows; set
  `GOLDEN_CONTENT_HASH`) is approved by the owner's 2026-11-12 decision that staged it for this step.
- The implementer re-records `parity/abilities/hash-tape.json` with its documented recorder in this packet. The gate's
  ONE refusal of that file under `--oracle` is expected and accepted; the oracle proves it harmless (only `contentHash`
  moves). See section 9.

## 2. Dependencies
P-FROST-WALL-1c (in the base `47a886495`; the guard this oracle amends is its oracle file). Serial with every packet
that touches `constants.rs`, `tests/content.rs`, `content.rs`, the hash tape or `protocol/fixtures/` (shared files).
P-FROST-WALL-2 (the wire and the flip) follows this.

## 3. Relevant legacy paths (unreleased patch `78dd8bd4`, read with `git show 78dd8bd4:<path>`)
- `packages/shared/src/abilities.ts:158-163`: `FROST_WALL_RANGE` 450, `FROST_WALL_MIN_RANGE` 64, `FROST_WALL_LENGTH`
  224, `FROST_WALL_MS` 4000, `FROST_WALL_CAST_MS` 250.
- `packages/shared/src/constants.ts:423`: `FROST_WALL_COOLDOWN_SECONDS` 45 (Rust `FROST_WALL_COOLDOWN_MS` 45000).
- `packages/shared/src/barriers.ts:12` `WALL_CELL_REACH = TILE * 0.75`; `:48` `WALL_END_SLACK = TILE / 4`.
- `packages/server/src/sim/abilities.ts:532-533` `WALL_PUSH_STEP = 4`, `WALL_PUSH_MAX = 96` (module-local); `:585`
  `const r = PLAYER_RADIUS + 32` (the gap; Rust name `WALL_GAP_REACH`, new).
No legacy behaviour is in question: this packet moves declarations only.

## 4. New paths
- `crates/rh-sim/tests/frost_wall_content.rs` (oracle; committed).

## 5. Exclusive write scope
- `crates/rh-sim/src/constants.rs`: append eleven rows at the END of the `content!` block, after
  `CAMP_BUFF_REPAIR_STEPS` (today `:505`), in exactly this order (the registry rule: "Declaration order is part of the
  hash: append new rows, do not shuffle"; the oracle pins the order and the resulting value):
  `FROST_WALL_RANGE: f64 = 450.`, `FROST_WALL_MIN_RANGE: f64 = 64.`, `FROST_WALL_LENGTH: f64 = 224.`,
  `FROST_WALL_MS: f64 = 4000.`, `FROST_WALL_CAST_MS: f64 = 250.`, `FROST_WALL_COOLDOWN_MS: f64 = 45000.`,
  `WALL_CELL_REACH: f64 = TILE * 0.75`, `WALL_END_SLACK: f64 = TILE / 4.`, `WALL_PUSH_STEP: f64 = 4.`,
  `WALL_PUSH_MAX: f64 = 96.`, `WALL_GAP_REACH: f64 = PLAYER_RADIUS + 32.` (all `f64`; units and doc comments are not
  hashed, write what helps).
- `crates/rh-sim/src/abilities/mod.rs`: remove the six `pub const FROST_WALL_*` (`:272-278`) and re-export them
  (`pub use crate::constants::{…}`) so `rh_sim::abilities::FROST_WALL_CAST_MS` and `a::FROST_WALL_RANGE` keep working
  for the part 1/1b/1c oracles; update the comments at `:270-271` and `:552` that say "folded … in P-FROST-WALL-2" /
  "not folded yet" (the catalog row with the `frostWall` id is still P-FROST-WALL-2's; only the numbers are folded now).
- `crates/rh-sim/src/barriers.rs`: remove `pub const WALL_CELL_REACH` / `WALL_END_SLACK` (`:20`, `:22`) and re-export
  them; `set_down` (`:183`) reads `WALL_PUSH_STEP` / `WALL_PUSH_MAX`, `keep_gap` (`:217`) reads `WALL_GAP_REACH`; update
  the section comment at `:128-132` (it says the numbers stay literals until P-FROST-WALL-2). Nothing else.
- `crates/rh-sim/tests/content.rs`: delete the eight `NON_GAMEPLAY` rows `:31-38` (the six `abilities/mod.rs`
  `FROST_WALL_*` rows and the two `barriers.rs` rows); set `GOLDEN_CONTENT_HASH` (`:570`) to `0x7a54_2a13_187f_034c`
  (what `hash_golden` prints). Approved (section 1). Nothing else in that file.
- `parity/abilities/hash-tape.json`: ONLY by its recorder,
  `cargo test --locked -p rh-sim --features trusted-status-probes --lib record_ability_hash_tape -- --ignored`.
- `protocol/fixtures/archetypes_v1.json`: ONLY by `cargo run --locked -p rh-parity --bin hitbox-fixtures` (it rewrites
  `pathfinding_v2.json` and `server_walk_v2.json` too; those must come out byte-identical).
- `tools/unity-browser-reload-proof/check.mjs:8` (`CONTENT`) and `normal-companion.mjs:7` (`EXPECTED_CONTENT_HASH`): by
  hand, the new 16-hex value.
- Not: any other file. In particular not `content.rs` (the fold already walks `REGISTRY`), `observe.rs`, the protocol,
  `SimConfig`/profiles, `client-unity/**` (`BakedContent.cs` is generated, see section 6), `docs/MIGRATION.md`
  (coordinator: propose `:11`'s new content hash in the hand-off), `hosting/technical-demo/README.md:199` (protected:
  propose it), other `docs/**` history.

## 6. Contracts and references
- C-PARITY: every parity fixture stays MATCH (numbers unchanged; switch off).
- C-RNG / C-TICK: no draw, no row moves.
- Client/server agreement on the content hash: the server refuses a client whose Hello carries another hash
  (`crates/rh-server/src/director.rs:592-597`, `RejectCode::ContentMismatch`) and publishes the value at `/info`
  (`director.rs:1506`, `:1571`). The Unity client takes it from `client-unity/UnityProject/Assets/Scripts/BakedContent.cs`
  (read at `Bootstrap.cs:109`), which `client-unity/UnityProject/Tools/build-web.sh:8-20` regenerates from the server's
  `/info` at build time; it is not a pin (today it holds a stale `0x7d2d84b827af3ddc`, unrelated to either value), and
  no EditMode or C# test pins the value (`RhBuild.cs:58` only refuses 0; `look-docs.test.cjs:113` only names the file).
  `tools/release/check-identity.mjs` checks `BakedContent.cs` against the server at release. So a deployed client needs
  a rebuild against the new server; an old client is refused with `ContentMismatch`.
- Replays and checkpoints carry the content hash and refuse another one (`replay.rs:220-224`,
  `checkpoint.rs:37,267`): recordings made before this lands no longer load. No checked-in replay or checkpoint
  fixture pins the value (all are recorded at test time).

## 7. Behaviour to preserve
- Sim behaviour identical: no number changes value, only where it is declared. `TILE * 0.75`, `TILE / 4.` and
  `PLAYER_RADIUS + 32.` evaluate to the same `f64` as today (24, 8, 44).
- Every parity fixture MATCH; the parity report unchanged.
- `parity/abilities/hash-tape.json` and `protocol/fixtures/archetypes_v1.json` change in `contentHash` only (pinned by
  digest in the oracle: tape `dcd5497d723e8a8d`, archetypes `7626003ed67bd3d7`, each without `contentHash`).
  `pathfinding_v2.json`, `server_walk_v2.json` and every other fixture unchanged.
- Identities other than the content hash: protocol 17, observation 29, policy contract 23, checkpoint 32, replay 25.

## 8. Acceptance checks
- Every test in `crates/rh-sim/tests/frost_wall_content.rs` passes; `tests/content.rs` passes (including
  `every_const_in_the_source_tree_is_registered_or_explained`, `hash_golden`, `every_registry_row_perturbs_the_hash`);
  the amended guard `guard_the_content_hash_is_the_golden_value` (`src/barriers_readers_tests.rs`) passes.
- `ability_hash_tape_matches_the_base` passes; `cargo run -p rh-parity --bin hitbox-fixtures -- --check` reports
  current; `crates/rh-parity/tests/pnet2_goldens.rs` passes; `node --test` in `tools/unity-browser-reload-proof` passes
  (33 tests).
- `scripts/gate.sh --regen-fixtures` (full) passes, and `scripts/gate.sh --oracle packet/P-FROST-WALL-2a
  --regen-fixtures` stops at its path checks with exactly the refusal in section 9 and nothing else.

## Oracle files (read-only for implementers)
- `crates/rh-sim/tests/frost_wall_content.rs` (new). Tests: `every_frost_wall_number_is_a_named_registry_row`,
  `the_wall_rows_are_appended_at_the_end_of_the_registry_in_order`, `the_content_hash_is_the_value_of_the_appended_rows`
  (pins `7a542a13187f034c`), `the_push_out_reads_its_named_numbers_not_literals`,
  `the_content_hash_moved_off_the_pre_wall_value`, `every_pinned_copy_of_the_content_hash_names_the_golden_value`,
  `the_carry_changes_only_the_content_hash_field_of_the_tape_and_the_archetype_golden`,
  `no_source_script_or_golden_still_names_the_pre_wall_content_hash`.
- `crates/rh-sim/src/barriers_readers_tests.rs` (P-FROST-WALL-1c's oracle; amended here, coordinator-approved): the guard
  `guard_the_content_hash_does_not_move_in_this_packet` (literal `0x4674_a176_a28e_3c7a`) is **amended in place** into
  `guard_the_content_hash_is_the_golden_value`, which reads `GOLDEN_CONTENT_HASH` from `tests/content.rs`
  (`include_str!`) and asserts `content_hash()` equals it. Why amend rather than delete: it keeps a lib-level guard
  (it runs under `--lib`, where the tape recorder and the reader oracles run), and the next move of the hash is written
  in one place only; why not keep the literal: the literal would be a sixth stale copy and fails
  `no_source_script_or_golden_still_names_the_pre_wall_content_hash`. Its needle is built with `join` so the const scan
  in `tests/content.rs` does not read the line as a `const` declaration.
- This brief.

## 9. Validation commands
```
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --locked -p rh-sim --features trusted-status-probes --test frost_wall_content --test content
cargo test --locked -p rh-sim --features trusted-status-probes --lib record_ability_hash_tape -- --ignored   # re-record
cargo run --locked -p rh-parity --bin hitbox-fixtures                                                         # rewrite
cargo test --locked -p rh-sim --features trusted-status-probes --lib -- guard_the_content_hash ability_hash_tape
cargo run --locked -p rh-parity --bin hitbox-fixtures -- --check
cargo test --locked -p rh-parity --test pnet2_goldens
(cd tools/unity-browser-reload-proof && node --test)
scripts/gate.sh --quick
scripts/gate.sh --regen-fixtures                                   # full: must PASS
scripts/gate.sh --oracle packet/P-FROST-WALL-2a --regen-fixtures   # must stop with exactly the refusal below
```
**The gate cannot pass `--oracle` on this branch with any documented flag.** `scripts/gate.sh:101,127-129` refuses any
changed `parity/*.json` under `--oracle`, and `--regen-fixtures` lets only `protocol/fixtures/` through; it `exit 1`s at
the path checks, before any build. The expected (and accepted) output, the only refusal:
```
GATE FAIL: captured fixtures or golden vectors changed since packet/P-FROST-WALL-2a (regenerate only via the documented commands, with --regen-fixtures for wire packets):
parity/abilities/hash-tape.json
```
Because the oracle-file check (`gate.sh:113-126`) runs just before it and would fail first, reaching this refusal also
proves no oracle file changed. The implementer reports GATE as: full `scripts/gate.sh --regen-fixtures` PASS, plus the
`--oracle` run's output verbatim. What the coordinator carries at merge: it accepts that one named refusal (the digest
test proves only `contentHash` moved in the tape), re-runs the full gate on the merge, and records the new content hash
in the MIGRATION checkpoint. (The alternative, the coordinator re-recording the tape at merge as `00f422d49` did, is not
taken: it would leave `ability_hash_tape_matches_the_base` and two oracle tests red on the implementer's branch.)

## 10. Risk and suggested model tier
Opus: low code risk (about 40 lines), but it moves an identity across five files, two of them fixtures only a recorder
may write, and the gate cannot certify the branch with `--oracle` on its own. A slip (a row in the wrong place, a
re-ordered row, a hand-edited fixture) is caught by the oracle; a deployed client built before the merge is refused.

## 11. Known traps
- Placement is the hash: rows anywhere but appended in the listed order give another value and fail
  `the_content_hash_is_the_value_of_the_appended_rows`. (The P-FROST-WALL-1c draft's trial placed them after
  `CANNON_COOLDOWN_MS` and got `af50dbaf140e4cc0`; that breaks the "append, do not shuffle" rule and is not used.)
- Leaving the old `pub const`s next to the registered ones fails `is_stray` (a registered name declared a second time);
  leaving the `NON_GAMEPLAY` rows after the consts move fails the stale-exemption check. Use `pub use` re-exports.
- `the_push_out_reads_its_named_numbers_not_literals` reads `barriers.rs` code lines (comments skipped): `(4., 96.)`,
  `96.` and `PLAYER_RADIUS + 32` must not appear in code. Comments may name legacy's `WALL_PUSH_STEP` as they do.
- Do not hand-edit the tape or `archetypes_v1.json`; their recorders' outputs must differ in one line each. A
  whitespace-only change in the tape is invisible to the digest but visible to review: the recorder's output is the
  reference.
- `hitbox-fixtures` rewrites three files; `git diff --stat` must show only `archetypes_v1.json` among them.
- `BakedContent.cs` is not part of this packet (generated at build time); do not edit it.
- `docs/MIGRATION.md:11` and `hosting/technical-demo/README.md:199` name the old value: propose, do not edit.

## Baseline (oracle author, 2026-11-14, on `47a886495`)
- `content_hash()` = `4674a176a28e3c7a` (decimal 5076860210858835066); five pinned copies exactly as listed in section 5
  (`git grep` over the tree; docs history aside).
- Oracle on the base: 6 of 8 tests red on assertions (registry rows, append order, exact value, push-out literals, hash
  moved, stale copies); 2 green guards (`every_pinned_copy_…`: all copies equal the golden today; the digest test:
  tape and archetypes unchanged). The amended lib guard is green.
- Trial implementation (section 5 exactly; discarded, not committed): `content_hash()` = `7a542a13187f034c`; each carried
  file changed by one line; `hash-tape.json` and `archetypes_v1.json` differed only in `contentHash`; `pathfinding_v2`
  and `server_walk_v2` unchanged; all 8 oracle tests, `tests/content.rs` (21), the lib guard, `ability_hash_tape…`,
  `pnet2_goldens` (2), `hitbox-fixtures --check` and the 33 reload-proof node tests passed.

## Notes from previous attempts
2026-11-14 (oracle author): lifted from `oracle-draft/P-FROST-WALL-2-content` @ `465426198`. Corrections to the draft:
(1) its trial placement (after `CANNON_COOLDOWN_MS`) contradicts the registry's append rule; this oracle pins append
at the end and the value it gives; (2) its push-out test passed `contains("WALL_PUSH_STEP")` / `("WALL_PUSH_MAX")` on
today's file through the comment at `barriers.rs:130`, so it now reads code lines only; (3) the guard in
`barriers_readers_tests.rs` (absent when the draft was written) is a sixth copy of the old value and is amended.
