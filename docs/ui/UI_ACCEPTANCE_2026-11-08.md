# Finite UI acceptance review — 2026-11-08

## Frozen scope

- Original glass/minimap UI leaf: `f8753b867840bda927e3b63d9ace05325e9bde8e`, based on `96a3462eb6f774891e80c6b2e6dde2700eb8fed6`.
- Inventory: the 54 stable IDs from `177f19fa:docs/ui/BEHAVIOR_CHECKLIST.md`.
- Earlier hub continuation: `177f19fa` (including owner-operation predicate adoption `2ad7d877` after released API `f722962d`) was separate from the cf2383/f5f5e0 candidates. The later combined candidate integrates Hub `28b9530a`; full profile/shop/progression player-flow acceptance does not follow from its source integration.
- Corrected glass/map native baseline: `cf23833ff99b2472b217d43e26c5e5167391d2b9`; evidence under `~/.codex/tools/rougehalla-unity-art/combined-cf2383-2026-11-08/evidence`. Failed predecessor `d28df076bf98d10bfe6cb5fbc88b8d30a3fbe712` and all 14 captures remain preserved.
- Icon-colour leaf: `18efb1bdbe47b8ee1397eb1aded3d63dfb6c3c1a`, composed and released as `f5f5e016555755fb3e11b77026234148c107ca6b`. Focused evidence is under `~/.codex/tools/rougehalla-unity-art/combined-f5f5e0-2026-11-08/evidence`. This gate stopped on the Build drawer failure F-04; it is not an overall PASS.
- Latest combined native test candidate: `6cdf893c67f55b70eb832c49ca01e72a7f7839f6`, including drawer correction `9b2d1738` and Hub `28b9530a`. Evidence under `~/.codex/tools/rougehalla-unity-art/combined-6cdf89-2026-11-08/evidence` records 25/34 tests passing and nine failures. It stopped before Play, all three planned captures and imports; no corrected drawer raster is accepted.
- Sealed combined receipt: `550e3305df8610062717a4e0061b62827e78baeb:docs/evidence/unity-combined-6cdf89/editor-test-gate/README.md`. Its 1,122-file pre/post Unity manifests show no changes during tests; the known ShaderGraphSettings whitespace overlay is retained/restored. The five drawer-correction file hashes independently match exact 6cdf89. This identity proof does not mitigate the failures.
- Retained F-02 repair: `396681192f94796de7e605b8108aa89ee11fd7fd`, three UI files only; native correction checks below pass at cf2383.
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
| Icon source identity / compilation | PASS (f5f5e0 scoped) | `as-tested-source.json` names exact f5f5e0; its four icon-leaf file hashes independently match that Git source. Native `compile.json` reports no compilation failure/errors. Managed leaf runtime/test compilation also passed; it is separate from rendered proof. |
| Icon owner-HUD native tests | PASS (f5f5e0, 3/3) | `tests-MatchHudWishBarrierEditModeTests.json`: the two owner-facts/vitals cases plus weapon tint/slot-change/replacement/missing-inventory regression pass. Initial incomplete two-test discovery is preserved as `tests-initial-incomplete-discovery.json` and excluded from acceptance; refreshed loaded methods include the new case. The test checks marker visibility, not its rendered gold colour. |
| Icon HUD capture | PASS (f5f5e0 scoped) | `layouts/1440-hud-text100.png` and matching JSON: 2560×1440, ready, advancing frames/source time, exact source, matching native dimensions, offline label, zero TMP overflow/truncation. Eleven active glyph Images have nine distinct tints; Image and renderer alpha are 1.0. The active weapon has a visible gold underline; panel backing alpha remains 200/255. |
| Icon Build drawer capture | FAIL (f5f5e0, F-04) | `layouts/1440-drawer-text100.png`: a solid bright-cyan rectangle obscures the card catalogue. Matching JSON is ready, advancing, exact-source and dimension-correct with zero TMP overflow/truncation; those checks do not establish visible content. Coloured summary glyphs render, but the catalogue does not. |
| Planned small-window icon capture | NOTRUN (f5f5e0) | 720p HUD150/mini125 was halted after F-04. The older cf2383 small-window result remains evidence only for that earlier revision. |
| Combined native compilation / test identity | PASS (6cdf89 scoped) | Native compilation succeeds. Seven imported test classes match the released source, GUIDs and 34 expected method names; `identity-verification.json` and `test-verification.json` retain the checks. No source-proof or executed-test count was reduced. |
| Combined native test gate | FAIL (6cdf89, 25/34 pass) | Nine failures across five groups are recorded below. Owner-HUD 3/3 and HubProgress 3/3 pass. Native test results do not certify a rendered catalogue, ordinary network join or HTTP player flow. |
| Combined native captures | NOTRUN (6cdf89) | Test failure stopped the gate before Play or any planned 1440p HUD, 1440p drawer, or 720p HUD150/mini125 capture. F-04 remains visually unresolved; no prior capture transfers to this candidate. |
| Historical native baseline | PASS (96 only) | `combined-96a346-2026-11-08/evidence`: 85/85 tests and 12 advancing native 720p/1440p HUD/planning/map previews at 100/150%; zero text-overflow flags. Offline synthetic data, not network/browser/performance acceptance. |
| Account operation ownership | PASS (source-only subcase) | Registered-operation query, same-token reopen, same-name token replacement filtering, preserved Unknown UUID/history, invalid retry returning before transport. This source-level result does not override the five 6cdf89 native cosmetic-view failures or certify a full HTTP player flow. |
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

