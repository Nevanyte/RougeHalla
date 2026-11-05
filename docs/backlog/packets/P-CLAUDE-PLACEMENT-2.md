# P-CLAUDE-PLACEMENT-2: durable placement ownership and restart reconciliation

## ID and outcome

You are Claude working on Roguehalla. Complete **one technical milestone**: replace the process-only placement request
ledger with PostgreSQL-backed ownership and restart reconciliation, integrated into the existing placement service.
An abrupt process death must preserve enough committed identity and intent to recover owned work safely. Identical
retries must recover a committed offer; automatic recovery must never clean up an offered or foreign session.

Work in a separate checkout on `claude/durable-placement-ledger`, based on current `origin/optimization_port` containing
`5b1a7aae24fce2be97a075acf04675f95f86e169`. Record your actual base SHA. Open one PR to `optimization_port`; do not merge
it. Do not modify the coordinator's checkout, the previous Claude branches or Kimi's branch. Read `AGENTS.md`,
`docs/MIGRATION.md`, `docs/CONTRACTS.md`, this packet and `crates/rh-placement/README.md` first. Continue autonomously
within scope; return an implementation and reproducible evidence, not just a design.

## Dependencies

The reviewed PR27 integration is required: it fixes ownership binding, cancellation receipts and cleanup retention.
This packet needs local PostgreSQL only. **No AWS, Cloudflare, Unity or production login is needed.** Reuse the local
Postgres helper and existing locked SQLx/Tokio dependency versions. No cloud writes, certificate issuance, paid resources,
DNS changes or production deployment. The total staging allowance remains CAD 20; this packet spends none of it.

## Relevant legacy paths (verified)

- `crates/rh-placement/src/service.rs`: request states, explicit ownership nonce, request/config equality, cancellation
  guard, `reap_abandoned`, original-zone cleanup, offer commit boundary and current 4096-entry process-local ledger.
- `crates/rh-placement/src/{backend,model,fake,hostname,score}.rs` and `crates/rh-placement/tests/`: existing APIs and
  ownership/cancellation regression cases. Read all existing lifecycle tests before changing the service.
- `crates/rh-persist/src/`, `crates/rh-persist/tests/{common/mod,durable,results,schema}.rs`: existing PostgreSQL patterns,
  fencing and schema compatibility examples. These are references, not an invitation to change the account/result store.
- `tools/pgtest/{start,stop,smoke}.sh`, `docs/hosting/PLACEMENT.md`, `docs/evidence/stage2-external-integration/README.md`.
  There is no legacy durable placement ledger to port; this is adapter infrastructure, not new gameplay.

## New paths

- `crates/rh-placement/src/ledger/**`, `crates/rh-placement/migrations/**`.
- Focused PostgreSQL/restart tests under `crates/rh-placement/tests/`; test-only child processes may live under
  `crates/rh-placement/tests/support/**` or a test harness target in this crate.
- `docs/evidence/placement-durability/**`: compact synthetic evidence, commands and handoff; no credentials/raw private data.

## Exclusive write scope

Own `crates/rh-placement/**` and the new evidence directory. Integrate the ledger into the existing service; a disconnected
store API is insufficient. Preserve the pure planner and hostname behavior. You may add a `postgres` feature and minimal
SQLx/Tokio manifest entries using versions already locked in this workspace. Default pure-planner use must not connect
to a database. Keep the memory implementation for fast existing tests, with common conformance tests for both stores.

Do not edit `rh-persist`, `rh-server`, `rh-sim`, policy/headless, protocol, Unity, hosting scripts/IaC/workflows, root
manifests, `Cargo.lock` or shared status records. Include any required root CI/lock integration hunk in your handoff for
the coordinator. Do not implement HTTP authentication, real AWS/DNS adapters or a general fleet manager. If a scope
boundary blocks correctness, preserve a minimal failing reproducer and report it; do not silently expand scope.

## Contracts and references

Preserve C-HOST/C-NET/C-PERSIST boundaries: placement is off the game tick, the Rust game process gains no AWS SDK,
credentials never enter client output, and account/admission authority does not come from this ledger. Preserve all
current ownership protections and exact scoring/attempt ladder behavior. SQL is parameterized; errors/logs contain no
database URLs, player-session credentials or ownership secrets. Explain migration compatibility and bounded retention.

## Behaviour to preserve

1. Persist the complete validated request and configuration, original DNS zone, ownership epoch/nonce, attempt identity,
   placement ID, exact `GameSessionData` binding, recovery state and committed offer. Ownership metadata is not an auth
   token. Preserve the nonce on restart; never recreate an empty registry with an old epoch. Conflicting reuse of an ID
   must fail before external mutation. Define the caller-supplied trusted scope/namespace; it does not authenticate callers.
2. Persist intent **before** the corresponding external side effect. Recover the ambiguous interval where a remote call
   succeeded but the local receipt was lost. Persist an offer before returning it. After uncertain DB commit, reconcile
   the stored outcome; do not turn an accepted offer into abandoned cleanup by assuming that commit failed.
3. Use transactional claims with fencing/version checks for multiple service instances and reapers. A stale worker
   cannot commit an offer or mark work finished after losing its claim. Do not hold a database transaction/row lock across
   external awaits. Set explicit bounded database and backend operation budgets; failures retain durable unresolved work.
4. Reconcile by the existing exact placement ID **and** ownership binding, never an ID/prefix alone. Missing ownership
   evidence stays unresolved. Foreign evidence never authorizes stop, DNS mutation, termination or offer publication.
   Keep receipt identity checks on cancellation and stop→describe paths. Use the stored original configuration on restart.
