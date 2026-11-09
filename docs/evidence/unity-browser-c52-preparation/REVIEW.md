# Source review and bounded offline verification

Tool source cut: `4cf33c4a5545378650db1111146576c89e20ceda`.
Native c52 and current Unity 57e are distinct artifact sources. The earlier
`PRECHECK.json` remains unchanged; `PRECHECK-57E.json` is the successor inventory,
not a relabelled earlier result. Web1 remains held and no Web2 bytes were read.

The independent source review accepted the collector retarget and required the
following router corrections before this cut was frozen:

- Replace every incoming WebSocket XFF header with exactly the actual peer,
  preserving Origin and credential headers opaquely.
- Restrict upgrades to the two admitted WS paths; reject private routes and
  unknown Training paths. Static requests require an exact manifest entry.
- Stream startup SHA verification and static responses, with no full Web buffers;
  require no-follow file opens and unchanged file identity. An explicit `/` entry
  admits the page root; no SPA fallback exists.
- Cancel upstreams on client abort, including a disconnect before TCP connect.
- Track all accepted sockets, HTTP upstreams and upgraded pairs. Teardown destroys
  those owned resources; a partial dual-bind failure waits for both attempts and
  uses the same cleanup.
- Preserve ordinary warm reload caching using no-cache revalidation and SHA ETags.

The final bounded independent close/dual-bind review found no remaining blocker
in that source scope. This is source review, not observed socket/HTTP behavior.
Real routing, static serving, compression, CORS, upgrades, resource integrity,
browser behavior and teardown still need the released local run.

The runtime has no Caddy or package dependency. Import does not start listeners.
Future startup, only after Root's full runtime release, is:

```text
RH_ROUTER_MANIFEST=<owned-state>/config/router-assets.json
RH_ROUTER_ROOT=<sealed-web-build-57e166-2026-11-09>/Web
node tools/unity-browser-reload-proof/local-router.mjs --standalone
```

Those non-secret variables must be supplied in the actual process environment.
The strict manifest format is `unity-router-assets/1` with `files` rows containing
`path`, relative `file`, `sha256`, `bytes`, `contentType` and optional `encoding`.
Only declared gzip/br URLs get a Content-Encoding header. Root must derive each
row from Art's sealed resources, review the map from URL to file, and SHA-pin that
manifest. No illustrative or previous-build manifest is admitted here. Both
listeners are fixed to 127.0.0.1 and ::1 at 8888, incoming Host is exactly
localhost:8888, and upstreams are fixed to 127.0.0.1 ports 7777/7779. Router logs
contain only fixed startup/refusal text; bodies, frames, headers, queries and
credentials are never evidence output.

The installed Node ran the affected collector tests once: **8 passed / 0 failed**.
The new router tests ran once: **6 passed / 0 failed**. These use synthetic rows,
pure routing functions and injected in-memory bytes; they create no sockets and
read no Web artifacts. No broader inherited suite was rerun. `OFFLINE_CHECKS.json`
binds exact argv, source cut, output hashes and exit codes to their raw logs.
The generated not-run template correctly yields **OPEN**, no failures and
`NOT_GRANTED_BY_COLLECTOR`, with expected CLI exit 2. Whitespace checks pass.

Runtime-plan review also corrected the argv-only DB setting, long macOS socket
path, local-only durability claim, exact peer role mapping and Training release
before drain. PG data/spool/logs remain under the one private state root; only the
short socket has its separate approved path. Nothing in these corrections starts
or authorizes a runtime. The collector cannot by itself verify quests, traders,
Result or authenticated settlement; those need the separate ordinary gameplay
cases and Root-reviewed evidence. Actual browser/runtime/performance acceptance
remains **OPEN**.
