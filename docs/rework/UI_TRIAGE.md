# Unity UI branch triage (for `feature/unity-rework`)

Read-only analysis. Nothing was committed, checked out, merged or deleted; no worktree was touched (all 18 listed worktrees are
clean and sit on their branch tips); no Unity or cargo was run. Inspection used `git log/cherry/diff/show/merge-tree` against branch
names only. `git merge-tree --write-tree` writes unreferenced loose objects into `.git/objects` (no ref, index or working-tree change); that is the
only side effect. Tested against `feature/unity-rework` at `43388f53` (docs-only commits ahead of `optimization_port` `61f9f15f`; the
Unity tree is identical to `optimization_port`'s).

Owner direction that drives the verdicts: layout and information hierarchy stay **exactly legacy**
([LEGACY_LAYOUT.md](LEGACY_LAYOUT.md)); the look changes from "dark navy glass" to a bright modern-fantasy skin.
So: **KEEP** = functional and theme-neutral (input / mouse-capture, hub logic, state plumbing, tests, fixtures, tools);
**ADAPT** = useful structure that carries navy-glass styling or non-legacy layout and must be stripped or re-laid-out;
**DROP** = styling only, already present, or superseded. Every DROP below says which of those it is.

## 1. Headline

1. **Almost everything is already in `optimization_port`.** `git cherry optimization_port <branch>` reports 21 of the 50
   `codex/unity-ui-hub` commits, 13 of 14 `-modernization` commits, 2 of 8 `-acceptance` commits and **every commit of all 13
   small repair branches** as patch-equivalent copies (`-`), landed earlier as differently-numbered commits (mapping in section 4).
   `git branch --contains` reports no branch tip as an ancestor, because the work was re-committed rather than merged; the branches
   are 447-979 commits behind (`optimization_port` moved on).
2. **Genuinely unmerged content is small**: 29 hub commits (these include the one unique `-modernization` commit, `fb30377a`) + 6 acceptance doc commits +
   `unity-art` (art assets) + `input-latency` (already present in effect). Of the 29 hub commits only **6 are worth taking whole** (two minimap
   input/capture commits, the tabbed help guide, two fixture/tooling commits, a one-line hub avatar size), plus hand-ports of a few new files
   donated by two more (`599968ec`, `80782825`). The other 21 are superseded by the re-landed hub on `optimization_port` (same files, newer
   content) or are docs of a candidate that no longer exists.
3. The navy-glass styling is **already in the tree** (it arrived via the "present" commits `d28df076`, `19c31ce6`, `f5f5e016`, `3a1c8fc4`,
   `b0201974`), so none of the remaining work *adds* glass; the skin job is stripping `MythicUi.Backdrop` (alpha cap 200/255), `MythicUi.Border`,
   the `ShowcasePalette` navy values and the semantic icon tints, and moving the layout to legacy.
4. Expected conflicts: the six recommended commits apply **cleanly in sequence** except `ccf05e05` (one-line csproj add/add). The remaining
   hub commits conflict because the same files exist in newer form (section 6). F-04 (section 5) is a rendering-readiness defect of the Build
   drawer on the glass candidate, not tied to any commit still unmerged; its repair `9b2d1738` is already in the tree.

## 2. Branches at a glance

`behind/ahead` = `git rev-list --left-right --count optimization_port...<branch>`. "equiv/unique" = `git cherry` (patch-id) counts.

| Branch | Worktree (`RogueHalla-worktrees/`) | Tip | Merge-base with `optimization_port` | Behind / ahead | Equivalent in `optimization_port` / unique | Verdict |
|---|---|---|---|---|---|---|
| `codex/unity-ui-hub` | `unity-ui-hub` | `177f19fa` | `dd95b64d` | 670 / 50 | 21 / **29** | Mostly DROP; 6 KEEP/ADAPT + hand-ports (section 3.1) |
| `codex/unity-ui-modernization` | `unity-ui` | `dcbaa995` | `dd95b64d` | 670 / 14 | 13 / **1** (`fb30377a`) | Subset of hub; only `fb30377a` is unique (KEEP) |
| `codex/unity-ui-acceptance` | `unity-ui-acceptance` | `ab817acb` | `96a3462e` | 606 / 8 | 2 / **6** (docs only) | DROP (records the navy-glass gate); F-04 text lives on in-tree doc |
| `codex/unity-ui-blur-repair` | `unity-ui-blur-repair` | `b6bdaa1f` | `46671304` | 610 / 1 | 1 / 0 (`8a03fe30`) | DROP (present) |
| `codex/unity-ui-compact-hud` | `unity-ui-compact-hud` | `838e6a13` | `46671304` | 610 / 1 | 1 / 0 (`3a1c8fc4`) | DROP (present; layout contradicts legacy) |
| `codex/unity-ui-edge-fixture` | `unity-ui-edge-fixture` | `7b4f106f` | `aa637612` | 615 / 3 | 3 / 0 | DROP (present) |
| `codex/unity-ui-gate-repair` | `unity-ui-gate-repair` | `4df31bdf` | `d6603a82` | 632 / 7 | 7 / 0 | DROP (present) |
| `codex/unity-ui-glass-border-fix` | `unity-ui-glass-border-fix` | `39668119` | `96a3462e` | 606 / 2 | 2 / 0 | DROP (present; styling) |
| `codex/unity-ui-glass-minimap` | `unity-ui-glass-minimap` | `f8753b86` | `96a3462e` | 606 / 1 | 1 / 0 (`d28df076`) | DROP (present; styling + non-legacy minimap) |
| `codex/unity-ui-icon-colours` | `unity-ui-icon-colours` | `18efb1bd` | `cf23833f` | 502 / 1 | 1 / 0 (`f5f5e016`) | DROP (present; styling) |
| `codex/unity-ui-input-repair` | `unity-ui-input-repair` | `cf402e3d` | `83ee6613` | 617 / 2 | 2 / 0 | DROP (present) |
| `codex/unity-ui-map-renderer-fix` | `unity-ui-map-renderer-fix` | `7d2e266c` | `d28df076` | 506 / 1 | 1 / 0 (`26abd7ba`) | DROP (present) |
| `codex/unity-ui-modal-key-fix` | `unity-ui-modal-key-fix` | `f2292d4a` | `d28df076` | 506 / 2 | 2 / 0 | DROP (present; guard still in tree, `MatchHud.Features.cs:264-282`) |
| `codex/unity-ui-settings-lease` | `unity-ui-settings-lease` | `f9049c15` | `d29b6592` | 612 / 2 | 2 / 0 | DROP (present) |
| `codex/unity-ui-text-fit` | `unity-ui-text-fit` | `53782957` | `20f188c6` | 608 / 1 | 1 / 0 (`b0201974`) | DROP (present; styling/typography) |
| `codex/unity-character-scale` | `unity-character-scale` | `7730cb04` | `20f188c6` | 608 / 1 | 1 / 0 (`96a3462e`) | DROP (present; theme-neutral) |
| `codex/input-latency` | `input-latency` | `3241cb12` | `af284c5a` | 979 / 1 | 0 / 1 but content present | DROP (tools-only, present as `326744c3`; not UI) |
| `codex/unity-frozen4-editor-idle` | `unity-art` | `5b7877f9` | `719cc2b7` | 447 / 1 | 0 / 1 | Not UI: art/audio assets (see 3.5) |

Reproduce a row: `git merge-base optimization_port B`, `git rev-list --left-right --count optimization_port...B`, `git cherry -v optimization_port B`.

## 3. Per-commit verdicts

"Apply" = `git merge-tree --write-tree --merge-base=<commit>^ feature/unity-rework <commit>` run **in isolation**: CLEAN, NOOP (the change is already in the tree), or
CONFLICT (files). Section 6 repeats the check **in sequence** for the recommended set. Upstream hash = the `optimization_port` commit with the identical patch (`git patch-id --stable`).

### 3.1 `codex/unity-ui-hub` (50 commits, oldest first)

**Group A - 21 patch-equivalent copies already in `optimization_port`: DROP (present).** Isolated apply is NOOP or conflicts only because the files moved on.

| Commit | Subject | Upstream copy |
|---|---|---|
| `f56d68cb` | Add Unity route planning and UI input models | `92db100a` |
| `86f71562` | feat: add mythic build drawer UI components | `0ee81b5b` |
| `59616c35` | Add authoritative planning selection model | `080adfe9` |
| `cb0808b1` | Model minimap pointer gestures | `a899c878` |
| `98369db3` | Add hub weapon guide views | `126d5da1` |
| `b5d11c08` | feat: expose reusable account hub flow and safe match origin policy | `eebcee94` |
| `480f87ea` | fix: bind account hub operations before reentrant state callbacks | `d410207a` |
| `02decd6c` | Add cosmetic walkable hub atrium | `5d565e82` |
| `5e53cbab` | Add modern display settings view | `3e11a921` |
| `4700454d` | test unity UI input routing | `d23c2be8` |
| `71a0a162` | Port mythic HUD planning map and owned account hub | `2df6634a` |
| `5a1ca954` | Test account intent binding in match client | `cc7790b7` |
| `dcbaa995` | fix(unity): serialize empty layers for clean TagManager imports | `f4f418be` |
| `d8e5b673` | Bind leaderboard errors and preserve purchase conflict typing | `538de384` |
| `c79e2f4e` | Expose confirmed current-owner recovery key read | `d762ac01` |
| `7abe6d40` | Advance TMP activation lifecycle in text focus fixture | `b6cfdf97` |
| `2cc4f9e6` | Refresh map publication changes in the next UI frame | `5de9f0ba` |
| `23bdb98f` | test: cover tactical map contact invalidation | `c044152f` |
| `2af16503` | Retain map publication dirtiness until it is presented | `bf89bcc4` |
| `cdba4e30` | feat(account): expose read-only operation ownership query | `e7ebbb48` |
| `177f19fa` | Enlarge characters and overhead indicators by twenty percent | `96a3462e` |

**Group B - 29 commits with no patch-equivalent upstream.**

| Commit | Subject | Content | Apply (isolated) | Verdict |
|---|---|---|---|---|
| `0ef14648` | Recover minimap gestures when UI pointer release is missed | `MinimapGesture.cs` (+7, both copies), `TacticalMapController.cs` (`ReconcileMinimapButtons`, Esc releases), `TacticalMapSurface.ScreenWorld`; no styling | CLEAN | **KEEP** - minimap hold-peek / right-steer capture (legacy 3) |
| `6234aa2e` | test: cover minimap mouse capture recovery | `MinimapCaptureEditModeTests.cs` (221 lines) | CLEAN | **KEEP** (needs `0ef14648`; re-aim fixture rects when the minimap is re-laid-out) |
| `fb30377a` | Document UI coverage and test WebGL bridge | `tools/ui/verify-browser-ui.cjs` (181; same blob at hub tip), `docs/ui/COVERAGE.md` rev 1 | CLEAN | **KEEP** the tool; take `COVERAGE.md` from the hub tip (rev 3) instead |
| `ccf05e05` | capture legacy route and map input UI behavior | `docs/ui/legacy-route-map-v1.json` (545), `LegacyUiRouteMapFixtureTests.cs`, `packages/client/test/legacyUiRouteMapFixture.test.ts`, csproj line | CONFLICT `RoguehallaNet.Tests.csproj` (adjacent add: keep both `<Compile>` and the new `<None Include=...legacy-route-map-v1.json>`) | **KEEP** - legacy-derived fixtures for Tab-map/route behaviour (legacy 13). Note it adds one test file under `packages/` |
| `b82b1585` | Add tabbed help and mechanics guide | `HelpGuideView.cs` (290), `HelpGuideViewEditModeTests.cs` (85). Uses only `MythicUi.Panel/Rect/Text/Button/ButtonStyle` and `ShowcasePalette` constants that exist in the tree. Near-full-screen overlay (.105-.895 x .055-.945) | CLEAN | **ADAPT** - Controls/Mechanics tabs match legacy help (11.2) but must become the 560 px card and drop the navy `Color32(3,7,12,224)` scrim; wiring is not in this commit (see `599968ec`) |
| `9d65b82d` | Size the hub avatar for the large-icon layout | `HubAtriumView.cs`: avatar 42 -> 72 | CLEAN | **KEEP** (hub phase, low value) |
| `599968ec` | Integrate field guide, reward pending feedback and keyboard reading panes | `RewardSelection.cs` + tests (pure logic: pending/refused chest picks), `RewardOptionFocus.cs` (14), `HubFloorPointer.cs` (22, click-to-walk on the hub floor), `KeyboardScrollPane` Page/Home/End, `HelpGuideView` wiring in `MatchHud.Features.cs:169-171,198`, `MatchHud.cs` reward hooks | CONFLICT `HelpGuideView.cs`, `KeyboardScrollPane.cs`, `MatchHud.Features.cs`, `MatchHud.cs`, test | **ADAPT** - hand-port the new files (`RewardSelection*`, `RewardOptionFocus`, `HubFloorPointer`) and the HelpGuide wiring hunks; skip the rest (tree has newer `KeyboardScrollPane`/`MatchHud`) |
| `80782825` | Checkpoint hub integration and accessible focus treatment | `UiFocusRing.cs` (Outline-based gold ring), `UiContrastEditModeTests.cs` (28), recovery-view/HUD edits | CONFLICT 9 files | **DROP** mostly (tree replaced Outline rings with `MythicUi.Border`, `19c31ce6`); **ADAPT** only `UiContrastEditModeTests` (re-target to the new palette) |
| `4e72c69c` / `535e5861` / `95217ebe` | Hub progress panels / guard profile reads / accessible selected tab fill | `HubProgressView.cs` | CONFLICT | **DROP (present)** - `HubProgressView.cs` at the hub tip is byte-identical to the tree |
| `7ec3dbd6` `70af75ad` `2509e101` `2ba4dda9` `261bb16f` `2ad7d877` | Cosmetics views / ownership reads / current profile / copy / focus on deferred destruction / hide retries from stale owners | `HubCosmeticsView.cs` (+tests) | CONFLICT (same two files each) | **DROP (superseded)** - tree has the newer re-landed view (`2b6eeb4b`, `55f5be57`, `6749d62f`: lifecycle repair, stale-owner handling). Residual hub-only lines are older code |
| `b55d7628` | Add owner-bound full account data and shop API handoff | `AccountApiService.cs`, `AccountFullJson`, `UnityAccountTransport`, evidence JSON | CONFLICT 11 files | **DROP (superseded)** by the released API (`f722962d`) already in the tree |
| `b008585d` `806fc6a4` | Recovery-key reveal test / wire owner recovery + coverage checklist | `AccountRecoveryView`, `MatchHud.Accounts/Features`, docs | CONFLICT | **DROP** code (tree has the newer view, `AccountRecoveryView.cs`); take `docs/ui/BEHAVIOR_CHECKLIST.md` by file (54 stable IDs; see 7) |
| `b4b4d80b` | Adopt sealed first-slice UI gate repairs | `UiLayoutReview*.cs` frames, tests | CONFLICT 6 files | **DROP (superseded)** by `68a6cb11` |
| `f8ff13f9` `5a9f5f01` `24fd25ae` | Cosmetic grid sizing / retry copy + unavailable prices / clear private leaderboard rank | | NOOP | **DROP (present)** in effect |
| `b6478d1a` `c0cdef02` `da66428c` `e7959397` | Move HUD stats to top-left + compact controls / compact build labels / map control hit target / hub heading + owner summary clearing | `MatchHud.Features.cs`, `TacticalMapController.cs`, `docs/ui/COMPACT_HUD.md` | CONFLICT | **DROP** - an earlier revision of the compact layout (`3a1c8fc4` + later glass/minimap commits are in the tree), and that layout contradicts legacy (health bottom-left etc.) |
| `34283387` | Record revision-scoped UI gates and diagnostic preview limits | docs | CONFLICT `BEHAVIOR_CHECKLIST.md`, `COVERAGE.md` | **DROP** (docs of the glass candidate) |

### 3.2 `codex/unity-ui-modernization` (14 commits)

Identical to the first 14 commits of the hub branch (Group A rows `f56d68cb` ... `dcbaa995`, minus `fb30377a`). 13 are present upstream; the one unique commit is `fb30377a` (**KEEP** the tool, see above). Whole branch otherwise **DROP (present)**.

### 3.3 `codex/unity-ui-acceptance` (8 commits)

| Commit | Subject | Verdict |
|---|---|---|
| `f8753b86` | Enlarge minimap and apply translucent HUD backdrops | **DROP (present, `d28df076`; styling + a non-legacy landscape minimap)** |
| `3210b8dc` `72b71305` `5bda46fd` `51fbb80a` `323333bf` | Record finite acceptance scope / native glass failure / separate modal+map repair gates / corrected glass minimap checks / full inventory acceptance | **DROP** - rewrites of `docs/ui/UI_ACCEPTANCE_2026-11-08.md` for the glass candidate (CONFLICT against the earlier in-tree version); the history is in the branch if ever needed |
| `247d3386` | Record icon and combined native UI gate results | **DROP (present, `719cc2b7`)** |
| `ab817acb` | docs(ui): reconcile admitted functional engine receipts | CLEAN, adds `UI_ACCEPTANCE_RECEIPTS_2026-11-09.json` (848 lines): **DROP** (receipts for the glass candidate; keep on the branch) |

### 3.4 Small repair branches (all patch-equivalent, DROP (present))

| Branch | Commits and what they did | Upstream copy | Note for the re-skin |
|---|---|---|---|
| `unity-ui-blur-repair` | `b6bdaa1f` separate blur checks for modal and map (test) | `8a03fe30` | test-only |
| `unity-ui-compact-hud` | `838e6a13` move HUD stats top-left, compact action bar (128-unit bar, 48-unit icons) | `3a1c8fc4` | **layout superseded** by "legacy exactly" |
| `unity-ui-edge-fixture` | `6027dfa1` `5948ba3f` `7b4f106f` keyboard-routing test fixture hygiene | `d7bee992` `5288b09a` `d29b6592` | input tests; keep in tree |
| `unity-ui-gate-repair` | `62426d79` `de24ad08` (guide focus, counter rail) `f6266af6` `d6c23dde` `1d3e26dd` `d486ee4c` `4df31bdf` EventSystem fixture + layout-review frames | `aa3e326b` `0e7bda98` `68a6cb11` `2e280ab1` `d915b0c8` `62747383` `e241c56c` | tests/focus; keep in tree |
| `unity-ui-glass-border-fix` | `f8753b86` + `39668119` edge-only glass borders (F-02) | `d28df076`, `19c31ce6` | **styling - strip** (`MythicUi.Border`/`Backdrop`) |
| `unity-ui-glass-minimap` | `f8753b86` doubled-area minimap, alpha-200 backdrops | `d28df076` | **styling + non-legacy minimap - replace** |
| `unity-ui-icon-colours` | `18efb1bd` semantic tint per stat/weapon/potion icon | `f5f5e016` | tint table (`MythicUi.BoostColor/GlyphColor`) maps well to legacy `STAT_ICON_COLORS`; re-theme values |
| `unity-ui-input-repair` | `5273f97f` stable keyboard fixture, `cf402e3d` ASCII spawn markers | `478b11b4`, `aa637612` | keep in tree |
| `unity-ui-map-renderer-fix` | `7d2e266c` CanvasRenderer for map marks (F-03) | `26abd7ba` | keep in tree - needed for any minimap re-implementation |
| `unity-ui-modal-key-fix` | `64459e27` B/H shortcuts guarded behind modals (F-01), `f2292d4a` | `d10dee3f`, `cf23833f` | keep in tree |
| `unity-ui-settings-lease` | `e2f1bc30` `f9049c15` InputSettings ownership/rollback | `d0c04e9e`, `46671304` | keep in tree |
| `unity-ui-text-fit` | `53782957` map/reward typography fit | `b0201974` | typography - revisit with the new font |
| `unity-character-scale` | `7730cb04` characters + overhead indicators +20% | `96a3462e` | theme-neutral, in tree |

### 3.5 `input-latency` and `unity-art` (= `codex/unity-frozen4-editor-idle`)

- `codex/input-latency` `3241cb12` "drain delayed proxy traffic and always preserve latency reports": `tools/latency/*` only; every touched file is already byte-identical in the tree (`326744c3`). **DROP (present, not UI).** `git cherry` shows `+` only because the original patch was rebased.
- `unity-art` `5b7877f9` "Prepare frozen VFX, biome props and ambience candidates": 77 files, ~31,300 lines (`FlareVfxCatalog.asset` 27,932 lines, five 2.3 MB ambience WAVs, `CREDITS.txt`/`LICENSE.txt` for third-party flare VFX, frozen manifests). CLEAN against the tree, but it is an asset-pipeline commit with licence implications. **Not a UI item: route to the art/licence-ledger workstream**, do not take it as part of the UI integration.

## 4. Why "present" is trustworthy

`git patch-id --stable` was computed for all 539 non-merge commits in `dd95b64d..optimization_port` and matched against each branch commit (81 distinct commits across the 15 UI branches): 46 matched, 35 did not, and the 35 are exactly the `+` commits above (29 hub + 6 acceptance docs). Spot checks of the content still being live in the tree: modal B/H guard (`unrelatedModal`, `MatchHud.Features.cs:264,280-282`), minimap `CanvasRenderer`, drawer top-pivot (`9b2d1738` is in `optimization_port`), `HubProgressView.cs` identical to the hub tip.

## 5. F-04 - the Build drawer failure (and the "9 of 34" candidate)

**Where recorded**
- `docs/ui/UI_ACCEPTANCE_2026-11-08.md` ("Frozen scope"; table rows "Icon Build drawer capture", "Combined native test gate"; section "F-04 - Build drawer catalogue is obscured by a cyan rectangle"; UI-036 row). On `feature/unity-rework` at that path; also on `codex/unity-ui-acceptance` in a longer revision.
- `docs/ui/DRAWER_PROOF_CONTEXT.md` (the rendered-proof contract), `docs/MIGRATION.md:168-169`, and evidence under `docs/evidence/unity-combined-f5f5e0/` and `docs/evidence/unity-combined-6cdf89/editor-test-gate/` (`FAILURE_TRIAGE.md`, `EXPECTED_TESTS.json`).

**What failed.** The "combined candidate" is `6cdf893c` (glass + icon-colour `f5f5e016` + drawer correction `9b2d1738` + hub `28b9530a`). Native EditMode gate: **25 of 34 pass, 9 fail** (stopped before Play, so no captures):

| Group | Pass / total | Failure | Nature |
|---|---|---|---|
| `BuildDrawerEditModeTests` | 4/5 | the visible `GraphicRaycaster` hit | **test assumption**: synchronous NUnit test on an Overlay canvas never gets a processed render depth (graphic depth stays -1, uGUI rejects it); renamed/rescoped in `115e67b6`/`008dad32`, rendered proof moved to a Play gate |
| `UiInputRoutingEditModeTests` | 9/10 | test helper throws "No injected-key precondition configured for Escape" | test-only omission, fixed in `115e67b6` |
| `AccountRecoveryViewEditModeTests` | 1/2 | manual-selection length 0 instead of 64 | TMP caret-position selection (`selectionAnchorPosition`, hub tip) depends on a generated text mesh, which an EditMode fixture lacks; the tree selects by raw string position (`selectionStringAnchorPosition`) with a comment saying so |
| `HubCosmeticsViewEditModeTests` | 2/7 | 5x `MissingComponentException` on `CanvasGroup` in `RetireCard` during card rebuild | production bug: `card.GetComponent<CanvasGroup>() ?? card.AddComponent<CanvasGroup>()` (the hub-tip code, `HubCosmeticsView.cs:606`) bypasses Unity's overloaded null for a destroyed component; the tree uses an explicit `== null` check since `55f5be57`. Do not re-introduce `??` on Unity objects when porting |
| `MatchClientAccountBindingEditModeTests` | 3/4 | owned-join hook returns null instead of `wss://game.example/arena/ws` | account join wiring; cause unassigned at that gate |

**F-04 itself (the "Build-drawer rendering defect").** At released source `f5f5e016`, 2560x1440, 100% text, offline stress HUD with 80 owned card stacks, opening the real Build Details control produced a PNG (`layouts/1440-drawer-text100.png`) where **a solid bright-cyan rectangle covers the card-catalogue viewport**. The summary and coloured stat glyphs draw; the cards do not. Facts recorded: (a) capture metadata was "ready", advancing, correct size, zero TMP overflow - so metadata cannot certify the drawer; (b) the viewport `Image` reports white RGBA 1 while the PNG is cyan; (c) the card bounds were geometrically wrong - Card00/01 at y 6851-7144, i.e. far below the viewport, because the fitted content was not top-pivoted (Card40-45 intersected the viewport); (d) the global Help/Settings/Leave buttons also showed through behind the drawer header; (e) a no-image diagnosis replay stalled at frame 2 with renderer depths -1 (nothing processed), compiled UI mask/pop/card shader passes were present, and the cyan resembles URP's "loading fallback" colour (the GPU Resident Drawer path is disabled in this project). **Cause: not established.** Best reading from the record: a ScrollRect + `Mask` (stencil) catalogue drawn before the canvas/materials were ready, with mis-positioned content; it is a rendering-readiness / stencil-pass symptom, not a data defect. Repair `9b2d1738` ("top aligned content, suppress overlapping header actions") is in the tree; no mask, material or shader change was made. `docs/MIGRATION.md:168-169` records that later browser (WebGL) screenshots show the drawer rasterised **without** cyan; the Editor failure is held as unresolved and not turned into a pass.

**Consequence for the re-skin.** Do not touch the drawer's mask/materials while theming; keep the ScrollRect/Mask structure and verify with an advancing-frame Play capture (the contract in `DRAWER_PROOF_CONTEXT.md`). The drawer is not a legacy element (legacy keeps cards and mob stats in a collapsed `<details>`), so it can be re-laid-out later behind the build HUD's "details" affordance.

## 6. Apply check against `feature/unity-rework`

Method: sequential `git merge-tree --write-tree --name-only --merge-base=<c>^ <current-tree> <c>`, each step feeding its result tree to the next.

```
CLEAN    0ef14648 Recover minimap gestures when UI pointer release is missed
CLEAN    6234aa2e test: cover minimap mouse capture recovery
CLEAN    fb30377a Document UI coverage and test WebGL bridge
CLEAN    b82b1585 Add tabbed help and mechanics guide
CLEAN    9d65b82d Size the hub avatar for the large-icon layout
CONFLICT ccf05e05 capture legacy route and map input UI behavior :: RoguehallaNet.Tests.csproj  (keep both sides)
```

Conflicts for everything else (isolated): `599968ec` HelpGuideView/KeyboardScrollPane/MatchHud.Features/MatchHud (+ test); `80782825` 9 files; the cosmetics group (`HubCosmeticsView.cs` + its test, every time); `b55d7628` 11 files (AccountApiService, AccountHubFlow, AccountCoordinator, AccountFullJson, UnityAccountTransport, csproj, tests, evidence); compact-HUD group (`MatchHud.Features.cs`, `MatchHud.cs`, `TacticalMapController.cs`, `COMPACT_HUD.md`); `b4b4d80b` (UiLayoutReview*, 3 tests); small-branch layout commits (`838e6a13`, `f8753b86`, `53782957`, `18efb1bd`: `MatchHud.Features.cs`, `MatchHud.cs`, `MythicUi.cs`, `TacticalMapController.cs`). All of those are DROP anyway.

File-level residual (hub tip vs tree, UI paths) that is the whole of what the hub branch still has that the tree lacks: `HelpGuideView.cs`(+tests), `HubFloorPointer.cs`, `RewardOptionFocus.cs`, `RoguehallaNet/Net/Ui/RewardSelection.cs`(+tests, in both `client-unity/RoguehallaNet` and `Assets/RoguehallaNet` copies), `UiFocusRing.cs`, `MinimapCaptureEditModeTests.cs`, `UiContrastEditModeTests.cs`, `docs/ui/{BEHAVIOR_CHECKLIST,COVERAGE,ROUTE_MAP_CAPTURE}.md`, `docs/ui/legacy-route-map-v1.json`, `tools/ui/verify-browser-ui.cjs`, `packages/client/test/legacyUiRouteMapFixture.test.ts`, and small logic hunks inside `TacticalMapController/Surface`, `MatchHud*`.

## 7. Recommended integration order

Do these on `feature/unity-rework` before or alongside the re-layout; the first two touch the minimap, which the re-layout will rewrite, so land them first and let the new minimap inherit the fix and test.

| # | Action | Verdict | Conflicts | Helps legacy element |
|---|---|---|---|---|
| 1 | `git cherry-pick 0ef14648` Recover minimap gestures when UI pointer release is missed | KEEP | none | **Minimap (3)**: hold-left peek / right steer must release when the UI pointer-up is lost; `Esc` releases |
| 2 | `git cherry-pick 6234aa2e` test: cover minimap mouse capture recovery | KEEP | none (fixture rects need re-aim after the minimap moves to a bottom-right 12/12 square) | Minimap (3) |
| 3 | `git cherry-pick fb30377a`, then `git restore --source=177f19fa -- docs/ui/COVERAGE.md` (rev 3) | KEEP (tool) / docs | none | verification of every element in a browser build (`tools/ui/verify-browser-ui.cjs` runs `Assets/Plugins/WebGL/RhUi.jslib` in a node `vm`: query/hash handling, blocked storage, page bridge) |
| 4 | `git restore --source=177f19fa -- docs/ui/BEHAVIOR_CHECKLIST.md` | KEEP (docs) | none (file absent) | The 54-ID behaviour inventory; use as the acceptance list for the re-skin |
| 5 | `git cherry-pick ccf05e05` (resolve csproj: keep both sides) | KEEP | 1 trivial | Planning / hold-Tab map (13): captured legacy route, 12-stop limit, Tab modifier and focus rules as fixtures |
| 6 | `git cherry-pick b82b1585`, then hand-port the HelpGuide wiring hunks from `599968ec` (`MatchHud.Features.cs:169-171` creation, `:198` toggle) | ADAPT | wiring is manual | **Help card (11.2)** + chrome Help button: Controls/Mechanics tabs; re-size to the 560 px card, new scrim and palette; keep the `H`/`Esc`/outside-click behaviour |
| 7 | Hand-port new files from `177f19fa`: `Net/Ui/RewardSelection.cs` (+ `RewardSelectionTests.cs`, both copies), `RewardOptionFocus.cs`, and the reward hooks in `MatchHud.cs` (`ReviewReward`, `TickRewardSelection`) | ADAPT | MatchHud hunks by hand | **Chest choice panel (10)**: pending / refused / taken states and keyboard review; match legacy `1 2 3` / `0` / `C` focus rules |
| 8 | `git restore --source=177f19fa -- client-unity/UnityProject/Assets/Tests/Editor/UiContrastEditModeTests.cs`, then retarget to the new palette | ADAPT | none; will fail until retargeted (it asserts navy-palette contrast) | All elements: a contrast guard for the bright skin |
| 9 (hub phase, later) | `git cherry-pick 9d65b82d`; hand-port `HubFloorPointer.cs` and its `HubAtriumView` hunks (`MoveOnFloor`, `_floorTarget`) | KEEP | `HubAtriumView.cs` hunks by hand | **Hub (15.2)**: avatar size and floor click-to-walk |

Not recommended, with reason: everything in Group A (present), the cosmetics / account / compact-HUD / gate commits in Group B (superseded or contradicting legacy layout), the five acceptance-doc commits, `ab817acb`, and `unity-art` `5b7877f9` (asset pipeline, route to the art workstream).

Items that are **not** in any unmerged branch and must be built new for the legacy layout (no commit to take): top-left HUD plate with health/build/cards, 270 px bottom-right square minimap, weapon bar with Q swap chip and Wish tile, champion combat HUD, chrome cluster (Fullscreen/Settings/Help + perf pill), Coliseum timer pill, banner pill, toast stack, death line, edge glows, anchored settings card, tabbed 560 px help card, results panel, trader card, docked hub menu. See `LEGACY_LAYOUT.md` section 18.3.

## 8. Commands used

```
git worktree list; git merge-base optimization_port B; git rev-list --left-right --count optimization_port...B
git cherry -v optimization_port B; git branch --contains B
git log --no-merges -p --format='commit %H' dd95b64d..optimization_port | git patch-id --stable    # upstream patch ids
git merge-tree --write-tree --name-only --merge-base=<c>^ <our-tree> <c>                          # isolated and sequential apply checks
git diff --stat feature/unity-rework codex/unity-ui-hub -- <ui paths>                              # file-level residual
```