Cause: UGUI Outline draws four complete offset copies of the background quad below the now-translucent Image. The nearly opaque gold copies produce an opaque undercoat; Image.color alpha metadata alone is insufficient proof. The same effect applies to outlined button plates. Separate repair `39668119` replaces those effects with four edge-only, non-raycastable strokes and preserves card backing alpha during selection refresh. The four corrected cf2383 captures verify the glass repair for their named cases; arbitrary bright backgrounds and CVD remain NOTRUN.

### F-03 — Active map contacts/routes lack a CanvasRenderer

The coordinator/Art inspection of all 14 d28 captures confirms that TacticalMapMarks has current data but no CanvasRenderer, so its markers do not draw. Passing ContactCount assertions was insufficient rendering proof. Separate repair `7d2e266cbb0392bc7157488c72f358cbc060caf0` declares the required renderer and adds an actual-controller/delivered-contact test that forces canvas update and checks nonempty renderer mesh vertices. The corrected cf2383 native test and active-map captures pass with visible contacts and populated mesh geometry. Captured route content is empty; nonempty edited-route rendering remains NOTRUN.

The separate F-01 keyboard repair is `64459e2790341dd27804b05a702d9761c549449b`, followed by test-only settings-path correction `f2292d4a5882406c44a193751a91cd37a9fe2535`. It preserves positive Build/Help open-close/switch controls while refusing B/H under unrelated modal ownership. The named cf2383 native keyboard/focus cases pass; broader modal/input combinations remain NOTRUN. These repairs do not change the frozen f875/d28 evidence.

### F-04 — Build drawer catalogue is obscured by a cyan rectangle

Applies to UI-036. Observed at released source `f5f5e016555755fb3e11b77026234148c107ca6b` in `layouts/1440-drawer-text100.png` and its JSON.

1. Stage the offline stress HUD with 80 owned card stacks at 2560×1440 and 100% text.
2. Invoke the existing Build Details button to open the actual drawer.
3. The owner summary and coloured stat glyphs appear, but a solid bright-cyan rectangle covers the card catalogue viewport. No cards are visibly usable in the capture.

Expected: the card grid is visible and selectable within its viewport. The capture is ready, advancing, source/dimension-matched and has zero text-overflow flags, so those metadata checks alone cannot certify the drawer. The viewport Image reports white RGBA1 while the PNG is cyan; the cause is unassigned. This observation does not establish whether the defect predates the icon leaf. Preserve the failed PNG/JSON. The focused gate was halted; the planned 720p icon capture and conditional art imports were not accepted. No repair or additional capture is included in this report-only review.

