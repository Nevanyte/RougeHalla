# fix/server-resilience (launch should-fix: server resilience)

Base: `integration/backend-unity-union` 976a6559 (protocol 16). No wire or protocol change.

## Fixes

1. **Database unreachable at startup** (`crates/rh-server/src/main.rs`, `durable`, `retry_with_backoff`, `redact_secrets`).
   Bounded retry with exponential backoff (0.5 s doubling to 8 s), each attempt cut at budget/3 (1..10 s) because sqlx's pool
   otherwise retries a refused connection for 30 s inside one call. `--db-connect-timeout-secs N` (default 60, `0` = one attempt,
   max 3600). Exit codes: **69** database unreachable after the budget, **70** migration failed, 78 schema newer than the binary
   (unchanged), 2 bad flags. The log line carries no connection string, user or password (`redact_secrets`; the real-binary test
   asserts the password, user and URL are absent).
2. **Lease acquisition outage reported as `ProfileInUse`** (`director.rs` admit, `persist.rs` `LeaseError`, `rh-persist`
   `Error::is_lock_contention`). A real conflict (`Conflict`, `LeaseHeld`, SQLSTATE 55P03, memory "held") stays `ProfileInUse`.
   A timeout or any other storage error is now `RateLimited` with the reason "server busy, storage unavailable; try again
   shortly (...)". **Wire gap:** the reject enum has no "server unavailable" code (1..=11); `RateLimited` is the closest
   non-misleading existing one. Adding e.g. `ServerUnavailable = 12` is a protocol change (older decoders keep it as `Unknown`),
   not made here.
   *Seat lease lapsing during an outage longer than the TTL (default 120 s)*: the renewal worker keeps retrying every
   `min(renew, db_timeout)` until the local deadline; the room then `expire_leases` -> `leave(LeaseExpired)`: the player is
   removed (MIA), the fence is cleared, no result is banked. This is deliberate fencing (after the TTL another host may hold the
   lease, and a late renewal must never revive a seat; there are existing tests for it), so it is **reported, not changed**. The
   mitigation is `--lease-ttl-secs` above the longest tolerable outage.
3. **Director mutex poisoning** (`director.rs`, `LockRecover::lock_recover`; 50 call sites plus the bot-names RwLock). One helper
   recovers the guard, logs `event=director_lock_poisoned` once per incident (the poison flag is cleared), and the safety
   argument is in the trait doc: critical sections are short synchronous map/counter updates, never await, and any half-updated
   entry is reclaimed by the paths that own it (`unwind`, the room `Closed` sweep, lease expiry).
4. **Room crash record** (`director.rs` Closed handler, `room.rs` `crashed`, `control.rs` health). Counter + last-crash summary in
   loopback `GET /control/health` as `roomCrashes: {"total": n, "last": {"roomId","atUnixMs","ticks","seatsFreed"}|null}`
   (top level, so the pinned `control` object and public `/info` are untouched). Two error-level single lines:
   `[server] ERROR event=room_task_panicked room=.. ticks=.. humans=..` and
   `[server] ERROR event=room_crashed room=.. ticks=.. seats_freed=.. crashed_total=..`.
5. **Control token required** (`main.rs` `hosted_settings`). `--control` now needs `--control-token-file <file>` or an explicit
   `--control-insecure-loopback`; otherwise exit 2 with a message naming both. `--control-insecure-loopback` without `--control`
   is also refused. Callers updated: `rh-load` (passes the insecure flag for its throwaway server), `hosting/glbridge`
   `serverArgs` (passes it only when `GLBRIDGE_CONTROL_TOKEN` is unset, i.e. the existing behaviour made explicit; **set the
   token in the hosted image to actually enforce it**), the binary tests.
