// Validated, per-player input buffering. Message handlers only call `parse*` + `push*`;
// the sim drains the queue at the start of each fixed step.
import { WORLD_H, WORLD_W, type Vec2 } from "@raid/shared";

export type MoveCommand = { kind: "move"; x: number; y: number } | { kind: "stop" };

export type ActionCommand =
  /** `t` is the server time the client was rendering when it clicked; combat clamps it to the rewind window. */
  | { kind: "attack"; x: number; y: number; t?: number }
  | { kind: "take"; containerId: string; uid: string }
  | { kind: "drop"; uid: string }
  | { kind: "use"; uid: string };

/** Actions beyond this per tick are dropped (spam guard, not a gameplay limit). */
export const MAX_ACTIONS_PER_TICK = 4;

export class InputQueue {
  /** Latest movement intent wins within a tick. */
  move: MoveCommand | null = null;
  actions: ActionCommand[] = [];
  dropped = 0;

  pushMove(cmd: MoveCommand): void {
    this.move = cmd;
  }

  pushAction(cmd: ActionCommand): void {
    if (this.actions.length >= MAX_ACTIONS_PER_TICK) { this.dropped++; return; }
    this.actions.push(cmd);
  }

  drain(): { move: MoveCommand | null; actions: ActionCommand[] } {
    const out = { move: this.move, actions: this.actions };
    this.move = null;
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
    case "attack": {
      const p = parsePoint(msg);
      if (!p) return false;
      // A bad timestamp only costs the shooter lag compensation; the attack itself still counts.
      const t = (msg as Record<string, unknown>).t;
      q.pushAction(typeof t === "number" && Number.isFinite(t)
        ? { kind: "attack", x: p.x, y: p.y, t }
        : { kind: "attack", x: p.x, y: p.y });
      return true;
    }
    case "take": {
      if (!isRecord(msg)) return false;
      const containerId = parseId(msg.containerId);
      const uid = parseId(msg.uid);
      if (!containerId || !uid) return false;
      q.pushAction({ kind: "take", containerId, uid });
      return true;
    }
    case "drop":
    case "use": {
      if (!isRecord(msg)) return false;
      const uid = parseId(msg.uid);
      if (!uid) return false;
      q.pushAction({ kind: type, uid });
      return true;
    }
    default:
      return false;
  }
}
