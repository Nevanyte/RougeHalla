# Native fixture isolation and account boundary

Source-only audit for the eight new `MatchResumeEditModeTests` cases. The proposed
98-case native campaign remains **UNRUN**. No Editor, PlayerPrefs value, credential,
browser storage or live account was accessed by this audit.

## Explicit account boundary

In the resume path, a saved callsign/checkpoint causes no profile HTTP request. The
code requires an already-current, nonbusy Owned profile matching the selected/loaded
callsign, normally obtained through explicit LOAD/sign-in. It checks that state rather
than a LOAD-reason flag; an owner retained from another prior account operation can also
satisfy it. Only then can an explicit Resume action call the profile re-verification GET.
The returned intent must remain current and its `Created` flag must be false before
checkpoint read or socket creation. A `Created=true` response never authorizes that
resume attempt.

This GET is **not** an existing-only or side-effect-free endpoint. If the backend no
longer has the previously owned profile and the name is free, it can create that profile.
AccountSession can retain/persist the newly confirmed
credential before Resume rejects the created reply, potentially replacing a prior
stored credential. Resume does not roll back that profile or credential mutation.
There is no unconditional no-claim/no-credential-mutation promise, and no new joint
account/seat authentication guarantee. The server's existing seat-bearer authority is
unchanged. No production API or behavior was expanded for this boundary.

## Injected dependencies

| Fixture dependency / method scope | Isolation |
|---|---|
| `Fixture` creates MatchClient | Component is immediately disabled; sets fixed synthetic PageUrl/API/mode targets/profile/content before actions. It does not call Bootstrap or MatchClient.Start/InitializeAccounts. |
| `AccountCoordinator.Initialize(endpoint, Accounts, Credentials)` | Explicit embedding overload. Accounts implements both profile and API transports in memory; Credentials returns the test-owned synthetic token, null or deliberately wrong token. It never uses PlayerPrefsAccountCredentials. |
| `Accounts.GetProfileAsync` / `SendAsync` | Controlled TaskCompletionSource replies, fake credential validation and synthetic profile/receipt DTOs. No HTTP implementation. |
| `_transportFactory` | Set to the local fake Transport before Join/Resume. Connect records a configured URL; Send records frames; Deliver invokes encoded Session callbacks. No socket implementation. |
| `_seatStore` / `InitializeSeatResume` | Injected OwnedSeatCheckpointStore over MemoryStorage before initialization. The default WebGlSeatCheckpointStorage is not selected. |
| Planning route storage in an Editor | Existing UiBrowserStorage Editor branch is an in-memory dictionary; no browser sessionStorage or sign-in fragment is read. |
| Chooser keyboard case | Scoped synthetic keyboard/settings clone. Finally removes only its device, restores prior current keyboard/settings/hideFlags and destroys the clone. No hardware input dependency. |

There are no native staging scripts in this evidence packet. Its metadata tool reads
assemblies as data and invokes no Unity API or test body. A coordinator-created stage
must inject the same fake account/credential/transport/resume dependencies before any
action, rather than invoke default Bootstrap, Play or auth initialization. Unknown dirty
RAM assets in the earlier Editor were not inspected or altered by this lane.

## Known UI preference keys

Fresh `MatchClient.JoinOwned` writes the non-secret last-callsign string
**`rh.ui.profile`** and calls Save. Resume itself does not write it. The new Fixture
captures only that key's HasKey result and, when present, its string value privately
before setup. Dispose restores the exact presence/value in `finally`, including setup
rollback, then verifies presence and value through boolean assertions. When absent it
deletes only that same known UI key. Values are never logged. There is no key enumeration,
DeleteAll, account-token key access or blanket credential/storage clear.

The following presentation preferences may be read by HUD construction. No new test
drives their setters, settings controls or reset action, so the fixture does not change
them and needs no writeback restoration:

| Read method | Exact key | Type |
|---|---|---|
| ShowcaseSettings.Awake | `roguehalla.showcase.qualityMode` | int |
| ShowcaseSettings.Awake | `roguehalla.showcase.manualQuality` | int |
| ShowcaseSettings.Awake | `roguehalla.showcase.reducedMotion` | int |
| ShowcaseSettings.Awake | `roguehalla.showcase.textScale` | float |
| ShowcaseSettings.Awake | `roguehalla.showcase.music` | float |
| ShowcaseSettings.Awake | `roguehalla.showcase.ambience` | float |
| ShowcaseSettings.Awake | `roguehalla.showcase.sfx` | float |
| UiDisplayPreferences constructor | `rh.ui.map.toggle` | int |
| UiDisplayPreferences constructor | `rh.ui.route.visible` | int |
| UiDisplayPreferences constructor | `rh.ui.showFps` | int |
| UiDisplayPreferences constructor | `rh.ui.showPing` | int |
| UiDisplayPreferences constructor | `rh.ui.minimapScale` | int |

ModernSettings initialization/refresh uses SetValueWithoutNotify, so it does not invoke
preference write callbacks. ApplyDisplayPreferences changes layout only. A separate
future layout stage that deliberately changes text/quality/map settings must privately
capture and finally restore the exact known keys it changes, including presence. A fresh
project with the same Company/product still shares global PlayerPrefs; process/project
isolation alone is not a preference sandbox. This new fixture does not alter any of the
prior 90 source cases; whole-campaign baseline restoration remains the native owner's
responsibility.
