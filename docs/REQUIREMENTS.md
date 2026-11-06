# Roguehalla requirements

The complete product requirements and exclusions of the Rust + Unity + AWS migration. They express intended behaviour;
code contracts ([CONTRACTS.md](CONTRACTS.md)) and tests supply the evidence. A bug never redefines a requirement. Where a
product detail is unspecified, the current intended gameplay of the legacy game is the default (see "Gameplay
continuity"). Requirement IDs (R-*) are referenced from the backlog.

## R-AUTH: Rust is the authority
- R-AUTH-1. The full gameplay simulation and the authoritative multiplayer server are written in Rust (`crates/`).
- R-AUTH-2. Unity supplies presentation, input and narrowly defined client prediction only (the local player's walk;
  never attacks, damage, deaths, other players or outcomes). Unity is never a second gameplay authority.
- R-AUTH-2a. All game rules, physics, collision, combat, AI and bot behaviour live only in the Rust simulation/policy/
  headless stack (`rh-sim`, `rh-policy`, `rh-headless`). Local movement prediction is the sole client exception: it mirrors
  Rust movement, passes Rust test vectors, is always corrected by authoritative state, and is never used by headless or
  future ML runs. Unity render animation and projectile presentation never decide hits or other game outcomes.
- R-AUTH-3. Clients send inputs only; the server never accepts positions, damage or outcomes from a client.

## R-WEB: Unity browser client
- R-WEB-1. The client is C# in Unity, playable through an actual Unity Web build in supported ordinary browsers
  (Chrome, Edge, Firefox, Safari current versions). Desktop builds may remain possible. A separate mobile port is not
  required.
- R-WEB-2. Browser constraints are respected: WebSocket (wss) transport through the browser; no native sockets, UDP,
  ICMP, desktop-only libraries or per-frame native FFI; IL2CPP/AOT-safe code (no runtime code generation).
- R-WEB-3. Pursue the **highest sustainable frame rate** while preserving intended gameplay, readability and visual
  quality. The owner selected **Apple M5 Pro** as the initial named reference on 2026-11-05 and explicitly replaced the
  earlier 60 FPS goal with a request to measure how far performance can be pushed. Report CPU/GPU frame-time
  distributions and browser/display limits separately; do not infer rendered FPS from the Rust server's throughput.
  Frame time, memory, download size and load time have explicit measured budgets. Verify representative crowded
  gameplay, not just a movement smoke; results do not establish performance on other hardware.

## R-AWS: multiplayer hosting on AWS
- R-AWS-1. Hundreds of simultaneous matches, up to eight players per match.
- R-AWS-2. Latency-aware regional placement considering every party member, capacity and latency ceilings; automatic
  selection shown to the player with the measured ping; manual region override.
- R-AWS-3. Automatic capacity adjustment (scale on available session capacity and demand, with CPU, memory,
  tick-deadline and join-delay guardrails); efficient host packing (several matches per process/host where measured);
  active matches protected on scale-in and deployment; idle sessions closed; warm capacity vs cold start documented.
- R-AWS-4. Western Canadian players are considered (candidate locations measured; `ca-west-1` availability verified).
- R-AWS-5. Active cross-region match migration is NOT required.
- R-AWS-6. Provisional sizing scenario: 200 concurrent matches / 1,600 players. This is a planning ASSUMPTION, not measured
  capacity and not a spending authorization. Nothing at that scale is provisioned without budget authorization.
- R-AWS-7. A browser-reachable secure endpoint with valid TLS and DNS (not just an IP and port).

## R-GAME: gameplay continuity
- R-GAME-1. Preserve intended controls, rules, timing, balance, fairness, progression, existing bots and player flows, and
  recognizable presentation. The legacy code at the baseline revision ([MIGRATION.md](MIGRATION.md)) is the reference;
  where legacy docs disagree with code, code and tests win and the doc is corrected (known disagreements:
  [legacy/INVENTORY.md](legacy/INVENTORY.md) section 9).
- R-GAME-2. Controls (current live playtest, README "Live playtest update"): WASD/arrows move; click attacks; the wand alone
  locks/homes; R casts the Wish; E drinks a potion; Tab shows the map and weapons; J the quest log; F interacts.
- R-GAME-3. Fixed 20 Hz authoritative tick; fair input ordering (secret per-tick shuffle); lag compensation (melee rewind
  bounded by `MAX_REWIND_MS`); simultaneous damage resolution with the legacy tie rules; secret state never sent to
  clients (deals, hidden quests, chest rolls, salts).
- R-GAME-4. Player flows: hub, profile claim/sign-in, matchmaking (arena and training), lobby with fill bots, planning,
  the run (camps, quests, chests, coliseum teleports, sudden death), death/results, GV banking, leaving (MIA), disconnect
  and reconnect (seat held for the grace), match termination and shutdown voiding.
- R-GAME-5. Ordinary game rewards, loot, currency (GV), cosmetics, achievements and progression remain in scope.
- R-GAME-6. If a product change is genuinely unresolved, preserve existing intended behaviour and record the decision for
  the owner instead of redesigning silently.

## R-OPT: measured optimization
- R-OPT-1. Both stages actively identify and implement worthwhile improvements in algorithms, data structures, allocation,
  spatial/pathfinding/perception work, replication, serialization, batching, rendering and hosting, preserving intended
  behaviour. A literal line-by-line translation is not the objective.
- R-OPT-2. Every optimization records its observed cost, mechanism, behavioural risk and comparable before/after evidence
  (revision, hardware, native/emulated, workload, build mode, duration). Complexity without demonstrated value is removed.
- R-OPT-3. Server CPU, network RTT, browser CPU/GPU, memory, download size and operating complexity are separate budgets.
  No automatic improvement is promised from adopting Rust, Unity or AWS.
- R-OPT-4. Owner request 2026-11-05: perform a final runtime profiling and efficiency pass across the completed Rust
  server and actual Unity/C# browser build, compared with the legacy TypeScript/Colyseus/Phaser stack on the M5 Pro.
  Match maps, actor counts, scripted actions and browser/resolution settings; record visual-quality differences and
  browser/display limits. Report server step distributions/throughput, browser CPU/GPU frame times and sustained FPS,
  memory/allocations/GC, network use, loading and download size separately. Optimize measured bottlenecks while
  preserving gameplay and intended visual quality, then repeat the same workloads. Partial-slice or map timings cannot
  establish full-game speedup. Pursue the highest sustainable frame rate under R-WEB-3.


## R-VIS: Unity visual design
- R-VIS-1. Owner update 2026-11-05 supersedes the original existing-art-only restriction: assets need not match the legacy
  art one-to-one. Compatible open-source assets and original assets made with Unity tooling, including procedural
  geometry/materials, are allowed. Take creative liberties with the presentation ([VISUAL_DIRECTION.md](VISUAL_DIRECTION.md)).
- R-VIS-2. Character/environment artwork, silhouettes and presentation may be redesigned. Preserve competitive
  readability, clear faction/role cues and faithful presentation of authoritative positions, reach, collision geometry
  and gameplay-critical indicators. Art changes do not authorize changes to Rust game rules or Unity gameplay authority.
- R-VIS-3. Adaptive quality with manual overrides and an accessible low tier; essential gameplay indicators on every
  tier; no effect may reveal a hidden actor.
- R-VIS-4. Record third-party asset provenance and preserve redistribution/attribution terms under R-OSS. Rust gameplay,
  parity and headless completion retain priority over visual expansion; pursue the highest sustainable M5 Pro rate.

## R-OSS: open-source readiness
- R-OSS-1. Game code and a standalone headless Rust engine build and test without Unity or AWS
  (`cargo test --workspace`; `cargo run -p rh-headless`).
- R-OSS-2. Reproducible setup, local play (`cargo run -p rh-server` + the browser probe today; the Unity client later),
  versioned protocols, contributor instructions ([../CONTRIBUTING.md](../CONTRIBUTING.md)).
- R-OSS-3. Preserve existing licenses. The owner selected **MIT** for project-authored code on 2026-11-05 (`LICENSE`).
  Asset and dependency redistribution remains a separate review; third-party terms and Unity's proprietary tooling
  are not relicensed. Packages remain private until publishing is deliberately prepared.

## R-ML: ML architecture only
- R-ML-1. Future goals: competitive bots and human-like bots, using legitimate player-visible observations (including
  permitted UI/audio/map cues; screenshots not required) and the full game simulation.
- R-ML-2. Future policies attach to the LIVE Rust server through the same policy contract as scripted bots
  ([adr/0005-policy-seam.md](adr/0005-policy-seam.md)), with normal pacing and Unity rendering. Headless runs use the
  same contract with no waits.
- R-ML-3. Humans, scripted bots and future learned policies use the same authoritative action validation and applicable
  timing/rate constraints; each bot policy keeps its configured decision cadence live and headless; nobody gets extra
  actions per simulated second.
- R-ML-4. Observations contain only legitimate player-perceivable information; policies may remember prior observations
  but never receive hidden updates; no leaks through ids, ordering, counts, masks, events or RNG; privileged diagnostics
  stay separate.
- R-ML-5. Policy state/reset, deadlines, fallback, versioning and compatibility are defined; orchestration and future
  batching stay outside the deterministic rules.

### Exclusions (out of scope for both stages)
ML training algorithms; ML reward functions, shaping or tuning; training datasets or collection pipelines; self-play
training; model evaluation or deployment; ONNX/PyTorch/TensorFlow dependencies; Python bindings; inference services;
model registries; cloud or GPU ML resources; any learned model created, trained, evaluated or deployed. Future anti-cheat
readiness is limited to authoritative validation and reusable bounded operational/debugging events: no learned detector
and no model-based bans.

## R-PERSIST: durable progression
- R-PERSIST-1. Replace the singleton profile store before independent writers exist: atomic progression and currency,
  idempotent results, concurrent session ownership, retries/recovery, schema versioning, fencing.
- R-PERSIST-2. Profile export/migration, reconciliation, backup and rollback are prepared without changing live data.

## R-PROC: process (both stages)
- R-PROC-1. Keep the legacy game runnable while its replacement is built; preserve unrelated changes.
- R-PROC-2. Never imply full-game parity or release readiness from a partial slice; never claim zero defects.
- R-PROC-3. Decisions are recorded as ADRs; decision status is tracked separately from validation status.
- R-PROC-4. Owner priority (2026-11-05): complete the Rust simulation, meaningful parity and headless support ahead of
  Unity visual work. The maximum sustainable client-performance goal remains for the client verification stage.
