# Disconnects on the public server: investigation of 2026-11-04

What players reported (owner, 2026-11-04): "mostly a lag spike, then one player is dropped"; sometimes every player drops at
once; it reconnects only about half the time, otherwise they are kicked to the menu; normally early in a run; worse with the recent
changes.

## 1. Findings, ranked

1. **Proven and fixed: a burst of messages after any 3-4.5 s interruption closed the moving players with 4002, and the client
   did not reconnect from 4002.** Colyseus's per-client cap (`maxMessagesPerSecond`, 200) counts in a one-second window keyed on
   the room clock. That clock is moved by a 50 ms timer, so everything a client sent while its messages were held back (a stalled
   uplink, a hop of the Worker → Durable Object → container path, or this process's own event loop) is read in one go, lands in
   one window, and the next second's traffic is added to it. A player who is moving sends about 51-57 messages a second (aim 40,
   held move or WASD 10, clicks, beat). So any interruption of about 2.6-3 s or more (backlog plus the next second over 200)
   closed that player with 4002 (WITH_ERROR). The server treated it as a drop and held the seat (`onDrop` runs for every code
   but a consented leave). The game client treated 4002 as final (`recoverableClose`), cleared its seat and went to the menu
   with "The run ended because of a server error." A player whose cursor and fighter were still sends about 3 a second and
   survived the same interruption.
   - This matches every part of the report. A lag spike is the interruption. One player is dropped: the one who was moving. In a
     server stall, every moving player is dropped at once. It "reconnects about half the time" because the client's own 3 s
     stall drop (net/linkWatch.ts, judged once a second) sometimes fires before the backlog is read, which takes the 4010
     reconnect path (back in 0.2 s), and sometimes does not, which takes 4002 and the menu. It happens "early in a run"
     because that is when everyone is walking to camps and streaming aims at the full rate.
   - Measured end to end with `bench/dropHarness.ts` (section 3): on the unfixed code, a server stall of 3.0 s sent 1 of 2
     moving clients to the menu, and stalls of 3.3 and 3.6 s sent 2 of 2. An uplink-only stall of 3.3, 3.5, 3.8 or 4.3 s sent
     the faulted client to the menu. The idle client was never dropped. In interleaved A/B rounds, the baseline sent **10 of 12**
     moving-client exposures to the menu and the fix sent **0 of 12**. Every client kept its socket. Commit `ce564f3`.
2. **The reconnect path works once a socket is dropped.** With the fix, every longer fault was won back by the SDK on its own. A
   server stall of 4 s was back 0.2 s after the client's drop, a 5 s stall after 1.1 s, a 6 s blackhole of one client's link
   2.1 s after the drop (that is, as soon as the link came back), and a 4 s downlink stall after 0.2 s. Section 3.3 has the
   lobby, planning and long-blackhole results.
3. **CPU is not overloaded (ruled out as the cause).** Production's vCPU runs the fixed cloud warm-up workload (400 ticks, 6 bots,
   seed-1 map: `cloudWarmup.ts`, reported on `/readyz`) in 10.3 s. One core of this machine runs it in 8.8-9.5 s. So local
   per-tick numbers carry over at about 1.1x. A tick with 8 fill bots and 204 mobs costs 5.1-5.4 ms of CPU on average, 12 ms
   at p99, and 14-16 ms at most after warm-up, against a 50 ms budget. Through the real Room with 3 socket clients and 8 bots,
   tick work was p50 4.8-5.8 ms, p95 9-15 ms, p99 12-26 ms, and 50-140 ms at most, with 0.03-0.16% double steps. The worst
   single ticks are the bots' first decisions (a cold tick 4, 105-120 ms), the planning start (75-113 ms) and the raid start
   (67-76 ms, 57 of it the step and 7-13 the patch). None comes near the 2.6 s that closed a client. The tactical-farming pass
   did not make the steady tick dearer (table in section 4).
4. **Bandwidth and the first sync are fine (ruled out).** A joiner's first full sync is 32.8-34.6 KB, under the 64 KB encoder
   buffer, so the encoder does not grow. Per-client rates on seed 1 are: typical 11.2 KB/s, heavy 15.2, idle 4.9, five chests
   up 10.4, and the bots scenario 6.4 (gate 20).
