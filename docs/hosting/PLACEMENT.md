# Capacity-aware party placement (P-HOST-3, with P-HOST-2 for TLS/DNS)

Status: **designed; the planner, orchestration and fakes are implemented and tested locally (`crates/rh-placement`); nothing has run against AWS.**
Written 2026-11-05. TLS and DNS are in [TLS_DNS.md](TLS_DNS.md); the probe in [LATENCY_PROBES.md](LATENCY_PROBES.md).
GameLift facts are in [GAMELIFT_VERIFIED.md](GAMELIFT_VERIFIED.md); the additions read today are in section 2 below. Where this file and the
code disagree, the code wins.

## 1. Join path, end to end

```
 browser                       account API            placement service            GameLift (queue, home Region)
    |  probe /ping per region       |                          |                               |
    |  (warm-up + median of 5)      |                          |                               |
    |--- POST probe report -------->|  (authenticated)         |                               |
    |    ... every party member does the same ...              |                               |
    |--- "find match" (party, optional region) --------------->|                               |
    |                          verify every member's profile token                              |
    |                          mint request_id; stamp each report's age                         |
    |                               |--- PlacementRequest ---->| read AvailableGameSessions     |
    |                               |                          | plan (score.rs)                |
    |                               |                          |--- StartGameSessionPlacement ->| queue picks a free server process
    |                               |                          |<-- describe until FULFILLED ---|  (OnStartGameSession reaches the bridge,
    |                               |                          |                                |   bridge POST /control/session, ActivateGameSession,
    |                               |                          |                                |   then admits the reserved callsigns)
    |                               |                          | upsert <region>-<token>.g.<zone> A record, verify at the zone's authoritative servers
    |<------------- JoinOffer { wss url, region, warnings } ----------------------------------|
    |--- WSS Hello (profile token) to wss://<region>-<token>.g.<zone>:<port>/ws ---> rh-server (admit check: CONTROL_API.md section 4)
```

- The account API authenticates; the placement service never sees a profile token. It receives only callsigns (already verified), RTT
  numbers and the request id. A placement does not replace the server's own checks: the Hello still carries the profile token, the
  admit check and the fenced lease run unchanged ([CONTROL_API.md](CONTROL_API.md) section 4). A client that lies about RTT can only
  choose a worse region for the party it is in.
- `PlayerId` of each desired player session is the callsign, so the bridge can pre-admit the reservation.
- The player-session id returned in `PlacedPlayerSessions` is kept by the backend; it never goes into the browser's Hello.
- **Credentials.** Exactly one component holds GameLift placement credentials: the placement service (IAM role with
  `StartGameSessionPlacement` on the one queue, `Describe/StopGameSessionPlacement`, `TerminateGameSession`, `cloudwatch:GetMetricData`; policy in
  `hosting/infra/edge/queue.cfn.yaml`) and the practice-zone DNS token (separate secret, section 5 of TLS_DNS.md). The game process
  (`rh-server`) links no cloud SDK and holds none. The bridge uses only the GameLift Server SDK. The container fleet role's credentials are
  injected into every container of a group (AWS docs, read 2026-11-05); its policy is therefore the whole AWS authority of the match
  containers, and the template grants it exactly one thing, `GetSecretValue` on the wildcard-certificate secret (a support container
  needs it; see TLS_DNS.md section 5). Recommendation to the bridge owner: scrub `AWS_*` variables from the environment of the
  `rh-server` child.
- **Not implemented in this change:** the account-API routes (`POST /api/party/probe`, `POST /api/play/place`), the HTTP wrapper of the
  placement service, the real GameLift/CloudWatch adapter and the real Cloudflare adapter's wiring (the Node tool exists,
  `hosting/infra/edge/dns/`). The crate is the logic those call.

## 2. Verified facts (read 2026-11-05; `UNVERIFIED` is never a guess)

Documentation host `docs.aws.amazon.com/gameliftservers/latest/`; paths are relative to `apireference/` or `developerguide/`.

