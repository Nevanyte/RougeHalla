# Public Cloudflare deployment

`play.roguehalla.com` should be a Custom Domain of Worker `rougehalla`, not a DNS route to the laptop's named tunnel. The Worker serves the built browser assets and forwards game HTTP/WebSocket traffic to one Durable Object-managed Node container. Profiles are hydrated from private R2 storage before Node starts listening and saved with conditional ETags. The publishing computer is only needed to build and upload releases.

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

The container remains the existing `basic` size. Admission permits two arena rooms and two training rooms. This is an admission limit, not a capacity guarantee. Cloudflare chooses container and edge locations; this setup does not guarantee a particular city.

Do not switch the public domain until a hosted arena test passes. Run `node scripts/cloud-arena-probe.mjs https://rougehalla.mckinnonnevin.workers.dev` only while that staging address is isolated from public matchmaking. It checks a full arena with filler bots and reports socket round trips and state patch spacing. `/readyz` also reports process CPU time, event loop delay and map pool counters. The release fingerprint includes the selected instance size, so changing its capacity drains the old process and starts the new allocation.

## Profile migration and restarts

Never run two authoritative profile writers against separate snapshots after routing the public domain. Before a migration, disable the old Mac automatic deployment watcher, gracefully stop its game server so profiles flush, and privately back up both the local profile file and R2 object. Merge records without changing tokens, stats, cosmetics or progress. Resolve any overlapping names before importing; do not silently replace an owner.

R2's object is `rougehalla-profiles/profiles/current.json`. `PROFILE_SNAPSHOT_TOKEN` remains a Worker secret. Keep snapshots outside Git with private file permissions.

After deliberately importing a new authoritative snapshot, change the `PROFILE_EPOCH` Worker variable and deploy. This makes the coordinator gracefully restart the same container image so it hydrates the imported data. It does not replace the independently checked executable digest. Ordinary code deployments use a changed source digest and do not need an epoch change.

The old `npm run deploy` and `deploy:auto` commands deploy a server on the Mac; they are local playtest tools and must not be used as the public cloud release pipeline. Publish public updates with `cf:deploy` from a revision containing these cloud changes.

## Recovery

Back up the current R2 object before any rollback. A rollback to the Mac must first stop the cloud writer, export its latest authoritative profiles and restore them to the Mac's profile file before starting the local server and returning DNS to the tunnel. Reusing the pre-migration local snapshot would discard cloud progress. In-progress matches do not survive a server restart.