The same failed capture also shows global Help/Settings/Leave controls behind the drawer header. Its card bounds place Card00/01 offscreen at y6851–7144, while Card40–45 geometrically intersect viewport y371–1018. Intersection is not proof of pixels beneath the cyan. Separate source correction `9b2d17389a4ef83c32fb7356351b0c8654db879e` gives the top-anchored fitted content a top pivot and hides/restores only those three header buttons while the drawer owns the modal. New regressions compile for natural initial visibility, mesh generation, clipped raycast rejection, wheel/click selection, persistence, and B/Escape/Close/header callbacks. These source corrections do not assign or repair the cyan cause; no stencil/material/shader change was made. Native acceptance requires the separately released combined source's actual results.

Sealed no-image diagnosis `595a40c7605f8174a3e0403b169c1e469739f812`, `docs/evidence/unity-combined-f5f5e0/no-image-renderer-diagnosis/README.md`, leaves F-04 unresolved. Its sole replay stalled at frame2 with renderer depths −1 and produced no image. A direct snapshot after Canvas update found compiled UI/Default mask/pop/card passes and expected stencil/color-write state, but sampled Card00/01 were offscreen and no rendered frame accompanied the data. This cannot establish cyan absence or the earlier draw's shader readiness. URP's cyan loading-fallback fragment is only a resemblance lead; its reviewed GPU Resident Drawer path is disabled in this project. The pending watcher was cancelled and source/globals restored. No force compilation, mask replacement or accepted replacement raster follows.

## Corrected native observations (cf2383)

- `layouts/1440-hud-text100.png`: stats/build at top-left, HP/barrier at bottom-left; minimap default outer footprint exactly doubles width/height from 96. Blue panel centers reveal world tiles and actors, without the opaque brown undercoat.
- `layouts/720-hud-text150-mini125.png`: largest saved map scale stays right/bottom; Rewards starts at y347.76 versus minimap top336.96 (10.8px gap). Health, stats and action controls remain separated and text fits.
- `layouts/1440-map-text150.png` and `layouts/720-planning-text150.png`: regular combat HUD/rewards/minimap underlay is inactive; world remains visible; permitted contact glyphs and self marker render with shape/color distinctions. Route content is empty in these fixtures, so a nonempty edited route remains a separate interaction case.
- Active map marks have CanvasRenderer and populated mesh: seven observed contacts, 106 vertices/156 indices in these captures. Inactive map meshes may be empty, as expected.
- All visible text/icon foreground colors have alpha1; floor texture includes alpha200 navy and alpha255 walls/low obstacles. Actors retain root XY1.2/Z1, matched delivered anchors, and camera orthographic size9.
- Native screenshots use offline synthetic stress data. No network/server action, cloud, browser, full player flow, FPS or performance proof follows.

F-01, F-02 and F-03 are resolved for this focused native gate. Their predecessor evidence above remains historical. Full inventory acceptance stays bounded by the matrix below.

## Focused icon observations (f5f5e0)

- The HUD shows distinct opaque colours for the eight build roles, both weapon types and potion. The HUD and drawer summary use matching stat-role colours. Native slot-change unit coverage retains weapon hue while changing the independent active marker; the HUD PNG separately shows its gold appearance.
- Stats remain top-left, health/barrier bottom-left, and the enlarged minimap bottom-right. Captured panel backing alpha remains 200/255, glyph alpha remains 1.0, and actor roots retain XY1.2/Z1 with delivered anchors.
- The HUD colour subcase passes at 1440p/default text. The drawer catalogue fails F-04 despite correct-looking summary colours and successful metadata checks. No full drawer acceptance, f5f5e0 150%/720p acceptance, browser/player flow, CVD or performance result follows.

## Combined native findings (6cdf89)

All seven loaded classes matched exact source/GUID identities and the 34 expected method names. Native compilation passes, but the gate is **FAIL: 25 passed, nine failed, zero skipped/inconclusive**. The runner JSONs and `test-verification.json` are under the combined evidence directory named above. No Play session, capture or import followed this failure; no new raster replaces F-04.