5. **The stall watch cannot see most stalls.** `StallWatch` (client `net/uplinkPace.ts`) pauses the continuous streams while
   `WebSocket.bufferedAmount` is above 0. A socket shows buffered bytes only once the operating system's send buffer is full.
   At about 1-2 KB/s of small messages, that takes many seconds of a stalled TCP. A stall of the server, or of any hop past
   the browser, never shows there at all. `uplinkBudget.test.ts`'s model assumed bytes from the first send into the stall, so
   it said the cap was safe to about 29 s. In the real stack it was 2.6-3 s. The watch is harmless and stays. The fix puts the
   tolerance on the server, where every case is covered.

What causes the 3+ s interruptions in production is not measured. This server's own loop is ruled out for normal play (item 3).
What remains are the players' links (Wi-Fi, mobile; a TCP retransmission backs off 0.2, 0.4, 0.8, 1.6 then 3.2 s) and the
Cloudflare path. Whatever the cause, interruptions up to the liveness limits are now ridden out, and longer ones reconnect.

## 2. The fixes (commit `ce564f3`)

- **Server (`rooms/RaidRoom.ts`).** Every message spends one token of a per-client bucket: `MESSAGE_BURST` 1500 deep, refilling
  at `MESSAGE_RATE` 200 a second, on real time. An empty bucket closes the client with 4002, as Colyseus's cap did. That goes into
  the reconnect grace like any drop, and a flood is still cut off: a client sending three times the steady rate is closed in
  about 4 s (`test/messageBurst.test.ts`). The depth is 27 s of the busiest honest mix, far past the 4.5 s after which the
  liveness sweep drops a silent client anyway. Colyseus's own cap (`MAX_MESSAGES_PER_SECOND`, now 1900) stays as a backstop for
  what never reaches a handler (binary frames, requests, protocol pings). An unregistered message type still closes the client
  at once, as before. No wire change and no gameplay number.
- **Client (`net/rejoin.ts`, `main.ts`).** A 4002 close is now recoverable. The server holds the seat for every close but a
  consented leave, so the stored token is tried, but only for `SERVER_CLOSED_REJOIN_WINDOW_MS` (5 s): the server closed the
  socket itself, so it has seen the drop and the seat is either held now or never. For example, a training room holds none, so
  the player is back on the menu in about 5 s, not the 28.5 s window the other codes wait out.
- **Client (`net/roomLink.ts`).** `tuneReconnection`, `forceDrop` and `linkOf` moved out of `connection.ts` (re-exported there)
  into a module that reads no build environment, so the harness runs the page's exact liveness code.
- **Tests.** `server/test/messageBurst.test.ts` covers four things: an honest 440-message backlog keeps its client (this test
  fails on the old code with `expected 4002 to be 0`); a flood is closed with 4002 and its seat is won back with the token; a
  sustained over-rate stream is closed; and the constants are checked. `uplinkBudget.test.ts` now models the bucket, and keeps
  the old window's 1.75-3.25 s kick as a documented regression. `client/test/rejoin.test.ts` covers the 4002 window.

## 3. How it was measured

### 3.1 Production reads (plain GETs only)

`/readyz` at 05:01 UTC woke the container (`uptimeSeconds` 16). Its readings were: `eventLoopDelayMs` max 3018 ms (the boot,
before `ready`), p99 113; `simulationWarmup` 400 ticks in 10345 ms; `cpuSteal` 0.43% over the last 60 s; `cgroupCpu` null (not
readable in the container); no ticks, sockets or slow ticks yet, because there were no players. A second read at 155 s showed an
idle loop (p99 6 ms). `/build-info.json`: source `75c5b83`. So production runs the tactical-farming and route code, without this
branch's 36c91bc and 8e4a4c4.

### 3.2 The drop harness (`packages/server/bench/dropHarness.ts`, new, report only)

- A real server runs in a child process, so its event loop can be blocked on purpose. It uses `startServer` with the arena room,
  `BOTS_FILL_TO` 8 in-process fill bots, the map's mobs, quests on, planning 12 s, the liveness timeout 4500 ms and `MAP_POOL` 2,
  as in the cloud config.
