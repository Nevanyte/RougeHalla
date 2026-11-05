# P-CLAUDE-INFRA-1: hosting, durable recovery and fleet validation

## ID and outcome

The owner requested a separate Claude branch on 2026-11-05. Reserve the following three technical work packages for
Claude. Codex retains the Rust simulation, map generator, gameplay parity, headless and scripted-bot implementation,
and subsequent Unity work. This owner instruction supersedes the original implementation prompt's statement that
Claude is unavailable. It also permits Claude's separate branch; Codex continues implementing on `optimization_port`.

Create a separate checkout and branch, suggested name `claude/infra-hardening`, from the latest
`origin/optimization_port`. The inspected code baseline is `165f61b613c2e2ee39cfdd025c33b323d00119fc`.
Do not switch the branch of Codex's active checkout. Open focused PRs targeting `optimization_port`; do not merge
or deploy production. Report the exact base/head revisions, changes, checks, measurements and remaining gates.

### 1. Durable result recovery and account service

Finish the remaining P-PERSIST-2 work, account portions of P-PERSIST-3, P-PERSIST-4 and applicable P-PERSIST-5 guards.
The difficult part is preserving currency, ownership and idempotency through failures, rather than adding CRUD routes.

- Results currently retry off the room task but unwritten results do not survive a process loss. Design and implement
  a recoverable durable handoff, bounded retry/recovery and observable permanent refusal. Define the durability/acknowledgment
  boundary explicitly, including the interval before the first durable write. Never claim recovery of an unrecorded
  result or invent a completed result for an interrupted match. State whether the guarantee survives process restart,
  host replacement, or both; an ephemeral local spool does not establish host-loss recovery. Preserve the original
  match metadata and content revision in the recovery record rather than substituting the restarted build's values.
- Preserve the existing `(match, profile_id)` idempotency, stable durable identity through rename, lease fencing,
  transaction boundaries and atomic currency/achievement updates. Recovery must not bypass a newer owner's fence,
  release another owner's lease, or blindly reacquire ownership to force an old result through. Resolve any necessary
  contract change with evidence and an ADR; do not weaken existing stale-writer tests.
- Complete profile claim/open, purchase, equip and monthly leaderboard HTTP contracts with authentication,
  validated inputs, bounded requests and legacy guard behavior. Keep profile secrets out of logs and public diagnostics.
- Exercise database disconnects/restarts, pool exhaustion and retry deadlines locally. An actual managed-database
  failover remains a distinct cloud gate unless performed; a local PostgreSQL restart is not evidence of Aurora failover.

### 2. AWS hosting lifecycle and secure regional placement

Own P-HOST-1, P-HOST-2 and P-HOST-3, including reconciliation of the provisional hosting design.

- Implement the local control API and minimal SDK bridge, with fake-SDK tests before cloud work. The current server
  has only `/control/health` and `/control/drain`; `hosting/glbridge` does not exist at the inspected baseline.
- Verify current official SDK/service behavior. Resolve the documented tension between GameLift's session/process
  lifecycle and the packet's multi-room-per-process proposal before relying on that proposal. Preserve efficient
  packing of multiple small matches per host; do not silently allocate a VM per match or claim untested process reuse.
- Prove allocation, readiness, bound admission credentials, reconnect grace, seat removal, completion, replacement and
  graceful drain. A hosting ticket must not bypass profile authentication, existing admission order or fenced leases.
  Keep control endpoints loopback-only. GameLift SDK code runs only in the bridge and is never linked into the Rust
  server process; no cloud SDK belongs in the simulation.
- Prepare infrastructure as code, browser-compatible WSS/TLS and practice-domain routing, regional origin probes and
  capacity-aware placement using all party members. Include manual region override and explicit fallback behavior.
  Calibrate probes against actual game-path RTT; do not use edge-cache timing as origin latency evidence.
- Validate supported regions, quotas, architectures, certificates and lifecycle assumptions rather than copying old
  unverified commands. Keep the provisional hosting choice unless evidence supports a documented correction; do not
  implement competing hosting platforms speculatively.

### 3. Match density, autoscaling and safe deployment proof

Own P-LOAD-1/2, P-HOST-4/5 and the hosting-specific metrics/runbooks needed to validate them (P-OPS-1/4/5).