5. Offered rows are durable, immutable with respect to automatic recovery cleanup, and replay only to an identical request/config/scope.
   A crash after committed offer but before the response returns is an idempotent retry, not an orphan to terminate.
   Unknown/active cleanup outcomes must not be marked finished. Canceled reapers and dead processes leave reclaimable work.
   Replace the existing ID-only `release_host(region, placement_id)` boundary with a ledger-bound explicit session-end
   release: a trusted caller supplies the scoped request/offer identity, the ledger validates ownership, and deletion
   uses the stored original zone. Record release intent/completion durably and make retries idempotent. Automatic reapers
   must never infer session end from offer age or worker lease expiry. Released identities must not replay a dead join URL.
   This internal trusted-caller API does not implement or replace future HTTP authorization.
6. Define the recovery state machine, external-effect ambiguity, claim expiry and retention/tombstone rules explicitly.
   Database fencing cannot cancel an already-sent provider request: document this boundary and test delayed receipts.
   Use idempotent operations and conservative unresolved states rather than claiming exactly-once external execution.
   Never garbage-collect an active, unresolved or offered identity merely to admit new work. Keep per-pass work bounded.
   In particular, an unresolved sent cleanup operation cannot coexist with publishing an offer for that placement.
   A single NotFound response does not settle a previously ambiguous start that could still be accepted later.

## Acceptance checks

**SUCCESS — all of these must hold:**

- Production service methods actually use the durable ledger when configured; existing memory tests and all previous
  ownership/cancellation regressions pass unchanged in meaning. Both stores pass shared state-transition tests.
- Real PostgreSQL tests cover two independent connections/workers, same-ID identical/conflicting retries, exclusive
  cleanup claims, expiry/takeover, stale commits, canceled reaper, DB outage/uncertain commit, missing/foreign receipts,
  original-zone recovery and offers protected from automatic cleanup. Use deterministic barriers/fault hooks rather than timing-only sleeps.
- A test harness runs a child service process against real PostgreSQL and a separate persistent fake GameLift/DNS
  backend. Abruptly kill/restart the child at each of these boundaries: committed start intent; remote start accepted
  with receipt lost; fulfilled before DNS receipt; DNS written before offer commit; offer committed before response;
  cleanup side effect accepted before local completion. The fake survives the child and records every external mutation.
  Restart through the real service path, not by calling an isolated SQL helper. Assert every durable outcome and external
  trace: accepted offers survive, unresolved work stays discoverable, foreign sessions stay untouched, retries are bound.
- Separately delay **effect application**, not just receipts: hold an already-sent stop/DNS-delete/terminate, expire the
  old claim and run takeover, then apply the old operation. Also let an ambiguous start be accepted after an earlier
  describe returned NotFound. Prove recovery never publishes an offer vulnerable to unresolved automatic cleanup and
  never drops the late-start intent. Include explicit authorized release, wrong scope/offer, original-zone and duplicate
  release tests; the old unbound ID-only deletion path must not remain a production bypass.
- Negative controls demonstrate detection of omitted write-ahead intent, missing ownership comparison, removed fencing
  and premature cleanup/offer completion. An unchanged control passes; a compile failure is not a detected behavior bug.
- Focused tests, formatting, strict Clippy and existing parity pass. Provide exact base/head, schema version, commands,
  environment, case inventory/counts, failing-before/passing-after evidence, remaining limits and a small API example.
  PostgreSQL acceptance must fail if the required database is absent; skipped/ignored tests are not completion evidence.

**FAILURE — return incomplete with preserved evidence if any apply:** data survives only a graceful shutdown; crash
testing uses only an in-memory database or the fake dies with the service; stale workers can complete ownership transitions;
automatic cleanup touches an offered/foreign session; unbound release can delete another scope's DNS; ambiguous work disappears; scope expands into deployment; tests are skipped,
weakened or expectations regenerated from the broken implementation. Do not label such a result successful.

## Validation commands

Existing commands (use the repository's local toolchain setup if needed):

```sh
eval "$(tools/pgtest/start.sh)"
cargo fmt --all --check
cargo test -p rh-placement --locked
cargo test -p rh-placement --features postgres
cargo clippy -p rh-placement --all-targets --all-features -- -D warnings
cargo run -p rh-parity --bin parity-report
```

The `postgres` feature and mandatory crash/restart test command are **to be created by this packet**. Document their exact
names. If a manifest change needs a local lock update for validation, retain that generated lock only in your separate
checkout, exclude it from the PR and report the required change; the coordinator owns the committed lock. Run the existing
workspace gate once after focused checks pass. Do not print the helper's database URL in handoff evidence.

## Risk and suggested model tier

High: transactional state machines, cancellation and distributed side effects. Use Claude's strongest available technical
reasoning for this single milestone. Keep the design as small as the recovery invariants allow. No speculative framework.

## Known traps

- A Drop guard cannot perform durable async recovery after SIGKILL; the write-ahead state must already exist.
- Lease expiry alone does not fence provider effects already in flight. A transaction held over a network await is not
  a substitute for explicit recoverable intent and claim validation.
- `GameSessionData` must survive every backend receipt. The fifth PR27 repair exists because a cancellation response
  with the right status but wrong identity could otherwise publish or disarm foreign work.
- Host-volume loss of the **result spool**, real AWS fulfillment, public TLS and production HTTP authorization are separate
  gates. Do not claim this milestone completes them or the whole migration.
