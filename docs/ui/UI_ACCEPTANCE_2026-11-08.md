# Finite UI acceptance review — 2026-11-08

## Frozen scope

- UI leaf: `f8753b867840bda927e3b63d9ace05325e9bde8e`, based on `96a3462eb6f774891e80c6b2e6dde2700eb8fed6`.
- Inventory: the 54 stable IDs from `177f19fa:docs/ui/BEHAVIOR_CHECKLIST.md`.
- Queued hub continuation: `177f19fa` (including owner-operation predicate adoption `2ad7d877` after released API `f722962d`). Its full profile/shop/progression screens are separate from this native candidate.
- Current corrected native source: `cf23833ff99b2472b217d43e26c5e5167391d2b9`; evidence under `~/.codex/tools/rougehalla-unity-art/combined-cf2383-2026-11-08/evidence`. Failed predecessor `d28df076bf98d10bfe6cb5fbc88b8d30a3fbe712` and all 14 captures remain preserved.
- Separate F-02 repair proposal: `396681192f94796de7e605b8108aa89ee11fd7fd`, three UI files only; native correction checks below pass at cf2383.
- This report is a bounded review, not a migration checkpoint or complete-game acceptance. No server, main, lock, Editor, or source feature changes were made for this review.

Statuses: **PASS** means the explicitly named check has evidence at its stated level/revision; **FAIL** identifies a reproducible defect; **HELD** means required integration/publication is absent; **NOTRUN** means no exact-revision acceptance execution. Source compilation is never native/browser proof. Historical results do not transfer automatically.

## Evidence and current gates

| Check | Status | Evidence / limit |
| --- | --- | --- |
| Managed runtime compilation | PASS (source f875) | `/tmp/roguehalla-ui-glass-compile/Client.csproj`: zero warnings/errors. |
| Managed Editor-test compilation | PASS (source f875) | Matching Tests.csproj: zero errors, one existing unused-event warning. New tests are compiled, not engine-run. |
| Corner-panel separation | PASS (source geometry f875) | `/tmp/roguehalla-ui-glass-compile/geometry.json`: 720p/1080p/1440p/3440-wide × minimap .85/1/1.25; no health/stats/action/reward/notice/mini rectangle intersections. No glyph measurement follows. |
| Foreground/background separation | PASS (source f875) | UI backing Image alpha and navy floor pixels only; shared world palette, text/icons, wall/low/contacts stay independent. No CanvasGroup fade. Corrected native foreground text/icon alpha is 1.0 in all four captures; actual panel centers show through and no Outline/Shadow mesh effects remain. Readability is visually acceptable in these scenes; arbitrary bright backgrounds/CVD/quantified contrast remain NOTRUN. |
| Native affected tests | PASS (cf2383) | UiInputRouting 9/9, TacticalMap 8/8, owner Wish/barrier/stats 2/2; total 19/19. Includes modal B/H negative and positive controls, actual renderer mesh, minimap restoration and HUD focus return. No whole campaign repeated. |
| Four scoped native captures | PASS (cf2383) | 1440p HUD100, 720p HUD150/mini125, 1440p map150, 720p planning150. All exact-source, ready, advancing frames/source time, matching PNG/Screen/Canvas, visible offline label, zero TMP overflow/truncation. World floor/actors visibly show through blue panel centers; glyphs and text stay opaque. This is not the full accessibility/player-flow matrix. |
| Historical native baseline | PASS (96 only) | `combined-96a346-2026-11-08/evidence`: 85/85 tests and 12 advancing native 720p/1440p HUD/planning/map previews at 100/150%; zero text-overflow flags. Offline synthetic data, not network/browser/performance acceptance. |
| Account operation ownership | PASS (queued source only) | Registered-operation query, same-token reopen, same-name token replacement filtering, preserved Unknown UUID/history, invalid retry returning before transport; view tests compile. No current native/full HTTP player flow. |
| Modal B/H ownership | PASS (cf2383 focused gate) | F-01 keyboard regression and positive Build/Help controls pass. Broader mouse/modal/focus combinations remain NOTRUN. Standalone Hub Guide Escape is handled by its own Update. |
| Full browser / CVD / performance proof | NOTRUN | No exact full-game browser/reload/reconnect/training flow, complete accessibility matrix, or matched M5 Pro workload measurements. |

