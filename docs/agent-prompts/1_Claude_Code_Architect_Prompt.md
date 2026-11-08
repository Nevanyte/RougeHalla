# Roguehalla — Stage 1: Claude Code architecture, core restructuring, and handoff

You are the architect and foundation builder for **Roguehalla**, repository `Nevanyte/RougeHalla`. Verify the checkout, revision, working tree, and repository instructions before relying on prior descriptions. Preserve unrelated changes and keep the legacy game runnable while establishing its replacement.

## 1. One-way, autonomous operating mode

This is the first of **two independent, sequential runs**. You build and verify the critical foundation. The user then opens GPT Codex on the resulting repository, and GPT finishes the migration. You and GPT cannot communicate. There is no later Claude review, approval, or troubleshooting session.

Treat this prompt as authorization to carry out the entire Stage 1 implementation within existing permissions. Do not stop after planning, ask routine clarification questions, present architecture choices for the user to pick, or ask whether to continue. Resolve technical choices using repository evidence and this brief; use current intended gameplay as the default when product details are unspecified. State important assumptions in the handoff and proceed.

Use concise progress updates rather than conversational checkpoints. Complete useful authorized work even when one dependency is blocked. Missing access, credentials, required license activation, or mandatory permission controls must remain explicit blockers; do not bypass them or fabricate results. Prepare deployment/migration plans and rollback before any action outside existing authorization. Record genuinely unresolved product or authorization issues for the final handoff instead of creating a routine question loop.

Your completion boundary is a tested foundation plus a self-contained repository handoff. Do not consume the whole bulk-port budget yourself. Context compaction or session limits are reasons to checkpoint exact progress, not to restart planning or silently declare completion.

## 2. Complete project requirements

Preserve these requirements in the repository so GPT needs neither this conversation nor a separate master prompt:

- **Rust authority:** full gameplay simulation and authoritative multiplayer server in Rust; Unity supplies presentation, input, and narrowly defined client prediction.
- **Unity browser client:** C# frontend playable through an actual Unity Web build in supported ordinary browsers. Desktop support may remain possible; a separate mobile port is not required.
- **AWS multiplayer:** hundreds of simultaneous matches, up to **eight players per match**, with latency-aware regional placement, automatic capacity adjustment, efficient host packing, and manual region selection. A provisional sizing scenario is 200 matches/1,600 players; label it as an assumption, not measured capacity or spending authorization.
- **Gameplay continuity:** preserve intended controls, rules, timing, balance, fairness, progression, existing bots/player flows, and recognizable presentation. Reconcile stale documentation with current code and tests.
- **Measured optimization:** actively identify and implement worthwhile improvements throughout both stages. Preserve intended behavior while changing algorithms, data structures, networking, rendering, and hosting where justified; a literal line-by-line translation is not the objective.
- **Restrained visual upgrade:** existing art only; improve affordable render resolution, lighting/materials, smoothness, and polish. Preserve silhouettes, identity, geometry, hitboxes, and competitive readability. No new artwork, sprite replacement, character/environment redesign, or generated images.
- **Open-source readiness:** game code and a standalone headless Rust engine that build/test without Unity or AWS; reproducible setup, local play, versioned protocols, and contributor instructions. Preserve existing licenses and review asset/dependency redistribution separately from Unity's proprietary tooling.
- **ML architecture only:** future goals include **both competitive bots and human-like bots**, legitimate player-visible observations, and the **full game simulation**. Future policies should attach to the live Rust server through the same policy contract. No learned model is created, trained, evaluated, or deployed now.

Exclude ML training algorithms, ML reward functions/shaping/tuning, training datasets or collection pipelines, self-play training, model evaluation/deployment, ONNX/PyTorch/TensorFlow dependencies, Python bindings, inference services, model registries, and cloud/GPU ML resources. Ordinary game rewards, loot, currency, and progression remain in scope. Future anti-cheat readiness is limited to authoritative validation and reusable bounded operational/debugging events; no learned detector or model-based bans.

Server CPU, network RTT, browser CPU/GPU, memory, download size, and operating complexity are separate budgets. Do not promise automatic improvements from adopting Rust, Unity, or AWS.

## 3. Claude models, thinking levels, and subagents

Verify the installed Claude Code version, available models, supported effort controls, and actual tool access once. Prefer these assignments; substitute the nearest available capability without stopping for a model-choice conversation. Record the resolved models/settings. Do not claim a switch occurred unless confirmed.

