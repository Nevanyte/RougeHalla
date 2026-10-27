// Per-browser player settings. Saved in localStorage (every access is wrapped: a private window, blocked site data or a
// full quota must never break the game), read once at startup and re-saved on each change. Everything here is
// presentation only; nothing is sent to the server.

export interface Settings {
  /** Juice / animation intensity: 0 = off, 1 = as designed. */
  juice: number;
  /** Forces the "motion" kind of juice off (the OS's prefers-reduced-motion does too, on its own). */
  reducedMotion: boolean;
  showFps: boolean;
  showPing: boolean;
  /** Render the canvas at the screen's own pixel density (capped at 2x). Off = 1 canvas pixel per CSS pixel: faster, softer. */
  hiDpi: boolean;
  /** Draw the route planned on the planning screen on the minimap and the hold-Tab map during a run. */
  showRoute: boolean;
  /** Text size of the map and planning screens, one of TEXT_SCALES (1 = as designed). */
  textScale: number;
}

/** The text sizes the settings card offers: 100%, 125% and 150%. */
export const TEXT_SCALES: readonly number[] = [1, 1.25, 1.5];

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  juice: 1,
  reducedMotion: false,
  showFps: true,
  showPing: true,
  hiDpi: true,
  showRoute: true,
  textScale: 1,
});

export const SETTINGS_KEY = "raidbr.settings.v1";
export const JUICE_MAX = 1;

/** The slice of Storage this module uses, so a test can pass a fake. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** The offered text size nearest `v`; the fallback for anything that is not a finite number. */
function nearestScale(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return TEXT_SCALES.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), TEXT_SCALES[0]!);
}

/** Anything (a parsed file, a patch) turned into a complete, valid Settings: unknown keys dropped, bad values defaulted. */
export function sanitizeSettings(raw: unknown, base: Readonly<Settings> = DEFAULT_SETTINGS): Settings {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const juice = typeof o.juice === "number" && Number.isFinite(o.juice) ? Math.min(JUICE_MAX, Math.max(0, o.juice)) : base.juice;
  return {
    juice,
    reducedMotion: bool(o.reducedMotion, base.reducedMotion),
    showFps: bool(o.showFps, base.showFps),
    showPing: bool(o.showPing, base.showPing),
    hiDpi: bool(o.hiDpi, base.hiDpi),
    showRoute: bool(o.showRoute, base.showRoute),
    textScale: nearestScale(o.textScale, base.textScale),
  };
}

function defaultStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The saved settings, or the defaults when nothing usable is saved or storage is unavailable. */
export function loadSettings(storage: SettingsStorage | null = defaultStorage()): Settings {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    if (text) return sanitizeSettings(JSON.parse(text));
  } catch {
    /* unreadable or blocked: fall through to the defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

/** Best effort: returns whether the write went through. */
export function saveSettings(settings: Settings, storage: SettingsStorage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

type Listener = (settings: Readonly<Settings>, changed: ReadonlyArray<keyof Settings>) => void;

/** The live settings. Holds the current value, saves on every change and tells the subscribers which keys moved. */
export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly storage: SettingsStorage | null = defaultStorage()) {
    this.value = loadSettings(storage);
  }

  get(): Readonly<Settings> {
    return this.value;
  }

  /** Merges a (partial, possibly untrusted) patch. Returns the keys that actually changed. */
  update(patch: Partial<Settings>): ReadonlyArray<keyof Settings> {
    const next = sanitizeSettings({ ...this.value, ...patch }, this.value);
    const changed = (Object.keys(next) as Array<keyof Settings>).filter((k) => next[k] !== this.value[k]);
    if (changed.length === 0) return changed;
    this.value = next;
    saveSettings(next, this.storage);
    for (const cb of [...this.listeners]) cb(next, changed);
    return changed;
  }

  reset(): void {
    this.update({ ...DEFAULT_SETTINGS });
  }

  /** Calls `cb` after each change (not now). Returns the unsubscribe. */
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
}

/** The app-wide store. */
export const settings = new SettingsStore();

export function getSettings(): Readonly<Settings> {
  return settings.get();
}

export function updateSettings(patch: Partial<Settings>): ReadonlyArray<keyof Settings> {
  return settings.update(patch);
}

export function onSettingsChange(cb: Listener): () => void {
  return settings.subscribe(cb);
}
