# P-BOT-BRAIN-LIVE-1: the accepted-frame composer, `Frame14` -> source `Percept` (piece 1 of 3)

- **Serves:** not in ORDER_OF_OPERATIONS: owner beta-follow-up decision 7 (MIGRATION, 2026-11-10: "wire the ported Brain to
  live and headless seats, turn the legacy learner on"). Owner answers 2026-11-11 (chat): **degraded fair profile**
  approved (facts a seat cannot see are explicitly unknown, never inferred, never read from `World`); the learner runs on
  the beta (done: `hosting/technical-demo/bootstrap.py`, commit 81ded797). Owner approval 7, 2026-11-12: build it.
- **Implementer tier:** implementer-opus (fairness: what a seat may know; determinism of a per-tick record)
- **Reviewer:** reviewer-opus
- **Integration base:** feature/unity-rework (identities when written: protocol 17, observation 26, policy contract 20)
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5 none · D9 bots act only through validate + submit
- **Supersedes for activation purposes:** P-BOT-FAIR-ACTIVATION-1's "no defaults" rule, narrowed by the owner's degraded
  profile: an unpublished fact is passed as source `undefined` and listed in a DEVIATIONS row (piece 3); it is never
  defaulted to a plausible number and never taken from hidden state.

## Plan: three ordered pieces (the original brief was one packet of 1,500 to 2,500 lines)

| Piece | Packet | Outcome | Write scope (disjoint, serial) | Tier |
|---|---|---|---|---|
| 1 | **P-BOT-BRAIN-LIVE-1** (this) | `Composer14`: `&Frame14` (+ its own ring) -> `Percept`, exact key sets, degraded fields `undefined`, refusals | `rh-policy`: `bots/temporal_percept/brain/compose14.rs` only | implementer-opus |
| 2 | [P-BOT-BRAIN-LIVE-2](P-BOT-BRAIN-LIVE-2.md) | `BrainBot` (`Policy`), the shared command mapper taking `&LootFacts`, `Policy::finish`, headless selection | `rh-policy` (`bots/brain_bot.rs`, `bots/{mod,bot}.rs`, `lib.rs`, `temporal_percept.rs`), `rh-headless` | implementer-opus |
| 3 | [P-BOT-BRAIN-LIVE-3](P-BOT-BRAIN-LIVE-3.md) | `rh-server --bot-brain off\|full`, seat choice, fault fallback to `HumanBot`, replay name, learning facts, DEVIATIONS row | `rh-server`, `docs/DEVIATIONS.md` | implementer-opus |

Order is strict: 2 needs the composer; 3 needs `BrainBot`. Each lands through the gate before the next starts.
`--bot-brain` defaults to `off`, so live behaviour is unchanged until piece 3 is deployed with the flag.

## 1. ID and outcome
Live fill bots today run `HumanBot` (`crates/rh-policy/src/bots/bot.rs`), a bounded front end. The ported legacy Brain
(`bots/temporal_percept/brain.rs`, private) has no production input: its `Percept` is only built by the test-only
validated intake `brain/source_input.rs`. This piece adds the production input: a pure composer that turns a seat's
accepted `Frame14` (the same bytes a human client gets) into the Brain's `Percept`, and nothing else. It does not run the
Brain, emit commands, or touch rh-server or rh-headless.

## 2. Dependencies
None in flight. Read `docs/evidence/bot-fair-activation-plan/field-closure.md` (pinned to protocol 14; the corrected table
is section 6 below), `P-BOT-FAIR-ACTIVATION-1.md` (identity, time and privacy rules), `crates/rh-policy/AGENTS.md`.

## 3. Relevant legacy paths (rechecked 2026-11-12)
- `packages/server/src/bots/brain/frames.ts:124-215` `FrameRing.compose` (`now`, `viewT = now - worldDelayMs`, fighters/mobs
  with `dist`/`los`/`central`, `tintNearestFoe` at :379-395); `:280-287` `velocity` (`(at - prev) * 1000 / 100` px/s,
  zero when no earlier sample, a cut, or a jump over `TELEPORT_DISTANCE`); `:18` `VELOCITY_MS = 100`; `:370` `isCentral`
- `packages/server/src/bots/brain/perception.ts:329-360` owner `SelfView`; `:362-368` `absentSelf` (the source's own
  absent values); `:376-396` `fighterSeen` (`immune: until > 0 && left > 0 && left <= TELEPORT_IMMUNITY_MS` at :394);
  `:398-418` `mobSeen`; `:640-698` hud, events, extras; `:800-807` `seeCamps`
- `packages/server/src/bots/brain/vision.ts:44-55` ward vision (`camp.wardOwner === selfId && wardExpiresAt > now`), `:65-85` `filter`
- `packages/server/src/bots/brain/types.ts:296-674` (`Features`, views, `Percept`)
- `packages/server/src/sim/arena.ts:266-273` `creditMobKill` (the owner's `mobKills`, counted for every mob and elite kill)

## 4. New paths
- `crates/rh-policy/src/bots/temporal_percept/brain/compose14.rs`: `Composer14`, `Setup14`, `Composed14`, `Refusal14`,
  `WardSight14` (stubbed by the `stub:` commit; the `mod` lines and visibility of the validator key sets are already in)
- Oracle: `crates/rh-policy/src/bots/temporal_percept/brain/compose14_tests.rs`

## 5. Exclusive write scope
- `crates/rh-policy/src/bots/temporal_percept/brain/compose14.rs`
- additive read-only accessors on `Frame14`/`CollectionView` in `crates/rh-policy/src/delivery/frame.rs` only if the
  composer cannot get a delivered fact otherwise (no behavioural change to delivery)
- Nothing in `rh-sim`, `rh-protocol`, `rh-server`, `rh-headless`; not `source_input.rs` or any existing test.

## 6. Composer design and the corrected field table

Build the source record as `BVal` with the exact key sets and order of `brain/source_input.rs` (`SELF_KEYS`, `HUD_KEYS`,
`FIGHTER_KEYS`, `MOB_KEYS`, `CONTAINER_KEYS`, `PROJECTILE_KEYS`, `MINIMAP_KEYS`, `FEATURE_KEYS`, `EXTRAS_KEYS`), plus the
typed `Percept` header (`brain/percept.rs`). Constructor input is `&Frame14` only; the composer never sees `Sim`/`World`.
The source validators reject `undefined` where the frozen witness never had it, so the oracle runs them after
substituting a placeholder at exactly the named degraded paths; anything else undefined is a failure.

"Changed" = the original brief (or field-closure, pinned to protocol 14) called it degraded and protocol 16/17 now delivers it.

| Source group | From the accepted frame | Degraded (`undefined`) | Changed since the brief |
|---|---|---|---|
| `now`, `viewT` | `Frame14::source_time`; `viewT = now - world_delay_ms` (setup) | | no |
| `self` pose/status/hp/barrier/faction/weapons/slot/kills/gv/bounty/moveSeq/sig/brand | `owner()` + required `inventory()`; missing -> refuse | | no |
| `self.draw/ready/asMult/windupMult/speedMult` | required `owner_combat()`, exact milli conversion | | no |
| `self.power`, `self.build` | required `WireBuild` + card catalog; missing -> `BuildMissing` | | no |
| `self.name` | roster row of the owner (State key 12, protocol 16) | no roster row | **yes**: was "source-only" |
| `self.mobKills` | | **always** (summary `mob_rows` stacks exclude elites and are capped, so they are not the count) | no (still open) |
| `self.immuneUntil` | | **always** (a verdict flag exists, never the deadline; not a Brain decision input) | no |
| `self.attackTarget` | Clear -> `null`; Held(Some visible) -> that fighter's key | Held(None) -> `undefined`, never `null` | no |
| `hud` phase/clocks/gates/coliseum | required Arena group; missing -> `ArenaMissing` | | no |
| `hud.playerCount` | roster length | | **yes** |
| `hud.alive`, `hud.minPlayers`, `hud.winner` | | **always** (no whole-room totals on the wire) | no |
| fighters `x/y/facing/status/hpFrac/faction/inHand/bounty/sig/brand/targetable` | `WireActor` player rows | | no |
| fighters `name`, `bot` | roster rows (protocol 16) | no roster row for that id | **yes**: closure said absent |
| fighters `immune` | `ACTOR_FLAG_TELEPORT_IMMUNE` (protocol 16; the sim sets it by the same predicate, `observe.rs:112-115`) | | **yes**: was "remote immunity -> undefined" |
| fighters `vx/vy/dist/los/tint/central` | two accepted samples 100 ms apart + setup arena | `0` when no earlier sample (source `velocity()`) | no |
| fighters `drawStartedAt` | | **always** (the ENGAGED flag is a verdict, not a time) | no |
| mobs | `WireActor` npc rows, static type/name mapping; NPC ids are per-sample, no cross-frame join | `drawStartedAt` always; `type` when the code is unknown | no |
| containers | `props()` handles + reward chests; unknown (`undefined`) vs empty (`null`) kept | | no |
| projectiles | current x/y, kind, owner | `id`, `vx`, `vy`, `x0`, `y0`, `t0`, `range` | no |
| minimap | | `t` undefined, dots `[]` | no |
| events | accepted `EventBatch`/`FxBatch`, world vs immediate lanes, exactly once | windup/launch/end events absent | no |
| extras camps | `WireCamp` rows (`index`, `id`, `type`, `reward` from `WireCamp.reward`, `alive`, `state`, `respawnAt`) | | **yes**: reward now on the wire |
| camp wards (vision input, not a `CampView` key) | `WireCamp.ward` with `yours: true` -> `WardSight14 { camp, expires_at }`; another's ward gives no sight | | **yes**: was "wardOwner/wardExpiresAt -> undefined" |
| extras wish/effects/fields/chests/plan | as delivered, gated by `Features` | | no |
| owner build summary + champion panel (State key 13) | **not read**: no Brain consumer; do not copy it into the percept | | new on the wire, unused |
| `features` | bound from `Setup14.features` | | no |

Hard rules: no join by position, row order or type; hidden-state twins compose identical percepts; a refused frame leaves
the ring untouched; samples must advance (`Refusal14::Clock`). `Arena`/map sections added to the protocol (camp markers,
coliseum, gates, bushes) are public statics: the composer uses `Setup14.arena` (`MatchStart::arena`) for `los`, not a
decoded map blob, so those sections need no consumer in this piece.

## 7. Behaviour to preserve
- Every existing rh-policy test and parity corpus (`parity/policy/*` run inside `cargo test -p rh-policy`).
- `source_input.rs` and the test-only validators are unchanged apart from the stub's `pub(super)` visibility.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-BOT-BRAIN-LIVE-1` passes (full).
- `cargo test -p rh-policy compose14` green (16 tests), `cargo clippy -p rh-policy --all-targets --all-features -- -D warnings` clean.

## Oracle files (read-only for implementers)
- `crates/rh-policy/src/bots/temporal_percept/brain/compose14_tests.rs`

## 9. Validation commands
- `cargo test -p rh-policy compose14`, `cargo test -p rh-policy`, `cargo fmt --all -- --check`

## 10. Risk and suggested model tier
Medium-high, about 450 lines: fairness (C-OBS) and exact key order; no determinism state beyond a small ring. Opus,
Opus review.

## 11. Known traps
- `BVal` own-key order is part of the source contract; validators check names, tests check order.
- The frame cannot carry an owner at all only if delivery refused it earlier (`prepare` errors with no `me`), so
  `Refusal14::OwnerMissing` is a defensive variant the oracle does not exercise.
- `Fact::Unavailable` is not an empty collection: `owner_immunity_until()` and `Actor14::immunity_until()` stay
  `Unavailable` (they are deadlines); only the ring flag is used.
- Roster is cut to the lowest 32 ids (`9ea0d22d`): a fighter missing from a full roster is unknown, not nameless.
- Positions are quantised to 1/8 unit on the wire; compare with that tolerance.

## Legacy doubts (carried into the hand-off)
- `frames.ts:285` zeroes velocity if the previous-sample view test fails; whether to zero or keep `undefined` for a mob
  that was not in the earlier sample is pinned to zero (the source value), not proven against a capture.
- `frames.ts:379-395` `tintNearestFoe` (the `tint` value) is not pinned by the oracle (only finite); the implementer ports it.

## Notes from previous attempts
Scoped on 2026-11-11 in the cloud session (no implementation). Rewritten as piece 1 on 2026-11-12 after the tree moved:
`HumanBot::emit` is the command mapper (`bot.rs:782`) with `Goal::Loot`/`Goal::Chest` (`bot.rs:663,707-708`) and
`LootFacts` (`bots/perception.rs:160`); protocol 17 added camp rewards and ward verdicts, the owner build summary and
champion panel; protocol 16 added the roster and the indicator flags.
