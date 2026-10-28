// Compact wire form of the fx events: one `fxs` message per simulation step instead of one message per event.
//
// A batch is `{ t, l, p? }`: `t` is the server time of the step, `l` holds one tuple per fx, in emit order:
// `[kindCode, ...fields]`. A tuple holds integers, strings and nulls only, because msgpack sends any fraction as a 9 byte
// float64 while a small integer takes 1 to 3 bytes. Fractions are scaled to integers (FX_SCALE), so a decoded value is
// within half a step of the original, and nothing else about an event changes:
//   positions (x, y, x0, y0)    whole units
//   angles (a)                  hundredths of a radian
//   hit and heal amounts        tenths
//   windup ms, projEnd t0       whole ms (the batch `t` stays exact)
//   cast ms, status ms          whole ms
// Weapons, projectile kinds, end reasons, signatures, abilities, status kinds and cast-end reasons travel as
// indices into the tables below (abilities and status kinds are the order of ABILITY_IDS and STATUS_KINDS). They are wire
// format: client and server ship together, so a table may grow at its end but must never be reordered.
//
// Ids: a string field holding a player or mob id travels as a number, its index in the synced `RaidState.roster` (a byte,
// against 10 for a session id). `packFx` does it for the ids in `PackOptions.roster`, which are those a patch has already
// carried, and `unpackFx` needs the client's copy of the roster to read them back. Any other string stays a string.
//
// Projectiles are not in the synced state. One that is still flying when the step that loosed it ends travels in the batch
// of that step, in `p`, one tuple each; a client that joins or reconnects mid-flight is sent the ones then flying as a
// batch of its own with no events (`FxChannel.inFlight`), where `back` is how long they have flown (a ball's whole flight
// is under 600 ms):
//   launch   [id, kind, x, y, vx, vy, back?, range?]   (x, y, vx, vy in tenths; `back`: ms between the batch `t` and the
//            moment it left, 0 for every projectile loosed in the step; `range`: left off, together with `back`, when it is
//            the weapon's own, which it is unless a shield sent an arrow back)
//
// Tuple layouts ([0] is always the kind code; `W` = weapon code, null where the type allows null):
//   windup   [by, W, a, ms]                 swing    [by, W, x, y, a]
//   hit      [id, by|null, amount, flags, AB?]   (flags = W+1 (0: none), plus (SIG+1) x HIT_RADIX when a signature dealt it,
//                                            plus 64 for a critical strike;
//                                            AB: the ability code, only for a hit an ability dealt, which has no weapon. A
//                                            reader that predates it ignores the fifth field)
//   block    [id, by, W, passive?]          (passive: 1; left off when false)
//   stagger  [id]                           teleport []        cancel [id]
//   projEnd  [id, proj, reason, x, y, x0?, y0?, t0?]   (x0, y0, t0: where and when it was loosed. Only for a projectile no
//                                            launch ever announced (loosed and stopped within one step, e.g. an arrow
//                                            reflected at once): a client that has the launch needs none of them, so `packFx`
//                                            leaves them off for ids in `announced`, and they decode as x, y and the batch t)
//   death    [id, x, y, by|null]            heal     [id, amount]
//   bounty   [id, name, bounty]
//   victory  [id|null, name|null, draw 0|1]
//   cast     [by, AB, ms, target|null, x, y]        castEnd  [by, AB, reason]
//   castLand [by, AB, target|null, x, y, x2?, y2?]  (x2 and y2 together, only for a blink: its landing)
//   status   [id, ST, ms, by|null]                  (a status instance newly applied to `id`)
//   campCleared [camp]                      (the camp's index in map.camps)
//   chestTaken  [chest, by, option]         (chest: the reward container's id, a string; option -1 = a skip)
//   campHeal [id, camp, amount]             (camp: its index in map.camps; amount hp x 10, like heal)
// Kind 10 was `buff` (the per-kill buffs, retired in the balance pass) and kind 11 `combo` (the kill combos, retired in roguelike
// R4a): never emitted and never reused; a client reading one drops it (onDrop).
// Adding a field to an FxEvent means adding it to its tuple here (and to the round-trip test).
import { ABILITY_IDS, type AbilityId, type CastEndReason } from "./abilities";
import type { SignatureKind } from "./signatures";
import type { FxBatch, FxEvent, FxTuple, ProjectileEnd, ProjectileLaunch, TimedFx } from "./messages";
import { STATUS_KINDS, type StatusKind } from "./status";
import { WEAPONS, type ProjectileKind, type WeaponId } from "./weapons";

