# GameLift: verified facts, 2026-11-05

Read on **2026-11-05** from AWS's own documentation (pages named below) and from the official Go server SDK source at tag
`v5.6.0` (cloned and read locally). It supersedes the unverified or wrong statements in
[GAMELIFT_EVALUATION.md](GAMELIFT_EVALUATION.md) (research of 2026-11-04); those are corrected in place with a pointer here.
Nothing was run against AWS (no credentials, none requested). `UNVERIFIED` means not confirmed from a primary source today;
it is never a guess dressed as a fact. DG = `https://docs.aws.amazon.com/gameliftservers/latest/developerguide/`,
API = `https://docs.aws.amazon.com/gameliftservers/latest/apireference/`. AWS pages change; re-read before spending money.

## 1. Verdict

GameLift stays the **provisional** choice (ADR 0004). One of its premises is wrong and is corrected (section 3): a GameLift
server process hosts exactly **one** game session, so "several matches per process" (ADR 0004 item 4) cannot be done with
GameLift's session model. Packing is recovered by many one-room processes per instance, at a measurable memory cost
(section 3.3). Nothing found today argues for a competing platform; the staging gates (TLS, ca-central-1 as a container
fleet home, protection behaviour, density) are still open.

## 2. Managed container fleets: status and model

- Container fleets are a current, documented fleet type: "A container fleet is a collection of Amazon EC2 instances to host your
  containerized game servers" run through Amazon ECS under the hood
  ([DG containers-howitworks](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-howitworks.html)).
  The API reference pages read today (`CreateContainerFleet`, `UpdateContainerFleet`) carry no preview wording. The GA date
  itself: UNVERIFIED (not stated on those pages).
- Instance OS: Amazon Linux 2023 only ("Container fleets are deployed with Amazon Linux 2023",
  [API CreateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html)).
- The fleet's AMI cannot be updated; AWS recommends replacing managed fleets every 30 days (same page and `UpdateContainerFleet`).
- A game server container group has one game server container (automatically essential: if it fails the whole group restarts)
  plus optional support containers; a per-instance group is optional
  ([DG containers-howitworks](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-howitworks.html)).
  Whether a support container may call the Server SDK: UNVERIFIED (not needed: the bridge is the game server container's
  entrypoint, and rh-server is its child, so both live in the one essential container).

## 3. One process, one game session: the documented tension, resolved

### 3.1 Evidence (all four agree)

1. Placement: GameLift "searches those fleets for an active server process that's not hosting a game session" and, on
   choosing one, "changes the server process's number of game sessions to `1`"
   ([DG gamelift-sdk-interactions](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-interactions.html)).
2. Capacity unit: "Each game server process running on an instance represents the capacity to host one game session";
   `[Game sessions per instance] = [# of game server processes per game server container] * [# of game server container groups per instance]`
   ([DG containers-scaling](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-scaling.html)).
3. End: `ProcessEnding()` makes GameLift set "the game session status to `TERMINATED`" and "the server process status to
   `TERMINATED`", and "to recycle and refresh hosting resources, shut down each server process after the game session is
   complete" ([DG gamelift-sdk-server-api](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-server-api.html),
   [interactions](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-interactions.html)). `ProcessReady()` "should be called
   only one time per process".
4. The SDK itself: Go SDK `v5.6.0` keeps one package-level state with a single `gameSessionID` string
   (`server/server_state.go`); `AcceptPlayerSession(id)`, `RemovePlayerSession(id)` and `ActivateGameSession()` take no
   game-session argument and use that one id; `GetGameSessionID()` "retrieves the ID of the game session hosted by the active
   server process" and returns an empty string for an idle process.

### 3.2 Process reuse is not documented for managed fleets

