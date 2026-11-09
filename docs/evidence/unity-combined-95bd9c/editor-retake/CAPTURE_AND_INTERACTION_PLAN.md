# 95bd9c UI gate — capture and interaction plan

## Gate and scope

Use this plan only at exact source `95bd9c1efcde9b71cb07f23f24aef8ff4fb17013`. Run the requested source tests first: cosmetics (7), progress (3), recovery (2), and global-binding (4). Proceed only if all 16 pass; preserve any failure and stop. Then obtain exactly the three original native captures:

1. 2560 × 1440 HUD, default text/mini settings.
2. 2560 × 1440 open Build Details drawer, default settings.
3. 1280 × 720 HUD, text scale 1.5 and mini scale 1.25.

Do not add captures or change proof expectations. The required native contract is `docs/ui/DRAWER_PROOF_CONTEXT.md` in this exact commit. It explicitly says the synchronous EditMode test is not proof of processed Graphic depth, sorted EventSystem hits, stencil output, rendered clipping, native routing, or screenshot appearance. Keep these as independent rendered obligations.

## Public source/API map

- `UiLayoutReview` is the explicit offline fixture. Its public `Hud` property returns `MatchHud`; `IsReady` identifies initialization. It makes no socket connection and has an advancing review clock. Use its already staged fixture; do not describe this as network/gameplay evidence.
- `MatchHud.InitializeFeatures` attaches `BuildDrawer` to the same GameObject as `MatchHud`; resolve it with `review.Hud.GetComponent<BuildDrawer>()`. Public inspection properties are `IsVisible`, `Scroll`, `Content`, `CardCount`, and `SelectedIndex`.
- Public paths: `MatchUI/PlayerHUD/BuildStrip/BuildDetails`; drawer child paths `BuildDrawer/DrawerTitle`, `CardCount`, `Close`, `OwnerSummary`, `BoostStrip`, `CardCatalogScroll/Viewport/Content/Card00`; global header actions are `MatchUI/Help`, `Settings`, and `Leave`. Resolve cards from `BuildDrawer.Content` and buttons from their GameObjects. Record the actual `ScrollRect.viewport`, `content`, and `verticalNormalizedPosition`.
- The production drawer's scroll structure is `ScrollRect → Viewport(Image + Mask, showMaskGraphic=false) → Content`. Content has top pivot `(0.5,1)`, upper-left two-column grid, and 80 cards. Header/count/Close are siblings above the viewport, not children of scroll content; selection detail is a fixed sibling below it.
- `MatchHud.Initialize` ensures an `EventSystem` with `InputSystemUIInputModule`; the Canvas uses `GraphicRaycaster`. `EventSystem.current.RaycastAll(PointerEventData, List<RaycastResult>)` is a public way to record ordered hits at the actual `Mouse.current.position`. Public graphics evidence includes `Graphic.depth`, `CanvasRenderer.cull`, `CanvasRenderer.GetMesh()`, active hierarchy, material/shader names, `Shader.isSupported`, and `Material.passCount`. The native pixels remain the acceptance for whether stencil/pop/card rendering actually looks right.

## Three capture sequence

### 1. HUD 2560 × 1440 default

Run the staged offline HUD mode and wait for ready state, advancing frames/ticks, and all requested 16 source tests to be green. Capture at end of frame at the native 2560 × 1440 dimensions. Preserve the original PNG; JSON should include exact source SHA, mode/scales, screen and image dimensions, frame/tick advancement, active root Canvas and pixel rect, text overflow, control bounds, active graphics and their depth/cull/material/shader/pass-count, and the native capture method. Do not treat `isSupported` or a populated mesh alone as a successful draw.

### 2. Drawer 2560 × 1440 default

