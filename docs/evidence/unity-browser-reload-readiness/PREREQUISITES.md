# Coherent local run and durable result prerequisites — NOT RUN

## Source/artifact gate

Root first accepts the actual frozen98-case Editor run and rendered-layout check,
then builds a coherent Unity Web artifact from6d. A successor requires an explicit
Root-reviewed contract/input-equivalence amendment; do not label a later build6d
to satisfy the current checker's exact source field. Record the actual Editor/version,
source-before/as-built serialization overlay, BakedContent generator input,
resource names/lengths/SHA256, build logs and actual served/downloaded resource
hashes. Generate BakedContent from the **real matching native server `/info`**;
never patch a literal to simulate this chain.

Pin native source commit, build mode/features/target, executable SHA256, public
runtime argument profile, validated `rh-map/2` source-map SHA256, static Web root
and router configuration. Both actual endpoint `/info` results must match current
protocol14/content`7c6a633f68c2cc72`; the source identity is29/23/21/15. Pin the later
public Welcome content/protocol too. A hash of an old artifact or a stated commit
does not prove compile provenance. The a3d/643d Web proof and a0 native bridge are
historical, separate results.

The exact server must be built with Cargo's `--features postgres` for the DB/spool
profile (for example the not-run shape `cargo build --locked -p rh-server --features postgres`,
with Root's chosen build mode/target recorded). A fresh owned DB may also require
private `PLAYTEST_PASSCODE` provisioning for ordinary test-profile claims if that
gate is enabled. Do not print/read/reinject its value in this collector. The
existing profiles/disabled local gate case is a separately recorded configuration.

## Existing supported paths and routing

Normal Unity `JoinOwned` calls AccountFlow.PrepareJoinAsync and passes its owner
token opaquely as Hello ticket to the selected endpoint. `require_admit` defaults
false. No `/control/session` or `/control/admit` call is made by this UI path.
Thus the existing staging launcher omitting hosted-control flags is **not** a
blocker to ordinary direct owned Join. Hosted admission is a separate optional
path: Root privately creates/admit-reserves genuine owners, then normal UI joins
that reservation with `--require-admit`; do not invent a browser control route.

| Local role | Actual backend | Proposed single browser origin path |
| --- | --- | --- |
| Arena Source/account API |127.0.0.1:7777 | `/ws`, `/api/*`, `/info`, `/readyz` |
| Training |127.0.0.1:7779 | `/training/ws` rewritten to`/ws`; `/training/info` |
| Immutable coherent Web files | Root's actual artifact directory | `/` and `/Build/*` |
| Optional hosted control | loopback7778 and7780, private operator only | **Never public** |

The new `Caddyfile.local.proposal` is an exact bounded local route proposal derived
from the existing ordered staging routes, not an activated listener. It uses
`http://127.0.0.1:8888`, with static root supplied privately as
`RH_BROWSER_PROOF_WEB_ROOT`. Native processes retain7777/7779. Both browser match
URLs and account API share8888; different native ports fail the current
AccountConnectionPolicy scheme/host/port equality. Training API/control/probe
remain404. Actual CORS/upgrade/static compression/routing checks are still needed.
No TLS/WAN/staging acceptance follows from the local proposal.

## Concrete command shapes — placeholders, not executed

Root's private operator supplies the actual binary/path/DB value. Do not dump
arguments, environment, private configuration, tokens or process listings. The
source-only shapes below are not an installer and must not be pasted with
unresolved placeholders:

```text
<EXACT_SERVER> --runtime source-arena --map <VALIDATED_SOURCE_MAP>
  --bind 127.0.0.1:7777 --database-url <OPAQUE_PRIVATE_DB_VALUE>
  --instance-id <UNIQUE_SOURCE_INSTANCE> --result-spool <OWNED_DURABLE_SPOOL>
  --min-players 2 --fill-bots 0 --max-rooms 16 --lobby-seconds 30 --fill-seconds 5
  --bot-learning off --api-cors-origins http://127.0.0.1:8888

<SAME_EXACT_SERVER> --runtime training --bind 127.0.0.1:7779
  --database-url <SAME_OPAQUE_PRIVATE_DB_VALUE> --instance-id <UNIQUE_TRAINING_INSTANCE>
  --min-players 1 --fill-bots 0 --max-rooms 1 --lobby-seconds 0 --fill-seconds 0
  --bot-learning off --api-cors-origins http://127.0.0.1:8888
```

Training takes no Source map/spool profile and yields no normal result/banking.
For the optional hosted variant, add separately owned loopback controls, private
control-token-file references and `--require-admit --admit-ttl-secs 60`; perform
real private create/admit before initial normal UI Join. Never log/read/copy those
control bearer values or expose the controls through the browser router. The
current host-only `run-runtime.py` requires its verified encrypted mount/install
state and private runtime file; it is not a ready local launcher or permission to
deploy. Root must author/review any local orchestration adaptation separately.

Keep actual50ms native steps paced at ordinary20Hz. Do not use the bridge harness's
3ms wall wakes, paused Tokio clocks, extended reconnect grace or debug/world state.
Public command receipts record only allowlisted flags/configuration and opaque
private-configuration presence; no raw secrets/spool/replay record hashes are needed.

## Durable PostgreSQL and fsynced spool

Use an exclusively owned fresh PostgreSQL16 cluster and known database/schema,
with `fsync`, `synchronous_commit` and `full_page_writes` verified **ON** by fixed
SHOW queries. `tools/pgtest/start.sh` explicitly sets all three OFF and cannot
supply durable proof. Private DB connection material remains outside Git and
outside this collector. Do not query/copy token/hash columns or raw profile rows.

Keep Source spool in an owned durable directory outside Git, with unique process
instance/lease ownership, capacity and writable parent. The existing spool append
does temp write→file fsync→rename→directory fsync before durable handoff. Do not
read/copy raw spool or private replay contents into public evidence; use reviewed
allowlisted counters/outcome receipts. Start no shared PostgreSQL cluster and
delete no existing state. Root records owned startup, orderly process shutdown,
writer fencing, pending/dead status and cluster teardown separately.

## Genuine Source match → actual Result → authenticated receipt

1. Establish actual accounts through ordinary UI and real public APIs; require
   current ownership after reload, with natural credential handling. Do not fetch,
   inject or record profile tokens/recovery keys/seat capabilities.
2. Use the actual full Source map/lifecycle, two ordinary human seats, normal
   Plan/Ready and public-coordinate input. Reach real combat/outcome and genuine
   native Result. No installed Result, fake kill, mutated HP, synthetic banking
   receipt, shortened lifecycle or accelerated wall pacing.
3. Correlate actual Result to the current public Welcome raw match ID/network UUID
   and owner generation. Source fsynced spool must reach PostgreSQL commit and
   normal reconciliation. Record only public outcome/GV and reviewed aggregate
   pending/dead counts, not raw records.
4. The client calls existing authenticated
   `GET /api/profile/{name}/matches/{network-order-Welcome-UUID}/settlement` through
   its normal service. Keep the `x-profile-token` header opaque; no HTTP interceptor
   or raw response capture. Whitelist only v1/matchId/status and, for committed,
   settlement.outcome/gvCredited. `unknown` means no known own commit, **not pending**;
   never add a local balance or infer a ledger write from displayed Result alone.
5. Observe ordinary UI receipt adoption and authenticated profile reconciliation,
   with wrong-owner/match and delayed completion fenced by current source guards.
   Training must never generate a normal Result/receipt.

Existing full-runtime-account-bridge/root-retake proves genuine a0 loopback
HTTP/WS Source outcomes, two fsynced records and PostgreSQL/profile reconciliation,
but uses a small map and3ms wall wakes. Owned-bank-receipt proves the finite read
contract; settlement64/native UI gates prove their finite client scopes. These
separate proofs do not establish this new native29 Unity→durable receipt chain.
Cold restart/host loss, long-match/full population, physical browser performance,
TLS/WAN/Calgary hosting, cost and backup/restore remain separately open.