| Native group | Passed / total | Exact result and boundary |
| --- | --- | --- |
| BuildDrawerEditModeTests | 4 / 5 | New drawer test passes natural Card00 visibility bounds and nonempty card/glyph mesh checks, then fails the visible GraphicRaycaster hit. Clipped-hit, wheel, selection and persistence assertions later in that test are not reached. It does not log the fixture's rendered depth/cull/display/camera, so no production raycast cause is assigned. |
| UiInputRoutingEditModeTests | 9 / 10 | New header test opens with B, verifies three headers hidden and no decoded world command, then the test helper throws `No injected-key precondition configured for Escape`. Its close/restoration/callback assertions are not reached. The nine earlier input cases pass. |
| MatchHudWishBarrierEditModeTests | 3 / 3 | Owner facts/clear, delivered vital shares and weapon tint/slot/replacement/reset cases pass. These unit results do not certify drawer raster or a network run. |
| AccountRecoveryViewEditModeTests | 1 / 2 | Recovery-key test expects a 64-character manual selection but observes selection length0. Later close/switch/cancel/blur obligations in that failed test are not certified. |
| HubCosmeticsViewEditModeTests | 2 / 7 | Five cases fail with MissingComponentException when RetireCard accesses CanvasGroup during card rebuild/retirement. Affected cases include existing-owner purchase pending, focus restoration and owner/callsign transitions; no full shop/wardrobe flow passes. |
| HubProgressViewEditModeTests | 3 / 3 | Three progress-view cases pass at unit level. Actual profile/achievement/leaderboard HTTP player flow and presentation remain NOTRUN. |
| MatchClientAccountBindingEditModeTests | 3 / 4 | Ordinary owned-join hook expects validated `wss://game.example/arena/ws` but observes null. The complete ordinary join cannot be accepted from this gate; its runtime cause is unassigned here. |

The header helper omission is corrected in test-only source `115e67b66335667fba1878d94239f47421ac0744`. That same leaf explicitly separates the unsupported synchronous rendered-raycast assumption: EditMode retains natural geometry/meshes, actual parent Mask filters and wheel/click callbacks; real GraphicRaycaster inside/outside hits and routed interactions remain mandatory in an advancing rendered Play gate. `008dad321530f9f3cb1e7a15c59dc8930aa3f308:docs/ui/DRAWER_PROOF_CONTEXT.md` records that obligation. The renamed method is `DrawerGeometryMaskFiltersAndCallbacksPreserveScrollAndSelection`; class counts remain five Drawer and ten Input, with no test-count reduction. One managed Net/runtime/test build passes with the existing unused-event warning. No native execution or rendered acceptance follows from these test-only corrections, and no production mask, shader, colour or layout was changed by them.

## Inventory acceptance matrix

Each row covers the complete original inventory requirement; partial implemented source is stated in the boundary, not promoted to a complete PASS.

