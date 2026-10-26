// The current ViewLayout as a tiny singleton: view/viewportManager.ts writes it when the window, the screen or fullscreen
// changes; the minimap, the HUD and the scenes read it (and subscribe) instead of measuring the window themselves.
import { computeLayout, layoutsEqual, type ViewLayout } from "./viewport";

function windowLayout(): ViewLayout {
  const w = typeof window === "undefined" ? undefined : window;
  return computeLayout({ cssW: w?.innerWidth ?? 1280, cssH: w?.innerHeight ?? 800, dpr: w?.devicePixelRatio ?? 1, hiDpi: true });
}

let current: ViewLayout = windowLayout();
const listeners = new Set<(layout: ViewLayout) => void>();

export function currentView(): ViewLayout {
  return current;
}

/** Stores a new layout and tells the subscribers, unless it changes nothing. Returns whether it did. */
export function setView(next: ViewLayout): boolean {
  if (layoutsEqual(current, next)) return false;
  current = next;
  for (const cb of [...listeners]) cb(next);
  return true;
}

/** Calls `cb` after each change (not now). Returns the unsubscribe. */
export function onViewChange(cb: (layout: ViewLayout) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
