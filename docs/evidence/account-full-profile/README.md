# Full account data and shop handoff

Continuation from clean `843a03e4fb4de9b51b2471b916b25edda8a3359f`. This supplies the reusable full-profile,
presentation catalog and existing HTTP shop/leaderboard layer to the independently owned UI lane. It edits no
Bootstrap, MatchClient, MatchHud, scene/prefab hierarchy, Rust server, schema, protocol, Cargo.lock or shared status.
No Editor, Web build, cloud action or live data migration ran for this candidate.

## Consumer contract

Keep one AccountCoordinator/AccountSession/UnityAccountTransport on the persistent main-thread page owner, outside
menus/results. Coordinator.Api is available when the initialized transport supports IAccountApiTransport.
Flow.CreateApiService returns the same service for that flow/transport and refuses a replacement transport; local
per-owner mutation serialization therefore survives repeated factory consumers. These APIs are main-thread APIs.

- Flow.OpenProfileAsync / Api.ReadProfileAsync use the admitted AccountSession claim/open path. A successful minimal
  response retains its validated token in memory and attempts confirmed storage even when complete maps cannot decode.
  OwnedAccount.FullProfile is optional; OwnedAccount.HasFullProfile and summary HasFullProfile reflect actual data.
  Snapshot.FullProfile is immutable, and Snapshot.FullProfileFailure is Unreadable when ownership is valid but the richer
  data is unusable. Summary/ordinary Join consumers remain usable. No independent unauthenticated GET bypasses recovery.
- Api.CreatePurchase(itemId) / CreateEquip(slot,itemIdOrNull) require current confirmed ownership. Keep the returned
  AccountMutation object for the intent; call SendAsync(operation) for an explicit first attempt or retry. Its Id is
  generated once. Purchase reuses that UUID in every Idempotency-Key; never manufacture a replacement intent merely
  because an earlier response was absent. Equip Id is only local correlation, not a durable server idempotency key.
- Operations are serialized per endpoint+normalized owner. After queueing, ownership/generation is checked again before
  transmission. A started request finishes independently of caller cancellation so its acknowledgement/unknown outcome
  can be retained. A response can change the selected profile only if its owner/generation is still current; synchronous
  Changed-event selection/reentrancy is checked after publication too. Selection changes do not remove pending metadata.
- AccountMutation.State is Ready/InFlight/Confirmed/Refused/Unknown. Unknown means a commit may have happened (including
  timeout, disconnection, HTTP5xx, malformed/mismatched HTTP200). PendingOperations returns secret-free metadata for
  Ready/InFlight/Unknown operations across name switches; the caller can retain the operation for explicit retry after
  reopening that owner. A late acknowledgement records Confirmed without publishing into another selected profile.
  No money/item/equip change appears before a matching complete HTTP200 profile. Refusals preserve the previous profile.
  Retrying equip after an uncertain result deliberately resubmits that set: timeout is no rollback, and an older unknown
  server operation can finish later, so this is no guarantee of globally latest intent. Refresh/reconciliation is explicit.
- Api.ReadLeaderboardAsync(month:null,limit:20,includeOwner:false) returns delivered public data by default. includeOwner
  requires confirmed current ownership and uses a header token for the named rank. Concurrent queries have a generation:
  an older month/owner response cannot replace the latest view. Call Api.IsCurrent(result) immediately before consuming
  owner/month-specific success or error state. Failure and PublishedCurrent remain explicit; no returned bearer token is
  exposed in these UI result objects. The mutation object/request and OwnedAccount are secret-bearing, never log them.
- Existing PrepareJoinAsync / CanJoin rules remain: check CanJoin immediately before synchronous actual Join, with no
  intervening await. A full-profile refresh invalidates older Join intents. No new placement, mode or training authority.

## Exact existing HTTP contract

The immutable AccountEndpoint's full normalized API base scopes credentials and all requests. Every send checks the
normalized HTTP(S) scheme/host/port and base-path prefix before transmitting. Redirects are disabled. No credential
origin is inferred from a WS URL. The admitted page-default/matching-WS and loopback-only diagnostic rules are unchanged.
Tokens/passcodes appear only in their explicit headers; no token-bearing URL or log/export is added. Requests contain
Accept:application/json and POST Content-Type:application/json; no request Cache-Control header is added. Existing
server CORS allows x-profile-token,x-playtest-passcode,content-type,idempotency-key and supplies response no-store.

| Route | Body / headers | Success and retry meaning |
| --- | --- | --- |
| GET /api/profile/{name} | x-profile-token for open; x-playtest-passcode optional for a new claim | `{profile,token,created}`. GET can claim a free name, so all full reads reuse AccountSession. A new validated token is retained even if richer maps fail. |
| POST /api/profile/{name}/purchase | `{id:string}`, owner header, stable Idempotency-Key:UUID | `{profile}`. Same UUID+durable owner+item is already-applied200; UUID reused with another item/owner is409. Missing-header fresh purchase behavior is never used by this client. |
| POST /api/profile/{name}/equip | `{slot:string,id:string|null}`, owner header | `{profile}`. Set/clear operation with no durable request UUID. An uncertain response needs refresh or deliberate retry. |
| GET /api/leaderboard | query month=YYYY-MM (optional), limit1..100, name only when includeOwner; owner header only in that mode | `{month,entries:[{name,gv,title?}],months,you?:{rank,gv}}`. Null month requests the server's current UTC month. Public results containing an owner rank, wrong requested month, or too many entries fail closed. |

