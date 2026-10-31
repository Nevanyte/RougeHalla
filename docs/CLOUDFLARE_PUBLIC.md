# Public Cloudflare deployment

`play.roguehalla.com` is a Custom Domain of Worker `rougehalla`. The Worker serves the built browser assets and forwards game HTTP/WebSocket traffic to one Durable Object-managed Node container. Profiles are hydrated from private R2 storage before Node starts listening and saved with conditional ETags. The publishing computer is only needed to build and upload releases. The previous Mac game process and automatic deploy watcher are stopped.

Keep `workers_dev: true` explicit when adding custom domains. Containers started through the staging hostname can still use that hostname for authenticated snapshot writes; Wrangler otherwise disables the Workers hostname when routes are configured. Both hostnames reach the same authoritative game process and private R2 objects.

This migration preserves main's gameplay at `377bbfb530004dd005b22c763f45775dac5777f8`. The production server and map worker are compiled to JavaScript before deployment, so their TypeScript loader does not consume the container's startup CPU allowance. `/build-info.json` reports that gameplay base and a source, dependency and compiled executable digest. `/readyz` independently computes the digest inside Node; the Worker refuses to forward gameplay until it matches.

## Publish

Use Node 24 and a running Docker build engine, with the existing Cloudflare account authenticated in Wrangler:

```sh
npm ci
npm run typecheck
npm test
npm run cf:typecheck
npm run cf:test
npm run build
node --import tsx scripts/deploy-smoke.mjs --compiled
npm run deploy
npm run latency -- --url https://play.roguehalla.com
```

The container uses `standard-1` (half a CPU and 4 GiB memory). Admission permits one arena room (up to eight players) and two private training rooms. Additional arenas receive the existing server-full response. Cloudflare chooses container and edge locations; this setup does not guarantee a particular city.

Validation on 2026-10-30 used Cloudflare's `sjc06` allocation. A six-player arena with filler bots completed 150 measurements at 73.8 ms median and 81.7 ms p95, with all six players alive throughout. After routing the public domain, 100 private Training measurements returned 75.7 ms median and 110.5 ms p95 without disconnecting. The Mac's game port was closed during the public checks; ownership, tokens and profile contents were verified for all 19 Mac accounts and 13 original cloud accounts.

With `CLOUD_GAME_WARMUP=1`, readiness waits for a bounded, isolated simulation warm-up: 400 ticks of bot play and the production serializer, capped at forty seconds. This world has no human profiles, sockets or learning store. The warm-up primes V8 before admitting the first player; its progress appears in `/readyz`. The first connection after an idle shutdown can take about a minute to become ready; the startup deadline is 75 seconds and the profile client allows 100 seconds.

Do not switch the public domain until a hosted arena test passes. Run `node scripts/cloud-arena-probe.mjs https://rougehalla.mckinnonnevin.workers.dev` only while that staging address is isolated from public matchmaking. It checks a full arena with filler bots and reports socket round trips and state patch spacing. `/readyz` also reports process CPU time, event loop delay and map pool counters. The release fingerprint includes the selected instance size, so changing its capacity drains the old process and starts the new allocation.

The coordinator returns the container's native WebSocket upgrade response directly and monitors its Node process. Every internal request carries the expected controller release. An older coordinator drains Node and resets itself before a new release starts, so lifecycle monitoring cannot pin an obsolete image indefinitely. Bump `CONTROLLER_VERSION` for coordinator-only behavior changes. Application packets also refresh transport liveness, since a proxy may consume WebSocket control pongs.

## Measure latency before changing capacity

Use `npm run latency:layers -- --url https://play.roguehalla.com --samples 60 --token-file /private/path/probe-token.txt --output /private/path/result.json` to compare three persistent WebSocket echoes: the edge Worker, the Durable Object coordinator, and the Node transport. Set the dedicated `NETWORK_PROBE_TOKEN` Worker secret to a random 64-character hexadecimal credential and keep its matching local file private. This credential is separate from `PROFILE_SNAPSHOT_TOKEN`; never use a profile-storage credential in a diagnostic command. The routes return 404 without authorization, accept only bounded binary frames, and have connection, message and lifetime limits. The script has a 50-second total handshake/sampling budget; reduce samples or interval on a slow connection. It creates no game room or account. Optional `--family 4` or `--family 6` and `--pin-dns` help control destination-address differences; these only affect this diagnostic, not player connections.

On 2026-10-30, two quiet sampling windows from the publishing computer on the existing `standard-1` allocation used 60 interleaved measurements per layer:

| Echo endpoint | Before median / p95 | After median / p95 |
| --- | ---: | ---: |
| Cloudflare edge | 68.1 / 72.1 ms | 70.1 / 71.4 ms |
| Coordinator | 74.1 / 82.1 ms | 93.6 / 133.0 ms |
| Node transport | 76.0 / 86.1 ms | 97.2 / 103.5 ms |

Five warm-up replies per socket were discarded. No game room was active during these transport-only samples. Node's echo callback was 0.113 / 0.418 ms median/p95 before and 0.082 / 0.181 ms after; its final cumulative timer-overshoot p95 was about 2.0 ms before and 0.66 ms after. The handler measurement starts after Node dispatches a message and ends before send, so it excludes earlier scheduling, kernel queues, simulation work and delivery. Differences between layer distributions include routing and scheduling and are not a precise additive CPU breakdown. The higher RTT in the later window must not be presented as a code speedup or attributed to a CPU regression from these samples. The process-wide `/readyz` event-loop percentile also includes cold simulation warm-up and is not current queue delay. SDK game pings are answered immediately; simulation tick and rendering delay are separate from measured ping.