6. **Drain cap** (`main.rs` `drain_settings`, `director.rs` `drain_within`, `room.rs` `RoomCmd::DrainEnd`).
   `--drain-max-secs N` (default 60, `0` = no cap) and `--drain-write-wait-secs N` (default 25, was a fixed 150).
   Alignment: `hosting/technical-demo/render.py`/`bootstrap.py` set no `TimeoutStopSec` for `rh-server`, so systemd's default
   90 s applies (`render.py`'s 10 s is the setup unit); 60 + 25 = 85 s. At the cap every remaining room gets `DrainEnd`: each
   seat is closed out as a leave (a player still standing in a run is MIA, so the result it earned is reported and written under
   its fence), then the room closes normally (results kept; unlike `Abort`). A room that does not close within 10 s more is
   abandoned and the lifecycle forced to terminated. `docs/hosting/RUNBOOKS.md` still says 150 s: that default changed.

## Gates (macOS, `CARGO_TARGET_DIR=target-fix`)

- `cargo test -p rh-server` (default): 351 passed, 0 failed, 2 ignored.
- `cargo test -p rh-server --features postgres --no-fail-fast` (throwaway cluster via `tools/pgtest`, `PGBIN=/opt/homebrew/bin`):
  424 passed, 0 failed, 4 ignored.
- `cargo clippy -p rh-server -p rh-persist -p rh-load --all-targets -- -D warnings` clean; `-p rh-server --all-targets
  --all-features -- -D warnings` clean; `cargo fmt --all -- --check` clean.
- rh-load + rh-persist: 86 passed, 0 failed. Go is not installed on this machine, so the one-line `hosting/glbridge` change is untested (`supervisor_test.go` only checks that required flags are present).
- New tests: director (lease timeout is not ProfileInUse, held lease still is, poison recovery, crash record, drain cap, empty/
  uncapped drain), main (token requirement, drain/db flag parsing, backoff schedule on a paused clock, redaction), tests/control
  (binary refuses tokenless `--control`; binary exits 69 within budget with retries and no secret in stderr; health
  `roomCrashes`), persist (LeaseError classification).

## Not fixed / notes

- No new reject code (wire change); see fix 2.
- Seat lease lapse beyond TTL still removes the player (design, see fix 2).
- `docs/hosting/RUNBOOKS.md` and `docs/hosting/CONTROL_API.md` (token now mandatory, drain flags) are not edited here.

## Review follow-up (same branch)

1. **Drain cap clock** (`director.rs` `drain`, `drain_within`): the cap is measured from the call, before `drain()`; `drain()` no
   longer awaits room mailboxes (one detached send per room), and the `DrainEnd` round uses `try_send`. Test
   `a_wedged_room_with_a_full_mailbox_cannot_hold_the_drain_past_its_cap` (full mailbox, nobody reading): returns at exactly the cap.
2. **One budget** (`main.rs`): `drain-max` (everything until the last room closes or is abandoned, with the `DrainEnd` round in
   a reserve of `max/6`, at most 10 s) + `drain-write-wait` + 5 s HTTP shutdown. Defaults 55 + 20 + 5 = 80 s (was 60 + 25 + 10 +
   sends + 5, up to ~100 s) under systemd's 90 s. Formula in the `main.rs` header, RUNBOOKS and CONTROL_API.
3. **No storage text to clients**: the lease-outage reject reason is the fixed string "server busy, storage unavailable; try
   again shortly"; the detail stays in the `event=lease_unavailable` log line.
4. **Connect retry** (`rh-persist` `Error::is_startup_fatal`, `main.rs` `ConnectFail`): config errors (unparsable URL),
   SQLSTATE class 28 (auth) and `3D000` (no such database) are fatal at once (exit 69, `event=database_connect_refused_permanently`,
   no retries; test with `not-a-url` and a 60 s budget exits in under 10 s). `--db-connect-timeout-secs 0` gives its single attempt 10 s.
5. Docs: RUNBOOKS (150 s -> `--drain-write-wait-secs`, default 20 s), CONTROL_API (mandatory token, shutdown budget).

Results: `cargo test -p rh-server` 352 passed; `--features postgres` 426 passed (4 ignored); rh-persist + rh-load 86 passed;
clippy `-D warnings` clean (default and `--all-features`); fmt clean.