| Fact | Source |
|---|---|
| `PlayerLatencies` are averaged per location over all players in the request, locations are reordered lowest first; **`PlayerLatencies` together with `PriorityConfigurationOverride` is `InvalidRequestException`**; an override needs a queue that prioritises `LOCATION`. Locations without latency data are tried after those with it. Averaging is why we do not use it: it hides a 250 ms member behind three at 40 ms. | `API_StartGameSessionPlacement.html` |
| `PriorityConfigurationOverride`: `LocationOrder` 1..10 distinct locations, `PlacementFallbackStrategy` `DEFAULT_AFTER_SINGLE_PASS` (default) or `NONE`; **does not override the queue's `FilterConfiguration`** | `API_PriorityConfigurationOverride.html` |
| `PlacementId`: `^[a-zA-Z0-9-]+$`, 1..48, unique across Regions, never reused | `API_StartGameSessionPlacement.html` |
| Placement retries until the queue timeout, then `TIMED_OUT`. Queue `TimeoutInSeconds` min 10, max 600. Statuses `PENDING, FULFILLED, CANCELLED, TIMED_OUT, FAILED`. IP, port, region, session id are **not final until `FULFILLED`**; player sessions exist only after it. | `API_CreateGameSessionQueue.html`, `API_GameSessionPlacement.html` |
| `StopGameSessionPlacement` works only on `PENDING`; once a session exists it is `InvalidRequestException` and the session is cleaned with `TerminateGameSession`. This is why the service re-describes after a refused stop (a cancel can race a fulfilment). | `API_StopGameSessionPlacement.html` |
| Queue: `FilterConfiguration.AllowedLocations`; `PriorityConfiguration.PriorityOrder` of `LATENCY, COST, DESTINATION, LOCATION`; `PlayerLatencyPolicies` (sliding cap, only meaningful when latencies are sent). Destinations are fleets or aliases, "can span multiple AWS Regions". | `API_CreateGameSessionQueue.html`, `API_PriorityConfiguration.html` |
| Capacity signal: CloudWatch `AvailableGameSessions` (idle healthy server processes, per `FleetId` + `Location`, published every minute), also `ConcurrentActivatableGameSessions`, `PercentAvailableGameSessions`, container `IdleGameServerContainerGroups`; queue `QueueDepth`, `AverageWaitTime`, `PlacementsTimedOut`. So capacity is at best about a minute stale: it is a hint, never a reservation. | `monitoring-cloudwatch.html` |
| Locations (table): `us-west-2` single+multi home, remote, queue; `ca-central-1` single-location home, remote, queue (**not** multi-location home); `us-east-2` single-location home, remote, queue; `us-east-1` single+multi home; `ca-west-1` absent. A queue lives in one Region. | `gamelift-regions.html` |
| `CreateContainerFleet` has no certificate parameter; the placement `DnsName` is `ec2-<id>.compute.amazonaws.com` for non-TLS fleets (a name under a domain we cannot certify) and `<id>.<region>.amazongamelift.com` only for TLS-enabled fleets. | `API_CreateContainerFleet.html`, `API_GameSessionPlacement.html` |
| `PlayerGatewayMode` (relay, hides server IPs, DDoS) exists for container fleets; the docs describe it for **UDP** and `ca-central-1` is not a gateway home Region. Browser WSS through it: UNVERIFIED, not planned. | `API_CreateContainerFleet.html`, `gamelift-regions.html` |
| UDP ping beacons `gamelift-ping.<region>.api.aws:7770`; browsers cannot use them. | `reference-udp-ping-beacons.html` |
| East option: **`us-east-2`** (Ohio): queue-capable, single-location home, remote location; it is the nearest listed Region to central/eastern North America that does not need a multi-location home. `us-east-1` is the alternative. | `gamelift-regions.html` |

Still UNVERIFIED (and where it is decided): whether a *container* fleet may be homed in `ca-central-1`; the real fulfilment latency of a
placement (staging step "queue and placement"); `PlacementId` throttling and `StartGameSessionPlacement` API rate limits; resource-level IAM
for `Describe/Stop/TerminateGameSession` (the template uses `*` for those three, the harmless ones); whether `AvailableGameSessions` is per
container-group (it counts server processes, which equal groups here).

## 3. Why the planner orders locations itself

GameLift's latency ordering averages, cannot be combined with an override, and knows nothing about our "ceiling warns, never forbids"
rules. So the placement service **never sends `PlayerLatencies`**: it sends `PriorityConfigurationOverride.LocationOrder` (its own
order) with `PlacementFallbackStrategy: NONE`, and does its own widening. The Rust type `StartPlacement` has no latency field, so the
forbidden combination cannot be built. The queue is configured `PriorityOrder [LOCATION, DESTINATION]` so the override is accepted.

