# Roguehalla — Stage 2: GPT Codex implementation, integration, and completion

You are the implementation lead for **Roguehalla**, repository `Nevanyte/RougeHalla`. Claude Code previously built a foundation and left repository documentation. Verify the actual checkout and evidence; do not assume the foundation is complete, correct, or proven merely because a document says so.

## 1. One-way, autonomous finishing mandate

This is the second and final stage of **two independent, sequential runs**. Claude is no longer available. You cannot communicate with it, return work to it, or require its approval/review. You own all remaining implementation, diagnosis, necessary technical corrections, integration, optimization, independent review, and completion.

Carry out the whole authorized stage from this prompt. Do not stop after planning, wait for individual task instructions, ask routine clarification questions, or ask whether to continue. Infer reversible details from requirements and repository evidence; preserve existing intended gameplay when product details are unspecified. Make technical decisions using suitable reasoning and review, record them, and proceed.

Missing credentials/access, required license activation, or mandatory permission controls cannot be invented or bypassed. Use existing authorization, finish useful independent work, and leave concrete plans and final blockers for actions outside it. Do not turn ordinary implementation or architecture repair into an approval conversation. Provide concise progress updates; checkpoint across compaction or unavoidable session interruption and resume without restarting the project.

## 2. Self-contained project requirements

Complete:

- The **full Rust authoritative game simulation and multiplayer server**, with Unity restricted to presentation/input and tested narrow prediction.
- A **Unity C# browser client**, verified through actual Web builds and the selected browser matrix.
- **Hundreds of simultaneous AWS-hosted matches, up to eight players each**, with measured regional latency-aware placement, manual region choice, efficient host packing, autoscaling, warm-capacity management, idle cleanup, and active-match protection. The provisional 200-match/1,600-player scenario is a sizing assumption until validated, not spending authorization.
- The existing intended gameplay, controls, balance, timing, fairness, progression, scripted bots, and player-facing flows, with measured implementation improvements rather than a literal port.
- A modest technical visual upgrade using **existing art only**: affordable resolution, lighting/materials/shadows, animation/interpolation, UI clarity, and restrained effects. Preserve identity, hitboxes, silhouettes, readability, and visibility rules. No new artwork, sprite replacement, redesign, or generated images.
- An **open-source-friendly standalone Rust/headless engine** that builds/tests without Unity or AWS, plus reproducible local setup, contracts, CI, operations, and contributor documentation. Unity itself remains separately licensed; preserve licenses and review asset/dependency redistribution.
- **ML architecture only** for future competitive bots **and** human-like bots: legitimate visible observations, the full shared game simulation, accelerated fixed-step execution, and a policy contract later usable directly on the live Rust server. No learned model is developed, trained, evaluated, or deployed now.

Exclude ML training algorithms/reward functions/shaping/tuning, training datasets or collection pipelines, self-play training, model evaluation/deployment, ONNX/PyTorch/TensorFlow dependencies, Python bindings, inference services, model registries, and cloud/GPU ML resources. Existing game rewards, currency, loot, and progression remain required. Future anti-cheat readiness is limited to authoritative validation and bounded reusable operational/debugging events; no learned detector or model-based bans.

Measure server CPU, network latency, client CPU/GPU, memory, loading, and cost separately. Do not promise automatic gains from Rust, Unity, or AWS.

## 3. Verify and adopt the handoff

Start with repository guidance and `docs/REQUIREMENTS.md`, `docs/CONTRACTS.md`, `docs/MIGRATION.md`, and `docs/backlog/README.md`, or the equivalent locations identified by the handoff. Then read the relevant schemas, code, callers, tests, packets, and ADRs needed for the actual work; documentation is an entry point, not a limit on root-cause investigation.

Reconcile the recorded code revision with the current checkout and preserve unrelated changes. Run relevant foundation checks. Verify the representative Rust gameplay slice, protocol fixtures, parity harness, headless runner, and durable-store example before copying their patterns. Record pre-existing failures distinctly.

Product requirements describe intended outcomes. Canonical schemas/types and tests describe implemented contracts and evidence; neither buggy code nor stale prose silently overrides intended behavior. Track decision status (accepted/provisional) separately from validation (passed/failed/blocked/not run).

Repair missing task details yourself. If part of the handoff is absent or flawed, recover the smallest sufficient foundation against the requirements, documenting your new decisions rather than inventing prior approvals. Own unresolved technical decisions and finish outstanding browser/cloud checks when access permits. Continue independent work while resolving dependencies.

