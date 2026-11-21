# Elite and augment rework: plan of record (owner-approved 2026-11-18)

## Context

The owner asked (2026-11-18) to implement the elite and augment reworks in
`docs/quests/FUTURE_ONLY_Quest_Design_Discussion.xlsx`, mostly with Sonnet and Opus sub-agents. This request and the
owner's answers the same day approve the following scope.

**In scope**
- Retune the 14 live and 8 built augments to the Augment_Tuning numbers.
- Add own-card readouts (counters and pips).
- Add 5 built augments to the elite chest pool.
- Build the 13 new augments that the whitelist allows, plus Marked Man (owner addition, 2026-11-18).
- Measure elite death risk, then tune it.
- Give the elite's killer a 5 s first pick at the chest.
- Give stat stacks to every player who helped kill an elite.

**Out of scope:** keystones, stat conversions, and quests and spells.

**Why.** The workbook's actuarial pricing (Augment_Value) finds that 46 of 50 augments are worth less than a solo
elite's risk. The live pool is mostly shield and passive cards, and it offers no pivot. Augment_Tuning is the
owner-revised fix: buffs that keep each augment's intent, with readable counters. The elite changes make elites a
co-op activity with a measured risk.

**Ground truth from exploration**

Augments and cards:
- The card catalogue (`crates/rh-sim/src/cards/catalog_data.rs`) is generated from the protected legacy capture and
  pinned to it (`tests/card_catalog.rs:326`). No number can change in place.
- All 8 built augments are already implemented.
- Plant Your Feet is half ported: the range bonus and ranged weapons are missing (legacy `weapons.ts:333-340`).
- `INTERACTIVE` (`reward_chests/pools.rs:10-25`) holds no tier-3 card.
- Card ids stop at 80 everywhere:
  - `Counts` is a length-checked 80-entry list (`cards/mod.rs:20-44`). Resizing it would change every state hash.
  - `WireRewardId::Card(<80)` caps chest options at 80, and the C# and JS decoders do the same.
- `OUTGOING_ROW_CAP` is 2.5 (`constants.rs:104`; clamp at `modifiers/mod.rs:899-905`).
- Gambler uses one chance for both outcomes (`cards/mod.rs:126-129`).

Elites and chests:
- The elite chest is shared and first-come, and slot 1 is already zone-themed. Camp chests have no owner state.
- The camp bench cannot give its fighter any cards: `cards::grant` is `pub(crate)`.

Tooling:
- No tool regenerates the content hash's pinned copies.

**Live-only pattern.** A `SimConfig` enum field defaults to legacy and folds nothing into any hash (`camp_buffs`,
`frost_wish`; `statics.rs:194-360`). `SimConfig::live_content()` (`statics.rs:435`) switches it on for the server.
Parity, headless and test worlds keep legacy, so parity fixtures stay byte-identical.

## Not built

**Proposed augments.** 14 of the workbook's 28 are skipped, all of them "needs ruling". Marked Man was in that group
too; the owner added it to the build.
- **Conversions:** Heavyweight, Steel Resolve, Spellward, Momentum, Blood Pact, Arcane Edge.
- **Keystones:** Pyromaniac, Shackles, Pox Host, Permafrost, Martyr, Twin Fang, Glass Bow, Juggernaut.
- **Keystone rules:** one keystone per player, a keystone in chest slot 1, and the ~30% stack conversion on a pivot.

