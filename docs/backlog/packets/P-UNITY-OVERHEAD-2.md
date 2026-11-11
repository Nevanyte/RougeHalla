# P-UNITY-OVERHEAD-2: statuses are drawn on the body at fixed spots, as legacy

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-7 combat presentation); owner direction 2026-11-10 ("hud above
  characters head is messy bugged and doesnt match original"); follow-up named by P-UNITY-OVERHEAD-1
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
P-UNITY-OVERHEAD-1 rebuilt the overhead stack (bar, name, Wish icon, crown, build row, mark pips) to the legacy layout
but left statuses as a row of plated badges, now sitting above the whole stack with an interim offset. Legacy draws no
badge row: each status is art on or around the body at a fixed anchor (stun stars at the head, silence at the right,
the slow clock at the left, anti-heal beside the bar, flames and streaks on the body, rooted and zoned rings at the
feet). When this lands the Unity badge row is gone and each status the client is told about is drawn at its legacy
anchor, chosen by a pure function with tests; the interim `topPx + 14` offset is removed.

## 2. Dependencies
none (P-UNITY-OVERHEAD-1 is merged)

## 3. Relevant legacy paths
- `packages/client/src/render/StatusArt.ts` (anchors per status kind; survey: `:20`, `:259-291`)
- `packages/client/src/render/PlayerView.ts`, `MobView.ts` (where StatusArt is attached and which statuses mobs show)
- `docs/rework/LEGACY_INDICATORS.md` sections 2-2.3 (existing write-up; the code wins where they differ)
(the oracle author verifies the lines and pins each status kind's anchor, size and draw order)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/StatusAnchors.cs` (pure: status kind and actor kind to anchor, size, layer) and its
  test file

## 5. Exclusive write scope
- the new library file and its synced copy (and its Unity `.meta`)
- `client-unity/UnityProject/Assets/Scripts/Presentation/OverheadIndicators.cs` (remove the badge row and the interim
  offset), `OverheadExtras.cs`, `SpriteActorPresenter.cs` (attach status art)
- EditMode tests under `client-unity/UnityProject/Assets/Tests/Editor/` that pin the badge row

## 6. Contracts and references
- C-OBS: only statuses in the actor's delivered status bits are drawn. No new wire field (protocol unchanged).
- ADR 0026 (legacy indicator facts): which status facts the client has today. A legacy status with no fact on the wire
  is listed in the brief as out of scope, not guessed.
- No game rule in Unity.

## 7. Behaviour to preserve
- The overhead stack from P-UNITY-OVERHEAD-1 (`OverheadStack`), the rooted and zoned rings, elite ring and star,
  teleport-immunity ring, Fire roam glow, lock ring, brand ring and the signature text cue.
- No allocation per frame.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-OVERHEAD-2-oracle` passes; the Unity EditMode suite passes.
- Unit tests on the pure function: each status kind maps to its legacy anchor and layer; two statuses with different
  anchors do not overlap; an unknown status gives nothing; no badge-row element is produced.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-OVERHEAD-2`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`
- Unity EditMode batch in the worktree (copy-on-write clone of the main checkout's `Library`)

## 10. Risk and suggested model tier
Sonnet. Medium: many status kinds, each small. The existing glyph art is reused; only its placement changes.

## 11. Known traps
- Anchors are in legacy pixels relative to the feet: convert once through `OverheadStack.ToUnits`.
- Archetype body sizes differ per look: legacy anchors assume one body size; say in the hand-off whether anchors scale
  with the archetype's body height or stay fixed, and why.
- Several statuses at the same anchor (two body effects): follow legacy's draw order, do not stack them sideways.

## Notes from previous attempts
