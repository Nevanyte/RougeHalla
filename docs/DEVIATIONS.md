# Deviation ledger

The parity invariant is **"byte-exact legacy behaviour except where this ledger records an owner ruling."** Any
intentional difference between the Rust port and the frozen legacy source lives here. A difference that is not in this
file is a parity bug, not a deviation.

Status: **seeded 2026-11-07 from existing ADRs and CONTRACTS notes; the owner has not yet signed off the seeded rows.**
The "Owner" column is blank until the owner confirms each one. Rows marked "unverified" are my reading of the docs,
not a re-check against code.

## Rules

1. A deviation needs an entry **before** it merges. The entry names the legacy behaviour, the Rust behaviour, the reason
   and the parity artifact that changes (fixture, scenario or comparison filter).
2. Only the owner approves an entry. Workers and reviewers may propose; they cannot rule.
3. Categories: **privacy** (C-OBS fixes, no balance effect), **bug-fix** (legacy defect with no intended behaviour),
   **balance** (player-visible numbers or timing change) and **platform** (storage, identity, transport).
   A **balance** entry must also state how it was re-validated; "no harness available" is a blocking answer, not a pass.
4. Parity scenarios that cover a deviation compare the Rust side to the **legacy capture filtered through the entry**,
   never to an edited capture. State the filter in the entry.
5. Reversal: delete the row's Rust change and the filter together; keep the row, mark it `Reverted` with a date.

## Entries

