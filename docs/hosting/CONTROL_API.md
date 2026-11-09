# Control API v1 (rh-server <-> hosting bridge)

Status: **implemented and tested on both sides.** Written 2026-11-05 for P-HOST-1 part (a); the Rust side is
`crates/rh-server/src/control.rs` (bookkeeping, HTTP layer) plus the director/room hooks, tested by
`crates/rh-server/tests/control.rs`; the Go bridge in `hosting/glbridge/` is tested against a fake of this document
(`conformance_test.go`) and, end to end, against the real server (`crates/rh-server/tests/bridge_e2e.rs`,
`hosting/scripts/e2e-bridge.sh`). Where this file and the Rust code disagree, the code wins and this file is corrected.
Clarifications made when the Rust side landed are marked **(as built)**.

Why this shape: GameLift allows exactly one game session per server process ([GAMELIFT_VERIFIED.md](GAMELIFT_VERIFIED.md)
section 3), so a hosting process serves one session, but the API stays room-keyed (`gameSessionId`) so the same contract
also serves a self-hosted multi-room process. Nothing here mentions GameLift types; the bridge maps them.

## 1. Transport and common rules

- Served only by the control listener (`--control 127.0.0.1:<port>`, loopback asserted in `main.rs`). It is a separate
  `axum` router from `public_router`; no `/control/*` route may ever be added to the public router. A test must fetch every
  `/control/*` path through the public listener and expect 404.
- JSON bodies, `Content-Type: application/json`, UTF-8, request bodies at most 16 KiB (413 above).
- Every request body and every response body carries `"v": 1`. A request with another `v` is `400 unsupported_version`.
  A missing `v` is `400 bad_request`. (GET requests have no body; their responses carry `v`.) Unknown request fields are
  `400 bad_request` (fail closed: a typo must not silently drop a restriction).
- Errors: `{"v":1,"error":{"code":"<snake_case>","message":"<human text, no secrets>"}}`. **(as built)** Codes outside the
  endpoint tables: 400 `bad_request` | `unsupported_version` | `unsupported_property`, 401 `unauthorized`, 403 `forbidden` (any request carrying an `Origin` header: no control client is a browser), 413
  `payload_too_large`, 503 `not_ready`, and 409 `not_final` (ack of a record that has not ended) and `too_many_admits` (the room
  holds 256 player records, live and final).
- Optional defense in depth: when the server is started with `--control-token-file <path>`, every request must carry
  `Authorization: Bearer <token>` (401 otherwise; the compare is over fixed-length SHA-256 digests, so it is constant time). The bridge sends it when
  `GLBRIDGE_CONTROL_TOKEN` is set. The loopback bind is the primary boundary; the token only guards against a co-located
  process.
- Time values crossing the API are **relative milliseconds** (`...Ms`), never wall-clock stamps, so bridge and server need no
  clock agreement.
- Never log or echo profile tokens or admission tickets. `callsign` is public, `playerSessionId` is a GameLift identifier.

Status codes used: 200 OK, 400, 401, 404 `no_such_session`, 409 (conflict, see each endpoint), 413, 503 `not_ready`.
201 is not used: create is idempotent and always answers 200 with `"created": true|false`.

## 2. Identifiers

| Field | Meaning | Constraint |
|---|---|---|
| `gameSessionId` | opaque id chosen by the hosting layer (GameLift: the game session ARN) | 1..=1024 bytes, no control characters |
| `playerSessionId` | opaque id of one reserved seat (GameLift `psess-...`) | 1..=128 bytes |
| `callsign` | the in-game profile name a Hello presents (`Hello.profile`) | 2..=16 of `A-Za-z0-9_-` (the existing `profile_ok` rule) |
| `roomId` | the server's own 16-byte room id, lowercase hex (32 chars) | informational |

The hosting layer must use the callsign as GameLift `PlayerId` (placement `DesiredPlayerSessions`). A player session whose
`PlayerId` is not a valid callsign is ignored by the bridge and logged.

## 3. Endpoints

### 3.1 `GET /control/health` (exists)

200 only while `Ready`, 503 in every other state (`starting`, `draining`, `terminated`). Today's body is kept
(`state`, `rooms`, `metrics`) and gains a `control` object that the bridge uses to **fail closed**:

```json
{"v":1,"state":"ready","rooms":0,"metrics":{...},
 "control":{"v":1,"requireAdmit":true,"maxRooms":1,"admitTtlMs":60000}}
```

