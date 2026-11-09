# Capture and interaction plan — 6cdf89 gate

## Scope

This is a read-only plan for exactly three already-authorized native captures:

1. `HUD 1440 default`
2. `drawer 1440 default`
3. `HUD 720, text 150%, mini 125%`

No additional screenshots or Editor actions are proposed. Exercise the drawer interactions only in the drawer capture's running review session; take its PNG before changing selection or scroll state. Record post-capture interaction results in the existing JSON/receipt metadata so the raster remains a baseline.

## Source observations

- `MatchHud.Initialize` creates an Overlay Canvas with a GraphicRaycaster and Scale With Screen Size, reference resolution 1920×1080, match 0.5. It ensures one current EventSystem and an Input System UI module.
- `MythicUi.ScrollView` builds `ScrollRect → Viewport(Image + Mask) → Content`. The Mask has `showMaskGraphic=false`. Content is top anchored (min/max y=1), top pivot `(0.5, 1)`, two-column upper-left GridLayoutGroup, vertical ContentSizeFitter, and clamped vertical scrolling.
- `BuildDrawer` exposes `Scroll`, `Content`, `SelectedIndex`, `CardCount`, and `IsVisible`. It creates 80 cards. Its layout overrides the helper's initial cell to 210×220, spacing 10×10, padding 8 on each side; `LateUpdate` fits each column width to `max(152, (viewport.rect.width - 16 - 10 - 4) / 2)`. Text-scale changes set card height to `220 × textScale`.
- The drawer root is anchored at x=.57–.985, y=.025–.975. `DrawerTitle`, `CardCount`, and `Close` are direct children of the drawer root, above the scroll viewport (y=.245–.718). They are not descendants of Content and should remain fixed while cards move. `SelectionDetail` is another fixed drawer-root sibling below the viewport.
- The global `Help`, `Settings`, and `Leave` header actions are intentionally hidden while the drawer is open and made active again when it closes.

## Expected initial Card00 bounds

After Canvas/layout settles, find `Card00` under public `BuildDrawer.Content`. With top pivot and upper-left grid, its local grid cell should occupy:

- x: `[8, 8 + cellWidth]`
- y: `[-8 - cellHeight, -8]`
- `cellWidth = max(152, (viewport.rect.width - 30) / 2)`
- `cellHeight = 220 × current drawer textScale`

At default text scale, height is 220 Canvas units. Convert its four world corners through the actual Canvas scale factor to screen coordinates; don't hard-code screenshot pixels because the capture's physical dimensions and Canvas scaling determine those. The initial state should have verticalNormalizedPosition near 1, Card00 bounds intersecting the viewport, its center inside the viewport, and its visible image/glyph mesh nonempty. The public existing edit-mode coverage already asserts these layout conditions and Card00 raycastability.

## Public-only interaction sequence

Use the review's public `UiLayoutReview.Hud` reference; it provides the `MatchHud` component. Resolve the drawer via `Hud.GetComponent<BuildDrawer>()`. Do not reflect into fields or invoke private methods.

1. **Open by the real UI callback.** Resolve `MatchUI/PlayerHUD/BuildStrip/BuildDetails` as a public Transform path and call its `Button.onClick.Invoke()`. Assert `BuildDrawer.IsVisible`, global header buttons inactive, and drawer `DrawerTitle`, `CardCount`, and `Close` active.
2. **Baseline capture.** Capture the drawer 1440 default image before scrolling or selecting. Record screen bounds for the viewport, Card00, and the three fixed header controls in JSON.
3. **Wheel through EventSystem dispatch.** Choose a currently raycastable visible card under Content, create `PointerEventData(EventSystem.current)` with its on-screen position and nonzero `scrollDelta`, then use `EventSystem.current.RaycastAll` and `ExecuteEvents.ExecuteHierarchy<IScrollHandler>(hit.gameObject, data, ExecuteEvents.scrollHandler)`. The expected handler is `BuildDrawer.Scroll.gameObject`; `Scroll.verticalNormalizedPosition` and card screen bounds should change. The title/count/close bounds should remain unchanged (tolerance ≤1 screen pixel after layout settles). This follows the existing `BuildDrawerEditModeTests.DrawerViewportBuildsVisibleCardMeshesClipsHitsScrollsAndKeepsSelection` event path.
4. **Check clipping and card pass.** At the scrolled position, verify an intersecting partially clipped card is not raycastable in the portion outside the viewport, while a visible card still is. Confirm the viewport has its Image+Mask and that Card00's background Image and glyph Image build nonempty CanvasRenderer meshes; these are public properties/APIs used by the existing coverage. This distinguishes layout/raycast readiness from PNG appearance.
5. **Select through the Button listener.** Return to a visible card and invoke its `Button.onClick` (or dispatch the real pointer-click handler to its raycast target). Assert the public `SelectedIndex`, selected card background tint, and `SelectionDetail` text updated to the displayed catalog title. No card selection API beyond its configured Button callback is public.
6. **Verify hide and restore.** Invoke the drawer's `Close` Button callback; assert `IsVisible=false` and global Help/Settings/Leave become active. Reopen through `BuildDetails.onClick`; assert `IsVisible=true`, the fixed FIELD LEDGER header remains visible, and selection/scroll are preserved. Restore scroll to top before ending the review session. This is a behavior check, not another screenshot.

For the `HUD 720 / text 150% / mini 125%` capture, check the HUD rails/corners and control bounds only. Do not treat it as a drawer-header case; it has no drawer open.

## Evidence limits

The three captures can prove the rendered composition at those exact modes and scales. The public runtime interaction sequence can verify event routing, scroll movement/clipping, selection callback, and header visibility/restoration. A screenshot alone cannot prove those interactions. Neither source metadata nor this offline layout review establishes network/gameplay behavior.