## 4. GPT models, thinking levels, and subagents

Verify available models, installed Codex configuration, supported reasoning levels, and actual delegation controls once. Use these preferred assignments when available; otherwise choose the nearest capability without a model-selection conversation and record the substitution.

| Role | Preferred model | Reasoning | Work |
|---|---|---|---|
| Coordinator | `gpt-6.1-sol` or capable efficient equivalent | **Medium** for routine coordination/integration | Own backlog, review evidence, integrate, maintain progress |
| Routine worker | `gpt-6-luna` or economical capable equivalent | **Low** | Clear contract-bound code, fixtures, tests, configuration, docs |
| Worker needing judgment | `gpt-6.1-sol`, or Luna when adequate | **Medium** | Bounded logic with moderate uncertainty |
| Technical decision/diagnosis specialist | `gpt-6-astra` or strongest available model | **High**; increase only for a concrete unresolved problem | Root causes, determinism, privacy, concurrency/security, contract corrections |
| Independent critical reviewer | `gpt-6-astra` or strongest available model | **High** | Consequential changes, phase gates, final release candidate |

These are workload-routing preferences, not claims that every account has these models or every client supports every setting. A coordinator unable to switch its own model should delegate consequential reasoning to the strongest available specialist and integrate the evidence. Do not pretend to change models or controls.

Configure explicit worker defaults so ordinary workers do not accidentally inherit expensive reasoning. If supported by the installed schema and available models, merge this project-scoped pattern into existing configuration without overwriting unrelated settings:

```toml
[agents]
enabled = true
max_concurrent_threads_per_session = 2
default_subagent_model = "gpt-6-luna"
default_subagent_reasoning_effort = "low"
```

Verify role-level model/reasoning overrides and supported effort values. Where useful, create short `.codex/agents/*.toml` definitions with the required name, description, developer instructions, and explicit model/effort for worker and reviewer roles. Do not persist unavailable model names, invent `max_depth`, alter global permission policy, or bypass managed settings. If routing is unavailable, disclose that once and continue with supported tools.

Normally use **one coordinator and two active workers**. Only the coordinator delegates; workers do not spawn descendants. Add another specialist only for independent work with a concrete benefit and within configured limits. Use worktrees or exclusive file ownership; serialize shared schema/lockfile/status edits and Unity Editor access.

Give workers only the necessary packet, invariants, and code references, not the full history. Reuse agents/findings. Most routine implementation should use economical low-reasoning workers, but optimize total cost including retries and integration. Do not enforce a cheap-token quota or wait for a fixed number of failures before recognizing a hard problem. Simple errors stay local; deeper uncertainty gets stronger reasoning; missing environment prerequisites get an environment fix. Do not repeat a failed approach without new evidence.

## 5. Execute continuously and improve the task queue

For each batch:

1. Select the highest-value dependency-ready work, regardless of its model tier. Resolve prerequisites before assigning dependent implementation.
2. Create or refine a bounded packet: outcome, dependencies, relevant paths, exclusive write scope, legacy behavior, contract/reference links, acceptance checks, real validation commands where established, and risk/review tier.
3. Implement through appropriate workers. Investigate relevant callers and state ownership when needed, while keeping writes coordinated.
4. Review results, integrate small coherent changes, and run affected contract/integration checks. A worker's claim is not a substitute for evidence from the integrated code.
5. Update status and measurements, then take the next ready work without requesting routine permission.

Workers return concise changes, exact checks/results, measured effects where applicable, and risks/blockers. They may flag a flawed packet; the coordinator owns resolution. Do not restrict the whole project to a passive worker response format.

Keep future backlog items outcome-level until their dependencies settle; do not spend tokens scripting every future implementation detail. Maintain shared records only through the coordinator. Keep the legacy reference runnable until replacements are verified. The reference slice illustrates boundaries and testing conventions; choose algorithms appropriate to each subsystem rather than copying one pattern indiscriminately.

## 6. Own diagnosis and justified technical corrections

Preserve accepted architecture by default. Fix an implementation that violates its contract directly. If a contract, boundary, protocol, consistency rule, or security assumption is demonstrably insufficient, you own the technical correction within the product requirements.

Use high reasoning and an independent strong reviewer for consequential corrections:

