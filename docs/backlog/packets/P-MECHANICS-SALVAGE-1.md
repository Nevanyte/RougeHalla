# P-MECHANICS-SALVAGE-1: the on-hit rules of `fix/mechanics-sim` (Best Offense block hits, Eye for an Eye returned on-hit, axe shred k, Fire backlash as returned damage)

- **Serves:** owner beta-follow-up decision 1 (MIGRATION, 2026-11-10: "classes are balanced pretty close to the old
  version"); owner request 2026-11-12 ("merge all backend unmerged branches"); finding of the branch triage
  (`.agent-runs/archive/branch-ledger-2026-11-12.tsv`, row `fix/mechanics-sim`: KEEP, needs an Opus packet)
- **Implementer tier:** implementer-opus (rh-sim combat rules on the ledger's `hitLanded` / `blocked` hooks)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework (`c21d662e`)
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10): ported by reading the legacy code, one sanity test
  per mechanic within 15 % of a legacy number; existing parity fixtures stay green · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
`fix/mechanics-sim` (gated on 2026-11-10 with `integration/launch-fixes`, never merged; tip `456d5a28`, merge base with
the integration branch `976a6559`) ports legacy combat rules the integration branch lacks. The oracle author's triage
(section A below) split them into three packets. **This packet is the first group, the source `runOnHit` path**: when
it lands,

- a Best Offense holder's block is its own blow: Hemorrhage and every on-hit row apply to the blocked attacker at once;
- returned damage (a riposte, Spiked Shell, a reflected arrow, and Fire's backlash) runs the Eye for an Eye holder's
  on-hit rows with `streak = false`: no hit-multiplier division of the bleed, no Third Time's the Charm;
- the axe's shred is `AXE_SHRED_ARMOR * k` (k = on-hit power x applications, so a Third Time's the Charm hit shreds 6),
  applied inside `runOnHit` after the victim's hitTaken triggers, and also on an Eye for an Eye holder's returned
  damage named with the axe;
- Fire's backlash is classed as returned damage (`outgoingKindOf`), so the above reaches it.

Groups 2 and 3 are ready briefs: [P-MECHANICS-SALVAGE-2](P-MECHANICS-SALVAGE-2.md) (block and riposte bookkeeping),
[P-MECHANICS-SALVAGE-3](P-MECHANICS-SALVAGE-3.md) (camp-clear and Wish bookkeeping).

**Effect on class feel, honestly stated:** none of the branch's mechanics changes a faction's base numbers. Every live
effect is card-specific (Best Offense, Eye for an Eye, Third Time's the Charm, Machine Gun / Here Comes the Boom with
returned damage, Hemorrhage), plus Fire's backlash only for an Eye for an Eye Fire. The owner's "classes do not feel
like the old game" is unlikely to be explained by this branch alone.

## A. Inventory of `fix/mechanics-sim`

`git log --oneline --no-merges 976a6559..fix/mechanics-sim`:

| Commit | What |
|---|---|
| `364c9dd0` | bruiser camp-clear mirror (P-MOBS-2 rows), Holy camp lifesteal, armWishes effect refresh, cardHooks.resetAll DoT crit memory, Best Offense block hits and block bookkeeping; content hash `a2d1022e` -> `6f485ce5` |
| `c4913a0d` | `Sim::camp_clears` public accessor, rh-server trophy fixture, evidence |
| `6cdfbd68` | returned on-hit `streak = false`, axe shred `armor * k` inside `run_on_hit`, riposte returned mult; new capture `parity/card-onhit/source.json` |
| `8e4523e6` | Fire backlash classed as returned (`outgoingKindOf`); new capture `parity/card-onhit/backlash.json` |
| `1363bb4c`, `456d5a28` | evidence README only (`docs/evidence/fix-mechanics-sim/README.md`) |

Since `976a6559` the integration branch changed, of the branch's files, only `constants.rs` (Holy constant),
`kill_augments.rs` (+tests), `observe.rs`, `systems/items.rs` (`drop_body` potions), `systems/regen.rs` and
`systems/signatures.rs` (Holy lifesteal). `cards/*`, `melee.rs`, `projectiles.rs`, `ledger.rs`, `bruiser.rs`,
`status/mod.rs` and `schedule.rs` rows are as the branch found them, so its code for groups 1-3 still applies cleanly
(verified for group 1: `git apply` of its `on_hit.rs`/`items.rs` diff plus the `on_blocked` hunk passes this oracle).

| # | Mechanic (one line) | Legacy source | Rust files on the branch | On the integration branch | State / RNG / `content!` / schedule | Capture on the branch | Group |
|---|---|---|---|---|---|---|---|
| 1 | Bruiser camp-clear mirror: `PlayerState.campClears` synced from `PlayerRuntime.campsCleared` | `server/src/sim/bruiserPassives.ts:59-69` (update), `:101-113` (resetRun), `:124-126` (campCleared/raidStarted/runEnded links) | `systems/bruiser.rs` (`camp_clears`), `schedule.rs` (5 rows Partial -> Ported), `sim.rs`, `kill_augments*`, `rh-parity/tests/schedule.rs` | **Superseded in live**: `systems/signatures.rs::after_damage` and `kill_augments.rs::Readable.camp_clears` read `Player.camps_cleared` directly (P-HOLY-DEMON-BLOOD-1). Live is `MobMode::Pve` + full factions -> `Gates::MOB_FROST_FOUNDATION`, `bruiser: true`, where the mirror equals the count. Only difference: worlds without the Bruiser installer (capture profiles) where legacy's mirror stays 0. The 5 schedule rows are still `Partial("P-MOBS-2")` | no state, no RNG, no constant; schedule rows flip | `parity/holy-camp-lifesteal/source.json` (new; not to be brought) | 3 |
| 2 | Holy camp lifesteal 0.005/clear | `server/src/sim/factions.ts:896`, `shared/src/championPassives.ts:6-9` | `constants.rs` (`HOLY_CAMP_LIFESTEAL_PER_CLEAR`), `signatures.rs`, `kill_augments.rs` | **Already present** (P-HOLY-DEMON-BLOOD-1: `constants.rs` `HOLY_CAMP_LIFESTEAL_PER_CLEAR`, `signatures.rs::after_damage`, `kill_augments.rs::invested_scores`; DEV-012 resolved 2026-11-11). Dropped | the branch's only `content!` row; dropping it means **no group moves the content hash** | as #1 | dropped |
| 3 | armWishes: `refreshEffects` for every player after the reset | `server/src/sim/abilities.ts:84-99` (`:97`) | `systems/status/mod.rs::raid_started`, `schedule.rs` (row Partial -> Ported), `rh-parity/tests/schedule.rs` | **Partly**: `status/mod.rs::raid_started` arms the Wish clocks and clears casts/statuses; refreshes effect bits only when a status was removed (a pending cast's bit can survive). Row `Partial("P-ABIL-1")` | effect bits are already hashed state; no new state | none (uses `parity/abilities` 63 base cases already present) | 3 |
| 4 | cardHooks.resetAll clears the DoT crit memory too | `server/src/sim/cardHooks.ts:75-79`, `cardState.ts:24` (`critAccDot`, `dotRollTick`, `dotCrit` live in `rt.cards`) | `cards/runtime.rs::reset_player`, `schedule.rs` (row Partial -> Ported) | **Not present**: `reset_player` keeps `core.card_dot_crit`. Row `Partial("P-CARDS-1")` | existing hashed state | none | 3 |
| 5 | Best Offense: a block is a hit (`runOnHit` with the holder's `packetFor`) | `server/src/sim/cardHooks.ts:186-216` (`:206-214`) | `cards/mod.rs::on_blocked`, `cards/on_hit.rs::block_hit` | **Not present**: `on_blocked` has Tank Engine and Pocket Sand only | no state, no RNG, no constant (row `cardHooks.onBlocked` flips in group 2 with the pending note) | `parity/card-runtime/source.json` case `real-block-pending-best-pocket-tank-wish` (already on integration) | **1** |
| 5b | Best Offense pending note: every hooked block counts for the streak / Wishful Thinking (reflected arrows, every world) | `cardHooks.ts:206-214` (push), `:319-323` (read) | `melee.rs`, `projectiles.rs`, `signatures.rs` (`BlockContact.hooked`), `cards/after_damage.rs` | **Partly**: contacts recorded only when `faction_mode.engagement()`, reflected arrows dropped (`!b.passive`) | scratch only | as #5 | 2 |
| 5c | Card `isWeaponHit` excludes `passive` (returned) and `derived` hits | `server/src/sim/cardHooks.ts:292-293` | `cards/after_damage.rs`, `signatures.rs` (`LandedHit.passive/derived`, `serde(skip)`), `ledger.rs`, test helpers in `frost.rs`, `regen.rs` | **Not present**: a sword riposte counts as a streak hit and a Wishful Thinking trim | scratch only | as #5 | 2 |
| 6 | Returned on-hit: `runOnHit(..., streak = false)` (no hit-mult division, no charm) | `server/src/sim/cardHooks.ts:116-126` (`:125`), `onHit.ts:35-41`, `:60` | `cards/on_hit.rs::{apply, run_on_hit}` | **Partly**: returned hits run the rows for Eye for an Eye, but divide by the holder's hit mult and count the charm | none | `card-runtime/source.json` `returned-eye-spike-no-recursion` (integration); `card-onhit/source.json` `returned-eye-third-charm-not-counted` (branch only) | **1** |
| 7 | Axe shred `= special.armor * k`, inside `runOnHit`, also on returned damage | `server/src/sim/onHit.ts:47-55`, `shared/src/weapons.ts:118`, `shared/src/constants.ts:303-305` | `cards/on_hit.rs::run_on_hit`, `systems/items.rs` (`axe_shred` removed) | **Partly**: `systems/items.rs::axe_shred` applies a flat `AXE_SHRED_ARMOR` before hitTaken, never on returned damage | none (`AXE_SHRED_*`, `PLAIN_ON_HIT_POWER` exist) | `card-onhit/source.json` `axe-shred-third-charm` (branch only) | **1** |
| 8 | Riposte carries the holder's `returned` mult (Boom x1.25) | `server/src/sim/melee.ts:84-90` (`:88`) | `systems/melee.rs::resolve_swings` | **Not present**: `raw * SHIELD_BLOCK_SHARE * RIPOSTE_SHARE` | none | `card-runtime/source.json` `returned-eye-spike-no-recursion` | 2 |
| 9 | Fire backlash is returned damage | `server/src/sim/mods.ts:639-644` (`:641`) | `cards/on_hit.rs::apply` | **Not present**: a backlash (sig set, not passive) is "no hit" | none | `card-onhit/backlash.json` (branch only) | **1** |

Newer owner decisions checked: none of these mechanics is changed by DEV-009/010/011 (hitboxes; the tests here run
`LegacyCircle`, the default), DEV-017 (regen in combat), or the 2026-11-12 terrain decision (`Mode::Map`). DEV-012 is
resolved by P-HOLY-DEMON-BLOOD-1, which is why #2 is dropped. No `DEVIATIONS.md` row is needed: every group moves Rust
toward legacy.

## B. Split and order

| Packet | Mechanics | Rust files (write scope) | Why this order |
|---|---|---|---|
| **P-MECHANICS-SALVAGE-1** (this) | #5, #6, #7, #9 | `cards/on_hit.rs`, `cards/mod.rs` (`on_blocked`), `systems/items.rs` (`hit_landed`, `axe_shred`) | Largest live effect: every Best Offense block now bleeds/slows the attacker (shield builds), Eye for an Eye bleeds were 2x too big under Machine Gun and 0.4x under Boom, Third Charm axe hits shred double, Fire+Eye backlash gains on-hit. One file pair, the source `runOnHit`. |
| [P-MECHANICS-SALVAGE-2](P-MECHANICS-SALVAGE-2.md) | #5b, #5c, #8 | `cards/after_damage.rs`, `systems/melee.rs`, `systems/projectiles.rs`, `systems/signatures.rs` (`BlockContact`, `LandedHit`), `systems/ledger.rs`, test helpers in `systems/frost.rs`, `systems/regen.rs`; `schedule.rs` row `cardHooks.onBlocked` | Streak / Wishful Thinking counting and the Boom riposte: smaller, card-specific. Collides with nothing in group 1. |
| [P-MECHANICS-SALVAGE-3](P-MECHANICS-SALVAGE-3.md) | #1, #3, #4 | `systems/bruiser.rs`, `systems/status/mod.rs`, `cards/runtime.rs`, `schedule.rs` (rows), `crates/rh-parity/tests/schedule.rs` | No live balance effect (mirror equal to the count in live; edge cases at raid start). Bookkeeping: flips the last `Partial` rows of P-MOBS-2, P-ABIL-1, P-CARDS-1 (`resetAll`). |

Groups 2 and 3 both edit `schedule.rs` (different rows): merge them one at a time. Group 1 does not touch it.

## 2. Dependencies
none. Strictly serial with any other packet that edits `cards/on_hit.rs`, `cards/mod.rs` or `systems/items.rs`
(P-CAMP-BUFF-THEMES-1, P-FROST-WALL-1 if they do).

## 3. Relevant legacy paths
- `packages/server/src/sim/onHit.ts:35-41`: `onHitApplications` (1, +1 Fists of Fury on an empty hand, +1 Third Charm
  on every third hit in a row only when `countStreak`; 1 for a non-player).
- `packages/server/src/sim/onHit.ts:47-73`: `runOnHit`: standing victim; `k = (spec?.onHitPower ?? 1) * applications`;
  axe shred `add.per = special.armor * k` (`:53-55`); card rows, bleed raw `(raw / (streak ? hitMult : 1)) * scale *
  phys * per * k` (`:60-61`).
- `packages/server/src/sim/cardHooks.ts:116-126`: `onHitLanded`: `outgoingKindOf`; hitTaken for a hit; `runOnHit(...,
  true)` for a hit, `runOnHit(..., false)` for returned damage of an Eye for an Eye player.
- `packages/server/src/sim/cardHooks.ts:206-214`: Best Offense: `hasFlag(blockHits) && standing(holder)`, weapon in hand,
  `runOnHit(holder, attacker, {weapon, packet: packetFor(holder, weapon), scale: 1}, true)` (the `pending` push is group 2).
- `packages/server/src/sim/mods.ts:639-644`: `outgoingKindOf`: dot, then returned (`sig === "backlash"` or `passive`),
  then hit (no sig, no ability, a weapon).
- `packages/shared/src/weapons.ts:89-125` (on-hit power: sword 1.5, fists 1.2, others 1; axe special shred),
  `packages/shared/src/constants.ts:303-305` (`AXE_SHRED_ARMOR 3`, `AXE_SHRED_MS 3000`, `AXE_SHRED_CAP 6`),
  `packages/shared/src/cards.ts:253-264` (Boom, Machine Gun), `:364-376` (Charm, Eye, Best Offense), `:406-409` (Hemorrhage).
- Reference port: `git diff 976a6559 fix/mechanics-sim -- crates/rh-sim/src/cards/on_hit.rs crates/rh-sim/src/systems/items.rs`
  plus the last hunk of the same diff of `crates/rh-sim/src/cards/mod.rs` (the `block_hit` call in `on_blocked`).

## 4. New paths
- none (the oracle file below is committed by the oracle author).

## 5. Exclusive write scope
- `crates/rh-sim/src/cards/on_hit.rs`
- `crates/rh-sim/src/cards/mod.rs` (`on_blocked` only; the `mod on_hit_salvage_tests;` line is the stub's)
- `crates/rh-sim/src/systems/items.rs` (`hit_landed`, `axe_shred`)

No content hash move: the group adds no `content!` constant (`PLAIN_ON_HIT_POWER`, `AXE_SHRED_*` and
`content::on_hit_power` exist). For the record, the content hash (`b35f23ed00df75b3`) is pinned by
`crates/rh-sim/tests/content.rs` `GOLDEN_CONTENT_HASH`, `parity/abilities/hash-tape.json` (its recorder),
`protocol/fixtures/archetypes_v1.json` (`cargo run -p rh-protocol --bin protocol-fixtures`),
`tools/unity-browser-reload-proof/{check.mjs,normal-companion.mjs}`, and the Unity `BakedContent.cs` written by
`client-unity/UnityProject/Tools/build-web.sh` (that file holds `0x7d2d84b827af3ddc` today, already stale before this
packet); none of them may change in this packet.

## 6. Contracts and references
- C-TICK: everything stays on the existing `hitLanded` (in the pass, statuses deferred to the pass end) and `blocked`
  (outside the pass, applied at once) hook links; no row moves. C-RNG: no draw added or removed.
- No new serialized state: no checkpoint, replay, observation or protocol identity changes.
- The Holy camp lifesteal (`HOLY_CAMP_LIFESTEAL_PER_CLEAR`) stays as on the integration branch.

## 7. Behaviour to preserve
- A plain weapon hit's bleed, shred and hitTaken order for players without these cards (parity report all MATCH).
- `packetFor` for a fighter without a faction sheet: `{raw: 0, phys: 1}` on the block path, never a panic (the branch's
  `block_hit` does this; `modifiers::packet` `expect`s a faction).
- `tests/cards_no_alloc.rs`, `tests/no_alloc.rs`: zero allocations per step (the branch keeps fixed-size row arrays).

## 8. Acceptance checks
- The oracle tests below pass: `cargo test -p rh-sim --lib on_hit_salvage` (4 mechanic tests, 2 guards).
- `cargo test -p rh-sim --features trusted-status-probes` and `cargo test -p rh-sim --test content` pass.
- `cargo run -p rh-parity --bin parity-report`: all MATCH, no fixture regenerated (none is expected to move: the branch
  with all three groups reported all MATCH).
- `scripts/gate.sh --oracle packet/P-MECHANICS-SALVAGE-1` passes.
- The camp-clear bench (P-BALANCE-2, `camp_bench`) before and after, reported in the hand-off (expected: little or no
  change, since only fighters holding these cards are affected; not measured by the oracle author).

### Sanity numbers (legacy, worked by hand; the tests allow 15 %)
| Test | Legacy number | Source of the number | Before this packet |
|---|---|---|---|
| `best_offense_block_bleeds_the_blocked_swordsman` | bleed 4.321875/s on the swordsman (shield raw x phys = 86.4375; x 0.1 x k 1 / 2 s) | `parity/card-runtime/source.json` `interactive-choice-and-runtime-bestOffense` (same seats and cards) | none |
| `eye_for_an_eye_returned_bleed_ignores_the_holders_hit_mult` | 0.11256976744186048/s (sword raw x 0.07 x 0.5 x phys x 0.1 / 2, Machine Gun's x0.5 hit mult not divided out) | `card-runtime/source.json` `interactive-choice-and-runtime-eyeForAnEye` | 0.22513953488372096 |
| `the_axe_shred_doubles_on_a_third_charm_hit` | first axe shred 6 = 3 x k 2 | `fix/mechanics-sim:parity/card-onhit/source.json` `axe-shred-third-charm`, tick 27 | 3 |
| `fire_backlash_applies_eye_for_an_eye_on_hit_effects` | shred 3 and bleed 4.82545899632803/s on the attacker | `fix/mechanics-sim:parity/card-onhit/backlash.json` `fire-backlash-eye-for-an-eye`, tick 2 | neither |
| guard `guard_eye_for_an_eye_plain_riposte_bleed_matches_the_capture` | 0.11256976744186048 within 1 % | as above | passes |
| guard `guard_a_block_without_the_cards_bleeds_nobody` | no bleed | `cardHooks.ts:125`, `:206` | passes |

The branch's own tests (`cards/block_witness_tests.rs`) replay its new captures frame by frame; they are not ported:
the owner direction of 2026-11-10 asks for no new pinned captures and no tick-exact matrices, and the exact replays
couple all three groups (the `returned-eye-spike` case also needs group 2's riposte mult). Their scenarios and legacy
numbers are reused above.

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/cards/on_hit_salvage_tests.rs`
- `docs/backlog/packets/P-MECHANICS-SALVAGE-1.md`, `docs/backlog/packets/P-MECHANICS-SALVAGE-2.md`,
  `docs/backlog/packets/P-MECHANICS-SALVAGE-3.md`

## 9. Validation commands
- `cargo test -p rh-sim --lib on_hit_salvage`
- `cargo test -p rh-sim --features trusted-status-probes`; `cargo test -p rh-sim --test content`
- `cargo run -p rh-parity --bin parity-report`
- `scripts/gate.sh --oracle packet/P-MECHANICS-SALVAGE-1`

## 10. Risk and suggested model tier
Opus. The code is on the branch and applies cleanly, but it rewrites the `hitLanded` card hook (`apply` becomes the
whole source `onHitLanded`, `run_on_hit` shared with `block_hit`) and moves the axe shred from `systems/items.rs` into
it, after the victim's hitTaken triggers: status application order inside one pass is behaviour.

## 11. Known traps
- The bleed tag is `bleed:<tick>`: a Best Offense block bleed and an Eye for an Eye riposte bleed on the same tick
  accumulate into one instance (legacy `returned-eye-third-charm-not-counted` shows 4.434 = 4.322 + 0.113). The tests
  isolate the two cards for that reason.
- The charm reads the streak memory as the pass began (`streak_before`); a returned hit and a block hit never write it
  here (group 2 owns the pending note).
- `outgoingKindOf` order matters: a DoT signature is "dot" before "returned"; a `derived` or `arena` entry sets off nothing.
- Changing fight length for these builds changes card-specific observations only; no faction baseline moves.

## Notes from previous attempts