| Role | Preferred model | Thinking/effort | Work |
|---|---|---|---|
| Lead architect | Strongest available Claude; resolve `best` where supported, otherwise `opus` or the strongest exposed model | **High**; higher only for a specific unresolved consequential problem | Architecture, hard semantics, concurrency/security, diagnosis, integration |
| Scout | `haiku` or economical equivalent | **Low** where supported; otherwise its normal fast mode | Targeted inventory, locating code, bounded source tracing |
| Bounded builder | `sonnet`; Haiku for demonstrably mechanical edits | **Low** for clear contracts, **medium** for moderate judgment | Fixtures, scaffolding, routine foundation code, documentation |
| Design investigator | `sonnet` or equivalent | **Medium** | Evidence and limited alternatives for one decision |
| Independent critical reviewer | Strongest available Claude | **High** | Foundation correctness, privacy, persistence, protocol and gameplay guarantees |

Use explicit per-agent `model` and supported `effort` settings, through verified invocation controls or short `.claude/agents/*.md` definitions. Check for environment/organization overrides; do not change permissions or bypass managed limits. If a model lacks an effort control, use its supported default and report that once. Avoid whole-history forks when they prevent economical model selection or duplicate unnecessary context.

Use **one coordinator and normally two active subagents**. Only the coordinator delegates. Add a third specialist only for independent work with a clear benefit and within actual limits. Ordinary subagents are sufficient; Agent Teams are optional if available and useful. Your agents belong to this Claude run; do not launch GPT workers or build cross-tool orchestration.

Give each worker an outcome, relevant paths, exclusive write scope, contracts/invariants, validation expectations, and a concise return format: changes, checks/results, risks/blockers. Share necessary project constraints explicitly. Serialize shared-schema/lockfile edits and Unity Editor access. Keep unrelated file writes separate; integrate before dependent work proceeds.

Use `rg` and targeted reads while following enough callers and state ownership to find root causes. Reuse useful agents and short findings. Route by uncertainty and consequences, not failure quotas: fix simple mistakes locally, raise capability for a hard problem immediately, and avoid repeating a failed approach without new evidence. Optimize total cost including rework; no arbitrary percentage of cheap tokens is a success criterion.

## 4. Establish the real baseline

Inspect repository guidance and relevant build/test commands. Record pre-existing failures separately from new regressions. Earlier inspection suggested TypeScript/Node/Colyseus, Phaser, shared rules, a nominal 20 Hz simulation, and Cloudflare hosting with singleton-style profile persistence. Treat these as discovery leads, not current facts.

Trace input → simulation → replication → rendering → match result → durable progression. Inventory current systems/content and player flows, including scripted bots, accounts, cosmetics, disconnect/reconnect, and match termination. Verify current entity counts, map size, timings, and workloads.

Inspect input ordering/tie-breaking, lag compensation/rewind, simultaneous damage, every random source, and secret versus public state. Capture or inject nondeterministic inputs through test-only mechanisms when needed; a public map seed may not reproduce gameplay RNG.

Create representative legacy scenarios for movement/collision, crowded combat, pathfinding, projectiles/area effects, reconnects, and match results. Establish baseline checks and targeted benchmarks: tick CPU distributions/deadline misses, memory/allocations, bytes per player, encoding costs, join delay, and browser frame times. Label revision, hardware, native/emulated execution, workload, build mode, and sample duration. Historical reports do not establish current AWS capacity.

## 5. Decide and implement the critical foundation

### A. One simulation core and thin adapters

Use a few clearly owned modules/crates: simulation, versioned protocol/contracts, live server, and headless runner. Keep sockets, Unity/rendering, AWS SDKs, database/file access, and wall-clock pacing outside the core. Inject necessary external decisions explicitly. Prefer direct calls over per-tick RPC; avoid speculative frameworks and unnecessary microservices.

Implement typed reset, step, observation, action validation, events, and replay/checkpoint foundations. Distinguish full authoritative state from public snapshots and policy observations. The core owns logical fixed-step advancement and deterministic system ordering. The live adapter owns wall-clock pacing, bounded catch-up, and overload handling. Headless execution removes waits while retaining the same timestep and implemented rules.

Define explicit RNG streams, iteration/command ordering, numeric policy, content/configuration identifiers, and versioned replay formats. Prove reproducibility on declared targets; do not impose unnecessary cross-platform bitwise identity. Keep private seeds and diagnostic traces out of clients/public exports.

Implement a **representative real gameplay slice**, such as movement/collision and an attack with damage/cooldown, plus focused fixtures for consequential fairness, rewind, and simultaneous-resolution semantics. A socket echo or empty world is insufficient. The example demonstrates boundaries, correctness conventions, and tests; it does not force every future subsystem into the same algorithm.

