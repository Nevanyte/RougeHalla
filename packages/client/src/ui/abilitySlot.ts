// The reusable cooldown widget for one ability slot: the Wish's today (key D, docked in the weapon bar), the Q and E skills' later.
// Three pieces. `abilitySlotModel` is pure: what the slot shows, from the synced state and the server clock. `CooldownTracker`
// finds the length of a cooldown from the ready time alone (the server syncs when it ends, not how long it was). `AbilitySlotView`
// is the DOM: an icon in the ability's colour, the key as a keycap, a dark wedge sweeping off as the cooldown runs, the seconds,
// a thin cast bar and a short deny line above it. The view writes only what changed, so calling it every frame costs nothing.
import {
  EFFECT_CASTING, EFFECT_ROOTED, EFFECT_SILENCED, EFFECT_STUNNED, rankOf, type AbilityDef, type AbilityIcon,
} from "@raid/shared";
import "./abilitySlot.css";
import { cssColor, el } from "./dom";
import { keycap } from "./keycap";

type Blocker = "stun" | "silence" | "root";

export interface AbilitySlotInput {
  /** `RaidState.phase`: the slot is shown only while the run is active. */
  phase: string;
  /** The local player is alive. */
  alive: boolean;
  /** What is in the slot (`abilityInSlot`), or null: an empty slot. */
  ability: AbilityDef | null;
  /** The rank in the slot (default 1; a Wish has one). */
  rank?: number;
  /** `slotReadyAt`: server time the slot is ready (0 or past: ready). */
  readyAt: number;
  /** How long the cooldown that ends at `readyAt` is (ms): what the sweep counts down from (`CooldownTracker`). */
  cooldownLen: number;
  /** `PlayerState.effects`: the bits that block a cast, and the server's own word that a cast is under way. */
  effects: number;
  /** What refuses the cast at the server (`AbilityDef.blockedBy`). */
  blockedBy: readonly Blocker[];
  /** Server time the local fighter's cast ends (its root, as the prediction knows it); 0 or past: none. */
  castUntil: number;
}

export type AbilitySlotState = "hidden" | "empty" | "ready" | "cooldown" | "casting" | "blocked";

export interface AbilitySlotModel {
  state: AbilitySlotState;
  name: string;
  icon: AbilityIcon | null;
  /** 0xRRGGBB, the ability's colour (0 with no ability). */
  color: number;
  /** Whole seconds of cooldown left (rounded up), 0 when ready. Kept while casting: a cast spends the cooldown. */
  secondsLeft: number;
  /** The share of the cooldown still to run, 1 down to 0: the wedge's size. */
  sweep: number;
  /** What currently blocks the cast, whatever the headline state is (a cooldown shows first). */
  blocked: Blocker | null;
  /** How far the cast has run, 0..1 (0 when it is not casting, or the progress is not known). */
  cast: number;
}

const BLOCK_BIT: Readonly<Record<Blocker, number>> = { stun: EFFECT_STUNNED, silence: EFFECT_SILENCED, root: EFFECT_ROOTED };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * What the slot shows. Hidden before the run and once the player is down (the weapon bar goes with it); empty with no ability.
 * Otherwise the headline is, in this order: casting (the cast bar), cooldown (the wedge and the seconds), blocked (a stun or
 * silence that would refuse the cast), ready. The cooldown's numbers are always filled in; `blocked` is too.
 */
