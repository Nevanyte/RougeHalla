# Reusable account coordinator and connection policy

New-file continuation from exact `dd95b64d31d4f105fe26f52f949bbbffebfd9e76`. The UI/uGUI skills were read and the
existing Canvas/menu/session patterns inspected. The lead subsequently transferred Bootstrap/MatchClient/MatchHud to
the user-owned modernization chat, so this candidate edits none of them and creates no UI hierarchy, socket or actual
Join path. It provides the reusable account layer that chat can consume. Existing accepted account/session/transport
implementations are unchanged; no server, gameplay, protocol/schema/version, dependency, lockfile or live data changes.

## Typed consumer interface

`AccountConnectionPolicy` provides:

- `DefaultMatchUrl(pageUrl)`: HTTP(S) page origin becomes WS(S) at `/ws`, preserving the actual origin port and dropping
  navigation query/fragment. An explicit remote AccountApi never silently changes this default.
- `CheckOwnedTarget(endpoint, matchUrl)`: validates a credential-free/query-free WS(S) `/ws` target and requires its
  normalized scheme/host/port to match the configured AccountEndpoint's HTTP(S) origin. Explicit matching WS is required
  for a deliberately configured remote account API; an unrelated `server=` cannot receive the owned credential.
- `AllowsDiagnostic(pageUrl, matchUrl, requested, isEditor)`: caller must pass the explicit `diagnostic=1` request;
  loopback WS is mandatory in every build. Web also requires an HTTP(S) loopback page. Editor may lack a page URL but
  cannot target a remote WS. This helper grants no admission and is never a fallback after account failure. The consuming
  UI owns its Development diagnostics label and query wiring; historical artifact URLs are not updated here.

`AccountHubFlow` provides `SelectName`, `Cancel`, `OpenProfileAsync`, `PrepareJoinAsync`, `CanJoin`,
`RefreshAfterResultAsync`, `RefreshRecovery`, a `Snapshot` and `Changed(snapshot)` event. Snapshot contains only typed
state/failure/connection failure/recovery/refresh reason and an immutable, non-secret profile summary. UI owns all
wording/layout/input blocking. `AccountHubProfile.HasFullProfile` remainsfalse: this slice covers only name, GV,
lifetime GV and five run counters, not monthly maps, cosmetics, achievements or full progression.

`PrepareJoinAsync(name, matchUrl, pendingKey, passcode, cancellation)` rejects an origin mismatch before any account
request, then obtains confirmed ownership through the existing AccountSession. It returns an `AccountJoinIntent` bound
to this flow and its current generation. **Call `CanJoin(intent)` immediately before synchronous session creation,
with no intervening await.** Join using `intent.Account.CanonicalName` and its confirmed Token, never the mutable
Profile DTO's name. Selection/cancellation/another open/result refresh invalidates an older intent. The intent carries
a secret: do not serialize, log, display or put it in a URL. No socket is created by these methods.

Confirmed late claims continue to use the admitted page-memory recovery semantics even when persistent storage fails.
A stale completion may update recovery metadata for the selected name but cannot publish its profile/Join intent.
`RefreshRecovery()` can be called when showing a menu after detached cancellation: it changes only recovery metadata,
not ownership/selection. Persistent status means the configured store acknowledged its write; it is not physical
durability proof. `RefreshAfterResultAsync()` is only an authenticated read of currently saved counters. It records
Result as the refresh reason and never claims a result transaction committed (`ResultBankConfirmed` remainsfalse).
Counters returned before banking stay unchanged; the UI can show pending/refresh without inventing progress.

`AccountCoordinator` is a thin main-thread MonoBehaviour with `Initialize(pageUrl, explicitApiBase)` and an injectable
initialization overload for embedding/tests, plus Flow/Snapshot. Initialize it once on the persistent owner object,
outside toggled menus/results. It creates/reuses a UnityAccountTransport on that owner and uses PlayerPrefs credentials.
Replacing the endpoint on an initialized owner is refused so an outstanding page-only credential cannot be abandoned.
It does not create a panel, change scene hierarchy, drive an Editor, disable transport on Leave or create a match.