**Built augments outside the elite pool.** Vampiric Pact and Arcane Overload ("consider") and Glass Cannon ("do not
add") get their Augment_Tuning numbers but stay out of the elite pool.

**First-pass ideas that Augment_Tuning rejected.** Examples:
- Tenth Strike replacing Gambler. Gambler stays a gamble at 18/12.
- A Wish-triggered Second Wind. It stays automatic.
- Permanent range on Plant Your Feet.
- Stacking Hemorrhage.

## Decisions taken (reported to the owner; balance rows go to DEVIATIONS for signing)

1. Every change is live-only behind two new rules, `SimConfig::augments` and `SimConfig::elites` (`Legacy` by
   default, `Rework` in `live_content`).
   - Exception: the Plant Your Feet range port. It is legacy behaviour that was never ported, so it applies in all
     worlds.
2. Here Comes the Boom 2.6×: under Rework, `OUTGOING_ROW_CAP` rises from 2.5 to 2.6 so the buff lands.
   - `HP_RACE_CAP` stays the same, since A Race to 0 is not changed.
3. Tenth Strike: every 8th hit doubles (the Augment_Tuning number), so the card is renamed **Eighth Strike**.
4. Gambler gets separate chances: 18% double, 12% half.
5. Faction-only cards (Corpse Hoarder, Stoked, Glacier, Trophy Hunter) are offered only when every eligible picker at
   the chest is that faction.
6. "Killer" means the credited killer, the player with the most damage (`mob_life.rs:243-252`).
7. Helper share: each player in the elite camp's contributor snapshot (`mob_life.rs:199-207, 284-290`), killer
   included, gets 12 stacks (one camp's worth) of the stat the camp's normal kills pay.
8. The "average minute-5 build" is a **banked-camp build** (revised by the coordinator 2026-11-19; first version: bot
   builds sampled at minute 5 from the live soak). It follows the workbook (Augment_Value: 12 camps banked at minute 5,
   12 stacks a camp): N seeded normal camps, each paying 12 stacks of its stat, no cards.
   - The table reports N ∈ {0, 6, 12, 18}, with N = 12 the reference, plus the bot sample as one extra column.
   - Reason: all 56 minute-5 bot builds over seeds 1..80 hold no cards, since cards come only from elite chests. 39 of
     them hold no stacks, and the most any holds is 51.
   - Details: `docs/backlog/packets/P-ELITE-BENCH-1.md` section 12.
   - The bench report notes that its fighter is the scripted Brawler, which may skew death rates.
9. Marked Man takes the Augment_Tuning nerf: +50% stat stacks from kills (not double), and its holder is always shown
   on every minimap.
   - Only normal-mob kills pay stacks, so the +50% applies there. The half stacks carry over in its native counter.
   - The marker is deliberately public under C-OBS and reuses the existing public-marker path (bounty and hunt
     markers) where it can.
10. The content hash moves three times, each through one regeneration command:
   1. P-AUG-CONTENT-1
   2. P-AUG-NATIVE-1a
   3. P-ELITE-TUNE-1
   - Added 2026-11-19 (coordinator): P-AUG-TUNE-1 (two Wishful rows) and P-AUG-POOL-1 (the Eye for an Eye weight)
     each move it once more, also only through the script.

**Owner checkpoint (the one planned stop).** After wave 3 the coordinator runs the elite bench and shows the owner
the death-rate table and the proposed elite numbers. P-ELITE-TUNE-1 waits for the owner's OK.

## Architecture: two Opus seams, then Sonnet fills in data and behaviour

**P-AUG-RULES-1 (Opus) is the tuning seam.**
- Add the two rule fields to `SimConfig`. Each new non-default value folds a unique tag (`tests/hash_coverage.rs`).
  - Update the full struct literals: `rh-server` `main.rs:157`, `densitybench/engine.rs:210`, `director/tests.rs:42`
    and `tests/live_content.rs`.
- Add a derived field to `MatchStatic`: `#[serde(skip)] cards: &'static cards::Tuning`.
  - It follows the `abilities::definition_for(config, id)` pattern (`abilities/mod.rs:392`) and is built like the
    `hazards` and `blink_ring` derived fields (`statics.rs:14-96`).
  - It holds `def(id)`, named numbers (plant, gambler up and down, wishful, outgoing cap, race cap, Third Time divisor
    and multiplier) and `pool()`.
- Pass `&Tuning` into the readers that cannot reach `k`:
  - `Build::rows` (`cards/mod.rs:341` and its callers)
  - `outgoing_damage` (`modifiers/mod.rs:882`) and `execute_share` (`:674`)
  - `maximum_packet` (`:808`)
  - `kill_augments.rs:312`
  - `augment_pool` and `conditional_pool` (`pools.rs:47-74`)
- Make the cached-modifier check (`modifiers/mod.rs:185-200`) and the `maximum_packet` restore envelope rule-aware,
  the envelope over the full rework pool. Otherwise live checkpoints holding retuned or new fold cards are refused on
  restore.
- Leave `CardId::definition()` unchanged.
- Add the elite seam on `MobRuntime`. Its readers are `state.rs:1083-1127`, `mob_runtime.rs:413-427`,
  `sentenced.rs:540` and `rh-policy` `planning.rs:180-183` / `hunt_adapter.rs:286-291`.
- The override tables start empty, so there is no behaviour or hash change.
- Write a guide, `docs/agent/AUGMENT_REWORK.md`, on how to add a rework row.

**P-AUG-NATIVE-1a and 1b (Opus) are the new-augment seam.**
- **1a: ids and state.**
  - Add `CardId::NATIVE`, reserving all 14 ids (the 13 plus Marked Man). The 80-entry `Counts` stays.
  - Add a `native` count field that writes nothing when empty (the `MobRuntime::buffs` precedent, `hash.rs:36-40`).
  - Add a hand-written native table, and branch `definition()` for native ids by extending `emit_cards.py`
    (`catalog.rs` is generated).
  - Add generic capped per-player counter and meter state.
  - Add `check_world` rules: native counts are non-empty only under Rework, and each cap holds. Include the missing
    `card_tank_hp` cap rule.
  - Add the native numbers as content rows.
- **1b: hooks and readouts.**
  - Add hook points as helper calls inside existing systems, never new schedule rows (`rh-parity`
    `tests/schedule.rs:366-372`). The hooks: long-range hit, credited kill, fist hit, first kill of a mob type, hazard
    second, Wish cast, corpse harvest, landed burst, chill inflicted, hunt stack, block, overheal, hit count.
  - Pre-wire three per-batch tables (`native/weapon.rs`, `native/zone.rs`, `native/faction.rs`), each holding its own
    pool membership, so the Sonnet batches never share a file.
  - Add the own-only readout producer (C-OBS).
  - Build two exemplars: Marksman's Tally and Bastion.
  - Extend the guide and keep the `no_alloc` tests covering the new code.

## Packets

| ID | Implementer · oracle · review | Work | Depends on |
|---|---|---|---|
| P-AUG-RULES-1 | Opus · Opus · reviewer-opus | Tuning and elite seam above, guide | — |
| P-CONTENT-REGOLDEN-1 | Sonnet · Sonnet · reviewer | One documented command that recomputes the content hash and refreshes every pinned copy (list below) | — |
| P-AUG-UI-1 | Sonnet (C#) · Sonnet · reviewer | `CardDisplayCatalog.cs` text for the 22 retuned cards. Implemented at `b2fc08016` and green on its oracle; parked: the EditMode mirror test pins the client text to `catalog_data.rs` (legacy), so it merges in the same integration as CONTENT-1 | — |
| P-AUG-CONTENT-1 | Sonnet · Sonnet · reviewer | Every Augment_Tuning number as `REWORK_*` registry rows; fill the override table, including each card's rework text (the exact strings on `agent/sonnet/P-AUG-UI-1`); Boom cap 2.6; helper-share count 12; regold (move 1). Its oracle-author amends `BuildDrawerEditModeTests.cs:38` in an `oracle-amend:` commit so the client text mirrors the live (override) text | RULES-1, REGOLDEN-1; merges together with UI-1 |
| P-SIM-BENCH-SEAM-1 | Opus · Opus · reviewer-opus | Feature-gated trusted build setup (cards and stat stacks) for headless tools, in a new module | RULES-1 |
| P-AUG-PLANT-1 | Opus · Opus · reviewer-opus | Port Plant Your Feet's range multiplier for every weapon onto the pending action (`checkpoint.rs:916`) | RULES-1 |
| P-AUG-TUNE-1 | Sonnet · Sonnet · reviewer-opus | Logic that reads the new rows (details below) | CONTENT-1 |
| P-AUG-POOL-1 | Opus · Opus · reviewer-opus | `REWORK_POOL` and offer rules (details below) | CONTENT-1 |
| P-ELITE-BENCH-1 | Sonnet · Sonnet · reviewer | camp_bench elite mode (details below) | BENCH-SEAM-1 |
| P-AUG-NATIVE-1a | Opus · Opus · reviewer-opus | Ids and state above; regold (move 2) | CONTENT-1 |
| P-ELITE-SHARE-1 | Sonnet · Sonnet · reviewer-opus | Helper share (decision 7), under the elite rule | CONTENT-1 |
| P-AUG-NATIVE-1b | Opus · Opus · reviewer-opus | Hooks, batch tables, readouts, two exemplars | 1a |
| P-ELITE-PICK-1 | Opus · Opus · reviewer-opus | Killer first pick (details below) | POOL-1 |
| P-ELITE-TUNE-1 | Sonnet · Sonnet · reviewer-opus | Elite Rework numbers to the owner-approved targets; before/after bench table; regold (move 3) | Owner OK, 1a |
| P-AUG-NATIVE-2 | Sonnet · Sonnet · reviewer | Calluses; Executioner's Ledger (+3 AD per player or elite kill, cap 30); Eighth Strike | 1b |
| P-AUG-NATIVE-3 | Sonnet · Sonnet · reviewer-opus | Pathfinder (+1.2% move speed per new mob type, cap 24%); Hazard Walker; Wish Engine (percent table); Overflow (8 s fade). Opus if a hook is missing | 1b |
| P-WIRE19-A | Opus · Opus · reviewer-opus | Protocol 19 part 1 (details below) | 1a, PICK-1 |
| P-AUG-NATIVE-3b | Opus · Opus · reviewer-opus | Wish Engine (percent table), split from NATIVE-3 (coordinator 2026-11-20): it shortens the Wish cooldown, so the Wish restore envelope is redone (start from `cooldown_for` / `wish_cooldowns`) | NATIVE-3 (zone table) |
| P-AUG-NATIVE-3c | Opus · Opus · reviewer-opus | Hazard Walker's ice effect (slip immunity or resistance: reads in `systems/movement.rs` and `walk_hint.rs`), and Pathfinder's speed in the walk-prediction mirror (today the client predicts up to 24% slow and the server corrects) | NATIVE-3 |
| P-AUG-NATIVE-4 | Sonnet · Sonnet · reviewer | Corpse Hoarder, Stoked, Glacier, Trophy Hunter, with their faction offer rows | 1b |
| P-AUG-BOTS-1 | Sonnet · Sonnet · reviewer | Bot chest scoring (details below) | NATIVE-2..4 |
| P-WIRE19-B | Opus · Opus · reviewer-opus | Own-only readout rows (card, kind, value, max) beside `observe.rs:806`, in protocol 19 | 1b, WIRE19-A |
| P-AUG-NATIVE-5 | Opus · Opus · reviewer-opus | Marked Man (decision 9): +50% kill stacks, and the holder always on every minimap | 1b, WIRE19-B (`observe.rs`) |
| P-AUG-UI-2 | Sonnet (C#) · Sonnet · reviewer | HUD and chest-panel work (details below) | WIRE19-B |
| P-AUG-DOCS-1 | Haiku · — · reviewer | Docs (details below) | all |
| P-CI-GREEN-7 | Sonnet · — · reviewer | Card provenance refresh for `tools/protocol-js/check-vectors.mjs` (route of P-CI-GREEN-5; Docker recapture in the pinned image); oracle: `node tools/provenance/check-card-chain.mjs` red on that one pin | base of P-SYNC-ORIGIN-2's brief, in parallel with it; before any push |
| P-SYNC-ORIGIN-2 | Opus · — · reviewer-opus | Merge `origin/feature/unity-rework` @ `1dd79a938` as protocol 22; the rework reads the sim's step; one new test (Rework at 25 ms restores); no pinned file changes | owner's push request 2026-11-20 |
| P-CI-GREEN-8 | coordinator · — · reviewer-opus (integration 77) | `trusted_build_leak_paths` runs `cargo tree --locked` without `--offline` (PR 80's artifact jobs) | PR 80 CI |
| P-AUG-PERF-1 | Opus · — · reviewer-opus | The rework's per-step cost in legacy worlds back under perfproof's 1.03 (`Build::cards()` iterator, Plant read only on attack); oracle: perfproof vs `1dd79a938` | PR 80 CI |
| P-CI-GREEN-9 | coordinator · — · — | `tools/determinism/compare.py` accepts the replay config leaves `augments` and `elites` (null or `"rework"`) | PR 80 CI |
| P-MOB-REWIND-RESTORE-1 | Opus · Opus · reviewer-opus | Live checkpoints refused with "invalid mob rewind": a mob's rewind history can open with two equal timestamps after a reset (found by the final review: live soak seed 3, tick 1200; predates the rework). Give the mob check (`systems/mob_checkpoint.rs` ~530) the player rule (only the first pair may share a timestamp); add the site to P-TICK-1b's list | — |
| P-AUG-NATIVE-3-check | Sonnet · Sonnet · reviewer | `check_world` ties Hazard Walker's immunity bits to full meters and its counter to `min(15, floor(total/1000))` (today an upper bound only) | — |
| P-AUG-NOALLOC-2 | Sonnet · Sonnet · reviewer | `tests/native_no_alloc.rs` seats holders of every batch card (refolds, `sync_max_hp`, Overflow grant, Glacier chill, Wish Engine, Marked Man pay, elite share) | — |
| P-AUG-GUIDE-1 | Haiku · — · reviewer | Refresh `docs/agent/AUGMENT_REWORK.md` (stale lines on Wishful, faction cards, bots, Wish Engine meters, readouts, 128 identities; add Marked Man, WIRE19-B, UI sections) and the stale `live_content` comment in `statics.rs` | — |
| P-AUG-UI-4 | owner decides | The Best Offense hit marker (needs a wire fact) and Pathfinder's collection on the map: planned, deferred by P-AUG-UI-2, not built | owner |

Packet details:
- **P-CONTENT-REGOLDEN-1** pinned copies:
  - `tests/content.rs:568`
  - `frost_wall_content.rs:93/96`: retire the value pin, as `c9606e6eb` did
  - `parity/abilities/hash-tape.json` and `protocol/fixtures/archetypes_v1.json:300`: only through their documented
    commands
  - the two reload-proof `.mjs` files
  - `BakedContent.cs:6`
- **P-AUG-TUNE-1:**
  - Wishful Thinking takes 1.5% of the full cooldown per hit, at most 20% a minute. It must keep the
    `abilities/checkpoint.rs:19-40` bound, or the packet escalates to Opus.
    - Coordinator 2026-11-19: routed to Opus. The bound must accept a Wish cooldown that changes between casts.
  - Wishful's Rust override text, the C# line and the `CardDisplayReworkTests` digest move together in this packet.
  - Third Time's 2.5× and Gambler's split chances already landed with P-AUG-CONTENT-1.
- **P-AUG-NATIVE-1b and the batches** (coordinator note 2026-11-19, from the P-AUG-NATIVE-1a review):
  - `MAX_FOLD_ROWS = 79` (`cards/mod.rs`) silently truncates when full. Raise it before native cards add fold rows.
  - The Rework `maximum_packet` envelope iterates `CardId::ALL` only. Native damage rows must join it, or restore will
    refuse native-boosted packets.
  - `power()` now counts native tiers, which feeds `ledger.rs` `pvp_factor` and `higher_power`, as legacy `cardPower`
    does. That is an outcome effect once natives can be held.
  - `trusted_build::apply` (bench feature) can grant a native card in a Legacy world. Refuse native ids unless the rule
    is Rework.
  - Native `check` admits non-integral counters (Eighth Strike, Hazard Walker stacks) and does not tie Pathfinder's
    counter to its marks. Each batch packet adds its card's exact rule.
- **The batches, hook readings to confirm** (coordinator note 2026-11-20, from the P-AUG-NATIVE-1b review; each batch
  decides and pins its own reading):
  - NATIVE-3 Hazard Walker: the ice-hazard tick is read in `terrain::bog` (the per-tick move modifier), not in
    `movement.rs`.
  - NATIVE-4 Stoked: `BurstLanded` fires in `fire_roam.rs` when the burst is queued (`defer_hit`), not when it lands a
    tick later; a teleport or run end can count a burst that never hits.
  - NATIVE-4 Glacier: `ChillInflicted` fires once per ranged chill and once per tick for each attack-chill source while
    the victim's chill is below 1 (every source counts).
  - `HuntStack { stacks: 0 }` fires when hunt stacks are already at 255; a Bastion burst clipped by the PvP hit cap still
    spends the whole meter (say so in the guide if a batch builds on it).
- **P-AUG-NATIVE-3, Wish Engine** (coordinator note 2026-11-19, from the P-AUG-TUNE-1 review):
  - Today's Wish restore check (`abilities/checkpoint.rs`: `wish_cooldowns`, `prior_min`, the Rework Wishful budget
    bound) assumes a Wish cooldown only lengthens between casts. Arcane Overload is the one Wish-cooldown lever, and a
    guard test pins that.
  - Wish Engine shortens the cooldown, so the envelope must be redone for it. That probably means a per-cast budget record
    and a checkpoint-format bump. At the least, the guard must be extended to its mechanism.
  - Route that part to Opus.
  - Start from `cooldown_for` and `wish_cooldowns` (coordinator note 2026-11-20, from the P-FROST-RESTORE-1 review):
    since that fix the restore validator and the producer share `cooldown_for`; `cooldown()` is the catalog-only form.
    If Wish Engine changes what the HUD shows, `OwnerView::of` (`abilities/mod.rs`, read by `observe.rs`) and
    `rh-policy` `temporal_percept/memory.rs` still read the catalog row and need `cooldown_for` too.
- **P-AUG-POOL-1:**
  - `REWORK_POOL` is `INTERACTIVE` plus Committed, Fists of Fury, Machine Gun, Here Comes the Boom and A Race to 0.
    `INTERACTIVE` itself stays untouched.
  - Per-card offer rule: Any, or one Faction (decision 5).
  - Eye for an Eye is weighted toward players who own a returned-damage source.
  - The training console uses the rule's pool (`console.rs:69-71`).
- **P-ELITE-BENCH-1:** elite camps × factions × weapons × many seeds, with minute-5 builds, under the Rework config. It
  reports a death-rate table.
- **P-ELITE-PICK-1:**
  - Add a hashed `Chest` field, and let `validate_world` (`reward_chests/mod.rs:363-390`) accept a killer plus a camp
    under the rule.
  - Bump the checkpoint format.
  - Gate picks through the per-viewer `can_choose`, with no new refusal code.
  - Bots read `can_choose` (`rh-policy` `chests.rs:199, 258`).
- **P-WIRE19-A:**
  - Native card ids on the wire, and the first-pick end time on the chest.
  - Update the Rust, C# (`Codec.cs:9`, `StateItems.cs:157/186`) and JS (`crates/rh-server/web/probe.html`) decoders.
  - Update `rtt.rs`, `wirebench.rs` and `rh-load` `script.rs`.
  - Regenerate the v19 fixtures with `cargo run -p rh-protocol --bin protocol-fixtures`.
  - Bump the observation version and the policy contract (`collections.rs:684`).
- **P-AUG-BOTS-1:**
  - Score the 5 pool additions under Rework.
  - Native cards: `card_def` looks cards up by name in `CardId::ALL` (`choice.rs:41-46`), so it misses them.
  - Handle faction-only cards.
  - Coordinator 2026-11-19 (from the P-ELITE-TUNE-1 review): thread the elite rule into rh-policy's elite readers,
    `planning.rs` ~183 `mob_faction` and `hunt_adapter.rs` ~288 `mob_max_hp`. They still read the Legacy table, so under
    Rework bots think elites have 4/3 their real HP and 1.5× their real damage, which errs cautious. Fix the two stale
    comments that name P-ELITE-TUNE-1.
- **P-AUG-NATIVE-5:**
  - Visibility goes through the existing public-marker channel if that is enough; otherwise this packet extends
    protocol 19 with its own fixture regeneration.
  - The proof shows a non-holder viewer seeing the holder outside vision, and every other private field still hidden.
- **P-AUG-UI-2:**
  - Native card text, Marked Man's included.
  - Training-console selector generator: it asserts 80 cards and 14 pool entries; regenerate the selectors.
  - Refresh the stale `CardDisplayCatalog.cs` hash in `tools/training-console/training-console-source-pins.json:19`.
  - Extend the EditMode mirror test (`BuildDrawerEditModeTests.cs:38`, which counts `CardId::ALL` = 80) to the native
    cards.
  - HUD counters and pips, the Best Offense hit marker, Pathfinder's collection, and the first-pick countdown in
    `MatchHud.Chest.cs`.
- **P-AUG-DOCS-1:**
  - `GAME_DESIGN.md` §11 and §12.5, and the GV table at :999 (out of date: ×1.5/×1.05 and 10/30).
  - `MOB_PROGRESSION.md:38-50`.
  - `docs/quests/README.md`.

**Routing tally (implementers):** 12 Sonnet, 10 Opus, 1 Haiku.
- The Opus packets are the ones CLAUDE.md requires: state, RNG, hash, wire and cross-crate.
- Oracles follow each packet's tier.
- Every integration merge also gets a `reviewer-opus` review (CLAUDE.md). The owner asked for Opus on merges.

## Waves

At most 3 Rust implementers run at once, and no two write scopes overlap. Three lanes are serial:
- **Content:** CONTENT-1 → NATIVE-1a → ELITE-TUNE-1
- **Chest file:** POOL-1 → PICK-1
- **Wire:** WIRE19-A → WIRE19-B

| Wave | Packets |
|---|---|
| W1 | RULES-1 · REGOLDEN-1 (script) · UI-1 (C#) |
| W2 | CONTENT-1 · BENCH-SEAM-1 · PLANT-1 |
| W3 | TUNE-1 · POOL-1 · ELITE-BENCH-1, then the bench run and **owner checkpoint** |
| W4 | NATIVE-1a · ELITE-SHARE-1 |
| W5 | NATIVE-1b · ELITE-PICK-1 · ELITE-TUNE-1 (once the owner approves) |
| W6 | NATIVE-2 · NATIVE-3 · WIRE19-A |
| W7 | NATIVE-4 · BOTS-1 · WIRE19-B |
| W8 | NATIVE-5 · UI-2 |
| W9 | DOCS-1, then the final combined review |

## Coordinator steps per packet (CLAUDE.md pipeline)

Before W1:
- Record the owner's direction and the decisions above in the MIGRATION checkpoint and the `OWNER_DECISIONS.md` index.
- Add backlog rows (Phase 2 item 13: P-CARDS-2/3, P-MOBS-2).

For each packet:
1. **Oracle.** The oracle-author writes `docs/backlog/packets/<ID>.md` and the failing oracle on `packet/<ID>` from
   `feature/unity-rework`. `scripts/gate.sh --oracle-check` must pass. The oracle is a loose proof: one test of the
   workbook's numbers.
2. **Implement.** The implementer works on `agent/<model>/<ID>` in its own worktree:
   - Claim it with `scripts/agent-worktrees.sh claim`.
   - Iterate with `--quick`.
   - Finish with `scripts/gate.sh --quick --oracle packet/<ID>`.
3. **Review and merge.** The reviewer returns LAND, LAND WITH NOTES or REJECT. On LAND:
   - Merge into `feature/unity-rework`.
   - Run `scripts/gate.sh --coordinator --keep-going`, with `DATABASE_URL` from `tools/pgtest/start.sh` and
     `export PATH="$HOME/.cargo/bin:$PATH"`.
   - Have `reviewer-opus` review the merge.
   - Log to `.agent-runs/log.csv`, mark the worktree `done`, and update the checkpoint.
4. **Escalate** if needed: Sonnet → Opus → back to the coordinator.

Minor reviewer notes get no packets (owner direction 2026-11-13).

Every balance packet proposes a `DEVIATIONS.md` row; the owner signs them at the end.

Before any `git push` or merge into `main`, ask the owner.

## Verification

- **Legacy and parity.**
  - Parity fixtures, the determinism sweep and `card_catalog` stay green on every merge, which proves the default
    world is unchanged.
  - The hash tape moves only at the content moves (decision 10).
- **Live world.**
  - The `rh-headless` `source_soak` example runs clean under `live_content` (Rework) after W3, W5 and W7.
  - Restoring a checkpoint taken mid-soak works, including builds with retuned and native cards.
  - A Marked Man holder appears on every other player's minimap, and nothing else private leaks.
- **Elites.** The bench table before and after ELITE-TUNE-1 shows the reference banked-camp build (12 camps) dying 10–20% of the time
  solo, and the owner sees it.
- **Wire.** The v19 fixtures decode in Rust, C# and JS, and the server refuses protocol 18 clients.
- **Unity.**
  - Build the WebGL client.
  - Look at the chest panel (first-pick countdown) and the HUD readouts in the browser proof tool, with screenshots.
- **Final.** `reviewer-opus` reviews the whole tree, then the full gate runs, then the MIGRATION checkpoint and the
  DEVIATIONS rows go to the owner.

## Risks

- **Wishful Thinking percent** may break the checkpoint trim bound. TUNE-1 then escalates to Opus.
- **NATIVE-3** may need a hook that NATIVE-1b missed. It then escalates to Opus.
- **Three checkpoint-format bumps:** PLANT-1, NATIVE-1a and PICK-1. Old live checkpoints are refused by design.
- **The workbook's values are estimates.** Playtests will move them; they are all content rows, so later retunes are
  one-line Sonnet packets.
- **Bots misvalue the new cards** until BOTS-1 (W7) lands.

## Appendix A: Augment_Tuning (generated from the workbook, sheet Augment_Tuning, columns B-G)

The "Rework" column is the spec for P-AUG-CONTENT-1, P-AUG-TUNE-1 and the native batches. Augments under "Not built" above are listed for completeness and are not implemented.

| Augment | Group | Change | Now | Rework (Augment_Tuning) | Agency lever |
|---|---|---|---|---|---|
| Marked Man | Proposed | NERF | Double stacks from kills; always on the minimap | +50% stacks from kills (not double); still always visible | Keeps the wager, removes the runaway income |
| Committed | Built | Buff | Lock slot 2: +20% damage, +15% speed | +22% damage; slot stays locked | Same commitment, stronger payoff |
| Glass Cannon | Built | Buff | +35% damage, −25% max HP | −22% max HP | Same trade, smaller cost |
| Pathfinder | Proposed | Buff | +1% move speed per new mob type | +1.2% per type, cap 24%; collection shown on the map | Routing puzzle with visible progress |
| Machine Gun | Built | Buff | 2× speed, ½ damage, on-hit full | 55% damage per hit (was 50%) | Same rhythm, stronger payoff |
| Heavyweight | Proposed | Buff | 2% of max HP as AD | 2.5% | HP farming feeds damage |
| Marksman's Tally | Proposed | Buff | 0.25% per long-range hit, cap 25% | 0.3%, cap 30% | Same skill trigger, slightly faster |
| Twin Fang | Proposed | Buff | Both weapons, alternating; no swap | +5% attack speed; on-hit effects alternate too | Two weapons, one rhythm |
| Momentum | Proposed | Buff | +1% attack speed per 1% move speed | +1.3% per 1% | Kiting route pays off |
| Plant Your Feet | Live | Buff | Stand 1 s: next attack +25% range and damage | +35% range and damage | Same trigger, stronger payoff |
| Fists of Fury | Built | Buff | Unarmed: +40% attack speed, on-hit twice | +50% attack speed | Same commitment, stronger payoff |
| Tenth Strike | Proposed | Buff | Every 10th hit doubles | Every 8th hit | You time the strong hit |
| Glass Bow | Proposed | Buff | Pierce all; shields never work | Shields still never work; arrows lose no damage per target pierced | Same drawback, stronger payoff |
| Gambler | Live | Buff | 15% double / 15% half, pure luck | 18% double / 12% half; still pure luck | Stays a gamble (low agency by design) |
| Here Comes the Boom | Built | Buff | ½ speed, 2.5× hits | 2.6× hits | Same rhythm, stronger payoff |
| Tank Engine | Live | Buff | 1 HP per point blocked, cap +250 | 1.5 HP per point blocked; cap +350 | Same trigger (you choose to block), faster payoff |
| Arcane Edge | Proposed | Buff | 30% of AP as AD | 40% | Hybrid swapping pays off |
| Vampiric Pact | Built | Buff | +15% lifesteal, no other healing | +18% lifesteal; still no other healing | Same pact, stronger payoff |
| Hemorrhage | Live | Buff | Physical hits bleed 10% over 2 s | 12% | Same trigger, stronger payoff |
| Pox Host | Proposed | Buff | Aura, DoT 2×, healing −50% | Healing −35% | Lighter cost for the commitment |
| Overkill | Live | Buff | Overflow damage splashes 200 u | 260 u splash radius; no chain | Same trigger, wider reach |
| Calluses | Proposed | Buff | 0.05 armor per fist hit, cap 25 | 0.07, cap 30 armor | Faster investment |
| Bastion | Proposed | Buff | Next attack deals 25% of stored blocks | 35% | Defence turns into a chosen burst |
| Arcane Overload | Built | Buff | AP ×1.5, Wish cooldown ×2 | Wish cooldown ×1.5 instead of ×2 | Softer drawback; still a commitment |
| Hazard Walker | Proposed | Buff | Hazard seconds → resistance + HP | Faster growth, cap 15; immunity after 20 s on each hazard | Deliberate hazard exposure |
| Glacier | Proposed | Buff | 0.1 armor per chill second, cap 25 | 0.15, cap 30 armor | Faster investment |
| Martyr | Proposed | Buff | 30% of damage taken hits nearest enemy; no lifesteal or shafts | 35%; still no lifesteal or light-shaft healing | Same drawback, stronger payoff |
| Second Wind | Live | Buff | Once per run, auto heal 20% below 25% | Still automatic and once per run: heal 25% below 30% | Same safety net, more generous |
| Spiked Shell | Live | Buff | Melee attackers take 15% back | 20% back; still passive | Same trigger, stronger payoff |
| Stoked | Proposed | Buff | +1 AP per landed burst, cap 20 | +2, cap 30 | Rewards landing the burst |
| Third Time's the Charm | Live | Buff | Every 3rd hit doubles on-hit effects | Every 3rd hit applies on-hit effects 2.5×; visible pips | Same trigger; readable rhythm |
| Steel Resolve | Proposed | Buff | +1% damage per 10 armor | Per 6 armor | Tank route pays off sooner |
| Corpse Hoarder | Proposed | Buff | +2% HP per corpse, cap 20% | +3%, cap 24% | Faster investment |
| Overflow | Proposed | Buff | Overheal shield fades over 5 s | Fades over 8 s | More time to use the shield |
| Best Offense | Live | Readability | Blocks count as hits | Unchanged effect; a hit marker shows when a block counts as a hit | Readability: you can see the synergy work |
| Spellward | Proposed | Buff | +1 AP per 10 magic resist | Per 6 magic resist | Battlemage route pays off sooner |
| Pyromaniac | Proposed | Buff | Ember trail, −20% direct damage | −10% direct damage; ember lasts longer | Area denial you place |
| Permafrost | Proposed | Buff | Chill on hit; you always slide | You still always slide, but stop in half the distance | Same drawback, smaller |
| Slow Burn | Live | Buff | DoT lasts 2× after break-off, −30%/s | Only −15% per second after break-off | Same trigger, stronger payoff |
| Blood Pact | Proposed | Buff | +3% HP per lifesteal point | +4% | Sustain route pays off |
| Wishful Thinking | Live | Buff (rework) | −1 s Wish cooldown per hit (≤30 s/min) | −1.5% of full cooldown per hit (≤20%/min); same for every faction | Aggression; removes the Fire bias |
| Wish Engine (percent) | Proposed | Buff | Cap −20% Wish cooldown | Cap −25% (still above the 50% floor) | More reward for using your Wish |
| Eye for an Eye | Live | Pool weighting | Returned damage applies on-hit (needs a source) | Unchanged effect; offered more often to players who own a returned-damage source | Stays a build-around; easier to find |
| Siphon | Live | Buff | DoT heals 20% | 25% | Same trigger, stronger payoff |
| Executioner's Ledger | Proposed | Buff | +1 AD per player/elite kill | +3 AD per player or elite kill only (cap 30) | Same trigger, stronger payoff |
| Shackles | Proposed | Buff | Chain 2 s, −15% move speed | −8% move speed | Lighter cost for the commitment |
| Juggernaut | Proposed | Buff | Immune to slow, knockback, pull; −15% move speed | −8% move speed | Lighter cost for the commitment |
| Trophy Hunter | Proposed | Buff | 0.5% damage per hunt stack, cap 10% | 2% per stack, cap 15% | Makes hunting worth it |
| Pocket Sand | Live | Buff | Blocks slow attacker 30% for 1 s | 40% slow for 1.5 s | Same trigger, stronger payoff |
| A Race to 0 | Built | No change | Damage dealt/taken × 1/health fraction | Leave as is: the symmetric risk is the point | — |
