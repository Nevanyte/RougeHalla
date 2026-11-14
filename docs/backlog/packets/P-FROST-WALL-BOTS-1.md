# P-FROST-WALL-BOTS-1: bots aim Frost Wall as legacy's bots do (a peel between themselves and a chaser, and an escape)

- **Serves:** owner beta follow-up decision 2 and decision 8 (bots; the learner and tuner runs wait for this packet)
- **Implementer tier:** implementer-opus
- **Reviewer:** reviewer-opus
- **Integration base:** `6a476dc54` (the coordinator's staging head; the live world plays Frost Wall since P-FROST-WALL-3)
- **D-rules touched:** D1 loose proof against legacy `78dd8bd4` (`abilityPolicy.ts` and its test, ported case by case) ·
  D2 n/a · D5/D6/D9: none (a bot decision rule plus one public, room-wide fact handed to the seat: see "Seat input")

## 1. ID and outcome
In a room whose Frost Wish is Frost Wall (`SimConfig::frost_wish = Wall`: every live profile since P-FROST-WALL-3,
and the Brain tournament/tuner world), a Frost bot of either stack (`HumanBot`, the live fill bot; the Brain) casts
its Wish as legacy's bots do: when the nearest enemy player is chasing it from 56 to 260 u away, it drops the wall
70% of the way to that enemy (a point cast, no unit id); when it is in trouble (legacy's escape rule) it drops it the
same way between itself and the threat (or, with no player in view, what it fights); it never casts the wall at an
enemy that stands off, at one closer than 56 u or farther than 260 u. In a Freeze room nothing changes: every Freeze
decision, every captured corpus and every `parity/policy/` capture stays bit-identical.

## 2. Dependencies
P-FROST-WALL-3 (in the base: the live world plays the wall; `crates/rh-headless/tests/frost_wall_live.rs`).
Serial with anything touching `crates/rh-policy/src/bots/wish.rs`, `wish/source_core.rs`, `lib.rs` (`MatchStart`) or
`temporal_percept/brain/compose14.rs`.

## 3. Relevant legacy paths
Legacy's rule is in the unreleased commit `78dd8bd4` (NOT merged into `packages/`; read with
`git show 78dd8bd4:<path>`). Line numbers are of that commit.
- `packages/server/src/bots/abilityPolicy.ts:54-58`: `WALL_PEEL_DISTANCE = 260`, `WALL_PEEL_MIN = 56` (comment: "not
  closer than WALL_PEEL_MIN, where it would land on us too"), `WALL_PEEL_SHARE = 0.7`.
- `:92-94` `wallOf(effects)`: the rank has an effect `do: "wall"`. The rule is keyed on the EFFECT, not the ability id
  (D29: "never by ability id").
- `:96-101` `wallBetween(rule, s, t)`: `null` unless `rule.kind === "point"` and `WALL_PEEL_MIN <= t.d <=
  WALL_PEEL_DISTANCE` (both bounds INCLUSIVE: the test is `t.d < 56 || t.d > 260`); else
  `k = Math.min(rule.range, t.d * 0.7) / t.d` and the point is `{ x: me.x + (t.x - me.x) * k, y: me.y + (t.y - me.y) * k }`,
  with no `id`. No line-of-sight test, no map test, no RNG.
- `:63-87` `decideCast`: casting bit or a `blockedBy` bit (stun, silence) refuses; then the def's `ai` tags in order,
  first non-null wins. `frostWall.ai = ["peel", "escape"]` (`packages/shared/src/abilities.ts:260-271` of `78dd8bd4`:
  point target `range 450, minRange 64`, cast 250 ms, cooldown 45 s, `effects: [{ do: "wall", ms: 4000, length: 224 }]`,
  `blockedBy` the Wish set, `dropsLock: false`, `flat: true`).
- `:164-174` `peel(rule, effects, s)`: `t = s.threat` (the NEAREST enemy player); `null` unless `t` exists, `t.chasing`
  and `t.targetable !== false`; for a wall `return wallBetween(rule, s, t)` with `t.d` as the threat carries it. The
  unit branch's `PEEL_DISTANCE = 150` cap does NOT apply to the wall (it is tested after the wall return). No `los`
  test for the wall.
- `:113-141` `escape(rule, effects, s)`: `trouble = (hpFrac < 0.5 && threat && threat.d < 260) || (hpFrac < 0.55 &&
  recentlyHit)`; not in trouble: `null`; a self rule casts self, a unit rule `null`; then `from = s.threat ?? s.foe`
  (`null`: `null`); for a wall `return wallBetween(rule, s, { x: from.x, y: from.y, d: Math.hypot(from.x - me.x,
  from.y - me.y) })`: the distance is RECOMPUTED with `Math.hypot`, `chasing` and `targetable` are NOT read, and `from`
  may be the goal's foe, a MOB included (`foe.mob` is not checked here). A wall never reaches the blink headings.
- `engage`/`control` are not in the wall's tags: a foe standing off (or a `foe` with no `threat`) draws no wall.
- `packages/server/src/bots/brain/modules/wishes.ts:104-113` (`chasing`, unchanged by the patch): an enemy is chasing
  when `toward = (vx * (me.x - f.x) + vy * (me.y - f.y)) / f.dist >= 20` u/s AND `toward / speed > 0.7`, OR it hit the
  bot within `recentHitMs = 1500` and `f.dist <= onItDistance = PEEL_DISTANCE = 150`. `vx, vy` are the percept's
  (`frames.ts` velocity: the displacement over two samples 100 ms apart). `:131-148` `castSituation`: `threat` is the
  nearest alive enemy player (`fighters`), with `d: near.dist`, `chasing`, `id`, `los`, `targetable`.
- `wishes.ts:161-165` `playedDef`: Easy keeps only `escape`/`sustain` tags, so an Easy Frost bot walls only to escape.
- `wishes.ts:213-245` `castIntent`: a choice with no `id` becomes `{ kind: "cast", slot: "wish", x, y }` (a ground
  click, the humanizer's ground scatter applies; the server clamps the aim to `[minRange, range]` along the line).
- Legacy BotClient (`packages/server/src/bots/BotClient.ts`) casts no Wish; the Brain module is the only legacy caller
  of `decideCast`. Both Rust stacks are ports of that one module and already share one core (`wish/source_core.rs`).
- Legacy's own test: `packages/server/test/abilityPolicy.test.ts:217-231` of `78dd8bd4` (`ME = (640, 320)`, `calm` =
  full hp, not hit; `threatAt(d)` = an enemy `d` u east, `chasing: true`, targetable):
  chasing at 200 casts at `(ME.x + 140, ME.y)` with no id; `chasing: false` at 200: null; at `WALL_PEEL_MIN - 1` (55):
  null; at `WALL_PEEL_DISTANCE + 1` (261): null; `hpFrac 0.3, recentlyHit`, threat at 150 NOT chasing: `(ME.x + 105,
  ME.y)`; `foe` at 200 and no threat: null. `:235` the per-faction table: Frost casts with `calm({ threat: threatAt(200) })`; `:50-60` "never while the bot cannot cast" runs every Wish (the wall included) in `trouble(0)` (hp 0.2, hit, a chasing threat and a foe at 100): it casts; stunned, silenced or casting: null.
- `packages/server/test/bots/wishes.test.ts` of `78dd8bd4` only pins the module test file back to Freeze
  (`useLegacyFreeze()`); it has no wall case.

## 4. New paths
- `crates/rh-policy/src/bots/frost_wall_bots_tests.rs` (oracle): the rule, the HumanBot seat, the guards.
- `crates/rh-policy/src/bots/temporal_percept/brain/frost_wall_brain_tests.rs` (oracle): the Brain's composed percept
  and its decision path.
- `crates/rh-headless/tests/frost_wall_bots.rs` (oracle): the release-only end-to-end check.

## 5. Exclusive write scope
- `crates/rh-policy/src/bots/wish.rs` (the Frost Wall policy row, `wish_for`, the Easy filter, `WishModule` learning
  the room's Frost Wish, `static_rank`'s wall flag, the `WALL_PEEL_*` constants).
- `crates/rh-policy/src/bots/wish/source_core.rs` (`wall_between`; the wall branches of `peel` and `escape`; `admit_ranks`
  carries the flag) and its in-file tests' literals only.
- `crates/rh-policy/src/bots/bot.rs` (`HumanBot::reset` hands `MatchStart::frost_wish` to its Wish module).
- `crates/rh-policy/src/bots/brain_bot.rs` (`BrainBot::reset` hands it to its composer).
- `crates/rh-policy/src/bots/temporal_percept/brain/compose14.rs` (`wish_record` emits the Frost Wall def when the
  composer's Frost Wish is the wall; `Composer14::with_frost_wish`).
- `crates/rh-policy/src/bots/temporal_percept/brain/adapters.rs`, `crates/rh-policy/src/bots/temporal_percept/modules/source_input.rs`
  (parse a declared `do: "wall"` effect into `AbilityRank::wall`), `crates/rh-policy/src/bots/temporal_percept/modules/wishes.rs`
  (`declared_rank` passes it on), `crates/rh-policy/src/bots/temporal_percept/modules/types.rs` (the field's doc).
- `crates/rh-policy/src/lib.rs`: the doc comment of `POLICY_CONTRACT_VERSION` / `MatchStart::frost_wish` only.
- Not: the sim, the wire, `content.rs`, `observe.rs`, `rh-protocol`, `Cargo.lock`, any `parity/` capture, any oracle
  file, any other test file (the stub commit already made every mechanical edit to existing tests: see 8).

## 6. Contracts and references
- C-INPUT: the wall is an ordinary `PublicCommand::Cast { slot: Wish, x, y, id: None }` through `validate` + `submit`.
- C-OBS: the seat decides on its own observation (positions, observed velocity, own hit memory) plus ONE public room
  fact, the room's Frost Wish, which every human client receives in the Welcome (HUD term 23, `wire_hud_for`). See
  "Seat input" below.
- R-ML: a hand rule ported from legacy; nothing learned.
- C-POLICY / `POLICY_CONTRACT_VERSION`: see "Seat input" (a conflict with the coordinator's expectation is flagged).
- DEV-029 (Frost Wall) and P-FROST-WALL-3's "Bot evidence" (the bots' wasted walls today).

## 7. Behaviour to preserve
- Every decision under `FrostWish::Freeze`, and every decision of the other four Wishes under either setting: the same
  choice on the same percept, bit for bit. Guarded by the existing `wish_parity_tests.rs`
  (`every_captured_cast_decision_matches_the_source` over `parity/policy/bot-wish.json`, 100+ cases, all Freeze-era
  defs), `wish_module_tests.rs`, `wish/source_core.rs` tests, `temporal_percept/modules/{catalog,source,controls}_tests.rs`
  (the `bot-private-modules` corpus), `temporal_percept/brain/{tests,controls_tests,hand_tests}.rs` (the
  `bot-private-brain` corpus), the compose14 tests, `crates/rh-headless/tests/{bots,brain_choices,tournament}.rs`
  (default world: Freeze), and the new guards in the oracle files.
- RNG: legacy's rule draws nothing; this packet adds no draw to the decision. The humanizer's ground click (motor lane)
  replaces the lock click for a wall, as legacy's hand does for any point cast; only in a Wall room.
- `parity/policy/**` and `parity/**`: untouched; `cargo run -p rh-parity --bin parity-report` all MATCH.
- `WISHES` stays the five catalog rows (the corpus test iterates the captured defs; the Brain's `catalog_wish` looks
  rows up by name). The wall row is a separate constant reached through `wish_for`.

## 8. Acceptance checks
- `cargo test --locked -p rh-policy frost_wall` (every new test green; the guards were green before).
- `cargo test --locked -p rh-policy` green (no existing test changed beyond the stub commit's mechanical edits).
- `cargo test --locked --release -p rh-headless --test frost_wall_bots --test frost_wall_live` green.
- `cargo test --locked --release -p rh-headless --test brain_choices --test brain_bots --test bots` green.
- `scripts/gate.sh --oracle packet/P-FROST-WALL-BOTS-1` passes (full).

## Oracle files (read-only for implementers)
(filled in by the oracle commit)

## 9. Validation commands
- `export PATH="$HOME/.cargo/bin:$PATH"`
- `cargo test --locked -p rh-policy frost_wall`
- `cargo test --locked -p rh-policy`
- `cargo test --locked --release -p rh-headless --test frost_wall_bots --test frost_wall_live`
- `cargo test --locked --release -p rh-headless --test brain_choices --test brain_bots --test bots`
- `cargo run -p rh-parity --bin parity-report`
- `scripts/gate.sh --oracle packet/P-FROST-WALL-BOTS-1`

## 10. Risk and suggested model tier
Opus (bot priority, two stacks, a seat-input field). The rule is twenty lines; the risk is in the plumbing: a Freeze
decision that moves (the corpus guards catch it), the Easy filter that is indexed by `WISHES` position (a sixth row
outside `WISHES` returns `None` there), and the Brain's def that is rebuilt from the catalog in `compose14.rs`.

## 11. Known traps
(see "Established facts")

## Established facts (oracle author, 2026-11-14, base `6a476dc54`)

### (1) Scope: both stacks, one shared rule
- Legacy has ONE rule (`abilityPolicy.ts` `decideCast`) and ONE caller (`brain/modules/wishes.ts`); the legacy
  BotClient casts no Wish.
- Rust already has ONE core both stacks call: `crates/rh-policy/src/bots/wish/source_core.rs:137-164` (`decide_cast`).
  HumanBot enters it through `wish.rs:289-308` (`decide_cast_with`, from `WishModule::cast_intent`, `wish.rs:531-588`,
  over the static row `wish_by_id(view.ability)`, `:539`); the Brain enters it from
  `temporal_percept/modules/wishes.rs:319-399` (`cast_intent`, over the declared `extras.wish.def` read by
  `read_declared_ranks`, `:73-81`). So the rule is ported once (`wall_between` plus two branches in `source_core.rs`)
  and each stack needs only to KNOW that its Wish is the wall:
  - HumanBot: `wish_by_id` keys on `AbilityId`, and the sim stages the wall under `AbilityId::Freeze`
    (`crates/rh-sim/src/abilities/mod.rs:389-397` `definition_for`); the observation's Wish code is Freeze's (0) in a
    Wall room. HumanBot needs `wish_for(id, frost_wish)` (the Frost Wall row when `id == Freeze && frost_wish ==
    Wall`) and the room's `frost_wish` at reset.
  - Brain: its def is rebuilt from the same catalog in `compose14.rs:1725-1816` (`wish_record`, `wish_by_id(id)`), and
    parsed back in `adapters.rs:1174-1290` / `modules/source_input.rs:2600-2660` (`AbilityRank`: `hides_caster`,
    `blink`; no wall). It needs the Frost Wall def emitted (`ai: ["peel","escape"]`, point `450/64`,
    `effects: [{do:"wall", ms: 4000, length: 224}]`), the `wall` effect parsed into `AbilityRank`, and the room's
    `frost_wish` at reset.
- Size estimate: rule 40 lines, HumanBot 50, Brain 60, seat input 15, plus the stub's mechanical edits (already done):
  about 200 lines. **Decision: one packet covers both stacks.** HumanBot matters first (live players meet it); the
  Brain is what the learner and tuner will run, and the owner's plan starts those runs only after this packet, so
  splitting would leave the tuner on the wasted wall.

### (2) "Chasing" and "escaping" from a fair observation
| Legacy input (`wishes.ts`) | HumanBot (`wish.rs` `cast_situation`, `:662-733`) | Brain (`modules/wishes.rs` `cast_situation`, `:189-225`) |
|---|---|---|
| `near` = nearest alive `fighters` row | nearest alive `Percept.fighters` (`:684-688`) | `nearest_enemy` (`:107-118`) |
| `f.vx, f.vy` (frames.ts: displacement over 100 ms) | `FighterView.vx/vy` = the seat's own displacement of that actor between its last two decisions (`perception.rs:241-242`, `velocity(.., dt)`) | `ModuleFighter.vx/vy` = composer velocity over two delivered samples 100 ms apart (`compose14.rs:1526-1550`) |
| `mem.fighters[id].hitMeAt` | `WishModule.fighter_hits` from the seat's own `Hit` fx (`wish.rs:471-492`, `perception.rs` hit events) | admitted `Memory.fighters[*].hit_me_at` |
| `mem.self.lastHitAt` (`recentlyHit`) | `WishModule.last_hit_at` | `Memory.self.last_hit_at` |
| `hpFrac`, own effect bits | `self_view.hp/max_hp`, `effects` | `self_.hp_frac()`, `own_bits` |
| `targetable` | `FighterView.targetable` (alive and no untargetable bit) | `ModuleFighter.targetable` |

Both `chasing` computations already exist and equal legacy's (`wish.rs:690-704`, `modules/wishes.rs:122-144`); they
are computed today for Freeze's peel. Nothing about chasing or escaping needs an observation change: velocities are
the seat's own successive observed positions. No sim state is read.

### (2b) Seat input: what the seat is NOT given today, and the honest fix
- A human client learns Frost's Wish from the Welcome's HUD term 23 (`crates/rh-policy/src/delivery/projection.rs:703-771`
  `wire_hud_for`, read by the room at `crates/rh-server/src/room.rs:656` from `self.sim.config().frost_wish`).
- A policy seat is NOT given the Welcome: `MatchStart` (`crates/rh-policy/src/lib.rs:58-98`) carries `me`, `seed`,
  `arena`, `content_hash`, `observation_version`, `tick_ms`; `content_hash()` is a static fold (no config); the
  delivered `Frame14` (`delivery/frame.rs:244-260`) has no HUD content; the owner's Wish slot carries Freeze's code in a
  Wall room (the sim keeps the id). A seat could only infer the wall after its first wall stands (field kind 3 in
  State key 3), i.e. after the first cast is already wasted.
- Fix chosen (in the stub): `MatchStart` gains `pub frost_wish: rh_sim::FrostWish`, filled by `MatchStart::of` from
  `sim.config().frost_wish`: the same value the room puts in every human's Welcome, room-wide and public (C-OBS holds).
  Every live and headless seat is built through `MatchStart::of` (`rh-server/src/room.rs:1011,1257`,
  `rh-headless/src/lib.rs:156`, `wirebench.rs:272`), so no crate outside `rh-policy` changes. Struct-literal
  constructions exist only in `rh-policy` tests (six sites: the stub sets them to `FrostWish::Freeze`).
- **Contract version (flag for the coordinator):** the brief was asked to keep `POLICY_CONTRACT_VERSION` at 24 as "a
  decision rule, not the seat interface". The rule itself is versionless, but the seat interface DOES gain a field:
  the history in `lib.rs:26-54` bumps on every seat-input addition, including ones "bots do not decide on" (v19-v24),
  and v2 was the `MatchStart` change. Attach compatibility is not affected (a policy that ignores the field is
  unchanged; `attach_fault` compares only numbers). This packet keeps 24 as instructed: no oracle test pins a new
  number, and the implementer adds one line to the v24 note naming `MatchStart::frost_wish`. If the coordinator rules
  that a seat-input field must bump, eight existing tests pin 24 (`lib.rs:1900`, `tests/frost_wall_delivery.rs:23`,
  `tests/hud_*.rs`, `tests/quest_carrier_delivery.rs`) and must change with owner approval.

### (3) Freeze: nothing changes
- The `parity/policy/` captures that exercise Wish decisions: `bot-wish.json` (`wish_parity_tests.rs`, the static
  rows and 100+ cast decisions, all five catalog defs, captured before the wall existed), `bot-private-modules/`
  (`temporal_percept/modules/{catalog_tests,source_tests,controls_tests}.rs`, the Brain module replay through
  `source_core`), `bot-private-brain/` (`temporal_percept/brain/{tests,controls_tests,hand_tests}.rs`). All run the
  catalog rows / captured defs, none carries a `do: "wall"` effect, so the new branch is unreachable for them as long
  as (a) `wall` defaults to false everywhere a def is not the Frost Wall row and (b) `WISHES` keeps its five rows.
- `crates/rh-headless/tests/{bots,brain_choices,tournament}.rs` run the default world (`FrostWish::Freeze`; see
  `frost_wall_live.rs::guard_the_human_tournament_world_keeps_the_default_freeze`): unchanged.
- New guards (green today, must stay green): `guard_*` tests in both oracle files (Freeze and absent `frost_wish`
  decide as today on the same percepts; the other four Wishes decide the same under `Wall`; the Freeze composed def is
  today's).

### (4) Determinism
Legacy's `wallBetween`/`peel`/`escape` draw nothing. The Rust rule must add no draw and read no unordered collection;
the nearest-threat choice is the existing ordered scan. The one RNG difference is downstream and legacy's own: a cast
with no unit id goes through `ground_click` (motor lane scatter) instead of `lock_click`, as Blaze already does.

### (5) Policy contract
See (2b): kept at 24 per instruction; flagged.

### Traps
- `EASY_AI` (`wish.rs:238-244`) is indexed by the row's position in `WISHES`; a Frost Wall row outside `WISHES` makes
  `played_ai` return `None` (Easy would never wall). Legacy's Easy keeps `["escape"]` for the wall.
- `escape` recomputes the distance with `hypot` (HumanBot: `HypotMode::Legacy`; Brain: `HypotMode::Js`): use the
  situation's `hypot`, not `t.d`, for the escape branch; `peel` uses `t.d` as carried.
- The bounds are inclusive (56 and 260 cast). `min(range, d * 0.7)` never binds at 450.
- A cast at 56 to 91 u lands under the wall's 64 u minimum range: legacy aims there anyway and the sim clamps
  (`crates/rh-sim/src/barriers.rs:56`); pin the raw aim, do not clamp in the policy.
- `escape` reads `s.threat ?? s.foe`: with no player in view, the goal's foe (a mob too) gets the wall; `peel` needs a
  chasing, targetable threat (`targetable == Some(false)` refuses; `None` passes).
- The wall branch returns from `peel` BEFORE the unit branch's `PEEL_DISTANCE` (150) cap, and from `escape` BEFORE the
  blink headings: a wall never falls through to them.
- HumanBot's `cast_intent` sets `at`/`snap_radius` for every cast; for `target: None` the humanizer ignores them
  (`humanizer.rs:488-505`), so the Freeze path is unchanged and the wall goes out as a ground click.
- The Brain's `wish_record` builds `def.id` from `AbilityId::as_str()` ("freeze"); legacy's id is "frostWall". Nothing
  in the Brain reads `def.id` for decisions (the policy reads tags and effects).
