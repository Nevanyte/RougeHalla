# P-UNITY-WORLD-MARKS-2: the client draws each camp's patience range and the quest carrier's flag

- **Serves:** owner decision 7 (2026-11-10: the HUD presents what legacy presents); `docs/rework/LEGACY_INDICATORS.md`
  rows W11 and W7, unblocked by P-WIRE17-MAP-2
- **Implementer tier:** implementer-sonnet (Unity presentation; engine-free geometry in `RoguehallaNet`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework at or after `83a19406` (P-WIRE17-MAP-2 merged)
- **D-rules touched:** D1 loose proof (legacy drawing read, one test per mark) · no wire change · no game rule in Unity

## 1. ID and outcome
P-WIRE17-MAP-2 delivers two facts the client does not draw: `MapBlob.Patience` (one byte per tile: 0, or the 1-based
index of the camp whose mobs still chase from that tile) and the quest row's carrier actor id (present only while the
viewer can see the carrier). When this lands:
1. **Patience outline (W11):** for every living camp the client outlines the union of that camp's patience tiles, as
   legacy does (`packages/client/src/render/CampPatience.ts`: cyan `a9f4f5`, with the seconds text legacy shows: say
   exactly when legacy shows the outline and the text, and pin that). The outline is built once per map from the
   plane (an outline of tile edges between "this camp" and "not this camp"), not per frame.
2. **Quest carrier flag (W7):** a small kind-coloured flag over the fighter who carries a quest, as legacy
   (`packages/client/src/render/QuestView.ts:167`, 14 x 12 px at y -62; also over the local player:
   `QuestView.ts:68-76`), shown only while the row carries the actor id and that actor is drawn.

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/**` for the engine-free outline geometry (the oracle author names the file), the
  synced Unity copy; `client-unity/UnityProject/Assets/Scripts/Presentation/**` for the two presenters (named by the
  oracle author); the scene wiring where the existing world-mark presenters are created
- not `Protocol/**`, not `MatchHud*.cs`

## 7. Behaviour to preserve
- Maps without a patience plane (an older server, practice) draw no outline and throw nothing; no per-frame garbage;
  the existing world marks (P-UNITY-WORLD-MARKS-1, the camp badges and wards) unchanged.

## 8. Acceptance checks
- Engine-free: the outline of a plane equals the expected edge list for a hand-made plane (one camp, two touching
  camps, a camp with a hole, a camp on the map edge); a plane of zeros gives none.
- EditMode: the outline appears for a living camp and not for a cleared one, as legacy; the flag appears over the
  carrier when the row has the id and the actor is drawn, over the local player when they carry, and nowhere when the
  id is absent; nothing is rebuilt on a frame where nothing changed.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-WORLD-MARKS-2` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-WORLD-MARKS-2`

## 10. Risk and suggested model tier
Sonnet. On a landmark-mode map the cave's camp owns its whole site, so its outline is a 34-tile square: say how that
reads and whether legacy's rule for when to show the outline keeps it from being permanent clutter.

## Notes from previous attempts
