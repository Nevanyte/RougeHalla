# Reviewed Hub account composition on the current client

Root base: `f5f5e016555755fb3e11b77026234148c107ca6b`.
Coherent source commit: `2b6eeb4b4c87e79df8b139210659aff225659cd8`.
Branch/worktree: codex/hub-account-integration, isolated sibling hub-account-integration/repo.

This composes the already-reviewed profile/progression/achievement/leaderboard, Shop/Wardrobe/Titles and explicit
recovery-key panels. Four UI classes/metas and three Editor-test classes/metas come from frozen177; cosmetics source
and regression come from the exact244 wallet privacy repair. The pure Net account-flow tests come from177; the earlier
repair receipt is retained as historical evidence, not counted as another pass at this composition.

Only four existing files change: MatchHud.Accounts instantiates/routes the panels and recovery guidance; Features adds
new-panel modal/focus/keyboard gates; MatchHud closes panels on settings/join/menu and applies lifetime/scale cleanup;
MythicUi adds two tab colors and disables rich-text interpretation while preserving its current signatures/fonts/theme.
Recovery Escape runs before the normal typing gate so selecting its read-only key still permits closing and clearing.
Existing unrelated-modal hotkey guards remain; new panels join those guards. Menu focus includes existing atrium service
buttons. No avatar/floor, reward/help feature, world rules, server, protocol or credential/API-core change is included.

Exact existing CreateCombatHud, ApplyDisplayPreferences (minimap scale), RefreshWorldHudVisibility,
RememberWorldHudFocus and RefreshBuildIcons bodies match root base. MythicUi matches base after removing its two new
constants and literal-text flag. Glass opacity, border-only strokes, icon hues/underlines, current geometry and fonts are
preserved. TacticalMap, BuildDrawer, actor1.2/nullable-giver presentation, owner-combat14 and account APIs are untouched.
Seven imported Unity asset/test GUIDs are unique. The manifest binds every changed file with origin and purpose.

Executed checks, with final-env.sh, jobs1 and DebugType=None/DebugSymbols=false:

- One copied-template `dotnet build <owned compile>/Tests.csproj --verbosity minimal -m:1 -p:DebugType=None -p:DebugSymbols=false`:
  matching local Net and runtime plus all existing/imported Editor-test source compile; **0 errors /1 inherited CS0067**
  unused TestTransport.Closed warning. Installed Unity6000.0.85f2 and existing cached art package assemblies are managed
  API references. No Editor/package import was launched. Templates/results are in this worktree's sibling compile directory.
- `dotnet test client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj --filter FullyQualifiedName~HubCosmeticsAccountFlowTests`
  with the same jobs/debug properties: **2 passed /0 failed /0 skipped**,18ms. Exact selectors:
  Roguehalla.Net.Tests.HubCosmeticsAccountFlowTests.ShopRetryIsExplicitAndReusesTheExactUnknownPurchaseOperation;
  Roguehalla.Net.Tests.HubCosmeticsAccountFlowTests.LateCosmeticMutationResultCannotPublishIntoTheNextSelectedOwner.
- git diff --check; exact import/protected-method/body checks and seven-GUID uniqueness pass. No broad .NET suite rerun.

Proposed Art/root-owned actual Editor selectors (not executed here):
Roguehalla.Client.Tests.HubCosmeticsViewEditModeTests (7 tests, including same-name wallet/status repair),
Roguehalla.Client.Tests.HubProgressViewEditModeTests (3), Roguehalla.Client.Tests.AccountRecoveryViewEditModeTests (2),
plus existing Roguehalla.Client.Tests.UiInputRoutingEditModeTests and global MatchClientAccountBindingEditModeTests for
modal routing/current account Join intent. The three imported classes contain12 source tests, not12 recorded passes.

Actual Editor import/layout/focus/clipboard-reveal behavior and live HTTP/browser flows remain held. A real browser must
still prove claim/load, purchase/refusal/unknown same-UUID retry, same-name credential replacement, board.You clearing,
blocked storage/manual recovery and reload/reconnect. No complete bank receipt or in-run cosmetic publication is supplied.
No simulation/policy rule or extra permission is introduced; root alone reviews/merges this candidate.
