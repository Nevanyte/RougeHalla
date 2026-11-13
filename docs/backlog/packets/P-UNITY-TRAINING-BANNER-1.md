# P-UNITY-TRAINING-BANNER-1: the practice screen shows legacy's "nothing here is recorded" banner, not Kills and GV

- **Serves:** owner decision 7 (2026-11-10: same information as legacy); finding of P-TRAINING-CAMPS-1's oracle author
  (2026-11-13)
- **Implementer tier:** implementer-sonnet (Unity UI)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof · no wire change

## 1. ID and outcome
Unity's practice panel shows a "Kills" line (player kills, `MatchHud.cs:320` reads `p.credit.kills`) and a GV line.
A practice mob kill never adds to either, so they read 0 for the whole session and look broken (screenshot round 8).
Legacy's practice screen has neither line: it shows the banner "TRAINING — nothing here is recorded"
(`packages/client/src/ui/hud.ts:21`, `:42`). When this lands the practice HUD shows that banner in the same place and
no Kills or GV line; the arena HUD is unchanged.

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud*.cs` (the practice panel; the oracle author names the files)

## 8. Acceptance checks
- EditMode: in practice the banner's text equals legacy's and no Kills or GV label is active; in the arena both lines
  are shown as today.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-TRAINING-BANNER-1` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-TRAINING-BANNER-1`

## 10. Risk and suggested model tier
Sonnet. Serial with other packets editing `MatchHud*.cs` (P-UNITY-HUD-STATUS-2).

## Notes from previous attempts
