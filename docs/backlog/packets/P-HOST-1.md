# P-HOST-1: Go SDK bridge sidecar, control API sessions, staging experiment

## ID and outcome
P-HOST-1. (a) The Rust server's local control API gains the session endpoints a hosting bridge needs; (b) a small Go program
(`glbridge`) using the official Amazon GameLift Servers Go Server SDK runs beside the Rust process in the same container and maps
GameLift callbacks onto that API; (c) when the owner **explicitly authorises spending**, `docs/hosting/STAGING_EXPERIMENT.md`
is executed and its pass/fail table filled in, confirming or replacing ADR 0004 (Provisional). Parts (a) and (b) are
buildable and testable with no AWS account (a fake SDK shim).

## Dependencies
None in the repo for (a)/(b). (c) needs AWS credentials, a sandbox account, a budget approval (the doc sets a $150 ceiling; the
experiment is expected to cost far less but nothing is authorised by this packet) and a domain/certificate (P-HOST-2 may
run alongside). Do not run any `aws` command without that authorisation.

## Relevant legacy paths (verified)
- Rust side: `crates/rh-server/src/hosting.rs` (`Lifecycle`: Starting -> Ready -> Draining -> Terminated; `healthy()`, `draining()`, `rooms_empty()`), `lib.rs` (`control_router`: only `GET /control/health` and `POST /control/drain`; `public_router`: `/ws`, `/healthz`, `/info`, `/ping`, `/probe`), `main.rs` (`--control 127.0.0.1:<port>` asserts loopback; `--max-rooms`; SIGTERM/Ctrl-C drain), `director.rs` (admission order, `Director::drain`, `room_count`, `info()`), `room.rs` (`RoomCmd`, `RoomConfig`, `RECONNECT_GRACE`).
- Docs: `docs/adr/0004-hosting.md` (Provisional), `docs/hosting/GAMELIFT_EVALUATION.md` (sections 1.9 lifecycle, 2c bridge, 3 TLS/DNS, 4 Regions, 7 risks), `docs/hosting/STAGING_EXPERIMENT.md` (never run).
- Legacy analogue for lifecycle concepts only: `deployment/cloudflare/src/containerLifecycle.ts`, `packages/server/src/index.ts` (`/readyz`, graceful shutdown).

## New paths
`hosting/glbridge/` (Go module: `main.go`, `bridge.go`, `fake_sdk_test.go`, `go.mod` pinning a tag of `github.com/amazon-gamelift/amazon-gamelift-servers-go-server-sdk`), `hosting/Dockerfile` (one image, two binaries, `ENTRYPOINT glbridge`), `hosting/README.md`, additions to `crates/rh-server/src/{lib.rs,hosting.rs,director.rs}` and tests in `crates/rh-server/tests/`.

## Exclusive write scope
`hosting/**`, `crates/rh-server/src/{lib.rs,hosting.rs,director.rs,main.rs}` (control API only), `crates/rh-server/tests/control.rs` (to be created), `docs/hosting/**`, `docs/adr/0004-hosting.md` (status/evidence lines; the coordinator approves a status change). No edits to `rh-sim`.

