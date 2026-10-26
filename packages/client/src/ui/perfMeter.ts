// The corner readout "144 fps · 32 ms". FPS is counted from requestAnimationFrame over half-second windows and smoothed; ping
// is the Colyseus room's own PING round trip, asked every 2 s while a room is connected. Both are driven from the one frame
// loop, which only runs while a number is shown, and the DOM is written only when a number or its colour class changes.
import { settings as appSettings, type Settings } from "../settings";
import { el } from "./dom";

export const FPS_WINDOW_MS = 500;
/** A frame this long after the last one means the tab was hidden or stalled: that window says nothing about the frame rate. */
export const FPS_GAP_MS = 1000;
/** Weight of the newest window in the smoothed FPS. */
export const FPS_SMOOTHING = 0.5;
export const PING_EVERY_MS = 2000;
/** No reply by now: show "--" (a closed or stalled socket never answers). A late reply still shows if no newer ping went out. */
export const PING_TIMEOUT_MS = 4000;
export const PING_GOOD_MS = 50;
export const PING_WARN_MS = 100;
export const FPS_GOOD = 50;
export const FPS_WARN = 30;

export type PerfTone = "good" | "warn" | "bad" | "idle";

export function pingTone(ms: number | null): PerfTone {
  if (ms === null) return "idle";
  return ms < PING_GOOD_MS ? "good" : ms < PING_WARN_MS ? "warn" : "bad";
}

export function fpsTone(fps: number | null): PerfTone {
  if (fps === null) return "idle";
  return fps >= FPS_GOOD ? "good" : fps >= FPS_WARN ? "warn" : "bad";
}

export function formatFps(fps: number | null): string {
  return fps === null ? "-- fps" : `${Math.round(fps)} fps`;
}

/** Capped so the readout never grows wider than three digits. */
export function formatPing(ms: number | null): string {
  if (ms === null) return "-- ms";
  const rounded = Math.round(ms);
  return rounded > 999 ? "999+ ms" : `${rounded} ms`;
}

/** The whole readout as text; a part that is switched off is left out, and both off gives "". */
export function formatPerf(fps: number | null, ping: number | null, show: { fps: boolean; ping: boolean } = { fps: true, ping: true }): string {
  const parts: string[] = [];
  if (show.fps) parts.push(formatFps(fps));
  if (show.ping) parts.push(formatPing(ping));
  return parts.join(" · ");
}

/** Counts animation frames. Feed it every frame's timestamp; it answers with a new smoothed FPS each time a window closes. */
export class FpsCounter {
  private windowStart = -1;
  private frames = 0;
  private lastFrame = -1;
  private smoothed: number | null = null;

  frame(now: number): number | null {
    if (this.lastFrame >= 0 && now - this.lastFrame > FPS_GAP_MS) this.windowStart = -1;
    this.lastFrame = now;
    if (this.windowStart < 0) {
      this.windowStart = now;
      this.frames = 0;
      return null;
    }
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < FPS_WINDOW_MS) return null;
    const fps = (this.frames * 1000) / elapsed;
    this.smoothed = this.smoothed === null ? fps : this.smoothed + (fps - this.smoothed) * FPS_SMOOTHING;
    this.windowStart = now;
    this.frames = 0;
    return this.smoothed;
  }

  /** Forget everything (the readout was switched off for a while). */
  reset(): void {
    this.windowStart = -1;
    this.frames = 0;
    this.lastFrame = -1;
    this.smoothed = null;
  }
}

/** The slice of a Colyseus room the probe uses (`connection.isOpen` is false once the socket is closed or mid-reconnect). */
export interface PingRoom {
  ping(callback: (ms: number) => void): void;
  connection?: { isOpen?: boolean } | null;
}

/** Asks the current room for its ping every PING_EVERY_MS. `value` is null with no room, no open socket or no reply. */
export class PingProbe {
  value: number | null = null;
  private room: PingRoom | null = null;
  private nextAt = 0;
  /** When the ping in flight was sent; -1 = none. */
  private sentAt = -1;
  /** Replies from an earlier ping or an earlier room are ignored. */
  private seq = 0;

  constructor(private readonly getRoom: () => PingRoom | null) {}

  tick(now: number): void {
    const room = this.getRoom();
    if (room !== this.room) {
      this.room = room;
      this.seq++;
      this.sentAt = -1;
      this.value = null;
      this.nextAt = now;
    }
    if (!room || room.connection?.isOpen === false) {
      this.seq++;
      this.sentAt = -1;
      this.value = null;
      return;
    }
    if (this.sentAt >= 0) {
      if (now - this.sentAt >= PING_TIMEOUT_MS) {
        this.sentAt = -1;
        this.value = null;
      }
      return;
    }
    if (now < this.nextAt) return;
    const seq = ++this.seq;
    this.sentAt = now;
    this.nextAt = now + PING_EVERY_MS;
    try {
      room.ping((ms) => {
        if (seq !== this.seq) return;
        this.sentAt = -1;
        this.value = Number.isFinite(ms) ? Math.max(0, ms) : null;
      });
    } catch {
      this.sentAt = -1;
      this.value = null;
    }
  }

