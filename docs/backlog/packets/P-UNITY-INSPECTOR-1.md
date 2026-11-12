# P-UNITY-INSPECTOR-1: the enemy inspector card on hover

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-7 combat presentation); owner direction 2026-11-10 (MIGRATION
  checkpoint, decision 7: the HUD presents the same information as legacy); plan lane B, packet 7
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Legacy shows a small card when the cursor rests on another fighter: its kit line ("{Faction} · {Weapon} · {role}"), its
health ("Health {hp} / {maxHp}"), a build line (card power, PvP factor, growth), damage-share chips ("{label} N%") and
its Offense / Soul Offence gains. Unity has no such card. When this lands Unity shows the card for the fighter under
the cursor, built by a pure function from the actor row the client already has, with every line legacy shows that the
wire carries. A line whose fact is not on the wire is left out (never a placeholder, never "not delivered") and listed
in the brief.

## 2. Dependencies
none

## 3. Relevant legacy paths
- `packages/client/src/ui/opponentInspector.ts` (survey: `:57` kit, `:58` health, `:60` card power line, `:77` damage
  chips, `:83-84` offense gains; the oracle author verifies the lines and pins texts, order, rounding and when the card
  shows and hides: hover delay, mobs versus players, hidden or dead fighters)
- `docs/unity/PROTOCOL_GAPS.md` rows P12 / B2 (remote build facts that are not on the wire)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/InspectorCard.cs` (pure: an actor view in, the card's lines out) and its test file
- `client-unity/UnityProject/Assets/Scripts/UI/InspectorCardView.cs` (draws the card near the cursor)

## 5. Exclusive write scope
- the two new files, the library file's synced copy and `.meta` files
- the hover hook only: `client-unity/UnityProject/Assets/Scripts/View/ActorPick.cs` (expose the actor under the cursor
  if it does not already) and the one place the view is created (`ArenaView.cs` or the HUD root; name it)
- a new EditMode test file under `client-unity/UnityProject/Assets/Tests/Editor/`
- not the `MatchHud*.cs` files (other packets are editing them)

## 6. Contracts and references
- C-OBS: only facts in the hovered actor's delivered row; nothing inferred about a fighter the viewer cannot see (a
  hidden fighter has no card).
- No game rule in Unity: percentages are formatted from delivered values, not recomputed from a build.
- Actor rows: `client-unity/RoguehallaNet/Net/Collections.cs` (player and mob views), `Protocol/State.cs` (`WireActor`).

## 7. Behaviour to preserve
- Target picking and the wand lock (`TargetPick`), the lock ring, tooltips of HUD elements.
- No allocation per frame while the card is shown and the actor's row has not changed.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-INSPECTOR-1` passes; the Unity EditMode suite passes.
- Unit tests on the pure function: a player row gives the kit and health lines with legacy text and rounding; each
  legacy line whose fact is delivered appears in legacy order; a line whose fact is not delivered is absent; a mob row
  gives what legacy gives for a mob (pin it, including "no card"); a dead or hidden actor gives no card.
- One EditMode case: hovering an actor shows the card with the model's lines; moving off hides it.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/InspectorCardTests.cs` (the only oracle file; the stub `RoguehallaNet/Net/Ui/InspectorCard.cs`, its
  synced copy and `.meta` are the implementer's to replace)

## Pure function (signature fixed by the stub)
`public static bool InspectorCard.Build(in InterpActor row, uint selfId, List<string> lines)`: clears `lines`; returns whether the
card shows, filling kit line, health line, then one entry per delivered stat chip. `InterpActor` (Net/SnapshotBuffer.cs:9) is the
delivered remote row; `selfId` is the local player's id.

## Legacy rules as verified (`packages/client/src/`)
- Show: only a `state.players` entry (`scenes/RaidScene.ts:748-750`), phase active, `status === "alive"` and a known faction
  (`ui/opponentInspector.ts:46`). Mobs, zombies, dummies and givers live in `state.mobs` (`RaidScene.ts:1378`), so they get **no card**.
  Self is never offered (`RaidScene.ts:1376`, `liveFighter` `:1660`), so the local player gets no card. Hidden and untargetable
  fighters are not hover candidates (`render/targeting.ts:37`, `RaidScene.ts:1370-1373`); pinned as no card (C-OBS).
