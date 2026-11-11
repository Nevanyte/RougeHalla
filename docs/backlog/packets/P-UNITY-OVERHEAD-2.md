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
Verified by the oracle author (lines are in `StatusArt.ts` unless noted). One `Graphics` holds every status; it is added to the view's
container after body, weapon, hp bar, label and elite star (`PlayerView.ts:194`, `MobView.ts:120`), so **every status is drawn in front of
the body**, and a status has no behind-body layer. Origin is the feet (0,0), screen y down; the body centre is `CY = -BODY_LIFT` = 14 px up
(`:18`, `projection.ts:6`), `R = PLAYER_RADIUS` = 12 (`:16`, `constants.ts:62`), ground shapes squash by `Y_SCALE` .8 (`constants.ts:617`).
`StatusArt` uses `R` for every actor: **anchors are fixed pixels, they do not scale with the archetype or mob body**. The only per-actor
input is `barHalfW`: 14 for players (`PlayerView.ts:154`), 18 for every mob, elite and dummy (`MobView.ts:19,96`).
`MobView.ts:164` and `PlayerView.ts:280` feed the same effects bits, so mobs show all twelve. A hidden fighter is not drawn at all (remote)
or drawn faint (local), `PlayerView.ts:245-251` / header comment `:1-3`; `EFFECT_HIDDEN` has no layer.

| Status (bit) | Lines | Anchor, y up from feet (X centre, Y bottom edge, W x H envelope, stroke ignored) | Art |
|---|---|---|---|
| Root (2) | `:139-147` | 0, -13.6, 34 x 13.6 | front half of an iron ring r = R+5 = 17 squashed .8, two links |
| Zoned (512) | `:170-185` | 0, -17.6, 44 x 35.2 | 14 chain links on r = R+10 = 22; back-half links hidden unless they clear the body (`:92-94`) |
| Casting (4096) | `:187-191` | 0, -5, 38 x 38 | warm glow R+5, ring R+7 |
| Last Stand (1024) | `:193-199` | 0, -4, 36 x 36 | gold rim R+2.5, outer R+6 |
| Untargetable (128) | `:201-210` | 0, -1.5, 31 x 31 | dashed ring R+3.5 |
| Haste (2048) | `:212-222` | 0, 8, 66 x 12 | streaks off both flanks, out to 33 px each side |
| Slow (8) | `:224-232` | -23, -1, 18 x 22 | pale-blue streaks off the left (trailing) side, drooping |
| DoT (64) | `:234-244` | 0, 7, 25.6 x 22.95 | four flames rising off the body |
| Stun (1) | `:255-266` | 0, 29.5, 33 x 15 | three stars circling `HEAD_Y` = 37 up (`:20`), orbit 13 x 4 |
| Silence (4) | `:268-276` | 21, 19.2, 11.6 x 11.6 | face with crossed mouth, at the head's right (x = R+9, 25 up) |
| Attack-slow (16) | `:278-288` | -21, 19.2, 11.6 x 11.6 | clock face at the head's left |
| Anti-heal (32) | `:290-296` | -(barHalfW+9) = -23 player / -27 mob, 33, 10 x 10 | cracked red cross beside the hp bar's left end, 38 up |

Several active: `statusLayers`/`update` draw in `LAYERS` order (`:36-49`): root, zoned, casting, last stand, untargetable, haste, slow, dot,
stun, silence, attack-slow, anti-heal; later paints over earlier. Casting, Last Stand and Untargetable are concentric on the body and just
overlap; nothing is offset sideways. Stun's orbit box (to x 16.5, y 29.5-31) can touch Silence's face (x 15.2+, y up to 31): legacy allows it,
so the oracle does not assert non-overlap (the acceptance line below is narrowed accordingly). Motion (stars circle, streaks drift, clock hand)
is animation on a local clock and is not pinned; the envelopes are the extremes of that motion. Reduced motion freezes it, keeps the pictures.

Wire facts: all twelve bits are in the delivered `Effects` word (`Indicators.cs:36-50`, `StatusOrder`/`DrawnMask`); no legacy status is
missing a fact, so **nothing is out of scope**. Out of scope by choice: `EFFECT_HIDDEN` (handled by `Indicators.HiddenAlpha`) and the spare
bits 8192/16384 (no legacy art). Existing Unity glyph art (`OverheadIndicators.GlyphKeys`: shackle, chain, cast, faststand, dashring, haste, slow,
flame, stun, silence, clock, antiheal; `IndicatorArt.Get`) is badge-sized sprites, not these shapes: the implementer reuses what fits and
draws the rest procedurally; the rooted/zoned rings already exist (`_root`, `_zone`) and keep their look.

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
- `scripts/gate.sh --quick --oracle packet/P-UNITY-OVERHEAD-2` passes; the Unity EditMode suite passes.
- Unit tests on the pure function (oracle): each status kind maps to its legacy anchor and layer (front of body); anti-heal follows the
  bar half-width, everything else is identical across actor kinds; an unknown status or hidden bit gives nothing; statuses sharing an
  anchor come out in legacy order; no badge-row shape is produced. (Non-overlap of different anchors is not asserted: legacy lets
  Stun's orbit touch Silence.)
- EditMode tests that pin the badge row and must be updated by the implementer (the only test edits allowed, as they are in write scope):
  `OverheadIndicatorsEditModeTests.cs:42-47` (`StatusGlyphsFollowTheEffectBitsAndIgnoreHiddenAndUnknown`: objects "Status stun",
  "Status flame", "Status silence", "Rooted ring"); `UiLabEditModeTests.cs:155-160` (`Status_bits_and_bounty_cells_draw_their_glyphs`:
  "Status stun"); `UiLabFixesEditModeTests.cs:35-40` (`The_bubble_sits_on_the_body_and_clear_of_the_status_row`: asserts the barrier bubble
  is below "Status stun", which now sits at the head, so redo it against the new anchor); `ActorOutlineEditModeTests.cs:192` (object name
  "Status plate flame" in a list of plated objects: the plate goes). `LegacyFactsEditModeTests.cs` only builds actors with `Effects` and
  needs no change unless an object name it finds is renamed.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/StatusAnchorsTests.cs` (new; fails on assertions against the stub)
- The stub `client-unity/RoguehallaNet/Net/Ui/StatusAnchors.cs` (+ synced Unity copy and `.meta`) is the signature the implementer fills in;
  `TryGet(StatusKind, OverheadActorKind, out StatusAnchor)` and `Build(ushort effects, OverheadActorKind, List<StatusAnchor>)`. The
  implementer may add members but not change these.

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