- One fault-injecting TCP proxy sits in front of each client. It can hold either direction (or both) for a while, then deliver
  everything it held in order, which is what a stalled TCP stream does.
- Each client runs the game client's own `LinkWatch`, `forceDrop`, `linkOf`, the SDK reconnection settings and `main.ts`'s rejoin
  loop with the stored token, sending at a real player's cadence: an aim every 25 ms, a held move every 100 ms, the beat. The
  `--idle 1` option makes one client still (an aim keepalive every 500 ms).
- Faults: `stall:MS` (the server's loop is blocked), `uplink:MS`, `downlink:MS` and `blackhole:MS` (one client's link). Each fault
  gets a fresh run, and the fault comes 6 s into the run (or 2 s into `--phase lobby|planning`). The outcome is read 25-35 s later.

```
npx tsx packages/server/bench/dropHarness.ts --clients 3 --idle 1 --faults stall:3000,stall:3600,uplink:3500,uplink:4300 --settle 25
```

The baseline ran from a separate worktree at `5f5850f` (this branch before the fix, with the harness copied in and
`tuneReconnection` exported). Load average was 0.8-3.5 on 4 cores during the runs.

Unfixed (`5f5850f`), all runs. A, B and I are the moving clients and the idle one. For a link fault, A is the faulted client.

| fault | outcome |
|---|---|
| server stall 2.0 s, 2.6 s | all kept |
| server stall 3.0 s (2 runs) | A menu (4002), B kept, I kept; same again |
| server stall 3.3 s | A, B menu (4002); I kept |
| server stall 3.6 s (3 runs) | A, B menu (4002); I kept, every time |
| server stall 4.0 s | all dropped by their own 3 s watch (4010), back via the SDK 0.2 s later |
| server stall 5.0 s | all dropped by their own watch (4010), back 1.1 s later |
| uplink stall 2.6 s, 3.0 s | kept |
| uplink stall 3.3, 3.5 (2 runs), 3.8, 4.3 s (3 runs) | faulted client menu (4002), every time |
| uplink stall 6.0 s | server sweep (4010), back 0.2 s later |
| blackhole 3.0 s | kept |
| blackhole 6.0 s | dropped by the watch (4010), back 2.1 s after the drop |
| downlink stall 4.0 s | dropped by the watch (4010), back 0.2 s later |

Fixed (`ce564f3`), all runs:

| fault | outcome |
|---|---|
| server stall 3.0 s (2 runs), 3.3 s, 3.6 s (3 runs) | all kept |
| server stall 4.0 s | all dropped by the watch (4010), back 0.2 s later |
| server stall 5.0 s | all dropped by the watch (4010), back 1.1 s later |
| uplink stall 3.3, 3.5 (2 runs), 3.8, 4.3 s (3 runs) | kept |
| blackhole 6.0 s | dropped by the watch (4010), back 2.1 s after the drop |

### 3.3 Lobby, planning and long outages (fixed tree)

`--phase planning` and `--phase lobby` put the fault 2 s into the phase. Nobody aims in those phases (the client's world is
frozen while planning), so no burst builds up there. Load average was 4.3-8.4.

