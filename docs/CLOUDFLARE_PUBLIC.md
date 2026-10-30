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
npm run cf:deploy
npm run latency -- --url https://play.roguehalla.com
```

The container uses `standard-1` (half a CPU and 4 GiB memory). Admission permits one arena room (up to eight players) and two private training rooms. Additional arenas receive the existing server-full response. Cloudflare chooses container and edge locations; this setup does not guarantee a particular city.

Validation on 2026-10-30 used Cloudflare's `sjc06` allocation. A six-player arena with filler bots completed 150 measurements at 73.8 ms median and 81.7 ms p95, with all six players alive throughout. After routing the public domain, 100 private Training measurements returned 75.7 ms median and 110.5 ms p95 without disconnecting. The Mac's game port was closed during the public checks; ownership, tokens and profile contents were verified for all 19 Mac accounts and 13 original cloud accounts.

With `CLOUD_GAME_WARMUP=1`, readiness waits for a bounded, isolated simulation warm-up: 400 ticks of bot play and the production serializer, capped at forty seconds. This world has no human profiles, sockets or learning store. The warm-up primes V8 before admitting the first player; its progress appears in `/readyz`. The first connection after an idle shutdown can take about a minute to become ready; the startup deadline is 75 seconds and the profile client allows 100 seconds.

Do not switch the public domain until a hosted arena test passes. Run `node scripts/cloud-arena-probe.mjs https://rougehalla.mckinnonnevin.workers.dev` only while that staging address is isolated from public matchmaking. It checks a full arena with filler bots and reports socket round trips and state patch spacing. `/readyz` also reports process CPU time, event loop delay and map pool counters. The release fingerprint includes the selected instance size, so changing its capacity drains the old process and starts the new allocation.

The coordinator returns the container's native WebSocket upgrade response directly and monitors its Node process. Every internal request carries the expected controller release. An older coordinator drains Node and resets itself before a new release starts, so lifecycle monitoring cannot pin an obsolete image indefinitely. Bump `CONTROLLER_VERSION` for coordinator-only behavior changes. Application packets also refresh transport liveness, since a proxy may consume WebSocket control pongs.

## Profile migration and restarts

Never run two authoritative profile writers against separate snapshots after routing the public domain. Before a migration, disable the old Mac automatic deployment watcher, gracefully stop its game server so profiles flush, and privately back up both the local profile file and R2 object. Merge records without changing tokens, stats, cosmetics or progress. Resolve any overlapping names before importing; do not silently replace an owner.

For a profile import, deploy with `GAME_MAINTENANCE=1` and request `/readyz` to drain the previous cloud writer. Confirm the container is stopped before exporting or replacing R2 snapshots. The maintenance release refuses to restart it. Remove maintenance and change `PROFILE_EPOCH` after the import, then verify profile ownership before routing public traffic.

Player profiles use `rougehalla-profiles/profiles/current.json`. Bot learning uses the separate `bots/current.json` object, is hydrated before startup, and is mirrored every 30 seconds and on graceful shutdown. Player ownership and shop writes wait for durable confirmation. `PROFILE_SNAPSHOT_TOKEN` remains a Worker secret. Keep snapshots outside Git with private file permissions. Back up and import the Mac's `bot-stats.json` as well as its player profiles during the final migration.

After deliberately importing a new authoritative snapshot, change the `PROFILE_EPOCH` Worker variable and deploy. This makes the coordinator gracefully restart the same container image so it hydrates the imported data. It does not replace the independently checked executable digest. Ordinary code deployments use a changed source digest and do not need an epoch change.

The old `npm run deploy` and `deploy:auto` commands deploy a server on the Mac; they are local playtest tools and must not be used as the public cloud release pipeline. Publish public updates with `cf:deploy` from a revision containing these cloud changes.

## Recovery

Back up the current R2 object before any rollback. A rollback to the Mac must first stop the cloud writer, export its latest authoritative profiles and restore them to the Mac's profile file before starting the local server and returning DNS to the tunnel. Reusing the pre-migration local snapshot would discard cloud progress. In-progress matches do not survive a server restart.
