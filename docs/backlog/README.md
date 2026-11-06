# Roguehalla migration: remaining-work backlog

Written for a team that has only this repository (no chat history). Stage 1 built the Rust foundation; everything below is
what is left. Read first: [../CONTRACTS.md](../CONTRACTS.md) (invariants `C-*`), [../adr/README.md](../adr/README.md),
[../../parity/README.md](../../parity/README.md), [../legacy/INVENTORY.md](../legacy/INVENTORY.md) (legacy systems and numbers,
and section 9 "stale-doc discrepancies": the legacy `docs/legacy/CLAUDE_LEGACY.md` is a map, **code wins**).

**What exists (do not re-plan it):** `rh-sim` slice (core layout: [ADR 0009](../adr/0009-core-layout.md) and `crates/rh-sim/README.md`) = lobby -> active -> ended, movement + A* pathfinding (exact legacy port),
fists/sword/shield/axe melee with zero-windup player swings and lag-compensated rewind, pickup/swap/drop, the damage ledger (PvP factor at card power 0,
mitigation, PvP hit cap, simultaneous resolution, kill credit, bounty + announcements, GV, win bonus gate), leaving (MIA),
observations (current sight only), replays and checkpoints; `rh-parity` (the legacy slice scenarios and 300 `findPath` queries match; `cargo run -p rh-parity --bin parity-report`);
`rh-protocol` v6 + C#/JS mirrors; `rh-server` (WSS, admission, resume, drain, limits, interest-managed replication, fill bots on
the policy seat contract, off-tick result sink, private replays); `rh-persist` (Postgres, fenced leases, idempotent
results, atomic achievements, legacy import); `rh-headless`; `tools/browser-proof`; `client-unity` (RoguehallaNet tested;
actual Unity 6000.0.85f2 Web build and the selected MVP match loop verified, including HUD, rewards/results and reconnect).
Initial loot discovery and all seven reliable views are integrated; broader content and cloud deployment remain open. The ported tick order is the table `schedule::PHASES` in `crates/rh-sim/src/schedule.rs` (run by `systems::update_active`); unported
rows are `Pending("P-...")` entries there, named after the legacy rows, and [../CONTRACTS.md](../CONTRACTS.md) C-TICK describes them.

## How to pick up work