## Reproducible findings

### F-01 — B/H can stack a modal over settings

Applies to UI-036, UI-049 and UI-051. Source: `MatchHud.Features.cs`, `ReadUiInput`, `ToggleBuild`, `ToggleHelp` at the frozen leaf.

1. Join an active session and open Settings. Leave text entry unfocused (ordinary settings controls qualify).
2. Press unmodified B or H.
3. `dialog` is already true, but the B/H branches still run. Build or Help becomes active without closing Settings. Focus-root precedence can then target a different active overlay than the top visible panel.

Expected: the active modal owns these keys, or a deliberate switch closes the prior modal first. This is pre-existing in the 96 parent and is source-reproduced, not a claimed native result. No fix is included in the frozen glass leaf. Coordinator owns any separate repair.

Correction retained: HubGuideView has `HandleEscape()` and its own `Update()` polling Escape; missing a guide branch in MatchHud alone is not proof of failure.

### F-02 — Outline quads defeat the requested glass backgrounds

Native reproducible at `d28df0`: inspect `layouts/1440-hud-text100.png` and `1440-hud-text150.png`. Health/stats/reward/action backgrounds are solid brown rather than transparent navy; world floor edges do not show through their centers. Text/icons retain full alpha and the minimap floor is correctly translucent.

Cause: UGUI Outline draws four complete offset copies of the background quad below the now-translucent Image. The nearly opaque gold copies produce an opaque undercoat; Image.color alpha metadata alone is insufficient proof. The same effect applies to outlined button plates. A separate source repair `39668119` replaces those effects with four edge-only, non-raycastable strokes and preserves card backing alpha during selection refresh. Its runtime/test compilation passes; do not certify the repair visually before recapture.

### F-03 — Active map contacts/routes lack a CanvasRenderer

The coordinator/Art inspection of all 14 d28 captures confirms that TacticalMapMarks has current data but no CanvasRenderer, so its markers do not draw. Passing ContactCount assertions was insufficient rendering proof. Separate repair `7d2e266cbb0392bc7157488c72f358cbc060caf0` declares the required renderer and adds an actual-controller/delivered-contact test that forces canvas update and checks nonempty renderer mesh vertices. Managed compilation passes; native geometry and visible contacts/routes remain HELD pending the corrected revision.

The separate F-01 keyboard repair is `64459e2790341dd27804b05a702d9761c549449b`, followed by test-only settings-path correction `f2292d4a5882406c44a193751a91cd37a9fe2535`. It preserves positive Build/Help open-close/switch controls while refusing B/H under unrelated modal ownership. Native input proof remains pending. These repairs do not change the frozen f875/d28 evidence.

## Corrected native observations (cf2383)

- `layouts/1440-hud-text100.png`: stats/build at top-left, HP/barrier at bottom-left; minimap default outer footprint exactly doubles width/height from 96. Blue panel centers reveal world tiles and actors, without the opaque brown undercoat.
- `layouts/720-hud-text150-mini125.png`: largest saved map scale stays right/bottom; Rewards starts at y347.76 versus minimap top336.96 (10.8px gap). Health, stats and action controls remain separated and text fits.
- `layouts/1440-map-text150.png` and `layouts/720-planning-text150.png`: regular combat HUD/rewards/minimap underlay is inactive; world remains visible; permitted contact glyphs and self marker render with shape/color distinctions. Route content is empty in these fixtures, so a nonempty edited route remains a separate interaction case.
- Active map marks have CanvasRenderer and populated mesh: seven observed contacts, 106 vertices/156 indices in these captures. Inactive map meshes may be empty, as expected.
- All visible text/icon foreground colors have alpha1; floor texture includes alpha200 navy and alpha255 walls/low obstacles. Actors retain root XY1.2/Z1, matched delivered anchors, and camera orthographic size9.
- Native screenshots use offline synthetic stress data. No network/server action, cloud, browser, full player flow, FPS or performance proof follows.

F-01, F-02 and F-03 are resolved for this focused native gate. Their predecessor evidence above remains historical. Full inventory acceptance stays bounded by the matrix below.

## Inventory acceptance matrix

Each row covers the complete original inventory requirement; partial implemented source is stated in the boundary, not promoted to a complete PASS.

