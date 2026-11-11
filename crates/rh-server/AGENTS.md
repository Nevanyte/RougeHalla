# rh-server: local rules

tokio + axum over WSS. The director (`src/director.rs`) admits players and spawns each room as its own task
(`src/room.rs`); `conn.rs`, `outbox.rs` and `wire.rs` carry the per-connection path. Features: `postgres` (durable store,
account API), `bench`.

## Surfaces

- Public: `/ws`, `/healthz`, `/info` (camelCase keys, includes the content hash), `/ping`, `/probe`, and the account API
  (`/readyz`, `/api/health`, `/api/profile/…`, `/api/leaderboard`; profile routes need the `postgres` feature).
- Control (`src/control.rs`, `/control/*`): served only when `--control` is given, and the server refuses a non-loopback
  address. Hosted mode adds `--require-admit` and `--control-token-file`.

## Invariants

- Client input is untrusted: decode, `validate`, then `Sim::submit`. Bots use the same path.
- Admission refuses a protocol or content-hash mismatch (`ProtocolMismatch`, `ContentMismatch`).
- A panicking room is caught (`catch_unwind` in `room.rs`), reported `Closed { crashed: true }`, and its seats freed. New
  shared state follows the poison-tolerant pattern already in `conn.rs`, `outbox.rs`, `rtt.rs` and `api.rs`; the
  director's own mutex still uses `expect` and is a known gap.
- New request-path code returns errors. Background tasks (result spool replay, bot-learning writer) fail visibly: logged,
  counted, surfaced on `/control/health`.
- Persistence stays off the tick: results are written at deliberate boundaries through `rh-persist` (atomic, idempotent,
  fenced), never per tick or per input.

## Tests

`cargo test -p rh-server` runs without Postgres (`RH_SKIP_PG_TESTS=1` is set by the gate); `--features postgres` with
`DATABASE_URL` runs `pg_e2e`, `lease_conformance` and the account flows. `wire.rs` is a shared file: one packet at a time.

## Routing

Admission, auth, account API, control surface, input validation and rate limits are security work: `implementer-opus`,
reviewed by `reviewer-opus`.