/** Units per integer step on the wire: an angle of 1.5707 is sent as 157 and decodes to 1.57. */
export const FX_SCALE = { pos: 1, angle: 100, amount: 10, ms: 1, flight: 10 } as const;

interface Table<K extends string> {
  readonly code: Readonly<Record<K, number>>;
  readonly name: readonly K[];
}

/** `code` must list every member of K (the compiler checks), so a new weapon or fx kind cannot be forgotten. */
function table<K extends string>(code: Readonly<Record<K, number>>): Table<K> {
  const name: K[] = [];
  for (const k of Object.keys(code) as K[]) name[code[k]] = k;
  return { code, name };
}

/** "buff" and "combo" stay in the table only to hold their codes (10, 11) forever: nothing packs them, and unpacking one yields nothing. */
const KIND = table<FxEvent["kind"] | "buff" | "combo">({
  windup: 0, swing: 1, hit: 2, block: 3, stagger: 4, projEnd: 5, death: 6, heal: 7, teleport: 8, bounty: 9, buff: 10, combo: 11,
  victory: 12, cancel: 13, cast: 14, castLand: 15, castEnd: 16, status: 17, campCleared: 18, chestTaken: 19, campHeal: 20,
});
const WEAPON = table<WeaponId>({ sword: 0, bow: 1, wand: 2, shield: 3, axe: 4, fists: 5 });
const PROJECTILE = table<ProjectileKind>({ arrow: 0, ball: 1 });
const END = table<ProjectileEnd>({ hit: 0, wall: 1, range: 2, reflected: 3, deleted: 4, destroyed: 5, cleared: 6, blocked: 7 });
const SIG = table<SignatureKind>({ burn: 0, backlash: 1, disease: 2, mark: 3 });
/** A list's members by position: a new ability or status kind is a new code at the end of its list. */
const indexed = <K extends string>(list: readonly K[]): Readonly<Record<K, number>> =>
  Object.fromEntries(list.map((k, i) => [k, i])) as Record<K, number>;
const ABILITY = table<AbilityId>(indexed(ABILITY_IDS));
const STATUS = table<StatusKind>(indexed(STATUS_KINDS));
const CAST_END = table<CastEndReason>({ fizzle: 0, interrupted: 1, cancelled: 2 });

const KC = KIND.code;
const { pos: POS, angle: ANGLE, amount: AMOUNT, ms: MS, flight: FLIGHT } = FX_SCALE;

/** How far each kind of projectile flies unless something shortened it: what a launch tuple leaves out. */
const DEFAULT_RANGE: Readonly<Record<ProjectileKind, number>> = {
  arrow: WEAPONS.bow.shape.kind === "projectile" ? WEAPONS.bow.shape.range : 0,
  ball: WEAPONS.wand.shape.kind === "projectile" ? WEAPONS.wand.shape.range : 0,
};

/** `+ 0` turns a -0 (what rounding a tiny negative gives) into 0, which msgpack and equality checks treat alike. */
const enc = (v: number, scale: number): number => Math.round(v * scale) + 0;

/** hit `flags` = weapon (0..WEAPON.name.length, 0 = none) + HIT_RADIX x signature (0 = none), plus HIT_CRIT for a critical strike: one byte for all three. */
const HIT_RADIX = WEAPON.name.length + 1;
/** Added to a hit's flags for a critical strike. Above any weapon + signature value (7 x (signatures + 1) stays under 64 while there are fewer than 9). */
const HIT_CRIT = 64;

/** What `packFx` needs besides the events. */
export interface PackOptions {
  /**
   * Ids of the projectiles whose launch an earlier batch already carried: every client has them, so their `projEnd` leaves
   * off where and when they were loosed. Any other projectile ends with its start (it may never have been announced).
   */
  announced?: ReadonlySet<string>;
  /** The projectiles that left during this step and are still flying. */
  launches?: readonly ProjectileLaunch[];
  /**
   * Fighter id -> its index in the synced `roster` (`RaidState.roster`), for every fighter whose entry a patch has already
   * carried. Those ids travel as the index: a client reads them back from its copy of the roster.
   */
  roster?: ReadonlyMap<string, number>;
}