| phase | fault | outcome |
|---|---|---|
| planning | server stall 3.6 s | one client dropped by its watch at 3.6 s, back 0.2 s later; the other two kept |
| planning | blackhole 6.0 s | faulted client dropped by the watch, back 2.2 s after the drop (when its link returned) |
| planning | downlink stall 5.0 s | dropped by the watch, back 1.3 s after the drop |
| lobby | blackhole 6.0 s | dropped by the watch, back 2.7 s after the drop (8e4a4c4's hold; before it the seat was let go at once) |
| lobby | server stall 4.0 s | all three dropped by their watches, back 0.2-1.1 s later |
| active | blackhole 12 s | dropped at 3.7 s, back by the SDK at 12.0 s (when the link returned) |
| active | blackhole 20 s | dropped at 3.9 s, back by the SDK at 20.0 s |
| active | blackhole 30 s | dropped at 3.9 s; the seat's 20 s grace (from the sweep at about 5 s) ended at about 25 s, so the token was refused when the link returned at 30 s: menu, as designed (`RECONNECT_SECONDS`) |

### 3.4 CPU

- `stepBench.ts --bots 8 --clock cpu --seed 1`, pinned to one core (`taskset -c 2`), interleaved runs (section 4).
- The real Room under the harness (3 socket clients, 8 bots, mobs, quests). These are the server's own `tickStats`, the per-wake
  work in ms over the last 2400 wakes:

| run | p50 | p95 | p99 | max | double steps |
|---|---|---|---|---|---|
| smoke, 2 clients | 5.64 | 14.95 | 25.93 | 112.85 | 0.16% |
| baseline matrix | 4.81 | 9.12 | 12.10 | 58.53 | 0.03% |
| fixed matrix | 5.60 | 12.48 | 17.97 | 77.60 | 0.10% |
| A/B rounds (4) | 5.0-5.8 | 10.2-12.8 | 13.5-19.7 | 50-140 | 0.05-0.13% |

  Outside the stalls injected on purpose, the event loop's own delay was p99 8-12.6 ms.
- The worst wakes logged (`slowTickLog.worst`): planning start 112.8 ms (step 105) on a cold process, then 74.5 ms; raid start
  76.3 and 67.2 ms (step 55-58, patch 7-13); one lobby wake of 70 ms (bots arriving, 57 ms).
- Calibration: `warmCloudSimulation()` pinned to one core took 9393, 9479 and 8762 ms (load 1.3-2.9), against production's
  10345 ms.

### 3.5 Bandwidth

`npx tsx bench/bandwidth.ts seed=1` (pinned, load 2.2): the numbers are in item 4 above. The first sync is 32.8 KB (34.6 KB in
the bots scenario), so `ENCODER_BUFFER_BYTES` 64 KB holds it.

## 4. The recent changes

`stepBench --bots 8 --clock cpu --seed 1`, interleaved, pinned to one core, load 2.6-3.5:

| tree | mobs | tick avg | p99 | max after warm-up | worst warm-up tick |
|---|---|---|---|---|---|
| `7e74b4d` (before tactical farming, 136x136) | 170 | 6.21 / 5.21 | 12.66 / 11.94 | 16.0 / 18.4 | 86.7 / 79.2 (bots 82.7 / 75.2) |
| `ce564f3` (160x160, build routes, Frost Wall, regen) | 204 | 5.09 / 5.36 | 11.89 / 12.02 | 14.1 / 16.2 | 111.6 / 120.5 (bots 104.8 / 111.6, tick 4) |

The steady tick is unchanged within noise. Only the bots' first decisions are dearer, by about 30 ms on a cold process; in
production the cloud warm-up has already computed the duel cache those decisions read. The route planner (`buildRoute.ts`) is a
4-step greedy pass over 50 camps with cached duels, re-planned every 8 s, which is cheap.

The liveness change (48ccb65) did not create the 4002 trap; the cap and its window are older. But it changed which players fall
into it. Before it, any player whose backlog passed the cap after a long interruption was closed with 4002. After it, a player
whose 3 s watch fires first reconnects, and one whose watch has not fired yet still gets 4002. That gives the "half the time"
pattern.

## 5. What was checked and is right

- 36c91bc. The client beats from the join. The client's watch skips its judgment after its own thread was blocked for more than
  2 s. The server's sweep skips its judgment after a sweep that came over 2 s late. A stall between 1 and 2 s leaves at most
  about 3 s of silence, under the 4.5 s limit, so no window is unguarded. The harness's server stalls of 4-5 s produced no 4010
  from the sweep: the drops seen were the clients' own.
- 8e4a4c4. The lobby holds a dropped seat. The planning harness trials show the reconnect there (3.3). `RECONNECT_SECONDS` 20
  and the SDK's 10 retries (about 15 s, delays capped at 2 s) fit inside the client's 28.5 s rejoin window.
- Core's stale-connection takeover. A reconnect that reaches the server before it noticed the drop waits up to 15 s
  (`seatReservationTimeout`) for `onDrop`'s `allowReconnection`. The liveness sweep provides that within 4.5-5.5 s. The 6 s
  blackhole trials exercise exactly this path, and they come back.

## 6. Recommendations not implemented (owner questions)

1. **A lobby drop can turn into a planning MIA (from 8e4a4c4).** A player who closes the tab in the lobby (a 1001 close, not a
   consented leave) now has the seat held for 20 s. If the lobby closes into planning inside those 20 s, the grace runs out in
   planning, and that is MIA: a recorded run and death for someone who left the lobby. Before 8e4a4c4 it was a free leave. The
   options are: (a) the client sends a consented leave on `pagehide` while the phase is `lobby` (a reload then simply joins
   again); or (b) a seat that dropped in the lobby and never came back leaves free even if its grace ends in planning. Such a
   player never saw the deal, so that is no requeue exploit. Recommended: (a). It is small and keeps the planning rules as they
   are.
2. **The client's 3 s stall drop (`CLIENT_STALL_MS`).** With the burst fix, a 3-4.5 s interruption can be ridden out. The 3 s
   watch still turns it into a reconnect: back in 0.2-2 s here, a little longer through Cloudflare, with the "Reconnecting…"
   banner and a 33 KB resync. For a dead half-open socket, the server cannot release the seat before its 4.5-5.5 s sweep anyway
   (the SDK's reconnect waits for it). So raising `CLIENT_STALL_MS` to about 4500 would cost little detection time and avoid the
   reconnects. Not changed here: it is a feel trade-off.
3. **Deploys end every run in progress.** `npm run deploy` (`cf-deploy.mjs`) changes the release label, and the coordinator then
   stops the container (SIGTERM): every player gets 4001 ("The server is restarting") and the run is void. Nothing waits for the
   arena to be empty. If "everyone dropped at once" lines up with a deploy, that is the cause. A deploy gate that checks
   `/api/lobby` for an active arena (or a `--force`) would avoid it.
4. **Container inactivity during a run is unverified.** The coordinator sets `setInactivityTimeout(10 min)`. Cloudflare's docs
   say the timer runs after the Durable Object "becomes inactive" and name only requests as activity. They do not say whether
   WebSocket frames proxied through `getTcpPort().fetch` keep the object active (the `@cloudflare/containers` helper renews its
   own timer on WebSocket messages, which suggests the raw API does not). If a run ever outlives 10 minutes with no new HTTP
   request to the coordinator, the container could be stopped under it, which would drop everyone at once with the room gone.
   Worth a test: a long training run, watching `uptimeSeconds`. The cheap guard is a periodic request from the container to its
   own public `/readyz` while a room is open, or a longer timeout.
5. **What to read after the next incident.** Read `/readyz` within two minutes: `sockets.closed` (the last 10 close codes, with
   message counts and pending pings; with the fix, a 4002 there now means a real flood), `eventLoopDelayMs.max` over the last
   10-120 s (a server stall shows there), `worstTicks`, and `tick.catchupReanchors`. Players who saw "The run ended because of a
   server error." hit the 4002 trap.
6. **Instance size.** No change is needed for CPU: the tick uses about 10% of the vCPU, and the worst wakes are around 100 ms.

## 7. Checks run on the fixed tree

- `npm run typecheck`: clean in all three workspaces.
- Server: `messageBurst`, `liveness`, `uplinkBudget`, `room`, `botRoom`, `botGuards`, `botLobby`, `planningRoom`, `shutdown`,
  `training`, `botClient` and `visionSync` (after giving its hand-built room the new budget fields) pass. `metaRoom` failed twice
  at load 16 (a kill under load, unrelated). At load 12 it passed on both trees.
- Client: `rejoin`, `connection` and `lobbyNet` pass. Three failures are on the baseline (`5f5850f`) too, so they predate this
  change: `raidSteer.test.ts` (16 tests, `Cannot read properties of undefined (reading 'forEach')`), and `championGuide` and
  `championCombatModel` (one Wish-value test each), all from the Frost Wall commit. The map-bake, minimap and quest-pathing tests
  time out at 5-30 s under load and are not related to the network.
- `test/perf.test.ts` (timing): the bots' gate misses on both trees under the same load (whole-tick average 7.07 ms fixed against
  6.72 ms baseline, gate 5, load 2.5-3.3). The gate's reference machine is the owner's laptop, and the headless tick it measures
  does not go through the room's message handling. `test/bandwidth.test.ts` passes.