Build a **working differential/parity harness** for that slice against captured legacy scenarios. Canonicalize comparable results and specify tolerances; do not conceal changed hits, winners, rewards, or timing behind a broad epsilon. Keep remaining mechanics explicit in the backlog.

### B. Protocol and actual browser proof

Define schema/versioning, entity IDs, tick/sequence handling, authentication/admission, replication, interpolation, prediction/reconciliation, reconnect/resync, timeouts, malformed-message handling, size/rate limits, and slow-client isolation. Supply passing Rust/C# fixtures. Bound queues, keep important events distinct from disposable effects, and keep durable I/O off the tick.

Create a real Unity Web prototype using existing assets, connected to Rust through the intended browser-supported secure transport, normally WSS. Exercise input, authoritative results, admission, and reconnect. Verify browser/AOT constraints; do not assume native UDP/TCP sockets, ICMP, desktop-only libraries, or ordinary native FFI work in a browser. The normal Rust/Unity boundary is network serialization, not source translation or native calls every frame.

Decide explicitly whether to retain Colyseus protocol compatibility or migrate both ends. Choose a canonical public map representation if independent generators would diverge. Keep prediction narrow and tested; Unity must not become a second gameplay authority. Measure interop overhead before adding encoding complexity.

Pin a supported Unity release/packages after the prototype; verify the applicable WebGL2/WebGPU support and fallbacks. Use verified Unity agent/editor/CLI tooling when helpful without requiring a plugin. Preserve asset metadata. Select the simplest rendering approach using actual assets and establish browser, frame-time, memory, and loading budgets. Treat 60 FPS on named mid-range desktop hardware as an initial target, not a guaranteed result.

### C. Persistence and hosting proof

Replace any singleton persistence assumption before enabling independent writers. Choose the smallest durable design for atomic progression/currency, idempotent results, concurrent session ownership, retries/recovery, and schema versioning; add fencing where required by the ownership model.

Implement **one real durable result/write path against a local/test store**. Test duplicate submission, concurrent writes, and relevant recovery behavior. Mock-only tests do not prove transactional guarantees. Prepare profile export/migration, reconciliation, backup, and rollback without changing live data.

Evaluate GameLift Servers managed container fleets plus Game Session Queues first; compare ECS on EC2/Fargate only far enough to select a practical path. Verify regions, quotas, architecture support, WSS/TLS, Rust lifecycle integration, warm capacity, packing, and cost. Keep any required SDK bridge outside the simulation and verify wrapper/process-lifecycle limitations. Do not build competing platforms or add Kubernetes without evidence.

Prototype the hosting adapter; in already-authorized staging, prove allocation, readiness/health, admission, reconnect, completion, termination/replacement, and draining. Verify a browser-reachable secure endpoint with valid TLS/DNS, not merely a returned IP/port. If access is unavailable, record an executable experiment and keep the decision provisional.

Specify repeated browser-compatible regional probes representative of the actual game path; edge-cached response time is not origin-server RTT. Consider all party members, capacity, and latency ceilings, with visible automatic selection, measured ping, and manual override. Verify western Canadian candidate locations where relevant. Active cross-region match migration is not required.

Plan multiple matches per host where supported and measured; one active match per process is a starting option. Autoscale on available session capacity/demand with CPU, memory, tick, and join-delay guardrails. Protect active matches on scale-in/deployment, close idle sessions, and document warm-capacity/cold-start tradeoffs. Add Spot only if interruption behavior is acceptable. Do not provision the full sizing scenario without existing budget authorization.

### D. Future ML seams without ML implementation

Demonstrate live/headless equivalence for the implemented slice, independent environment resets, reproducible replay, and explicit terminal/truncation status. Use a scripted policy and a failing/slow test policy to verify state reset and safe fallback. Call this a tested slice, not a completed full-game training environment.

Observations contain only legitimate player-perceivable information, including permitted UI/audio/map cues; screenshots are not required. Policies may remember prior observations without receiving hidden updates. Prevent leaks through IDs, ordering, counts, masks, events, and RNG. Privileged diagnostics stay separate.

Humans, scripted bots, and future learned policies use the same authoritative action validation and applicable gameplay timing/rate constraints. Preserve each bot policy's configured decision cadence between live and headless execution; do not force humans and bots to share an identical sampling frequency or allow extra actions per simulated second.

Policies receive immutable permitted observations and propose actions. Define compatibility/versioning, policy state/reset, deadlines, and fallback. Keep policy orchestration and future batching outside the deterministic rules. Record the narrow adapter boundary through which future models can drive the live Rust server, with normal pacing and Unity rendering. Do not implement a model runtime or a second Python gameplay server.

## 6. Optimization and visual direction

