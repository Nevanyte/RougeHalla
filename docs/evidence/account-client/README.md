# Independent account client layer

This new-file candidate follows the local durable-flow proof `45daa414c719568397c8d2695c3d3b136e099e72`, based on
`198902f4`. It adds an engine-independent ownership coordinator and a thin Unity transport/storage implementation.
Bootstrap, MatchClient, MatchHud, Session, server code, gameplay, wire/schema/version identities and dependencies are
unchanged. It is not connected to the ordinary menu yet and is not full account UI or a public training/placement route.

## Interfaces and exact ownership behavior

- `AccountEndpoint.FromPage(pageUrl, explicitApiBase)` defaults to the HTTP(S) page origin plus `/api/`. An explicit
  development endpoint must be HTTP(S), end in `/api`, and have no user information, query or fragment. Prefix paths are
  retained and HTTPS pages cannot downgrade to HTTP. Nothing derives an account endpoint from a match WebSocket URL.
  The full normalized API base, including its prefix, is the credential namespace.
- Rust `rh_persist::valid_callsign` accepts only2–16 ASCII letters/numbers/underscore/hyphen and does not trim. The
  coordinator follows that validation before case folding; it preserves the requested spelling in the claim URL and
  the server-returned canonical display spelling. Lowercased validated ASCII names key locks/storage, consistent with
  Rust's `lower(callsign)` uniqueness/lookup. A response for any other normalized name is rejected.
- `IAccountTransport.GetProfileAsync` performs GET `/api/profile/{name}`; the owner token and optional playtest passcode
  are only `x-profile-token` and `x-playtest-passcode` headers. `AccountSession.OpenAsync` confirms the returned envelope
  before storing a credential or publishing `Current`. A returned open token must equal the presented credential; a new
  claim must return the actual server's64lowercase-hex minted-token shape. Invalid/missing identity, token, stats or
  counters cannot become owned. Errors have fixed typed categories; raw response/transport details are not exposed.
- One `AccountSession` is the page/endpoint ownership coordinator. Calls for the same normalized name serialize. The
  second request re-reads the first confirmed credential, so two calls cannot race an unauthenticated first claim.
  A cleared/cancelled queued selection never starts a new claim. A request already started finishes independently of
  selection cancellation: a validated late200 stores the sole credential under its original endpoint/name key, while
  generation checks suppress stale `Current`, return an unowned cancelled result and prevent stale `CanJoin` publication.
  Validated tokens are retained in the page-lifetime coordinator before persistent I/O; same-name retries prefer that
  recovered credential even if storage returnsfalse or throws. `CredentialRecoveryFor(name)` reports non-secret
  None/PageLifetimeOnly/Persistent status independently of selection. A late claim therefore remains reopenable within
  this page when persistent storage fails, without silently promising reload durability.
  Persistent means the configured credential store reported a successful write; browser reload/storage durability still
  requires the actual browser gate below.
  This preserves the legacy module's confirmed-token recovery behavior. Caller cancellation detaches selection/wait;
  it does not discard the only confirmed token. The coordinator contains no automatic Join or control API call.
- A proven stored credential wins over an unproven sign-in key. Only after the server explicitly refuses it can a
  pending key be tried; a wrong pending key/network failure never deletes the older proven key. Storage can be blocked:
  the confirmed session remains usable, with `CredentialSaved=false` for the later UI to handle honestly.
- `OwnedAccount.HasFullProfile` is alwaysfalse: this first DTO reads name/GV/lifetime/stats and the created/token envelope.
  Returned monthly maps, cosmetics/equipped looks, achievements and progress dictionaries are deliberately unsupported
  here and remain in the account lane's ownership. This does not claim a complete profile/progression interface.

## Actual Unity API implementation

`UnityAccountTransport` uses UnityWebRequest on the Unity main thread with a10second timeout, redirects disabled,
no credential URL/log output, and no worker-thread or HttpClient dependency. Disable settles pending tasks and disposes
requests. The transport should live across ordinary profile/menu selection changes; clear the coordinator's selection
instead of destroying a started claim. `PlayerPrefsAccountCredentials` stores only confirmed bearer ownership under
`rh.account.owner.v1.<escaped-full-api-base>.<normalized-name>` and reports storage failure. It never stores profile
progression as authority. The parser uses JsonUtility.FromJsonOverwrite into preconstructed invalid sentinel counters,
so absent fields cannot silently appear as zero; source and tests explicitly mark the DTO as a summary.

