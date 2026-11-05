# Regional latency probes from the browser (specification)

Status 2026-11-05: **implemented** in `hosting/placement/probe/probe.mjs` (tests: `probe.test.mjs`; local proof: `local-proof.mjs`) and consumed by
`crates/rh-placement`; the party/capacity rules below are now specified and tested in [PLACEMENT.md](PLACEMENT.md), the probe origins and certificates in
[TLS_DNS.md](TLS_DNS.md). Real-region probing and calibration are NOT RUN. Where this file and the code disagree, the code wins.

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
- Ceilings and the party rule are provisional defaults for the owner: worst member <= 120 ms preferred, 180 ms hard warning.
  **Decided in code:** the party rule is the maximum, and GameLift's own latency ordering (an average) is not used: `PlayerLatencies`
  cannot be combined with a priority override at all (PLACEMENT.md sections 2 and 3). The probe values go to our planner, not to the queue.

## Implementation notes
- A probe request is `fetch(<probe>/ping?n=<nonce>, {cache:"no-store", mode:"cors", credentials:"omit"})`, timed with `performance.now()` over the full body; a body other
  than `pong` (a captive portal) is a failure. One warm-up, five timed samples 150 ms apart, median reported rounded **up** to whole ms; two failures drop the region (`null`).
- The browser cannot tell an origin from an edge cache by itself (cross-origin response headers are hidden), so origin-ness is guaranteed by deployment (DNS-only records,
  the game process's own certificate) and *verified by calibration*, never assumed (a probe far faster than the WSS ping-pong means a nearer cache answered).

## Validation (not run against real regions)
- Compare the probe's median with the in-game RTT (Ping/Pong in protocol v2, unchanged from v1) for the same client and Region: they should
  agree within a few ms after warm-up. Measure from western Canada (Calgary, Vancouver) to `ca-central-1` and `us-west-2`.