/**
 * Every event of one step as a batch. `t` is that step's server time. An event of a kind this file does not know is
 * dropped.
 */
export function packFx(fxs: readonly FxEvent[], t: number, opts: PackOptions = {}): FxBatch {
  const l: FxTuple[] = [];
  for (const fx of fxs) {
    const tuple = packOne(fx, opts.announced);
    if (tuple) l.push(tuple);
  }
  const batch: FxBatch = { t, l };
  if (opts.roster) refer(l, opts.roster);
  if (opts.launches && opts.launches.length > 0) batch.p = opts.launches.map((p) => packLaunch(p, t));
  const homing = opts.launches?.filter((p): p is ProjectileLaunch & { targetId: string } => typeof p.targetId === "string");
  if (homing?.length) batch.h = homing.map((p) => [p.id, p.targetId]);
  return batch;
}

function packLaunch(p: ProjectileLaunch, t: number): FxTuple {
  const tuple: FxTuple = [
    p.id, PROJECTILE.code[p.kind], enc(p.x, FLIGHT), enc(p.y, FLIGHT), enc(p.vx, FLIGHT), enc(p.vy, FLIGHT),
  ];
  const back = enc(t - p.t, MS);
  const range = Math.round(p.range);
  if (back !== 0 || range !== DEFAULT_RANGE[p.kind]) tuple.push(back, range);
  return tuple;
}

/** Replaces every string that is in the roster by its index (an integer from 0 up). */
function refer(l: FxTuple[], roster: ReadonlyMap<string, number>): void {
  for (const tuple of l) {
    for (let i = 0; i < tuple.length; i++) {
      const v = tuple[i];
      const at = typeof v === "string" ? roster.get(v) : undefined;
      if (at !== undefined) tuple[i] = at;
    }
  }
}

function packOne(fx: FxEvent, announced: ReadonlySet<string> | undefined): FxTuple | null {
  switch (fx.kind) {
    case "windup": return [KC.windup, fx.by, WEAPON.code[fx.weapon], enc(fx.a, ANGLE), enc(fx.ms, MS)];
    case "swing": return [KC.swing, fx.by, WEAPON.code[fx.weapon], enc(fx.x, POS), enc(fx.y, POS), enc(fx.a, ANGLE)];
    case "hit": {
      const flags = (fx.weapon == null ? 0 : WEAPON.code[fx.weapon] + 1) + (fx.sig === undefined ? 0 : (SIG.code[fx.sig] + 1) * HIT_RADIX)
        + (fx.crit === true ? HIT_CRIT : 0);
      const tuple: FxTuple = [KC.hit, fx.id, fx.by ?? null, enc(fx.amount, AMOUNT), flags];
      if (fx.ability !== undefined) tuple.push(ABILITY.code[fx.ability]);
      return tuple;
    }
    case "block": {
      const tuple: FxTuple = [KC.block, fx.id, fx.by, WEAPON.code[fx.weapon]];
      if (fx.passive) tuple.push(1);
      return tuple;
    }
    case "stagger": return [KC.stagger, fx.id];
    case "cancel": return [KC.cancel, fx.id];
    case "projEnd": {
      const tuple: FxTuple = [KC.projEnd, fx.id, PROJECTILE.code[fx.proj], END.code[fx.reason], enc(fx.x, POS), enc(fx.y, POS)];
      if (!announced?.has(fx.id)) tuple.push(enc(fx.x0, POS), enc(fx.y0, POS), enc(fx.t0, MS));
      return tuple;
    }
    case "death": return [KC.death, fx.id, enc(fx.x, POS), enc(fx.y, POS), fx.by ?? null];
    case "heal": return [KC.heal, fx.id, enc(fx.amount, AMOUNT)];
    case "teleport": return [KC.teleport];
    case "bounty": return [KC.bounty, fx.id, fx.name, Math.round(fx.bounty) + 0];
    case "victory": return [KC.victory, fx.id ?? null, fx.name ?? null, fx.draw ? 1 : 0];
    case "cast": return [KC.cast, fx.by, ABILITY.code[fx.ability], enc(fx.ms, MS), fx.target ?? null, enc(fx.x, POS), enc(fx.y, POS)];
    case "castLand": {
      const tuple: FxTuple = [KC.castLand, fx.by, ABILITY.code[fx.ability], fx.target ?? null, enc(fx.x, POS), enc(fx.y, POS)];
      if (fx.x2 !== undefined && fx.y2 !== undefined) tuple.push(enc(fx.x2, POS), enc(fx.y2, POS));
      return tuple;
    }
    case "castEnd": return [KC.castEnd, fx.by, ABILITY.code[fx.ability], CAST_END.code[fx.reason]];
    case "status": return [KC.status, fx.id, STATUS.code[fx.status], enc(fx.ms, MS), fx.by ?? null];
    case "campCleared": return [KC.campCleared, Math.round(fx.camp) + 0];
    case "chestTaken": return [KC.chestTaken, fx.chest, fx.by, Math.round(fx.option) + 0];
    case "campHeal": return [KC.campHeal, fx.id, Math.round(fx.camp) + 0, enc(fx.amount, AMOUNT)];
    default: {
      const unknown: never = fx;
      void unknown;
      return null;
    }
  }
}

