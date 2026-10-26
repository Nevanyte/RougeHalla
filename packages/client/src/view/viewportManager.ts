// Applies the pure layout (view/viewport.ts) to the page and to Phaser, and keeps both in step with the window.
//
// Phaser runs in NONE scale mode: its canvas backing store is the stage's size in device pixels (stage x dpr) and stage.css
// sizes the canvas element to the stage in CSS pixels, so ScaleManager.displayScale (backing / CSS) is what turns a mouse
// position into canvas pixels. Every camera then zooms by `layout.zoom` (device pixels per projected world pixel).
//
// A change is applied from Phaser's own `prestep`, ahead of the scenes' update and the frame's render: resizing a canvas
// clears it, so doing it from a separate animation frame that runs after Phaser's would flash an empty frame while a window
// is dragged. A requestAnimationFrame stays as the fallback for when the game loop is not running.
import { getSettings, onSettingsChange } from "../settings";
import { computeLayout, layoutsEqual, textResolution, UI_NARROW_W, UI_SHORT_H, type ViewLayout } from "./viewport";
import { setView } from "./viewState";

/** The slice of Phaser's event emitter used here, so a test can pass a fake. */
interface Emitter {
  on(event: string, fn: (...args: any[]) => void): unknown;
  once(event: string, fn: (...args: any[]) => void): unknown;
}

/** A Phaser Text, as far as the resolution pass needs. */
export interface ViewportText {
  type: string;
  style: { resolution: number };
  setResolution(value: number): unknown;
  once(event: string, fn: () => void): unknown;
}

/** A display list entry; a Container or Layer also holds a `list` of its own. */
interface DisplayObject {
  type?: string;
  list?: unknown;
}

export interface ViewportScene {
  sys: { events: Emitter };
  cameras?: { main?: { zoom: number } };
  children?: { list: ReadonlyArray<unknown> };
}

export interface ViewportGame {
  isBooted: boolean;
  scale: { width: number; height: number; resize(width: number, height: number): unknown; refresh(): unknown };
  events: Emitter;
  scene: { scenes: ReadonlyArray<ViewportScene> };
}

/** The window as it is now, as a layout. Also what the Game config is sized from. */
export function measureLayout(): ViewLayout {
  return computeLayout({
    cssW: window.innerWidth, cssH: window.innerHeight, dpr: window.devicePixelRatio, hiDpi: getSettings().hiDpi,
  });
}

/** Up to three decimals, so the CSS variables stay short and an unchanged value reads the same. */
function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

export class ViewportManager {
  private layout: ViewLayout | null = null;
  private dirty = false;
  private raf: number | null = null;
  private destroyed = false;
  private dprQuery: MediaQueryList | null = null;
  private readonly cleanups: Array<() => void> = [];
  private readonly bound = new WeakSet<object>();
  /** Every Text seen on a scene's display list that is still alive (pooled ones included). */
  private readonly texts = new Set<ViewportText>();

  constructor(
    private readonly game: ViewportGame,
    private readonly stageEl: HTMLElement = document.getElementById("stage")!,
  ) {
    this.apply(true);
    this.listen(window, "resize");
    this.listen(window, "orientationchange");
    if (window.visualViewport) this.listen(window.visualViewport, "resize");
    this.listen(document, "fullscreenchange");
    this.listen(document, "webkitfullscreenchange");
    this.watchDpr();
    this.cleanups.push(onSettingsChange((_settings, changed) => {
      if (changed.includes("hiDpi")) this.schedule();
    }));
    game.events.on("prestep", this.onPreStep);
    // Like window.__raid: a handle for checking the sizes in a real browser.
    if (import.meta.env.DEV && import.meta.env.MODE !== "test") (window as unknown as Record<string, unknown>).__view = { game, manager: this };
    // The size and the scenes' cameras are only known once the game has booted.
    if (!game.isBooted) game.events.once("boot", () => { if (!this.destroyed) this.apply(true); });
  }

  /** The layout last applied. */
  get current(): ViewLayout {
    return this.layout!;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.dprQuery?.removeEventListener("change", this.onDprChange);
    this.dprQuery = null;
    for (const undo of this.cleanups.splice(0)) undo();
    this.texts.clear();
  }

  private listen(target: EventTarget, type: string): void {
    target.addEventListener(type, this.schedule);
    this.cleanups.push(() => target.removeEventListener(type, this.schedule));
  }

