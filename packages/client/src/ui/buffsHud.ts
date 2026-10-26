// The build strip under the vitals: one chip per buff the player holds (a mob type's buff, shared/buffs.ts), then the feed line
// that explains why mob rewards fall. A chip is the zone's marker shape in the zone's colour (never colour alone), the mob
// type's name, the stacks held, what they give now and what the next kill of that type adds; pointing at it shows the full
// wording and the matchup tags (buffTip.ts). The strip never takes the pointer (right-click moves and left-click locks must
// work under it, and the aim keeps streaming), so the tooltip is found by hit-testing the pointer against the chips' rectangles.
// It only reads the synced state and touches the DOM when a displayed value changes; Hud places `root` and calls update()
// every frame.
import {
  BUFFS, buffView, feedView, formatGain, hasAnyBuffs, lobbyMedianFeed, stacksIn, type BuffStacks, type BuffView,
} from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { getSettings } from "../settings";
import { ELITE_COLOR, buffColor } from "./buffTheme";
import { tipText } from "./buffTip";
import "./buffsHud.css";
import { cssColor, el } from "./dom";
import { zoneClipPath } from "./mapPainter";
import { osPrefersReducedMotion, reducedMotionActive } from "./settingsPanel";

/** Shown while a living player in a run with mobs holds no buff yet. */
export const EMPTY_HINT = "No buffs yet: each mob type you kill gives its own";
/** The marker on a chip whose effect the server does not apply yet. */
export const COMING_MARK = "(coming)";
/** With more buffs than this the chips shrink to one line each (the value moves into the tooltip). */
export const DENSE_AFTER = 6;
/** How long the chip's flash runs: the `buff-pop` animation in buffsHud.css. */
export const POP_MS = 600;
/** The flash class is taken off at the latest this long after it was put on, in case `animationend` never comes (a hidden tab). */
const POP_FALLBACK_MS = POP_MS + 100;
/** The class that shows a chip's tooltip while the pointer is over it. */
export const TIP_ON = "tip-on";

export interface BuffsHudOptions {
  /** Whether the flash is off (reduced motion, by the settings or the system). A test passes its own. */
  reducedMotion?: () => boolean;
}

const defaultReducedMotion = (): boolean => reducedMotionActive(getSettings(), osPrefersReducedMotion());

interface ChipView {
  root: HTMLElement;
  stacks: HTMLElement;
  gain: HTMLElement;
  value: HTMLElement;
  coming: HTMLElement;
  tip: HTMLElement;
  /** What the chip shows now, so an unchanged frame touches nothing. */
  key: string;
  /** The stacks it was painted for, to tell a rise (a short flash) from a fall. */
  stacksShown: number;
  /** The timer that takes the flash class off if `animationend` does not. */
  popTimer: ReturnType<typeof setTimeout> | null;
}

/** A chip's rectangle in client pixels, or null while the chip is hidden. */
interface ChipRect { left: number; top: number; right: number; bottom: number }

export class BuffsHud {
  readonly root = el("div", "hud-buffs");
  /** One chip per catalog buff, in catalog order (zone order, normals then the elite); a chip is hidden until its buff is held. */
  private readonly strip = el("div", "buff-strip");
  private readonly chips: ChipView[] = [];
  private readonly empty = el("div", "buff-empty", EMPTY_HINT);
  private readonly feed = el("div", "hud-feed");
  private stripShown = true;
  private emptyShown = true;
  private feedShown = true;
  /** The stacks and reward the chips were last laid out for (a cheap gate: a frame that changes none of them paints nothing). */
  private readonly lastStacks: number[] = [];
  private lastReward = Number.NaN;
  private lastGainShown: boolean | null = null;
  private dense = false;
  private lastFeed = "";
  /** A regional mob has been in the state: the feed line and the next-kill gain only mean something where mobs pay out. */
  private mobsSeen = false;
  private readonly reducedMotion: () => boolean;
  /** The chip whose tooltip shows (the pointer is over it), -1 for none. */
  private tipAt = -1;
  /** The chips' rectangles, kept until the strip repaints, resizes or moves (the pointer moves far more often than that). */
  private rects: Array<ChipRect | null> = [];
  private rectsDirty = true;
  private rectsKey = "";