/** What reading a tuple needs: the roster, and whether a number in it named an entry the roster does not have. */
interface Names {
  roster: ArrayLike<unknown>;
  missed: boolean;
}

/** A string field: the string itself, or the roster entry a number stands for. */
const str = (v: unknown, names: Names): string | undefined => {
  if (typeof v === "string") return v;
  if (typeof v !== "number") return undefined;
  const named = v >= 0 ? names.roster[v] : undefined;
  if (typeof named === "string") return named;
  names.missed = true;
  return undefined;
};
const strOrNull = (v: unknown, names: Names): string | null | undefined => (v === null ? null : str(v, names));
const flag = (v: unknown): boolean | undefined => (v === 1 ? true : v === 0 ? false : undefined);
/** A scaled integer back to its value; undefined for anything that is not a finite number. */
const dec = (v: unknown, scale: number): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v / scale : undefined);
/** The member a code stands for; undefined for a code the table does not have. */
const pick = <K extends string>(t: Table<K>, v: unknown): K | undefined => (typeof v === "number" ? t.name[v] : undefined);

/**
 * Called for a tuple `unpackFx` had to skip. `unresolved`: it named a roster entry this client does not have (an index
 * past its copy of `RaidState.roster`), which is a server or ordering bug and loses the whole event (a death, a hit, a
 * projEnd); otherwise it could not be read for another reason (an unknown kind from a newer server, a missing field).
 */
export type FxDropped = (tuple: unknown, unresolved: boolean) => void;

/**
 * The events of a batch, each stamped with the batch's `t`. A tuple the client does not understand (an unknown kind code
 * from a newer server, a missing or mistyped field) is skipped, never thrown on: the rest of the batch still plays. Pass
 * `onDrop` to hear about the skipped ones: nothing else makes a lost event visible.
 */
export function unpackFx(batch: FxBatch, roster: ArrayLike<string>, onDrop?: FxDropped): TimedFx[] {
  const out: TimedFx[] = [];
  const t = batch?.t;
  if (typeof t !== "number" || !Number.isFinite(t) || !Array.isArray(batch.l)) return out;
  const names: Names = { roster, missed: false };
  for (const tuple of batch.l) {
    names.missed = false;
    const fx = unpackOne(tuple, names, t);
    if (fx) out.push({ ...fx, t });
    else onDrop?.(tuple, names.missed);
  }
  return out;
}

