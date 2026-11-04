# Regional latency probes from the browser (specification)

Browsers cannot send UDP or ICMP, and GameLift's documented ping beacons are UDP
([GAMELIFT_EVALUATION.md](GAMELIFT_EVALUATION.md) 4.3). Probes therefore use HTTPS to OUR game processes, over the same
path the game's WebSocket uses. Edge-cached responses (a CDN) measure the edge, not the origin, and are not valid probes.

## Endpoint
Every game process serves `GET /ping` on its public listener (`crates/rh-server/src/lib.rs`): body `pong`,
`Cache-Control: no-store`, `Access-Control-Allow-Origin: *`. One stable probe hostname per Region points at a small
always-on pool of game hosts in that Region (or a tiny probe service on the same network path), with a valid certificate.

## Client procedure
1. Fetch the Region list (id, display name, probe URL) from the matchmaking API.
2. For each Region in parallel: one warm-up request (TLS + connection setup), then 5 timed requests on the same
   connection (`fetch(url, { cache: "no-store" })`, timed with `performance.now()`), 150 ms apart. Report the median and
   the spread (max - min); drop a Region with 2+ failures.
3. Repeat in the background every 60 s while in the menu; send the latest medians with every queue request.
4. Show the automatic choice and its measured ping; let the player override it (manual selection is always allowed;
   a ceiling warns, it does not forbid).

## Server side (placement)
- The queue receives every party member's medians (GameLift `PlayerLatencies` per player per Region; a Region a member
  could not reach counts as missing). Placement picks the lowest maximum latency under the ceiling with capacity; a
  manual override uses the queue's priority override (cannot be combined with latencies: [GAMELIFT_EVALUATION.md](GAMELIFT_EVALUATION.md) 4.2).
- Ceilings and the party rule (max vs mean) are provisional defaults for the owner: max <= 120 ms preferred, 180 ms hard
  warning.

## Validation (not run in Stage 1)
- Compare the probe's median with the in-game RTT (Ping/Pong in protocol v2, unchanged from v1) for the same client and Region: they should
  agree within a few ms after warm-up. Measure from western Canada (Calgary, Vancouver) to `ca-central-1` and `us-west-2`.
