# P-FACTION-5 — Bruiser/champion passives (Frozen Justice slice DONE-VERIFIED; packet INCOMPLETE)

Phase: stage 2, wave 3, backlog [P-FACTION-5](../../backlog/README.md) ("Bruiser/champion passives"; deps P-FACTION-1 and
P-CARDS-1, both landed). **No packet file exists** — the scope below is derived from the backlog row, the actual
`packages/server/src/sim/bruiserPassives.ts`, `packages/shared/src/championPassives.ts`, `docs/BRUISER_PASSIVES.md` and the
legacy tests. Branch `deepseek/p-faction-5`, based on `origin/deepseek/p-mobs-1` at `039ceb47` (line A, protocol 7); the
PR is stacked on `deepseek/p-mobs-1`.

Pull request: [#47](https://github.com/Nevanyte/RougeHalla/pull/47), stacked on the P-MOBS-1 PR #41; commit range
`039ceb47`..`fb2488e0` on `deepseek/p-faction-5`. Ledger row:
[`docs/evidence/deepseek-rust/PROGRESS.md`](../deepseek-rust/PROGRESS.md).

## Verified state at the base (code, not memory)

The schedule still held **nine pending rows** for the module: `bruiserPassives.update` in `AFTER_WEAPONS` and in
`SYSTEMS`, `bruiserPassives.frozenJustice` in `MOD_SOURCES`, `resetRun` on `RAID_STARTED` and `RUN_ENDED`,
`bruiserPassives.<arrow>` on `FIGHTER_OUT` and `CAMP_CLEARED`, `noteLedgerContact` on `HIT_LANDED` and
`noteBlockedContact` on `BLOCKED`. The champion-passives pieces were already landed by earlier packets:
`holyLeechRowsOf` (`HOLY_LEECH_ROW_MULT` in the Holy after-damage), and `frostChillBonusOf` (the fold definition's
`frost_sd/frost_as/frost_cap` consumed by `modifiers::frost_chill`). The **unported remainder is Frost's Frozen Justice and
Holy's Demon Blood camp progression**.

## What landed: Frost Frozen Justice (DONE-VERIFIED)

New `crates/rh-sim/src/systems/bruiser.rs`, wired only through the nine flipped rows (C-TICK; no reorder):

1. State and lifecycle — `FrostGuard { active, until }` on `Player` (the source's private `frostEliteUntil` map plus the
   synced `PlayerState.frostEliteGuard`). `update` runs twice exactly where the source pushes it (after weapons, and again
   after the ledger so a contact this tick reaches the mirror before `mods.updateMods`): a non-Frost, non-alive or non-active
   seat drops the clock and clears the flag; a live Frost seat re-arms its clock when `lockedElite` holds; the flag is
   `until > now`. A flag change refolds the player's stat mirrors at once (source `setFrostGuard` -> `recomputeMods`).
2. Lock test — exactly the source: faction Frost, a weapon target lock on a live hostile **elite** mob, the active weapon's
   `engageRange` (arc reach + player radius; projectile range + player radius + ranged slack), and line of sight under
   `reachMask` (melee mask for arc weapons, sight mask for ranged). Quest givers/evading targets do not exist in the admitted
   domain (source `isEvading` is a stub too).
3. Contacts both directions — `hitLanded` notes `entry.by <-> entry.victim` and `blocked` notes
   `holder <-> attacker`; only a real `elite` mob qualifies, only for a live Frost player, and the clock restarts at
   `now + FROST_ELITE_GUARD_LINGER_MS` (2 s). Hits on normal camp mobs, non-Frost seats and the arena's own damage never arm
   it (the last has no ledger entry through these hooks at all).
4. Defense fold — the `frozenJustice` source returns the `FROST_ELITE_GUARD_BONUS` (25) armor and shield for a live guarded
   Frost seat, so the standard defense mirror (and its shared bonus-defense cap/order) is the only carrier. To keep
   checkpoint validation honest for a *positive* source, `Runtime::valid` now allows the armor/shield wire to include the
   bounded passive (armor within `base..=base+25`, shield `base..=base+25`, every other bound exact); the comment names the
   passive as the one positive contribution.
5. Resets — a contact refreshes but never extends past the linger by itself; `fighterOut` drops one seat's clock and only
   refolds when the flag actually changed (source `clearPlayer` -> `setFrostGuard(false)`); `raidStarted`/`runEnded` clear
   every seat's clock/flag and refold every player; the `campCleared` link re-runs `update` (the source chains the whole
   update there).

### Gate and plan

The legacy install condition is `config.signatures: true`, but the P-FACTION-1 capture module set (`HOLY_MODULES`) does
**not** install `bruiserPassives`, so gating the newly ported rows on `Gate::Signatures` would run them in frozen fixtures that
never had the module — a parity probe proved exactly that (a run-end refold of a stale mirror changed
`plague_multisource_lethal` tick 141 armor). The port therefore:
- adds `Gate::Bruiser` + `Gates.bruiser`: on in `PRODUCTION` and `TRAINING` (the source installs it with the signature
  layer there), off in `CAPTURE`, `HOLY_FOUNDATION`, `MOB_FOUNDATION` and `MOB_BASIC_FACTIONS` (their captured worlds do not
  install it), and on in the new `MOB_FROST_FOUNDATION` plan;
