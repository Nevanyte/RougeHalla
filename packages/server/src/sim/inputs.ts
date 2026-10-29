// Validated, per-player input buffering. Message handlers only call `parse*` + `push*`;
// the sim drains the queue at the start of each fixed step.
import {
  isAbilitySlot, isCardId, mobTypeById, mobStatReward, normalizeMobStatCount, TRAIN_CMDS, TRAIN_DEFAULT_CARD_COUNT, TRAIN_MAX_CARD_COUNT, TRAIN_MAX_CHEST_OPTIONS,
  WORLD_H, WORLD_W, wrapAngle, type AbilitySlot, type CardId, type MobTypeId,
  type TrainCmd, type Vec2,
} from "@raid/shared";

/**
 * `seq`: the client's order number (an integer 0..255), echoed in `PlayerState.moveSeq` on the tick the order is applied, so a
 * client can tell when it took effect. Nothing else reads it; a mob's orders carry none.
 */
export type MoveCommand = { kind: "move" | "attackMove"; x: number; y: number; seq?: number } | { kind: "stop"; seq?: number };

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
  | { kind: "cast"; slot: AbilitySlot; x: number; y: number; id?: string; t?: number; seq?: number }
  /** The planning screen (sim/planning.ts reads it during planning only; every other phase drops it). */
  | PlanCommand
  /** A pick at a cleared camp's shared chest (sim/chests.ts): option `pick`, or -1 to skip. `replace` is R6's (ignored). */
  | ChooseCommand
  /** Accept a quest offer at its giver (sim/quests.ts handleQuestAccept validates it). */
  | QuestAcceptCommand
  /** The training console (sim/training.ts; only ever queued for a training world: see enqueueClientMessage). */
  | TrainCommand;

/**
 * A validated `train` input. `card`: the copies of that card to SET (0..TRAIN_MAX_CARD_COUNT; 0 removes). `camp`: the mob type.
 * `chest`: the card ids to offer, empty for a rolled one.
 */
export type TrainCommand =
  | { kind: "train"; cmd: "stat"; id: MobTypeId; count: number }
  | { kind: "train"; cmd: "card"; id: CardId; count: number }
  | { kind: "train"; cmd: "camp"; id: MobTypeId }
  | { kind: "train"; cmd: "chest"; options: CardId[] }
  | { kind: "train"; cmd: "clear" };

/** A `choose` input: a reward container id and an option index (-1 = skip). */
export type ChooseCommand = { kind: "choose"; chest: string; pick: number; replace?: 0 | 1 };

/** A `questAccept` input: the runtime id of a public quest offer (RaidState.quests key). */
export type QuestAcceptCommand = { kind: "questAccept"; quest: string };

/** The highest option index a `choose` may name (a chest has CHEST_OPTIONS today; the parser leaves room to grow). */
export const MAX_CHOOSE_PICK = 15;

/** A `plan` input: indexes into the player's own two dealt options, and the ready latch. At least one field is set. */
export type PlanCommand = { kind: "plan"; spawn?: 0 | 1; boon?: 0 | 1; ready?: boolean };

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

/**
 * A `plan` message, or null: an object whose `spawn` and `boon`, when present, are exactly 0 or 1 and whose `ready`, when
 * present, is a boolean, with at least one of the three. Anything else (an index of 2, "1", a fraction, an empty object)
 * is refused whole.
 */
export function parsePlan(msg: unknown): PlanCommand | null {
  if (!isRecord(msg)) return null;
  const { spawn, boon, ready } = msg;
  const index = (v: unknown): v is 0 | 1 | undefined => v === undefined || v === 0 || v === 1;
  if (!index(spawn) || !index(boon) || (ready !== undefined && typeof ready !== "boolean")) return null;
  if (spawn === undefined && boon === undefined && ready === undefined) return null;
  const cmd: PlanCommand = { kind: "plan" };
  if (spawn !== undefined) cmd.spawn = spawn;
  if (boon !== undefined) cmd.boon = boon;
  if (ready !== undefined) cmd.ready = ready;
  return cmd;
}

/**
 * A `choose` message, or null: `chest` a short id string, `pick` an integer from -1 (skip) to MAX_CHOOSE_PICK, and
 * `replace`, when present, exactly 0 or 1 (reserved for R6's slots). Anything else is refused whole. Whether the index names
 * an option of that chest is the sim's to check.
 */
export function parseChoose(msg: unknown): ChooseCommand | null {
  if (!isRecord(msg)) return null;
  const chest = parseId(msg.chest);
  const { pick, replace } = msg;
  if (!chest || typeof pick !== "number" || !Number.isInteger(pick) || pick < -1 || pick > MAX_CHOOSE_PICK) return null;
  if (replace !== undefined && replace !== 0 && replace !== 1) return null;
  const cmd: ChooseCommand = { kind: "choose", chest, pick: pick + 0 };
  if (replace !== undefined) cmd.replace = replace;
  return cmd;
}