  constructor(options: BuffsHudOptions = {}) {
    this.reducedMotion = options.reducedMotion ?? defaultReducedMotion;
    for (const def of BUFFS) {
      const root = el("div", def.elite ? "buff-chip elite" : "buff-chip");
      root.style.setProperty("--c", cssColor(buffColor(def.id)));
      root.style.setProperty("--zone-clip", zoneClipPath(def.zone));
      if (def.elite) root.style.setProperty("--elite", cssColor(ELITE_COLOR));
      const glyph = el("span", "buff-glyph");
      const name = el("span", "buff-name", def.name);
      const stacks = el("span", "buff-stacks");
      const gain = el("span", "buff-gain");
      const value = el("span", "buff-value");
      const coming = el("span", "buff-coming", COMING_MARK);
      const tip = el("div", "buff-tip");
      coming.hidden = true;
      root.append(glyph, name, stacks, gain, value, coming, tip);
      root.hidden = true;
      this.strip.append(root);
      const chip: ChipView = { root, stacks, gain, value, coming, tip, key: "", stacksShown: 0, popTimer: null };
      root.addEventListener("animationend", (e: AnimationEvent) => {
        if (!e.animationName || e.animationName === "buff-pop") this.clearPop(chip);
      });
      this.chips.push(chip);
      this.lastStacks.push(0);
    }
    this.root.append(this.strip, this.empty, this.feed);
    this.setStripShown(false);
    this.setEmptyShown(false);
    this.setFeedShown(false);
    this.root.hidden = true;
    if (typeof window !== "undefined") {
      // The strip is click-through, so the tooltip follows the pointer on the window (passive: it never holds back a scroll or a click).
      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      window.addEventListener("pointerout", this.onPointerOut, { passive: true });
      window.addEventListener("blur", this.hideTip);
      window.addEventListener("keydown", this.onKey);
      window.addEventListener("resize", this.invalidateRects);
    }
  }

