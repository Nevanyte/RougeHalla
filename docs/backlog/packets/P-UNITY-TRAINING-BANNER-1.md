# P-UNITY-TRAINING-BANNER-1: the practice screen shows legacy's "nothing here is recorded" banner, not Kills and GV

- **Serves:** owner decision 7 (2026-11-10: same information as legacy); finding of P-TRAINING-CAMPS-1's oracle author
  (2026-11-13)
- **Implementer tier:** implementer-sonnet (Unity UI)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (EditMode unit tests, no capture) · D2 n/a · D5/D6/D9 none · no wire change

## 1. ID and outcome
Unity's practice plate shows a "Kills N · GV N · status" line (`MatchHud.cs:322` writes `me.Kills`, `me.Gv`). A practice mob
kill never adds to either, so they read 0 for the whole session and look broken (screenshot round 8). Legacy's practice
screen has neither line: the first line of its HUD block is the banner
`TRAINING — nothing here is recorded: no GV, no stats` (`packages/client/src/ui/hud.ts:21`, chosen at `:42`).
When this lands the practice plate's first line is that banner, no Kills or GV line is shown, and the arena HUD is
unchanged.

## 2. Dependencies
P-UNITY-TRAINING-HUD-1 and P-UNITY-HUD-STATUS-2 (both merged). Serial with any other packet editing `MatchHud*.cs`.

## 3. Relevant legacy paths
- `packages/client/src/ui/hud.ts:21`: `TRAINING_BANNER = "TRAINING — nothing here is recorded: no GV, no stats"` (U+2014 dash).
  The brief's earlier quote of the first half was a prefix; the whole constant is the string.
- `hud.ts:40-42`: `statusLine` returns the banner first when `s.training` ("Training has no lobby, no standing count and no GV").
  In the arena the same line reads lobby/planning/`Alive n/m · Run GV x` (`:43-52`).
- `hud.ts:185-188`: `training = state.training === true`; the `.hud-status` element gets class `training`.
  `trainingBar.css:46-47`: `.hud-status.training { color: #80deea; letter-spacing: 0.02em; }` (cyan, "the one thing the player must not miss").
- `hud.ts:197-200`: in training `active` is false, so the status line and the vitals line are shown (they are what the arena
  shows while not fighting) and the compact health row is hidden.
- `hud.ts:216-218, 226`, `vitalsHpText` `:80-84`: the vitals line is `name · Faction · <weapon in hand> · hp` in training
  (the arena: `name · Faction · hp · <status>`). The held weapon replaces the status word.
- `hud.ts:206`: no bounty tag in training.
- Legacy has no kills line anywhere in the HUD block (`rg -n "kills" packages/client/src/ui/hud.ts` finds nothing): the
  arena's Unity "Kills · GV" line is a Unity addition (`MatchHud.Legacy.cs:145`, "the kills / GV line Unity already received").

Everything else that differs in that area, today (Unity, practice):
| Line | Legacy training | Unity today |
|---|---|---|
| 1 status | banner above, cyan | `HudStatus` = `PRACTICE · No run rewards or banking` (`MatchHud.cs:261`, written to `_plateStatus` at `:270`) |
| 2 vitals | `name · Faction · weapon · hp` | `Vitals` = `Fire · HP 100 / 100 · Barrier 0` (`MatchHud.cs:321`); no weapon, no name |
| 3 | none | `CombatStats` = `Kills 0 · GV 0 · Alive` (`MatchHud.cs:322`) |
The top-centre strip (`_phaseStrip`, `MatchHud.Features.cs:193`, "PRACTICE · NO RUN REWARDS") and the connection pill
(`_banner`, `MatchHud.cs:261`) also say PRACTICE; legacy has no equivalent of either in training. This packet does not
touch them (see section 11).

