# Explicit current-owner recovery key read

Fresh continuation from exact `90574c57716bb7f8fafa4f87a46e1fe7aa2f26aa`; the earlier account candidates remain preserved.
This changes only AccountHubFlow and its exact Unity mirror, a coordinator forwarding method, focused existing account
tests, and this new evidence. No shared UI, Bootstrap, MatchClient, server, header, package, lock/status or Editor change.

Callable main-thread contract:

```csharp
bool AccountHubFlow.TryGetRecoveryKey(out string canonicalName, out string key);
bool AccountCoordinator.TryGetRecoveryKey(out string canonicalName, out string key);
```

Success returns only the existing confirmed current AccountSession OwnedAccount's immutable CanonicalName and Token.
The flow retains the operation generation/normalized selection/account reference when its ordinary open succeeds. The
read requires Owned flow state, that same generation and normalized selection, and AccountSession.CanJoin confirmation
of the exact account reference. It never accepts ownership from display text or mutable Profile fields. Each name
selection change, cancellation or new open clears the recovery binding. A replaced session owner is rejected even when
the old flow snapshot still says Owned. The coordinator refuses before initialization. Both outs are empty strings on
failure. Opening/PreparingJoin/Refreshing, unowned, failed, stale and mismatched states cannot return a key.

This is a synchronous read, with no HTTP/new claim, storage access, state/event publication, token minting, join intent,
clipboard action or generic account export. The AccountSession's immutable full normalized API base remains its scope;
another base path or origin with the same name/shared credential store cannot reveal this endpoint's key. A newly
confirmed claim remains recoverable while current even if complete maps are unreadable and confirmed persistent storage
is blocked. A late confirmed claim retained by AccountSession after switching names still requires an explicit successful
reopen of that owner before this helper can return it. Existing confirmed-token recovery is not weakened.

The returned key is secret. The UI owns an explicit user reveal action, masking by default, and clearing its displayed
copy on owner/selection/close. Do not log it, serialize it to evidence, place it in a URL, or infer a banking receipt.
The helper does not implement that UI or a clipboard flow, and does not promise page-close/reload delivery or durability.
No automatic recovery/export action runs on initialization. Store-blocked recovery remains page-lifetime only.

Verification:72 focused AccountHubFlowTests+AccountApiServiceTests pass, including9 new recovery cases: unowned and
pending refusal; current confirmed blocked-store/malformed-full-profile success without I/O/state/events; immutable
canonical identity despite caller Profile/Reply mutation; opening/join/result-refresh busy refusal; cancellation;
late switched claim/reopen; same-name isolation across a different API base path and origin; mismatched ownership reply;
reentrant Owned callback selection change; and replaced session-current reference. Key comparisons use boolean checks
so no key appears in ordinary test receipts. Pinned Unity6000.0.85f2 API-reference compile has0 errors/warnings and the
Unity mirror matches byte-for-byte. No broad suite, actual Editor/WebGL/browser, server/PG or cloud work ran. Root owns
independent exact-head release before the separate UI lane adopts this method.
