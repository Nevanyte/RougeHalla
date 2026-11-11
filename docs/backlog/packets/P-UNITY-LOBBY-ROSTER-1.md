# P-UNITY-LOBBY-ROSTER-1: the lobby shows who is waiting and who is in a game

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-2 queue states, client half); owner direction 2026-11-10
  (MIGRATION checkpoint, decision 8)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (UI) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
The Unity lobby shows "Lobby — waiting for players" and nothing about who is there. When this lands: (a) in the room's
lobby phase the HUD lists the seated players by name with a bot tag, from the match roster the server sends (State key
12); (b) the hub shows the legacy lobby-activity panel, "Active game" and "Waiting in the hub", polled from the server's
public lobby endpoint; (c) the hub announces and withdraws its own presence as legacy does.

## 2. Dependencies
- P-LOBBY-ACTIVITY-1 merged (the endpoint and lobby-phase roster delivery)
- P-UNITY-TIMER-1 merged (`MatchHud.Features.cs`)

## 3. Relevant legacy paths
- `packages/client/src/ui/lobbyActivity.ts`: panel content, 15 s poll, 30 s staleness, phase names (`:5-6`, `:16-23`,
  `:56-57`)
- `packages/client/src/net/lobby.ts:43-67`: `GET /api/lobby`, `POST`/`DELETE /api/lobby/presence`
- `packages/shared/src/messages.ts:459-484`: response shape

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/LobbyActivity.cs` (pure model: parse, group, staleness) and its tests
- a Unity panel under `client-unity/UnityProject/Assets/Scripts/UI/`

## 5. Exclusive write scope
- the new paths and the library's synced copy
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs` (lobby phase label, `:55`) and `MatchHud.Features.cs`
- the hub scene's UI script that hosts the panel (named by the oracle author)

## 6. Contracts and references
- No game rule; names are untrusted text: render as plain text, bounded length.
- The roster row is `WireRosterRow` (actor id, bot flag, name; `crates/rh-protocol/src/state.rs:872-878`); no wire change.
- The endpoint's shape is fixed by P-LOBBY-ACTIVITY-1.

