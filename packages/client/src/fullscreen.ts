// Fullscreen for the whole page (the canvas and the DOM overlay together), through the standard API with the WebKit-prefixed
// fallbacks (iPad, older Safari). An iPhone has neither: fullscreenSupported() is false there and the UI says so instead of
// failing. Every function takes the document as an argument so a test can pass a fake.

type FullscreenCall = (options?: { navigationUI?: "hide" | "show" | "auto" }) => Promise<void> | void;

export interface FullscreenTarget {
  requestFullscreen?: FullscreenCall;
  webkitRequestFullscreen?: FullscreenCall;
}

export interface FullscreenDoc {
  documentElement: FullscreenTarget;
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  exitFullscreen?(): Promise<void> | void;
  webkitExitFullscreen?(): Promise<void> | void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** The change events, standard first. */
export const FULLSCREEN_EVENTS: readonly string[] = ["fullscreenchange", "webkitfullscreenchange"];

/** Whether this browser can take the page fullscreen at all (false on an iPhone, or inside an iframe that may not). */
export function fullscreenSupported(doc: FullscreenDoc = document): boolean {
  const root = doc.documentElement;
  if (typeof root.requestFullscreen !== "function" && typeof root.webkitRequestFullscreen !== "function") return false;
  // `fullscreenEnabled` is false when the page is not allowed to (a sandboxed frame) and undefined where only the prefix exists.
  return (doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled) !== false;
}

/** Fullscreen through the API. F11 (the browser's own) is not visible to the page. */
export function isFullscreen(doc: FullscreenDoc = document): boolean {
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/**
 * Enters fullscreen, or leaves it if the page is in it. True when the browser accepted the request, false when fullscreen is
 * unsupported, was refused (no user gesture, a policy) or threw. The request is issued before the first await, so it still
 * runs inside the key press or click that asked for it, which browsers require.
 */
export async function toggleFullscreen(doc: FullscreenDoc = document): Promise<boolean> {
  if (!fullscreenSupported(doc)) return false;
  try {
    if (isFullscreen(doc)) {
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      if (typeof exit !== "function") return false;
      await exit.call(doc);
    } else {
      const root = doc.documentElement;
      if (typeof root.requestFullscreen === "function") await root.requestFullscreen({ navigationUI: "hide" });
      else if (typeof root.webkitRequestFullscreen === "function") await root.webkitRequestFullscreen();
      else return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Calls `cb` when the page enters or leaves fullscreen, whoever caused it (the button, Esc, the browser). Returns the unsubscribe. */
export function onFullscreenChange(cb: () => void, doc: FullscreenDoc = document): () => void {
  for (const type of FULLSCREEN_EVENTS) doc.addEventListener(type, cb);
  return () => { for (const type of FULLSCREEN_EVENTS) doc.removeEventListener(type, cb); };
}

/** The fullscreen functions as one object, so the settings panel and the chrome can be handed a stand-in. */
export interface FullscreenApi {
  supported(): boolean;
  active(): boolean;
  toggle(): Promise<boolean>;
  onChange(cb: () => void): () => void;
}

export function documentFullscreen(): FullscreenApi {
  return {
    supported: () => fullscreenSupported(),
    active: () => isFullscreen(),
    toggle: () => toggleFullscreen(),
    onChange: (cb) => onFullscreenChange(cb),
  };
}
