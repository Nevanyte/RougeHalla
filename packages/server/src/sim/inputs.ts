// Validated, per-player input buffering. Message handlers only call `parse*` + `push*`;
// the sim drains the queue at the start of each fixed step.
import { WORLD_H, WORLD_W, wrapAngle, type Vec2 } from "@raid/shared";

export type MoveCommand = { kind: "move"; x: number; y: number } | { kind: "stop" };

export type ActionCommand =
  /** Trigger pressed toward `a`. `t` is the server time the client was rendering; melee rewinds to it (clamped). */
  | { kind: "attack"; a: number; t?: number }
  /** Trigger released (the bow looses). */
  | { kind: "release"; a: number; t?: number }
  /** To `slot`, or to the other slot when omitted. */
  | { kind: "swap"; slot?: 0 | 1 }
  | { kind: "pickup"; containerId: string };

/** Actions beyond this per tick are dropped (spam guard, not a gameplay limit). */
export const MAX_ACTIONS_PER_TICK = 6;

export class InputQueue {
  /** Latest movement intent wins within a tick. */
  move: MoveCommand | null = null;
  /** Latest aim wins within a tick (radians). */
  aim: number | null = null;
  actions: ActionCommand[] = [];
  dropped = 0;

  pushMove(cmd: MoveCommand): void {
    this.move = cmd;
  }

  pushAim(a: number): void {
    this.aim = a;
  }

  pushAction(cmd: ActionCommand): void {
    if (this.actions.length >= MAX_ACTIONS_PER_TICK) { this.dropped++; return; }
    this.actions.push(cmd);
  }

  drain(): { move: MoveCommand | null; aim: number | null; actions: ActionCommand[] } {
    const out = { move: this.move, aim: this.aim, actions: this.actions };
    this.move = null;
    this.aim = null;
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
      q.pushMove({ kind: "move", x: p.x, y: p.y });
      return true;
    }
    case "stop":
      q.pushMove({ kind: "stop" });
      return true;
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
    default:
      return false;
  }
}
