# P-UNITY-HUD-BUILD-2: the bottom-left champion panel shows the legacy rows from the server's panel values

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 HUD); owner direction 2026-11-10 ("the damage and
  calculations on the hud in bottom left corner are not presented the same. Please make UI more closely match the
  legacy version in terms of the information presented")
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Legacy's bottom-left champion panel has three rows: the **auto attack** (damage per hit split into physical, magic and
true, and attacks per second), the **faction passive** with its live numbers (Fire burn per second and roam charge,
Sentenced mark pulse and kill-stack share, Plague disease per second with corpse stacks and the zombie's health, Frost
slows and Frozen Justice, Holy life steal with camp clears), and the **Wish**. Unity shows attack-speed and move-speed
multipliers instead. With P-WIRE17-HUD-2 the owner receives the panel values (`Collections.Summary.Panel`: codes 0-22
with values in `Hud.Quantum` units). When this lands a pure formatter turns the panel values into the auto row and
the passive row with legacy's labels, order and 2-decimal formatting, and the HUD draws them in the bottom-left
panel. The Wish row's numbers arrive with P-WIRE17-HUD-2b: until then the Wish row keeps today's text and is listed
as not delivered. Unity formats; it computes nothing except the displayed total of the three damage parts (as the
wire packet's brief records).

## 2. Dependencies
- P-WIRE17-HUD-2 merged (the panel values)

## 3. Relevant legacy paths
- `packages/client/src/ui/championCombatModel.ts:91-216` (rows and what each prints), `championCombatHud.ts:72,95-111`
  (labels, visibility: only while alive and the run is active or training, 2-decimal rounding)
- the code table in `docs/backlog/packets/P-WIRE17-HUD-2.md` (code, meaning, legacy line)
(the oracle author verifies the lines and pins each faction's row text for a sample panel)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/ChampionPanelText.cs` (pure: panel values and faction in, the rows out) and its
  test file

## 5. Exclusive write scope
- the new library file, its synced copy and `.meta`
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Legacy.cs` (the champion panel, around `:243-272`, `:466-474`),
  `MatchHud.IconPresentation.cs` (`:28-55`: the multipliers it replaces)
- EditMode tests that pin the old panel text; one new EditMode case

## 6. Contracts and references
- R-AUTH: every number is a delivered panel value. C-OBS: the panel is the local player's own.
- A code that is absent is not shown (never a zero that looks real); an unknown code is skipped.

## 7. Behaviour to preserve
- The GAINED strip, mob-bonus row, terrain chips, slot texts and the rest of the HUD; tooltips.
- No allocation per frame: rows are rebuilt only when the summary object changes (as `BuildHudText` does).

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-BUILD-2` passes; Unity EditMode passes.
- Unit tests on the formatter: the auto row for a sample panel (three parts, total, attacks per second, legacy
  formatting); each faction's passive row from a sample of its codes; conditional parts (zombie health only with a
  living zombie; "armed" versus "N/M charged"; Frozen Justice active); a null summary or empty panel gives the legacy
  empty state; legacy's visibility rule (alive, active or training).
- One EditMode case: the HUD draws the formatter's rows.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/ChampionPanelTextTests.cs` (12 cases; red on assertions against the stub)
- this brief

Stub (commit 1, the implementer replaces the bodies): `client-unity/RoguehallaNet/Net/Ui/ChampionPanelText.cs` with
`ChampionRow { Name, Value, Scaling, Detail }`, `ChampionRows { Auto, Passive, Roam }`,
`ChampionPanelText.Visible(bool alive, bool roomActive, bool training)` and
`ChampionPanelText.Rows(WireBuildSummary summary, FactionId faction, WeaponId weapon)`; the synced Unity copy and `.meta`.

## Routing
- serves: ORDER_OF_OPERATIONS phase 3 item 16 · tier: implementer-sonnet · reviewer: reviewer · D-rules: D1 loose proof
- write scope: section 5 (library file, its copy, the two `MatchHud` files, EditMode tests)

## Formatting rules the tests pin
- `fmt` (championCombatModel.ts:74): two decimals, half up, trailing zeros dropped (`1.5`, `20`, `0`). A panel value is an
  integer q of `Hud.Quantum` (1e-4); a fraction shown as a percent is q/100 exactly (q=216 -> `2.16`), so percents never
  round. Other numbers: hundredths = floor((q + 50) / 100). Use integer arithmetic, as `BuildHudText.Scaled` does.
  (Legacy rounds `Math.round(n*100)/100` on floats; an x.xx5 value can differ in the last digit. Tests avoid it except 64.375,
  which is exact in binary.)
- The auto total is the sum of the three unrounded parts, then fmt (test: 3 x 1.404 -> `4.21`, not `4.2`).
- Empty/absent: a fragment whose codes are absent is not printed; a value line with nothing to print is `"—"`
  (non-legacy placeholder: legacy has no data-absent state, it hides the whole panel, see Visible); a scaling line with
  absent codes is `""`. Unknown codes (>= 23) are skipped.

## Legacy rules as verified (championCombatModel.ts unless noted)
| Row | Text | Codes | Line |
|---|---|---|---|
| Auto name | `<Weapon name> hit` (Sword, Bow, Wand, Shield, Axe, Fists) | weapon | :124 |
| Auto value | `<fmt total> / hit · <fmt aps>/s`; total = codes 0+1+2 | 0-3 | :124, :111-113 |
| Auto detail (tooltip, first sentence) | `Raw damage per hit before target mitigation: <p> physical, <m> magic, <t> true.` zero parts printed | 0-2 | :126 |
| Fire roam (tooltip tail) | `Fire Roam is armed` if code 9 non-zero, else `Fire Roam is <fmt min(1000,max(0,c))>/1000 charged` | 8, 9 | :114-116 |
| Fire | `Dragonslayer`, `<fmt burn> magic/s`, `SO adds <fmt c5>, Offense <fmt c6> magic DPS/point · DoT ×<fmt c7>` | 4-7 | :144-155 |
| Sentenced | `Sentence`, `<fmt pulse*100>% target HP / hit`, `+<fmt kill*100>%/kill stack · attack speed` | 10, 11 | :157-168 |
| Plague | `Rat King`, `<fmt disease> magic/s`; scaling: stacks 0 `Walk over a body: raise zombie`; stacks > 0 and no zombie codes `Zombie fallen · walk over a body to revive`; else `Zombie <hp>/<max> HP · <n> body|bodies` | 12-15 | :177-186 |
| Frost | `Ice wall`, `<fmt slow*100>% AS · <fmt move*100>% MS slow`, `Frozen Justice: +<bonus> Defense/SD · ACTIVE|elite fights` | 16-19 | :196-201 |
| Holy | `Radiant`, `<fmt steal*100>% life steal`, `<fmt camps> camps · +<fmt leech*100>% earned leech` | 20-22 | :205-212 |
| Visibility | alive and (training or phase active) | status, phase | championCombatHud.ts:72 |
| Row order | auto, passive, wish | | :136 |

Pinned sample texts: Fire `64.38 magic/s` / `SO adds 0.6, Offense 0.5 magic DPS/point · DoT ×1.25`; Sentenced `2.16% target
HP / hit` / `+1.35%/kill stack · attack speed`; Plague `62.4 magic/s` / `Zombie 412.5/600 HP · 3 bodies`; Frost `32% AS ·
30% MS slow` / `Frozen Justice: +25 Defense/SD · elite fights`; Holy `7% life steal` / `0 camps · +0% earned leech`.

## Not delivered yet (left out of the pinned text, listed)
- The Wish row (`:219-227`): P-WIRE17-HUD-2b. Until it lands the Wish row keeps today's text (`MatchHud.Legacy.cs:473-474`).
- The auto row's scaling line (`:119-122`, `:125`, `weapon.scaling` terms such as `1x Offense or 1x SO`): weapon constants, HUD-2b.
- Fire `(X% move speed)` in the roam sentence (`:115`, `fireRoamSpeedMult`, max 1.5): the wire carries only the charge. The
  roam burst text (`:115`) likewise. Fire backlash (`:153-154`).
- Tooltip-only numbers per the P-WIRE17-HUD-2 "Deliberately left out" list. The pinned `Detail`/`Roam` strings are the
  only tooltip fragments; the implementer may show them as the panel hint or not at all.
- Plague scaling: legacy falls back to a computed zombie max hp when the server sends none (`:184`); the wire has none, so the
  `Zombie fallen` text stands for "stacks > 0 and codes 14/15 absent" (the table in HUD-2 says absent exactly then).
- A Plague panel with code 13 absent prints no scaling (legacy would read 0 stacks).

## Unity call sites the implementer changes
- `MatchHud.IconPresentation.cs:28-55` `RefreshDamageReadout`: replace the multiplier/TopStats text. Row 0 `_championValue[0]`
  <- `Auto.Value`, `_championScaling[0]` <- `Auto.Detail`-free scaling (empty today); row 1 `_championValue[1]` <- `Passive.Value`,
  `_championScaling[1]` <- `Passive.Scaling`; row names (`MatchHud.Legacy.cs:253` `labels`) <- `Auto.Name`/`Passive.Name`.
  Source: the owner summary (`Collections.Summary`) with `me.Faction`, `me.Weapon`. Hide the panel with
  `ChampionPanelText.Visible(me alive, phase active, training)`. Remove `TopStatsLine` if nothing else uses it.
- `MatchHud.Legacy.cs:243-272` `CreateDamageReadout` (labels, row layout; the hint text `DamageUnavailable` may carry `Auto.Detail`
  and `Roam`), `:466-474` (champion name/icon stay; the Wish row line stays as is).
- Rebuild only when the summary object changes (reference compare as `BuildHudText` users do), not per frame.

## Legacy doubts
- `championCombatModel.ts:212` prints `N camps` without a plural: pinned as legacy (`1 camps`).
- `championCombatModel.ts:74` `fmt` uses float `Math.round(n*100)/100`; integer half-up can differ on x.xx5 floats.

## Existing tests this packet changes
- none (the old EditMode panel-text tests, if any, are named by the implementer for owner approval).

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Medium: five faction rows over one formatter.

## 11. Known traps
- Percent values arrive as fractions in quantum units: format as legacy prints them (percent sign, decimals).
- The panel is re-sent often (roam charge every tick while ramping): the rebuild-on-change guard must compare the
  shown strings or values, not allocate every time a summary arrives.

## Notes from previous attempts