| ID | Category | Legacy behaviour | Rust behaviour | Reason / evidence | Re-validation | Reversibility | Owner |
|---|---|---|---|---|---|---|---|
| DEV-001 | privacy | Signature damage chunks are filtered at flush time; a chunk that mixes hidden and visible earlier damage can disclose hidden damage (e.g. 12.147 vs 8.098 against a visible 4.049). | `FxProjector` projects each contribution at its own settled tick; unseen sources are redacted before keys form; anonymous sources merge. Trusted totals, order and flush timing keep source semantics. | [ADR 0013](adr/0013-temporal-damage-projection.md); actual-source pair test. | Public-view only; gameplay totals unchanged and parity MATCH. | permanent (privacy) | pending |
| DEV-002 | privacy | Mark tie order uses JS string `<` on arbitrary IDs; a hidden tied owner can win the raw selection, then redaction suppresses a visible owner's identity. | Select among **eligible (visible) owners** at the public max tier; lowest numeric runtime ID wins. | [ADR 0014](adr/0014-sentenced-public-state.md); `tools/sentenced-fixtures/public-pairs.ts`. | Private state, damage and credit unchanged; the parity harness reconstructs the lexical order for comparison only. | permanent (privacy) | pending |
| DEV-003 | bug-fix | A stored Mark tier/owner waits for the next `syncVisuals` pass after a between-step departure. | Public observations derive surviving owners immediately; no departed marker identity persists. | ADR 0014 (last paragraph). | Presentation only. | reversible, presentation only | pending |
| DEV-004 | privacy | A failed hidden-ID guess changed 33 tile deadlines and 13 later visible cells (reproduced). | Prospective-view rule commits only legitimate visibility; concealed and missing probes are equal. | [CONTRACTS.md](CONTRACTS.md) C-OBS (Stage 2 targeting note). | Reproduced legacy side effect; supported positive timing preserved. | permanent (privacy) | pending |
| DEV-005 | privacy | Status-field IDs come from the shared `nextId` counter, so publishing them leaks gaps from unseen entities. | `Observation.fields` carries no runtime field ID; owner/subject are redacted and sorted by public facts only. | [ADR 0017](adr/0017-visible-status-fields.md) (**Provisional**). | None needed beyond C-OBS tests. | permanent while provisional ADR holds | pending |
| DEV-006 | platform | Sentenced and PlayerId tie rules use string order on source IDs. | Rust `PlayerId` is monotonically allocated numeric identity; private ties use the numeric correction (the "C3" precedent). | ADR 0014. | Fixture IDs `p<n>` live only in the parity harness. | permanent (platform) | pending |
| DEV-007 | platform | Legacy callsigns are case-sensitive. | The new store is case-insensitive. | Listed as an owner decision in [MIGRATION.md](MIGRATION.md) known gaps. | n/a | reversible with a store migration | owner decision recorded in backlog list (confirm) |
| DEV-008 | privacy | Item and chunk visibility identity details (unverified; the "hidden-ID side effect" may be DEV-004 only). | Check whether a second hidden-ID case exists before closing this row. | Placeholder from the critique. | – | n/a | pending |
| DEV-009 | balance | Melee rewinds the attacker's own origin with its targets: `origin = attacker.positionAt(now - lag)` (melee.ts:53). | With `SimConfig::lag_fairness` the swing starts at the attacker's tick-start position (`position_at(now - TICK_MS)`), the place its own prediction drew it; targets are still rewound by the attacker's lag, capped at `MAX_REWIND_MS`. Identical when the lag is the one-tick baseline (no `t`, a `t` at most one tick old, or a lock). | [NETCODE_COMPETITIVE_PLAN.md](NETCODE_COMPETITIVE_PLAN.md) Wave 2 (owner-approved 2026-11-09): up to 17-50 u of self-position error on chase swings. `crates/rh-sim/src/systems/melee.rs`. | Native `crates/rh-sim/tests/lag_fairness.rs` (chase swing at 200/300 ms hits; baseline lag bit-identical events and state hash). The flag is off in the parity harness, recordings and headless, so every legacy fixture runs unfiltered; no balance harness yet (open question 2). Victim: unchanged, its rewind was already the accepted policy. | reversible: the flag | pending |
| DEV-010 | balance | Arrows and wand balls launch at the clock from the present position and meet bodies only at present times; ranged players must lead by their view lag (about 34 u at 100 ms RTT). | With `lag_fairness` a player's shot is launched `lag - TICK_MS` back (whole 10 ms sub-steps, at most `MAX_REWIND_MS - TICK_MS` = 250 ms) and flown to the clock at once with the normal stretch, wall and body tests, bodies and homing sampled at each sub-step's past time; it meets no other flight while catching up. `ProjectileLaunch.time` is the back-dated time. Zero catch-up at the baseline lag; mobs (lag 0) and locks never catch up. | Plan Wave 2. `systems/projectiles.rs` (`catch_up`), `systems/weapons.rs`. | `lag_fairness.rs`: at 100 and 200 ms a shot at the aim the shooter saw hits exactly where a one-tick shooter's shot hits against the drawn track; legacy needs a lead; lag above 300 ms equals 300; replay bit-identical. Victim: can be hit up to 250 ms after leaving the line, never further back than the melee rewind; the arrow first appears up to 225 u (wand 95 u) out from the bow. Walls are the current map. Not re-validated for balance (no harness). | reversible: the flag | pending |
| DEV-011 | balance | A unit-target Wish (Freeze, Trial) checks range and line of sight at intake and landing against the target's present position. | With `lag_fairness` both checks use the target rewound by the cast's clamped lag (`CastDetail.lag_ms`, already recorded). Vision, hostility, immunity and untargetable stay present-time checks, so the rewind never reaches a target the caster cannot see. Identical at the baseline lag. | Plan Wave 2. `systems/abilities/mod.rs` (`unit_valid`). | `lag_fairness.rs`: a cast on a runner just out of range at 200 ms is accepted; at baseline it is not. Effects still apply to the target where it is now. | reversible: the flag | pending |
| DEV-012 | balance | Every Move/AttackMove takes effect at the next step boundary and walks exactly one tick, whenever in the 50 ms tick (and however long before, by the sender's uplink) it was issued. | Protocol 15 `MoveAt`/`AttackMoveAt` (commands 19/20) carry the client's issue time `t` (server-time estimate without the interpolation delay). The room clamps `t` into the connection's RTT-bounded render-time window (`rtt.rs`, counted in the rewind-clamp telemetry); with `SimConfig::lag_fairness` (on only in the live server's runtime profiles) the sim gives a walker that stood still through the whole previous tick (no path, no slide, last two history samples and position equal) a one-off credit `clamp(now - TICK_MS - t, 0, TICK_MS)` and walks `TICK_MS + credit` in the ordinary `walk_one` along the ordinary planned path. A moving walker (the credit would count time it spent walking its old path), a Stop, a non-player actor and any map with slippery terrain earn nothing. Unstamped orders are untouched; the stamp is recorded in the validated command (replays, checkpoints). | [NETCODE_COMPETITIVE_PLAN.md](NETCODE_COMPETITIVE_PLAN.md) Wave 3 (owner-approved): up to 50 ms of order timing for an order that starts a walk. `crates/rh-sim/src/systems/inputs.rs` (`walk_credit`), `systems/movement.rs` (`walk`). | `crates/rh-sim/tests/move_stamp.rs`: a stamp that earns no credit is the unstamped match bit for bit (state hash); credit is exact, capped at one tick for any forged stamp, zero for a walker that moved; alternating forged MoveAt/Stop never outruns continuous walking; one credited tick lands exactly where two ordinary ticks do (same path, no corner cut); replay and checkpoint bit-identical. With the flag off (parity, headless, recordings, tests) every stamp is the plain order bit for bit (`without_lag_fairness_every_stamp_is_the_unstamped_match_bit_for_bit`); legacy fixtures never carry a stamp anyway. `rh-server` `a_live_runtime_room_has_lag_fairness_and_credits_a_stamped_order`: the live profile has the flag and a forged stamp buys exactly the one-tick cap. An honest client's stamp lags the server clock by its downlink, so above about 50 ms RTT nearly every idle start earns the full tick: in practice a fixed one-tick head start for an idle walker, the same for every client. Not done: a direction change while walking and Stop (both would need a rewind of the walk already taken). | reversible: the flag, or the client sends Move/AttackMove | pending |

## Not deviations (inherited on purpose)

| Item | Why it is here |
|---|---|
| The secret order salt is observable through tied outcomes (legacy behaviour, C-RNG). | Documented as inherited; changing it is owner decision 14 in the backlog README. |

## Open questions for the owner

1. **Capture-only scenarios (13).** These cannot be compared. For each, record: mechanic, why capture-only, and whether it
   is balance-significant. If any is, it needs its own row here as a "ported on faith" entry. Not yet audited.
2. **Balance re-validation (confirmed 2026-11-07).** The legacy harness exists only under `packages/server/src/harness/`
   (`duel.ts`, `matrix.ts`, `factionCycle.ts`, `kiting.ts`, `zoneDuel.ts`, `questBench*.ts`). A search of `crates/` and
   `tools/` for TTK / time-to-kill / win-rate finds nothing, so there is no Rust equivalent. Until one exists, a
   `balance` entry cannot be re-validated; DEV-001 to DEV-006 avoid this because they change presentation or identity
   only. Proposed packet: **P-BALANCE-1**, a duel/matrix harness over `rh-headless`, gated on the same edge and TTK
   targets the legacy harness reports. Not yet written.
3. **Design changes after the freeze.** Rows here cover port-time corrections. Post-baseline design changes (Sentenced
   redesign, controls rework) need a separate freeze/crossover rule; this ledger does not decide that.
4. Confirm or delete DEV-008.