/** The projectiles that left during the step of `batch`. A tuple that cannot be read is skipped. */
export function unpackLaunches(batch: FxBatch): ProjectileLaunch[] {
  const out: ProjectileLaunch[] = [];
  const t = batch?.t;
  if (typeof t !== "number" || !Number.isFinite(t) || !Array.isArray(batch.p)) return out;
  const targets = new Map<string, string>();
  if (Array.isArray(batch.h)) for (const pair of batch.h) {
    if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") targets.set(pair[0], pair[1]);
  }
  for (const tuple of batch.p) {
    if (!Array.isArray(tuple) || (tuple.length !== 6 && tuple.length !== 8)) continue;
    const id = typeof tuple[0] === "string" ? tuple[0] : undefined;
    const kind = pick(PROJECTILE, tuple[1]);
    const x = dec(tuple[2], FLIGHT), y = dec(tuple[3], FLIGHT), vx = dec(tuple[4], FLIGHT), vy = dec(tuple[5], FLIGHT);
    const back = tuple.length === 8 ? dec(tuple[6], MS) : 0, range = tuple.length === 8 ? dec(tuple[7], 1) : kind && DEFAULT_RANGE[kind];
    if (
      id === undefined || kind === undefined || x === undefined || y === undefined || vx === undefined || vy === undefined
      || back === undefined || range === undefined
    ) continue;
    const targetId = targets.get(id);
    out.push({ id, kind, x, y, vx, vy, t: t - back, range, ...(targetId ? { targetId } : {}) });
  }
  return out;
}