## 4. The rules (`crates/rh-placement/src/score.rs`)

Inputs per request: every party member's latest probe median per region (`null` = failed, missing = not measured), the report's age,
an optional manual region, and the capacity snapshot.

1. **Members.** A report older than 300 s or with no configured region is *no data* (ignored, listed in a warning). A report whose every
   region failed is *unreachable* (ignored for scoring, listed in a warning: that player probably cannot join). Everyone else is *scored*.
2. **Region score = the worst scored member's RTT** (minimise the maximum). A region is *eligible* only if every scored member reached it.
   If no region qualifies the regions reached by the most members are used, with a `partial_reachability` warning.
3. **Tier** by that maximum: `Preferred` <= 120 ms, `Acceptable` <= 180 ms, `OverLimit` above. (LATENCY_PROBES.md's provisional defaults; owner decision.)
4. **Cost** = maximum + 40 ms when the region is *known* to have zero idle sessions (unknown capacity is never penalised; a CloudWatch outage
   cannot block a join). Rank by (tier, cost in 10 ms buckets, summed RTT, configured order). The bucket makes a few ms a tie; capacity acts
   only through the penalty.
5. **Attempt ladder** (each attempt is one bounded GameLift placement, 20 s, whole request 75 s):
   1. preferred-tier regions that have capacity;
   2. every acceptable region (including ones that need a scale-up);
   3. every eligible region (only under `OverLimitPolicy::PlaceWithWarning`, the default).
   Identical consecutive attempts collapse; each attempt gets its own `PlacementId` (`rh-<request_id>-<n>`) and the previous one is cancelled first.
6. **Manual region** (the player's explicit choice): one attempt, that region only, up to the whole 75 s budget. It is **never forbidden and never
   silently replaced**: a high ping or a known-empty region only adds a warning; if no host appears the request ends `region_unavailable`.
7. **Nobody has data** (probes blocked, or a first launch): the configured region order, regions known to be empty last, with `no_latency_data`.
   **Everybody unreachable:** refusal `no_reachable_region`.

Why the maximum: the worst member sets the match's quality; the mean lets seven fast players hide a player at 160 ms. Why a tier before
cost: the hard limits are user-experience limits; the capacity penalty must not drag a party into a worse tier by itself (the ladder instead tries a
free region first and widens after 20 s).

### Idempotency, races, cleanup (`service.rs`)
- `request_id` (minted by the account API per party action) is inside the placement id, so a retried request attaches to the existing placement
  (`AlreadyExists` -> describe) instead of starting a second server. A finished-but-unfulfilled id is `request_id_reused`; mint a new one.
- On an attempt timeout the placement is stopped. If the stop is refused because a session was created in the meantime, that session is used.
- After `FULFILLED` the hostname is published and **verified at the zone's authoritative servers before the client gets it**. If publishing or
  verification fails, the record is deleted and the session is terminated, then the ladder continues; if nothing succeeds the user sees `host_not_ready`.
- The session-end hook (and the janitor, TLS_DNS.md section 5) calls `release_host` so records do not outlive their sessions.
- A GameLift `Unavailable` (throttle, 5xx) is retried (start: 3 times; describe: 5 consecutive failures, then the placement is cancelled).

## 5. Fallbacks and what the player sees

| Situation | Behaviour | Player sees (`user_message`; stable code) |
|---|---|---|
| Normal | First attempt places | "Found a match in Oregon" with the measured ping |
| Preferred region full or cold | After 20 s the second attempt asks for more regions (progress `Widening`) | "Looking in more regions..." |
| Nothing under 180 ms for the slowest member | Place in the best region, `all_regions_over_limit` warning | "Every region has high ping for someone in this party; the best is X at N ms" and the match proceeds |
| Same, policy `Refuse` | Refusal before touching GameLift | "Ping is too high everywhere... Choose a region manually to play anyway." (`all_regions_over_limit`) |
| Manual region over the limit | Placed, `high_ping` warning | "Ping to X will be high for the slowest player (N ms)" |
| Manual region empty | One attempt, up to 75 s | `region_unavailable`: "X has no free server right now. Choose automatic, or try again shortly." |
| No capacity anywhere in 75 s | All placements cancelled | `no_capacity`: "All servers are busy right now. Please try again in a minute." (retryable) |
| A member's probes all failed | Excluded from scoring | Warning: "<name> could not reach any region and may not be able to join." |
| Nobody has ping data | Default order | "No ping data yet; using the default region." |
| Nobody can reach any region | Refusal | `no_reachable_region`: "Could not reach any game region from your network..." |
| GameLift throttled/outage | Bounded retries | `service_unavailable`: "Matchmaking is temporarily unavailable." (retryable) |
| DNS publication failed | Host released | `host_not_ready`: "The server was found but is not reachable yet." (retryable) |

User text never contains AWS error text, ids or hostnames of failed hosts (asserted in tests).

## 6. Region set

Candidates: **`us-west-2`**, **`ca-central-1`**, **`us-east-2`** (configured order = tie-break order). Home placement: one queue in `us-west-2` whose
destinations are the container fleet(s) of the fleet package (one multi-location fleet homed in `us-west-2` with remote locations, or per-Region
single-location fleets; both fit the queue and the planner). `ca-central-1` as a *container* fleet home is UNVERIFIED, so the safe shape is
`ca-central-1` as a remote location of the `us-west-2` fleet. `ca-west-1` (Calgary) is not a GameLift location; western-Canada players are expected to
land in `us-west-2` or `ca-central-1`, which only measurement from Calgary/Vancouver can order.

## 7. Calibrating the probe against the game path

The probe times `GET /ping` (one HTTP round trip on a warm connection). The game's own number is the WSS Ping/Pong the client already sends every
500 ms. Calibration (NOT RUN against real regions): from the same browser, for each region host, record the probe median and the median of >= 20
WSS ping-pong samples after joining; they must agree within max(5 ms, 15%). A probe much *faster* than the game path means the probe reached a nearer
cache or edge and the probe host is wrong; the probe hosts are DNS-only A records so TLS terminates at an origin, never a CDN, and calibration is the
check. Local mechanism proof: `hosting/placement/probe/local-proof.mjs` (loopback, so numbers prove the mechanism only: probe 1.1 ms vs WSS 0.4 ms in the
recorded run, within the 5 ms floor).

## 8. NOT RUN (cloud) and what each needs

| Item | Command / procedure | Needs |
|---|---|---|
| Queue + SNS + secrets + policies | `aws cloudformation deploy --stack-name rh-edge --template-file hosting/infra/edge/queue.cfn.yaml --parameter-overrides Destination1FleetArn=<describe-container-fleet FleetArn> --capabilities CAPABILITY_IAM` | a deployed container fleet (fleet package), AWS credentials with CloudFormation/GameLift/SNS/IAM/Secrets Manager, budget check (CAD 20 cap; queue and SNS are free, each Secrets Manager secret is billed per month: UNVERIFIED price) |
| One real placement | `aws gamelift start-game-session-placement --region us-west-2 --cli-input-json file://req.json`, where `req.json` is the `firstStartGameSessionPlacement` object printed by `rh-placement plan` | the stack above and a fleet with an idle process |
| Real fulfilment timing, cancel race, widening | the placement service against the queue with 3 ladders: preferred empty, all empty, manual empty | fleet in two locations |
| Regional probes from real regions | `node hosting/placement/probe/probe-cli.mjs us-west-2=https://probe-us-west-2.g.rougehalla.com ...` from Calgary/Vancouver and from inside each region | an always-on probe host per region (TLS_DNS.md section 6) with DNS records; not created |
| Calibration against real WSS RTT | section 7 | the above plus one joined match |
| Capacity adapter | CloudWatch `GetMetricData`, namespace `Amazon GameLift`, metric `AvailableGameSessions`, dimensions `FleetId` + `Location` | the fleet |

## 9. Tests

`cargo test -p rh-placement` (39 tests: 18 planner, 3 hostname, 18 orchestration on a paused clock against the scripted fakes) and
`node --test hosting/placement/probe/probe.test.mjs hosting/infra/edge/dns/dns.test.mjs`. The fakes enforce the documented request rules
(placement id shape and uniqueness, 1..10 locations, stop-after-fulfil refused), so the service tests prove the service obeys them.
`rh-placement plan < input.json` prints a plan and the exact API request offline.