Typed shop statuses/codes mirror actual source: forbidden403, bad_request400 (body/media413/415 also bad request),
unknown_cosmetic404, unknown_slot400, not_for_sale409, already_owned409, insufficient_gv402 with exact need/have,
not_owned409, slot_mismatch400. Unknown/malformed error text is not displayed as trusted data. HTTP408/429/5xx or loss
of response keeps mutation Unknown; a read-back failure can happen after a durable server commit. The transport caps
UTF8 mutation bodies at the existing1024-byte limit. No automatic retry, rekey, debit, grant or rollback is performed.

## Full JSON and numeric domains

AccountFullProfile includes name,gv,gvLifetime,gvByMonth; runs/wins/draws/deaths/kills; cosmetics.owned/equipped;
achievements timestamp map; qualifiedWins/bountyRuns/bestRunKills/winsByFaction/winsByWeapon. Required objects, arrays,
strings and integer tokens are checked explicitly; missing/null/malformed required values fail closed. All current
counter/timestamp/GV fields are exact nonnegative signed Int64, not floating point or numeric strings. This intentionally
accepts values above JavaScript's safe-integer range because SQL accumulation is not capped there. Month keys are exact
YYYY-MM with month01..12. Callsigns use actual ASCII2..16 alnum/underscore/hyphen canonicalization, no trim/Unicode fold.
Map identifiers and unknown owned/reward IDs remain data; future object properties are ignored safely. DTO collections
are copied into read-only wrappers. Catalog code/color are UInt32; optional price Int64; width finite numeric. Rank>=1.
The checked-in schema/inventory records the current server source closure; it is documentation, not a second authority.

AccountFullJson uses the existing official Unity Newtonsoft package3.2.2 (Json.NET13.0.2) with explicit JToken DOM
validation and constructors, no dynamic/ToObject/reflection DTO factories. It bounds text1Mi characters/depth64, rejects
duplicate properties/trailing documents, disables date coercion, and rejects invalid integer kinds/overflow. Canonical
DTO core has no JSON dependency. Only the .NET test project pins Newtonsoft.Json13.0.2 and compiles the same decoder
source used by Unity. A pinned Unity6000.0.85f2 API-reference compile used the official package Runtime/AOT DLL (SHA256
`a56146202232958f46bd6a28b5a7da166aea123ee0d646735a46e5c341dfbf1f`), not an invented WebGL/HttpClient implementation.
The package includes a WebGL-enabled AOT plugin and link.xml; these are supporting metadata, not an actual IL2CPP proof.
Root owns explicit UPM Client.Add pin and the subsequent combined Editor/IL2CPP/browser gates. No package manifest or
packages-lock was hand edited. Package license/provenance and unmodified third-party notices are included beside this file.

## Bundled presentation catalog

Resources.Load<TextAsset>("Account/cosmetics") and ("Account/achievements") supply generated immutable DTO input via
AccountFullJson.TryCosmeticCatalog / TryAchievementCatalog. These exports contain all57 cosmetics (37 listed prices,
14 slots) and26 achievement labels/descriptions/reward references. They contain no goal data/evaluator, rolls, eligibility
or client price calculation. Current owned/unlocked/equipped facts come only from the delivered profile; the server
alone validates purchases/equips and awards achievements. Prices/labels here are display facts and may be stale against
a differently deployed server, whose response always decides. Unknown profile IDs can be shown as unknown data safely.

`tools/account-catalog/export.sh --check` compares every Rust authoritative cosmetics entry to actual imported shared
COSMETICS, and shared achievement IDs/rewards to the existing Rust parity fixture, then checks byte-exact exports/source
hashes. `--write` intentionally regenerates only these three JSON resources. It imports actual constants via the pinned
Node22.23.4 Docker image and lockfile dependencies in tmpfs, without copying evaluator code into Unity. Achievement Rust
source is hashed for closure; this new catalog check does not rerun or claim additional Rust achievement gameplay parity.

## Evidence and remaining gates

Focused new tests cover exact Int64/unknown-map preservation; malformed/duplicate/trailing data; authoritative catalog
metadata; typed error/status checks; malformed-rich-data valid-created-token recovery with blocked persistent store;
authenticated same-name retry; no standalone claim GET; singleton serialization; no optimistic changes; purchase same-UUID
unknown-response retry; selection changes while queued/in-flight; late refusal and acknowledgement fencing; reentrant
Changed selection; cancelled unknown equip/clear; private rank and out-of-order month fencing. The one full C# suite,
source manifest and check receipts are recorded in checks.json. Existing PG/result-spool suites were not rerun.

This is an API/data handoff, not full-profile screen completion or browser delivery proof. The UI lane still integrates
labels/actions/refresh/pending state. Actual cross-origin WebGL preflight and Json.NET AOT/stripping/packaging require the
root's combined build/browser gate. Page memory is lost on OnDestroy/page close/reload; blocked storage cannot promise
reload recovery. OnDisable/timeouts/network handoff can still lose delivery, so a persistent transport is required and
ambiguous server operations remain unknown. Pending metadata is page-lifetime, not a durable operation journal. Existing
profile/result endpoints supply no per-match banking receipt: ResultBankConfirmed remains false, and profile counters
cannot prove a specific match committed. No new banking-receipt endpoint is invented here. Backend backup/cold-restore
proof is owned by the separate lane, not asserted by these tests.
