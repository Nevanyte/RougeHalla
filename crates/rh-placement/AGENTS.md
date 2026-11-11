# rh-placement: local rules

Placement planner plus an async `PlacementService` with a durable request ledger, off the game tick, talking to a
GameLift-style backend and DNS through traits. No HTTP handler or real AWS/DNS adapter yet; never deployed. Invariants
and schema: [README.md](README.md).

## Invariants

- Intent is written before any external effect and the result after, so a restart can reconcile.
- Every write is a compare-and-swap on fence and row version; an uncertain commit is re-read, never assumed.
- `PgLedger` applies its own migrations (0001–0003) under an advisory lock and refuses a newer schema; merged migrations
  stay byte-identical.
- The reaper uses `FOR UPDATE SKIP LOCKED` and never selects `offered` rows; unresolved DNS sends block offers.
- Foreign evidence is never stopped or deleted. `Scope` is not authentication.

## Tests

`cargo test -p rh-placement --features postgres,fault-injection` with `DATABASE_URL` (CI does). Ledger and migration
changes go to `implementer-opus`.
