# P-FROST-WALL-2b: the C# client state lists standing Frost Walls and says which Wish Frost has

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"); the client-state half
  cut from P-FROST-WALL-2 (its brief, "Next packets"); feeds P-UNITY-FROST-WALL-1 (section 1 items 1 and 3, section 4)
- **Implementer tier:** implementer-sonnet (engine-free C#, no wire format change)
- **Reviewer:** reviewer
- **Integration base:** after P-FROST-WALL-2 merges (oracle written on `848bfa2f0`, where the wire decoder is still a stub)
- **D-rules touched:** D1 loose proof: the sibling wire packet's vectors and the tile maths below are the evidence; no
  legacy rule is ported here (legacy `78dd8bd4` held walls in the client's own map, see P-FROST-WALL-2 F1) · D2 n/a ·
  D5/D6/D9 none (no prediction change: walls reach the walk only through P-FROST-WALL-PREDICT-1)

## 1. ID and outcome
After P-FROST-WALL-2 a wall row (field kind 3, tile indices) and HUD terms 23-29 reach `RoguehallaNet`'s decoder, but
`CollectionsView` flattens every field into the same `AreaView` and drops the tiles. When this lands:
1. `CollectionsView.Fields` lists a standing wall as an `AreaView` with `Kind == AreaKind.Wall` (new member, value 3),
   `Tiles` as `MapTile[]` in map coordinates (index `i` -> `(i % W, i / W)`, `W` the Welcome map's width; rows of other
   kinds have `Tiles == null`), `StartedAt`/`EndsAt` as server milliseconds (`double`, as every field), `Owner` as the
   wire carries it (`uint?`, null when the viewer may not see the caster; the wire has no faction, so none is added), and
   `Key`, a stable identity across snapshots. A wall leaves the list in the snapshot the server stops sending it (key 3
   replaces the whole list, as today).
2. **Identity.** Today nothing identifies a field: `AreaView` has no id and the wire carries none. The owner is not usable
   (it appears and vanishes with sight), so a wall's `AreaKey` is `(StartedAt, FirstTile)`: its start time and its first
   (lowest) tile index. Two walls cast the same tick with the same lowest tile are not a case the sim produces (a tile
   holds one wall). The stub `AreaKey` struct is the oracle's contract (`IEquatable`, `default` = "no key").
3. **Off-map refusal.** A wall tile at or beyond `W * H` (the Welcome map) throws `InvalidCollectionStateException("wall
   tile ...")`, the existing exception `Session` turns into `SessionState.Failed` with `Error = "bad server collection
   state: ..."` (`Session.cs:452-460`; precedent: bad trade state, `Collections.cs:370-378`). It is raised in `Apply`'s
   first, validating loop (`Collections.cs:370`), before any item is applied, so a refused frame changes nothing. The
   decoder only checks `MAX_MAP_TILES` (it has no map); this is the check against the real map (P-FROST-WALL-2 F4 step 4).
   With no map bound, a wall row is refused the same way.
4. **The map reaches the view.** `CollectionsView.BindMap(MapBlob)` (public; stub is a no-op) is called by `Session`
   in `OnWelcome` right after `Collections.Reset()` (`Session.cs:598`), with `w.Map`. `Apply(ServerMsg.State)` keeps its
   signature (HudClockProtocolTests and others call it by reflection and must not change).
5. **Frost's Wish.** On `WireHudContent`: `FrostWish` (`FrostWishKind { Freeze = 0, Wall = 1 }`; **Freeze** when term 23 is
   absent or any value other than exactly 1), `CarriesFrostWish` (term 23 present), and `FrostWall` (`FrostWallNumbers?`:
   `Range, MinRange, Length, Ms, CellReach, EndSlack` from terms 24-29, null unless all six are present). Answered
   whatever the wish (every real Welcome carries the numbers). Session-level use is `Session.Welcome.Hud.FrostWish`.

## 2. Dependencies
P-FROST-WALL-2 merged: `WireField.Tiles`, `FieldsState` kind 3, HUD codes 23-29 (`HudTerm`) and `WireHudContent.TermCount`
30 must exist. The stub types on this base already declare `WireField.Tiles`, `FieldsState.KindWall` and `HudTerm.FrostWish..`.

## 3. Relevant legacy paths
Nothing here is a legacy rule. The wall's tile maths mirrors the Rust sim's row-major tile index: `crates/rh-sim/src/
barriers.rs` (the barrier row) and `crates/rh-protocol/src/state.rs` (`FIELD_KIND_WALL`, `MAX_WALL_TILES`); the wire
layout is P-FROST-WALL-2 F4/F5 (`docs/backlog/packets/P-FROST-WALL-2.md`).
Library precedents: `Net/Collections.cs:370-381` (validate-then-apply), `:415-428` (the field case in `Apply`),
`:288` (`InvalidCollectionStateException`), `Net/Session.cs:452-460` (failure path), `Net/Session.cs:598`
(`Collections.Reset()` on Welcome).

## 4. New paths
None (the stub types live in existing files).

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Collections.cs`, `client-unity/RoguehallaNet/Net/Session.cs` (one line: `BindMap`)
- `client-unity/RoguehallaNet/Protocol/WireHudContent.cs`: **only** the three accessors and `FrostWishKind`/`FrostWallNumbers`
  (the file is shared with P-FROST-WALL-2, which owns `TermCount` and the codec; merge after it). Not any decoder.
- the synced copy `client-unity/UnityProject/Assets/RoguehallaNet/**` by `bash client-unity/sync-net.sh`
- not other `Protocol/**` files, no Unity script, no existing test

## 6. Contracts and references
C-OBS (the view holds only what the server delivered; no tile is ever computed client-side), C-NET (a bad frame fails the
session instead of being repaired), R-AUTH/D9 (no rule decided here; display facts only).

## 7. Behaviour to preserve
- `Apply(ServerMsg.State)` signature and every existing field row (zone, cloud, trail) value for value.
- `AreaKind` values 0-2 and `AbilityId` unchanged.
- **Garbage:** `GarbageTests.cs` measures decode, snapshot and interpolation paths; it never touches `CollectionsView`
  or `Fields` (verified: no reference), and `Apply` already allocates a new `AreaView[]` per key-3 frame. So no
  reuse is required and none is pinned; the wall's `Tiles` array is one allocation per wall per key-3 frame. Presenters
  must key on `AreaKey`, not on array references.

## 8. Acceptance checks
- `dotnet test client-unity/RoguehallaNet.Tests --filter FullyQualifiedName~FrostWallStateTests` all green.
- Whole C# suite green, including P-FROST-WALL-2's tests; `bash client-unity/sync-net.sh --check` clean.
- `scripts/gate.sh --quick --oracle packet/P-FROST-WALL-2b` passes.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/FrostWallStateTests.cs`

The tests build decoded state objects directly and call `CollectionsView.Apply` by reflection (the
`HudClockProtocolTests` precedent), so they exercise the client-state layer and do not need the wire decoder. One test,
`TheSessionBindsTheWelcomeMapSoAWallDecodesAgainstIt`, drives a real `Session` through `FakeTransport` and needs the
P-FROST-WALL-2 encoder; on a base without it, it fails with "the P-FROST-WALL-2 encoder is missing".

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/sync-net.sh --check`

## 10. Risk and suggested model tier
Sonnet. Small and local. The risk is the identity choice and the off-map check running after a partial apply.

## 11. Known traps
- Tile index maths in `uint`, then to `ushort` (`MapTile`): a 6 x 4 map in the oracle makes `x != y` mistakes (using H, or
  `i / H`) fail.
- The off-map check must run in the validating loop, not while building rows, or a refused frame leaves earlier keys applied
  (`ARefusedWallStopsTheWholeFrameBeforeAnyKeyIsApplied`).
- `FrostWish` is Wall only for the value exactly 1; the decoder accepts any value in 0..1e6.
- A new Welcome (`Session.OnWelcome`) must re-bind the map; `Reset()` already clears `Fields`.

## Legacy doubts / flags for the coordinator
- The wire brief's hand-over said `WireHudContent` returns `FrostWish?` (null when absent); this packet's request is a safe
  Freeze, so the oracle pins a non-nullable `FrostWish` plus `CarriesFrostWish`. P-UNITY-FROST-WALL-1 only needs the former.
- The hand-over placed the wall tile in `AreaView.Tiles`; it named no identity. `AreaKey` is new here.
- The hand-over's "Session-level tests with FakeTransport (a Welcome with a 4 x 4 map)" cannot cover most cases on
  the wire stub (the encoder refuses kind 3 and HUD code 23, `TermCount` is 23). Most tests therefore bypass the transport;
  one Session test remains and goes green only after P-FROST-WALL-2.
- `TermCount` / `MaxTerms` stay in P-FROST-WALL-2's scope; `WireHudContent.cs` is shared, so merge 2b after 2.
- Wall faction is not on the wire (only `Owner`); P-UNITY-FROST-WALL-1 item 1 ("owner faction") must derive it from the
  actor snapshot of the owner, which is absent when the owner is redacted: the presenter should use the neutral tint then.

## Baseline on `848bfa2f0` plus the stub
Whole C# suite: 2057 tests, 2033 pass, 24 fail: 17 in `FrostWallStateTests` (the rest of that file passes by construction, e.g. the
absent-term Freeze answer) and the 7 known-red wire tests. The 7 known-red wire tests:
`AWallRowDecodesWithItsTilesAndReencodes`, `ConstantsMatchTheBrief`, `TheDecoderRefusesMalformedWallRowsForTheRustReasons`,
`TheEncoderRefusesWhatADecoderWould`, `TheRustMalformedVectorsAreRefusedForTheirReasons`, `TheRustWallVectorsDecodeAndReencode`,
`TheRustWelcomeVectorsSayWhichWishFrostHas` (all in `FrostWallProtocolTests`).

## Notes from previous attempts
<!-- Coordinator appends on escalation. -->
