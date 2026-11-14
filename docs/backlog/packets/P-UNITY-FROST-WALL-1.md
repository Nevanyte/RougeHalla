# P-UNITY-FROST-WALL-1: the Unity client draws a standing Frost Wall and aims it with a preview

- **Serves:** owner beta follow-up decision 2 (MIGRATION, 2026-11-10: "Frost Wall replaces Freeze"); the client half
  named by P-FROST-WALL-1 (line 5) and P-FROST-WALL-2 (section 5)
- **Implementer tier:** implementer-sonnet (C#/Unity). The aim mirror (`FrostWallAim`) is a second mirrored rule beside
  walk prediction (`client-unity/AGENTS.md`: "a change to the codec or prediction math is cross-language"); it is
  display-only, so Sonnet implements it against the oracle; a change to it later goes with the Rust side.
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework after P-FROST-WALL-2 and P-FROST-WALL-2b (the wall in `RoguehallaNet`'s
  client state and the Welcome's Frost Wish). The oracle is written on `packet/P-FROST-WALL-2b` (`b40c72330`), where both
  are still stubs: this packet's tests construct the client-state objects directly and pass the Wish kind and the wall
  numbers in, so they do not depend on the decoder.
- **D-rules touched:** D1 loose proof against the unreleased legacy patch `78dd8bd4` (read with `git show`; not merged
  into `packages/`) · D9: the preview is display only, never decides an outcome; the cast still goes through
  `Session.CollectWishInput` and the server decides the wall · no wire change · no game rule in Unity

## 1. ID and outcome
After P-FROST-WALL-2/2b a wall exists on the wire and in `CollectionsView.Fields` (`AreaKind.Wall`, `Tiles`, `Key`), and
Frost's Wish places one at the cursor the moment R is pressed (`Assets/Scripts/Net/MatchClient.cs:418-424` sends the
cursor point through `Session.CollectWishInput`). Nothing draws it, and the player cannot see where it will land. When
this lands:
1. **A standing wall is drawn** from the delivered tiles only (never tiles the client computed): one ice block per tile,
   a pale top over a blue face with a darker edge, lifted 20 px (legacy `FieldView.ts` `drawWall`, 78dd8bd4: `WALL_TOP`
   `0xe1f5fe`, `WALL_FRONT` `0x4fc3f7`, `WALL_EDGE` `0x0288d1`, `WALL_LIFT` 20; top alpha `0.85 - 0.3 * crack`, face
   `0.78 - 0.3 * crack`, edge 0.6; `crack = left < 1000 ? 1 - max(0, left) / 1000 : 0`, `left = endsAt - renderT`; the
   whole graphic times `fieldAlpha` (0 before start, 1, then `left / 300` over the last `FIELD_FADE_MS` 300). Fixed
   ice colours for everyone (section 3, F4). It disappears when the server stops listing it (key 3 replaces the list),
   not on a client clock. Blocks are kept per `AreaKey` across snapshots (2b: `Tiles` is a fresh array each key-3 frame).
2. **The cast telegraph.** On a Wish start (`FxKind.WishStarted`, ability 0 = Frost's Wish under both Wishes,
   P-FROST-WALL-2 F7) while the Welcome says `Wall`: a line of frost across the start's anchor, square to the line from
   the caster, `Length` long (legacy `WishFx.ts` `drawWallTelegraph` with `ringRadius` = `length / 2`), thickening as the
   cast gathers (`lineStyle(3 + 9p, color, 0.15 + 0.35p)` plus a white `1 + p` core, `p` = progress), gone at the end of
   the start's `Duration`. No line when the caster is within 1 u of the anchor (legacy `if (d < 1) return true`).
3. **The aim preview** (legacy `AbilityAim.ts`): while aiming, the reach ring round the caster (`Range`), a translucent
   block per tile the wall would take (fill alpha `0.18 + 0.1 * pulse`, white outline `0.35 + 0.2 * pulse`, lift 20), the
   wall's line (width 2, alpha 0.55) and its centre dot (radius 3, alpha 0.8). The tint is the Wish colour, **red**
   `0xef5350` when it would take no tile. Pulse `0.5 + 0.5 sin(now * 0.008)`, held at 0.5 under reduced motion.
4. **The state machine** (section 3, F5) lives in an engine-free class `WishAim` (`RoguehallaNet/Net/Ui/WishAim.cs`);
   `MatchClient` only forwards its inputs (R, left click, right click, Esc, once per frame) to it. A **Quick cast**
   setting (legacy `settings.ts` `quickCast`, off by default) casts on the key with no preview.
5. **The preview's geometry is the server's**: `FrostWallAim` (`RoguehallaNet/Net/Ui/FrostWallAim.cs`) mirrors
   `rh-sim`'s `wall_segment_for` and `wall_cells` (section 3, F1-F2) and reads the Welcome's six wall numbers
   (`WireHudContent.FrostWall`). It draws only; the wall drawn after the cast is the server's.

## 2. Dependencies
P-FROST-WALL-2 (wire) and P-FROST-WALL-2b (client state) merged. This packet consumes: `AreaKind.Wall`, `AreaView.Tiles`
(`MapTile[]`), `AreaView.Key` (`AreaKey`), `StartedAt`/`EndsAt`, `Owner` (`uint?`, may be null), `Session.Welcome.Hud`
`.FrostWish` (`FrostWishKind`) and `.FrostWall` (`FrostWallNumbers?`: `Range, MinRange, Length, Ms, CellReach, EndSlack`).

## 3. Facts (established for this brief; file:line)

### F1. The segment (Rust `crates/rh-sim/src/barriers.rs:39-71` `wall_segment_for`; legacy `shared/src/barriers.ts`)
`dx, dy = cursor - from`, `d = sqrt(dx² + dy²)`; if `d` is NaN or `d < 1`: `dx, dy = cos(facing), sin(facing)`, `d = 1`.
`u = (dx, dy) / d`; `at = min(max(d, minRange), range)` (max first, then min: a `minRange > range` gives `range`);
centre `c = from + u * at`; `half = length / 2`; ends square to the aim: `(x1, y1) = (cx - uy*half, cy + ux*half)`,
`(x2, y2) = (cx + uy*half, cy - ux*half)`.
Numbers (`crates/rh-sim/src/abilities/mod.rs:272-278`): range 450, min range 64, length 224, 4000 ms, cast 250 ms,
cooldown 45 s; `barriers.rs:20-22`: `WALL_CELL_REACH = TILE * 0.75` (24), `WALL_END_SLACK = TILE / 4` (8); `TILE` 32.
The server clamps twice: at the cast with `range` (`systems/abilities/mod.rs:127-139`, the point becomes the centre),
and at the landing from the cast origin with `range + RANGE_SLACK` (32, `abilities/mod.rs:250`;
`systems/abilities/effects.rs:287-294`). The second is a no-op on an already clamped point, so the preview uses `Range`
(as legacy `aimPlan` did: `t.range`, no slack).

### F2. The tiles (Rust `barriers.rs:93-126` `wall_cells`)
Scan the tile box `floor((min(x1,x2) - reach) / 32) .. floor((max(x1,x2) + reach) / 32)` (same for y), clamped to
`[0, w-1]` / `[0, h-1]` (the map edge: nothing off-map, no negative index), row by row (y outer, x inner), so the output
is ascending row-major indices. A tile is taken when: its class is FLOOR (0) (WALL 1 and LOW 2 are skipped); its centre
`p = (tx*32 + 16, ty*32 + 16)` projects onto the line `along = (p - e1) · u` (u = unit `e2 - e1`, `(0,0)` if zero length)
within `[-endSlack, len + endSlack]`; and its distance to the segment (`dist_point_to_segment`, `barriers.rs:74-88`,
`t` clamped to `[0,1]`) is `<= reach`. "No tile" = an empty list: the server then raises nothing (`effects.rs:302-305`:
`if cells.is_empty() { return; }`; the cast still spends the Wish). Axis-aligned: one column/row of 7 tiles for 224 u;
diagonal: a closed staircase (`barriers_tests.rs` `a_diagonal_wall_is_a_closed_staircase`).

### F3. The map the preview reads
The server reads `body_map(k, held, gates_locked)` (`barriers.rs:343-353`, `effects.rs:300-302`): the arena map, gate
tiles WALL when the gates are locked (`map.rs:183-188`), every standing wall's tiles LOW. Legacy's preview read the same
(`RaidScene.ts` 78dd8bd4 `planMap`: `withGates` when `state.gatesLocked`, then `withBarriers` of every synced wall). The
mirror therefore reads `FrostWallAim.PlanMap(Welcome map, Collections.Arena.GatesLocked, Collections.Fields)`: the
Welcome `MapBlob.Tiles` classes, `MapBlob.Coliseum.Gates[*].Tiles` set to WALL (1) when locked, every delivered wall
tile set to LOW (2). Difference from legacy, flagged: legacy synced every wall to every client; the Rust wire sends a
wall only when its first end is visible (P-FROST-WALL-2 F2), so an unseen wall is not in the preview's map and the
preview may show a tile the server will not take. Display only; the server decides.

### F4. Colours and the owner
Legacy `drawWall` used fixed ice colours for every caster (no faction tint; `FieldView.ts` 78dd8bd4 `WALL_TOP`/`FRONT`/
`EDGE`), and the Rust wire carries only an owner id, redacted when unseen (P-FROST-WALL-2, 2b "Legacy doubts"). Pinned:
the same colours whoever cast it, owner null or not. The preview tint is the Wish's colour (legacy `entry.def.color`;
Unity: the Frost Wish colour the HUD already uses) or red `0xef5350` with no tile.

### F5. The aim state machine (legacy `RaidScene.ts` 78dd8bd4; line numbers in that file)
- R (`:1839` `castSlot("wish")`): **while aiming, R puts the preview away and sends nothing** (`:1597-1601`, checked
  before anything else). Otherwise, when the Wish is placed (`def.aim === "preview"`, i.e. the Welcome says `Wall`) and
  Quick cast is off, it opens the preview and sends nothing (`:1622-1628`), after the same gates a cast passes
  (`:1603`, `:1610-1621`: not frozen/planning, not before the teleport, slot ready). With Quick cast on, or for any other
  Wish, it casts at once.
- Left click while aiming (`:513-525`): puts the preview away and casts at the cursor (`castSlot(aiming, true)`); the
  click is not an attack. A cast that is then denied (stunned, cooldown) sends nothing (`:1617-1621`).
- Right click (`:512-514`): puts the preview away, sends no cast, and **still walks** (the move is sent as always).
- Esc (`:1826`): while aiming, puts the preview away and does nothing else (consumed).
- Each frame (`updateAimPreview`, `:1031-1052`): puts it away when the player is gone or dead (`!this.localAlive()`),
  the world is frozen (planning), before the teleport, the phase is not active, or the minimap peek is up. **A stun does
  not put it away** (not in the list); a click while stunned is then denied.
- The cast point of a placed Wish is the segment's centre, not the raw cursor (`:1685-1692`: `wallSegmentFor(from, aim,
  t.range, t.minRange, 0, me.facing)`, `from` = the predicted position), with no target id. Legacy did this so the
  telegraph stands where the preview did; the server re-clamps the same way (F1), so it changes nothing when the
  predicted and server positions agree.
- Unity today has no client-side Wish denial (`Session.CollectWishInput`, `Net/Session.cs:211-216`: press, UI, ground
  point, InMatch, phase 1, alive; `WishSessionTests.RealWishCollectorUsesOnlyPressUiAndLifecycleGates...`). The port keeps
  that: the preview opens when those lifecycle gates pass (InMatch, phase 1, alive, UI not owning input; no ground point
  needed, legacy opened it before reading the cursor), and the click casts through `CollectWishInput` unchanged. So a
  click while stunned or on cooldown sends a cast the server refuses (legacy denied it client-side). Flagged, not a
  rule change: the server decides either way.

Pinned machine (`WishAim`, all via `Session.CollectWishInput`):

| Input | Not aiming | Aiming |
|---|---|---|
| R, Wish `Freeze` | casts as today: raw cursor, actor ref, unchanged | (cannot be aiming) |
| R, `Wall`, Quick cast on | casts at once at the segment centre, no actor ref | puts it away, sends nothing |
| R, `Wall`, Quick cast off | opens the preview if the lifecycle gates pass; sends nothing | puts it away, sends nothing |
| Left click | not consumed (the attack path runs) | consumed; puts it away; one cast at the segment centre |
| Right click | nothing | puts it away; no cast (the caller still sends the move) |
| Esc | not consumed | consumed; puts it away |
| Frame | nothing | puts it away when not InMatch, phase != 1, no `Me`, `Me` not alive, or the Wish is not `Wall` |

### F6. The settings surface
`Assets/Scripts/UI/UiDisplayPreferences.cs` (PlayerPrefs, keys `rh.ui.*`, default + setter + `ResetDefaults`), drawn by
`Assets/Scripts/UI/ModernSettingsView.cs` (`SwitchRow`, `Refresh`). New: `QuickCast` (key `rh.ui.quickCast`, default
false), `SetQuickCast(bool)`, reset to false by `ResetDefaults`; a "Quick cast" switch under a new "Controls" heading,
note (legacy `settingsPanel.ts`): "Abilities you aim (Frost Wall) cast at the cursor the moment you press the key. Off:
the key shows where it lands and a click places it."

### F7. Presenters
Built in `ArenaView` (`Assets/Scripts/View/ArenaView.cs:137-139`, `Child("...")` roots), fed in `PresentCollections`
(`:497-506`, `_wishFx.PresentAreas(collections.Fields)`) and in `ConfirmedFx` (`:637-645`, Wish fx to `_wishes` and
`_wishFx`). Precedents: `WeaponRangePresenter` (one mesh rewritten in place, `Show`/`Hide`), `HitZonePresenter`
(pooled zones), allocation guards with `GC.GetAllocatedBytesForCurrentThread` (`ChampionPanelNoGarbageEditModeTests`,
`DressedMapEditModeTests:227-239`). Presenters have no `Dispose` today (they die with the view); this one gets one.
The Freeze windup beam (`WishFxPresenter.cs:462`) would also draw for a wall cast (ability 0): under `Wall` ArenaView
gives the wall telegraph to `FrostWallPresenter` and tells `WishFxPresenter` the Wish kind so it skips the Freeze beam
for the windup only (the cast pose cue `_actors.WishCue` and the landing burst stay: legacy wall landing = `iceBurst`).

### F8. Walk prediction and click-to-move
Legacy's planning map made standing walls LOW for its own walk and path (`planMap`). P-FROST-WALL-2 section "Next
packets" leaves `LocalMotion`/`Pathfinder` reading the Welcome map only; walls in prediction are P-FROST-WALL-PREDICT-1.
Out of scope here.

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/FrostWallAim.cs`, `client-unity/RoguehallaNet/Net/Ui/WishAim.cs` (+ synced copies)
- `client-unity/UnityProject/Assets/Scripts/Presentation/FrostWallPresenter.cs` (+ `.meta`)

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/FrostWallAim.cs`, `client-unity/RoguehallaNet/Net/Ui/WishAim.cs` and the synced
  copies (`bash client-unity/sync-net.sh`)
- `client-unity/UnityProject/Assets/Scripts/Presentation/FrostWallPresenter.cs` (standing walls, telegraph, preview)
- `Assets/Scripts/Net/MatchClient.cs`: only the Wish key path and the input forwarding to `WishAim` (R, left click
  before the attack, right click, Esc, a per-frame `Frame`), and passing the aim to `ArenaView`
- `Assets/Scripts/UI/UiDisplayPreferences.cs` (`QuickCast`), `Assets/Scripts/UI/ModernSettingsView.cs` (the switch row)
- `Assets/Scripts/View/ArenaView.cs`: only the lines that create, feed, tick and dispose the presenter, and route the
  Wish start under `Wall` (F7)
- `Assets/Scripts/Presentation/WishFxPresenter.cs`: only the Wish-kind setter and the Freeze windup beam skip (F7)
- `docs/unity/DIALS.md`: rows for the looks-only numbers (colours, lift, alphas, crack time, preview alphas)
- not `Protocol/**`, not shaders, not any existing test, not `crates/**` (the generator is an oracle file), not
  `protocol/fixtures/**` (the vector file is an oracle file)

## 6. Contracts and references
C-OBS (draw only what the server delivered), R-AUTH/D9 (the mirror decides nothing), ADR 0008 (mirrored rules are checked
with Rust vectors), C-NET.

## 7. Behaviour to preserve
- Every other Wish: one press casts, as today (`CollectWishInput` with the raw cursor and the actor under it); the Wish
  latency trace (`MatchClient.cs:423`) still marks every cast that leaves, from the key or the click.
- A client whose Welcome says `Freeze` shows no preview and draws no wall.
- No allocation per frame in the presenter once warmed (pooled blocks), like the other presenters.

## 8. Acceptance checks
- Engine-free (`dotnet test client-unity/RoguehallaNet.Tests --filter "FullyQualifiedName~FrostWallAim|FullyQualifiedName~WishAim"`):
  `FrostWallAimTests` (the Rust-asserted cases of `barriers_tests.rs` ported, plus a map edge, LOW and WALL skips, and
  the plan map) and `WishAimTests` (F5's table) green.
- Rust vectors: `cargo run -p rh-parity --bin frost-wall-aim-fixtures -- --check` and
  `cargo test -p rh-parity --test frost_wall_aim_golden` green (they are green now and stay so); `FrostWallAimVectorTests`
  green.
- EditMode (`bash client-unity/UnityProject/Tools/editmode.sh`): `FrostWallPresenterEditModeTests`,
  `QuickCastSettingEditModeTests` green.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-FROST-WALL-1` passes.
- A look check per `docs/unity/LOOK_CHECK.md` and one Web round per `docs/unity/WEB_ROUND.md` with a Frost player
  placing a wall (only after P-FROST-WALL-3 selects `Wall`, or on a server started with it).

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`; `bash client-unity/sync-net.sh --check`
- `bash client-unity/UnityProject/Tools/editmode.sh`
- `export PATH="$HOME/.cargo/bin:$PATH"; cargo run -p rh-parity --bin frost-wall-aim-fixtures -- --check;
  cargo test -p rh-parity --test frost_wall_aim_golden`

## 10. Risk and suggested model tier
Sonnet. The risk is the mirror drifting from Rust (the Rust vectors guard it, including the end-slack knife edge) and the click being both a cast and an attack (pinned: consumed).

## 11. Known traps
- Draw the wall from delivered tiles. A wall drawn from the client's own geometry would show ice where the server
  blocks nothing.
- Key blocks on `AreaKey`, not on the `Tiles` array (a new array every key-3 frame).
- `Object.Destroy` throws in EditMode: `Dispose` must use `DestroyImmediate` outside play mode.
- Tile index maths: `i % w`, `i / w` with the map's width (2b's trap); the scan is y outer, x inner, so the output is
  ascending.
- `max` before `min` in the clamp (F1); `d < 1` or NaN falls back to the facing.
- The cast point of a wall is the segment centre with no actor ref; Freeze keeps the raw cursor and the actor ref.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/FrostWallAimTests.cs`
- `client-unity/RoguehallaNet.Tests/FrostWallAimVectorTests.cs`
- `client-unity/RoguehallaNet.Tests/WishAimTests.cs`
- `client-unity/UnityProject/Assets/Tests/Editor/FrostWallPresenterEditModeTests.cs` (+ `.meta`)
- `client-unity/UnityProject/Assets/Tests/Editor/QuickCastSettingEditModeTests.cs` (+ `.meta`)
- `crates/rh-parity/src/frost_wall_goldens.rs`, `crates/rh-parity/src/bin/frost_wall_aim_fixtures.rs`,
  `crates/rh-parity/tests/frost_wall_aim_golden.rs`, and their registration lines in `crates/rh-parity/src/lib.rs`
  (`pub mod frost_wall_goldens;`) and `crates/rh-parity/Cargo.toml` (the `[[bin]]` entry)
- `protocol/fixtures/frost_wall_aim_v1.json` (generated; **the implementer never edits or regenerates it**)

Stub files (the implementer replaces them): `FrostWallAim.cs`, `WishAim.cs` (+ synced copies and `.meta`),
`FrostWallPresenter.cs` (+ `.meta`), `UiDisplayPreferences.cs` (`QuickCast` stub members).

## The Rust vectors (coordinator decision: within the protected-path rule; this packet says so)
ADR 0008's precedent for mirrored rules: Rust-produced vectors in `protocol/fixtures/`, written by a documented fixture
command (`hitbox-fixtures`, `crates/rh-parity/src/hitbox_goldens.rs`), checked by a Rust test that the committed file is
what the current core produces (`crates/rh-parity/tests/pnet2_goldens.rs`), read by C# tests. Followed exactly:
- **Generator:** `crates/rh-parity/src/frost_wall_goldens.rs` (`all()`, `write_or_check(check)`) calls
  `rh_sim::barriers::{wall_segment_for, wall_cells}` with `rh_sim::abilities::FROST_WALL_{RANGE, MIN_RANGE, LENGTH}` and
  `WALL_CELL_REACH`/`WALL_END_SLACK` (all already `pub`; no `rh-sim` change).
- **Regenerate / check:** `cargo run -p rh-parity --bin frost-wall-aim-fixtures` / `... -- --check`.
- **Rust test:** `cargo test -p rh-parity --test frost_wall_aim_golden`
  (`committed_frost_wall_aim_golden_is_the_current_core`).
- **Fixture:** `protocol/fixtures/frost_wall_aim_v1.json` (`format` `rh-frost-wall-aim/1`): `numbers`, `maps` (row-major
  classes; `gate_closed` also carries `openTiles` and `gateTiles`), and 13 `cases` (`from`, `cursor`, `facing`, Rust's
  `segment` and `cells`): `axis`, `inside_min_range`, `beyond_range` (an off-axis aim clamped to 450), `diagonal`,
  `cursor_on_caster` (facing 2 rad: the fallback), `into_rock` (no tile), `partly_low` (two LOW and one WALL tile under
  the line), `closed_gate` (gate tiles WALL in the line), `top_edge`, `right_edge` (the scan clamped to the map, no row
  wrap), `end_slack_inclusive` (a tile centre exactly 8 u past the end: taken) and `end_slack_just_out` (9 u: not taken).
- **C# test:** `FrostWallAimVectorTests`: per case, the mirror's segment to 1e-3 and exactly Rust's tiles (both from
  Rust's segment and from the mirror's); and `PlanMap` of the open gate map with the gates locked equals Rust's closed map.
- **Gate:** the coordinator runs this packet's gate with `--regen-fixtures` (a new file under `protocol/fixtures/`).
- A throw-away reference `FrostWallAim` (not committed) passed every vector case, the plan-map case and every hand-ported
  case in `FrostWallAimTests`: no hand-ported test needed changing.

## Baseline on `b40c72330` plus this packet's stub
Known red below this packet (not this packet's): `FrostWallProtocolTests` (7), `FrostWallStateTests` (17), and the Rust
`frost_wall_observe`, `frost_wall_wire`, `frost_wall_delivery`, `frost_wall_welcome`.

This packet's red tests, on the stub:
- C# (`dotnet test`, before the vector test: 2075 tests, 40 red = the 24 above + 16): `FrostWallAimTests` 9 of 10 (`AWallAimedIntoRockTakesNoTile`
  passes on the empty stub by construction) and `WishAimTests` 7 of 8 (`UnderFreezeTheKeyCastsAtOnceAsToday...` is today's
  behaviour and passes on the stub). `FrostWallAimVectorTests` adds 15 tests, 14 red (13 cases and the plan map; the
  file-format test passes).
- Rust: `frost_wall_aim_golden` is green (the fixture is what rh-sim produces).
- EditMode (1533 tests, 10 red): `FrostWallPresenterEditModeTests` 9 of 10 (`NothingIsDrawnThatTheStateDoesNotList...`
  passes on the stub by construction; the allocation guard's GC half passes, its block count fails) and
  `QuickCastSettingEditModeTests` 1 of 1.
- The two engine-free files were checked green against a throw-away reference implementation of `FrostWallAim` and
  `WishAim` (not committed), so their expectations are consistent with the Rust rule and F5.

## Notes from previous attempts
<!-- Coordinator appends on escalation. -->
