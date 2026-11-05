# Placement durability evidence (P-CLAUDE-PLACEMENT-2)

Base `de6f1c196f9b6a42e50dfdf19327d72bd3683fc8` (origin/optimization_port, contains 5b1a7aae). Branch `claude/durable-placement-ledger`;
head is the commit that contains this file (`git log -1 --format=%H -- docs/evidence/placement-durability/README.md`).
Ledger schema version **2** (`ledger::SCHEMA_VERSION`; migrations 0001 + 0002 `version` column, per-write CAS).
Environment: macOS arm64 (Darwin 25.6), rustc 1.97.0, PostgreSQL 16 from `tools/pgtest/start.sh` (throwaway cluster, one database per test).
Synthetic data only; no AWS, DNS or credentials; the database URL is never printed.

## Commands (all green on this head)
```sh
eval "$(tools/pgtest/start.sh)"                                               # sets DATABASE_URL (not shown)
cargo fmt --all --check
cargo clippy -p rh-placement --all-targets --all-features -- -D warnings
cargo test -p rh-placement --locked                                           # no database: 46 lib + memory tests
cargo test -p rh-placement --features postgres                                # + PostgreSQL conformance and service tests
cargo test -p rh-placement --features postgres,fault-injection                # + child-process crash tests, delayed effects (run 3x)
docs/evidence/placement-durability/negative-controls.sh                       # control + 4 mutants (output: negative-controls.output.txt)
cargo run -p rh-parity --bin parity-report
```
Features: `postgres` (sqlx + PgLedger), `fault-injection` (named fault points, `RH_PLACEMENT_MUTANT`; debug builds only).
`crash_restart`, `delayed_effects` and the child binary `placement-crash-child` have `required-features = ["postgres","fault-injection"]`.
PostgreSQL tests panic when `DATABASE_URL` is unset; nothing is `#[ignore]`d. Counts per run: `--locked` 0 failures; `postgres`
0 failures; `postgres,fault-injection` 0 failures on three consecutive runs (221 tests per run across 10 test binaries).

## Process-level harness
The parent test process hosts the persistent fake GameLift/DNS (`tests/support/remote_fake`, TCP) and records every external mutation.
It spawns `placement-crash-child` (the real `PlacementService::with_ledger` over `PgLedger` and `RemoteGameLift/RemoteDns`), which runs
`place | reap | release` and prints one JSON line. A child dies either by a fault point that calls `std::process::abort()` (`RH_CRASH_AT`, no
destructors, no flush) or by SIGKILL from the parent while the fake holds its call. A NEW child then restarts through the real service path.