  /** Re-measure soon. Any number of events before the next frame cost one apply. */
  private readonly schedule = (): void => {
    if (this.destroyed) return;
    this.dirty = true;
    if (this.raf !== null) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      if (this.dirty) this.flush();
    });
  };

  private flush(): void {
    this.dirty = false;
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.apply(false);
  }

  private readonly onPreStep = (): void => {
    if (this.destroyed) return;
    if (this.dirty) this.flush();
    this.syncScenes();
  };

  /** The page's pixel density changed (browser zoom, another monitor): the query is for one ratio, so arm a new one. */
  private readonly onDprChange = (): void => {
    this.watchDpr();
    this.schedule();
  };

  private watchDpr(): void {
    this.dprQuery?.removeEventListener("change", this.onDprChange);
    this.dprQuery = null;
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", this.onDprChange);
    this.dprQuery = query;
  }

  private apply(force: boolean): void {
    const next = measureLayout();
    if (!force && this.layout && layoutsEqual(this.layout, next)) return;
    this.layout = next;
    this.writeDom(next);
    this.resizeGame(next);
    this.syncScenes();
    setView(next);
  }

  private writeDom(layout: ViewLayout): void {
    const box = this.stageEl.style;
    box.left = `${layout.stage.x}px`;
    box.top = `${layout.stage.y}px`;
    box.width = `${layout.stage.w}px`;
    box.height = `${layout.stage.h}px`;
    const root = document.documentElement;
    root.style.setProperty("--ui-scale", fmt(layout.uiScale));
    root.style.setProperty("--ui-w", `${fmt(layout.uiW)}px`);
    root.style.setProperty("--ui-h", `${fmt(layout.uiH)}px`);
    this.flag(root, "data-ui-short", layout.uiH < UI_SHORT_H);
    this.flag(root, "data-ui-narrow", layout.uiW < UI_NARROW_W);
  }

  private flag(node: HTMLElement, name: string, on: boolean): void {
    if (on) node.setAttribute(name, "");
    else node.removeAttribute(name);
  }

  private resizeGame(layout: ViewLayout): void {
    if (!this.game.isBooted) return;
    const scale = this.game.scale;
    // Assigning canvas.width clears the canvas even to the same value, so a move of the stage alone only re-reads its bounds.
    if (scale.width !== layout.deviceW || scale.height !== layout.deviceH) scale.resize(layout.deviceW, layout.deviceH);
    else scale.refresh();
  }

  // ------------------------------------------------------------------------------------------ cameras and text

  /** Every scene's camera at the layout's zoom, whichever scene starts or restarts, and Text at the matching resolution. */
  private syncScenes(): void {
    const layout = this.layout;
    if (!layout) return;
    for (const scene of this.game.scene.scenes) {
      if (!this.bound.has(scene)) this.bind(scene);
      this.fitCamera(scene);
    }
    const resolution = textResolution(layout.zoom);
    for (const text of this.texts) {
      if (text.style.resolution !== resolution) text.setResolution(resolution);
    }
  }

  private fitCamera(scene: ViewportScene): void {
    const camera = scene.cameras?.main;
    if (camera && this.layout && camera.zoom !== this.layout.zoom) camera.zoom = this.layout.zoom;
  }

  private bind(scene: ViewportScene): void {
    this.bound.add(scene);
    // "ready" comes after the cameras plugin has made a started scene's camera and before its create() runs, so the scene
    // never builds or draws a frame at zoom 1.
    scene.sys.events.on("ready", () => this.fitCamera(scene));
    scene.sys.events.on("addedtoscene", this.onAdded);
    // A scene that started before this manager existed (the hub builds itself when the game boots) has Text already.
    if (scene.children) this.adopt(scene.children.list);
  }

  private adopt(list: ReadonlyArray<unknown>): void {
    for (const entry of list) {
      const object = entry as DisplayObject;
      if (object.type === "Text") this.onAdded(object as ViewportText);
      else if (Array.isArray(object.list)) this.adopt(object.list);
    }
  }

  private readonly onAdded = (object: ViewportText): void => {
    if (object.type !== "Text" || this.texts.has(object) || !this.layout) return;
    this.texts.add(object);
    object.once("destroy", () => { this.texts.delete(object); });
    const resolution = textResolution(this.layout.zoom);
    if (object.style.resolution !== resolution) object.setResolution(resolution);
  };
}
