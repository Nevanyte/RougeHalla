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