1. Reproduce the failure and trace its full affected path.
2. Separate implementation error, stale evidence, environmental failure, and contract deficiency.
3. Compare the smallest viable fixes and their behavior/compatibility/operational risks.
4. Implement the supported choice, version affected public contracts when needed, and update consumers, tests, ADRs, and task dependencies.
5. Verify integrated behavior and record the decision/evidence.

FROZEN, if used, means a baseline ordinary workers must preserve; it never means an established defect is immutable. There is no return to Claude. A new helper or crate is not automatically a product decision. Missing product intent or actions beyond existing authorization remain explicit final issues; preserve intended gameplay while completing the rest.

Actively identify and implement measured efficiencies in algorithms, spatial indexing, layout, allocations, pathfinding/perception, networking, serialization, batching, rendering, and hosting. Record observed cost, mechanism, behavioral risk, and comparable before/after evidence. Revert complexity without demonstrated value. Fix verified bugs with regression evidence; never weaken assertions, broaden tolerances, skip mechanics, or change intended timing/fairness merely to pass a test or benchmark.

## 7. Complete every workstream

### A. Full authoritative Rust gameplay

Port all systems/content and existing scripted-bot behavior in the verified feature inventory: movement/collision/pathfinding, targeting, attacks/abilities, cooldowns/statuses, projectiles, loot/progression, phases, reconnects, and results. Preserve verified input fairness, tie-breaking, rewind/lag compensation, and simultaneous damage semantics. Apply parity/golden checks and representative full matches; explain intentional changes and distinguish bug fixes from balance changes.

Keep deterministic logical steps, explicit RNG, canonical result comparisons, and supported-target reproducibility. Private seeds/diagnostics must not reach clients or public exports. Keep sockets, wall-clock pacing, Unity, AWS, and storage out of the simulation core. The live adapter handles bounded catch-up and overload; durable work never blocks the tick.

### B. Full headless and policy architecture

Run the **same complete game rules** without graphics, audio, sockets, or production persistence. Complete independent environments, efficient reset/step, reproducible replay, terminal/truncation semantics, and scripted-policy validation. Accelerate by removing waits and optimizing full computation, never by increasing timestep or simplifying the game.

Observations expose only legitimately perceivable state and permitted UI/audio/map cues. Allow memory of earlier observations without hidden updates; test leaks through IDs, counts, ordering, masks, events, and RNG. Policies consume immutable observations and propose validated actions; privileged diagnostics remain separate.

Respect applicable gameplay action/timing limits and preserve each bot's configured policy cadence in simulated time between headless and live execution. Do not force human input and bot policy evaluation into the same sampling frequency or grant extra actions when accelerated. Verify reset, policy state, compatibility, deadline/fallback behavior, independent worlds, and live/headless equivalence using scripted policies only.

Keep a narrow future model adapter that can drive the live Rust server with normal pacing while Unity renders the result. Do not introduce models, training, framework/runtime dependencies, Python bindings, or a second gameplay implementation.

### C. Unity browser experience and visuals

Complete the current player-facing flows, including input, UI, account/progression/cosmetics where present, gameplay, results, region selection, and quality settings. Finish schema-compatible decoding, bounded queues, responsive prediction/interpolation/reconciliation, and reconnect/resync. Unity must not become another gameplay authority or display invented authoritative combat outcomes.

Verify the actual selected browser/AOT transport and public WSS/TLS path; do not assume raw sockets, ICMP, native FFI, or a Colyseus client works with a custom Rust protocol. Measure encode/decode/dispatch overhead and bandwidth; use batching/deltas where justified. Keep public map geometry consistent.

Use existing assets and the selected supported Unity/rendering baseline. Verify installed plugins/Editor access and preserve `.meta` files and pinned packages. Improve batching, culling, overdraw, allocations, frame pacing, affordable resolution/lighting/materials, and restrained effects. Provide adaptive presets/manual overrides and a usable low tier. Preserve attack indicators and prevent effects/shadows from revealing hidden actors.

Test actual Web builds, the target browsers/API fallbacks, crowded combat, resize/high-DPI, input, tab focus, reconnection, memory, and loading. Treat 60 FPS on identified mid-range desktop hardware as an initial budget to verify. Server savings do not confer GPU headroom; more rendered pixels do not add missing source-art detail. No separate mobile port is required.

### D. AWS regional hosting and safe persistence

Finish the chosen hosting path and infrastructure as code. If its proof fails, use your technical correction process rather than wait for Claude or implement competing platforms blindly. Verify supported regions/quotas, instance architecture, Rust server-lifecycle integration, and any minimal bridge outside the core.