Unity-specific API choices were checked against the actual installed6000.0.85f2 managed assemblies and official docs:
[Web networking](https://docs.unity.cn/6000.0/Documentation/Manual/webgl-networking.html),
[redirect behavior, including WebGL](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Networking.UnityWebRequest-redirectLimit.html),
and [FromJsonOverwrite missing-field behavior](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/JsonUtility.FromJsonOverwrite.html).
The Unity CLI skill was read; no CLI installation or existing Editor/browser job was changed.

## Validation and remaining gate

`dotnet test client-unity/RoguehallaNet.Tests --filter FullyQualifiedName~AccountSessionTests` passes36cases. They include
different API prefixes, ASCII/case handling, header-only arguments, no persistence before confirmation, mismatched-name
and unproven-open rejection, stale switched-selection late200, cancellation after/before start, cleared queued claims,
serialized same-name reuse, 400/401/403/429/503, network/unreadable failures and blocked storage. The complete C# suite was
also run; the repair passes435tests, recorded in the lane's private `account-durability/logs/account-client-repair-full.log`.

An external private netstandard2.1 project compiles the two new Unity runtime files against the installed pinned
CoreModule/JSONSerializeModule/UnityWebRequestModule assemblies with warnings treated as errors: zero warnings/errors.
This is an actual API/reference compile, not an Editor or IL2CPP execution. `client-unity/sync-net.sh --check` passes;
only the three new net source files were copied into their Unity mirror. Private receipts live under the account lane.

Four new `AccountTransportEditModeTests` are authored for actual Unity JsonUtility envelope/sentinel behavior and an
isolated random PlayerPrefs namespace. They still require real pinned Editor execution. No actual Unity HTTP/browser
account flow, WebGL request, persistence across a browser reload or UI Join is claimed by the pure .NET tests. These
remain acceptance gates before ordinary hub wiring is admitted.

## Independent review repair

The continuation of `54ca4a69` removes the request `Cache-Control:no-store` header. The server already sends response
`Cache-Control:no-store`; its existing CORS allowlist does not permit that request header. `AccountRequestHeaders.Build`
is now the actual Unity transport's complete application-header source: Accept plus only optional x-profile-token and
x-playtest-passcode. A C# regression asserts that exact contract. The new real-loopback Rust
`account_client_preflight` test sends OPTIONS with those two non-safelisted names and verifies GET/explicit-origin/allowed
headers, the deliberate absence of cache-control from the allowlist, and the actual response's no-store policy. No server
CORS change or storage/database operation is used. This checks the real server preflight contract; actual browser/WebGL
preflight and Fetch remain pending the coordinated browser gate.

Both requested credential-loss regressions are explicit: switched selection plus a store returningfalse, and cancelled
selection plus a throwing store. In each, a late validated200 remains absent from Current/CanJoin but survives in scoped
page memory; a subsequent same-name reopen sends that exact retained credential and succeeds as an authenticated open.
The throwing-store case also verifies later successful storage changes the recovery status to Persistent. These tests
do not cover a transport disabled before a response, timeout/handoff loss, tab close or page reload with blocked storage.
One persistent main-thread coordinator/transport must survive menu changes; network handoff loss remains a gate rather
than a claim that unit tests prove full browser durability.

## Next sequential leases

Wire a new account panel/adapter lifetime from Bootstrap, then lease MatchClient.Join/Leave and MatchHud's menu/result
hooks sequentially. Ordinary persistent mode must open/claim successfully and check `CanJoin` immediately before using
the confirmed canonical name/token. Preserve explicit query-driven diagnostics as a separate path. Keep existing opaque
Session reconnect; refresh owned profile after a real result instead of inferring committed banking from wire alone.
No browser may call the trusted operator listener. Training remains refused by Director; Hello/control creation do not
offer a training mode, and public hosted-placement REST is absent. Those native/admission prerequisites must be resolved
through their owners rather than bypassed in UI.

A fully disjoint next durability rehearsal can create two disposable PostgreSQL clusters with separate data directories
and system identities, obtain ownership/credit through the real local flow, `pg_dump` the first database, restore into the
second, then verify original owner-token auth, exact profile/result/ledger data, reconciliation, duplicate retry and lease
fence behavior. Back up/restore only these unique throwaway databases; leave live profiles and other workers' PG untouched.
Two directories on this machine do not prove separate physical volumes or managed failover. Record that limit and prepare
the rollback runbook separately; redacted legacy export alone cannot restore plaintext ownership tokens. This is a plan,
not a performed backup or recovery claim.