- Build a parameterized load/soak harness using the current wire protocol, ordinary authenticated WSS sessions and
  scripted actions. Include reconnect, joins/leaves, slow consumers, overload and shutdown. No learned models.
- Measure per-host room capacity, CPU/memory, tick p50/p95/p99/deadline misses, bandwidth, placement/join delays and
  cold-start time. Distinguish native from emulated execution and actual measurements from extrapolation.
- Implement scaling from demand and available session capacity with resource/overrun guardrails, bounded warm
  capacity, idle cleanup and active-match protection. Prove that deployment/scale-in drains without dropping active games.
- Finish staged deployment, health gates and rollback; demonstrate replacement and recovery locally, then perform only
  a cloud experiment whose worst-case cost fits the remaining authorized budget. Include reproducible teardown and a
  check that billable resources have actually stopped.
- The 200-match/1,600-player scenario is a sizing/load-harness parameter, not permission to run that cloud load.
  Baseline-slice density is useful now; final full-game capacity and pricing require a refreshed build after Codex
  finishes gameplay. Label those final gates pending until measured. Do not size a production fleet from the slice alone.

## Dependencies

Work package 1 and the local portions of 2 can start now. Work package 3's harness and local experiments can start now;
cloud scaling depends on 2, and final full-game measurements depend on Codex's gameplay completion. Implement the three
packages sequentially where their server files overlap. Keep coherent commits/PRs so recovery can integrate independently
of a cloud staging gate. These packages are several substantial workstreams, not the only work remaining in Stage 2.

## Relevant legacy paths (verified)

- `packages/server/src/persistence/ProfileStore.ts`, `packages/server/src/index.ts`, `packages/server/src/guards/`.
- `deployment/cloudflare/src/containerLifecycle.ts` (lifecycle reference only; do not modify live deployment).
- `crates/rh-server/src/{director,persist,hosting,lib,main}.rs` and `crates/rh-persist/**`.
- `docs/backlog/packets/P-PERSIST-2.md`, `P-HOST-1.md`, `docs/hosting/{GAMELIFT_EVALUATION,STAGING_EXPERIMENT,LATENCY_PROBES}.md`.
- `docs/adr/0004-hosting.md`, `docs/adr/0006-persistence.md`, `docs/CONTRACTS.md`, `docs/MIGRATION.md`.

## New paths

Use the existing packets' proposed `hosting/**`, `crates/rh-server/src/api.rs` and focused server/storage tests.
Choose dedicated paths for the load harness and cloud configuration after inspecting existing tools. Do not rewrite
the simulation or introduce a second rules implementation to construct a load test.

## Exclusive write scope

Claude owns `hosting/**`, `crates/rh-persist/**`, and the hosting/persistence/account/scaling/load adapter work in
`crates/rh-server/**`, including required room, connection, wire, outbox, metrics and pacing integration. Codex will avoid
this server crate while the handoff is active. Keep those changes scoped to these packages; preserve all existing
policy cadence, public-observation, reliable-delivery and lease guarantees. No gameplay rules move into adapters.

Claude may add dedicated hosting/load workflows, tooling, evidence and `docs/hosting/**`, plus narrowly scoped amendments
to ADR 0004/0006. Preserve `.github/workflows/deploy.yml` and `deployment/cloudflare/**`, which operate the legacy game.

Codex retains `crates/rh-sim/**`, `crates/rh-policy/**`, `crates/rh-headless/**`, `crates/rh-parity/**`, `parity/**`,
`client-unity/**`, `crates/rh-protocol/**` and `protocol/**`. Do not modify these in the Claude lane. If an integration
requires a new shared contract, document the exact proposed API/schema change and supply a focused integration patch
for coordination rather than quietly changing a version or weakening validation.

Only Codex updates shared migration/backlog/contract status and integrates `Cargo.lock`. Claude reports needed
dependencies and any lockfile changes separately. Do not launch the Unity Editor from this workstream.

## Contracts and references

Follow repository `AGENTS.md`, C-PERSIST, C-NET, C-HOST, C-OBS, C-INPUT and C-RNG. Existing accepted gameplay and timing
remain intact. New cloud facts must come from current official documentation and executed evidence. Treat old packet
limits and unchecked commands as historical material, not authorization.

## Behaviour to preserve