## Contracts and references
C-HOST (Provisional: lifecycle, drain, control API, **no SDK in the Rust process**), C-NET (admission order is unchanged and the public listener never exposes control), C-PERSIST (a session's players still take fenced leases). ADR 0004.

## Behaviour to preserve
- The control API binds loopback only (`--control`, asserted in `main.rs`) and is not reachable through the public listener.
- Health: `/control/health` is 200 only while Ready (not Draining); `/healthz` on the public listener is 200 while Ready or Draining (so a drain does not look like death to a load balancer): keep both semantics.
- Drain: refuse new admissions with `ServerDraining`, let running matches finish, exit when the last room closes (`rooms_empty`). SIGTERM drains the same way. GameLift's `onProcessTerminate` calls drain.
- GameLift lifecycle (GAMELIFT_EVALUATION 1.9): `InitSDK()` (no parameters on managed fleets) -> `ProcessReady({Port, OnStartGameSession, OnProcessTerminate, OnHealthCheck, OnUpdateGameSession})` once per process -> `OnStartGameSession(gs)` -> the game prepares -> `ActivateGameSession()` -> clients connect with a player-session id -> `AcceptPlayerSession(id)` on join, `RemovePlayerSession(id)` on leave past reconnect grace -> `ProcessEnding()` then exit after the match.
- Managed GameLift mode uses one game session/room per server process (`--max-rooms 1`). Host density uses multiple container groups, measured in staging. Standalone multi-room load measurements do not prove managed-fleet density.
- Reconnect: the Rust protocol resumes by a 16-byte session token held `RECONNECT_GRACE` (10 s). GameLift's behaviour for re-accepting an ACTIVE player session is UNVERIFIED (evaluation 1.9): treat GameLift player sessions as admission only and keep our own token.

## Acceptance checks
1. New control endpoints (names are this packet's to define; keep them small and versioned, JSON, loopback): `POST /control/session` (create a room for a game-session id with properties: max players, fill bots, map seed policy; returns room id; 409 when draining or at `--max-rooms`), `POST /control/admit` (`playerSessionId` + callsign: pre-authorises one join; consumed by Hello), `POST /control/leave`, `GET /control/rooms` (ids, player count, phase), `POST /control/end`. Update `hosting.rs` module docs: today they mention `POST /control/session` that does **not** exist yet.
2. Rust tests (`crates/rh-server/tests/control.rs`): create/admit/leave/drain sequences, loopback-only, draining refuses `POST /control/session`, a room created ahead of a placement is joinable only with an admitted player session when `--require-admit` is on.
3. Go tests with a fake SDK interface (no AWS): `OnStartGameSession` -> `/control/session` -> `ActivateGameSession`; join -> `AcceptPlayerSession`; leave -> `RemovePlayerSession`; terminate -> drain -> `ProcessEnding`; health callback maps `/control/health`.
4. **Reconcile the contract names:** `STAGING_EXPERIMENT.md` and evaluation 2c describe a `/internal/{start,admit,leave,drain,healthz,ended}` contract and a `matchd` stub; the Rust server uses `/control/*`. Update the docs to the implemented endpoints.
5. Build: `cargo build --release -p rh-server`; `go build ./...` (Go toolchain pinned in the Dockerfile); image builds for linux/amd64 and linux/arm64 (verify cgo is not required for arm64: evaluation lists this as UNVERIFIED).
6. Staging (only when authorised): execute each numbered step of `STAGING_EXPERIMENT.md`, fill section 13's pass/fail table with real outputs, run section 14 teardown even on abort, and write the outcome (TLS reachability from a browser, home Region, scale-in protection, reconnect semantics, density) into `docs/hosting/` and an ADR 0004 amendment.

## Validation commands
`cargo test -p rh-server`, `cargo test --workspace`, `cargo clippy --workspace --all-targets`, `node tools/browser-proof/proof.mjs`, `go test ./...` and `go vet ./...` inside `hosting/glbridge` (to be created by this packet). AWS commands exist only inside `STAGING_EXPERIMENT.md` and need explicit authorisation.

## Risk and suggested model tier
Medium for (a)/(b) (plumbing, but a new trust boundary); high for (c) because it spends money and tests unverified claims.
Strong builder for (a)/(b); strongest model, high effort, with an owner on call for (c). Cost control: one Region pair, max 3 instances per location, tear down within 24 h.

## Known traps
- Never link a GameLift SDK into the Rust process; the bridge is the only AWS-aware code.
- The control API must never be reachable from the network; assert loopback in code and in the container (bind `127.0.0.1`).
- Admission order is protocol-visible (all refusals before a seat is taken); an admit-check must slot into the documented order (`docs/CONTRACTS.md` C-NET) without reordering existing checks.
- Container fleets issue no certificates (evaluation 3): the Rust process terminates TLS with our own certificate (`--tls-cert/--tls-key`, rustls); the wss URL must resolve to the placement's IP (P-HOST-2).
- Fleet instances are replaced about every 30 days and deployments wait for protected sessions (evaluation 1.8): matches last minutes, plan for it.
- Do not put credentials in files; the experiment doc uses `AWS_PROFILE` and a sandbox account only.
- `[verify: aws gamelift <cmd> help]` markers in the experiment doc are unconfirmed command names: check each before running.
