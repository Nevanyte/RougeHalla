# P-UNITY-WORLD-MARKS-1: the last world marks legacy draws: camp patience range, Sentenced hunt target ring, quest carrier flag

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-7 combat presentation); owner direction 2026-11-10 (MIGRATION
  checkpoint, decision 7: the HUD presents the same information as legacy); `docs/rework/LEGACY_INDICATORS.md` rows
  W11, W17, W7 (the only rows a 2026-11-11 audit found still undrawn with their data on the client)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Three legacy world marks are missing in Unity although the client holds their facts:
- **Camp patience range (W11):** legacy outlines the area in which a camp's mobs keep chasing (the union of the camp's
  leashes, cyan) with the label "PATIENCE RANGE" while the local player is fighting that camp
  (`packages/client/src/render/CampPatience.ts`). The map blob carries each camp's position and radius.
- **Sentenced hunt target ring (W17):** a violet ring under the fighter the local Sentenced player is hunting
  (`packages/client/src/ui/sentencedHuntHud.ts`). The hunt target is in the local player's own view; Unity shows it in
  a HUD list only (`SentencedHuntPanel.cs`).
- **Quest carrier flag (W7):** a flag over the fighter carrying a quest item (`packages/client/src/render/QuestView.ts`
  around :167). The quest row carries the carrier as a roster id.
When this lands a pure function decides, for each of the three, whether it shows, where, and with what text, and the
world presenter draws them. A mark whose fact turns out not to be delivered (e.g. no roster-id to actor-id mapping for
the carrier) is left out and listed.

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/client/src/render/CampPatience.ts:18-50` (outline), `:79` (label), `:96` (visibility)
- `packages/client/src/ui/sentencedHuntHud.ts` (ring colour and when it shows)
- `packages/client/src/render/QuestView.ts` (carrier flag)
(the oracle author verifies the lines and pins colours, texts and show/hide conditions)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/WorldMarks.cs` (pure) and its test file

## 5. Exclusive write scope
- the new library file, its synced copy and `.meta`
- `client-unity/UnityProject/Assets/Scripts/Presentation/WorldIndicators.cs` (or one new presenter beside it) and its
  hook in `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`
- a new EditMode test file

## 6. Contracts and references
- C-OBS: the patience range is public map data (camp position and radius), shown only for a camp the delivered state
  says the local player is engaged with; the hunt target is the local player's own fact; the carrier is public quest
  state. Nothing is inferred about fighters the viewer cannot see: a mark on a fighter needs that fighter in the
  delivered, visible actor list.
- No game rule in Unity: the outline is drawn, it does not decide leashing.

## 7. Behaviour to preserve
- Existing world indicators (chest rings, death marks, respawn labels, reward badges, ward beacons, lock and brand
  rings) and their draw order. No allocation per frame.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-WORLD-MARKS-1` passes; Unity EditMode passes.
- Unit tests on the pure function: the patience outline for one camp is a circle of the legacy radius, for touching
  leashes the union; shown only under legacy's condition; label text; the hunt ring only for a Sentenced local player
  with a visible target; the carrier flag only for a visible carrier; each absent when its fact is absent.
- One EditMode case: the presenter draws each mark the model returns.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-WORLD-MARKS-1`

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Medium: three small marks over one model.

## 11. Known traps
- The camp radius in the map blob may be the clearing, not the leash: legacy's leash radius comes from a constant or
  the mob type; pin which and mirror a constant only with a test tying it to the Rust value.
- Roster ids and actor ids are different spaces: use the client's existing mapping or list the gap.

## Notes from previous attempts
