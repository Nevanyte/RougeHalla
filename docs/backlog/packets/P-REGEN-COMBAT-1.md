# P-REGEN-COMBAT-1: passive regeneration out of combat only (live profiles)

- **Serves:** not in ORDER_OF_OPERATIONS: owner beta-follow-up decision 2 (MIGRATION, 2026-11-10, "Port all three
  unreleased legacy changes"), the "no regen in combat" change; loose proof (decision 9).
- **Implementer tier:** implementer-opus (rh-sim config, hashed and checkpointed)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Unreleased legacy commit `f8cd956e` (`origin/claude/adoring-edison-mxt8ab`) sets `PLAYER_REGEN_SHARE_IN` to 0: a player
heals passively only after 3 s with no hit dealt or taken (0.8% max hp/s, unchanged), and nothing while fighting. When
this lands, every live profile (`rh-server --runtime source-arena` and `--runtime training`) plays that rule through a
new `SimConfig::regen_in_combat = Off`. The default stays `Legacy` (the in-repo legacy oracle, 0.25%/s in a fight), so the
parity fixtures, sealed corpora, content hash and every existing state hash are unchanged.

**Why a switch and not the constant.** The legacy commit is not in `packages/`. Applying it there changes
`packages/shared/src/constants.ts`, whose SHA-256 is pinned by 218 captured files; `rh-sim/tests/mob_catalog.rs`
re-hashes the live file and about 40 CI `capture.sh --check` steps embed it, so one value would force a recapture of all
of them. Changing only the Rust constant would make the regen capture and the two regen-on corpora (owner-combat-farm,
mark-tax-uncapped) disagree with the legacy oracle. The switch follows `SimConfig::mob_spacing` (cd71ea1c, DEV-011):
the default serializes as null and folds nothing into the statics digest; the other value is folded into the state hash,
checkpoints and replays; the server's live profiles opt in.

## 2. Dependencies
None. Independent of P-WIRE17-HUD-1.

## 3. Relevant legacy paths
- `packages/server/src/sim/regen.ts:31-35` (share selection; f8cd956e adds `if (share <= 0) continue;`)
- `packages/shared/src/constants.ts:662-668` (regen constants; f8cd956e sets `PLAYER_REGEN_SHARE_IN = 0`)
- `git show f8cd956e` for the exact legacy diff (constants, regen.ts, regen.test.ts, README)

## 4. New paths
None.

## 5. Exclusive write scope
- `crates/rh-sim/src/statics.rs` (`RegenInCombat`, `SimConfig::regen_in_combat`), `crates/rh-sim/src/lib.rs`
  (re-export), `crates/rh-sim/src/systems/regen.rs`
- `crates/rh-server/src/runtime.rs` (live profiles opt in)
- Mechanical: every full `SimConfig { .. }` literal gains `regen_in_combat` (the files `mob_spacing` touched, e.g.
  `crates/rh-server/src/{main,room,director,wire}.rs`, `crates/rh-server/tests/*.rs`)
- `crates/rh-sim/tests/hash_coverage.rs` (the `Off` state), `docs/DEVIATIONS.md` (a proposed row)

## 6. Contracts and references
- C-PARITY: legacy-mode fixtures stay untouched and green; DEVIATIONS rule 4 (parity runs the `Legacy` default, which is
  the filter).
- Determinism: a new serialized leaf reaches save, restore and the state hash (`Off` folded; `Legacy` folds nothing, as
  `MobSpacing::Auto`).

## 7. Behaviour to preserve
- Default (`Legacy`): byte-identical behaviour, statics digest, state hashes, content hash, checkpoints and replays.
- Out-of-combat pace, 3 s quiet window, hit stamping, locked-coliseum and down-player rules, raid-start reset, quiet heals.

## 8. Acceptance checks
- `scripts/gate.sh` passes (full).
- Oracle: a `systems/regen.rs` test: with `regen_in_combat = Off`, a stamped attacker and victim regain nothing inside the
  quiet window while an untouched player regains `PLAYER_REGEN_SHARE_OUT`; once the window ends they regain the out share.
- `hash_coverage`: `Off` changes the state hash and serializes as `"off"`; `Legacy` serializes as null.
- `runtime.rs`: the source-arena and training profiles carry `Off`.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/systems/regen.rs` test additions (commit `oracle: P-REGEN-COMBAT-1`)

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes regen`, `cargo test -p rh-sim --test hash_coverage`,
  `cargo test -p rh-server runtime`, `cargo run -p rh-parity --bin parity-report`

## 10. Risk and suggested model tier
Low behaviour risk; medium bookkeeping (a serialized config field). Opus per routing for hashed state.

## 11. Known traps
- The default must serialize as a unit so existing checkpoints, replays and hashes keep their value (copy `MobSpacing`).
- `packages/` stays unchanged. If legacy `packages/` ever takes f8cd956e, flip the default and retire the switch together.

## Notes from previous attempts
None.
