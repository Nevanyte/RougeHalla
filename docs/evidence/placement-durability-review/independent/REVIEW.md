# Independent placement durability review

## Verdict and binding

**ACCEPT repaired candidate v2**, subject to the coordinator's integrated gates. The original producer `4843cd51551f71e43228a75dd3c83effe0228bb3` remains rejected for its preserved late-start and late-DNS failures. No new production defect was found in this review.

The accepted candidate is bound by `candidate-bindings.json`: all 37 crate files match the repair agent's source manifest SHA256 `f96186e028e2dd591460de3468cf8eed94136ca233740f478f68a138be39d260`; repair patch SHA256 `d3aaabf92886fed3ddd9a0239d31708cdc80ca8cc86885a21b33d2c8e0cd693b`. This review made no production edits. The separate integration overlay adds one test file and one Cargo test-target declaration.

The two original real-PostgreSQL failures and candidate-v1 legacy-writer failure were preserved and their hashes independently checked against the repair package. The old ownership/cancellation tests differ from their accepted base only in backend accessors; their assertions retain their original meaning.

## Contract assessment

| Packet boundary | Independent assessment and exercised evidence |
|---|---|
| Real durable service | `with_ledger`, scoped placement, `Run::commit`, release and reaper all use the supplied ledger. Both stores run the same conformance and service cases. Default memory capacity refuses new work without eviction. |
| Identity and ownership | Complete request/config/scope fingerprint precedes external calls; persistent epoch is reused. Every placement receipt used for adoption or cleanup compares the exact stored placement ID and binding. Missing or contradictory evidence remains open; foreign work is untouched. |
| Offer and release | Committed offers replay only to identical input and are excluded from automatic reaping/purge. Uncertain offer commits are reread; they never trigger speculative cleanup. Explicit release validates scope/request/placement before and after claiming, uses the stored hostname, survives retries, and retains placement identity in released tombstones. No old ID-only release API remains. |
| Claims and uncertain writes | Store-clock leases, holder/kind/fence/version CAS, same-claim delayed writes, takeover and cancelled reapers were exercised. PostgreSQL transactions end before external awaits. Production connect config establishes server timeouts below its client budget; service honors the store budget. |
| Ambiguous sends | Repeated absence never finishes an ambiguous start. Each DNS send has durable write-ahead state; only its current fenced run can acknowledge a single send. Unknown earlier sends remain sticky across successful retries, cleanup, restarts and purge. |
| Migration | Nonempty v1/v2 ledgers refuse migration without changing data, version or nonce. Empty upgrades preserve the epoch. The exclusive table lock closes the racing-insert window. Database constraints reject actual legacy fieldless CAS writes even from already-open pools. Missing decoded DNS metadata defaults to an unresolved obligation. |
| Process proof | All 11 crash tests execute child service processes against real PostgreSQL and a parent-hosted TCP fake that survives child abort/SIGKILL. Reviewed all six required crash boundaries and asserted effect traces. All nine delayed-effect tests delay application, including multiple unknown DNS sends, rather than only delaying replies. |
| Scope and privacy | SQL values are parameterized; database errors are reduced to categories/SQLSTATE and diagnostic structs redact bindings/player-session credentials. No AWS SDK, cloud changes, gameplay changes or authentication claim was added. |

## Independent execution

`run-gate.py` records each exact command, duration, exit and log hash without exposing the local database URL. Environment uses the existing prefix Cargo/Rustup installation, `CARGO_INCREMENTAL=0`, two build jobs, PostgreSQL 16 and the coordinator-approved warm `server-target` exclusively during this review.

- Unchanged repaired candidate: **233 passed**, zero failed/ignored, including the real-PG process tests.
- Final default build: **144 passed**, zero failed/ignored.
- Final feature build with the independent tests: **236 passed**, zero failed/ignored.
- Three independent controls pass after the final Cargo declaration; explicit missing-feature invocation fails before running, and missing PostgreSQL fails rather than silently skipping.
- Strict Clippy passes for default and all-feature/all-target modes; package formatting passes.
- **Eight actual implementation mutants killed behaviorally**. Four use the producer's compiled fault-injection selectors (write-ahead, ownership, fencing, premature completion), bound to exact compiled sites and commands. Four apply physical implementation patches (missing metadata defaults to Idle; a successful retry erases an earlier send; database guard removed; repeated absence finishes). Each has an assertion failure, not compile-failure credit. `mutations.json` distinguishes the activation mechanisms and binds every log and source patch.

An initial private default-build attempt lacked the external hostname vector file. That setup failure is preserved, is not a product finding or mutation kill, and was followed by successful default and feature runs after copying the unchanged vector. All implementation mutations were restored before final baselines.

## Integration overlay

Apply `review-tests.patch` to the repaired candidate. It adds `crates/rh-placement/tests/review_boundaries.rs` and declares the target with `required-features = ["postgres", "fault-injection"]`. `coordinator-manifest.patch` is the same declaration separately, for coordinators copying the new file directly; do not apply both manifest hunks.

The three controls prove:

1. Missing DNS metadata remains unresolved even when a serialized attempt appears resolved.
2. Actual PostgreSQL rejects 13 malformed/missing metadata JSON shapes plus SQL NULL atomically, with the original row unchanged.
3. A late successful upsert receipt after takeover cannot clear the send obligation; fresh unambiguous work still publishes, replays and releases, foreign work remains untouched, and cleanup uses the original zone.

Focused command:

```sh
cargo test --locked -p rh-placement --features postgres,fault-injection --test review_boundaries -- --test-threads=1
```

## Operational limits

There is no exactly-once guarantee. A DNS name can reappear between reaper passes. The backend interface cannot prove an unknown send drained, so its reconciliation obligation may remain forever, including after a crash between durable intent and actual send. PostgreSQL identities may accumulate; memory mode remains capped and fail-closed.

The library does not supply a scheduler or internal backoff. A caller must schedule bounded reaper passes, avoid tight error retries, and choose an explicit operational cadence/backoff before deployment. The next-pass cadence determines how long a late DNS name can remain. Such scheduling must never translate age or a retry count into completion. No cadence, throughput or cloud-cost claim was validated here.

Only local PostgreSQL and synthetic TCP backends were used. Real provider idempotence/terminal guarantees, cloud adapters, public TLS, HTTP authentication, deployment and nonempty old-ledger reconciliation remain separate gates. No full-workspace, map, gameplay, performance or parity-completion claim is made; the coordinator owns integrated checks.
