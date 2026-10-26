// Validated, per-player input buffering. Message handlers only call `parse*` + `push*`;
// the sim drains the queue at the start of each fixed step.
import { WORLD_H, WORLD_W, isAbilitySlot, wrapAngle, type AbilitySlot, type Vec2 } from "@raid/shared";

/**
 * `seq`: the client's order number (an integer 0..255), echoed in `PlayerState.moveSeq` on the tick the order is applied, so a
 * client can tell when it took effect. Nothing else reads it; a mob's orders carry none.
 */
export type MoveCommand = { kind: "move"; x: number; y: number; seq?: number } | { kind: "stop"; seq?: number };

export type ActionCommand =
  /** Trigger pressed toward `a`. `t` is the server time the client was rendering; melee rewinds to it (clamped). */
  | { kind: "attack"; a: number; t?: number }
  /** Trigger released: the attacks stop repeating. */
  | { kind: "release"; a: number; t?: number }
  /** Lock this fighter and auto-attack it (sim/targeting.ts validates it). */
  | { kind: "target"; id: string }
  /** To `slot`, or to the other slot when omitted. */
  | { kind: "swap"; slot?: 0 | 1 }
  | { kind: "pickup"; containerId: string }
  /**
   * Cast the ability in `slot` (sim/abilities.ts validates it). (x, y): the cursor's ground point, clamped like a `move`'s.
   * `id`: a unit target. `t`: the render time the client was drawing (clamped later). `seq`: echoed in moveSeq, accepted or refused.
   */
  | { kind: "cast"; slot: AbilitySlot; x: number; y: number; id?: string; t?: number; seq?: number };

/** Actions beyond this per tick are dropped (spam guard, not a gameplay limit). */
export const MAX_ACTIONS_PER_TICK = 6;

export class InputQueue {
  /** Latest movement intent wins within a tick. */
  move: MoveCommand | null = null;
  /** How many of `actions` had arrived when that move did: it is applied just before actions[moveBefore], so an order and a move replace each other in arrival order. */
  moveBefore = 0;
  /** Latest aim wins within a tick (radians). */
  aim: number | null = null;
  /** How many of `actions` had arrived when that aim did: it is applied just before actions[aimBefore]. */
  aimBefore = 0;
  actions: ActionCommand[] = [];
  dropped = 0;

  pushMove(cmd: MoveCommand): void {
    this.move = cmd;
    this.moveBefore = this.actions.length;
  }

  pushAim(a: number): void {
    this.aim = a;
    this.aimBefore = this.actions.length;
  }

  pushAction(cmd: ActionCommand): void {
    if (this.actions.length >= MAX_ACTIONS_PER_TICK) { this.dropped++; return; }
    this.actions.push(cmd);
  }

  drain(): { move: MoveCommand | null; moveBefore: number; aim: number | null; aimBefore: number; actions: ActionCommand[] } {
    const out = { move: this.move, moveBefore: this.moveBefore, aim: this.aim, aimBefore: this.aimBefore, actions: this.actions };
    this.move = null;
    this.moveBefore = 0;
    this.aim = null;
    this.aimBefore = 0;
    this.actions = [];
    return out;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Finite point clamped to the world, or null if malformed. */
export function parsePoint(msg: unknown): Vec2 | null {
  if (!isRecord(msg)) return null;
  const { x, y } = msg;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(Math.max(x, 0), WORLD_W), y: Math.min(Math.max(y, 0), WORLD_H) };
}

/** A finite angle wrapped to (-PI, PI], or null. */
export function parseAngle(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? wrapAngle(v) : null;
}

/** The order number a `move` or `stop` carries (an integer 0..255), or undefined: a bad one costs the client its ack, not the order. */
export function parseSeq(msg: unknown): number | undefined {
  const v = isRecord(msg) ? msg.seq : undefined;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255 ? v + 0 : undefined;
}

/** Short opaque id string, or null. */
export function parseId(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;
}

/** Turns an untrusted client message into a queued command. Returns false if rejected. */
export function enqueueClientMessage(q: InputQueue, type: string, msg: unknown): boolean {
  switch (type) {
    case "move": {
      const p = parsePoint(msg);
      if (!p) return false;
      const seq = parseSeq(msg);
      q.pushMove(seq === undefined ? { kind: "move", x: p.x, y: p.y } : { kind: "move", x: p.x, y: p.y, seq });
      return true;
    }
    case "stop": {
      const seq = parseSeq(msg);
      q.pushMove(seq === undefined ? { kind: "stop" } : { kind: "stop", seq });
      return true;
    }
    case "aim": {
      const a = isRecord(msg) ? parseAngle(msg.a) : null;
      if (a === null) return false;
      q.pushAim(a);
      return true;
    }
    case "attack":
    case "release": {
      const a = isRecord(msg) ? parseAngle(msg.a) : null;
      if (a === null) return false;
      // A bad timestamp only costs the attacker lag compensation; the input itself still counts.
      const t = (msg as Record<string, unknown>).t;
      q.pushAction(typeof t === "number" && Number.isFinite(t) ? { kind: type, a, t } : { kind: type, a });
      return true;
    }
    case "target": {
      const id = isRecord(msg) ? parseId(msg.id) : null;
      if (!id) return false;
      q.pushAction({ kind: "target", id });
      return true;
    }
    case "swap": {
      const slot = isRecord(msg) ? msg.slot : undefined;
      if (slot === undefined) { q.pushAction({ kind: "swap" }); return true; }
      if (slot !== 0 && slot !== 1) return false;
      q.pushAction({ kind: "swap", slot });
      return true;
    }
    case "pickup": {
      const containerId = isRecord(msg) ? parseId(msg.containerId) : null;
      if (!containerId) return false;
      q.pushAction({ kind: "pickup", containerId });
      return true;
    }
    case "cast": {
      if (!isRecord(msg) || !isAbilitySlot(msg.slot)) return false;
      const p = parsePoint(msg);
      if (!p) return false;
      const cmd: ActionCommand = { kind: "cast", slot: msg.slot, x: p.x, y: p.y };
      if (msg.id !== undefined) {
        const id = parseId(msg.id);
        if (!id) return false;
        cmd.id = id;
      }
      // A bad timestamp or order number only costs the caster its lag compensation or its ack; the cast itself still counts.
      if (typeof msg.t === "number" && Number.isFinite(msg.t)) cmd.t = msg.t;
      const seq = parseSeq(msg);
      if (seq !== undefined) cmd.seq = seq;
      q.pushAction(cmd);
      return true;
    }
    default:
      return false;
  }
}