Start with the original offline HUD fixture. Open through the visible Build Details control using the plan’s public EventSystem hit-resolved pointer-click route. Do not call `Button.onClick.Invoke`, `ToggleBuild`, or `SetVisible` to open it. Wait one rendered frame after layout settles. Confirm `BuildDrawer.IsVisible`; global Help/Settings/Leave are hidden; drawer title/count/Close and selected card are active and rendered. Record viewport/Card00/header bounds in screen coordinates and the processed depths/cull state for viewport, card background, glyph, and relevant material/shader/pass readiness. Capture the native drawer PNG once at initial scroll, before scrolling or changing selection.

Then, in the same running session and without taking more screenshots:

1. At the pointer screen position, record `Mouse.current.position`, `EventSystem.current.RaycastAll` ordered hit identity, top selectable/card, and the card's bounds. The center of a visible card must resolve to that card. Probe a point inside a partially clipped card but outside the viewport; no clipped card may resolve as a hit there. Retain the points and full ordered hit identities.
2. At a visible card hit resolved by the current EventSystem, dispatch a nonzero wheel `PointerEventData` through `ExecuteEvents.ExecuteHierarchy<IScrollHandler>`. Record the resolved hit, expected handler (`BuildDrawer.Scroll.gameObject`), before/after `Scroll.verticalNormalizedPosition`, visible card screen bounds, and fixed title/count/Close bounds. This is a hit-resolved routed synthetic event, not a physical-wheel claim; do not assign ScrollRect position or call `ScrollRect.OnScroll` directly. Re-run the hit probes after the scroll. The card/content must move, the three header bounds stay fixed (≤1 screen px tolerance after layout), and the outside-viewport point remains rejected.
3. Resolve a different visible card with `EventSystem.current.RaycastAll`, then dispatch its pointer-click handler through the event route (`ExecuteEvents.ExecuteHierarchy<IPointerClickHandler>` on the resolved hit). Do not invoke `Button.onClick`, `Button.OnPointerClick`, or the private selection method directly. Record ordered hit, public `SelectedIndex`, selected Image color, and `SelectionDetail` text change. This is a hit-resolved routed synthetic event, not a physical-click claim.
4. Resolve and route a pointer-click to the visible Close control; confirm drawer hidden and global header actions restored. Reopen through the same hit-resolved routed pointer-click on Build Details. Confirm scroll position and selected index persist, title/count/Close return, and active graphics remain processed/unculled. Restore initial scroll after recording if the session needs cleanup.

Log the routed interaction observations and UI states in the existing JSON/receipt associated with capture 2; do not modify the original captured PNG after writing it. Retain each ordered RaycastAll result, event data position/delta/button, resolved target and handler, plus resulting UI state. These prove a public routed event from a rendered hit and its observed effect; they do not establish hardware-input provenance. Do not report the synthetic routed event as physical input.

### 3. HUD 1280 × 720, text 150 / mini 125

Capture the staged HUD mode at the native 1280 × 720 dimensions after settings settle and frame/tick advancement. Verify usable HUD rails/corners and controls fit the screen, text has no unexpected truncation/overflow, and mini control scale is the requested value. This remains the HUD, not an open-drawer case. Use the same exact-source/readiness/capture metadata as capture 1.

## Public observability limits

The package `PointerInputModule.GetLastPointerEventData` is protected, so the current UI module does not expose its last processed pointer event publicly. `EventSystem.RaycastAll` is public and provides the required sorted rendered-hit query; the contract then requires dispatching the routed wheel and pointer-click events from those resolved hits with `ExecuteEvents`. Record them as public event-dispatch checks, not physical mouse input. CUA may focus/preset the Game pane, but physical hardware provenance is outside this proof. Capture the Unity Game output at the exact configured resolution, not an IAB-upscaled view.

The editor-only EditMode assertions in this cut remain useful geometry/filter/callback checks but cannot clear the native gate. Likewise, `Graphic.depth >= 0`, `CanvasRenderer.cull == false`, and material/pass metadata are readiness facts, not visual acceptance. Preserve actual original PNGs and report any missing processed depth, mask rejection, or visual occlusion as a failure. No browser/network, accessibility, or performance claim follows from this bounded offline review.