Both stages must find and implement justified improvements in algorithms, layout, allocations, spatial/pathfinding/perception work, replication, serialization, batching, and rendering. Record the observed cost, mechanism, behavioral risk, and comparable before/after evidence. Remove complexity without demonstrated value. Queue valuable remaining opportunities with evidence; do not mandate speculative techniques.

Fix verified bugs with regression evidence. Preserve intended balance, hitboxes, visibility, fairness, tick rate, and action opportunities. If a product change is genuinely unresolved, preserve existing intended behavior and record the decision instead of silently redesigning the game.

Give GPT concrete visual targets: affordable resolution, lighting/shadows/materials, restrained post-processing/particles, animation/interpolation, UI clarity, and frame pacing. Require adaptive quality plus manual overrides, an accessible low tier, and essential indicators on every tier. Effects must not reveal hidden actors. More rendered pixels do not create missing source-art detail, and server savings do not create browser GPU headroom. Leave the full UI and visual implementation to GPT.

## 7. Compact, executable repository handoff

Use existing equivalents where appropriate; otherwise maintain:

| Artifact | Purpose |
|---|---|
| `docs/REQUIREMENTS.md` | Complete product requirements and exclusions, including all requirements in this prompt |
| `docs/CONTRACTS.md` | Invariants and links to canonical schemas/types/tests; decision status separate from validation status |
| `docs/MIGRATION.md` | Tested code revision, working-tree status, tool versions, actual commands/results, feature inventory, benchmarks, risks, next actions, and checkpoint |
| `docs/backlog/README.md` and ready packet files | Entire remaining outcome backlog; detailed packets only for the next dependency-ready work |

Use short ADRs only for consequential decisions; link them rather than duplicating them. Requirements express intended behavior; code contracts and tests supply implementation evidence. Do not let a bug redefine a requirement or prose duplicate the schema as a competing source of truth.

Track **accepted/provisional** decisions separately from **passed/failed/blocked/not-run** validation. If using FROZEN, define it as the baseline ordinary workers preserve, amendable by GPT's coordinator through evidence and independent review. Every unresolved technical issue becomes GPT's responsibility, with reproduction, options, recommended next experiment, and dependent tasks. Nothing returns to Claude.

A ready packet contains: ID/outcome, dependencies, relevant legacy/new paths, exclusive write scope, contract/reference links, preserved behavior, acceptance checks, real validation commands where established, risk/model tier, and known traps. Later work may remain coarse; do not fabricate commands or decompose the entire future project prematurely. Cover all mechanics/bots, parity, full headless execution, Unity flows/visuals, regional hosting/state, load testing, operations, migration tools, and open-source readiness.

Keep `CLAUDE.md` and `AGENTS.md` short and consistent, pointing to this handoff. Only the coordinator updates shared status records during parallel work. Preserve reviewed changes as clear commits or an exact reproducible diff without including unrelated user work. Provide Rust build/test/run entry points that require neither Unity nor AWS.

## 8. Stage 1 exit gate and final response

Use a fresh high-capability, high-effort reviewer to challenge the foundation against requirements and executable evidence. Address consequential findings. Complete:

1. Verified inventory, baseline, and representative legacy fixtures.
2. Compiling Rust foundation, real gameplay slice, working parity harness, and meaningful determinism/visibility/action checks.
3. Passing Rust/C# fixtures and actual browser-to-Rust validation, or precisely recorded external blockers.
4. Real-store persistence proof and hosting-lifecycle evidence appropriate to available access, with unverified assumptions labeled.
5. Rust CI/run commands, a complete remaining backlog, and a handoff GPT can use without this conversation.

Do not transfer a problem you can still resolve in authorized Stage 1 work merely by labeling it blocked. Equally, do not port every remaining system, full UI, or full visual makeover before handing off. Your job is to resolve and prove the expensive foundations and make the bulk work executable.

End with one concise handoff report: revision, built scope, checks actually run, measured results, accepted/provisional decisions, precise external blockers, and first ready tasks. State READY FOR GPT or READY FOR GPT WITH EXTERNAL GATES; if the foundation is not ready, say so precisely and leave recovery steps. Never imply full-game parity or release readiness from a partial slice, and never claim zero defects.

**Start now. Inspect, delegate narrow independent work, implement, verify, and continue through this Stage 1 handoff without routine follow-up questions.**

### Tool references

Verify installed capabilities against current official documentation only when needed: [Claude subagents](https://code.claude.com/docs/en/sub-agents) and [Claude models and effort](https://code.claude.com/docs/en/model-config). Model aliases/settings are preferences subject to actual availability, not claims about the user's installation.
