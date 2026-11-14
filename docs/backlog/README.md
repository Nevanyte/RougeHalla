# Roguehalla migration: remaining-work backlog

Written for a team that has only this repository (no chat history). Stage 1 built the Rust foundation. This file retains both current work and historical planning rows;
the latest MIGRATION checkpoint and backend workplan distinguish implemented work from actual remaining scope. Read first: [../CONTRACTS.md](../CONTRACTS.md) (invariants `C-*`), [../adr/README.md](../adr/README.md),
[../../parity/README.md](../../parity/README.md), [../legacy/INVENTORY.md](../legacy/INVENTORY.md) (legacy systems and numbers,
and section 9 "stale-doc discrepancies": the legacy `docs/legacy/CLAUDE_LEGACY.md` is a map, **code wins**).

**Historical foundation inventory (superseded by the current checkpoint; do not re-plan these components):** `rh-sim` slice (core layout: [ADR 0009](../adr/0009-core-layout.md) and `crates/rh-sim/README.md`) = lobby -> active -> ended, movement + A* pathfinding (exact legacy port),
fists/sword/shield/axe melee with zero-windup player swings and lag-compensated rewind, pickup/swap/drop, the damage ledger (PvP factor at card power 0,
mitigation, PvP hit cap, simultaneous resolution, kill credit, bounty + announcements, GV, win bonus gate), leaving (MIA),
observations (current sight only), replays and checkpoints; `rh-parity` (the legacy slice scenarios and 300 `findPath` queries match; `cargo run -p rh-parity --bin parity-report`);
`rh-protocol` v6 + C#/JS mirrors; `rh-server` (WSS, admission, resume, drain, limits, interest-managed replication, fill bots on
the policy seat contract, off-tick result sink, private replays); `rh-persist` (Postgres, fenced leases, idempotent
results, atomic achievements, legacy import); `rh-headless`; `tools/browser-proof`; `client-unity` (RoguehallaNet tested;
actual Unity 6000.0.85f2 Web build and the selected MVP match loop verified, including HUD, rewards/results and reconnect).
Initial loot discovery and all seven reliable views are integrated; broader content and cloud deployment remain open. The ported tick order is the table `schedule::PHASES` in `crates/rh-sim/src/schedule.rs` (run by `systems::update_active`); unported
rows are `Pending("P-...")` entries there, named after the legacy rows, and [../CONTRACTS.md](../CONTRACTS.md) C-TICK describes them.

## Backend continuation (owner instruction, 2026-11-09 America/Edmonton)

Remaining Rust gameplay, bots and quest backend preparation are active in a separate lane alongside Claude's
Unity/networking effort. DeepSeek implements Rust; Sol/Luna handle most architecture, inventory, plans and independent
review; Codex coordinates, admits changes and updates shared records. Work starts from committed backend `4151b3af`
in `codex/backend-gameplay-quests`, leaving Claude's primary checkout and active branches untouched.

Completed private admission: [P-BOT-MEMORY-ADMISSION-1](packets/P-BOT-MEMORY-ADMISSION-1.md), integrated as `8a2d3c6c`
after independent review of DeepSeek `0ea1589a` and its new-base focused tests/lint. The
[quest architecture](../coordination/QUEST_BACKEND_REWORK.md) and [P-QUEST-BACKEND-1](packets/P-QUEST-BACKEND-1.md)
have frozen actual-source evidence (`c605f2fb`); Stage0 is independently admitted and integrated as `8a11520d` + `56843a8e`, with content `8edd862f48ffa100` and unchanged schemas. The behavior-preserving objective/reward extraction is independently admitted as `ad98c441` + `9debd3e2`. The repaired [notice continuation](packets/P-QUEST-NOTICE-CONTINUATION-1.md) is independently admitted as `51a43597` + `0085ff79`; Root's combined check passes6 new and1 unchanged test. Its six-case witness does not establish complete181-record transport or browser quest parity. The reviewed test-only [Room delivery proof](packets/P-QUEST-ROOM-DELIVERY-1.md) is now dispatched from `9ee84dfe` to `backend-quest-room-delivery`; native completion/Outbox/privacy evidence remains to be produced.
[P-BOT-STRATEGY-1](packets/P-BOT-STRATEGY-1.md) is independently admitted through `2b05e607`; the later Send/mutable-goals composition bridge `96905908` is admitted as `04577169` + `030b3be8`. [P-BOT-TACTICS-1](packets/P-BOT-TACTICS-1.md) native `cdf5b70f` is admitted as `df62934a`, with154/720 source,238 author library tests and18 Root integrated focused tests. [P-BOT-MODULES-1](packets/P-BOT-MODULES-1.md) native `0c6dcee4` is independently admitted as `721d04da`:255/3259 source,24 intake negatives,28 semantic controls,354 author library tests and unchanged shared-engine overlaps/lint/format. Root's combined policy check at `721d04da` passes389/389, plus format and strict default/all-feature lint.

Full Brain source `6aaa4c6d` is independently released as `5a5a28c6` + `8fa97f24`; the Hand feature gate `76f8a9aa` is admitted as `483c1490` + `2436ed80`. The separate [path allowance bridge](packets/P-BOT-PATH-BUDGET-1.md) `5d351cb5` is admitted as `07babf29` + `6b4dbfad`, with3 Root tests. The [native Brain plan review](../evidence/bot-brain-native-plan-review/README.md) requires exact service/module/config identity and all-command Memory.noteSent. Its final four-file interface lease is reviewed and Root-approved; full private Brain is dispatched at `c050d938` to isolated `backend-bot-brain-native`. No native Brain admission is claimed. Potion-fact proof `aa05af1c` is admitted as `ae29dc1b` with5 Root tests at `06833e40`, limited to actual Active samples and explicit Ended/missing-owner refusal. The fair activation plan is reviewed at `10e9a901`; missing publication/binding work remains open.

Earned NPC bleed restore is independently admitted from `0be00f95` as `dedb8658`, with6 NPC and2 crash tests passing on Root's combined tree. Card feedback is still being implemented and reviewed in `backend-card-bleed-feedback`; its canonical amounts, viewer privacy, source comparison and measured capacity gates are not yet admitted. The morning instruction is backend development until **10:30am Edmonton November10 (17:30UTC)**, no Claude communication before then, followed by final merge/verification and the authorized `play.rougehalla.com` test deployment targeting11am. Standing owner approval applies; exact artifacts, the full client checklist and final Opus review remain required.
Use the [reconciled workplan](../coordination/BACKEND_GAMEPLAY_WORKPLAN.md) for this lane's queue and scopes.
Full live bot activation remains dependent on legitimate shared observations; no hidden-state shortcut,
protocol change or new quest design is implied. Treat older broad completion/partial rows below as historical until
reconciled with code and current evidence; neither a `Partial` comment nor an existing module alone establishes status.

## Historical November9 coordinator checkpoint