export function abilitySlotModel(i: AbilitySlotInput, serverNow: number): AbilitySlotModel {
  const def = i.ability;
  const model: AbilitySlotModel = {
    state: "hidden", name: def?.name ?? "", icon: def?.icon ?? null, color: def?.color ?? 0,
    secondsLeft: 0, sweep: 0, blocked: null, cast: 0,
  };
  if (!i.alive || i.phase !== "active") return model;
  if (!def) return { ...model, state: "empty" };

  const left = i.readyAt - serverNow;
  if (left > 0) {
    model.secondsLeft = Math.ceil(left / 1000);
    model.sweep = clamp01(left / Math.max(1, i.cooldownLen));
  }
  for (const b of i.blockedBy) {
    if ((i.effects & BLOCK_BIT[b]) !== 0) { model.blocked = b; break; }
  }
  const castLeft = i.castUntil - serverNow;
  if (castLeft > 0 || (i.effects & EFFECT_CASTING) !== 0) {
    const castMs = rankOf(def, i.rank ?? 1).castMs;
    model.cast = castLeft > 0 && castMs > 0 ? clamp01(1 - castLeft / castMs) : 0;
    model.state = "casting";
  } else if (left > 0) {
    model.state = "cooldown";
  } else {
    model.state = model.blocked !== null ? "blocked" : "ready";
  }
  return model;
}