| ID | Surface | Status | Evidence / remaining boundary |
| --- | --- | --- | --- |
| UI-001 | Startup | NOTRUN | Basic loading/errors present; browser startup not exercised. |
| UI-002 | Callsign claim/load, canonical identity, existing-owner sign-in, access code | FAIL | 6cdf89 ordinary owned-join binding test observes null instead of the validated session URL. Basic source gate/other binding cases do not certify the complete join or browser flow. |
| UI-003 | Saved credentials, blocked-storage feedback, explicit recovery-key reveal and manual copy | FAIL | 6cdf89 recovery-key manual selection expects64 characters but observes0; later reset/privacy paths in that failed test are unreached. Full browser/storage flow remains untested. |
| UI-004 | Hub identity/title, current/lifetime/monthly GV, run/win/draw/death/kill counters | NOTRUN | Hub/progression source is integrated in 6cdf89; scoped progress-view unit cases pass, but full profile/read/refresh presentation and HTTP player flow are not certified. |
| UI-005 | Hub walkable avatar, WASD/arrows/RMB, station activation, direct menu access | NOTRUN | Cosmetic hub movement/directory source; exact-revision player interaction not exercised. |
| UI-006 | Faction choice and Champions guide | NOTRUN | Five-faction guide/selection source; no client combat evaluation. |
| UI-007 | Weapon guide | NOTRUN | Weapon guide source; no client reach/damage rules. |
| UI-008 | Current weapon counter wheel, direction/advantage/threat labels, fists exclusion | NOTRUN | Existing weapon wheel source; no class/faction wheel. |
| UI-009 | Shop catalog, slot/category navigation, price, owned/available/unavailable states | FAIL | Integrated 6cdf89 cosmetic catalogue rebuild/retirement raises CanvasGroup MissingComponentException in five native cases. No complete catalogue/presentation acceptance. |
| UI-010 | Purchase action, busy/confirmed/refused/unknown, insufficient GV, retry | FAIL | 6cdf89 existing-owner purchase/pending case fails during cosmetic-card retirement; complete authoritative purchase/retry/unknown flow is unaccepted. |
| UI-011 | Wardrobe | NOTRUN | Wardrobe/equipment source is integrated in 6cdf89; shared cosmetic-card retirement failures remain, and no complete wardrobe/equipment player flow is certified. |
| UI-012 | Cosmetic preview and live in-run appearance | HELD | Preview source is integrated; authoritative live appearance/publication and complete player-flow proof remain held. |
| UI-013 | Titles | NOTRUN | Source integrated in 6cdf89; complete title selection/refresh/player-flow proof not run. |
| UI-014 | Achievements | NOTRUN | Source integrated and scoped progress-view unit cases pass; full achievement HTTP/presentation/player flow not run. |
| UI-015 | Monthly leaderboard | NOTRUN | Source integrated and scoped progress-view unit cases pass; full monthly leaderboard HTTP/presentation/player flow not run. |
| UI-016 | Run/Training entry, region list, measured region ping, public matchmaking placement | HELD | No admitted public placement/region/training entry UI. |
| UI-017 | Queue lifecycle | HELD | No admitted queue/capacity/human-bot roster UI. |
| UI-018 | Lobby map preview, public roster and waiting/countdown | NOTRUN | Collision map/phase preview only; full roster/placement remains incomplete. |
| UI-019 | Planning map/legend, camps/elites, zone/gate/objective context | NOTRUN | Collision layer only; rich authored terrain/camp/objective presentation held. |
| UI-020 | Two private spawn offers | NOTRUN | Owned two-spawn/contested/pending/refusal source exists; actual server race/reconnect not run. |
| UI-021 | Planning boon offers/selection and explanatory text | NOTRUN | Only delivered boon strings/choices shown; no fabricated effects. |
| UI-022 | Planning quest offers, acceptance and roster/build information | HELD | Quest/roster UI is not integrated in this candidate. |
| UI-023 | Ready/unready, authoritative readiness, deadline/countdown, pending timeout | NOTRUN | Ready/deadline/pending source exists; actual server timeout/race not run. |
| UI-024 | Routes | NOTRUN | Original-source route capture exists; exact browser-session persistence not rerun. |
| UI-025 | Route path, walking estimate, unreachable feedback, map/minimap/ground route cues | HELD | Private map route exists; full ground route and rich objective cues incomplete. |
| UI-026 | Route keyboard marker traversal, camp/objective stops and source-matched reach behavior | HELD | Rich camp/objective geometry and traversal incomplete. |
| UI-027 | Tactical map | NOTRUN | cf2383 native Tab/pointer blocking, WASD coexistence, menu/results/text-entry gates and blur cases pass; complete hold/toggle/map interaction flow is not certified. |
| UI-028 | Tactical terrain/gates, visibility/memory, permitted contacts | HELD | cf2383 permitted contacts visibly render and current-data tests pass; contacts/collision tiles exist, while full gates/visibility-memory parity is unavailable. |
| UI-029 | Tactical camps/chests/timers/objectives and route controls | HELD | Delivered chests/private routes only; full spatial camp/objective facts unavailable. |
| UI-030 | Tactical right rail | HELD | Observed contacts/weapon guide only; full roster/quests/build inspection unavailable. |
| UI-031 | Minimap RMB move, independent LMB camera peek, drag throttle/final release, lost focus/capture cleanup | NOTRUN | cf2383 native map-open/close/unbind minimap suppression/restoration passes; full RMB/LMB gesture choreography is not rerun. |
| UI-032 | Combat vitals | NOTRUN | cf2383 scoped placement, stats clearing and foreground/glass checks pass; the complete original row, including all bounty/faction detail, is not certified. |
| UI-033 | Combat phase/alive/timer and faction-specific meters | HELD | Phase/timer exists; full alive roster/faction meters unavailable. |
| UI-034 | Weapon slots/active state, Q/1/2, Wish R, potion E and inventories | NOTRUN | f5f5e0 native tint/slot-change/replacement/reset test and 1440p weapon/potion colours/active underline pass; complete Q/1/2/R/E command and inventory flow is not certified. |
| UI-035 | Interaction F, pickup eligibility, contextual prompts and notices | HELD | F pickup/notices exist; quest/trader contextual actions unavailable. |
| UI-036 | Persistent grouped build/stat stacks and full Build drawer via button/B | FAIL | F-04 at f5f5e0 remains visually unresolved. 6cdf89 proves initial Card00 bounds/meshes, then fails a synchronous raycast assertion; later interaction assertions are unreached and no captures ran. Test-context corrections compile separately; actual rendered hit/routing/scroll/selection and full drawer visual acceptance remain mandatory. |
| UI-037 | Gained numeric stats, damage types, mob bonuses, faction meters and explanations | HELD | Stacks/catalog only; derived numeric gains and further authoritative meters unavailable. |
| UI-038 | Opponent hover/target inspection, public build details and immediate hidden-contact removal | HELD | No published rich opponent inspection/build view. |
| UI-039 | Chest choice cards, titles/tags/descriptions, pending/taken/skip/deadline/refusal states | NOTRUN | cf2383 native explicit chest focus/digit choice consumes the digit and emits the decoded choice command; complete choice presentation/race/refusal/deadline coverage is not certified. |
| UI-040 | Pickups/traders | HELD | Pickup works in source; trade offer/cost/acceptance UI unavailable. |
| UI-041 | Quest dialog | HELD | Quest dialog is omitted from this UI candidate. |
| UI-042 | Quest log J, tracking, progress/rewards/deadlines, navigation | HELD | Quest log/tracking is omitted. |
| UI-043 | Quest completion/failure and navigation notices | HELD | Quest completion/failure UI omitted; no local inference. |
| UI-044 | World identity | HELD | Actor health/status/insignia exists; full name publication absent. |
| UI-045 | Targeting/reach, telegraphs, damage numbers, terrain/buff/camp markers and edge threats | HELD | Existing supplied cues; complete original world-cue coverage not established. |
| UI-046 | Results | NOTRUN | Delivered results/refresh only; banking receipt is not inferred and full flow not run. |
| UI-047 | Recovery | NOTRUN | Reconnect/error paths source present; actual interrupted browser/reload/close not proven. |
| UI-048 | Training entry/exit/status, stat/card/mob selectors, camps/chests, clear/reset | HELD | Training admission/console omitted. |
| UI-049 | Shared help/controls/glossary, contextual explanatory copy | NOTRUN | cf2383 H ownership/open-close/switch passes; complete help/glossary visual/focus matrix not rerun. |
| UI-050 | Settings | NOTRUN | cf2383 scoped foreground alpha/glass checks and 720p maximum minimap capture pass; complete settings interactions and native minimum/default/maximum scale matrix remain untested. |
| UI-051 | Shared keyboard focus, readable scroll panes, tooltips/toasts and modal close/blur | NOTRUN | Nine earlier input cases pass at 6cdf89, but its added header-close test stops on a missing Escape injection precondition. That test helper is corrected only in later source. Full mouse/modal/toast/scroll and rendered routing matrix is unaccepted. |
| UI-052 | Responsiveness | NOTRUN | No matched workload/frame-time/allocation/loading measurements. |
| UI-053 | Layout/accessibility | NOTRUN | Four cf2383 cases and f5f5e0 default HUD colours pass; F-04 remains unresolved. f5f5e0 720p and all 6cdf89 captures were halted. Full resolution, ultrawide, grayscale/CVD and reduced-motion matrix remains NOTRUN. |
| UI-054 | Functional browser proof | HELD | Full player flow depends on unintegrated/held screens; no current Web proof. |

## Native review completion rules

Only update the exact native rows after receiving the composed source SHA and matching ready/advancing/backbuffer receipts. Check default and 150% text, actual background/foreground alpha, corners and all saved minimap sizes, selected/disabled states, map/planning underlay suppression, previous-focus return, held-key/blur/pointer cancellation, and current-data removal. Preserve failed images and exact repro steps. A new fix belongs in a separate leaf; this report adds no layout direction or features.

Richer account/progression UI, quest/trade/training/placement and final player-flow proof remain distinct lanes. A working pickup is not a trader; a training flag is not admission; a configured URL is not matchmaking; a result is not a bank receipt. No unavailable action is certified here.