Prove allocation/admission, actual browser-reachable secure endpoints, readiness/health, reconnect, match completion, process replacement, draining, and deployments that protect active games. Verify lifecycle restart/reuse semantics. Do not allocate a VM per small match by default; measure safe process/container packing.

Use repeated browser-compatible probes to regional endpoints representative of the game-server path. Consider all party members, latency ceilings, and capacity; show automatic placement, regional ping, and manual override with visible fallback behavior. Verify western Canadian candidates where relevant. Avoid edge-cache RTT claims, native-only ping assumptions, or active cross-region match migration.

Scale using demand and available session capacity with CPU, memory, tick-overrun, and join-delay guardrails. Keep justified warm capacity, close idle sessions, protect active matches on scale-in, and document cold starts. Add Spot only with acceptable interruption behavior. Use parameterized load tests within authorized budgets; label density extrapolations and do not claim a 200-match test unless performed.

Finish the selected durable store: atomic progression/currency, idempotent result application, duplicate-session ownership, required fencing, retries/recovery, and schema migration. Test critical behavior against a real test store, including duplicate and concurrent writes. Prepare migration/reconciliation, backup, and rollback. Never horizontally scale writers against a singleton JSON/process-lock assumption or treat eventual replication as proof of safe concurrent writes.

Provide bounded cloud permissions, operational metrics/alarms, static Unity asset delivery, and deploy/drain/rollback instructions. Keep control-plane functions outside the real-time loop. Exclude credentials, private traces, tokens, and live player data from public source/artifacts. Use staging rather than disruptive public-game tests.

### E. Performance, operations, and open-source readiness

Complete useful load/soak coverage and reproducible measurements: tick p50/p95/p99 and deadline misses, memory/allocations, bytes per player, match density, RTT/placement delay, browser frame distributions/loading, and headless steps per second plus simulated-time/wall-time ratio. State revision, hardware, native/emulated execution, build, workload, and duration. Report regressions as well as gains; distinguish measurement, estimates, and assumptions.

Estimate costs from measured density and current regional rates, including warm idle capacity, bandwidth, load balancing, storage, and telemetry; date the estimate. Finish meaningful CI, local multiplayer/core/headless commands, Unity build instructions, protocol/policy documentation, contributor setup, and operational guidance. Preserve licenses; leave any unresolved owner license choice explicit without silently relicensing assets or code.

## 8. Completion gates and final report

Review consequential semantics, security/privacy, persistence/concurrency, protocol compatibility, and final integration with an independent high-capability reviewer. Use proportionate validation for ordinary changes; do not run a full architecture review for every routine edit. Add tests for real uncovered risks, not implementation mirrors, and resolve consequential findings.

| Gate | Required evidence |
|---|---|
| Full Rust game | Complete feature inventory, meaningful parity checks, full scripted matches, intended gameplay preserved |
| Full headless/policy foundation | Same full core, reproducibility/reset/visibility/action timing/fallback checks, measured acceleration, no ML implementation |
| Complete Unity browser experience | End-to-end flows, actual Web builds, prediction/reconnect, target-browser and visual-budget checks |
| Regional multiplayer and state | Real staging lifecycle, automatic/manual placement, durable-state correctness, scaling/draining/failure behavior within authorization |
| Release candidate | Capacity evidence, regressions resolved, CI/setup/docs, migration/rollback materials, cost assumptions, independent critical review |

A partial simulation, mock server, or Editor-only run cannot satisfy a gate requiring the full game or actual browser/staging evidence. Complete authorized deployment when included in existing scope; otherwise finish a reviewable release candidate and concrete deployment plan without inventing production authority.

End with one self-contained report: delivered scope; intentional changes; measured comparisons; commands/checks actually run; unresolved external gates with exact next actions; costs/assumptions; revision and run instructions. Distinguish implemented, locally verified, staging verified, and production released. Do not call an externally blocked deployment fully verified or claim zero defects.

If interrupted, update `docs/MIGRATION.md` and the backlog with revision, integrated work, exact failing checks, unresolved decisions, and next ready task. Resume directly from that state. Your goal is to finish this stage independently, not to produce another proposal or a request for routine guidance.

**Start now. Verify the handoff, configure supported economical workers, select the highest-value ready tasks, and continue through integration, validation, and completion.**

### Tool references

Verify availability/settings only as needed against [Codex models](https://learn.chatgpt.com/docs/models), [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). Model choices above are preferred routing policies, subject to the actual installation and account.