The [current migration checkpoint](../MIGRATION.md) supersedes the older version/status lists below:14/29/23/21/15/content7c6a633f68c2cc72. Native SlowStarter/complete MarkTax/PackLeader/readonly WalkHint and source timings are integrated with63 strict source cases and a derived native tape. Actual Training90 passes its frozen engine cut; layout/complete browser remain open. Pure owned-seat resume/checkpoint storage and private socket components are reviewed, with UI adoption/new-page proof and full fact/Brain activation still separate. Owner scope is the **full original port**, including durable regional hosting and matched M5 Pro performance; the earlier playable-core scope is historical. AWS login renewal is owner-deferred. Consult PROJECT_COORDINATION before allocating work; do not duplicate released components.

## Historical November 8 integration handoff

Use the superseding [migration checkpoint](../MIGRATION.md#consolidated-working-checkpoint-2026-11-08),
[lead/worker ownership and priorities](../PROJECT_COORDINATION.md) and
[protocol11 decision](../adr/0021-protocol11-union.md). The descriptive v6/foundation list above is historical; the union
now uses protocol11/checkpoint24/replay18/observation17/policy13 and includes native cards, arena/training, quests/traders,
bot planning/fill/tournament and faction/consumable continuations. Audit each packet's remainder before allocating work.

Keep active workers isolated. DeepSeek handles fixed-interface Rust ports, fixtures and mechanical tests; the lead owns
architecture/privacy/protocol decisions, merges, shared records and Cargo.lock. Current gates are Knowledge RNG/rounding/
null repair, the proposed fair observation leaves, safe opt-in bot learning, remaining native strict parity and complete
public Wish/Trophy/quest/trade/fact transports. The Unity art lane is independently proving a browser match and1440p
performance; local latency evidence is candidate-specific. Durable cloud/account/regional and matched full-game release
gates remain open. The removed Calgary MVP and old benchmarks do not satisfy those gates.

## How to pick up work

**Current first-release scope (owner decision 2026-11-05): playable core first.** Complete one browser match with
combat, mobs, a small card/chest selection, a functional Unity HUD and one AWS staging region. Quests, traders,
advanced bots, visual polish and large-scale hosting tests are deferred; this backlog retains the full original scope
for later milestones. Work only on dependencies needed for that loop now, preserving focused parity and regression
checks. See the concrete finish line in [MIGRATION](../MIGRATION.md#first-playable-release-scope--owner-decision-2026-11-05).

**Full-port continuation (owner2026-11-06):** continue this goal beyond the playable-core milestone. Deferred content,
complete browser/account flows, durable cloud progression and regional scaling remain required later work. Rust
gameplay/parity/headless lead; CAD20 total remains unchanged. The bounded Calgary run is now removed after verified cleanup.

**Current MVP gate:** the local and public Calgary Unity loop now passes, including loot/chest choice, results and
reconnect; [cloud evidence](../evidence/first-playable-calgary/README.md) records the temporary single-host deployment.
The bounded owner playtest and verified cleanup are complete at13:03:33UTC on2026-11-06. The practice deployment is
removed. Managed GameLift, persistent progression, full browser/content coverage and matched legacy performance remain
required full-port gates.

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
| P-ABIL-1 | Cast pipeline and five Wishes (`freeze`, `swarm`, `trial`, Fire's Blaze Step `blaze`, `lastStand`), stock clocks and wish lock | P-STATUS-1, P-COMBAT-3; P-ARENA active collision/teleport seams | [Ready packet](packets/P-ABIL-1.md);Bounded five-Wish native kernel integrated/reviewed with genuine Cast/refund,53 main cases+six companions. Full INCOMPLETE: exactten coupled card/player-reset/training/NPC cases and public transport. [Evidence](../evidence/stage2-abilities/native/README.md) | server/src/sim/abilities.ts; shared/abilities.ts, blink.ts |
| P-CARDS-1 | Stat mirrors and the `foldRows` build fold, card catalog (80 cards), card hooks, on-hit pipeline, guards G1-G13, PvP factor beyond power 0 | P-COMBAT-1, P-STATUS-1; in-flight Wish card-memory seam | [Full packet](packets/P-CARDS-1.md);409-case catalog/reward source accepted and coordinator pinned check passes. Native Slow Burn/Pocket Sand/Siphon plus shared stat/farm consumers remain the active subset; full runtime/hooks remain | server/src/sim/mods.ts, cardHooks.ts, cardState.ts, onHit.ts, vsProbe.ts, buffs.ts; shared/cards.ts, effects.ts, mods.ts, rules.ts |
| P-KIMI-FOLD-1 | Pure stat fold, mirrors and numeric chest boosts; 4,096-case CI differential plus 100,000-case bounded stress inventory | Reviewed integration `5b1a7aae`; independent of pending runtime | Pure kernel integrated at `7f294cc7`; 1,031-test workspace, Rust/C#/browser CI and all six native determinism jobs passed. Does not complete P-CARDS-1 | shared/mods.ts, effects.ts, chestBoosts.ts, constants.ts |
| P-BALANCE-1 | Rust duel/matrix balance harness: every weapon edge x faction mirror, legacy verdict thresholds (0.6 / 0.5 / 0.5), cell-by-cell legacy comparison; verification tool only | P-COMBAT-1, P-FACTION-1 (integrated), P-CAPTURE-1 | Parked 2026-11-10 by owner direction ([spec](packets/P-BALANCE-1.md)); oracle and legacy capture kept on `packet/P-BALANCE-1` as a loose reference | server/src/harness/{duel,matrix,report}.ts; shared/weapons.ts |
| P-BALANCE-2 | Camp-clear bench: each faction and weapon clears each camp kind under `LegacyCircle` and `Archetypes`; ticks, damage, healing, control seconds; verification tool only | none | Done (eff7384a; [spec](packets/P-BALANCE-2.md)) | shared/constants.ts (camp and mob multipliers); server/bench |
| P-HOLY-DEMON-BLOOD-1 | Holy camp lifesteal (0.005 per eligible camp clear) in combat and in build marks; closes DEV-012 | none | Done (3ce3c031; [spec](packets/P-HOLY-DEMON-BLOOD-1.md)) | shared/championPassives.ts, constants.ts; server/src/sim/factions.ts; shared/combatReadability.ts |
| P-SIM-BUILDSUMMARY-1 | Pure server-side GAINED strip values and mob-bonus rows for one player (no state, observation or wire change) | P-HOLY-DEMON-BLOOD-1 | Done (1639287d; [spec](packets/P-SIM-BUILDSUMMARY-1.md)) | client/src/ui/buildModel.ts, buildHud.ts |
| P-WIRE17-MAP-1 | Protocol 17: map blob carries camp markers, coliseum and gates, concealment bushes; reserved prop and ground-variant sections | P-HOLY-DEMON-BLOOD-1 | Done (b2305100; [spec](packets/P-WIRE17-MAP-1.md)) | shared/schema.ts (map never synced); client/src/ui/minimapMarkers.ts |
| P-WIRE17-HUD-1 | Protocol 17: camp rewards, ward verdict and expiry, owner-only build summary (GAINED values, mob-bonus rows); observation 25, policy 19 | P-WIRE17-MAP-1, P-SIM-BUILDSUMMARY-1 | Done (e018b7fe; [spec](packets/P-WIRE17-HUD-1.md)); the negative vectors note is folded into P-WIRE17-HUD-2 | client/src/ui/buildModel.ts, championCombatModel.ts; client/src/render/CampWards.ts, CampBuffs.ts |
| P-WIRE17-HUD-2 | Protocol 17: champion panel values (per-hit split, attacks/s, passive numbers, roam charge) in the owner summary; weapon scaling terms in Welcome; negative vectors for the HUD-1 fields | P-WIRE17-HUD-1 | Brief ([spec](packets/P-WIRE17-HUD-2.md)); needs oracle | client/src/ui/championCombatModel.ts |
| P-UNITY-HUD-BUILD-1 | Unity GAINED strip and mob-bonus row from the owner build summary | P-WIRE17-HUD-1 | Ready packet ([spec](packets/P-UNITY-HUD-BUILD-1.md)) | client/src/ui/buildModel.ts, buildHud.ts, mobStatsHud.ts |
| P-UNITY-HUD-CAMPS-2 | Unity camp reward badges and ward beacons on the minimap, Tab map and in the world | P-WIRE17-HUD-1, P-UNITY-HUD-CAMPS-1 | Ready packet ([spec](packets/P-UNITY-HUD-CAMPS-2.md)) | client/src/render/CampBuffs.ts, CampWards.ts; ui/minimapMarkers.ts |
| P-REGEN-COMBAT-1 | No passive regeneration in combat as `SimConfig::regen_in_combat` (default `Legacy`; live profiles `Off`); DEV-017 | none | Done (cloud session, merged 88265fb2; [spec](packets/P-REGEN-COMBAT-1.md)); fix: [P-REGEN-COMBAT-1-fix](packets/P-REGEN-COMBAT-1-fix.md) Ready | shared/constants.ts:665, server regen.ts |
| P-LEECH-GROUPING-1 | Leech score summed in legacy order | none | Done (cloud session, merged 88265fb2; [spec](packets/P-LEECH-GROUPING-1.md)) | server/src/sim/killAugments.ts |
| P-SIGNATURE-1 | `--map-pool --signature-landmarks`: volcano, church, bog tree, frozen cave as real terrain on pooled maps (off by default) | P-MAP-3 | Done (cloud session, merged 88265fb2; [spec](packets/P-SIGNATURE-1.md)); fixes: [P-SIGNATURE-1-fix](packets/P-SIGNATURE-1-fix.md) Ready; P-SIGNATURE-2 (owner wording) to write | none (new terrain) |
| P-BOT-BRAIN-LIVE-1 | Drive the ported Brain live and headless through the seat contract | P-BOT-FAIR-ACTIVATION-1 | Ready packet ([spec](packets/P-BOT-BRAIN-LIVE-1.md)); left to the cloud session card (start in one place only) | server bots |
| P-LOBBY-TIMING-1 | Owner rule 2026-11-10: 15 s lobby, bots fill at second 13 when no human match formed; legacy timing stays the default mode | none | Done (23781a6a; [spec](packets/P-LOBBY-TIMING-1.md)) | shared/constants.ts (lobby), server/src/sim/step.ts, bots/brain/types.ts (BOT_FILL_DEFAULTS) |
| P-LOBBY-ACTIVITY-1 | Public lobby activity endpoint and hub presence (who is in a game, who is waiting); roster delivered in the lobby phase | none | Done (3ce3c031 batch; [spec](packets/P-LOBBY-ACTIVITY-1.md)) | server/src/index.ts (lobby routes), guards/lobbyStatus.ts; shared/messages.ts |
| P-CARDS-2 | Camp chests, `choose`, augments, stat chests/crates, chest boosts, skip heal/GV | P-CARDS-1, P-MOBS-1 | MVP stat/elite chests, offers/choose/skip and eight boosts implemented; actual Unity choice/build proof passes; remaining pool remains open | server/src/sim/chests.ts; shared/rewards.ts, chestBoosts.ts |
| P-CARDS-3 | Kill augments and mob stat stacks (`MOB_KILL_STACKS` 3) | P-CARDS-1; P-MOBS-1 actor/combat stages for runtime capture | Coarse | server/src/sim/killAugments.ts, mobStats.ts; shared/killAugments.ts, mobStats.ts; docs/MOB_PROGRESSION.md |
| P-CONS-1 | Consumables: stored potions, wind emblems, 75 s cannons, `useConsumable` | P-LOOT-1 or P-COMBAT-4, P-MOBS-1 | Small potion storage/use/healing implemented with source/restore/headless/Unity proof; wind, other potions and cannons remain deferred | server/src/sim/consumables.ts; shared/consumables.ts |
| P-TRADE-1 | Neutral traders and per-run stat exchanges, `trade` | P-CARDS-3 | Coarse | server/src/sim/traders.ts; shared/traders.ts |
| P-QUEST-1 | K1 quests (20 defs, 10 known), accept, carriers, hidden offers, lifecycle | P-MOBS-1, P-CARDS-3, P-MAP-1 | Native lifecycle, givers, public actions and selected notices0/4 implemented/reviewed. Grand Tour mask repair admitted on backend lane; objective/reward extraction independently admitted in [P-QUEST-BACKEND-1](packets/P-QUEST-BACKEND-1.md). Notices1/2/3/5 repaired native consumer `e499d865` is independently admitted and integrated; complete public/Claude-owned client flow acceptance remains. Future quest design is not invented. | server/src/sim/quests.ts; shared/quests.ts; docs/quests.md |
| P-VISION-1 | Vision: actual 30 s private trail, owned wards, restore, bushes (`bushConceals`) | P-MAP-1 (bush layer), P-NET-3 | Trail/bush/attack-exposure prerequisite implemented and reviewed; remaining producers/dynamic geometry in [packet](packets/P-VISION-1.md) | server/src/sim/vision.ts; shared/vision.ts, bushes.ts |
| P-TERRAIN-1 | Hazards: ember burn, bog slow, ice slide (`walkFighter`), light heal; faction exemptions | P-MAP-1 (terrain layer), P-FACTION-1 | Bounded native kernel integrated/reviewed;20 born cases fully match and1 retains exact card-pool gap. Full packet INCOMPLETE: arena/training/full NPC/public-fact requirements remain. [Evidence](../evidence/stage2-terrain/README.md) | server/src/sim/terrainEffects.ts; shared/terrain.ts, walk.ts |
| P-ARENA-1 | Planning phase + spawn deal from a private stream, coliseum schedule/teleport/gates, patience, sudden death | Complete map layers and bounded terrain kernel integrated | Bounded native authority integrated/reviewed: planning/deals, lifecycle, collision/history and native observers. Full packet INCOMPLETE: full card hooks/arena-owned projection, wire/client and durable shutdown/MIA; genuine Wish/refund prerequisite now separately passes. [Evidence](../evidence/stage2-arena-native/README.md) | server/src/sim/planning.ts, arena.ts, step.ts; shared/planning.ts, coliseum.ts, rules.ts |
| P-ARENA-2 | Training rooms and the `train` console (card/stat/camp/chest/clear) | P-CARDS-2, P-MOBS-1 | Coarse | server/src/sim/training.ts; shared/training.ts |
| P-MOBS-CATALOG-1 | Pure typed 30-type/five-role catalog and draw-injected roster helpers; no actor/runtime or native RNG claim | Existing source and capture baseline | Integrated after independent acceptance and actual content registration; 322 +120 source cases, 327 aggregate checks, 1,207-test workspace gate passed. See stage2-mob-catalog evidence | shared/mobs.ts, rosters.ts, rng.ts |
| P-MOBS-1 | Full regional mob runtime: true non-seat actors, shared NPC combat/AI, camp lifecycle and applied rewards | P-MOBS-CATALOG-1; P-STATUS-1 for actor integration; staged card/stat producers for completion | Selected shared-actor Holy/Fire/Plague PvE and camp lifecycle/rewards implemented with source/headless/Unity proof; full regional runtime/scale gates remain open | server/src/sim/mobAI.ts, mobLife.ts, camps.ts; shared/mobs.ts, rosters.ts |
| P-MOBS-2 | Camp-clear heal, wards, elite chests, regen, `campCleared` hook chain | P-MOBS-1, P-CARDS-2 | Coarse | server/src/sim/campHeal.ts, regen.ts, camps.ts |

### 2. Bots

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-BOTS-1 | Human-like bot brain on `rh-policy` seats: perception from `Observation` only, tiers/personas, cadence | none (grows with Observation) | Private Memory, Strategy, Tactics, Modules, Hand and required path/Strategy bridges are admitted; full Brain source is independently reproduced. Full Brain composition, fair public binding and live/headless outcomes remain; follow [current workplan](../coordination/BACKEND_GAMEPLAY_WORKPLAN.md), not the old reduced-brain proposal. | server/src/bots/brain/*, humanizer.ts, clicks.ts, tactics/ |
| P-BOTS-2 | Wish module (`abilityPolicy`) | P-ABIL-1, P-BOTS-1 | The shared cast policy/slip core and complete private source-context adapter are independently admitted in [P-BOT-MODULES-1](packets/P-BOT-MODULES-1.md) as `721d04da`, preserving the five-Wish profile and unchanged overlaps. Full Brain and fair/live binding remain. | server/src/bots/abilityPolicy.ts, brain/modules/wishes.ts |
| P-BOTS-3 | Planning, chest, hazard modules | P-ARENA-1, P-CARDS-2, P-TERRAIN-1, P-BOTS-1 | Complete private planning/chest/hazard modules, ChestHunter/card choice and shared planning/hazard cores are independently admitted as `721d04da` in [P-BOT-MODULES-1](packets/P-BOT-MODULES-1.md). Full Brain composition and fair/live binding remain. | server/src/bots/brain/modules/*, chestHunt.ts |
| P-BOTS-4 | Mob hunting, build routes, camp farming, elite rules | P-MOBS-1, P-BOTS-1 | Full private strategy/hunter/tracker/route implementation is independently admitted through `2b05e607` in [P-BOT-STRATEGY-1](packets/P-BOT-STRATEGY-1.md); complete finite source/trace/intake gates pass. Complete tactics/Brain/live integration follows. | server/src/bots/mobHunt.ts, brain/buildRoute.ts, strategy.ts, huntAdapter.ts |
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
| P-MAP-3 | Off-tick certified-map pool (worker/thread, target 8, refill 6, fallback, hang watchdog) | P-MAP-1 | Done behind `--map-pool` (cloud session, merged 88265fb2; [spec](packets/P-MAP-3.md)); fix: [P-MAP-3-fix](packets/P-MAP-3-fix.md) Ready | server/src/mapPool.ts, mapWorker.ts |
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
| P-UNITY-TIMER-1 | Top-centre clock counts down to the coliseum (gate lock, then sudden death); lobby and planning countdowns | none | Done (c048ed72; [spec](packets/P-UNITY-TIMER-1.md)) | client/src/ui/hud.ts |
| P-UNITY-WAND-LOCK-1 | Wand click locks the nearest valid target within the legacy snap radius; never an unlocked shot; instant ring | none | Done (948ad221; [spec](packets/P-UNITY-WAND-LOCK-1.md)) | client/src/render/targeting.ts; shared/constants.ts |
| P-UNITY-MOB-DEATH-1 | A killed mob keeps its art across id changes and plays its death clip once, in full | none | Done (334cd073, fix 3bf92d8f; [spec](packets/P-UNITY-MOB-DEATH-1.md)) | client/src/render/MobView.ts (timing reference) |
| P-UNITY-SENTENCED-READ-1 | Sentenced wall tops, rims and fences meet a 3:1 contrast against the floor | none | Done (2f894a75, fix in 3ce3c031 batch; [spec](packets/P-UNITY-SENTENCED-READ-1.md)) | client/src/render/zoneArt/palette.ts, zoneStyle.ts |
| P-UNITY-SWING-FOLLOW-1 | Swing zones follow the attacker's drawn position; predicted position for the local player | P-UNITY-WAND-LOCK-1 | Done (4758fd5a; [spec](packets/P-UNITY-SWING-FOLLOW-1.md)) | client/src/render/FxView.ts |
| P-UNITY-OVERHEAD-1 | Overhead HUD in the legacy order and positions; Unity-only additions removed | P-UNITY-MOB-DEATH-1 | Done (ebc11c7a; [spec](packets/P-UNITY-OVERHEAD-1.md)) | client/src/render/PlayerView.ts, StatusArt.ts, MarkPlate.ts |
| P-UNITY-PROP-FADE-1 | One definition of tall; tall props fade for a visible actor behind or inside them | P-UNITY-SENTENCED-READ-1 | Done (3ce3c031 batch; [spec](packets/P-UNITY-PROP-FADE-1.md)) | none (Unity presentation rule) |
| P-UNITY-RANGE-IND-1 | Weapon range indicator: bow lane, wand circle, melee arc, from the server weapon table | P-UNITY-SWING-FOLLOW-1 | Done (3ce3c031 batch; [spec](packets/P-UNITY-RANGE-IND-1.md)) | client/src/render/WeaponRangeView.ts |
| P-UNITY-LOBBY-ROSTER-1 | Lobby lists seated players (roster, bot tags); hub shows "Active game" and "Waiting in the hub" from the public lobby endpoint | P-LOBBY-ACTIVITY-1, P-UNITY-TIMER-1 | Done (3ce3c031 batch; [spec](packets/P-UNITY-LOBBY-ROSTER-1.md)) | client/src/ui/lobbyActivity.ts, net/lobby.ts |
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

### 14. Beta follow-up packets not tabled above

Rows generated on 2026-11-12 from each brief's title and dependency section and from the integration branch's merge
commits; the brief is the authority for scope and legacy references. Current state of the program is in the
[MIGRATION](../MIGRATION.md) checkpoint.

| ID | Outcome | Depends on | Status | Legacy owners |
|---|---|---|---|---|
| P-AGENT-GATE-1 | the gate compiles Unity, knows stubs from oracles, and checks its own environment | none | Done (cdb7731d; [spec](packets/P-AGENT-GATE-1.md)) | see spec |
| P-BACKEND-UNITY-PREFLIGHT-1 | P-BACKEND-UNITY-PREFLIGHT-1 — isolated backend / Unity union preflight | none | Brief from before the beta follow-up; status not re-checked on 2026-11-12 ([spec](packets/P-BACKEND-UNITY-PREFLIGHT-1.md)) | see spec |
| P-BOT-BRAIN-1 | complete private createBrain source composition | none | Brief from before the beta follow-up; status not re-checked on 2026-11-12 ([spec](packets/P-BOT-BRAIN-1.md)) | see spec |
| P-BOT-BRAIN-CONTINUITY-1 | a Brain seat keeps track of a mob from one frame to the next, so its mob goals last | P-BOT-BRAIN-RECONCILE-1 | Done (7a0e206e0; [spec](packets/P-BOT-BRAIN-CONTINUITY-1.md); worker session; the owner accepted the kite fix and the two oracle edits) | see spec |
| P-BOT-BRAIN-LIVE-2 | `BrainBot` policy, production services, shared command mapper, headless selection (piece 2 of 3, second cut) | P-BOT-BRAIN-LIVE-1 | Superseded by P-BOT-BRAIN-RECONCILE-1 (the cloud session built it) ([spec](packets/P-BOT-BRAIN-LIVE-2.md)) | see spec |
| P-BOT-BRAIN-LIVE-2a | the Brain's input side accepts everything the composer emits (piece 2, first cut) | P-BOT-BRAIN-LIVE-1 | Done (landed before the reconcile, 5d4de8ab; [spec](packets/P-BOT-BRAIN-LIVE-2a.md)) | see spec |
| P-BOT-BRAIN-LIVE-3 | `rh-server --bot-brain`, seat choice, fault fallback, learning facts (piece 3 of 3) | P-BOT-BRAIN-LIVE-2 | Superseded by P-BOT-BRAIN-RECONCILE-1 (the cloud session built it) ([spec](packets/P-BOT-BRAIN-LIVE-3.md)) | see spec |
| P-BOT-BRAIN-NATIVE-1 | compose the complete private Brain | none | Done (decf068f) ([spec](packets/P-BOT-BRAIN-NATIVE-1.md)) | see spec |
| P-BOT-BRAIN-RECONCILE-1 | one bot Brain from two sessions' work | none | Done (5d4de8ab; [spec](packets/P-BOT-BRAIN-RECONCILE-1.md)) | see spec |
| P-BOT-HAND-FEATURE-1 | preserve source feature rejection before hand work | none | Brief from before the beta follow-up; status not re-checked on 2026-11-12 ([spec](packets/P-BOT-HAND-FEATURE-1.md)) | see spec |
| P-BOT-LEARN-ON-1 | the headless tournament seats Brain bots and runs the legacy learner | P-BOT-BRAIN-RECONCILE-1, P-BOT-BRAIN-CONTINUITY-1 | Done (843fd9e75; [spec](packets/P-BOT-LEARN-ON-1.md); worker session) | see spec |
| P-BOT-POTION-FACT-1 | accepted owner healing predicate proof | none | Brief from before the beta follow-up; status not re-checked on 2026-11-12 ([spec](packets/P-BOT-POTION-FACT-1.md)) | see spec |
| P-BOT-STRATEGY-COMPOSITION-BRIDGE-1 | Send-safe callbacks and mutable module-goal services | none | Brief from before the beta follow-up; status not re-checked on 2026-11-12 ([spec](packets/P-BOT-STRATEGY-COMPOSITION-BRIDGE-1.md)) | see spec |
| P-BOT-TUNER-1 | an offline, seeded search over the Brain's existing tier and persona numbers | P-BOT-LEARN-ON-1, P-BOT-BRAIN-CONTINUITY-1 | Done (843fd9e75; [spec](packets/P-BOT-TUNER-1.md); worker session) | see spec |
| P-CAMP-BUFF-THEMES-1 | each zone's camps pay a themed stat, spread evenly, as a sim switch the live profiles turn on | P-WIRE17-HUD-1, P-REGEN-COMBAT-1-fix | Done (819f2cf2; [spec](packets/P-CAMP-BUFF-THEMES-1.md)) | see spec |
| P-CARD-BLEED-FEEDBACK-1 | grouped card DoT hit feedback | none | Brief from before the beta follow-up; status not re-checked on 2026-11-12 ([spec](packets/P-CARD-BLEED-FEEDBACK-1.md)) | see spec |
| P-DRESS-ANCHOR-1 | decoration rings are anchored on each zone's landmark, in the generator's bands | P-MAPGEN-SIG-FROST-1, P-MAPGEN-SIG-SENTENCED-1 | Done (552044db; [spec](packets/P-DRESS-ANCHOR-1.md)) | see spec |
| P-DRESS-BAKE-1 | decoration is baked on the server with each map and sent to clients in the map blob | P-DRESS-ANCHOR-1, P-WIRE17-HUD-3, P-WIRE17-MAP-2 | Done (3f2f42b8; [spec](packets/P-DRESS-BAKE-1.md)) | see spec |
| P-DRESS-ENGINE-1 | `rh-mapdress`, a pure rule engine that decorates a generated map in order | none | Done (c6b8ec55; [spec](packets/P-DRESS-ENGINE-1.md)) | see spec |
| P-DRESS-MARSH-1 | Plague marsh rings as decoration ground variants round bog terrain | P-DRESS-ANCHOR-1 | Done (86806e01; [spec](packets/P-DRESS-MARSH-1.md)) | see spec |
| P-FROST-WALL-1 | Frost Wall in the sim: a placed barrier that stops bodies and swings, as a switch the live profile turns on | P-REGEN-COMBAT-1-fix, P-CAMP-BUFF-THEMES-1 | Farmed out to a worker session ([spec](packets/P-FROST-WALL-1.md); prompt in docs/coordination/prompts/) | see spec |
| P-HOST-FLAGS-1 | the beta host can launch with the map pool, the landmarks and the 15-second lobby | none | Farmed out to a worker session ([spec](packets/P-HOST-FLAGS-1.md); prompt in docs/coordination/prompts/) | see spec |
| P-MAPGEN-SIG-FIRE-1 | the Fire volcano in the generator, with lava streams ending in pools and the zone's obstacles arranged around it | P-MAPGEN-SIGNATURE-CORE-1, P-MAPGEN-SIG-FROST-1, P-MAPGEN-SIG-STYLE-1 | Done (72189c7c; [spec](packets/P-MAPGEN-SIG-FIRE-1.md)) | see spec |
| P-MAPGEN-SIG-FIRE-2 | Fire's craters are arranged by band from the volcano by construction; streams stay two tiles wide | P-MAPGEN-SIG-FIRE-1, P-MAPGEN-SIG-FROST-1 | Done (7ba766aa; [spec](packets/P-MAPGEN-SIG-FIRE-2.md)) | see spec |
| P-MAPGEN-SIG-FROST-1 | the Frost cave in the generator, around the far elite camp, its mouth on the frozen lake | P-MAPGEN-SIG-FIRE-1, P-MAPGEN-SIG-FIRE-2, P-MAPGEN-SIG-STYLE-1 | Done (c92a0519; [spec](packets/P-MAPGEN-SIG-FROST-1.md)) | see spec |
| P-MAPGEN-SIG-FROST-2 | a Frost map whose main lake is not at the cave's mouth, or whose landmarks crowd each other's aprons, is discarded | P-MAPGEN-SIG-FROST-1 | Done (6d292323; [spec](packets/P-MAPGEN-SIG-FROST-2.md)) | see spec |
| P-MAPGEN-SIG-PLAGUE-1 | Plague's marsh pools are rings (mud, water, bog) arranged by band from the bog tree | P-MAPGEN-SIG-RESERVE-1 (P-TERRAIN-MARSH-1 is cancelled) | Brief ([spec](packets/P-MAPGEN-SIG-PLAGUE-1.md)); needs oracle | see spec |
| P-MAPGEN-SIG-SCALE-1 | the volcano, church, bog tree and cave are a lot larger, a little smaller than the Holy hall | P-MAPGEN-SIG-FROST-2, P-MAPGEN-SIG-SENTENCED-1, P-MAPGEN-SIG-PLAGUE-1 | Done (f7bf8f9d5; [spec](packets/P-MAPGEN-SIG-SCALE-1.md); the fixed 29 x 29 cave and the territory relabel) | see spec |
| P-MAPGEN-SIG-SENTENCED-1 | Sentenced's yards and guard houses are arranged by band from the church; Holy's hall is placed in the Landmarks phase | P-MAPGEN-SIG-FROST-1, P-MAPGEN-SIG-PLAGUE-1 | Oracle committed on packet/P-MAPGEN-SIG-SENTENCED-1 ([spec](packets/P-MAPGEN-SIG-SENTENCED-1.md)) | see spec |
| P-MAPGEN-SIGNATURE-CORE-1 | the generator places each zone's landmark right after the zones, and everything later is built around it | P-SIGNATURE-1-fix, P-SIGNATURE-2 | Done (17272682; [spec](packets/P-MAPGEN-SIGNATURE-CORE-1.md)) | see spec |
| P-MECHANICS-SALVAGE-1 | the on-hit rules of `fix/mechanics-sim` (Best Offense block hits, Eye for an Eye returned on-hit, axe shred k, Fire backlash as returned damage) | P-CAMP-BUFF-THEMES-1, P-FROST-WALL-1 | Done (21417e80; [spec](packets/P-MECHANICS-SALVAGE-1.md)) | see spec |
| P-MECHANICS-SALVAGE-2 | block and riposte bookkeeping from `fix/mechanics-sim` (Best Offense pending note, card weapon-hit test, riposte returned mult) | P-MECHANICS-SALVAGE-1, P-MECHANICS-SALVAGE-3 | Done (243bd561; [spec](packets/P-MECHANICS-SALVAGE-2.md)) | see spec |
| P-MECHANICS-SALVAGE-3 | camp-clear and Wish bookkeeping from `fix/mechanics-sim` (bruiser mirror rows, armWishes effect refresh, resetAll DoT crit memory) | P-MECHANICS-SALVAGE-2 | Done (447ba55c; [spec](packets/P-MECHANICS-SALVAGE-3.md)) | see spec |
| P-NPC-BLEED-RESTORE-1 | accept earned Hemorrhage bleed on regional NPC restore | none | Brief from before the beta follow-up; status not re-checked on 2026-11-12 ([spec](packets/P-NPC-BLEED-RESTORE-1.md)) | see spec |
| P-TERRAIN-MARSH-1 | mud and water ground (two new slow terrains), Plague exempt | P-WIRE17-HUD-2b | Cancelled ([spec](packets/P-TERRAIN-MARSH-1.md)) | see spec |
| P-TRAINING-CAMPS-1 | practice camps count as legacy counts them, and the console's clear resets camp progress | P-MECHANICS-SALVAGE-3 | Brief ([spec](packets/P-TRAINING-CAMPS-1.md)); needs oracle | see spec |
| P-UNITY-DECLUTTER-1 | one mark per camp (its buff) and a marker for elites; no zone shapes on camps, no per-mob role marks | P-UNITY-HUD-VISUAL-FIX-1 | Done (4899089e; [spec](packets/P-UNITY-DECLUTTER-1.md)) | see spec |
| P-UNITY-HUD-BUILD-2 | the bottom-left champion panel shows the legacy rows from the server's panel values | P-WIRE17-HUD-2 | Done (c4de710c; [spec](packets/P-UNITY-HUD-BUILD-2.md)) | see spec |
| P-UNITY-HUD-BUILD-3 | the champion panel and weapon slots draw the numbers the server now delivers | P-WIRE17-HUD-2b, P-WIRE17-HUD-2c | Done (6030df63; [spec](packets/P-UNITY-HUD-BUILD-3.md)) | see spec |
| P-UNITY-HUD-CAMPS-3 | reward chests show their remaining seconds on the maps and in the world | P-UNITY-HUD-CAMPS-2 | Done (230ab51b; [spec](packets/P-UNITY-HUD-CAMPS-3.md)) | see spec |
| P-UNITY-HUD-STATUS-1 | the top line, consumable timers and cooldown text read as legacy | P-UNITY-HUD-TERRAIN-1 | Done (bd0fb5e6; [spec](packets/P-UNITY-HUD-STATUS-1.md)) | see spec |
| P-UNITY-HUD-TERRAIN-1 | terrain chips say what the ground under you is doing | P-UNITY-HUD-BUILD-1 | Done (042989f2; [spec](packets/P-UNITY-HUD-TERRAIN-1.md)) | see spec |
| P-UNITY-HUD-TEXTSCALE-1 | the text-size setting scales every HUD label and each label still fits its box | P-UNITY-HUD-VISUAL-FIX-2 | Done (9cca8926; [spec](packets/P-UNITY-HUD-TEXTSCALE-1.md)) | see spec |
| P-UNITY-HUD-VISUAL-FIX-1 | defects seen in the first real screenshots of the Web client | P-UNITY-HUD-BUILD-2 | Done (33333cf7; [spec](packets/P-UNITY-HUD-VISUAL-FIX-1.md)) | see spec |
| P-UNITY-HUD-VISUAL-FIX-2 | what the second screenshot round still shows wrong | P-UNITY-HUD-VISUAL-FIX-1, P-UNITY-HUD-BUILD-2, P-UNITY-DECLUTTER-1 | Done (c21d662e; [spec](packets/P-UNITY-HUD-VISUAL-FIX-2.md)) | see spec |
| P-UNITY-HUD-VISUAL-FIX-3 | drawer count, readable terrain chips, Hunt card, Tab-map footer and clock, hub activity card, cannon | P-UNITY-NAME-GROUP-2 | Done (92135661; [spec](packets/P-UNITY-HUD-VISUAL-FIX-3.md)) | see spec |
| P-UNITY-HUD-VISUAL-FIX-4 | mob names read on pale ground and stay one per camp pack; terrain chip and Hunt card stop overlapping; small leftovers | P-UNITY-NAME-GROUP-2, P-UNITY-HUD-VISUAL-FIX-3 | Done (aacb7c0e; [spec](packets/P-UNITY-HUD-VISUAL-FIX-4.md)) | see spec |
| P-UNITY-INSPECTOR-1 | the enemy inspector card on hover | none | Done (980229ed; [spec](packets/P-UNITY-INSPECTOR-1.md)) | see spec |
| P-UNITY-NAME-GROUP-1 | a pack of the same mob shows one name | P-UNITY-HUD-VISUAL-FIX-2 | Done (1aff1d31; [spec](packets/P-UNITY-NAME-GROUP-1.md)) | see spec |
| P-UNITY-NAME-GROUP-2 | a pack's one name is readable and sits on the pack; in-world camp labels read on any ground | P-UNITY-NAME-GROUP-1 | Done (8b5033a7; [spec](packets/P-UNITY-NAME-GROUP-2.md)) | see spec |
| P-UNITY-NAME-LEGIBLE-1 | names read on snow and paving; an elite's name clears its camp badge; the hub card holds its text | P-UNITY-HUD-BUILD-3 | Done (20de5176; [spec](packets/P-UNITY-NAME-LEGIBLE-1.md)) | see spec |
| P-UNITY-OVERHEAD-2 | statuses are drawn on the body at fixed spots, as legacy | P-UNITY-OVERHEAD-1 | Done (e43e8cf6; [spec](packets/P-UNITY-OVERHEAD-2.md)) | see spec |
| P-UNITY-TRAINING-HUD-1 | the HUD does not vanish after the drawer and the Tab map are toggled; the training console shows all its rows | none | Done (04f43fbd; [spec](packets/P-UNITY-TRAINING-HUD-1.md)) | see spec |
| P-UNITY-WORLD-MARKS-1 | the "HUNT" label on the hunted rival's dot on the Tab map | none | Done (b4bb37bf; [spec](packets/P-UNITY-WORLD-MARKS-1.md)) | see spec |
| P-WIRE17-HUD-2b | protocol 17 carries weapon scaling terms and the Wish row numbers | P-WIRE17-HUD-2 | Done (13c58030; [spec](packets/P-WIRE17-HUD-2b.md)) | see spec |
| P-WIRE17-HUD-2c | protocol 17 carries the Fire roam line and the auto tooltip's missing numbers | P-WIRE17-HUD-2, P-WIRE17-HUD-2b | Done (183690e0; [spec](packets/P-WIRE17-HUD-2c.md)) | see spec |
| P-WIRE17-HUD-3 | protocol 17 carries the room's minimum players and the owner's healing and wind-emblem end times | P-WIRE17-HUD-2, P-UNITY-HUD-STATUS-1 | Done (49767960; [spec](packets/P-WIRE17-HUD-3.md)) | see spec |
| P-WIRE17-MAP-2 | protocol 17 carries the camp patience plane and the quest carrier's actor id | P-WIRE17-HUD-3 | Done (2c8e49013; [spec](packets/P-WIRE17-MAP-2.md); patience plane and quest carrier) | see spec |
| P-UNITY-HUD-STATUS-2 | the HUD shows the lobby's "n/min" and the healing and wind-emblem timers | P-WIRE17-HUD-3 | Done (ceeb4746; [spec](packets/P-UNITY-HUD-STATUS-2.md)) | client/src/ui/hud.ts, weaponBar.ts |
| P-UNITY-HUD-RESTING-1 | the RESTING chip: needs a wire fact (a redacted attacker and arena damage arrive as the same value, so the client cannot tell a combat hit) | P-UNITY-HUD-STATUS-2 | Coarse: no brief yet; cut from P-UNITY-HUD-STATUS-2 by its oracle author | client/src/render/zoneArt/terrainFeedback.ts |
| P-MECHANICS-SALVAGE-3-fix | the overhead build marks read the camp-clear mirror | P-MECHANICS-SALVAGE-3 | Brief ([spec](packets/P-MECHANICS-SALVAGE-3-fix.md)); needs oracle | see spec |
| P-UNITY-TRAINING-BANNER-1 | the practice screen shows legacy's "nothing here is recorded" banner, not Kills and GV | none | Brief ([spec](packets/P-UNITY-TRAINING-BANNER-1.md)); needs oracle | see spec |
| P-MAPGEN-SIG-HOLY-1 | Holy's temple hall is one fixed open-colonnade blueprint placed in the Landmarks phase, with its own reserved site | P-MAPGEN-SIG-RESERVE-1 | Brief ([spec](packets/P-MAPGEN-SIG-HOLY-1.md)); measurement first | see spec |
| P-ALLOC-CLONE-WARM-1 | the first step after a clone or a restore allocates nothing, and the test that says so runs under the gate | P-TRAINING-CAMPS-1 | Brief ([spec](packets/P-ALLOC-CLONE-WARM-1.md)); needs oracle | none |
| P-UNITY-DRESS-1 | the client draws the decoration the server sends and rolls none of its own | P-DRESS-BAKE-1 | Done (b913a74d9; [spec](packets/P-UNITY-DRESS-1.md); shipped props and ground variants drawn) | none |
| P-SIM-REPLAY-LONG-1 | a replay steps exactly as the live room does, so a long recording verifies (stale events in an uncleared buffer wake shield mobs) | none | Done (d4bc8b0ed; [spec](packets/P-SIM-REPLAY-LONG-1.md); a step reads back only its own events; the seed-3 long Brain replay verifies) | none |
| P-MAPGEN-STYLE-REFUSE-1 | a styler that cannot build round its landmark refuses the attempt; it does not fail generation | P-LAND-SENTENCED-1 | Done (5cb0bbac4; [spec](packets/P-MAPGEN-STYLE-REFUSE-1.md); map generator session; reviewer-opus LAND) | none |
| P-WIRE17-MAP-3 | the map blob carries each zone's landmark anchor, so the client can draw landmarks as landmarks | P-WIRE17-MAP-2 | Done (d02d06c15; [spec](packets/P-WIRE17-MAP-3.md); landmark anchors on the wire; note 2 (rename the C# protocol MapRect) open) | none |
| P-UNITY-WORLD-MARKS-2 | the client draws each camp's patience range and the quest carrier's flag | P-WIRE17-MAP-2 | Done (3c82dc94f; [spec](packets/P-UNITY-WORLD-MARKS-2.md); patience outlines and carrier flag) | client/src/render/CampPatience.ts, QuestView.ts |
| P-FROST-WALL-1b | Frost Wall, second sim part: fighters it lands on, walks under way, mobs and blinks | P-FROST-WALL-1 | Brief ([spec](packets/P-FROST-WALL-1b.md)); needs oracle | legacy patch 78dd8bd4 |
| P-FROST-WALL-2 | Frost Wall on the wire, and the live profiles select it | P-FROST-WALL-1b, P-WIRE17-MAP-3 | Brief ([spec](packets/P-FROST-WALL-2.md)); needs oracle | legacy patch 78dd8bd4, cde6f785 |
| P-BOT-BRAIN-CHOICES-1 | a Brain seat records the choices it makes, so the learner has something to learn from | P-BOT-BRAIN-CONTINUITY-1, P-BOT-LEARN-ON-1 | Brief ([spec](packets/P-BOT-BRAIN-CHOICES-1.md)); needs oracle | server/src/bots/brain.ts |
| P-BOT-TUNER-2 | the search's output can tell an improvement from noise (per-tier intervals, a held-out re-score) | P-BOT-TUNER-1 | Done (c0612c6ff; [spec](packets/P-BOT-TUNER-2.md); evidence block; the three review notes applied) | none |
| P-UNITY-LANDMARK-1 | the client draws a zone's landmark as a landmark: the framework (art derived from the delivered tiles inside the anchor's footprint; a roof that fades when you are inside) and the Frost cave | P-WIRE17-MAP-3, P-MAPGEN-SIG-SCALE-1 | Done (5a1b3496b; [spec](packets/P-UNITY-LANDMARK-1.md); framework and cave art; two look notes go to the screenshot round) | none |
| P-UNITY-DRESS-2 | on a dressed map shadows follow the shipped tall flag and the client rolls no Plague water of its own; one map-run limit in C# | P-UNITY-DRESS-1 | Done (f5d3ddd18; [spec](packets/P-UNITY-DRESS-2.md); the decoded-bytes constant left out: an existing test pins its stale value) | none |
| P-UNITY-LANDMARK-2 | the Fire volcano is drawn as a volcano (tiered cone, crater and channel glow; no roof) | P-UNITY-LANDMARK-1 | Done (0d45760c7; [spec](packets/P-UNITY-LANDMARK-2.md); three look and robustness notes go to P-UNITY-LANDMARK-SEAMS-1 and the screenshot round) | none |
| P-UNITY-LANDMARK-3 | the Sentenced church: a roofed building that fades when you are inside, the main gate, gravestones | P-UNITY-LANDMARK-1 | Done (2c6a01965; [spec](packets/P-UNITY-LANDMARK-3.md); review notes 1 and 2 applied) | none |
| P-UNITY-LANDMARK-4 | the Plague bog tree: trunk, roots and a canopy that fades when you are under it | P-UNITY-LANDMARK-SEAMS-1 | Done (e183698f8; [spec](packets/P-UNITY-LANDMARK-4.md); three review notes applied: the crown stays on its cover, build cost halved) | none |
| P-UNITY-LANDMARK-5 | the Holy hall: 32 columns, an open nave, a roofed shrine | P-UNITY-LANDMARK-1 | Done (a8a2c4188; [spec](packets/P-UNITY-LANDMARK-5.md); review notes applied, columns redrawn) | none |
| P-UNITY-LANDMARK-SEAMS-1 | the landmark framework survives a faulty art; an art can read special terrain and set its own cover (roof or canopy) | P-UNITY-LANDMARK-2, -3 | Done (ebd779375; [spec](packets/P-UNITY-LANDMARK-SEAMS-1.md); both notes applied) | none |
| P-UNITY-ZONE-CONTRAST-1 | in the Plague and Sentenced zones the subjects stand apart from the ground and from each other (owner direction 2026-11-13: "very mono coloured") | P-UNITY-LANDMARK-1 to -5 | Withdrawn 2026-11-13 ([spec](packets/P-UNITY-ZONE-CONTRAST-1.md)): its premise came from renders that were too dark; the owner approved the real look | client/src/render/palette.ts |
| P-UNITY-LANDMARK-ROOF-RETURN-1 | landmark roofs follow the owner's rule: the player under it about 10 percent, only other visible actors about half, nobody opaque | P-UNITY-LANDMARK-SEAMS-1 | Done (61839ed0d; [spec](packets/P-UNITY-LANDMARK-ROOF-RETURN-1.md); spectating with the roof at half is untraced) | none |
| P-UNITY-GROUND-SAMPLERS-1 | the ground shader compiles for the Web target, so `build-web.sh` finishes (round 9: sampler limit exceeded on gles3) | none | Done (e8940dc5a; [spec](packets/P-UNITY-GROUND-SAMPLERS-1.md); the all-four-lights variant is at 11 samplers; `build-web.sh` still to be run on the merged tree) | none |
| P-UNITY-SENTENCED-TILES-1 | the Sentenced floor's tiles vary: browns, lighter greys and purples scattered among the dark stone (owner direction 2026-11-13) | none | Reverted before push ([spec](packets/P-UNITY-SENTENCED-TILES-1.md)): in the client the tints were flat vivid fills; rebuilt as part of P-UNITY-GROUND-TINT-1 | client/src/render/zoneArt |
| P-UNITY-GROUND-TINT-1 | ground tints modulate the ground art (they do not replace it): the server's decoration bands in every zone, and the Sentenced floor's scattered tiles | P-UNITY-DRESS-1 | Brief ([spec](packets/P-UNITY-GROUND-TINT-1.md)); needs oracle | none |
| P-UNITY-LOOK-TOOLS-1 | a look check any agent can run (editor capture and compare) and the Web round written down, for the tuning lane | none | Done (fcb5affc5; [spec](packets/P-UNITY-LOOK-TOOLS-1.md); the Web recipe was written from two rounds and not re-run) | none |

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