- All game rules, physics, collisions, combat, AI and bots remain solely in Rust. Unity is presentation/input, with only
  a separately verified narrow movement predictor permitted. Prioritize complete Rust/parity/headless over visuals.
- Existing achievements/catalog, live lease renewal and ending metadata are already implemented/reviewed. Do not redo
  them. Live lease defaults are TTL 120 s, renewal 30 s, database budget 5 s, one-hour TTL cap.
- Database/cloud I/O never blocks a simulation tick. Do not reorder admission checks or gameplay phases.
- No training, models, training datasets, Python bindings, inference services or cloud/GPU ML resources.
- MIT covers project-authored code; preserve all third-party and asset licenses.
- M5 Pro is the initial performance reference. Pursue the highest sustainable frame rate with intended quality;
  60 FPS is not the completion goal. Browser/display caps and simulation throughput are separate measurements.

## Acceptance checks

1. Real PostgreSQL process-failure tests around durable handoff, commit-before-ack, duplicate recovery, retry exhaustion,
   stale fences, takeover and concurrent purchases; no double credit or silent loss after the declared durable boundary.
   Reconciliation remains clean. Verify simulation progress while storage is unavailable.
2. Account HTTP tests cover right/wrong/missing token, invalid names/months/limits, claim caps, purchase idempotency and
   double-spend races, equip validation and private leaderboard self fields.
3. Fake-SDK and actual local server tests prove the lifecycle, authorization, drain, reconnect and control/public-listener
   boundary. Test credential replay/expiry and cancellation/failure cleanup. Verify supported image architectures.
4. Load evidence identifies revision, hardware, architecture/emulation, build, scenario, duration and raw output.
   Scaling/deployment tests preserve active sessions, reject unwanted new admissions and leave no idle resources behind.
5. Cloud results are recorded as passed/failed/not run with actual cost and teardown evidence. Do not substitute local
   fakes for browser TLS, regional placement, managed failover or full-game capacity proof.
6. Rebase onto current `optimization_port` and pass affected local integration checks before requesting integration.
   Preserve all existing assertions; independently review consequential concurrency, authentication and lifecycle changes.

## Validation commands

Existing commands: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`,
`cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --all-features`,
`cargo run -p rh-parity --bin parity-report`, `dotnet test client-unity/RoguehallaNet.Tests`,
`bash client-unity/sync-net.sh --check` and `node tools/browser-proof/proof.mjs`.
Use the PostgreSQL test helper and follow each tool's setup requirements. Bridge tests, process-crash tests and load
commands are to be created and documented by this packet. Do not copy obsolete protocol-v1 load code unchanged.

## Risk and suggested model tier

High: concurrency, monetary progression, admission/authentication, cloud lifecycle and spending. Use strong reasoning
for design/diagnosis and independent review, with bounded workers for routine implementation. Prefer measurable small
changes. Ship no production migration, deployment, DNS switch or destructive history rewrite from this branch.

## Known traps

- **CAD 20 TOTAL** staging cap across both agents, not monthly and not USD. Sandbox account `961470857356`. Codex has
  created no Stage 2 billable resources at handoff. Check current usage, current regional rates, exchange-rate allowance,
  provisioning/teardown time, storage/network/telemetry charges and remaining allowance before any cloud experiment.
  A billing alert does not enforce a hard spending stop. If a bounded experiment cannot fit, finish local work and
  report the specific cloud proof still pending. The historical $150 ceiling/24-hour experiment is superseded.
- Practice domain is **rougehalla.com**. Production **play.roguehalla.com** stays unchanged; no production cutover,
  retirement or live player-data experiments are authorized here. Prepare/review DNS and certificate changes before
  applying any practice-domain writes within existing permissions; do not assume Cloudflare access from AWS access.
  This handoff adds no spending or DNS authority beyond the owner's existing staging instructions.
- Use existing credential mechanisms; never ask for passwords/tokens in chat or commit them. Report any specific missing
  permission only when it actually blocks a required operation. Do not infer spending authority from an Administrator role.
- Original profile tokens cannot be recovered from their hashes. Preserve the original legacy export for rollback;
  do not copy live player data into public fixtures or delete the legacy store.
- Full gameplay, full-map pins and full-game performance are not complete at the inspected baseline. This handoff does
  not change their status, and cloud staging success would not make the game release-ready.