| ID | Surface | Status | Evidence / remaining boundary |
| --- | --- | --- | --- |
| UI-001 | Startup | NOTRUN | Basic loading/errors present; browser startup not exercised. |
| UI-002 | Callsign claim/load, canonical identity, existing-owner sign-in, access code | NOTRUN | Basic claim/load/current-owner join gate in source; no exact browser flow. |
| UI-003 | Saved credentials, blocked-storage feedback, explicit recovery-key reveal and manual copy | NOTRUN | Storage/password input in current source; explicit key-recovery view is queued. |
| UI-004 | Hub identity/title, current/lifetime/monthly GV, run/win/draw/death/kill counters | NOTRUN | Summary counters only here; full progression source is queued. |
| UI-005 | Hub walkable avatar, WASD/arrows/RMB, station activation, direct menu access | NOTRUN | Cosmetic hub movement/directory source; exact-revision player interaction not exercised. |
| UI-006 | Faction choice and Champions guide | NOTRUN | Five-faction guide/selection source; no client combat evaluation. |
| UI-007 | Weapon guide | NOTRUN | Weapon guide source; no client reach/damage rules. |
| UI-008 | Current weapon counter wheel, direction/advantage/threat labels, fists exclusion | NOTRUN | Existing weapon wheel source; no class/faction wheel. |
| UI-009 | Shop catalog, slot/category navigation, price, owned/available/unavailable states | HELD | Queued full-profile/cosmetics hub UI, not this candidate. |
| UI-010 | Purchase action, busy/confirmed/refused/unknown, insufficient GV, retry | HELD | Queued authoritative purchase UI; current candidate omits it. |
| UI-011 | Wardrobe | HELD | Queued wardrobe/equipment UI; current candidate omits it. |
| UI-012 | Cosmetic preview and live in-run appearance | HELD | Queued preview UI; live cosmetic publication remains held. |
| UI-013 | Titles | HELD | Queued titles UI. |
| UI-014 | Achievements | HELD | Queued achievements UI. |
| UI-015 | Monthly leaderboard | HELD | Queued monthly leaderboard UI. |
| UI-016 | Run/Training entry, region list, measured region ping, public matchmaking placement | HELD | No admitted public placement/region/training entry UI. |
| UI-017 | Queue lifecycle | HELD | No admitted queue/capacity/human-bot roster UI. |
| UI-018 | Lobby map preview, public roster and waiting/countdown | NOTRUN | Collision map/phase preview only; full roster/placement remains incomplete. |
| UI-019 | Planning map/legend, camps/elites, zone/gate/objective context | NOTRUN | Collision layer only; rich authored terrain/camp/objective presentation held. |
| UI-020 | Two private spawn offers | NOTRUN | Owned two-spawn/contested/pending/refusal source exists; actual server race/reconnect not run. |
| UI-021 | Planning boon offers/selection and explanatory text | NOTRUN | Only delivered boon strings/choices shown; no fabricated effects. |
| UI-022 | Planning quest offers, acceptance and roster/build information | HELD | Quest/roster UI contract absent from this P13 candidate. |
| UI-023 | Ready/unready, authoritative readiness, deadline/countdown, pending timeout | NOTRUN | Ready/deadline/pending source exists; actual server timeout/race not run. |
| UI-024 | Routes | NOTRUN | Original-source route capture exists; exact browser-session persistence not rerun. |
| UI-025 | Route path, walking estimate, unreachable feedback, map/minimap/ground route cues | HELD | Private map route exists; full ground route and rich objective cues incomplete. |
| UI-026 | Route keyboard marker traversal, camp/objective stops and source-matched reach behavior | HELD | Rich camp/objective geometry and traversal incomplete. |
| UI-027 | Tactical map | NOTRUN | Historical 96 input proof only; affected exact-revision test pending. |
| UI-028 | Tactical terrain/gates, visibility/memory, permitted contacts | HELD | cf2383 permitted contacts visibly render and current-data tests pass;  Current contacts/collision tiles exist; full gates/visibility-memory parity unavailable. |
| UI-029 | Tactical camps/chests/timers/objectives and route controls | HELD | Delivered chests/private routes only; full spatial camp/objective facts unavailable. |
| UI-030 | Tactical right rail | HELD | Observed contacts/weapon guide only; full roster/quests/build inspection unavailable. |
| UI-031 | Minimap RMB move, independent LMB camera peek, drag throttle/final release, lost focus/capture cleanup | NOTRUN | New suppression/restoration test compiled; native gestures not yet repeated. |
| UI-032 | Combat vitals | NOTRUN | cf2383 scoped placement, stats clearing and foreground/glass checks pass; the complete original row, including all bounty/faction detail, is not certified. |
| UI-033 | Combat phase/alive/timer and faction-specific meters | HELD | Phase/timer exists; full alive roster/faction meters unavailable. |
| UI-034 | Weapon slots/active state, Q/1/2, Wish R, potion E and inventories | NOTRUN | Ordinary weapon/Wish/potion commands retained; exact visible controls pending. |
| UI-035 | Interaction F, pickup eligibility, contextual prompts and notices | HELD | F pickup/notices exist; quest/trader contextual actions unavailable. |
| UI-036 | Persistent grouped build/stat stacks and full Build drawer via button/B | NOTRUN | cf2383 B ownership/open-close/switch passes; complete drawer visual/scroll/large inventory matrix not rerun. |
| UI-037 | Gained numeric stats, damage types, mob bonuses, faction meters and explanations | HELD | Stacks/catalog only; derived numeric gains and further authoritative meters unavailable. |
| UI-038 | Opponent hover/target inspection, public build details and immediate hidden-contact removal | HELD | No published rich opponent inspection/build view. |
| UI-039 | Chest choice cards, titles/tags/descriptions, pending/taken/skip/deadline/refusal states | NOTRUN | Delivered chest choices/focus source retained; exact context/race proof pending. |
| UI-040 | Pickups/traders | HELD | Pickup works in source; trade offer/cost/acceptance UI unavailable. |
| UI-041 | Quest dialog | HELD | Quest dialog is omitted; current P13 candidate lacks typed UI views. |
| UI-042 | Quest log J, tracking, progress/rewards/deadlines, navigation | HELD | Quest log/tracking is omitted. |
| UI-043 | Quest completion/failure and navigation notices | HELD | Quest completion/failure UI omitted; no local inference. |
| UI-044 | World identity | HELD | Actor health/status/insignia exists; full name publication absent. |
| UI-045 | Targeting/reach, telegraphs, damage numbers, terrain/buff/camp markers and edge threats | HELD | Existing supplied cues; complete original world-cue coverage not established. |
| UI-046 | Results | NOTRUN | Delivered results/refresh only; banking receipt is not inferred and full flow not run. |
| UI-047 | Recovery | NOTRUN | Reconnect/error paths source present; actual interrupted browser/reload/close not proven. |
| UI-048 | Training entry/exit/status, stat/card/mob selectors, camps/chests, clear/reset | HELD | Training admission/console omitted. |
| UI-049 | Shared help/controls/glossary, contextual explanatory copy | NOTRUN | cf2383 H ownership/open-close/switch passes; complete help/glossary visual/focus matrix not rerun. |
| UI-050 | Settings | NOTRUN | Saved preferences source retained; large minimap endpoints and foreground alpha pending. |
| UI-051 | Shared keyboard focus, readable scroll panes, tooltips/toasts and modal close/blur | NOTRUN | cf2383 targeted keyboard/blur/map/settings focus cases pass; complete mouse/modal/toast/scroll matrix is not run. |
| UI-052 | Responsiveness | NOTRUN | No matched workload/frame-time/allocation/loading measurements. |
| UI-053 | Layout/accessibility | NOTRUN | Four corrected cases pass; full resolution, ultrawide, grayscale/CVD and reduced-motion matrix remains NOTRUN. |
| UI-054 | Functional browser proof | HELD | Full player flow depends on unintegrated/held screens; no current Web proof. |

## Native review completion rules

Only update the exact native rows after receiving the composed source SHA and matching ready/advancing/backbuffer receipts. Check default and 150% text, actual background/foreground alpha, corners and all saved minimap sizes, selected/disabled states, map/planning underlay suppression, previous-focus return, held-key/blur/pointer cancellation, and current-data removal. Preserve failed images and exact repro steps. A new fix belongs in a separate leaf; this report adds no layout direction or features.

Richer account/progression UI, quest/trade/training/placement and final player-flow proof remain distinct lanes. A working pickup is not a trader; a training flag is not admission; a configured URL is not matchmaking; a result is not a bank receipt. No unavailable action is certified here.