## 4. New paths
- none (the oracle adds `TrainingBannerEditModeTests.cs`).

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs` (the `:261` banner text and the `:319-323` owner-facts write)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Legacy.cs` (`CreatePlate`, `SetPlateMode`, `RefreshLegacyHud`: which plate lines are shown in practice, plate height)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Features.cs` only if the phase/plate plumbing needs it
No other file. Do not edit the oracle file or any existing test.

## 6. Contracts and references
- R-AUTH / ADR 0008: Unity draws what the server sent; this removes a display, adds no rule.
- Fit rule of P-UNITY-HUD-TEXTSCALE-1 (`HudTextScaleEditModeTests.cs`): label keeps `MythicTextScale`, no ellipsis/truncation,
  widest line at most 88 percent of its box.

## 7. Behaviour to preserve
- Arena: the plate's lobby/planning/ended lines (status, vitals, `Kills N · GV N · status`) are unchanged.
- The fields `_plateStatus` and `_combatStats` stay (existing tests reach them by reflection), `_combatStats` keeps its
  `MythicTextScale` and `HudTextScaleEditModeTests`' 63-label inventory stays 63.
- `RefreshOwnerPresentation` with no client (tests) still writes `Kills N · GV N · status` into `_combatStats`
  (`MatchHudWishBarrierEditModeTests.cs:82,128`). Suppress the line for confirmed practice only (`_client.ConfirmedPractice`),
  for example by not activating the row (`SetPlateMode`) in practice, not by deleting the write.
- P-UNITY-TRAINING-HUD-1's panel visibility (`TrainingHudVisibilityEditModeTests`: plate, champion panel, hotbar, minimap on in practice).

## 8. Acceptance checks
- `TrainingBannerEditModeTests` (below) all green; EditMode suite otherwise unchanged.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-TRAINING-BANNER-1` passes.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/TrainingBannerEditModeTests.cs` (and its `.meta`)

Tests, with state on the commit (real `MatchClient` + `MatchHud` through the existing `TrainingHudRig`):
| Test | Today |
|---|---|
| `InPracticeTheFirstPlateLineIsLegacysTrainingBanner` | RED: "the practice plate carries legacy's banner (hud.ts:21); plate labels: HudStatus='PRACTICE · No run rewards or banking' \| Vitals=... \| CombatStats='Kills 0 · GV 0 · Alive'" |
| `InPracticeNoActiveLabelShowsKillsOrGv` | RED: "legacy's training HUD has no kills or GV line (hud.ts:42); Unity shows: CombatStats='Kills 0 · GV 0 · Alive'" (any active label with "Kills"/"GV" other than the banner itself) |
| `InTheArenaTheKillsAndGvLineAndTheRunStatusAreShownAsToday` | GREEN guard (puts the plate in its non-active mode, as lobby/planning/ended do; line reads `Kills N · GV N · status`; no banner in the arena) |
| `InPracticeTheBannerFitsItsBoxAtEveryWindowAndTextScale` x 6 (1280x720, 1920x1080, 1024x768 by scale 1, 1.5) | RED: "the practice HUD shows the banner (otherwise there is nothing to fit)". Checked by temporarily swapping the text at `MatchHud.cs:261`: all six then pass with the current 278x15 box, so they are guards on a layout change, not a driver of one |

## 9. Validation commands
- `client-unity/UnityProject/Tools/editmode.sh` (whole suite); afterwards `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset`.
- Single fixture: Unity `-runTests -testPlatform EditMode -testFilter Roguehalla.Client.Tests.TrainingBannerEditModeTests`.

## 10. Risk and suggested model tier
Sonnet. Low risk; the only trap is the plate height (`SetPlateMode` sizes it for three rows) and the existing tests in section 7.

## 11. Known traps
- The banner itself contains "GV": the no-GV test excludes a label whose text is exactly the banner.
- `RefreshLegacyHud` flips plate mode only when `active` changes (`MatchHud.Legacy.cs:484`); a practice room is never active.
- Not pinned, left to the owner: legacy's cyan banner colour (`#80deea`), the held weapon in the vitals line, the name in the vitals
  line, and whether the `PRACTICE ·` top strip and connection pill should go (legacy has neither in training).
- Existing tests: none has to change. `HudTextScaleEditModeTests.cs:140,151` lists `PRACTICE · No run rewards or banking` as a
  PlateStatus text sample and `:153` the Kills line as a PlateCombatStats sample; they stay valid (samples only) if the fields
  stay, but the sample at `:140` is stale after this lands. Updating it is an owner-approved edit, not part of this packet.

## Notes from previous attempts