  update(state: RaidState, me: PlayerState | undefined): void {
    const alive = me?.status === "alive";
    if (!this.mobsSeen) this.mobsSeen = hasRegionalMobs(state);
    // A server that predates the buffs map leaves it undefined: nothing held.
    const held = me?.buffs ?? NO_BUFFS;
    const any = alive && hasAnyBuffs(held);
    const showFeed = alive && this.mobsSeen && state.phase === "active";
    this.setStripShown(any);
    this.setEmptyShown(alive && !any && this.mobsSeen && state.phase === "active");

    const feed = (any || showFeed) && me ? feedView(me.kills, me.mobKills, lobbyMedianFeed(state.players.values())) : null;
    if (any && feed) this.paintChips(held, feed.reward);
    else this.lastReward = Number.NaN;

    this.setFeedShown(showFeed);
    if (showFeed && feed && feed.line !== this.lastFeed) {
      this.lastFeed = feed.line;
      this.feed.textContent = feed.line;
    }
    this.root.hidden = !this.stripShown && !this.emptyShown && !this.feedShown;
    // A tooltip must not outlive its chip (the buff fell to nothing) or the strip (death, a new room).
    if (this.tipAt >= 0 && (!this.stripShown || this.chips[this.tipAt]!.root.hidden)) this.hideTip();
  }

  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerout", this.onPointerOut);
      window.removeEventListener("blur", this.hideTip);
      window.removeEventListener("keydown", this.onKey);
      window.removeEventListener("resize", this.invalidateRects);
    }
    for (const chip of this.chips) {
      if (chip.popTimer !== null) clearTimeout(chip.popTimer);
      chip.popTimer = null;
    }
    this.root.remove();
  }

  // ------------------------------------------------------------------------------------------------------ the tooltip

  private readonly invalidateRects = (): void => {
    this.rectsDirty = true;
  };

  /** The chip under the client point, or -1. The rectangles are read again only when the strip repainted, resized or moved. */
  private chipAt(x: number, y: number): number {
    const s = this.strip.getBoundingClientRect();
    const key = `${s.left},${s.top},${s.width},${s.height}`;
    if (this.rectsDirty || key !== this.rectsKey) {
      this.rectsKey = key;
      this.rectsDirty = false;
      this.rects = this.chips.map((c) => {
        if (c.root.hidden) return null;
        const r = c.root.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height };
      });
    }
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      if (r && x >= r.left && x < r.right && y >= r.top && y < r.bottom) return i;
    }
    return -1;
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.stripShown || !isWorldTarget(e.target)) {
      if (this.tipAt >= 0) this.hideTip();
      return;
    }
    this.setTip(this.chipAt(e.clientX, e.clientY));
  };

  /** The pointer left the page (no element takes its place). */
  private readonly onPointerOut = (e: PointerEvent): void => {
    if (!e.relatedTarget) this.hideTip();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code === "Escape" || e.key === "Escape") this.hideTip();
  };

  private readonly hideTip = (): void => {
    this.setTip(-1);
  };

  private setTip(i: number): void {
    if (i === this.tipAt) return;
    if (this.tipAt >= 0) this.chips[this.tipAt]!.root.classList.toggle(TIP_ON, false);
    this.tipAt = i;
    if (i >= 0) this.chips[i]!.root.classList.toggle(TIP_ON, true);
  }

  // ----------------------------------------------------------------------------------------------------------- the flash

  /** Starts the chip's flash again from its first frame; reduced motion shows none. */
  private flash(chip: ChipView): void {
    if (this.reducedMotion()) {
      this.clearPop(chip);
      return;
    }
    const cls = chip.root.classList;
    // A class that is already on does not restart its animation: take it off and force a reflow before putting it back.
    if (cls.contains("pop")) {
      cls.toggle("pop", false);
      void chip.root.offsetWidth;
    }
    cls.toggle("pop", true);
    if (chip.popTimer !== null) clearTimeout(chip.popTimer);
    chip.popTimer = setTimeout(() => this.clearPop(chip), POP_FALLBACK_MS);
  }

  private clearPop(chip: ChipView): void {
    if (chip.popTimer !== null) clearTimeout(chip.popTimer);
    chip.popTimer = null;
    chip.root.classList.toggle("pop", false);
  }

  /** Lays out the chips of the buffs held, but only those whose stacks (or the reward they are quoted at) moved. */
  private paintChips(held: BuffStacks, reward: number): void {
    const gainShown = this.mobsSeen;
    const all = reward !== this.lastReward || gainShown !== this.lastGainShown;
    this.lastReward = reward;
    this.lastGainShown = gainShown;
    let changed = false;
    BUFFS.forEach((def, i) => {
      const chip = this.chips[i]!;
      const stacks = stacksIn(held, def.id);
      if (!all && stacks === this.lastStacks[i]) return;
      changed = true;
      this.lastStacks[i] = stacks;
      if (!(stacks > 0)) {
        chip.root.hidden = true;
        chip.stacksShown = 0;
        chip.key = "";
        this.clearPop(chip);
        return;
      }
      const view = buffView(def.id, stacks, reward);
      if (view) this.paintChip(chip, view, gainShown);
    });
    if (!changed) return;
    this.rectsDirty = true;
    const dense = this.lastStacks.filter((n) => n > 0).length > DENSE_AFTER;
    if (dense !== this.dense) {
      this.dense = dense;
      this.strip.classList.toggle("dense", dense);
    }
  }

  private paintChip(chip: ChipView, view: BuffView, gainShown: boolean): void {
    chip.root.hidden = false;
    const gain = gainShown && view.nextGain > 0 ? `+${formatGain(view.nextGain)}` : "";
    const key = `${view.stacksText}|${view.text}|${gain}|${view.nextText}|${view.active ? 1 : 0}`;
    if (key === chip.key) return;
    chip.key = key;
    chip.stacks.textContent = view.stacksText;
    chip.gain.textContent = gain;
    chip.value.textContent = view.text;
    chip.coming.hidden = view.active;
    chip.root.classList.toggle("pending", !view.active);
    chip.tip.textContent = tipText(view, gainShown);
    // A short flash when the stacks rise; it comes off at the animation's end, so the next rise starts it again.
    if (view.stacks > chip.stacksShown) this.flash(chip);
    chip.stacksShown = view.stacks;
  }

  private setStripShown(shown: boolean): void {
    if (shown === this.stripShown) return;
    this.stripShown = shown;
    this.strip.hidden = !shown;
    this.rectsDirty = true;
  }

  private setEmptyShown(shown: boolean): void {
    if (shown === this.emptyShown) return;
    this.emptyShown = shown;
    this.empty.hidden = !shown;
  }

  private setFeedShown(shown: boolean): void {
    if (shown === this.feedShown) return;
    this.feedShown = shown;
    this.feed.hidden = !shown;
  }
}

const NO_BUFFS: Readonly<Record<string, number>> = {};

/** The pointer is over the world (the game canvas, which sits outside #ui), not over a panel or overlay of the interface. */
function isWorldTarget(target: EventTarget | null): boolean {
  const t = target as { closest?: (selector: string) => unknown } | null;
  return t !== null && !(typeof t.closest === "function" && t.closest("#ui"));
}

function hasRegionalMobs(state: RaidState): boolean {
  for (const m of state.mobs.values()) if (m.kind === "mob" || m.kind === "elite") return true;
  return false;
}
