# Amazon GameLift Servers (managed containers + queues) evaluation

> **Corrected 2026-11-05 (P-CLAUDE-INFRA-1).** Facts were re-read from AWS's documentation and the Go SDK source in
> [GAMELIFT_VERIFIED.md](GAMELIFT_VERIFIED.md), which wins wherever the two differ. Corrections made in this file: one
> game server process hosts exactly one game session (1.3, 2c); the bridge contract is the implemented `/control/*` API of
> [CONTROL_API.md](CONTROL_API.md), not the `/internal/*` names originally proposed (2c); the Go SDK module is `.../v5`,
> `v5.6.0`, no cgo (2c); ca-central-1 is a home Region only for single-location managed fleets (4.1). Sections not named
> here (pricing, ECS comparison, quotas) were NOT re-verified and keep their UNVERIFIED labels.

Status: research only. Nothing here was run against AWS (no credentials in this environment).
Research date: 2026-11-04. All docs were fetched on that date; AWS pages change, so re-check before committing money.
Convention: every claim has a URL. `UNVERIFIED` = not confirmed from a primary source in this pass.
The 200 matches / 1,600 players figure is a sizing assumption, not a measurement and not spending authorization.

Doc base used below (abbreviated as DG = `https://docs.aws.amazon.com/gameliftservers/latest/developerguide/`, API = `https://docs.aws.amazon.com/gameliftservers/latest/apireference/`).

## 0. Recommendation (short)

1. Use GameLift managed **container fleets + a multi-location game session queue** as the first candidate. It gives placement, latency-aware ordering, session-level scale-in protection, target-tracking autoscaling and rolling deployments without us building them.
2. Bridge the Rust sim to GameLift with a **small Go supervisor in the same container** (official Go Server SDK), talking to the Rust process over localhost. Keep the SDK out of the simulation. The official wrapper is a useful day-1 spike but lacks player sessions and TLS certificate retrieval.
3. **Do not plan on GameLift-issued TLS for container fleets.** The container fleet API has no certificate setting (see 3). Plan for our own wildcard cert on the Rust process plus a per-placement Route 53 record, and verify in staging.
4. **Do not use GameLift's UDP ping beacons from the browser.** Deploy tiny HTTPS latency endpoints in each Region ourselves and feed the numbers into `PlayerLatencies`.
5. ca-west-1 (Calgary) is **not** a GameLift location. Western Canada is served from us-west-2 (and us-west-2 Local Zones), with ca-central-1 as a remote location. Home-region rules for container fleets need a staging check.
6. Fall back to ECS-on-EC2 only if staging shows a blocker (TLS, ports, or per-process density). It means building placement, session registry, latency routing and scale-in protection ourselves (section 6).

## 1. Managed container fleets