/** "45" under a minute, "4:59" from there: a Wish's 5 minutes fit a 64 px slot. */
export function formatCooldown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return String(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const BLOCK_LABEL: Readonly<Record<Blocker, string>> = { stun: "Stunned", silence: "Silenced", root: "Rooted" };

/**
 * Why a press of the key does nothing, as a line for the deny text, or null when it should go through (or the slot is not
 * showing, so the key is ignored without a word). The server decides anyway; this only keeps a hopeless cast off the wire.
 */
export function castDenial(m: AbilitySlotModel): string | null {
  switch (m.state) {
    case "hidden":
    case "empty":
    case "ready":
      return null;
    case "casting":
      return "Casting";
    case "cooldown":
      return `Ready in ${formatCooldown(m.secondsLeft)}`;
    case "blocked":
      return m.blocked ? BLOCK_LABEL[m.blocked] : "Can't cast now";
    default: {
      const unknown: never = m.state;
      void unknown;
      return null;
    }
  }
}

/**
 * The length (ms) of the cooldown the sweep counts down from. The server syncs only when a slot is ready again, so a changed
 * `readyAt` starts a new length: the time it was set (the patch's `patchT`) to the new ready time. The first sight of a
 * cooldown already running (a reconnect) gives its remaining time: the wedge starts full and still empties on time.
 */
export class CooldownTracker {
  private readyAt = 0;
  private length = 1;

  observe(readyAt: number, patchT: number): number {
    if (readyAt !== this.readyAt) {
      this.readyAt = readyAt;
      this.length = Math.max(1, readyAt - patchT);
    }
    return this.length;
  }

  reset(): void {
    this.readyAt = 0;
    this.length = 1;
  }
}

const ring = (n: number, outer: number, inner: number, turn = -90): string => {
  const pts: string[] = [];
  for (let k = 0; k < 2 * n; k++) {
    const a = ((turn + (k * 180) / n) * Math.PI) / 180;
    const r = k % 2 === 0 ? outer : inner;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)}% ${(50 + r * Math.sin(a)).toFixed(1)}%`);
  }
  return pts.join(", ");
};

/** Each icon as a polygon over the slot's icon box (percent): the same names as `AbilityIcon`, so art and HUD agree. */
const ICON_POLYGON: Readonly<Record<AbilityIcon, string>> = {
  snowflake: ring(6, 50, 24),
  swarm: ring(7, 50, 34),
  scales: "45% 0%, 55% 0%, 55% 18%, 88% 18%, 88% 30%, 100% 62%, 76% 62%, 88% 30%, 55% 30%, 55% 86%, 75% 100%, 25% 100%, 45% 86%, 45% 30%, 12% 30%, 0% 62%, 24% 62%, 12% 30%, 12% 18%, 45% 18%",
  flame: "52% 0%, 74% 30%, 90% 58%, 80% 86%, 50% 100%, 20% 86%, 10% 58%, 28% 34%, 40% 52%, 44% 20%",
  cross: "35% 0%, 65% 0%, 65% 35%, 100% 35%, 100% 65%, 65% 65%, 65% 100%, 35% 100%, 35% 65%, 0% 65%, 0% 35%, 35% 35%",
};

/** The icon's `clip-path` value. */
export function iconClipPath(icon: AbilityIcon): string {
  return `polygon(${ICON_POLYGON[icon]})`;
}

/** How long the deny line stays (ms of the client clock). */
export const DENY_MS = 1000;

export class AbilitySlotView {
  /** Not appended anywhere: the caller docks it (`WeaponBar.dock`). */
  readonly element: HTMLElement = el("div", "as-wrap");
  private readonly box = el("div", "as-slot empty");
  private readonly icon = el("span", "as-icon");
  private readonly name = el("span", "as-name");
  private readonly secs = el("span", "as-secs");
  private readonly sweep = el("span", "as-sweep");
  private readonly castBar = el("span", "as-cast");
  private readonly castFill = el("span", "as-cast-fill");
  private readonly denyLine = el("div", "as-deny");
  private denyUntil = 0;
  private state: AbilitySlotState | null = null;
  private blocked: Blocker | null | undefined;
  private shownIcon: AbilityIcon | null | undefined;
  private shownName: string | undefined;
  private shownColor = -1;
  private shownSecs = "";
  private sweepDeg = -1;
  private castPct = -1;

  constructor(opts: { key: string }) {
    this.sweep.hidden = true;
    this.castBar.hidden = true;
    this.castBar.append(this.castFill);
    this.box.append(keycap(opts.key, "wb-key"), this.icon, this.name, this.secs, this.sweep, this.castBar);
    this.denyLine.hidden = true;
    this.element.hidden = true;
    this.element.append(this.denyLine, this.box);
  }

  update(model: AbilitySlotModel, now: number): void {
    const hidden = model.state === "hidden";
    if (this.element.hidden !== hidden) this.element.hidden = hidden;
    if (!this.denyLine.hidden && now >= this.denyUntil) this.denyLine.hidden = true;
    if (hidden) return;

    if (model.state !== this.state || model.blocked !== this.blocked) {
      this.state = model.state;
      this.blocked = model.blocked;
      for (const s of ["empty", "ready", "cooldown", "casting", "blocked"] as const) this.box.classList.toggle(s, model.state === s);
      // A stun or silence also tints a slot whose headline is its cooldown.
      this.box.classList.toggle("shut", model.blocked !== null);
    }
    if (model.name !== this.shownName) {
      this.shownName = model.name;
      this.name.textContent = model.name;
      this.element.title = model.name;
    }
    if (model.color !== this.shownColor) {
      this.shownColor = model.color;
      this.box.style.setProperty("--as-color", cssColor(model.color));
    }
    if (model.icon !== this.shownIcon) {
      this.shownIcon = model.icon;
      this.icon.style.setProperty("clip-path", model.icon ? iconClipPath(model.icon) : "none");
      this.icon.hidden = model.icon === null;
    }

    const secs = model.state === "blocked" && model.blocked ? BLOCK_LABEL[model.blocked] : model.secondsLeft > 0 ? formatCooldown(model.secondsLeft) : "";
    if (secs !== this.shownSecs) {
      this.shownSecs = secs;
      this.secs.textContent = secs;
    }
    const deg = Math.round(model.sweep * 360);
    if (deg !== this.sweepDeg) {
      this.sweepDeg = deg;
      this.sweep.style.setProperty("--cd", `${deg}deg`);
      this.sweep.hidden = deg === 0;
    }
    const pct = model.state === "casting" ? Math.round(model.cast * 100) : -1;
    if (pct !== this.castPct) {
      this.castPct = pct;
      this.castBar.hidden = pct < 0;
      if (pct >= 0) this.castFill.style.setProperty("width", `${pct}%`);
    }
  }

  /** A short line above the slot ("Out of range"), for DENY_MS. Said again, it starts over. */
  deny(text: string, now: number): void {
    if (this.denyLine.textContent !== text) this.denyLine.textContent = text;
    this.denyUntil = now + DENY_MS;
    this.denyLine.hidden = false;
  }

  destroy(): void {
    this.element.remove();
  }
}
