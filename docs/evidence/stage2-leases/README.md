# Live lease renewal and durable identity

Branch: `optimization_port`. Local PostgreSQL 16 proof only. No AWS resources, production database or DNS change is
implied. Profile REST routes, durable crash recovery of unwritten results and live ending-kit metadata remain open.

## Behavior

The director renews each admitted lease off the room task and never awaits durable I/O inside a tick. Defaults are
120-second TTL, 30-second renewal and 5-second database budget. CLI overrides use whole seconds through
`--lease-ttl-secs`, `--lease-renew-secs`, `--lease-db-timeout-secs`; invalid/missing values, zero intervals and insufficient
headroom are refused before connection startup. TTL cannot exceed one hour; long matches continue through renewals.

Each room seat has its own confirmed monotonic deadline, measured from acquisition/renewal request start. Commands,
resume and each step enforce it. A stalled row cannot delay other seats; a busy `NOWAIT` row is transient and does not
discard the prior deadline. Expired seats cannot resurrect on late completions. A resolved seat can reconnect for its
reliable result even after normal lease release. Worker retirement is generation-bound and does not retain the director.

Token authentication captures the durable profile ID before waiting. Ownership and deferred results/releases retain
that ID rather than re-resolving display names. Identical old name/match/fence tuples that cannot identify the original
principal refuse to write or release. Store edge/admin calls that deliberately resolve current names are separate APIs.

## Review findings and repairs

Independent actual-PostgreSQL reproductions found and verified repairs for:

- Renaming a seated profile admitted a duplicate actor under the new name, sharing its fence. Stable-ID ownership now
  refuses it without releasing the first seat. Genuinely different profiles retaining the same historical callsign/fence
  can both bank only their own results.
- A valid old token waited during release; renaming/reassigning the name let it acquire the replacement profile. The
  captured authenticated ID now survives the wait and never redirects to that new principal.
- Dropping a timed-out row-blocked SQL acquisition left an unclaimed lease after the lock opened. Transaction handoff
  and exact-fence cancellation cleanup now leave no active orphan, including delayed INSERT and deferred COMMIT.
- Cancelling the public admission future left its in-memory reservation permanently occupied. The generation guard
  now retires it; submitted/abandoned join replies also clean up their exact seat without touching a replacement.
- An old ID-less result credited a replacement with the same name/match/fence, and release could affect that replacement.
  Ambiguous/missing live receipts now refuse; normal director reports carry captured identity throughout retry.
- A multi-trillion-second TTL passed local validation but overflowed PostgreSQL timestamps. The explicit one-hour cap
  rejects it consistently, including through CLI configuration.

Independent tests also kept active seats through more than one TTL, renamed an active principal while a new profile
held its old name, stalled one row across renewal, resumed before its deadline, refused resume after expiry, and verified
other room clocks/renewals continued. Stopping an entire old Tokio runtime without drain/release let another host take
fence 2; the old handle could neither renew/release nor bank against it (`StaleFence`). Forced expired-seat MIA was not
credited. Existing slow-result and normal result-release races remained correct.

## Reproduction

Use the pinned Rust toolchain and a disposable PostgreSQL environment (`tools/pgtest/start.sh`):

```
cargo test -p rh-server -p rh-persist --features rh-server/postgres
cargo test -p rh-server --no-default-features --lib
cargo clippy -p rh-server -p rh-persist --all-targets --all-features -- -D warnings
```

The frozen worker gate passed 156 PostgreSQL-enabled tests, 55 memory-only server tests and warnings-denied Clippy.
The independent reviewer ran five fixture-independent race/lifecycle programs plus managed PG/memory conformance,
director and CLI tests. Their findings are now covered in the checked-in lease conformance/director regressions.
The whole-workspace integration result is recorded in [MIGRATION.md](../../MIGRATION.md).

Final integration passed 489 tests with no failures/filters and one intentional ignored heap measurement. Formatting
and all/default-feature workspace Clippy passed. No schema migration or runtime dependency was added.