`requireAdmit` is `true` only when the process was started with `--require-admit` (section 4; the flag needs `--control`, and
a misspelt `--require-*`, `--admit-*` or `--control-*` flag stops the server with exit code 2 instead of being ignored). The bridge refuses to call
`ProcessReady` unless `control.v == 1` and `requireAdmit == true` (override `--allow-no-admit`, tests and local dev only).
**(as built)** The body also carries `"build"`, the build id (`RH_BUILD`, as in the replay header), so a rolling deploy can verify which build a group
runs (loopback only; `/info` and its pinned key set do not carry it). `metrics` gains `lateSteps` (steps run by a wake more than one tick period
after its grid slot) and `admitToSeatMs` (histogram: admit consumed by a Hello to the seat taken). A server that predates this contract has no
`control` object, so the bridge refuses it. A draining server answers 503
with `"state":"draining"`; the bridge treats that as healthy-and-leaving (it is intentional, see 6.5).

### 3.2 `POST /control/session`: create the room for a game session

```json
{"v":1,"gameSessionId":"arn:aws:gamelift:...","properties":{"maxPlayers":8,"fillBotsTo":8}}
```

`properties` keys (all optional, unknown keys `400`): `maxPlayers` (1..=`MAX_PLAYERS`, default 8), `fillBotsTo`
(0..=`maxPlayers`, default the server's `--fill-bots`). `mapSeed` is reserved: any value is `400 unsupported_property`
until the map generator supports per-session seeds (the map is the server's `--map` today).

Response 200: `{"v":1,"created":true,"gameSessionId":"...","roomId":"<hex>","phase":"lobby","maxPlayers":8}`.

| Case | Result |
|---|---|
| state `starting` | 503 `not_ready` |
| state `draining`/`terminated` | **409 `draining`** |
| rooms already at `--max-rooms` | **409 `at_capacity`** |
| same `gameSessionId`, same properties, room still open | 200 `created:false`, same `roomId` (retry-safe). **(as built)** "same properties" compares the effective values (an omitted `maxPlayers` is 8, an omitted `fillBotsTo` is `--fill-bots` capped at `maxPlayers`) |
| same `gameSessionId`, different properties | 409 `session_conflict` |
| same `gameSessionId`, room already ended/closed | 409 `session_ended` (a hosting layer never reuses an id; do not recreate) |

Creating a room does not start the match; the existing lobby rules (min players, lobby and fill timers) apply unchanged.
The room is created by the director's existing room constructor; no gameplay rule lives in this endpoint.

### 3.3 `POST /control/admit`: pre-authorise one join

```json
{"v":1,"gameSessionId":"...","playerSessionId":"psess-...","callsign":"alice","ttlMs":60000}
```

`ttlMs` optional (default `admitTtlMs`, 1000..=300000). Response 200:
`{"v":1,"state":"admitted","gameSessionId":"...","playerSessionId":"...","callsign":"alice","expiresInMs":58213}`.

An admit is **an additional precondition, never a credential.** It does not authenticate anyone and cannot be presented by a
client: it only says "this callsign may take a seat in this room". The profile token in the Hello is still verified by the
unchanged credential check, and the profile's fenced lease is still taken. See section 4.

| Case | Result |
|---|---|
| unknown `gameSessionId` | 404 `no_such_session` |
| room ended/closed or server draining | 409 `draining` / 409 `session_ended` |
| same `(gameSessionId, playerSessionId, callsign)` while pending | 200 `admitted`, **expiry not extended** |
| same triple after it was consumed (the player seated) | 200 `state:"consumed"` (retry after success is harmless; it never re-arms) |
| same triple after it expired or the player left | 200 `state:"expired"` / `"left"` (never re-arms) |
| same `playerSessionId`, different `callsign` or room | 409 `admit_conflict` |
| same `callsign` already holds a different pending/seated admit (any room) | 409 `admit_conflict` |
| pending + seated admits already equal `maxPlayers` | 409 `room_full` |
| invalid callsign / id lengths | 400 `bad_request` |

**Replay and expiry.** A `playerSessionId` is consumable once. Consumed, expired and left admits are remembered for the life
of the room so that a replayed `POST /control/admit` (a bridge retry after the player already joined, or a hostile local
process) can never create a second seat. A pending admit that is not consumed within `ttlMs` becomes `expired`. The default
equals GameLift's player-session reservation timeout (60 s, [GAMELIFT_VERIFIED.md](GAMELIFT_VERIFIED.md) section 6).
Expiry is evaluated by the server's own monotonic clock; the bridge cannot extend it except by `POST`ing a new
`playerSessionId`.

### 3.4 `GET /control/rooms`: state, and the event source

```json
{"v":1,"state":"ready","draining":false,"maxRooms":1,"rooms":[{
  "gameSessionId":"...","roomId":"<hex>","phase":"lobby|active|ended|closed","rev":17,
  "maxPlayers":8,"endReason":null,
  "players":[{"playerSessionId":"psess-...","callsign":"alice",
              "status":"admitted|seated|away|left|expired",
              "reason":null,"expiresInMs":41000,"graceRemainingMs":null}]}]}
```

Player `status`:

- `admitted`: pre-authorised, not seated (`expiresInMs` counts down).
- `seated`: connected and seated. `away`: connection dropped, seat held for the reconnect grace (`graceRemainingMs`, the
  server's `RECONNECT_GRACE`, 10 s today); a resume within it returns to `seated`.
- `left`: **final**, the seat is gone. `reason` is `grace_expired`, `left` (clean leave), `kicked`, `match_over`
  (the room closed with the player still seated, after the Result was delivered), `crashed`, and **(as built)** `lease_expired`
  (the profile's durable lease lapsed, so the seat is no longer authorised) and `aborted` (`end` mode `abort`).
- `expired`: an admit nobody used. Final.

`phase` `closed` is final and carries `endReason`: `completed` (the match ended), `ended_by_bridge`, `drained` (closed while the
server or the room was draining), `crashed`, and **(as built)** `abandoned` (every human left before the match ended). `rev` increases on
every change to that room. Closed rooms stay listed (a bounded tombstone: the newest 16, plus any younger than 10 minutes up to a hard cap of 256) so a bridge that
polls less often than the room lifetime still observes the end exactly once.

**Event model: poll.** The bridge polls `GET /control/rooms` (default every 500 ms; the contract allows 100 ms..5 s) and
reconciles. There is no push or long-poll in v1: polling needs no connection state, survives a restart of either side, and
the volume is a few hundred bytes per poll. Because every transition that matters to GameLift is a *level* (`seated`,
`left`, `closed`) rather than an edge, a missed poll loses nothing. Bridge reconciliation, idempotent by construction:

- first sight of `seated` for a `playerSessionId` -> `AcceptPlayerSession` once (`away`->`seated` resumes do **not**
  re-accept: our resume token is authoritative, GameLift is told nothing);
- `left` -> `RemovePlayerSession`, then `POST /control/leave` with `mode:"ack"`;
- `closed` -> end of game session (section 6.4).

A later version may add `?afterRev=<n>&waitMs=<ms>` long-poll to the same route without breaking v1 clients (they omit the
parameters).

### 3.5 `POST /control/leave`

```json
{"v":1,"gameSessionId":"...","playerSessionId":"psess-...","mode":"ack"}
```

- `mode:"ack"`: the bridge confirms it has reported a `left`/`expired` record to the hosting layer; the server may drop the
  record (it keeps the replay marker, section 3.3). Idempotent: unknown or already-dropped record is 200. **(as built)** Acking a
  record that has not ended (`admitted`, `seated`, `away`) is `409 not_final`: it would otherwise silently forget a live seat.
- `mode:"kick"`: the hosting layer wants the player gone (for example its reservation was revoked). The server removes the
  seat through the **same path as a disconnect past grace** (the Result and lease give-back follow their normal rules; a kick
  is not a way to skip them) and reports `left` with `reason:"kicked"`. **(as built)** The record turns `left`/`kicked` in the
  same call; the room is then told to remove the seat (`RoomCmd::Kick`, the leave path), so a poll right after the call already
  shows it. A kick of an unknown or already-left player is 200.
  A kick of an `admitted` entry turns it `expired`. **(as built)** If that entry's Hello has already consumed the admit and is being
  seated right now, the kick is refused: **409 `seating_in_progress`** (retry shortly; the next look says `seated`, which a kick
  handles). Expiring it would let the seat land with the book saying `expired`, a player seated invisibly. A kick must reach the room
  or not happen: room-mailbox space is reserved before the record changes, so a mailbox that stays full for 2 s is **503
  `room_busy`** with the record untouched (retry-safe).

Response 200 `{"v":1,"state":"left|expired|dropped|unknown"}`. 404 `no_such_session` for an unknown room.

### 3.6 `POST /control/end`

```json
{"v":1,"gameSessionId":"...","mode":"graceful"}
```

- `graceful`: stop admitting to the room (new admits `409`), let the match play out, close on its own (the same rule as drain,
  scoped to one room).
- `abort`: close the room now. Seated players are sent the existing close; their seats and leases are freed; **no Result is
  invented for an interrupted match** (C-PERSIST). `endReason` becomes `ended_by_bridge`.

Idempotent. **(as built)** The room's mailbox slot is reserved before the session is marked ending; a room that cannot be told
within 2 s is 503 `room_busy` and nothing changed. Response 200 `{"v":1,"phase":"closed|active|ended|lobby"}`; 404 for an unknown room (a closed tombstone answers 200).
**(as built)** `abort` waits up to 2 s for the room to report closed, so its answer is normally `closed`. `graceful` on a room
that nobody joined closes it at its next wake (see 3.7). A room closed by `abort` reports its still-unused admits `expired`.

### 3.7 `POST /control/drain` (exists)

Body `{"v":1}` (an empty body stays accepted until the Rust side adopts `v`). Stops admissions (`ServerDraining`), asks every
room to finish, `Terminated` when the last room closes, process exits. Idempotent. 200 `{"v":1,"state":"draining"|"terminated"}`.
After drain begins `POST /control/session` and `/control/admit` are 409 `draining`. **(as built)** `session` re-checks the lifecycle under the
director lock that drain's room scan also takes, so a session created during a drain is refused and drain can never reach `Terminated` with a live room. Draining never ends a running match.
**(as built)** A draining room with no human that never had one closes at its next wake instead of waiting for the 30 s
unclaimed-room timeout (no admission can seat after drain, so there is nothing to wait for); a room that has had a human closes
when its last human leaves, as always. The closed room reports `endReason` `drained`.

## 4. Binding a GameLift player session to an admission, without bypassing anything

Hello carries one `ticket` (<= 448 bytes) which stays exactly what it is today: the profile token (UTF-8). **This contract
does not change the Hello, the wire protocol, or what the ticket means.** A GameLift player-session id never travels from the
browser to the game server; instead:

1. The backend places the game (`StartGameSessionPlacement`) with `DesiredPlayerSessions` whose `PlayerId` is the callsign
   (the backend has already authenticated the profile through the normal profile service and only reserves seats for callsigns
   whose profile it has verified; this does not replace the check below).
2. After `ActivateGameSession`, the bridge lists the game session's `RESERVED` player sessions
   (`DescribePlayerSessions`, a server-SDK call) every 1 s while the session is open and for each new one calls
   `POST /control/admit {playerSessionId, callsign}`.
3. The player connects and sends Hello with the profile token. The server runs, **in the existing order**:
   protocol version -> content hash -> resume token -> callsign format -> draining -> **credentials (the profile token,
   unchanged)** -> **admit check (new, only when `--require-admit`)** -> profile ownership (process, then fenced lease)
   -> capacity. All refusals still happen before a seat is taken.
4. The admit check looks up an unconsumed, unexpired admit for this callsign (admits are keyed by callsign, ASCII
   case-insensitively, and a callsign holds at most one) and routes the Hello to that admit's room. None -> `Reject
   BadCredentials` with reason `not admitted`
   (an existing code; the reason text is the only difference; the client may retry for a few seconds, because the bridge
   admits on its polling cadence). **(as built)** The check has two parts: a read-only look right after the credential check (it refuses before any wait), and the
   consumption inside the director's critical section that also tests "profile already in a match" and reserves the seat, so
   two Hellos cannot both take one admit, and a profile already in a match is refused `ProfileInUse` without touching its admit.
   If the admit's room is gone or no longer a lobby the Hello is refused `MatchFull` (`match closed` / `match in progress`) and
   the admit stays pending. The admit is **consumed at the same critical section that reserves the seat**. If the
   admission later fails (lease refused, `ProfileInUse`, capacity), the admit is restored to pending with its remaining
   time, so a refused attempt does not burn the reservation, and a successful one cannot be replayed.
5. The bridge sees `seated` and calls `AcceptPlayerSession`.

Consequences, stated so a reviewer can check them:

- A valid profile token without an admit is refused. An admit without the matching profile token is refused. Neither alone
  suffices, and the admit grants **no** extra rights (no lease, no ownership).
- Fenced leases are untouched: the admit check sits before the lease acquisition and never releases or acquires one.
- Under `--require-admit` there is no automatic lobby placement: `open_lobby` is not consulted; rooms exist only through
  `POST /control/session`, and a Hello is routed only by its admit.
- Latency cost: a client that connects before the bridge's next `DescribePlayerSessions` is refused once and retries. Worst
  case about one poll interval (1 s) after placement `FULFILLED`. Measured, not assumed, in the staging experiment.
- A resume (16-byte token) is not an admission: it continues to bypass the admit check exactly as it bypasses credentials
  today, and only works within the grace for a seat this process issued.
- The bridge's reservation of a seat in GameLift (`CreatePlayerSession` / placement) happens in the backend, so a hosting
  ticket can never be minted by a player.

## 5. Reconnect grace and seat removal

The Rust server owns reconnect: `RECONNECT_GRACE` (10 s) and the 16-byte resume token. The bridge never calls
`RemovePlayerSession` for `away`. It calls it only for `left` (which the server reports after the grace expired, or after a
clean leave or a kick). The GameLift slot therefore stays occupied for the grace, which is intended. Whether GameLift would
accept a second `AcceptPlayerSession` for an `ACTIVE` session is UNVERIFIED and not needed.

## 6. Failure, cancellation and drain semantics

6.1 **Bridge retry safety.** Every POST above is idempotent as specified, so the bridge retries with backoff after a timeout
or 5xx without a read-before-write. 4xx other than 409-with-an-idempotent-meaning are not retried.

6.2 **Activation failure.** If `ActivateGameSession` fails after `POST /control/session` succeeded, the bridge sends
`POST /control/end {mode:"abort"}`, then `ProcessEnding` and exits non-zero (the container group restarts and GameLift
replaces the process). The room never ran a match, so nothing is lost.

6.3 **Cancellation.** If the bridge is told to stop (signal, `OnProcessTerminate`) while a session is open, it follows 6.5.
If the bridge process dies, the rh-server child dies with it (the bridge is PID 1 of the container and the child is in its
process group); rooms are lost, results already in flight use the normal durable-write path (P-PERSIST-2).

6.4 **Session end.** On `closed` (any `endReason`) the bridge removes any remaining `RemovePlayerSession` entries, then
`ProcessEnding`, `Destroy`, and exits 0 (the server also exits once draining empties; the bridge sends `drain` first so
the server cannot take another room). A process never hosts a second GameLift session.

6.5 **Drain / terminate.** `OnProcessTerminate` -> `POST /control/drain` -> poll `GET /control/rooms` until no room is open
(or the server exits) -> `ProcessEnding` -> `Destroy` -> exit 0. The bridge bounds the wait by `GetTerminationTime()` minus a
safety margin (and by `--drain-deadline`, default 4 m 30 s: GameLift waits five minutes after the callback, per the SDK
source comment); at the deadline it sends `end {mode:"abort"}` for rooms still open and proceeds. While draining, the health
callback reports healthy.

6.6 **Server crash.** If `rh-server` exits unexpectedly the bridge best-effort calls `ProcessEnding` and exits non-zero.

## 7. Tests (`crates/rh-server/tests/control.rs`, `bridge_e2e.rs`; all present)

create/admit/leave/end/drain sequences; each 409 above; session and admit idempotency (same request twice, same answer, no
second room or seat); replay of a consumed or expired admit; `--require-admit` refuses a valid token without an admit and an
admit without a valid token, and does not change the order of the earlier refusals; a refused admission restores the admit;
a seated player's `away` -> resume does not appear as `left`; `left` appears only after the grace; abort closes without a
Result; every `/control/*` path is 404 on the public listener; the control listener refuses a non-loopback `--control`.

Also covered there: the public listener answers 404 to every `/control/*` path and the control listener serves no public route;
`main.rs` refuses a non-loopback `--control` (real binary); `--require-admit` is parsed (a typo, `=true`, or a missing
`--control` exits 2; the real binary reports `control.requireAdmit`); the bearer token; body bounds (413) and unknown
fields/versions; no profile token or control token in any control response; the 256-record and tombstone bounds
(`control::tests`); and the whole bridge flow with the real Go bridge (fake SDK build), a real `rh-server` and a real
WebSocket client: `OnStartGameSession` -> session -> admit -> join with the profile credential -> `AcceptPlayerSession`, a
resume inside the grace (no remove, no second accept), a drop past the grace -> `RemovePlayerSession`, `OnProcessTerminate` ->
drain -> last player leaves -> `ProcessEnding` -> `Destroy` -> exit 0 and rh-server gone.

Known boundaries **(as built)**: admit/seat bookkeeping lives in process memory (rooms are lost with the process, as 6.3
says); a kick that races the very Hello consuming that admit (the admit is `admitted`, the seat not yet taken) is refused with
409 `seating_in_progress` and is retried (before this was fixed it turned the record `expired` while the seat landed anyway). Without `--require-admit` the control endpoints still work, but Hellos are placed by the
automatic lobby rules and are not tied to an admit.