- the only Rust world class that selects that plan is PvE + `FactionMode::EngagementHolyPlagueFireFrost`. To admit the
  Frozen Justice witness, `systems/mobs.rs` gains `admitted_player_faction`: a Frost **player** seat is admitted in a PvE
  world only at that engagement level, while camp zones must stay basic Fire/Plague/Holy and regional Frost/Sentenced mob
  content stays excluded (the existing pending signatures). `sim.rs` uses the same rule for reset/join.

No protocol, decoder or observation change: `frostEliteGuard`/`campClears` stay off protocol 7 like the accepted
P-FACTION-1/2 client-mirror omissions; the authoritative effect is replicated through the standard defense mirror and the
damage ledger. No wire rule triggered, so the base stays `deepseek/p-mobs-1` (line A, protocol 7).

## Captured legacy corpus (pinned container only)

`tools/bruiser-fixtures/capture.mts` + `capture.sh` capture nine cases in the pinned Linux x64 Node 22.23.4 image
(`node:22.23.4-bookworm-slim@sha256:aaa4b5ba...`): `parity/bruiser/frozen-justice.json`, sha256
`b8e8c99ecd05403631080c318a6120828ceadbd73d5a67aeb5616677c3f89868`. The declared map input is byte-identical to the
admitted Rust map fixture (`mob-pve-map.json`, sha256 `5ee388ca...`) and spawns the elite `mob1` at (144,112) and the camp
roster. Every case replays a fresh world and records the real public state after every operation (weapon lock,
`frostEliteGuard`, `defenseOf()` armor/shield): idle, elite-lock guard, hit-contact linger boundary (tick 40 true / 41
false), normal-mob hit, Holy hit on the elite, blocked contact, death clear, run-end clear, and the camp-cleared link.
The recorder asserts Node/platform/arch, replays every case twice byte-identically and hashes the full TS source closure.

The native comparison is `crates/rh-sim/src/systems/bruiser/tests.rs`: it builds the same PvE world from the admitted map
and the same secrets, asserts the elite/roster spawn, replays every declared operation through the ported rows and
compares every frame; it also restores a guarded checkpoint and continues (hash and guard identical across steps and the
run-end boundary), proves the gate keeps the passive off with the capture plan, and kills four mutants (flipped guard,
nudged armor, mislabelled lock, truncated case).

## Identity moves the coordinator records

- `CHECKPOINT_FORMAT` `rh-checkpoint/20` -> `/21` (the new hashed `Player.frost_guard`; checkpoint/hash-coverage/CPU
  pins updated, one new `VALIDATED` row documents the guard refusal for non-Frost seats).
- The content registry gains `FROST_ELITE_GUARD_BONUS` (25) and `FROST_ELITE_GUARD_LINGER_MS` (2 000): `content_hash` moves
  `0x9f7a0ff31bf3b6d4` -> `0xbd45f7c6b835f5e9`.
- The Rust-only ability per-tick hash tape is re-recorded on this branch for the layout move (cases/tick counts unchanged;
  no legacy corpus regenerated).
- `Gate::Bruiser` is a new row-condition bit; the legacy condition it represents (installed under `signatures:true`) is
  preserved by the production/training plans. The coordinator should record the bit and the PvE admission widening.

## Tests and gate

- `cargo test --workspace --all-features --locked` (pinned throwaway PostgreSQL): **1,434 passed, 0 failed, 3
  ignored, 151 test binaries, exit 0**.
- `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings`: **clean, exit 0**;
  `cargo fmt --all -- --check` clean.
- Focused: `systems::bruiser` 4/4 (captured corpus, restore/continue, gate-off, mutants); `rh-parity` schedule 14/14;
  the slice fixture comparison 29/29 (the bruiser gate keeps the old faction fixtures byte-identical); P-MOBS-1's mob
  lifecycle corpus still passes (its plan keeps the gate off).

## Remaining (packet INCOMPLETE)

**Holy Demon Blood is blocked on P-MOBS-2**, not on a design question: the source adds `0.5 percentage points of lifesteal
per camp clear` (`holyCampLifestealOf(campClears)`, uncapped by the card/farm ceiling but still through the lifesteal
multipliers) where `campClears` is credited by `campHeal.payCampHeal` (row still `Pending P-MOBS-2`, which also owns the camp
potion and the `campsCleared` player-runtime count the mirror and the `scale src:"campsCleared"` card rows read). Without that
producer the consumer cannot be exercised by any ordinary trace, so this packet leaves it pending instead of installing a
placeholder state; `resetRun`/`update` and the `campCleared` link carry their `Partial` markers with `P-MOBS-2` as the
pending remainder where the source also syncs the camp mirror. Also still outside: regional Frost/Sentenced mob content
(the PvE admission keeps camps basic), the training/quest mob creators (P-ARENA-2/P-QUEST-1), and the client HUD mirror of
the synced counters. No `docs/MIGRATION.md`, `docs/CONTRACTS.md` status table, `Cargo.lock` or `packages/` edit; no merge.