/** A `questAccept` message, or null: `quest` a short id string. Whether it names an open public offer in reach is the sim's to check. */
export function parseQuestAccept(msg: unknown): QuestAcceptCommand | null {
  if (!isRecord(msg)) return null;
  const quest = parseId(msg.quest);
  return quest ? { kind: "questAccept", quest } : null;
}

/**
 * A `train` message, or null: `cmd` one of TRAIN_CMDS, then per command: `card` a known card id and a `count` that is a finite
 * number (clamped to 0..TRAIN_MAX_CARD_COUNT and floored; absent = TRAIN_DEFAULT_CARD_COUNT); `camp` a known mob type; `chest` an
 * `options` array of 1..TRAIN_MAX_CHEST_OPTIONS distinct known card ids, or absent or empty for the server's rolled pick; `clear`
 * nothing. Anything else is refused whole. Unknown extra fields are ignored.
 */
export function parseTrain(msg: unknown): TrainCommand | null {
  if (!isRecord(msg)) return null;
  const cmd = msg.cmd;
  if (typeof cmd !== "string" || !(TRAIN_CMDS as readonly string[]).includes(cmd)) return null;
  switch (cmd as TrainCmd) {
    case "stat": {
      if (typeof msg.id !== "string") return null;
      const reward = mobStatReward(msg.id);
      if (!reward) return null;
      const raw = msg.count;
      if (raw !== undefined && (typeof raw !== "number" || !Number.isFinite(raw))) return null;
      const count = raw === undefined ? 1 : normalizeMobStatCount(raw);
      if (raw !== undefined && raw >= 0 && count === 0) return null;
      return { kind: "train", cmd: "stat", id: reward.id, count: count + 0 };
    }
    case "card": {
      const id = msg.id;
      if (!isCardId(id)) return null;
      const raw = msg.count;
      if (raw !== undefined && (typeof raw !== "number" || !Number.isFinite(raw))) return null;
      const count = raw === undefined ? TRAIN_DEFAULT_CARD_COUNT : Math.min(TRAIN_MAX_CARD_COUNT, Math.max(0, Math.floor(raw)));
      return { kind: "train", cmd: "card", id, count: count + 0 };
    }
    case "camp": {
      const id = msg.id;
      if (typeof id !== "string") return null;
      const type = mobTypeById(id);
      return type ? { kind: "train", cmd: "camp", id: type.id } : null;
    }
    case "chest": {
      const raw = msg.options;
      if (raw === undefined) return { kind: "train", cmd: "chest", options: [] };
      if (!Array.isArray(raw) || raw.length > TRAIN_MAX_CHEST_OPTIONS) return null;
      const options: CardId[] = [];
      for (const id of raw) {
        if (!isCardId(id) || options.includes(id)) return null;
        options.push(id);
      }
      return { kind: "train", cmd: "chest", options };
    }
    case "clear":
      return { kind: "train", cmd: "clear" };
  }
}

/** What the caller knows about the room that the message alone cannot say. */
export interface EnqueueOptions {
  /** The room is a training room (RaidRoom.training / SimConfig.training): the only place a `train` message is accepted. */
  training?: boolean;
}

/** Turns an untrusted client message into a queued command. Returns false if rejected. */
export function enqueueClientMessage(q: InputQueue, type: string, msg: unknown, opts: EnqueueOptions = {}): boolean {
  switch (type) {
    case "move": {
      const p = parsePoint(msg);
      if (!p) return false;
      const seq = parseSeq(msg);
      q.pushMove(seq === undefined ? { kind: "move", x: p.x, y: p.y } : { kind: "move", x: p.x, y: p.y, seq });
      return true;
    }
    case "attackMove": {
      const p = parsePoint(msg);
      if (!p) return false;
      const seq = parseSeq(msg);
      q.pushMove(seq === undefined ? { kind: "attackMove", x: p.x, y: p.y } : { kind: "attackMove", x: p.x, y: p.y, seq });
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
    case "plan": {
      const cmd = parsePlan(msg);
      if (!cmd) return false;
      q.pushAction(cmd);
      return true;
    }
    case "choose": {
      const cmd = parseChoose(msg);
      if (!cmd) return false;
      q.pushAction(cmd);
      return true;
    }
    case "questAccept": {
      const cmd = parseQuestAccept(msg);
      if (!cmd) return false;
      q.pushAction(cmd);
      return true;
    }
    case "train": {
      // The practice console exists in a training room only: an arena client's `train` is dropped here, never queued.
      if (opts.training !== true) return false;
      const cmd = parseTrain(msg);
      if (!cmd) return false;
      q.pushAction(cmd);
      return true;
    }
    default:
      return false;
  }
}
