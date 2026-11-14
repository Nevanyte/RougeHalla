# P-UNITY-FROST-WALL-1: the Unity client draws a standing Frost Wall and aims it with a preview

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"); the client half
  named by P-FROST-WALL-1 (line 5) and P-FROST-WALL-2 (section 5)
- **Implementer tier:** implementer-sonnet (C#/Unity); the oracle author is Opus because the oracle includes vectors
  produced by `rh-sim`
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework after P-FROST-WALL-2 (the wall on the wire and in `RoguehallaNet`). This
  packet and P-FROST-WALL-2's profile flip are pushed in the same integration batch (see P-FROST-WALL-2 section 10).
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4` (read with `git show`; it is not
  merged into `packages/`) · D9: the preview is a second mirrored rule beside walk prediction; it is display only,
  checked with Rust vectors, and never decides an outcome · no wire change · no game rule in Unity

## 1. ID and outcome
After P-FROST-WALL-2 a wall exists on the wire and Frost's Wish places one at the cursor the moment R is pressed
(`Net/MatchClient.cs:421-422` already sends the cursor point with the Wish). Nothing draws it, and the player cannot
see where it will land. When this lands:
1. **A standing wall is drawn.** One ice block per wall tile the server delivered (never tiles the client computed),
   standing up from the ground: a pale top over a blue face with a darker edge, sorted with actors by its southmost
   tile, in the caster's faction tint only if legacy did so (legacy: fixed ice colours `0xe1f5fe` top, `0x4fc3f7` face,
   `0x0288d1` edge, lift 20 px; `git show 78dd8bd4 -- packages/client/src/render/FieldView.ts`, `drawWall`). In its
   last second it cracks pale (legacy: alpha falls by 0.3 over the final 1000 ms). It disappears when the server says
   the wall fell, not on a client clock.
2. **The cast telegraph.** During the 250 ms cast a line of frost across the aim point, square to the caster,
   thickening as the cast gathers (legacy `WishFx.ts` `drawWallTelegraph`).
3. **The aim preview.** With a placed Wish (the Welcome says Frost has `Wall`), pressing R shows where the wall would
   stand: the reach ring round the player, a translucent block on each tile the wall would take, the wall's line and
   its centre dot; red when it would take no tile (aimed into rock). A click places it at the cursor; the legacy
   cancel rule applies (the oracle author reads `RaidScene.ts` in `78dd8bd4` and states it: which key or button
   cancels, what happens on death, stun or a second press). A **quick cast** setting (legacy `settings.ts`: off by
   default) casts at the cursor on the key press with no preview. Every other Wish behaves as today.
4. **The preview's geometry is the server's.** The segment and tiles come from an engine-free mirror of
   `rh-sim`'s wall placement (`crates/rh-sim/src/barriers.rs`; the constants at `abilities/mod.rs:272-278`: range 450,
   minimum range 64, length 224) in `client-unity/RoguehallaNet/Net/Ui/`, checked against vectors `rh-sim` produces
   (the walk-prediction precedent, ADR 0008: find where its vectors live and follow it). The mirror is used only to
   draw the preview: the command still sends the cursor point, and the wall drawn after the cast is the server's.

## 2. Dependencies
P-FROST-WALL-2 merged on the staging branch (the wall in `RoguehallaNet`'s client state and the Welcome's Frost Wish).

## 3. Relevant legacy paths (all in commit `78dd8bd4`, not in the working tree)
- `packages/client/src/render/FieldView.ts` (`drawWall`), `render/AbilityAim.ts` (`aimPlan`, `AbilityAim.draw`),
  `render/WishFx.ts` (`drawWallTelegraph`), `scenes/RaidScene.ts` (aim state, quick cast, the planning map that
  includes standing walls), `settings.ts` and `ui/settingsPanel.ts` (the quick-cast setting and its note)
- `packages/shared/src/barriers.ts` (`wallSegmentFor`, `wallCells`): the rule Rust ported

## 5. Exclusive write scope
- new `client-unity/RoguehallaNet/Net/Ui/FrostWallAim.cs` (+ the synced copy by `client-unity/sync-net.sh`)
- new `client-unity/UnityProject/Assets/Scripts/Presentation/FrostWallPresenter.cs` (standing walls, telegraph, preview)
- `Assets/Scripts/Net/MatchClient.cs`: only the Wish key path (aim state, click to place, cancel, quick cast)
- the settings surface that holds client options: one new option (the oracle author names the file)
- `Assets/Scripts/View/ArenaView.cs`: only the lines that create, tick and dispose the presenter
- not `Protocol/**`, not shaders, not any existing test, not `crates/**` (the vector generator is an oracle file)

## 7. Behaviour to preserve
- Every other Wish: one press casts, as today; the Wish sequence trace at `MatchClient.cs:423` is unchanged.
- A client whose Welcome says Frost has `Freeze` shows no preview and draws no wall.
- No allocation per frame in the presenter's tick once warmed (pooled blocks), like the other presenters.
- Click-to-move pathing treats standing wall tiles as blocked if legacy's planning map did (`RaidScene.ts` in
  `78dd8bd4`: it did; say whether P-FROST-WALL-2 already delivers that through `RoguehallaNet` pathfinding, and if
  not, name it as out of scope here and flag it).

## 8. Acceptance checks
- Engine-free: on the Rust vectors (caster, cursor, facing, map → segment and tiles) `FrostWallAim` returns the same
  segment (to 1e-3) and exactly the same tiles; cases include a cursor inside the minimum range, beyond the range, a
  wall across rock (no tiles), a diagonal, and a map edge. Red today (the type does not exist: stub first).
- EditMode: a delivered wall of N tiles makes N blocks at those tiles; when the client state drops the wall the blocks
  are gone; the last-second crack lowers alpha; the preview is red with zero tiles; R then click sends one Cast at the
  cursor; R with quick cast on sends it at once; cancel sends nothing.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-FROST-WALL-1` passes.
- A look check per `docs/unity/LOOK_CHECK.md` and one Web round per `docs/unity/WEB_ROUND.md` with a Frost player
  placing a wall; the owner sees it only from the running client.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`
- `bash client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. The risk is the mirror drifting from Rust: the vectors are the guard, and the preview never decides anything.

## 11. Known traps
- Draw the wall from delivered tiles. A wall drawn from the client's own geometry would show ice where the server
  blocks nothing.
- The preview's tiles depend on the map with standing walls and gates applied as the server sees them; state which
  map the mirror reads and pin a vector with a gate closed if the rule reads gates.
- Looks-only numbers (colours, lift, crack time, preview alpha) are dials: add them to `docs/unity/DIALS.md` with a
  range, so later changes go through the tuning lane (`docs/agent/TUNING_LANE.md`).

## Notes from previous attempts