## Verification

- 27 focused `AccountHubFlowTests` pass: page-default/explicit origin routing; invalid credential/query targets;
  loopback-only opt-in including Editor, IPv6 and deceptive localhost names; pre-request origin denial; immutable
  canonical summary; generation-bound intents; two-click serialized claim/reuse; switched selection; cancel/late
  page-only recovery and authenticated rejoin; detached-cancellation recovery metadata; cross-flow intent refusal;
  typed401/403/503 failures; result refresh without bank inference.
- The complete C# suite passes462tests. The net mirror check and diff whitespace check pass.
- New MonoBehaviour plus accepted transport/storage compile against actual installed Unity6000.0.85f2
  CoreModule/JSONSerializeModule/UnityWebRequestModule references with zero warnings/errors. This is managed API
  compilation only, not an Editor or IL2CPP execution.
- Two new `AccountCoordinatorEditModeTests` are authored for a separately owned menu object's closure while a real
  coordinator claim completes through an injected transport, and rejection of endpoint replacement. They remain
  unexecuted pending the lead/art lane's sequential Editor gate. No Editor/Web build or browser job ran here.

Private raw receipts are under `return-cleanup-2026-11-08/account-ui/logs/`: `hub-focused-final.log`, `hub-full.log` and
`hub-unity-api-compile.log`. The new-file candidate does not refresh the separate PostgreSQL, browser or prior four
Editor claims, and does not claim ordinary functional UI wiring from pure coordinator tests.

## Synchronous selection reentrancy repair

Independent review held the initial `425943e9` source: a Changed subscriber switching Alice→Bob during the Idle event
could be overwritten by a second implicit selection, after which an Alice request/intent was incorrectly associated with
Bob's selected state. Opening-state cancellation could also still start HTTP. Added regressions reproduced four failures
and one passing late-recovery control against the unchanged original runtime; `reentrancy-before-repair.log` retains that
receipt. This was an account coordinator bug, not a UI or server defect.

The fresh continuation binds an operation's generation, requested spelling and normalized expected selection before
the first event. Begin selects only once. It checks those captured values after selection/opening callbacks and before
HTTP, after awaiting the account result, after Owned callbacks, and before constructing an intent. CanJoin also checks
the intent's expected normalized selection and immutable canonical identity, rather than accepting the latest generation
on behalf of an older request. Event delivery stops forwarding an obsolete snapshot after a subscriber replaces it.

The final35focused cases pass, including the exact Idle Alice→Select Bob regression, cancellation during both Opening
and PreparingJoin notifications, reentrant new opens from Idle and PreparingJoin, an Owned-callback switch, suppression
of stale snapshots to later subscribers, and preservation/reuse of an already-started late confirmed token with blocked
storage. A switch/cancel before HTTP starts no old claim; an already-started valid claim retains the accepted recovery
behavior. One final full C# suite passes470tests; actual pinned managed-API compilation remains zero warnings/errors and
mirrors/whitespace checks pass. Final receipts are `reentrancy-final-focused.log`, `reentrancy-full.log` and
`reentrancy-unity-api-compile.log` in the same private logs directory. The original27/462 checks above remain historical.
No existing shared UI, connection-origin policy, diagnostics restriction, server or protocol was changed by this repair;
new Editor tests and actual UI/browser adoption still require their separate coordinated gates.

## Handoff and limits

The modernization UI owner retains Bootstrap/MatchClient/MatchHud and can integrate this API under its lease. Actual
controls, failure labels, input blocking, ordinary claim/sign-in, synchronous Join, result refresh display and Play again
still require that wiring and its actual Editor/browser gates. No public hosted-placement/control or training authority
has been added. Network handoff before validation, timeout, owner OnDisable/destruction, tab close, reload and blocked
browser storage remain the explicit delivery/page-lifetime limits. Full-profile account contracts remain in this lane's
follow-up scope; the new user-owned backup/cold-restore lane exclusively owns that separate rehearsal and its tools/tests.