Additional 30-sample IPv4, IPv6 and pinned-address checks still varied by connection: `Cf-Ray` reported LAX and SEA processing locations even when the destination IP was fixed. That header identifies a processing location, not necessarily network ingress. The Workers hostname did not show a reliable advantage over the public hostname (about 94 versus 96 ms origin-echo medians in the pinned IPv4 pair), so player routing remains on the public origin. These are observations from one computer and time window, not guarantees for every player or ISP. Cloudflare documents that [anycast/ISP routing can select different processing locations, including between IPv4 and IPv6](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/geographic-traffic-routing/); customers cannot pin a serving city per visitor through zone or account settings.

The matched private Training check used the `ws` SDK transport (`node --no-experimental-websocket scripts/latency-probe.mjs --url https://play.roguehalla.com --samples 30`). Before the responsiveness changes it measured 82.1 ms median and 124.3 ms p95; afterward, 77.1 ms median and 125.2 ms p95. State-patch intervals were 50.1 / 63.8 ms median/p95 before and 51.0 / 100.7 ms after. These separate windows do not establish a transport or patch-tail improvement. Keep the client transport, sample count and server capacity consistent for comparisons. The browser check separately verified movement and attacks, observed roughly 76–81 ms ping, and reported no console errors on the updated public bundle.

More CPU can help when simulation work queues under load. It does not remove the network path already measured at the edge. Cloudflare's [instance sizes](https://developers.cloudflare.com/containers/platform/limits/) change CPU, memory and disk, while [placement constraints](https://developers.cloudflare.com/containers/concepts/placement/) select broad regions. This deployment already requests western North America; those controls do not pin Edmonton or Calgary. Keep capacity unchanged until load measurements justify a change.

Client responsiveness is measured separately. Directional attack presses now start a brief local figure cue immediately; authoritative windups take over without restarting the visible pose. The cue predicts no hits, projectiles, damage or cooldowns and is cancelled on movement, rejected/lost replies, weapon changes and scene transitions. The integration test exercises the real RaidScene/FxView/FigurePose path at 280 ms estimated order delay and checks a visible offset within 16 ms. Camera follow uses a 35 ms time constant instead of 55 ms: the deterministic walking/jitter fixture reduces steady follow lag from about 9.2 to 5.6 world units while increasing its small alternating correction from about 0.6 to 0.9 units. These changes affect presentation, not transport RTT.

The [paired bot/state-update benchmark](../packages/server/bench/state-update-results.md) records the remaining CPU costs and its limitations. State encoding/fanout was about 1% of measured CPU; it already shares encoded patches, so the network schema and 20 Hz cadence were retained. Duplicate bot visibility work was removed, with original visibility and final gameplay-state comparisons passing. Full-room CPU differences were modest and close to run-to-run variation; the isolated moving-bot frame benchmark improved by about 5%.

## Profile migration and restarts

Never run two authoritative profile writers against separate snapshots after routing the public domain. Before a migration, disable the old Mac automatic deployment watcher, gracefully stop its game server so profiles flush, and privately back up both the local profile file and R2 object. Merge records without changing tokens, stats, cosmetics or progress. Resolve any overlapping names before importing; do not silently replace an owner.

For a profile import, deploy with `GAME_MAINTENANCE=1` and request `/readyz` to drain the previous cloud writer. Confirm the container is stopped before exporting or replacing R2 snapshots. The maintenance release refuses to restart it. Remove maintenance and change `PROFILE_EPOCH` after the import, then verify profile ownership before routing public traffic.

Player profiles use `rougehalla-profiles/profiles/current.json`. Bot learning uses the separate `bots/current.json` object, is hydrated before startup, and is mirrored every 30 seconds and on graceful shutdown. Player ownership and shop writes wait for durable confirmation. `PROFILE_SNAPSHOT_TOKEN` remains a Worker secret. Keep snapshots outside Git with private file permissions. Back up and import the Mac's `bot-stats.json` as well as its player profiles during the final migration.

After deliberately importing a new authoritative snapshot, change the `PROFILE_EPOCH` Worker variable and deploy. This makes the coordinator gracefully restart the same container image so it hydrates the imported data. It does not replace the independently checked executable digest. Ordinary code deployments use a changed source digest and do not need an epoch change.

`npm run deploy` publishes the public Cloudflare game; `cf:deploy` remains an alias for the same pipeline. `deploy:status` reads the current cloud deployment. The old Mac release manager is available only under explicit `deploy:local` commands, defaults to a loopback URL, and refuses the public domain or Workers hostname. The local watcher and named playtest launcher refuse those cloud hostnames as well. Existing watcher status/stop aliases remain available so an old installation can be disabled.

## Recovery

Back up the current R2 object before any rollback. A rollback to the Mac must first stop the cloud writer, export its latest authoritative profiles and restore them to the Mac's profile file before starting the local server and returning DNS to the tunnel. Reusing the pre-migration local snapshot would discard cloud progress. In-progress matches do not survive a server restart.