function unpackOne(tuple: unknown, names: Names, t: number): FxEvent | null {
  if (!Array.isArray(tuple)) return null;
  const kind = pick(KIND, tuple[0]);
  switch (kind) {
    case "windup": {
      const by = str(tuple[1], names), weapon = pick(WEAPON, tuple[2]), a = dec(tuple[3], ANGLE), ms = dec(tuple[4], MS);
      return by !== undefined && weapon !== undefined && a !== undefined && ms !== undefined ? { kind, by, weapon, a, ms } : null;
    }
    case "swing": {
      const by = str(tuple[1], names), weapon = pick(WEAPON, tuple[2]);
      const x = dec(tuple[3], POS), y = dec(tuple[4], POS), a = dec(tuple[5], ANGLE);
      return by !== undefined && weapon !== undefined && x !== undefined && y !== undefined && a !== undefined
        ? { kind, by, weapon, x, y, a }
        : null;
    }
    case "hit": {
      const id = str(tuple[1], names), by = strOrNull(tuple[2], names), amount = dec(tuple[3], AMOUNT), raw = tuple[4];
      if (id === undefined || by === undefined || amount === undefined || typeof raw !== "number" || !(raw >= 0)) return null;
      const crit = raw >= HIT_CRIT;
      const flags = crit ? raw - HIT_CRIT : raw;
      const w = flags % HIT_RADIX, code = Math.floor(flags / HIT_RADIX);
      const weapon = w === 0 ? null : WEAPON.name[w - 1];
      if (weapon === undefined) return null;
      // A fifth field is the ability (a bad code loses the tuple: it would otherwise read as a plain hit).
      const ability = tuple.length > 5 ? pick(ABILITY, tuple[5]) : undefined;
      if (tuple.length > 5 && ability === undefined) return null;
      const sig = code === 0 ? undefined : SIG.name[code - 1];
      if (code !== 0 && sig === undefined) return null;
      const hit: Extract<FxEvent, { kind: "hit" }> = { kind, id, by, amount, weapon };
      if (sig !== undefined) hit.sig = sig;
      if (ability !== undefined) hit.ability = ability;
      if (crit) hit.crit = true;
      return hit;
    }
    case "block": {
      const id = str(tuple[1], names), by = str(tuple[2], names), weapon = pick(WEAPON, tuple[3]);
      if (id === undefined || by === undefined || weapon === undefined) return null;
      return tuple[4] === 1 ? { kind, id, by, weapon, passive: true } : { kind, id, by, weapon };
    }
    case "stagger": {
      const id = str(tuple[1], names);
      return id !== undefined ? { kind, id } : null;
    }
    case "cancel": {
      const id = str(tuple[1], names);
      return id !== undefined ? { kind, id } : null;
    }
    case "projEnd": {
      const id = str(tuple[1], names), proj = pick(PROJECTILE, tuple[2]), reason = pick(END, tuple[3]);
      const x = dec(tuple[4], POS), y = dec(tuple[5], POS);
      // Without a start (the client has the projectile in the state) it decodes as no flight at all: from (x, y), at `t`.
      const short = tuple.length < 7;
      const x0 = short ? x : dec(tuple[6], POS), y0 = short ? y : dec(tuple[7], POS), t0 = short ? t : dec(tuple[8], MS);
      return id !== undefined && proj !== undefined && reason !== undefined && x !== undefined && y !== undefined
        && x0 !== undefined && y0 !== undefined && t0 !== undefined
        ? { kind, id, proj, x0, y0, t0, x, y, reason }
        : null;
    }
    case "death": {
      const id = str(tuple[1], names), x = dec(tuple[2], POS), y = dec(tuple[3], POS), by = strOrNull(tuple[4], names);
      return id !== undefined && x !== undefined && y !== undefined && by !== undefined ? { kind, id, x, y, by } : null;
    }
    case "heal": {
      const id = str(tuple[1], names), amount = dec(tuple[2], AMOUNT);
      return id !== undefined && amount !== undefined ? { kind, id, amount } : null;
    }
    case "teleport":
      return { kind };
    case "bounty": {
      const id = str(tuple[1], names), name = str(tuple[2], names), bounty = dec(tuple[3], 1);
      return id !== undefined && name !== undefined && bounty !== undefined ? { kind, id, name, bounty } : null;
    }
    // "buff" and "combo" (retired) and unknown codes fall through to null: onDrop hears of them.
    case "victory": {
      const id = strOrNull(tuple[1], names), name = strOrNull(tuple[2], names), draw = flag(tuple[3]);
      return id !== undefined && name !== undefined && draw !== undefined ? { kind, id, name, draw } : null;
    }
    case "cast": {
      const by = str(tuple[1], names), ability = pick(ABILITY, tuple[2]), ms = dec(tuple[3], MS);
      const target = strOrNull(tuple[4], names), x = dec(tuple[5], POS), y = dec(tuple[6], POS);
      return by !== undefined && ability !== undefined && ms !== undefined && target !== undefined && x !== undefined && y !== undefined
        ? { kind, by, ability, ms, target, x, y }
        : null;
    }
    case "castLand": {
      const by = str(tuple[1], names), ability = pick(ABILITY, tuple[2]), target = strOrNull(tuple[3], names);
      const x = dec(tuple[4], POS), y = dec(tuple[5], POS);
      if (by === undefined || ability === undefined || target === undefined || x === undefined || y === undefined) return null;
      if (tuple.length <= 6) return { kind, by, ability, target, x, y };
      // x2 and y2 only come together.
      const x2 = dec(tuple[6], POS), y2 = dec(tuple[7], POS);
      return x2 !== undefined && y2 !== undefined ? { kind, by, ability, target, x, y, x2, y2 } : null;
    }
    case "castEnd": {
      const by = str(tuple[1], names), ability = pick(ABILITY, tuple[2]), reason = pick(CAST_END, tuple[3]);
      return by !== undefined && ability !== undefined && reason !== undefined ? { kind, by, ability, reason } : null;
    }
    case "status": {
      const id = str(tuple[1], names), status = pick(STATUS, tuple[2]), ms = dec(tuple[3], MS), by = strOrNull(tuple[4], names);
      return id !== undefined && status !== undefined && ms !== undefined && by !== undefined ? { kind, id, status, ms, by } : null;
    }
    case "campCleared": {
      const camp = tuple[1];
      return typeof camp === "number" && Number.isInteger(camp) && camp >= 0 ? { kind, camp } : null;
    }
    case "chestTaken": {
      // The chest is a container id, never a roster entry: it must arrive as a string.
      const chest = typeof tuple[1] === "string" ? tuple[1] : undefined, by = str(tuple[2], names), option = tuple[3];
      return chest !== undefined && by !== undefined && typeof option === "number" && Number.isInteger(option) && option >= -1
        ? { kind, chest, by, option }
        : null;
    }
    case "campHeal": {
      const id = str(tuple[1], names), camp = tuple[2], amount = dec(tuple[3], AMOUNT);
      return id !== undefined && typeof camp === "number" && Number.isInteger(camp) && camp >= 0 && amount !== undefined
        ? { kind, id, camp, amount }
        : null;
    }
    default:
      return null;
  }
}
