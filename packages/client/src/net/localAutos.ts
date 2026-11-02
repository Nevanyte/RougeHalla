import { ATTACK_BUFFER_MS, type WeaponId } from "@raid/shared";

export interface AutoInput {
  key: string;
  weapon: WeaponId;
  a: number;
  held: boolean;
  enabled: boolean;
  intervalMs: number;
  windupMs: number;
  readyInMs: number;
  targetId?: string;
}
export interface AutoVisual {
  kind: "windup" | "swing" | "launch";
  id: string;
  weapon: WeaponId;
  a: number;
  ms: number;
  targetId?: string;
}
interface Prediction {
  id: string;
  weapon: WeaponId;
  until: number;
  seen: Set<AutoVisual["kind"]>;
  canceled: boolean;
  released: boolean;
}

/** Cosmetic attacks only. No health, collisions, damage, resource use, or server orders live here. */
export class LocalAutos {
  private key = "";
  private nextAt = 0;
  private queuedUntil = -Infinity;
  private pending: { visual: AutoVisual; at: number } | null = null;
  private readonly predictions: Prediction[] = [];
  private sequence = 0;

  press(input: AutoInput, now: number, emit: (visual: AutoVisual) => void): void {
    this.queuedUntil = now + ATTACK_BUFFER_MS;
    this.frame(input, now, emit);
  }

  frame(input: AutoInput, now: number, emit: (visual: AutoVisual) => void): void {
    this.prune(now);
    if (input.key !== this.key) {
      this.cancelPending();
      this.key = input.key;
      this.nextAt = now + Math.max(0, input.readyInMs);
    }
    if (!input.enabled) { this.cancelPending(); this.queuedUntil = -Infinity; this.nextAt = Math.max(this.nextAt, now + input.readyInMs); return; }
    if (this.pending?.visual.targetId && (!input.held || this.pending.visual.targetId !== input.targetId)) this.cancelPending();
    if (this.pending && now >= this.pending.at) {
      const visual = this.pending.visual;
      this.pending = null;
      const prediction = this.predictions.find(p => p.id === visual.id);
      if (prediction) prediction.released = true;
      // Bow aim is streamed through the draw; a locked wand retains its target.
      emit({ ...visual, kind: "launch", a: input.a });
    }
    if (this.pending || (!input.held && now > this.queuedUntil) || now < this.nextAt) return;
    if (!(input.intervalMs > 0) || !Number.isFinite(input.a)) return;
    this.queuedUntil = -Infinity;
    // Never catch up a hidden tab with a burst of cosmetic attacks.
    this.nextAt = now + input.intervalMs;
    const id = `local-auto-${++this.sequence}`;
    const visual: AutoVisual = { kind: input.windupMs > 0 ? "windup" : "swing", id, weapon: input.weapon,
      a: input.a, ms: input.windupMs, targetId: input.targetId };
    this.predictions.push({ id, weapon: input.weapon, until: now + Math.max(2500, input.windupMs + 2000), seen: new Set(), canceled: false,
      released: input.windupMs <= 0 });
    emit(visual);
    if (input.windupMs > 0) this.pending = { visual, at: now + input.windupMs };
  }

  /** Match each authoritative cue once so it confirms the cosmetic attack instead of replaying it. */
  consume(kind: AutoVisual["kind"], weapon: WeaponId, now: number): string | undefined {
    this.prune(now);
    const prediction = this.predictions.find(p => p.weapon === weapon && !p.seen.has(kind) && (kind === "windup" || !p.canceled));
    if (!prediction) return undefined;
    prediction.seen.add(kind);
    if (kind === "launch" && this.pending?.visual.id === prediction.id) this.pending = null;
    return prediction.id;
  }

  wasReleased(id: string): boolean { return this.predictions.some(p => p.id === id && p.released); }

  /** A locally controlled bow ignores delayed draw patches through the release/confirmation window. */
  bowPull(now: number): number | undefined {
    if (!this.predictions.some(p => p.weapon === "bow" && p.until >= now)) return undefined;
    const draw = this.pending;
    if (!draw || draw.visual.weapon !== "bow") return -1;
    return Math.max(0, Math.min(1, (now - (draw.at - draw.visual.ms)) / draw.visual.ms));
  }

  /** Cancels an unfinished cosmetic draw; recent releases remain matchable across a swap or death. */
  cancel(): void { this.cancelPending(); this.queuedUntil = -Infinity; this.key = ""; this.nextAt = 0; }
  reset(): void { this.cancel(); this.predictions.length = 0; }
  private cancelPending(): void {
    const prediction = this.predictions.find(p => p.id === this.pending?.visual.id);
    if (prediction) prediction.canceled = true;
    this.pending = null;
  }
  private prune(now: number): void {
    while (this.predictions.length && this.predictions[0]!.until < now) this.predictions.shift();
    if (this.predictions.length > 32) this.predictions.splice(0, this.predictions.length - 32);
  }
}