### 1.1 Status and model
- Container fleets are a documented, first-class fleet type: "A container fleet is a collection of Amazon EC2 instances to host your containerized game servers", managed by GameLift, using Amazon ECS under the hood. [DG containers-howitworks](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-howitworks.html)
- Older API pages still say the containers feature is "in public preview" ([CertificateConfiguration](https://docs.aws.amazon.com/gamelift/latest/apireference/API_CertificateConfiguration.html)); current developer-guide pages carry no preview banner and offer a starter kit and engine plugins. Exact GA date: UNVERIFIED. Treat as GA but confirm in the console.
- Container fleets run Amazon Linux 2023 only (`OperatingSystem` valid value `AMAZON_LINUX_2023`). [API CreateContainerGroupDefinition](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerGroupDefinition.html), [API CreateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html)
- A managed fleet's AMI cannot be updated; AWS recommends replacing fleets every 30 days. [API UpdateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_UpdateContainerFleet.html) This is an operational cost: plan a blue/green fleet swap through the queue.

### 1.2 Container group definition (CGD), game server container
- Two group types: `GAME_SERVER` (replicated per instance) and optional `PER_INSTANCE` (one per instance). A game server group has exactly one game server container and up to 8 support containers; a per-instance group up to 10 support containers. [API CreateContainerGroupDefinition](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerGroupDefinition.html)
- The game server container is automatically essential; if it fails the whole group restarts. Support containers can be essential and can have docker-style health checks (`Command`, `Interval`, `Timeout`, `Retries`, `StartPeriod`). [DG containers-design-fleet](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-design-fleet.html)
- Required for a game server CGD: `Name`, `ContainerGroupType`, `OperatingSystem`, `TotalMemoryLimitMebibytes`, either `TotalVcpuLimit` or a container `Vcpu`, and a `GameServerContainerDefinition` with `ContainerName`, `ImageUri` (ECR), `PortConfiguration`, and `ServerSdkVersion`. `TotalVcpuLimit` range 0.125 to 10. `EnvironmentOverride` is supported. [API CreateContainerGroupDefinition](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerGroupDefinition.html)
- The game server inside must be integrated with the Server SDK ("Before starting these tasks, finish integrating your game server code with the Amazon GameLift Servers server SDK"). [DG containers-prepare-images](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-prepare-images.html) The wrapper (2b) is the documented exception.
- Container stdout/stderr is captured; log to stdout instead of SDK log paths; destination CloudWatch (default), S3 or none. [DG containers-howitworks](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-howitworks.html)

### 1.3 Processes per instance
- Capacity unit: one game server process = one game session. `Game sessions per instance = processes per game server container x game server container groups per instance`. [DG containers-scaling](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-scaling.html)
- Simplest layout: one container, one process, N replicas of the group per instance. This maps cleanly to "one Rust process hosts one match".
- **Correction (2026-11-05): this is the only supported layout, not just the simplest.** GameLift places one game session on a server process that "is not hosting a game session" and counts the process as one session of capacity; the Go SDK holds a single game-session id per process (evidence in [GAMELIFT_VERIFIED.md](GAMELIFT_VERIFIED.md) section 3). ADR 0004's "several matches per process" is replaced by `rh-server --max-rooms 1` per container group, N groups per instance, with the memory cost worked out there.
- `GameServerContainerGroupsPerInstance`: 1 to 5000; default is the calculated maximum; a manual value is honored only if below the calculated maximum. [API CreateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html)
- The calculated maximum is `min(vCPU fit, memory fit, connection-port fit)`; memory reserve is 8% under 5,000 MiB, 6% to 9,999, 5% to 89,999; logging adds 50 MiB per group. c5.large/c6i.large/c7i.large: 4,096 MiB total, 3,768 MiB available; c9g.large 3,768; c5.xlarge/c6i.xlarge 7,700. [DG containers-design-fleet](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-design-fleet.html)
- Without `TotalVcpuLimit` a group can burst into idle instance CPU (needs a per-container `Vcpu`). Same page.
- The older "50 server processes per instance" quota is for Server SDK v3+ on EC2 fleets ([General Reference quotas](https://docs.aws.amazon.com/general/latest/gr/gamelift.html)); whether it binds container fleets: UNVERIFIED (the container API allows up to 5000 groups).

### 1.4 Instance types and architectures
- "Amazon GameLift Servers supports a wide range of Amazon EC2 instance types, all of which are available for use with a container fleet"; availability and price vary by location; list per location is in the console (Instance and service quotas). Default type is c5.large. [DG containers-design-fleet](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-design-fleet.html), [API CreateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html)
- Graviton (arm64) is supported with a hard rule: images must match the instance architecture or deployment fails ("make sure the container images ... are built for ARM"). The Dockerfile template says the same. [DG containers-prepare-images](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-prepare-images.html); the arm64 deployment-fails wording was returned by a search summary of the DG container-fleet pages and a China-region UE5 blog; re-confirm the exact sentence in the console. c7g.* and c6i.* appear in the compute `Type` enum ([API Compute](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_Compute.html)); c9g/m9g appear in the container memory table. Whether c7g.large is offered in a given Region for containers: UNVERIFIED (check the console list per Region).
- Instance type cannot be changed after fleet creation, and for multi-location fleets it must exist in every location. [API CreateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html)

### 1.5 Ports
- Each container declares `ContainerPortRanges` (FromPort, ToPort, Protocol); a game server container needs one port per concurrent process. The fleet has an `InstanceConnectionPortRange` (external) that GameLift maps to container ports; mapping is visible via `DescribeContainerGroupPortMappings`. [DG containers-design-fleet](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-design-fleet.html)
- Defaults: connection range starts at 4192 (4092-4191 reserved); **default inbound permissions protocol is UDP** in the API docs. For a WSS (TCP) game we must set `InstanceConnectionPortRange` and `InstanceInboundPermissions` manually, both fields, TCP, and the docs warn GameLift then stops managing either. Minimum ports = container ports x groups per instance (+ per-instance ports); double it as a best practice. If ports are scarce GameLift deploys fewer groups. [DG containers-design-fleet](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-design-fleet.html), [API CreateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html)
- The client gets `IpAddress`, `DnsName` and `Port` back from placement. [API StartGameSessionPlacement](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_StartGameSessionPlacement.html) The port is the connection port, not the container port (container-port selection by the process: UNVERIFIED; staging step checks that a fixed container port works in every replica).

### 1.6 Health
- Game server container health = SDK process health. `onHealthCheck` (optional) must answer within 60 s; no answer = unhealthy; three consecutive failures or no responses can cause the process to be ended and replaced. No callback = healthy unless unresponsive. [DG gamelift-sdk-server-api](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-server-api.html)
- Compute status: `PENDING|ACTIVE|TERMINATING|IMPAIRED`; a container-fleet compute is a container group. [API Compute](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_Compute.html)

### 1.7 Scaling and scale-in protection
- Capacity is per fleet location (min / desired / max); a new fleet starts with desired 1 per location. Manual or target tracking or rule-based. [DG containers-scaling](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-scaling.html)
- Target-based scaling keys on `PercentAvailableGameSessions`; policy is set at fleet level and each location scales independently; CLI: `aws gamelift put-scaling-policy --policy-type TargetBased --metric-name PercentAvailableGameSessions --target-configuration TargetValue=N`. [DG fleets-autoscaling-target](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/fleets-autoscaling-target.html)
- Scale-in protection: `NewGameSessionProtectionPolicy` = `NoProtection | FullProtection` ("Game sessions in ACTIVE status can't be shut down"), set on the fleet, per-session override via `UpdateGameSession`. It applies to scale-down and unhealthy-instance retirement. [API CreateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html) Spot interruption still gives only a 2-minute notice (SDK `onProcessTerminate`). [DG gamelift-sdk-server-api](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-server-api.html)
- Whether scale-in prefers emptiest instances (packing quality): UNVERIFIED. Measure in staging.
- Scaling from/to zero has its own page ([DG fleets_scale-to-from-zero](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/fleets_scale-to-from-zero.html)); not read in detail.

### 1.8 Deployments
- `UpdateContainerFleet` with a new CGD version, port change, groups-per-instance change, logging change starts a deployment that **replaces instances**. Only one deployment active; a second cancels the first. `DeploymentConfiguration`: `ProtectionStrategy` (example `WITH_PROTECTION`; docs say protect instances with active sessions "safe deployment" vs unsafe), `MinimumHealthyPercentage`, `ImpairmentStrategy` (example `ROLLBACK`; or keep impaired for debugging). [API UpdateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_UpdateContainerFleet.html), [DG containers-howitworks](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-howitworks.html)
- Consequence: a rollout waits for matches to finish (up to the 10-20 min a match lasts). Test with a long session in staging.

### 1.9 Session lifecycle (server side)
Verified sequence ([DG gamelift-sdk-server-api](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-server-api.html), [Go SDK actions](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/integration-server-sdk-go-actions.html)):
1. `InitSDK()` with no parameters on managed fleets (the agent is local), then `ProcessReady(ProcessParameters{Port, OnStartGameSession, OnProcessTerminate, OnHealthCheck, OnUpdateGameSession})`, called once per process.
2. Placement (or `CreateGameSession`) makes GameLift call `onStartGameSession(GameSession)`; the game initializes and calls `ActivateGameSession()` -> session `ACTIVE`.
3. Clients connect with a player-session ID; server calls `AcceptPlayerSession(id)` (slot RESERVED -> ACTIVE) and `RemovePlayerSession(id)` on disconnect. `UpdatePlayerSessionCreationPolicy`, `DescribePlayerSessions`, `GetTerminationTime` also exist.
4. End: `ProcessEnding()` then exit. "To recycle and refresh hosting resources, shut down each server process after the game session is complete." GameLift starts a fresh process/group.
5. `onProcessTerminate` fires on persistent unhealthiness, scale-down, or Spot interruption; the server calls `ProcessEnding`.
- Player sessions: quota 200 per game session; reserved sessions time out after 60 s by default (adjustable). [General Reference](https://docs.aws.amazon.com/general/latest/gr/gamelift.html)
- Reconnect semantics (re-`AcceptPlayerSession` for an already ACTIVE player session): UNVERIFIED (still, 2026-11-05; the bridge never re-accepts: the Rust resume token is authoritative, see CONTROL_API.md section 5). Staging step tests it; fallback is our own reconnect token inside the Rust process, and treating GameLift player sessions as admission only.
- Container-only helper: `ListContainersNetworkInfo()`. Same Go SDK page.

## 2. Rust integration

Official server SDK languages: C++, C#, Go, Unreal (C++). No Rust. [DG gamelift-sdk-server-api](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-server-api.html) SDK repos live under `github.com/amazon-gamelift` ([announcement](https://aws.amazon.com/about-aws/whats-new/2025/05/amazon-gamelift-sdks-github)). A Rust crate by AWS: none found (UNVERIFIED negative; check crates.io before building).

| Option | What it is | Verdict |
|---|---|---|
| (a) Game server wrapper | Go program; launches your executable per game session; args via templates | Good spike, not final (see below) |
| (b) C++ SDK via FFI | link C++ SDK (CMake, OpenSSL, GCC 4.9+, Apache-2.0) from Rust | Possible; puts a C++ build and FFI callbacks into the sim process; Linux arm64 build not documented in the README ([repo](https://github.com/amazon-gamelift/amazon-gamelift-servers-cpp-server-sdk)) |
| (c) Go sidecar/supervisor | Go SDK in a small binary, localhost API to Rust | **Recommended** |
| (d) Reimplement wire protocol | SDK talks to the service over TLS WebSocket; protocol not documented in the README | Do not; undocumented |

### 2a. Game server wrapper (Go)
Source: [repo README](https://github.com/amazon-gamelift/amazon-gamelift-servers-game-server-wrapper), [tutorial](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-wrapper-tutorial.html), [launch note](https://aws.amazon.com/about-aws/whats-new/2025/03/amazon-gamelift-servers-game-wrapper-rapid-onboarding).
- Runs an unmodified build on Anywhere, managed EC2 and managed container fleets; "When the wrapper receives a signal to create a game session, it will start the server executable automatically" (one executable launch per game session); calls ProcessEnding when the game ends.
- Session info reaches the binary as **command-line arguments only** via `config.yaml` templates: `GamePort` (`ContainerPort` on containers), `IpAddress`, `GameSessionId`, `GameSessionName`, `FleetId`, `MaximumPlayerSessionCount`, `GameProperties`, `MatchmakerData`, `LogDirectory`.
- Unsupported: AcceptPlayerSession, RemovePlayerSession, DescribePlayerSessions, UpdatePlayerSessionCreationPolicy, GetGameSessionId, GetTerminationTime, **GetComputeCertificate**, GetFleetRoleCredentials, custom callbacks. FlexMatch backfill "not recommended". Containers: Linux only, single-architecture image matching the instance.
- Positioning from AWS: "intended for evaluation and basic production use"; detailed player session management needs a full SDK integration.
- Health checks and SIGTERM behavior of the wrapper: UNVERIFIED (README does not say).
- Use: day-1 smoke test of allocation and placement with zero SDK code; admission would use our own signed join token carried in `GameProperties`/`GameSessionData`, so GameLift would not know player counts (affects `PercentAvailableGameSessions`? no: that metric counts sessions, not players; matchmaking slot logic would not apply).

### 2c. Recommended bridge: Go supervisor in the game server container (implemented: `hosting/glbridge/`)
```
GameLift agent <-> [glbridge (Go, SDK v5.6.0)] <-loopback HTTP, /control/*-> [rh-server (Rust)] <-WSS-> browsers
```
- One image, `ENTRYPOINT glbridge`. glbridge: `InitSDK`, launch `rh-server --max-rooms 1 --require-admit --control 127.0.0.1:<port>`, wait for `/control/health`, `ProcessReady(port)`.
- `OnStartGameSession(gs)`: `POST /control/session` (idempotent); only then `ActivateGameSession()`. A refused session (409 draining or at capacity) is never activated.
- Players: the bridge lists the session's `RESERVED` player sessions and `POST /control/admit {playerSessionId, callsign}`; the player's Hello still carries the profile token, checked unchanged, and the admit is an additional precondition (CONTROL_API.md section 4). When `GET /control/rooms` shows the player `seated` the bridge calls `AcceptPlayerSession` once; when it shows `left` (after the server's reconnect grace) it calls `RemovePlayerSession` and acknowledges with `POST /control/leave`.
- `OnProcessTerminate`: `POST /control/drain`; wait for the room to close (bounded by the termination time); `ProcessEnding()` + `Destroy()` + exit.
- `OnHealthCheck`: `GET /control/health` (a draining 503 is reported healthy).
- Match end: room `closed` in `/control/rooms` -> drain -> `ProcessEnding` -> exit; GameLift replaces the group. A process never hosts a second session.
- Keeps all AWS types out of the simulation crate; rh-server only knows the loopback contract, testable without AWS (`hosting/glbridge` tests use a fake SDK and a fake control server).
- Built here: Go SDK `.../go-server-sdk/v5` `v5.6.0` needs no cgo and builds for linux/arm64 and linux/amd64 (GAMELIFT_VERIFIED.md section 4). Still UNVERIFIED: running on a real Graviton GameLift host, and the SDK inside a support container (not needed).

## 3. TLS and DNS for browsers (wss://)

What is verified:
- Classic fleets: `CertificateConfiguration { CertificateType: GENERATED | DISABLED }` at creation; "All instances in a fleet share the same certificate"; fetch via `GetInstanceCertificate` (older) / `GetComputeCertificate`; cannot change after creation; unsupported Regions return 4xx. [API CertificateConfiguration](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CertificateConfiguration.html), [CreateFleet cli](https://docs.aws.amazon.com/cli/latest/reference/gamelift/create-fleet.html)
- Realtime docs say a TLS-enabled fleet also gets a per-instance DNS entry matching the cert. [Realtime fleets](https://docs.aws.amazon.com/gameliftservers/latest/realtimeguide/realtime-fleets-creating.html) (via search summary)
- `GetComputeCertificate` returns a path with `certificate.pem`, `certificateChain.pem`, `rootCertificate.pem`, `privateKey.pem` "when using an Amazon GameLift Servers managed fleet". [Go SDK actions](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/integration-server-sdk-go-actions.html)
- **`CreateContainerFleet` has no `CertificateConfiguration` parameter** (its full request syntax lists none). [API CreateContainerFleet](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html) A re:Post thread reports `GetComputeCertificate` returning a Bad Request on a managed container fleet and "limited documentation" ([re:Post](https://repost.aws/questions/QUQ_LI9tW8QHKH6vn7Jp5zAA/gamelift-managed-containers-and-certificates); page returned 403 to our fetcher, content seen only via a search summary).
- The `Compute` object has a `DnsName` ("GameLift requires a DNS name or IP address for a compute"); placement results return `DnsName`. Its format for container computes and whether any certificate matches it: UNVERIFIED.
- The wrapper cannot call `GetComputeCertificate`. [README](https://github.com/amazon-gamelift/amazon-gamelift-servers-game-server-wrapper)

Conclusion: assume **no GameLift-issued cert for container fleets** until the staging experiment (step 9) proves otherwise.

Alternatives, in order of preference:
1. **Own wildcard cert + Route 53 record per placement.** Wildcard `*.play.example.com` (ACME DNS-01, regional prefixes like `*.usw2.play.example.com`). The Rust process terminates TLS on its container port. On `FULFILLED` placement the backend UPSERTs `m-<placementId>.usw2.play.example.com A <IpAddress> TTL 30` and returns that URL plus the connection port. Cert/key delivery to the container: Secrets Manager via fleet role credentials (`GetFleetRoleCredentials` in the SDK; not in the wrapper) or baked env at deploy. Risk: the private key sits on every compute; use short-lived certs (<=90 d) rotated through fleet replacement (already needed every 30 d). Browsers accept `wss://host:4xxx` on non-443 ports.
2. **Edge proxy** (Envoy/NLB-ALB in each Region) terminating TLS and routing by path to GameLift IP:port: adds a hop, cost and a router to maintain; target IPs are the GameLift-managed instances (private VPC reachability for container fleets: UNVERIFIED).
3. **Per-IP DNS** (`1-2-3-4.play.example.com` wildcard resolver) avoids Route 53 writes but needs a custom DNS service. Only if Route 53 write rate becomes a problem.
Route 53 change limits and propagation delay (TTL 30 s) add up to a few seconds of join latency; staging measures it.

## 4. Regions, latency placement

### 4.1 Locations
From [DG gamelift-regions](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-regions.html) (fetched 2026-11-04):
| Location | Single-loc home | Multi-loc home | Remote loc | Queue |
|---|---|---|---|---|
| us-west-2 | yes | yes | yes | yes |
| ca-central-1 | yes | **no** | yes | yes |
| ca-west-1 | **not listed** | no | no | no |
| us-west-2-den-1, -lax-1, -phx-1, -phx-2 (Local Zones) | no | no | yes | no |
| us-east-1, eu-west-1, eu-central-1, ap-* (several) | yes | yes (7 listed incl. us-east-1) | yes | yes |
- `CreateContainerFleet` says it may be created "in any AWS Regions that Amazon GameLift Servers supports for multi-location fleets" ([API](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html)). Read strictly, a container fleet's **home** must be a multi-location home Region (us-west-2 for us), with ca-central-1 only as a remote location. Whether ca-central-1 can be a container-fleet home: UNVERIFIED -> staging step 3.
- Multi-location fleet: a home Region plus remote locations (Regions or Local Zones); capacity is set per location; limit 10 locations per fleet (adjustable). Instance type must exist everywhere. [DG gamelift-regions](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-regions.html), [quotas](https://docs.aws.amazon.com/general/latest/gr/gamelift.html)
- Local Zones and non-default Regions require opt-in and `ec2:DescribeRegions` in the admin policy. Same page.
- **2026-11-05:** the table above was re-read and holds: ca-central-1 is a home Region for *single-location* managed fleets (not multi-location) and a remote location; ca-west-1 is absent. Whether a *container* fleet may have ca-central-1 as home stays UNVERIFIED (the container API page ties container fleets to multi-location home Regions).
- Western Canada: nearest listed hosting is us-west-2 (Oregon) and its Denver/LA/Phoenix zones; ca-central-1 is Montreal. Real RTT: UNVERIFIED; measure from Calgary/Vancouver test clients (staging step 11).

### 4.2 Queues and latency
- A queue lives in one Region, processes placement there, and holds up to 10 destinations (fleet or alias ARNs), 100 queues per Region (adjustable). A multi-location queue is "required to use player latency data". [DG queues-design-multiregion](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/queues-design-multiregion.html), [quotas](https://docs.aws.amazon.com/general/latest/gr/gamelift.html)
- `create-game-session-queue`: `--player-latency-policies MaximumIndividualPlayerLatencyMilliseconds=,PolicyDurationSeconds=` (sliding caps, e.g. 100 ms for 60 s then 200 ms), `--destinations DestinationArn=...`, `--priority-configuration PriorityOrder=LATENCY,COST,DESTINATION,LOCATION,LocationOrder=...` (up to 4), `--filter-configuration AllowedLocations=...`, `--timeout-in-seconds`, `--notification-target` (SNS). [CLI](https://docs.aws.amazon.com/cli/latest/reference/gamelift/create-game-session-queue.html)
- `StartGameSessionPlacement` with `PlayerLatencies` (`PlayerId`, `RegionIdentifier`, `LatencyInMilliseconds`) reorders locations by average latency; do not combine with `PriorityConfigurationOverride`; `PlacementId` must be globally unique, max 48 chars. Works for container fleets. Returns IpAddress, DnsName, Port, PlacedPlayerSessions. [API](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_StartGameSessionPlacement.html)
- Manual region selection: either pass a one-location latency list / use `PriorityConfigurationOverride` with `PlacementFallbackStrategy` (queue must prioritize location), or keep per-region queues. Same API page.
- Placement is keyed on `RegionIdentifier` values only for locations that have fleets (matchmaking docs warn not to send latency for locations without fleets). [DG UDP ping beacons](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/reference-udp-ping-beacons.html)

### 4.3 Measuring latency from a browser
- GameLift's documented measurement tool is **UDP ping beacons** `gamelift-ping.<region>.api.aws:7770` (UDP only; limits 3 TPS per sender ip:port, 1000 TPS per IP; ICMP fallback suggested). Includes `ca-central-1` and `us-west-2`, plus Local Zone beacons. [DG](https://docs.aws.amazon.com/gameliftservers/latest/developerguide/reference-udp-ping-beacons.html), [endpoint table](https://docs.aws.amazon.com/general/latest/gr/gamelift.html)
- Browsers cannot send UDP or ICMP, so beacons are unusable. No HTTPS/WSS beacon is documented (absence in the docs above; UNVERIFIED that none exists).
- What we deploy: a trivial endpoint per candidate location (e.g. `https://ping.usw2.play.example.com/p`, 204 response, CORS `*`), via Lambda Function URL or the Rust edge stack. Client does one warm-up request then N timed requests on the reused connection (`performance.getEntriesByName`), takes the median, and sends `{region: ms}` to our backend, which forwards it as `PlayerLatencies`. HTTPS RTT over-reports by the TLS/HTTP stack but ranks regions correctly; calibrate offset against a real WSS ping to a session.
- Honest caveat: endpoint-to-client RTT is a proxy for game-server RTT; for Local Zones there is no Region endpoint, so deploy a probe in the zone or skip LZs initially.

## 5. Quotas and cost

### 5.1 Quotas ([General Reference](https://docs.aws.amazon.com/general/latest/gr/gamelift.html))
| Item | Default |
|---|---|
| Game session queues / Region | 100 (adjustable) |
| Queue destinations / queue | 10 (adjustable) |
| Locations in a fleet | 10 (adjustable) |
| Player sessions / game session | 200 (fixed) |
| Player session reservation timeout | 60 s (adjustable) |
| Server processes / instance (SDK v3+) | 50 (EC2; container applicability UNVERIFIED) |
| Managed container fleets / Region, container group definitions, instances / fleet, placement requests per second, CreateGameSession rate | **not in this table: UNVERIFIED** |
Check: `aws service-quotas list-service-quotas --service-code gamelift` and EC2 "Running On-Demand Standard (A,C,D,H,I,M,R,T,Z) instances" vCPU quota (UNVERIFIED that GameLift instances count against it; likely). 200 matches at 8/instance on 2-vCPU nodes is ~50 vCPU per scenario, small.

### 5.2 Pricing basis
- Billing is per instance-hour; "Network bandwidth is free for all instance types generation 6 and later". [Pricing](https://aws.amazon.com/gamelift/servers/pricing/) No separate container surcharge is stated; GameLift rates are higher than raw EC2 (see the examples below).
- Prices on the page (US East (Ohio), fetched 2026-11-04): c6i.4xlarge $0.823/h (another section shows $0.904: ambiguity), c6a.large $0.099 On-Demand and $0.03 Spot, c6g.4xlarge $0.66/h, c5a.4xlarge $0.746/h. **No c6i.large, c7g.large, us-west-2 or ca-central-1 tables were on the page.** [Pricing](https://aws.amazon.com/gamelift/servers/pricing/)
- Spot for containers: `BillingType: ON_DEMAND | SPOT` exists on `CreateContainerFleet` (cannot change later). [API](https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html) Spot interruptions give 2 min; a match lasts longer, so Spot is a poor fit for sessions unless matches can be lost or migrated. Do not budget Spot at first.

### 5.3 Estimate (NOT a quote)
Assumptions, all UNVERIFIED unless noted: price per `.large` = 1/8 of the page's 4xlarge price (EC2 prices scale linearly within a family); c6i.large ~ $0.823/8 = **$0.103/h** (us-east-2 proxy for us-west-2; ca-central-1 is typically ~10% higher: from memory); c7g.large ~ c6g.4xlarge $0.66/8 = $0.0825, +~7% generation uplift = **~$0.088/h** (c7g not on the page); 730 h/month; On-Demand; excludes CloudWatch Logs, ECR, Route 53, Lambda, egress to non-GameLift services, support plan. Peak concurrency 200 matches 24x7 (an upper bound; real traffic is diurnal and autoscaling would cut the average). "Buffered" adds a 25% PercentAvailableGameSessions target.
| Matches / instance | Instances (exact) | Instances (+25% buffer) | c6i.large $/month | buffered | c7g.large $/month | buffered |
|---|---|---|---|---|---|---|
| 4 | 50 | 63 | ~3,760 | ~4,740 | ~3,210 | ~4,050 |
| 8 | 25 | 32 | ~1,880 | ~2,410 | ~1,610 | ~2,050 |
| 16 | 13 | 16 | ~980 | ~1,200 | ~835 | ~1,030 |
Feasibility of density (from verified memory math): a `.large` has 3,768 MiB usable; 16 groups leave ~185 MiB and 0.125 vCPU each after a 50 MiB log reserve; 8 groups ~420 MiB and 0.25 vCPU. Whether a Rust match for 8 players at 20 Hz fits that is UNMEASURED; the sim must be profiled (legacy TS sim: <5 ms avg per tick for one 8-player step, from `CLAUDE.md`, a different engine). Prefer 8/instance as the planning density until a Rust benchmark exists. Also scaling granularity: coarser instances (xlarge) change the numbers little but reduce minimum footprint per location.
Multi-region floors: each location keeps at least 1 instance (min-size can be 0 only with scale-to-zero handling: UNVERIFIED), so 3 locations cost at least ~3 x $75/month idle.

## 6. ECS (EC2 / Fargate) comparison, just enough to decide
No ECS pages were fetched in this pass; the points below are general AWS knowledge and UNVERIFIED against current docs, except where noted.
What GameLift gives that ECS does not, and we would have to build:
- Session placement and a "which task has a free slot" registry (DynamoDB + Lambda/service); GameLift gives `StartGameSessionPlacement`, `DescribeGameSessionPlacement`, SNS events. (verified above)
- Latency-ordered multi-region placement, fallback and timeouts (queue `PlayerLatencyPolicies`, `PriorityConfiguration`). Verified above. On ECS: our own router and per-region fleets.
- Scale-in protection by session state and target tracking on free session slots. ECS has task scale-in protection and capacity-provider managed termination protection, but you write the logic that sets it per match, and metric publication for "free slots".
- Rolling deploy that waits for active sessions: ECS rolling updates need draining logic and long `stopTimeout` (ECS max 120 s on EC2 by default; configurable but check); GameLift has `ProtectionStrategy`.
- Per-task TLS endpoint: same problem as GameLift (own wildcard cert + per-task DNS). Fargate tasks each get a public IP/ENI; EC2 tasks need dynamic host ports + a router (or `awsvpc` mode with ENI limits that cap density). 
- Packing: Fargate cannot pack several matches in one VM boundary beyond one task per match (cost ~ per-task vCPU/GB minimums); EC2 with bin-packing placement strategy can match GameLift densities.
- Spot handling and AMI replacement are ours.
Where ECS wins: standard tooling (IaC, ALB), no 30-day fleet swap, region coverage (ca-west-1 has ECS/EC2; GameLift does not list it) and no GameLift price uplift (the pricing examples above imply ~1.2-1.3x raw EC2 for the same type: derived from the page vs memory of EC2 prices, UNVERIFIED).
Decision rule: choose ECS only if staging steps 3, 6, 9 or 10 fail (home-region, ports, TLS, deployment/protection) or if western Canada latency from us-west-2 is unacceptable and ca-west-1 hosting is a hard requirement.

## 7. Risks and blockers (ranked)
1. TLS on container fleets unproven; own-cert path adds secret distribution and DNS churn (3).
2. Container-fleet home Region limited to multi-location home Regions (probably not ca-central-1) (4.1).
3. Default UDP inbound permissions and manual port management for TCP (1.5); port-mapping behavior with a fixed container port unverified.
4. Density unmeasured for the Rust sim; packing and scale-in preferences unverified (5.3, 1.7).
5. Fleet replacement every 30 days plus "safe deployment" waits behind long matches (1.1, 1.8).
6. Reconnect semantics of player sessions unverified; Go SDK on arm64 unverified; SDK-in-support-container unverified (1.9, 2c).
7. Latency probes are ours to build; HTTPS RTT is a proxy (4.3).
8. Container-specific quotas not published in the quotas table (5.1).

## 8. Index of sources
- https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-howitworks.html
- https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-design-fleet.html
- https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-prepare-images.html
- https://docs.aws.amazon.com/gameliftservers/latest/developerguide/containers-scaling.html
- https://docs.aws.amazon.com/gameliftservers/latest/developerguide/fleets-autoscaling-target.html
- https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-regions.html
- https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-sdk-server-api.html
- https://docs.aws.amazon.com/gameliftservers/latest/developerguide/integration-server-sdk-go-actions.html
- https://docs.aws.amazon.com/gameliftservers/latest/developerguide/reference-udp-ping-beacons.html
- https://docs.aws.amazon.com/gameliftservers/latest/developerguide/queues-design-multiregion.html
- https://docs.aws.amazon.com/gameliftservers/latest/developerguide/gamelift-wrapper-tutorial.html
- https://docs.aws.amazon.com/gameliftservers/latest/apireference/API_CreateContainerFleet.html, API_UpdateContainerFleet.html, API_CreateContainerGroupDefinition.html, API_StartGameSessionPlacement.html, API_Compute.html, API_CertificateConfiguration.html
- https://docs.aws.amazon.com/cli/latest/reference/gamelift/create-game-session-queue.html, https://docs.aws.amazon.com/cli/latest/reference/gamelift/index.html
- https://docs.aws.amazon.com/general/latest/gr/gamelift.html
- https://aws.amazon.com/gamelift/servers/pricing/
- https://github.com/amazon-gamelift/amazon-gamelift-servers-game-server-wrapper, https://github.com/amazon-gamelift/amazon-gamelift-servers-cpp-server-sdk
- https://aws.amazon.com/about-aws/whats-new/2025/03/amazon-gamelift-servers-game-wrapper-rapid-onboarding, https://aws.amazon.com/about-aws/whats-new/2025/05/amazon-gamelift-sdks-github
- https://repost.aws/questions/QUQ_LI9tW8QHKH6vn7Jp5zAA/gamelift-managed-containers-and-certificates (403 to our fetcher; content seen via search summary only)