**Current first-release scope (owner decision 2026-11-05): playable core first.** Complete one browser match with
combat, mobs, a small card/chest selection, a functional Unity HUD and one AWS staging region. Quests, traders,
advanced bots, visual polish and large-scale hosting tests are deferred; this backlog retains the full original scope
for later milestones. Work only on dependencies needed for that loop now, preserving focused parity and regression
checks. See the concrete finish line in [MIGRATION](../MIGRATION.md#first-playable-release-scope--owner-decision-2026-11-05).

**Current MVP gate:** the local and public Calgary Unity loop now passes, including loot/chest choice, results and
reconnect; [cloud evidence](../evidence/first-playable-calgary/README.md) records the temporary single-host deployment.
The bounded owner playtest and verified cleanup remain; managed GameLift, persistent progression, full browser/content
coverage and matched legacy performance remain later gates.

**First Claude handoff integrated (owner request 2026-11-05).** PR25–27 from
[P-CLAUDE-INFRA-1](packets/P-CLAUDE-INFRA-1.md) are integrated with coordinator repairs; the broad reservation is closed.
See [external integration evidence](../evidence/stage2-external-integration/README.md). Same-volume recovery, account
routes, local lifecycle/load/placement tests and infrastructure preparation are implemented. Durable placement restart
recovery, real cloud adapters/deployment and full-game capacity remain open. New work requires its own bounded packet.

**Parallel Kimi handoff (owner request 2026-11-05).** [P-KIMI-VERIFY-1](packets/P-KIMI-VERIFY-1.md) reserves new
headless determinism-sweep files, `tools/determinism/**` and `.github/workflows/determinism.yml` for a separate Kimi
branch. **Integration update:** PR24 is merged as `1d26fd61`; the exclusive reservation is complete. Native Linux
x86_64/aarch64 comparison and both replay directions passed at `3558f83a` (CI `42093826602`); the merged revision
refresh is tracked in MIGRATION. Kimi implements bounded Rust verification and native architecture checks, with no gameplay/shared-library
changes. Codex independently reviews results and retains shared status/contract/lockfile ownership. Both native architectures, exact comparison and foreign replay directions also passed at merge `1d26fd61`
(CI `42101769249`); this closes the implemented-domain P-CI-2 gate, not full-game determinism.

**External milestone handoffs (owner request 2026-11-05).** Both bounded handoffs are integrated after independent
review and coordinator repairs: [P-CLAUDE-PLACEMENT-2](packets/P-CLAUDE-PLACEMENT-2.md) provides the locally verified
durable placement library; [P-KIMI-FOLD-1](packets/P-KIMI-FOLD-1.md) provides the pure stat-fold kernel. Their external
write reservations are closed. Neither completes gameplay, cloud deployment or client flows. Codex retains shared
integration and the remaining backlog; provider/authentication/scheduler work remains P-PLACEMENT-3.

**Dependency order (earliest first).** A packet may start once everything it depends on is merged; "Ready packet" items have a
full spec in `packets/<ID>.md`, "Coarse" items need a packet written (copy the section list below) before they start.

| Wave | Items | Why this order |
|---|---|---|
| 0 | P-CAPTURE-1 | Every mechanic packet needs the generalised capture tool and the re-capture CI job (the Rust CI baseline, `.github/workflows/rust.yml`, already exists) |
| 1 (parallel; P-COMBAT-2 merges after P-COMBAT-1 for the sword/shield cases) | P-COMBAT-1, P-COMBAT-2, P-MAP-1, P-ARENA-1, P-UNITY-1, P-HOST-1, P-PERSIST-2, P-NET-1, P-BOTS-1 | No hard dependency on each other; they touch different crates. Shared files (below) are merged one at a time |
| 2 | P-COMBAT-3 (after COMBAT-2), P-FACTION-1 (after COMBAT-1), P-MOBS-1 (after COMBAT-1/2, owns the camps part of `rh-map/2`), P-STATUS-1, P-VISION-1 | Locks need ranged aim; signatures need hit events with weapon info; mobs need weapons and camps |
| 3 | P-ABIL-1, P-CARDS-1, P-FACTION-2..5, P-TERRAIN-1, P-LOOT-1, P-CONS-1, P-TRADE-1, P-MOBS-2, P-ARENA-2 | Build on waves 1-2 |
| 4 | P-CARDS-2/3, P-QUEST-1, P-BOTS-2..7, P-NET-3..6, P-UI-*, P-OPS-*, P-LOAD-* | Need the mechanics they present or measure |
| 5 | P-MIG-*, P-OSS-*, P-ML-* follow-ups | Cutover and release; several are owner decisions |

**Shared-file rule.** These files change in almost every mechanic packet; merge those packets one at a time and rebase,
never in parallel: `crates/rh-sim/src/schedule.rs` (the tick as data: **never reorder rows**; a mechanic flips its rows
from `Pending("P-XXX-n")` to `Ported(fn)` at their legacy position, and `crates/rh-parity/tests/schedule.rs` fails when a
table stops matching `parity/schedule/legacy_schedule.json`), `crates/rh-sim/src/content.rs` (and `content_hash`),
`crates/rh-sim/src/observe.rs` (`OBSERVATION_VERSION`), `crates/rh-protocol/**` + `client-unity/RoguehallaNet/Protocol/**` +
`protocol/fixtures/v<PROTOCOL_VERSION>.json` (current v6, golden vectors in Rust/C#/JS), `crates/rh-server/src/wire.rs`,
`Cargo.toml`/`Cargo.lock`, and `parity/legacy-capture/capture.ts`. **A mechanic is a new file, not an edit of a monolith:**
`crates/rh-sim/src/systems/<mechanic>.rs` (every entry point `fn(&mut Cx)`) plus its rows in `schedule.rs`; its state goes
in `state.rs` (hashed and checkpointed), its per-tick working sets in `scratch.rs`, and a hook link it ports is a `fn(&mut
Hx, &HookArgs)` in its own file, fired by the call site that legacy has (`hooks::fire`). `sim.rs` is a facade and `Cx::submit`
is the only input path inside the tick ([ADR 0009](../adr/0009-core-layout.md)); a `Command` can only come from `validate` (it is
opaque, and decoding re-validates), so a new command variant is a `RawCommand` variant plus its `validate` arm.
Every sim-editing packet also keeps these green: per-tick lists live in `TickScratch` (never serialized), `crates/rh-sim/tests/no_alloc.rs`
stays at zero allocations per step, new content is registered in `content.rs` (and `content_hash`), every new serialized field
is covered by `tests/hash_coverage.rs` (each leaf must change the state hash), new state with an invariant gets a rule in
`check_world` (`checkpoint.rs`, one refusal test each), and `crates/rh-parity/tests/schedule.rs` and `tests/content.rs`
classification still pass. Update `what_the_slice_has_ported_stays_ported`
in the schedule test for the rows you flip.

**Status records.** Only the coordinator updates shared status records: the `docs/MIGRATION.md` checkpoint (referenced by
`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` and `docs/REQUIREMENTS.md`), the
status table in [../CONTRACTS.md](../CONTRACTS.md), and `Cargo.lock` (`AGENTS.md`: a packet that adds a crate or dependency
lists it in its hand-off and the coordinator regenerates the lock). A worker updates only its packet's exclusive write
scope plus the row of the item in this file it finishes (status -> "Done (<commit>)"), and reports evidence (commands run
and results) in its hand-off.

**Adding a packet.** Create `packets/<ID>.md` with exactly these sections: ID and outcome; Dependencies; Relevant legacy paths
(verified with `rg`); New paths; Exclusive write scope; Contracts and references; Behaviour to preserve; Acceptance checks;
Validation commands (only commands that exist, or "to be created by this packet"); Risk and suggested model tier; Known
traps. Then change the item's status here from "Coarse" to "Ready packet". Cite real files; do not invent numbers.

**Cross-cutting rules every packet inherits.**
- Parity policy ([../../parity/README.md](../../parity/README.md)): discrete outcomes exact; continuous values within 2e-6
  after the fixture's 1e-6 rounding; a tolerance that hides a changed hit, winner, reward or timing is a harness bug.
- Randomness (C-RNG): the core reads no entropy or clock; every new stream is a new field of `Secrets` with its own seed;
  secrets never appear in observations, snapshots, events or public exports; the public map seed never reproduces
  gameplay randomness. Legacy streams: `docs/legacy/INVENTORY.md` section 4.
- Numbers (C-NUM, ADR 0007): f64, legacy evaluation order, no FMA, transcendentals only through `rh_sim::math`
  (`libm`). JSON checkpoints/replays need `serde_json` with `float_roundtrip`.
- New public data needs an observation field (C-OBS leak tests stay green), a protocol addition (version bump, C# mirror,
  golden vectors) and a content-hash update; legacy events emitted between ticks travel with the next step.
- Optimization (R-OPT-2): any change justified by speed or size records observed cost, mechanism, behavioural risk and
  before/after evidence (revision, hardware, workload, build mode); existing tools: `cargo run --release -p rh-parity --bin
  parity-bench -- crowded_8 20` vs `npx tsx parity/legacy-capture/bench.ts --scenario crowded_8`, and `cargo run --release -p
  rh-server --bin wirebench`. Complexity without demonstrated value is removed.
- Policies and ML seams: architecture only. **No training, rewards, datasets, model runtimes, Python bindings, inference
  services or GPU resources** anywhere in this backlog.

## Backlog

Status: **Ready packet** (spec in `packets/`), **Coarse** (outcome known, packet to be written), **Blocked** (external gate).
Paths are relative to `packages/` unless they start with `crates/`, `docs/`, `deployment/`, `client-unity/`, `scripts/` or
`parity/`. `shared` = `packages/shared/src`, `server` = `packages/server/src`.

### 1. Simulation mechanics

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-COMBAT-1 | Items and the other melee weapons: pickup/swap/drop, sword stagger, shield block/riposte, axe shred, weapon specials flag, weapon racks for tests | P-CAPTURE-1 (soft) | Core and selected MVP live discovery implemented/reviewed; broader loot content remains | server/src/sim/loot.ts, weapons.ts, melee.ts; shared/weapons.ts, interactions.ts |
| P-COMBAT-2 | Projectiles: bow/wand, lead aim, wand splash, ball vs arrow, swing vs ball | P-COMBAT-1 (merge first for sword/shield cases) | Authoritative phase, lock creation and current-point projectile projection/transport implemented; stable flight presentation and remaining one-shot cues deferred | server/src/sim/projectiles.ts, weapons.ts; shared/weapons.ts, interactions.ts, policies.ts |
| P-COMBAT-3 | Target lock (wand click), committed-cast/cancel behavior and attack-move | P-COMBAT-2 | Core/policy/headless and live protocol/client target integration implemented/reviewed | server/src/sim/targeting.ts, weapons.ts; shared/constants.ts |
| P-COMBAT-4 | Loot world: weapon crates, ground spots, bodies drop weapons, loot tables, `holdBirth` | P-COMBAT-1, P-MAP-1 (crate/ground spots) | Coarse | server/src/sim/loot.ts, lootTables.ts |
| P-FACTION-1 | Faction signatures (burn, backlash, disease + execute, mark, chill) with engagement rules, lifesteal; shared engagement/Holy foundation | P-COMBAT-1 | All five base-player factions and temporal reporting implemented/reviewed in explicit default-Off modes; auxiliary/card/mob domains and producers remain | server/src/sim/factions.ts; shared/factions.ts, signatures.ts, signatureShares.ts, mark.ts |
| P-FACTION-2 | Fire roam | P-FACTION-1, P-STATUS-1 | Coarse | server/src/sim/fireRoam.ts; shared/fireRoam.ts; docs/FIRE_ROAM.md |
| P-FACTION-3 | Plague corpses, owned zombie, `consumeCorpse` | P-FACTION-1, P-MOBS-1 | Coarse | server/src/sim/plagueCorpses.ts, plagueZombies.ts; shared/plagueCorpses.ts; docs/PLAGUE_CORPSES.md |
| P-FACTION-4 | Sentenced hunt (`huntTarget`) | P-FACTION-1 | Coarse | server/src/sim/sentencedHunt.ts; shared/sentencedHunt.ts; docs/SENTENCED_HUNT.md, SENTENCED_REDESIGN.md |
| P-FACTION-5 | Bruiser/champion passives | P-FACTION-1, P-CARDS-1 | Coarse | server/src/sim/bruiserPassives.ts; shared/championPassives.ts; docs/BRUISER_PASSIVES.md |
| P-STATUS-1 | Status runtime (14 kinds, `STATUS_RULES`), fields (areas), `displace`, effect bits | P-COMBAT-1 | Core integrated/reviewed:79 Sim +1 role source cases,14 privacy pairs,1,252-test workspace and WSS proof pass. Selected live status/field transport implemented; remaining mechanic producers and one-shot cues are P-NET-3 | server/src/sim/status.ts, fields.ts, displace.ts; shared/status.ts |
| P-ABIL-1 | Cast pipeline and the five Wishes (`freeze`, `swarm`, `trial`, `blaze`, `lastStand`), Blaze Step blink, wish lock | P-STATUS-1, P-COMBAT-3 | Coarse | server/src/sim/abilities.ts; shared/abilities.ts, blink.ts |
| P-CARDS-1 | Stat mirrors and the `foldRows` build fold, card catalog (80 cards), card hooks, on-hit pipeline, guards G1-G13, PvP factor beyond power 0 | P-COMBAT-1, P-STATUS-1 | Selected Slow Burn/Pocket Sand/Siphon plus shared stat/farm consumers implemented with bounded source proof; full catalog/hooks remain | server/src/sim/mods.ts, cardHooks.ts, cardState.ts, onHit.ts, vsProbe.ts, buffs.ts; shared/cards.ts, effects.ts, mods.ts, rules.ts |
| P-KIMI-FOLD-1 | Pure stat fold, mirrors and numeric chest boosts; 4,096-case CI differential plus 100,000-case bounded stress inventory | Reviewed integration `5b1a7aae`; independent of pending runtime | Pure kernel integrated at `7f294cc7`; 1,031-test workspace, Rust/C#/browser CI and all six native determinism jobs passed. Does not complete P-CARDS-1 | shared/mods.ts, effects.ts, chestBoosts.ts, constants.ts |
| P-CARDS-2 | Camp chests, `choose`, augments, stat chests/crates, chest boosts, skip heal/GV | P-CARDS-1, P-MOBS-1 | MVP stat/elite chests, offers/choose/skip and eight boosts implemented; actual Unity choice/build proof passes; remaining pool remains open | server/src/sim/chests.ts; shared/rewards.ts, chestBoosts.ts |
| P-CARDS-3 | Kill augments and mob stat stacks (`MOB_KILL_STACKS` 3) | P-CARDS-1; P-MOBS-1 actor/combat stages for runtime capture | Coarse | server/src/sim/killAugments.ts, mobStats.ts; shared/killAugments.ts, mobStats.ts; docs/MOB_PROGRESSION.md |
| P-CONS-1 | Consumables: stored potions, wind emblems, 75 s cannons, `useConsumable` | P-LOOT-1 or P-COMBAT-4, P-MOBS-1 | Small potion storage/use/healing implemented with source/restore/headless/Unity proof; wind, other potions and cannons remain deferred | server/src/sim/consumables.ts; shared/consumables.ts |
| P-TRADE-1 | Neutral traders and per-run stat exchanges, `trade` | P-CARDS-3 | Coarse | server/src/sim/traders.ts; shared/traders.ts |
| P-QUEST-1 | K1 quests (20 defs, 10 known), accept, carriers, hidden offers, lifecycle | P-MOBS-1, P-CARDS-3, P-MAP-1 | Coarse | server/src/sim/quests.ts; shared/quests.ts; docs/quests.md |
| P-VISION-1 | Vision: actual 30 s private trail, owned wards, restore, bushes (`bushConceals`) | P-MAP-1 (bush layer), P-NET-3 | Trail/bush/attack-exposure prerequisite implemented and reviewed; remaining producers/dynamic geometry in [packet](packets/P-VISION-1.md) | server/src/sim/vision.ts; shared/vision.ts, bushes.ts |
| P-TERRAIN-1 | Hazards: ember burn, bog slow, ice slide (`walkFighter`), light heal; faction exemptions | P-MAP-1 (terrain layer), P-FACTION-1 | Coarse | server/src/sim/terrainEffects.ts; shared/terrain.ts, walk.ts |
| P-ARENA-1 | Planning phase + spawn deal from a private stream, coliseum schedule/teleport/gates, patience, sudden death | none (map gates need P-MAP-1 data; use `rh-map/1` first) | Ready packet | server/src/sim/planning.ts, arena.ts, step.ts; shared/planning.ts, coliseum.ts, rules.ts |
| P-ARENA-2 | Training rooms and the `train` console (card/stat/camp/chest/clear) | P-CARDS-2, P-MOBS-1 | Coarse | server/src/sim/training.ts; shared/training.ts |
| P-MOBS-CATALOG-1 | Pure typed 30-type/five-role catalog and draw-injected roster helpers; no actor/runtime or native RNG claim | Existing source and capture baseline | Integrated after independent acceptance and actual content registration; 322 +120 source cases, 327 aggregate checks, 1,207-test workspace gate passed. See stage2-mob-catalog evidence | shared/mobs.ts, rosters.ts, rng.ts |
| P-MOBS-1 | Full regional mob runtime: true non-seat actors, shared NPC combat/AI, camp lifecycle and applied rewards | P-MOBS-CATALOG-1; P-STATUS-1 for actor integration; staged card/stat producers for completion | Selected shared-actor Holy/Fire/Plague PvE and camp lifecycle/rewards implemented with source/headless/Unity proof; full regional runtime/scale gates remain open | server/src/sim/mobAI.ts, mobLife.ts, camps.ts; shared/mobs.ts, rosters.ts |
| P-MOBS-2 | Camp-clear heal, wards, elite chests, regen, `campCleared` hook chain | P-MOBS-1, P-CARDS-2 | Coarse | server/src/sim/campHeal.ts, regen.ts, camps.ts |

### 2. Bots

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-BOTS-1 | Human-like bot brain on `rh-policy` seats: perception from `Observation` only, tiers/personas, cadence | none (grows with Observation) | Ready packet | server/src/bots/brain/*, humanizer.ts, clicks.ts, tactics/ |
| P-BOTS-2 | Wish module (`abilityPolicy`) | P-ABIL-1, P-BOTS-1 | Coarse | server/src/bots/abilityPolicy.ts, brain/modules/wishes.ts |
| P-BOTS-3 | Planning, chest, hazard modules | P-ARENA-1, P-CARDS-2, P-TERRAIN-1, P-BOTS-1 | Coarse | server/src/bots/brain/modules/*, chestHunt.ts |
| P-BOTS-4 | Mob hunting, build routes, camp farming, elite rules | P-MOBS-1, P-BOTS-1 | Coarse | server/src/bots/mobHunt.ts, brain/buildRoute.ts, strategy.ts, huntAdapter.ts |
| P-BOTS-5 | Learning stats store (`BotStatsStore`) off-tick, in Postgres not a file | P-PERSIST-2 | Coarse | server/src/bots/learning/ |
| P-BOTS-6 | Tournament runner on `rh-headless` (per-tier win rates, Wilson intervals) | P-BOTS-1 | Coarse | server/src/bots/tournament/ |
| P-BOTS-7 | Fill policy: `BOTS_FILL_TO`, persona/tier mix, arrival schedule, yield seat, bots never touch profiles/quests | P-BOTS-1 | Coarse | server/src/bots/BotManager.ts, callsigns.ts; crates/rh-server/src/director.rs (already fills) |

### 3. Parity and headless

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-CAPTURE-1 | Generic event canonicalisation, scenario helpers, more scenarios, CI job re-capturing and diffing when `packages/` changes | none | Implemented and reviewed (Stage 2, `optimization_port`) | parity/legacy-capture/capture.ts |
| P-CI-1 | Rust CI baseline: fmt, clippy `-D warnings`, `cargo test --workspace` with a Postgres service, parity report, headless smoke, browser proof, dotnet job | none | Done (commit 659c4cf, `.github/workflows/rust.yml`); extras are tracked in P-CAPTURE-1 (re-capture job), P-CI-2, P-UI-10, P-OSS-2 | .github/workflows/deploy.yml (legacy manual deploy; untouched) |
| P-CI-2 | Reproducible aarch64 CI run of determinism/parity | P-CI-1 | Done for implemented domain: Kimi PR24 merged at `1d26fd61`; source CI `42093826602` and merge CI `42101769249` passed all six native/comparison/replay jobs | none |
| P-HEAD-1 | Headless benches per mechanic (step cost, TTK, duel harness equivalents) as Rust benches, not Node | each mechanic packet | Coarse | server/bench/*, server/src/harness/ |
| P-PARITY-2 | Full-map and mob scenarios (real generated map, camps) once their packets land | P-MAP-1, P-MOBS-1 | Coarse | parity/legacy-capture/capture.ts |

### 4. Map

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-MAP-1 | Port the generator and the independent certifier; reproduce the pinned hashes or record an owner-approved re-pin | none | Complete implementation/review:400 original plain/styled pins+8 OPEN pins, complete DTOs and independent hard certification; measured native M5 Pro release medians 13.47 ms plain/22.21 ms styled.997-test native gate and Rust/C#/native CI passed at `d1027eac`. See [evidence](../evidence/stage2-styled-map/README.md) | shared/mapgen.ts, zones.ts, coliseum.ts, zoneStyle/*, gridOps.ts, gridTopology.ts, detMath.ts, test/mapCertify.ts, test/mapPins.ts |
| P-MAP-2 | Public layers on the wire (zones, terrain, features, camps, spawn subset): `MapBlob` v2 + C# decode | P-MAP-1 (or `rh-map/2` export), P-NET-3 | Coarse | shared/mapWire.ts, map.ts |
| P-MAP-3 | Off-tick certified-map pool (worker/thread, target 8, refill 6, fallback, hang watchdog) | P-MAP-1 | Coarse | server/src/mapPool.ts, mapWorker.ts |
| P-MAP-4 | Client art data: decor/props from the public seed (cosmetic, unhashed), zone art inputs for Unity | P-MAP-2, P-UI-8 | Coarse | shared/propKinds.ts, client/src/render/zoneArt/* |

### 5. Networking and client prediction

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-NET-1 | Prediction parity: C# pathfinding for predicted walks, render-time attack `t`, MAX_REWIND bound per measured RTT, delta-compression decision by measurement | none | Ready packet | client/src/net/localMotion.ts, localPrediction.ts, remoteDraw.ts; shared/interp.ts |
| P-NET-2 | Remote draw-ahead and the walk hint (presentation only) | P-NET-1 | Coarse | client/src/net/remoteDraw.ts; server/src/sim/walkHint.ts; docs/PLAYER_PREDICTION.md |
| P-NET-3 | Protocol additions per mechanic: fx kinds, snapshot fields, observation versions (governance of shared files) | each mechanic packet | In progress (combat v5 verified; later mechanics remain) | shared/fxCodec.ts, messages.ts, schema.ts; crates/rh-protocol |
| P-NET-ITEMS-1 | Public visible-item discovery, private self inventory, exact observer-local pickup handles, headless/live intake and reliable State/Unity integration | P-COMBAT-1; Unity bootstrap for client stage | Implemented/reviewed for selected MVP: source loot admission, shared observer intake, all7 State keys, actual Unity pickup/choice/reconnect pass; broader content remains open | crates/rh-sim/src/observe.rs; rh-policy; rh-headless; rh-server; client-unity |
| P-NET-4 | Uplink pacing: aim gate, hold gate, stall watch, order bucket tuning | P-NET-1 | Coarse | client/src/net/uplinkPace.ts, tickPhase.ts |
| P-NET-5 | Heartbeat/liveness parity (`beat`, 4500 ms timeout, close codes) | none | Coarse | server/src/rooms/RaidRoom.ts, shared/constants.ts |
| P-NET-6 | Wire-build/content-hash stale-client UX (426 equivalent, reload prompt) | P-UNITY-1 | Coarse | server/src/guards/clientBuild.ts, client/src/ui/reloadPrompt.ts |
| P-NET-7 | Protocol v5 idea (builds on the shipped v4): do not send unchanged snapshots (held marker + heartbeat). Needs an owner decision (byte/packet savings vs a protocol bump); evidence [below](#p-net-7-evidence-obs-3) | owner decision; P-NET-3 (governance of shared wire files) | Coarse (owner decision pending) | shared/messages.ts, schema.ts; crates/rh-protocol |

#### P-NET-7 evidence (OBS-3)
Source: the final efficiency review at `056bb31`; sim, server and wire numbers are deterministic counts or callgrind figures
from the review profiles (the 4.2 us user plus 4.7 us kernel per frame and the 53% kernel share are timed measurements from connheap and strace, not deterministic counts), the unchanged-snapshot rates come from a throwaway observation-statistics bin (not committed) that
ran the production `Publisher` over the wirebench match (seed1, 8 Brawler bots, 8 viewers) and the practice arena. The proposal
is **not implemented**; the gain figures are **estimates**.
- **Measured:** 41.8% of snapshots equal that viewer's previous one (self, actors, phase) on seed1 over 2,400 ticks (13.4% over
  the first 600 ticks; 22.6% on the practice arena, 8 bots, 653 steps). The lobby phase is nearly all empty frames (mean 9.9 B
  per send). The live writer costs about 4.2 us user plus 4.7 us kernel per frame and makes 1.06 `sendto` calls per
  viewer-tick; kernel and socket work is about 53% of server CPU with idle lobby clients. An empty delta is about 9 B of
  payload and about 54 B of TCP/IP/WS headers (arithmetic from the profile).
- **Not measured:** the empty-snapshot rate in a real human match (a counter on a real match is the first step).
- **Idea:** in `ConnEncoder::encode` (`crates/rh-protocol/src/delta.rs`) and the writer, when a delta would carry no self change,
  no changed or departed actor and the same phase and ack, and fewer than H ticks (about 10, below `MAX_DELTA_AGE`) have passed
  since the last frame written, write nothing. The next real delta has age > 1 (decoders accept that today, from
  backpressure skips) and a new Delta head bit `DH_HELD` (the next free bit, bit 15 unless that packet's measurement says otherwise, since a bit past 13 makes the Delta head three bytes; per [ADR 0011](../adr/0011-protocol-v4.md): bits are append-only) tells the client `SnapshotBuffer` to insert a hold copy of the base at
  tick - 1, so motion is not smeared across the gap. Bump `PROTOCOL_VERSION` to 5 (v4 shipped with L-v4), regenerate the vectors (`protocol/fixtures/v5.json`),
  update the Rust, C# and JS decoders, add a room counter `snapshotsHeld`, and add an addendum to
  [ADR 0011](../adr/0011-protocol-v4.md) and C-NET.
- **Estimate:** idle lobby up to (H-1)/H of snapshot frames (90% at H = 10), about 9 us server CPU and about 63 B on the wire per
  frame avoided; bot-like matches 13-42% of frames; a wirebench-like match about 530 B/s per player of headers and payload saved
  against 305 B/s of payload today.
- **Risk:** medium, on the client: fewer arrival samples for `RenderClock`; the hold insertion must be exact; liveness must not
  read silence as loss; the Resync rules are unchanged. No gameplay risk (the sim is untouched).
- **Owner decision needed:** is the byte/packet saving worth a protocol bump (v5) and the new client behaviour, or should
  unchanged frames stay as they are until the per-player bandwidth or packet rate is a measured problem?
- **Proof plan when taken:** encoder tests (identical snapshots give one frame per H ticks; the next change carries age > 1 and
  `DH_HELD`; the decoded chain equals `SnapshotData::decoded()` at every written tick); v5 golden vectors pass in Rust, C# and
  JS; a C# `SnapshotBuffer` test that a held gap followed by a move samples identically to the unsuppressed stream; wirebench
  gains held-frame counts; densitybench lobby frames per human-tick 1.09 to 0.2 or less; connheap CPU per connection-second;
  `node tools/browser-proof/proof.mjs`.

### 6. Unity client flows and visuals

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-UNITY-1 | Open the Unity project, confirm exact Unity 6 LTS + packages, fix compile errors, first Web build over wss, browser matrix, budgets, adaptive quality | none (Unity install/license now available) | Selected protocol6 MVP loop and M5 Pro baseline verified; cloud hosting, browser matrix and adaptive quality remain | client/src/main.ts, scenes/RaidScene.ts |
| P-UNITY-PERF-1 | Unity client efficiency: instanced remote-actor draws (also fixes a Mesh leak), skip Fx decode without a consumer, allocation-free receive/send path, WebGL compression and size settings, GPU fill settings. Packet estimates require Editor/browser measurement; the .NET numbers carry a JIT caveat | P-UNITY-1 (F2 and F4 are library-only) | Ready packet ([spec](packets/P-UNITY-PERF-1.md)); Editor/license available in Stage 2 | client/src/render/*, net/connection.ts (behaviour reference only) |
| P-UI-1 | Hub/menu/profile flows: claim, sign-in links, shop, cosmetics, achievements, leaderboard, faction picker | P-UNITY-1, P-PERSIST-2 | Coarse | client/src/scenes/HubScene.ts, hub/, ui/menu.ts, ui/hub/; shared/cosmetics.ts, achievements.ts |
| P-UI-2 | Matchmaking and region selection UI, latency probes, queue states | P-UNITY-1, P-HOST-3 | Coarse | client/src/net/lobby.ts, ui/lobbyActivity.ts |
| P-UI-3 | Reconnect UX (banner, resume, TooSlow, stale client) | P-UNITY-1 | MVP banner/resume/rejoin verified; broader error UX remains | client/src/ui/banner.ts, net/errors.ts |
| P-UI-4 | Results screen (outcome, GV breakdown, win bonus why, killed by bot tag) | P-UNITY-1 | MVP authoritative outcome/results verified; full breakdown remains | client/src/ui/results.ts |
| P-UI-5 | HUD: vitals, weapon bar, Wish slot, cards row, build strip, minimap, chest panel, quest log, toasts, potion cue | each mechanic; P-UNITY-1 | MVP vitals/inventory/build/chest choice/potion feedback verified; Wish/minimap/quest/full cards deferred | client/src/ui/hud.ts, cardsRow.ts, buildHud.ts, minimap.ts, chestPanel.ts, questLog.ts, weaponBar.ts, abilitySlot.ts |
| P-UI-6 | Planning screen and hold-Tab map, route drawing | P-ARENA-1, P-MAP-2 | Coarse | client/src/ui/planning.ts, route.ts, mapHold.ts, mapPainter.ts |
| P-UI-7 | Combat presentation: projectiles, telegraphs, status art, hit numbers, juice (reduced-motion safe) | P-COMBAT-2, P-STATUS-1 | Coarse | client/src/render/* |
| P-UI-8 | Visual upgrade per [../VISUAL_DIRECTION.md](../VISUAL_DIRECTION.md) (exists: quality tiers, budgets to establish) | P-UNITY-1 | Coarse | client/src/render/zoneArt/*, hub/hubArt.ts |
| P-UI-9 | Settings, accessibility, input rebinding, audio decision | P-UNITY-1 | Coarse | client/src/settings.ts, ui/settingsPanel.ts |
| P-UI-10 | Unity batchmode tests + build in CI | P-UNITY-1, P-CI-1 | Coarse | none |

### 7. Persistence and accounts

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-PERSIST-2 | Wire `rh-server` to `rh-persist` in production: Postgres auth, lease renewal, achievements port, faction/weapon in results, profile REST API port | none | Achievements/catalog/live renewal/ending metadata, same-volume process recovery and profile REST implemented/reviewed; production database/host-loss/failover proof remains | server/src/persistence/ProfileStore.ts, index.ts (`/api/profile*`, `/api/leaderboard`), shared/achievements.ts, cosmetics.ts |
| P-PERSIST-3 | Leaderboard months, shop catalog parity, cosmetics `look` word in `rh-protocol` | P-PERSIST-2 | Catalog/validated look packing (57 entries,301 legacy cases) and monthly leaderboard/shop routes implemented/reviewed; wire/Unity presentation and production proof remain | ProfileStore.ts, shared/cosmetics.ts |
| P-PERSIST-4 | Aurora failover and pool-exhaustion tests; retry/backoff sizing | P-PERSIST-2 | Coarse | none (ADR 0006 "not yet tested") |
| P-PERSIST-5 | New-profile rate caps and passcode equivalents at the edge | P-PERSIST-2, P-HOST-2 | Coarse | server/src/guards/*, config.ts |

### 8. Hosting, regions and scaling

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-HOST-1 | Go SDK bridge sidecar + control API session endpoints + run `docs/hosting/STAGING_EXPERIMENT.md` when authorized | none (AWS gate) | Local bridge/control API implemented/reviewed; actual managed-fleet experiment remains open under CAD20 total cap | deployment/cloudflare/src/containerLifecycle.ts (legacy analogue) |
| P-CLAUDE-PLACEMENT-2 | Durable placement ownership, fenced claims and abrupt process restart/reconciliation over PostgreSQL | Reviewed integration `5b1a7aae` | Integrated after independent repairs/review: schema 3, 236 placement tests, 1,196-test workspace gate; Rust/C#/browser CI42147913799 passed. No cloud deployment | crates/rh-placement/src/service.rs (new adapter infrastructure) |
| P-PLACEMENT-3 | Authenticated placement/release API, real provider adapters, explicit bounded reaper cadence/backoff and unresolved-obligation monitoring; preserve indefinite ambiguity and original-zone cleanup | P-CLAUDE-PLACEMENT-2, P-HOST-2, P-HOST-3 | Coarse; required before deployment | crates/rh-placement/src/service/{mod,run}.rs; future adapter/wrapper |
| P-HOST-2 | TLS and DNS: wildcard cert, per-placement record, rustls serving | P-HOST-1 | Coarse | none |
| P-HOST-3 | Region set, HTTPS latency endpoints, queue config, `PlayerLatencies` | P-HOST-1 | Coarse | scripts/latency-probe.mjs, network-probe.mjs |
| P-HOST-4 | Autoscaling, scale-in protection, warm capacity, drain on deployment | P-HOST-1, P-LOAD-2 | Coarse | none |
| P-HOST-5 | Deployment and rollback pipeline (image build, fleet update, health gates) | P-HOST-1, P-CI-1 | Coarse | scripts/deploy*.mjs, .github/workflows/deploy.yml |
| P-HOST-6 | ECS-on-EC2 fallback decision record if staging fails | P-HOST-1 | Coarse | docs/hosting/GAMELIFT_EVALUATION.md section 6 |

### 9. Load testing

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-LOAD-1 | Load client: current protocol sessions with scripted policies over WSS | P-CI-1 | Implemented/reviewed in `rh-load`; full-game scenarios remain | server/bench/netProbe*.ts, bandwidth.ts |
| P-LOAD-2 | Scenario runner at the **provisional** 200 matches / 1,600 players (an assumption, not authorization to spend) | P-LOAD-1, P-HOST-1 | Coarse | none |
| P-LOAD-3 | Final Rust + actual Unity/C# runtime efficiency pass versus legacy TypeScript/Colyseus/Phaser on matched M5 Pro workloads (R-OPT-4), coordinating client frame/memory/loading checks with P-UNITY-PERF-1; report server CPU, sustained FPS/CPU/GPU frames, memory/GC and network separately. Legacy server gates were avg <5 ms /p99 <15 ms tick and <20 KB/s per client | mechanic packets and representative full client | Coarse; explicit final owner gate | server/bench/stepBench.ts, bandwidth.ts; `parity-bench`, `wirebench` |

### 10. Operations

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-OPS-1 | Metrics, structured logs, tracing, tick-deadline misses, per-room stats export | P-HOST-1 | Coarse | server/src/rooms/tickPacer.ts (`tickStats`), index.ts `/readyz` |
| P-OPS-2 | Bounded operational and debugging events for future anti-cheat (order-budget hits, rejects, rewind clamps, impossible-input counters; no learned detectors) | P-OPS-1 | Coarse | server/src/sim/trace.ts, rooms/traceWriter.ts |
| P-OPS-3 | Telemetry port (balance data): recorder, sinks, analysis | mechanic packets | Coarse | server/src/sim/telemetry.ts, server/src/telemetry/, shared/telemetry.ts, deployment/cloudflare/src/telemetry/, docs/TELEMETRY.md |
| P-OPS-4 | Dashboards, alerts, runbooks | P-OPS-1 | Coarse | deployment/cloudflare/src/dashboard/ |
| P-OPS-5 | Secrets and config management (DB URL, salts, tokens) | P-HOST-1 | Coarse | server/src/config.ts |
| P-OPS-6 | Private replay store, retention and access control | P-OPS-1 | Coarse | crates/rh-server (take_replays) |

### 11. Migration and cutover

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-MIG-1 | Profile export from the legacy store (R2 `profiles/current.json` snapshot / `STASH_FILE`), dry-run import rehearsal, reconcile report | P-PERSIST-2 | Coarse | deployment/cloudflare/src/profileSnapshots.ts; crates/rh-persist (`import-legacy`) |
| P-MIG-2 | Staged rollout plan: shadow matches, cohort cutover, rollback (needs the ORIGINAL profile file, tokens are hashed) | P-MIG-1, P-LOAD-2 | Coarse | docs/CLOUDFLARE_PUBLIC.md |
| P-MIG-3 | Retire the legacy Cloudflare deployment (Worker, Container, R2, telemetry DO, DNS) | P-MIG-2 | Coarse | deployment/cloudflare/*, Dockerfile, .github/workflows/deploy.yml |
| P-MIG-4 | Freeze/retire `packages/` after parity sign-off (owner decision) | P-MIG-3 | Coarse | packages/* |

### 12. Open-source readiness

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-OSS-1 | License decision for project-authored code | owner | Resolved 2026-11-05: MIT; dependency/asset audit remains P-OSS-2 | docs/legacy/INVENTORY.md section 8 |
| P-OSS-2 | Asset and dependency audit: cargo (`cargo deny`/`about`), NuGet, npm, Unity packages, fonts/art provenance, the top-level `Unfinished code/` directory | P-OSS-1 | Coarse | package.json files |
| P-OSS-3 | CODE_OF_CONDUCT, SECURITY, issue/PR templates (`LICENSE` and `CONTRIBUTING.md` exist) | P-OSS-1 | Coarse | CONTRIBUTING.md |
| P-OSS-4 | Secret scan and history audit before publishing | P-OSS-1 | Coarse | none |

### 13. ML seams follow-ups (architecture only)

Explicitly out of scope: training, rewards, datasets, model runtimes, Python bindings, inference services, GPU resources.

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-ML-1 | Policy contract compatibility matrix and version-bump rules (`POLICY_CONTRACT_VERSION`, `OBSERVATION_VERSION`) with tests | P-BOTS-1 | Coarse | none (ADR 0005) |
| P-ML-2 | Observation extension rules for new mechanics: additive fields, leak tests per field, golden observation fixtures | each mechanic packet | Coarse | crates/rh-sim/tests/observe.rs |
| P-ML-3 | Networked seat interface (the `AsyncSeat` contract over a local socket, auth and rate limits for an external seat) as a specification plus a stub transport test | P-BOTS-1 | Coarse | none |
| P-ML-4 | Replay stability guarantee across versions (replay + content hash policy) | mechanic packets | Coarse | crates/rh-sim/src/replay.rs |

## Requirement coverage ([../REQUIREMENTS.md](../REQUIREMENTS.md))

| Requirement | Items |
|---|---|
| R-AUTH (Rust authority) | every section 1 item; P-NET-1 (prediction limits) |
| R-WEB (Unity Web, highest sustainable frame rate, budgets) | P-UNITY-1, P-UNITY-PERF-1, P-UI-* |
| R-AWS (hosting, regions, scaling, TLS, 200/1,600 assumption) | P-HOST-1..6, P-UI-2, P-LOAD-1..3 |
| R-GAME (continuity) | sections 1-4, P-PARITY-2, P-CAPTURE-1 |
| R-OPT (measured optimization) | P-LOAD-3, P-HEAD-1, cross-cutting rule above |
| R-VIS (creative Unity visuals with compatible open-source/original assets) | P-UI-7, P-UI-8, P-UI-9, P-MAP-4 |
| R-OSS | P-OSS-1..4, P-CI-1/2 |
| R-ML (architecture only) | P-BOTS-1, P-ML-1..4 |
| R-PERSIST | P-PERSIST-2..5, P-MIG-1 |
| R-PROC | README rules; packets never claim parity beyond what is compared |

## Owner answers and remaining questions

Owner confirmed 2026-11-05: MIT for project-authored code; Apple M5 Pro is the initial performance reference. The subsequent performance instruction supersedes the old 60 FPS goal: pursue the highest sustainable rate with intended quality intact and report browser/display limits separately. AWS staging is limited to CAD 20 total in the confirmed sandbox, using rougehalla.com. Production cutover remains a later approval. Other decisions remain as recorded below.

Each packet's "Risk" and "Known traps" name the question that blocks it. The author's consolidated list is in the hand-off
report of this backlog (license, map re-pin if hashes cannot match, hosting spend authorisation, Unity licence/hardware
naming, `packages/` retirement, bot perception window, and the doc conflicts noted there).


## Historical Stage 1 owner questions (current answers above take precedence)
1. License: none is declared (no LICENSE file; every package is `private`).
2. Whether a re-pin is acceptable if the Rust map generator cannot reproduce the legacy pinned hashes (P-MAP-1).
3. Spending authorization and a sandbox AWS account for the staging experiment; the 200 matches / 1,600 players scenario stays an assumption.
4. The named hardware for the 60 FPS target; the exact Unity 6 LTS patch and license; who approves download, memory and frame-time budgets.
5. Bot perception: keep the legacy screen-window view or adopt the observation's 900 u sight circle (P-BOTS-1 assumes the observation).
6. Where the profile REST API lives: inside `rh-server` or a separate service (P-PERSIST-2).
7. When to retire or freeze `packages/` after sign-off; the rollout and rollback policy (P-MIG-*).
8. How tightly to bound the rewind time `t` by measured RTT (P-NET-1).
9. The delta-compression threshold (P-NET-1 proposes: only if typical load exceeds the legacy 20 KB/s gate or a lower owner budget).
10. Fire roam scaling: AP (docs/FIRE_ROAM.md) or bonus Offense (legacy CLAUDE): check `packages/shared/src/fireRoam.ts`; code wins unless the owner rules otherwise.
11. `ca-west-1` and container-fleet home-Region support: unverified until the staging run.
12. Legacy callsigns are case-sensitive; the new store is case-insensitive (import reports case collisions as conflicts): choose how to resolve collisions before cutover (P-MIG-*).
13. Latency ceilings and the party rule (docs/hosting/LATENCY_PROBES.md).
14. Tie outcomes reveal bits of the secret action order (inherited from legacy; CONTRACTS C-RNG): accept it, or break ties with a separate secret stream (a deliberate legacy behaviour change, needs new fixtures).
15. Protocol v5 for unchanged snapshots (P-NET-7; v4 shipped as the lock-in bump): byte/packet savings against a protocol bump and new client behaviour.
16. Unity efficiency (P-UNITY-PERF-1) is deferred to the later Codex stage (the owner has already decided this, so it is recorded here, not open); its Unity-side numbers need an Editor profile before any budget is set.