## Case inventory (`tests/crash_restart.rs`: 11, `tests/delayed_effects.rs`: 6)
| Boundary / case | Kill form | Asserted |
|---|---|---|
| (a) committed start intent, start not sent | abort `after.write.start_intent` | no provider mutation; row `active`, `start=Intent`; two reaps count NotFound but stay Open (settle window); identical retry = `request_id_reused`, sends nothing; colliding foreign placement id is classified `Foreign`, never stopped; foreign untouched |
| (b) start accepted, receipt lost | SIGKILL while fake `drop_receipt(Start)` | trace shows 1 start (reply dropped) whose binding equals the stored one; reaper finds it by binding, cleans it; no orphan; retry rejected |
| (c) fulfilled, DNS upsert applied, reply lost | SIGKILL while `drop_receipt(DnsUpsert)` | fulfilment durable before DNS intent; reaper deletes the host + terminates; trace exactly Start,Upsert,Delete,Terminate; never offered |
| (d) DNS written + verified, before offer commit | abort `before.write.offer` | hostname really published; row has no offer; cleaned; never offered |
| (e) offer committed, response not returned | abort `after.write.offer` | row `offered`, offer durable; reaper (run twice) touches nothing; identical retry returns the stored offer with ZERO backend calls; other scope / party / zone = `invalid_request` before any call |
| (f) cleanup effect accepted before local completion | abort after terminate / after dns delete / after stop, and BEFORE terminate | intents durable; row stays Open and discoverable; restart repeats idempotent effects (trace accounted exactly); completion is never recorded before its effect |
| foreign collision on the live path | none | AlreadyExists -> describe shows foreign binding -> `request_id_reused`, foreign untouched, no offer |
| release (4 cases) | child; abort in release | wrong scope / other scope's id / wrong or other request's placement / unknown id are refused with no mutation; authorized release deletes only that name in the STORED zone, duplicate is Ok with no DNS call, released id never replays; half-done releases resumed by the reaper; no ID-only path (source guard + behaviour) |
| delayed stop / DNS delete / terminate | in-process worker A + worker B (own pool) | A's request is held by the fake, A's lease expires, B takes over and finishes, then A's request is applied: trace shows it `late`; A's later writes are fenced, row stays B's; only idempotent cleanup ops follow takeover; no offer ever |
| stale DNS check succeeds late | same | B's cleanup left unresolved (injected delete error): A resumes believing the name verified, cannot write `dns_verified`/offer; no offer while cleanup is open; next pass completes it |
| ambiguous start accepted after NotFound | A's 3 starts held | two NotFounds do not settle; intent never dropped; late start (trace `late`) is found and cleaned, never offered |
| start applied after the settle window | settle=0 | pinned boundary: Settled row, late placement untracked |

## Failing-before / passing-after: negative controls
Control and mutants are runtime switches (`RH_PLACEMENT_MUTANT`, same build, honoured by the child too). Full output:
`negative-controls.output.txt`. F = at least one behavioural assertion failed; P = passed.
| mutant | crash_restart | delayed_effects | placement_durable | conformance (PG) |
|---|---|---|---|---|
| none (control) | P | P | P | P |
| skip_write_ahead | F (4) | F (4) | F | P |
| skip_ownership_check | F (2) | P | F | P |
| skip_fencing | P | F (1) | F | F (3) |
| premature_completion | F (4) | F (3) | F | P |
Each mutant is detected by a behavioural failure; compile errors and hangs do not count (barrier waits are bounded so a mutant fails instead of hanging).
`skip_fencing` is only visible with two workers, so the single-worker crash tests correctly do not detect it.

## Remaining limits
* Provider in-flight effects cannot be fenced: a stale worker's already-sent stop/delete/terminate/upsert is applied later. Only idempotent
  cleanup effects can follow a takeover, and the worker may send one more cleanup effect after its last fence check.
* A stale DNS upsert may land after takeover cleanup and leave a never-offered hostname (documented, not asserted gone).
* Settle window: a provider start applied after `start_settle_after` (default 1 h) AND two NotFounds is untracked (test pins it).
* Result-spool host loss, real AWS/GameLift/DNS adapters, public TLS and HTTP authentication are separate gates. Scope is trusted, not authenticated.

## API example
```rust
let ledger = PgLedger::connect(&url, PgLedgerConfig::default()).await?;
let svc = PlacementService::with_ledger(csprng_nonce, cfg, gamelift, dns, ledger, DurabilityConfig::default()).await?;
let scope = Scope::new(authenticated_account_id)?;
let offer = svc.place_scoped(&scope, &request).await?;       // identical retry after a crash returns the same offer
svc.reap_abandoned().await;                                  // schedule; bounded per pass
svc.release_session(&scope, &request.request_id, &offer.placement_id).await?;
```

## Coordinator handoff
* `Cargo.lock` hunk (not committed): `rh-placement` gains `"sqlx"` in its dependency list (one added line; sqlx 0.8.6 already locked).
* Root CI hunk proposal: add a step with a PostgreSQL service, `eval "$(tools/pgtest/start.sh)"`, then
  `cargo test -p rh-placement --features postgres,fault-injection` (debug profile; the feature refuses release builds), and run
  `docs/evidence/placement-durability/negative-controls.sh` as a nightly job.