  reset(): void {
    this.room = null;
    this.seq++;
    this.sentAt = -1;
    this.value = null;
    this.nextAt = 0;
  }
}

/** What the meter reads and subscribes to; the app-wide SettingsStore fits, and so does a test's stand-in. */
export interface PerfSettings {
  get(): Readonly<Pick<Settings, "showFps" | "showPing">>;
  subscribe(cb: () => void): () => void;
}

export interface PerfMeterOptions {
  room: () => PingRoom | null;
  settings?: PerfSettings;
  requestFrame?: (cb: (t: number) => void) => number;
  cancelFrame?: (id: number) => void;
}

export class PerfMeter {
  readonly element = el("div", "perf");
  private readonly fpsEl = el("span", "perf-fps perf-idle", formatFps(null));
  private readonly sepEl = el("span", "perf-sep", "·");
  private readonly pingEl = el("span", "perf-ping perf-idle", formatPing(null));
  private readonly counter = new FpsCounter();
  private readonly probe: PingProbe;
  private readonly settings: PerfSettings;
  private readonly requestFrame: (cb: (t: number) => void) => number;
  private readonly cancelFrame: (id: number) => void;
  private readonly unsubscribe: () => void;
  private showFps = false;
  private showPing = false;
  private frameId: number | null = null;
  /** What the DOM shows now, so a frame that changes nothing writes nothing. */
  private fps: number | null = null;
  private ping: number | null = null;
  private fpsText = formatFps(null);
  private pingText = formatPing(null);
  private fpsTone: PerfTone = "idle";
  private pingToneShown: PerfTone = "idle";

  constructor(options: PerfMeterOptions) {
    this.probe = new PingProbe(options.room);
    this.settings = options.settings ?? { get: () => appSettings.get(), subscribe: (cb) => appSettings.subscribe(() => cb()) };
    this.requestFrame = options.requestFrame ?? ((cb) => window.requestAnimationFrame(cb));
    this.cancelFrame = options.cancelFrame ?? ((id) => window.cancelAnimationFrame(id));
    this.element.setAttribute("aria-hidden", "true");
    this.element.append(this.fpsEl, this.sepEl, this.pingEl);
    this.apply();
    this.unsubscribe = this.settings.subscribe(() => this.apply());
  }

  /** Whether the frame loop is running (it is only while a number is shown). */
  get running(): boolean {
    return this.frameId !== null;
  }

  destroy(): void {
    this.unsubscribe();
    this.stop();
    this.element.remove();
  }

  private apply(): void {
    const s = this.settings.get();
    this.showFps = s.showFps;
    this.showPing = s.showPing;
    const any = this.showFps || this.showPing;
    if (this.element.hidden === any) this.element.hidden = !any;
    if (this.fpsEl.hidden === this.showFps) this.fpsEl.hidden = !this.showFps;
    if (this.pingEl.hidden === this.showPing) this.pingEl.hidden = !this.showPing;
    const both = this.showFps && this.showPing;
    if (this.sepEl.hidden === both) this.sepEl.hidden = !both;
    if (any) this.start();
    else this.stop();
  }

  private start(): void {
    if (this.frameId !== null) return;
    this.frameId = this.requestFrame(this.onFrame);
  }

  private stop(): void {
    if (this.frameId !== null) this.cancelFrame(this.frameId);
    this.frameId = null;
    this.counter.reset();
    this.probe.reset();
    this.fps = null;
    this.ping = null;
    this.paint();
  }

  private readonly onFrame = (now: number): void => {
    this.frameId = this.requestFrame(this.onFrame);
    if (this.showFps) {
      const fps = this.counter.frame(now);
      if (fps !== null) this.fps = fps;
    }
    if (this.showPing) {
      this.probe.tick(now);
      this.ping = this.probe.value;
    }
    this.paint();
  };

  private paint(): void {
    const fpsText = formatFps(this.fps);
    if (fpsText !== this.fpsText) {
      this.fpsText = fpsText;
      this.fpsEl.textContent = fpsText;
      const tone = fpsTone(this.fps === null ? null : Math.round(this.fps));
      if (tone !== this.fpsTone) {
        this.fpsTone = tone;
        this.fpsEl.className = `perf-fps perf-${tone}`;
      }
    }
    const pingText = formatPing(this.ping);
    if (pingText !== this.pingText) {
      this.pingText = pingText;
      this.pingEl.textContent = pingText;
      const tone = pingTone(this.ping === null ? null : Math.round(this.ping));
      if (tone !== this.pingToneShown) {
        this.pingToneShown = tone;
        this.pingEl.className = `perf-ping perf-${tone}`;
      }
    }
  }
}