- Kit line `"{Faction} · {Weapon} · {role}"` (`opponentInspector.ts:57`); weapon outside the known set reads "Fists" (`:57`, also for a
  null weapon). Faction roles: `shared/src/factions.ts:48-68` (Glass-cannon duelist, Patient executioner, Attrition swarm,
  Control bruiser, Sustain juggernaut). Weapon names `shared/src/weapons.ts:96-124`.
- Chips for invested stats, most invested first (`opponentInspector.ts:63-69`), labels `shared/src/combatReadability.ts:44-54`
  (Offense, Soul Offence, Damage, Health, Attack Speed, Defense, Soul Defense, Move Speed, Leech). Legacy shows up to three
  (`.slice(0, 3)`); the wire's `TopStat1/2` are `topStats = investedStats.slice(0, 2)` (`combatReadability.ts:123`), so at most two.
- Card order top to bottom: name, kit, health, growth, stat chips, damage chips, offense, defenses, wish, static note.

## Not on the wire (left out, no placeholder)
- Name (title, `:56`), the card power / PvP factor / growth line (`:60`, needs the build), damage-share chips (`:70-80`),
  Offense / Soul Offence gains (`:83-84`), Defense / Soul Defense values (`:87-88`), third stat chip, Wish line with ability text
  and "Ready in N s" (`:91-93`; only the ready flag is delivered), the static note (`:22`, it explains lines that are absent).
  `docs/unity/PROTOCOL_GAPS.md` `build.opponent-inspector` agrees (missing-in-protocol); code checked: `InterpActor` has none of them.
- **Absolute health.** Legacy prints `Health {ceil hp} / {ceil maxHp}` (`:58`); a remote row carries only `HpPct` (whole percent).
  The oracle pins `Health {HpPct}%` as the delivered form of that line. This is an adaptation of the text, not legacy's: the
  coordinator should confirm it or ask for omission (a one-line change in the test) and decide whether it needs a DEVIATIONS row.

## Hover rules as legacy has them (differs from the survey and from section 11)
- **No delay, no cursor offset, no screen-edge flip.** The card is a fixed panel, `position:absolute; top:88px; right:18px;
  width:min(330px,40vw); pointer-events:none; z-index:15` (`ui/opponentInspector.css:1`), `<=650px` wide screens `top:80px;
  right:8px; width:230px` (`:23`). It cannot cover the cursor target by following the cursor because it does not follow it.
- Which fighter: `hoverId || lockId` each frame (`RaidScene.ts:748`). `hoverId` = nearest eligible fighter within the snap radius of
  the cursor ground point, only while the local player is alive, the pointer has been seen, the cursor is over the canvas (not a
  DOM panel) and not peeking (`RaidScene.ts:1645-1648`); `lockId` = the wand lock while holding a wand (`:1650`). Moving off hides the card at the next frame unless a lock holds.
- Unity implementer: reuse `ActorPick`/`TargetPick` for hover; a fixed top-right panel is the legacy behaviour (section 11's
  "follow the cursor/flip" trap does not apply). Flag if the owner wants a cursor-following card instead.

## Name tables (do not add a second list)
- Weapons: `WorldIndicatorRules.WeaponNames` (library, `Net/Ui/WorldIndicatorRules.cs:60`) - reuse.
- Factions: `ShowcasePalette.FactionNames` (private, `UnityProject/Assets/Scripts/Presentation/ShowcasePalette.cs:25`) and roles
  `HubGuideView.Roles` (private, `UI/HubGuideView.cs:17`) live only in the Unity assembly, out of the library's reach. The library
  therefore needs one `FactionNames`/`Roles` table in `InspectorCard.cs`; note in the hand-off that the two Unity lists could forward to it (outside this write scope).

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`
- `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Small: one pure model and one view.

## 11. Known traps
- The card must not cover the fighter it describes or the cursor: follow legacy's offset and its screen-edge flip.
- Faction, weapon and role names: use the client's existing name tables (find them; do not add a second list).

## Notes from previous attempts
