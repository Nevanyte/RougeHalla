# P-UNITY-HUD-TERRAIN-1: terrain chips say what the ground under you is doing

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 HUD); owner direction 2026-11-10 (MIGRATION checkpoint,
  decision 7: the HUD presents the same information as legacy); plan lane B, packet 6 ("terrain chips")
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Legacy shows a chip while the local player stands on ground that acts on them: "BURNING" (embers), "SLOWED" (bog),
"ICE", "RESTING" / "RESTING xN", and a "Home ground: ..." note for a faction on its own terrain, each with a one-line
explanation carrying the number. Unity shows nothing. When this lands a pure function turns the terrain code under the
local player, the player's faction and the delivered rest state into the legacy chips, and the HUD draws them where
legacy does.

## 2. Dependencies
- P-UNITY-HUD-BUILD-1 merged (same HUD files: strictly serial)

## 3. Relevant legacy paths
- `packages/client/src/ui/terrainChips.ts:24-30`, `packages/client/src/render/zoneArt/terrainFeedback.ts` (survey:
  `:82` BURNING, `:86` SLOWED, `:88` ICE, `:92` RESTING, `:104-106` Home ground)
- the constants those texts quote (burn share per second, slow factor) in `packages/shared/src/constants.ts`
(the oracle author verifies the lines, pins texts and numbers, and finds whether the live terrain mode exempts home
factions: the owner said on 2026-11-11 that live faction terrain exemptions stay as they are)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/TerrainChips.cs` (pure) and its test file

## 5. Exclusive write scope
- the new library file, its synced copy and `.meta`
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Features.cs` (the chip row) and, if a new partial is cleaner,
  one new `MatchHud.Terrain.cs`
- a new EditMode test file

## 6. Contracts and references
- No game rule in Unity: the chip reports the tile's terrain code from the delivered map and the numbers from content
  the client already holds (or constants mirrored with a test against the Rust value); it never changes movement or
  health. If a number is not available to the client, the chip shows the legacy text without the number and the brief
  lists it.
- Terrain plane: the map blob (`client-unity/RoguehallaNet/Protocol/MapBlob.cs`); local position: the predicted
  position the HUD already uses.

## 7. Behaviour to preserve
- The rest of the HUD; no allocation per frame (chips rebuilt only when the tile's terrain or the rest state changes).

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-TERRAIN-1` passes; Unity EditMode passes.
- Unit tests on the pure function: each terrain code gives its legacy chip and explanation; plain floor gives none; the
  home-ground rule as the live mode applies it; resting with and without a multiplier.
- One EditMode case: the HUD draws the model's chip.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/TerrainChipsTests.cs` (8 cases; 5 fail on assertions against the stub, 3 hold already:
  no-chip codes, mode Off, mirrored constants)
- Stub (editable, replace the bodies): `client-unity/RoguehallaNet/Net/Ui/TerrainChips.cs` with
  `TerrainChip[] For(byte terrain, byte terrainMode, FactionId? faction)` and `string HomeNote(...)`, constants
  `BurnShare = 0.02`, `BogSpeed = 0.7`, plus the synced Unity copy and its `.meta`.

## Legacy rules as verified
- Chips (`packages/client/src/render/zoneArt/terrainFeedback.ts:78-97`): `BURNING` glyph U+25B2, "Embers burn {pct} of your max hp
  every second" (:82); `SLOWED` glyph U+25BC, "{Bog} slows you to {n}% speed" (:86); `ICE` glyph U+25C7, "Slippery: you slide when
  you start, turn or stop" (:88). `pct = round(share*1000)/10` + "%" (:75). Order burning, slowed, ice, resting.
- Numbers: burn 0.02 and bog 0.7 (`packages/shared/src/terrain.ts:67-68`); Rust `crates/rh-sim/src/constants.rs:348-349`
  (`TERRAIN_BURN`, `TERRAIN_BOG`). The client holds no content for them: mirrored as constants, tied by a test that reads
  constants.rs as text. Ice has no number in its text.
- Home note (:100-108): "Home ground: embers can't burn you" / "bog can't slow you" / "full grip on ice"; only when the tile is the
  faction's own hazard and exempt (:55,59); in that case no chip shows (:61).
- Rust terrain codes (terrain plane): 4 ember, 5 bog, 6 ice, 7 light; 1-3 (lava, fence, crevasse) have no chip.
- Placement: chips are a flex row (wrap, gap 4px, max-width 256px) directly under the vitals/health/build/extras stack
  (`hud.ts:138`, `ui/terrainChips.css:2`), hidden when empty; each chip is glyph + word with the explanation as tooltip; the home
  note is a full-width green line (`.ground-note`, css:14) below the chips. Rebuilt only when the set changes (`terrainChips.ts:20`).
  Nothing shows when not playing or dead (`terrainChips.ts:17`).
- The map blob carries the terrain mode (`MapBlob.TerrainMode`: 0 Off, 1 Map, 2 All); the implementer passes it through. Terrain
  code is `map.Terrain[ty*W+tx]` for the tile under the predicted position (null Terrain = no chip).

## Differs under the live mode
- Live runs `terrain::Mode::All` (`crates/rh-server/src/runtime.rs:222`); with it the sim passes no faction to the terrain table
  (`systems/terrain/mod.rs:19`, `systems/movement.rs:64`), so Fire on embers, Plague in bog and Frost on ice are all affected.
  Legacy's "Home ground" line (and the missing chip) would be false there. The oracle pins: mode All = chip for every faction,
  never a note; the legacy exemption and note only under mode Map (not live). Mode Off = nothing. Not a new deviation: owner
  2026-11-11 kept live exemptions as they are; the HUD reports what the server does.
- Rust names the ember tile "Lava" (`terrain.rs:42` EMBER_NAME, used for the content hash only); the chip text keeps legacy "Embers".

## Not on the wire
- RESTING / "RESTING xN": legacy derives it from hp below max, a 3 s combat memory built from fx and heal fx
  (`terrainFeedback.ts:51,116-158`); no rest, combat or light-heal fact is in `Collections.cs`/`State.cs`. Left out: code 7 gives
  no chip. Under Mode::All the Holy x2 boost does not apply either (surface() with no faction). A later packet may add the fact.

## Legacy doubts
- `terrainFeedback.ts:75` rounds to one decimal; fine for 2%, noted only.

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Small.

## 11. Known traps
- Terrain codes differ between the tile plane and the terrain plane: use the terrain plane's codes as Rust names them.
- "RESTING" needs a delivered fact; if none exists, leave it out and list it under "Not on the wire".

## Notes from previous attempts