`Destroy()` documents reuse only for Anywhere fleets: "If you're using an Anywhere fleet and you're not terminating server
processes after every game session, call `Destroy()` and then `InitSDK()` to reinitialize before ... `ProcessReady()`"
([DG Go actions](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/integration-server-sdk-go-actions.html)).
For managed (EC2 or container) fleets the documented model is exit after the session. **Process reuse on managed fleets is
UNVERIFIED and this project does not rely on it.** The bridge ends the process after its one session.

### 3.3 How packing survives: one room per process, many processes per instance

Proposal, adopted by the bridge and the control contract: each game server container group runs `glbridge` + `rh-server
--max-rooms 1`; the fleet sets `GameServerContainerGroupsPerInstance` to N. GameLift replaces an ended group with a fresh
one, so a host keeps N match slots and never allocates a VM per match.

What it costs (a measurement and the platform's documented overheads; not a production sizing):

- **Measured** (this branch, Docker, aarch64 Debian bookworm, `rh-server` built `--release --features postgres`, idle with
  no room, `--max-rooms 1`): VmRSS **5.7 MB** (/proc/1/status), 19 threads, binary 8.1 MB stripped. RSS with a running
  8-player match: UNMEASURED (needs the load harness, P-LOAD-1). `glbridge` RSS: UNMEASURED (static Go binary, 6.5 MB).
- **Documented platform overhead** (DG containers-design-fleet): memory reserve 8% of a `.large`
  (c5/c6i/c7i/c9g.large: 4,096 MiB total, **3,768 MiB** available to groups); logging adds **50 MiB per game server container
  group** for the log router; the per-group `TotalMemoryLimitMebibytes` is the unit packed. Groups per `.large` by memory,
  `floor(3768 / (limit + 50))` with logging, `floor(3768 / limit)` without (arithmetic from those formulas):

  | per-group limit (MiB) | with logging | without logging |
  |---|---|---|
  | 96 | 25 | 39 |
  | 128 | 21 | 29 |
  | 192 | 15 | 19 |
  | 256 | 12 | 14 |
  | 512 | 6 | 7 |

  Not memory but vCPU is likely to bind first: a `.large` has 2 vCPU; the documented `TotalVcpuLimit` floor is 0.125 vCPU
  (evaluation 1.2, from the `CreateContainerGroupDefinition` reference; not re-read today), i.e. at most 16 capped groups.
  CPU bursting (omit `TotalVcpuLimit`, set a container `Vcpu`) lets idle groups lend CPU. The real limit comes from the
  match's CPU and memory, which are UNMEASURED for the full game; do not size a fleet from this table.
- The 50 MiB-per-group log router is the largest fixed cost per group for a 5.7 MB process. Option to evaluate **after**
  staging proves the basic path: several game server processes inside one container group (documented: "If you opt to build a
  container architecture that runs multiple game server processes in each game server container group", with the
  GameLift Agent or own supervision, [DG containers-howitworks](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-howitworks.html)).
  Each process still hosts one session and has its own SDK initialisation (so its own `glbridge` OS process; the SDK state is
  package-global) and its own container port. That would share one log router across K processes. Whether the Agent fits a
  custom bridge, and how process ids are provisioned, are UNVERIFIED.
- The general quota "Server processes per instance (Server SDK v3 and up): 50, not adjustable" is listed under
  [General Reference quotas](https://docs.aws.amazon.com/general/latest/gr/gamelift.html); whether it binds container fleets
  (the container API allows up to 5,000 groups per instance): UNVERIFIED. At 8 to 25 groups per instance it does not bind.

Rejected: keeping several matches in one process and presenting them to GameLift as one "game session" (it makes
`PercentAvailableGameSessions`, player-slot accounting and scale-in protection describe the wrong thing, and we would
rebuild placement ourselves: a competing design).

## 4. Official Go server SDK

- Repo `github.com/amazon-gamelift/amazon-gamelift-servers-go-server-sdk`; **module path
  `github.com/amazon-gamelift/amazon-gamelift-servers-go-server-sdk/v5`**. The module proxy lists tags `v5.0.0` to
  **`v5.6.0`** (latest; tag commit `dffb2a48`, 2026-08-04 per git log; `https://proxy.golang.org/.../v5/@v/list`). The un-suffixed
  path only has a 2025-05-27 pseudo-version; do not use it. Release notes: 5.6.0 raises the minimum Go to **1.25** and adds
  `ListContainersNetworkInfo()`.
- **cgo: not required.** `grep` finds no `import "C"` in the module; its dependencies are `gorilla/websocket`, `datadog-go`,
  `uuid`, `go-retry` (pure Go). This branch builds `glbridge` with `CGO_ENABLED=0` for `linux/arm64` (native) and
  `linux/amd64` (emulated); the Dockerfile fails the build if the binary is not `CGO_ENABLED=0`.
- Platforms: the SDK README names no OS/architecture matrix. It compiles for linux/arm64 and linux/amd64 here; behaviour on
  a real GameLift Graviton host: UNVERIFIED (staging).
- `InitSDK(ServerParameters)` (the evaluation's "no parameters" is the docs' wording; the Go signature takes a struct):
  managed EC2 and container fleets pass an empty struct (`InitSDKFromEnvironment()` does that). The source resolves the
  agent connection from `GAMELIFT_SDK_*` environment variables and, for container compute, fetches credentials from the
  container discovery endpoint (`GAMELIFT_CONTAINER_DISCOVERY_SERVER_ENDPOINT`). Outside GameLift it fails with "Either
  AuthToken or AwsRegion and AwsCredentials are required" (observed by running the image).
- Server-side calls used: `ProcessReady`, `ActivateGameSession`, `AcceptPlayerSession`, `RemovePlayerSession`,
  `DescribePlayerSessions` (status filter, paging), `GetTerminationTime`, `ProcessEnding`, `Destroy`. Present in v5.6.0.
- `GetTerminationTime()` is documented inconsistently (Go doc comment: epoch seconds; the AWS page: .NET ticks since 0001).
  The bridge decodes both.

## 5. Server process lifecycle

Order ([DG sdk-server-api](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-server-api.html),
[interactions](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-interactions.html)):
`InitSDK` -> `ProcessReady({Port, OnStartGameSession, OnProcessTerminate, OnHealthCheck[, OnUpdateGameSession]})` -> process
status `ACTIVE` -> `OnStartGameSession(GameSession)` (session `ACTIVATING`) -> `ActivateGameSession` (`ACTIVE`) ->
`AcceptPlayerSession` / `RemovePlayerSession` -> `ProcessEnding` -> `Destroy` -> exit; GameLift marks session and process
`TERMINATED`. Container fleets need no log paths: stdout/stderr is captured.

- **Health:** `OnHealthCheck` optional; must answer within 60 s; "three consecutive health checks" unhealthy or silent: the
  service "might shut down the process and start a new one" (DG). SDK `v5.6.0` source defaults: interval 60 s with up to
  10 s jitter, timeout 50 s (`common/consts.go`), overridable by environment.
- **Terminate:** `OnProcessTerminate` fires for persistent ill health, scale-down, or Spot interruption (2-minute notice per
  DG). The SDK doc comment says GameLift waits **five minutes** for `ProcessEnding` after the callback, then ends the process.
  Both bounds are in the bridge (`--drain-deadline` 4 m 30 s, and `GetTerminationTime` minus a margin).
- `ProcessEnding` with a non-zero exit code is recorded as `SERVER_PROCESS_TERMINATED_UNHEALTHY` (Go actions page).

## 6. Player sessions

- `StartGameSessionPlacement` with `DesiredPlayerSessions` (`PlayerId` + `PlayerData`) creates one player session per
  player, status `RESERVED`; the placement result carries `PlacedPlayerSessions` ([API StartGameSessionPlacement](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_StartGameSessionPlacement.html)).
- `AcceptPlayerSession` validates the id and moves `RESERVED` -> `ACTIVE`; `RemovePlayerSession` -> `COMPLETED` and reopens
  the slot. Unaccepted reservations become `TIMEDOUT` after the **player session timeout, default 60 s, adjustable**;
  "the server SDK doesn't notify the game server when a player session times out" ([interactions](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-interactions.html),
  [quotas](https://docs.aws.amazon.com/general/latest/gr/gamelift.html)). Statuses: `RESERVED | ACTIVE | COMPLETED | TIMEDOUT`
  ([API PlayerSession](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_PlayerSession.html)). 200 player sessions
  per game session (fixed). Player sessions are retained 30 days after the session ends.
- **The server is never told which player sessions were created.** It learns an id only if the client presents it, or by
  asking (`DescribePlayerSessions`). That is why the control contract has the bridge list `RESERVED` sessions and pre-admit
  them (CONTROL_API.md section 4) instead of carrying the player-session id through the browser's Hello.
- **Reconnect** (a second `AcceptPlayerSession` for an `ACTIVE` session): UNVERIFIED, and not needed. Our 16-byte resume
  token is authoritative; `RemovePlayerSession` only after the server's grace expires.
- Rate limits of `DescribePlayerSessions` from the server SDK: UNVERIFIED; the bridge polls at 1 s and the cadence is a flag.

## 7. Queues and latency inputs

- `PlayerLatencies` (`PlayerId`, `RegionIdentifier`, `LatencyInMilliseconds`): GameLift averages each location over all
  players in the request and reorders the queue's locations lowest first; it cannot be combined with
  `PriorityConfigurationOverride` (`InvalidRequestException`). `PriorityConfigurationOverride` needs a queue that prioritises
  by location and a `PlacementFallbackStrategy`. `PlacementId`: unique across Regions, never reused, <= 48 chars
  ([API](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_StartGameSessionPlacement.html)).
  A queue lives in one Region, up to 10 destinations, 100 queues per Region ([quotas](https://docs.aws.amazon.com/general/latest/gr/gamelift.html)).
- AWS now points to **UDP ping beacons** (`gamelift-ping.<region>.api.aws:7770`; includes `ca-central-1`, `us-west-2` and
  the Denver, Los Angeles and Phoenix Local Zones). Browsers cannot send UDP, so they stay unusable for this game; our HTTPS
  probe against the game process remains the plan ([LATENCY_PROBES.md](LATENCY_PROBES.md)).

## 8. Scale-in protection, deployments

- `NewGameSessionProtectionPolicy` `NoProtection | FullProtection`: "Game sessions in `ACTIVE` status can't be shut down";
  applies to scale-down and unhealthy-instance retirement; per-session override via `UpdateGameSession`
  ([API CreateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html)).
  Applies to sessions started after the setting changes (`UpdateContainerFleet`: "Game sessions that already exist are not affected").
- Deployment: a change to the game server group definition, group count, ports or logging starts a deployment that
  **replaces instances**; one active deployment at a time (a second cancels the first). `DeploymentConfiguration`:
  `ProtectionStrategy` (`WITH_PROTECTION` = "safe deployment": instances with active sessions wait),
  `MinimumHealthyPercentage`, `ImpairmentStrategy` (`ROLLBACK` or keep impaired for debugging)
  ([API UpdateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_UpdateContainerFleet.html),
  [DG containers-howitworks](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-howitworks.html)).
- Whether scale-in prefers the emptiest instance: UNVERIFIED (measure; this decides how well one-room processes pack).

## 9. Locations

[DG gamelift-regions](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-regions.html), table read today:

| Location | Home, single-location | Home, multi-location | Remote location | Queue |
|---|---|---|---|---|
| us-west-2 | yes | yes | yes | yes |
| ca-central-1 | **yes** | **no** | yes | yes |
| ca-west-1 | **not listed** | no | no | no |
| us-west-2-den-1, -lax-1, -phx-1, -phx-2 | no | no | yes (opt-in) | no |

- `CreateContainerFleet`: "You can create a container fleet in any AWS Regions that Amazon GameLift Servers supports for
  multi-location fleets. A container fleet can be deployed to a single location or multiple locations", and `Locations`
  "also include the fleet's home Region". The two sentences read together leave it **UNVERIFIED** whether a container fleet may
  have ca-central-1 as its (single-location) home; the managed-fleet table allows it, the container page names multi-location
  homes. Staging step 3 (evaluation) decides. ca-central-1 as a **remote location** of a us-west-2 container fleet is
  allowed by the table. **So today: ca-central-1 = remote location (certain) or single-location home (UNVERIFIED for
  containers); ca-west-1 = not available.**
- A newer "player gateway" (relay, DDoS) exists; its home Regions are the multi-location ones (not ca-central-1) and its
  transport support for browser WebSocket is UNVERIFIED. Not planned.

## 10. Architectures and instance types

- "Make sure to use an image with the same architecture as the Instance type you are planning to use on your fleets" (Dockerfile
  template, [DG containers-prepare-images](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-prepare-images.html)).
- The memory table lists Intel/AMD (c5, c6i, c7i, c8i, c8a, m*, r*) and Graviton (`c9g`, `m9g`) types; **c6g/c7g are absent
  from today's table** (it lists "commonly used" types and gives the formula for others). Availability per location comes
  from the console (Instance and service quotas); UNVERIFIED for c7g/c9g in us-west-2 and ca-central-1 for containers.
  This branch builds linux/arm64 and linux/amd64 images (hosting/README.md); run the one matching the instance type.
- Port rules: `InstanceConnectionPortRange` and `InstanceInboundPermissions` default to **UDP**; for our WSS (TCP) game both
  must be set by hand, "you must set both fields to avoid undefined behavior", and GameLift then stops managing them. The
  container port is chosen from `ContainerPortRanges` in the group definition; one port per concurrent process.

## 11. TLS for browsers

Unchanged and re-verified: the `CreateContainerFleet` request syntax has **no** `CertificateConfiguration`. The SDK doc says
`GetComputeCertificate` works "When using an Amazon GameLift Servers managed fleet" and the interactions doc speaks of "a fleet
that has TLS certificate generation activated", but a container fleet cannot request it. Plan stays: our own certificate in the
Rust process, one DNS name per placement; a TLS-enabled fleet's `DnsName` (`<id>.<region>.amazongamelift.com`) is not
available to us. `GetComputeCertificate` on a container fleet: UNVERIFIED (staging).

## 12. Quotas ([General Reference](https://docs.aws.amazon.com/general/latest/gr/gamelift.html), today)

Player session timeout 60 s (adjustable); player sessions per game session 200 (fixed); game session queues 100/Region; queue
destinations 10; locations per fleet 10 (adjustable); server processes per instance 50 (fixed; container applicability
UNVERIFIED). **Container fleets per Region, container group definitions and instances per fleet are not in that table**:
UNVERIFIED (read them from Service Quotas before staging).

## 13. Not re-verified today (carry as UNVERIFIED)

Pricing (current per-hour rates for the chosen instance type in the chosen Region), scale-to-zero behaviour, `ca-central-1`
instance-type availability, GameLift API rate limits for `StartGameSessionPlacement`, the exact fleet-role trust policy. Do
not size or budget from the evaluation's cost table.

## 14. Corrections made to earlier documents (2026-11-05)

- ADR 0004 item 4 "several matches per process": wrong for GameLift; see its amendment.
- GAMELIFT_EVALUATION 1.3 "Processes per instance", 2c bridge contract (`/internal/*`), 1.9 reconnect: corrected or annotated.
- STAGING_EXPERIMENT 0, 6, 7, 8: `/internal/*` and `matchd` replaced by the implemented contract `/control/*`
  ([CONTROL_API.md](CONTROL_API.md)) and the `rh-server` + `glbridge` image; steps that assumed several matches per process
  annotated. The step list and pass/fail table stay NOT RUN.