## 7. Behaviour to preserve
- Match HUD outside the lobby phase; the coliseum countdown from P-UNITY-TIMER-1.
- No polling during a match (legacy polls from the hub only).

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-UNITY-LOBBY-ROSTER-1` passes (full).
- Unit tests: a response fixture groups into "Active game" and "Waiting in the hub" in legacy order with bot tags; data
  older than 30 s is marked stale; a malformed or oversized response gives an empty panel, not an exception; the lobby
  list equals the roster rows in seat order.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/LobbyActivityTests.cs` (new)

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh --check`
- Unity EditMode batch run (Editor closed). Not part of the gate: report whether it was run.

## 10. Risk and suggested model tier
Sonnet. UI over a small pure model.

## 11. Known traps
- WebGL: the poll is an HTTP request from the browser; the server's CORS and the site's origin must agree (check
  `/info` usage for the pattern).
- Withdraw presence on page close as legacy does, and tolerate it failing.
- The "n/m" in the legacy lobby line needs the room's minimum, which is not on the wire: take it from the lobby endpoint
  if it carries it, otherwise show the count alone and say so in the hand-off.

## Notes from previous attempts

## Oracle author's brief (supersedes loose wording above)

**API pinned by the stub** (`client-unity/RoguehallaNet/Net/Ui/LobbyActivity.cs`, namespace `Roguehalla.Net.Ui`; the stub commit returns an
empty model, the implementer fills it in and may add members but not change these): `LobbyActivity.Parse(json)`, `IsStale(model, ageMs)`,
`PhaseLabel`, `RoomHeading`, `WaitingTitle`, `RosterLines(IReadOnlyList<WireRosterRow>)`, `LobbyCount(humans, humanMin, fillTarget)`, constants
`PollMs 15000`, `StaleMs 30000`, `MaxJsonChars 65536`, `MaxNameChars 24`, and the model types. Add an overload over `Collections.Roster`
(`RosterEntry`, whose constructor is internal) if convenient; the pinned one takes the public wire row.

**JSON.** The library has no JSON code and no package (`RoguehallaNet.csproj` has no references; the asmdef has `noEngineReferences`). Newtonsoft is
used only in `UnityProject/Assets/Scripts/Net/AccountFullJson.cs` (compiled into the tests by `Compile Include`). Chosen route: a small private,
bounded, hand-written reader inside `LobbyActivity.cs` (strings with escapes incl. `\uXXXX`, numbers, null, bool, arrays, objects; depth cap;
whole input must be consumed; unknown keys ignored). Parse never throws: anything wrong gives `LobbyActivityModel.Empty` (`Available == false`).
Required: `rooms` and `waiting` arrays; each room needs a known `phase`, a `players` array; a bad player/waiting row with a
control-char-only or empty name is dropped. Alternative if the reader grows: put the Newtonsoft parser in `Scripts/Net/` and add a `Compile Include`
to the test csproj (that file is not an oracle file but needs owner sight).

**Legacy panel as verified** (`packages/client/src/ui/lobbyActivity.ts`):
- Poll every 15 s while the hub is visible (`:5,89`), stale when no snapshot or age since receipt, by the client clock, is strictly over 30 s (`:6,132,148`);
  a failed poll keeps the last good snapshot and its age (`:120-126`): the Unity side must keep the last good model, not replace it with Empty.
- Headings "Active game" / "Waiting in the hub" (`:159-160`); with data "Active game · N humans · M bots" (M part only if M>0; "1 humans" is legacy, pinned,
  `:177-179,191`) and "Waiting in the hub · N" (`:202`). Order: game section first, then waiting; players in the response's order.
- Phase names `:17-22`: Gathering players, Planning, Run in progress, Finished.
- Tags per person "Bot" or "Human" (`:186`; waiting always "Human", `:198`). Legacy also shows "Out" for dead players (`:187`): the new
  endpoint carries no `alive`, so that is dropped (note in hand-off, propose a DEVIATIONS row if the owner wants one).
- Empty texts: "No active game right now." (`:174`), "No players waiting in the hub." (`:201`), "Waiting for players to join." (room with no players, `:190`).
  Stale/unavailable: both sections show "Current players unavailable." (`:159-160`), status "Lobby activity is out of date. Refreshing…" (had data) or
  "Lobby activity is unavailable. Retrying…" (never had), title "Lobby activity" (`:152`); with data the title is "Lobby activity · N online" (`:166`).
  These strings are not in the oracle; the implementer copies them as constants.
- Legacy had ONE `activeGame`; the endpoint has `rooms` (one section per room, with `RoomHeading` each) - a difference to flag, not a deviation of behaviour.
- "n/m": legacy `hud.ts:44` prints "Waiting for players {state.players.size}/{minPlayers}" (all players incl. bots over the server's MIN_PLAYERS). Here
  `LobbyCount` uses humans over `humanMin`, else over `fillTarget`, else the bare count; this is a pinned choice, not legacy-identical when bots are seated.
- Presence (`net/lobby.ts:43-67`): signed-in hub POSTs `/api/lobby/presence` (the heartbeat IS the poll, response = snapshot) with `x-profile-token`
  and `{name, tabId}` (tabId a per-session random id); anonymous hub GETs `/api/lobby`; leaving the hub/hiding stops the timers and DELETEs presence,
  ignoring failure (`lobbyActivity.ts:96-104`). Never poll during a match.

**In-room list.** Legacy has no such list (only the count line); `RosterLines` is new: names in roster (ascending actor id = seat) order, a bot as
`"name (Bot)"`. Shown only in the lobby phase; the roster arrives in State key 12. Names are plain text (no rich-text parsing: escape `<`).

**Unity files the implementer touches.**
- `UnityProject/Assets/Scripts/UI/MatchHud.cs:55` (`Phases[0]` "Lobby — waiting for players") and `:250-262` (banner for `SessionState.InMatch`): append
  `LobbyCount` and the `RosterLines` block for phase 0 (`MatchHud.Features.cs:170` shows how the phase is read); nothing outside the lobby phase changes.
- A new hub panel, modelled on `UI/HubProgressView.cs` / `HubCosmeticsView.cs` (MonoBehaviour, `Initialize(_root, ...)`, `ApplyViewport` via `HubPanelDock`),
  created next to them in `UI/MatchHud.Accounts.cs:131-135`.
- HTTP: there is no `/info` call at runtime (it is only baked at build time by `Tools/build-web.sh`). The pattern is `Net/UnityAccountTransport.cs`
  (UnityWebRequest on the main thread, headers via `SetRequestHeader`) with the base from `AccountEndpoint.FromPage(...).ApiBase` (the page origin + `/api/`),
  and `x-profile-token` from `AccountRequestHeaders` (`RoguehallaNet/Net/AccountRequestHeaders.cs`). Add a small transport (new file under `Scripts/Net/`) or a
  read kind; do not use HttpClient (WebGL). The server answers CORS for its allowlisted site origin; the same-origin page works, an Editor run needs an
  allowlisted origin. Withdraw on `OnDisable`/`OnApplicationQuit`; the browser may drop the DELETE on page close, which is tolerated (the server TTL is 45 s).

**Oracle behaviour in the stub state.** Against the stub, 6 tests fail on assertions; the malformed and oversized cases pass trivially (the stub
returns Empty) and only start to guard once Parse is real.
