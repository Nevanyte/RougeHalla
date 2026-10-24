// Compact wire form of the fx events: one `fxs` message per simulation step instead of one message per event.
//
// A batch is `{ t, l }`: `t` is the server time of the step, `l` holds one tuple per fx, in emit order:
// `[kindCode, ...fields]`. A tuple holds integers, strings and nulls only, because msgpack sends any fraction as a 9 byte
// float64 while a small integer takes 1 to 3 bytes. Fractions are scaled to integers (FX_SCALE), so a decoded value is
// within half a step of the original, and nothing else about an event changes:
//   positions (x, y, x0, y0)    whole units
//   angles (a)                  hundredths of a radian
//   hit and heal amounts        tenths
//   buff stacks and total       thousandths
//   windup ms, projEnd t0       whole ms (the batch `t` stays exact)
// Weapons, projectile kinds, end reasons, buff stats and combos travel as indices into the tables below. They are wire
// format: client and server ship together, so a table may grow at its end but must never be reordered.
//
// Tuple layouts ([0] is always the kind code; `W` = weapon code, null where the type allows null):
//   windup   [by, W, a, ms]                 swing    [by, W, x, y, a]
//   hit      [id, by|null, amount, W|null, sig?]   (sig: a SIG code; the element is left off when there is none)
//   block    [id, by, W, passive?]          (passive: 1; left off when false)
//   stagger  [id]                           teleport []
//   projEnd  [id, proj, reason, x, y, x0, y0, t0]   (x0, y0, t0: where and when it was loosed, kept for a projectile no
//                                            patch ever showed, e.g. an arrow reflected and stopped within one tick)
//   death    [id, x, y, by|null]            heal     [id, amount]
//   bounty   [id, name, bounty]             buff     [id, stat, stacks, total]
//   combo    [id, combo, proc 0|1]          victory  [id|null, name|null, draw 0|1]
// Adding a field to an FxEvent means adding it to its tuple here (and to the round-trip test).
import type { BuffStat, ComboId } from "./buffs";
import type { SignatureKind } from "./signatures";
import type { FxBatch, FxEvent, FxTuple, ProjectileEnd, TimedFx } from "./messages";
import type { ProjectileKind, WeaponId } from "./weapons";

/** Units per integer step on the wire: an angle of 1.5707 is sent as 157 and decodes to 1.57. */
export const FX_SCALE = { pos: 1, angle: 100, amount: 10, stacks: 1000, ms: 1 } as const;

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

const KIND = table<FxEvent["kind"]>({
  windup: 0, swing: 1, hit: 2, block: 3, stagger: 4, projEnd: 5, death: 6, heal: 7, teleport: 8, bounty: 9, buff: 10, combo: 11,
  victory: 12,
});
const WEAPON = table<WeaponId>({ sword: 0, bow: 1, wand: 2, shield: 3, axe: 4 });
const PROJECTILE = table<ProjectileKind>({ arrow: 0, ball: 1 });
const END = table<ProjectileEnd>({ hit: 0, wall: 1, range: 2, reflected: 3, deleted: 4, destroyed: 5, cleared: 6, blocked: 7 });
const SIG = table<SignatureKind>({ burn: 0, backlash: 1, disease: 2, mark: 3 });
const STAT = table<BuffStat>({ hp: 0, attackSpeed: 1, moveSpeed: 2 });
const COMBO = table<ComboId>({ dash: 0, cascade: 1, shield: 2, bulwark: 3, bloodrush: 4, frenzy: 5 });

const KC = KIND.code;
const { pos: POS, angle: ANGLE, amount: AMOUNT, stacks: STACKS, ms: MS } = FX_SCALE;

/** `+ 0` turns a -0 (what rounding a tiny negative gives) into 0, which msgpack and equality checks treat alike. */
const enc = (v: number, scale: number): number => Math.round(v * scale) + 0;
const wcode = (w: WeaponId | null | undefined): number | null => (w == null ? null : WEAPON.code[w]);

/** Every event of one step as a batch. `t` is that step's server time. An event of a kind this file does not know is dropped. */
export function packFx(fxs: readonly FxEvent[], t: number): FxBatch {
  const l: FxTuple[] = [];
  for (const fx of fxs) {
    const tuple = packOne(fx);
    if (tuple) l.push(tuple);
  }
  return { t, l };
}

function packOne(fx: FxEvent): FxTuple | null {
  switch (fx.kind) {
    case "windup": return [KC.windup, fx.by, WEAPON.code[fx.weapon], enc(fx.a, ANGLE), enc(fx.ms, MS)];
    case "swing": return [KC.swing, fx.by, WEAPON.code[fx.weapon], enc(fx.x, POS), enc(fx.y, POS), enc(fx.a, ANGLE)];
    case "hit": {
      const tuple: FxTuple = [KC.hit, fx.id, fx.by ?? null, enc(fx.amount, AMOUNT), wcode(fx.weapon)];
      if (fx.sig !== undefined) tuple.push(SIG.code[fx.sig]);
      return tuple;
    }
    case "block": {
      const tuple: FxTuple = [KC.block, fx.id, fx.by, WEAPON.code[fx.weapon]];
      if (fx.passive) tuple.push(1);
      return tuple;
    }
    case "stagger": return [KC.stagger, fx.id];
    case "projEnd":
      return [
        KC.projEnd, fx.id, PROJECTILE.code[fx.proj], END.code[fx.reason], enc(fx.x, POS), enc(fx.y, POS), enc(fx.x0, POS),
        enc(fx.y0, POS), enc(fx.t0, MS),
      ];
    case "death": return [KC.death, fx.id, enc(fx.x, POS), enc(fx.y, POS), fx.by ?? null];
    case "heal": return [KC.heal, fx.id, enc(fx.amount, AMOUNT)];
    case "teleport": return [KC.teleport];
    case "bounty": return [KC.bounty, fx.id, fx.name, Math.round(fx.bounty) + 0];
    case "buff": return [KC.buff, fx.id, STAT.code[fx.stat], enc(fx.stacks, STACKS), enc(fx.total, STACKS)];
    case "combo": return [KC.combo, fx.id, COMBO.code[fx.combo], fx.proc ? 1 : 0];
    case "victory": return [KC.victory, fx.id ?? null, fx.name ?? null, fx.draw ? 1 : 0];
    default: {
      const unknown: never = fx;
      void unknown;
      return null;
    }
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strOrNull = (v: unknown): string | null | undefined => (v === null ? null : str(v));
const flag = (v: unknown): boolean | undefined => (v === 1 ? true : v === 0 ? false : undefined);
/** A scaled integer back to its value; undefined for anything that is not a finite number. */
const dec = (v: unknown, scale: number): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v / scale : undefined);
/** The member a code stands for; undefined for a code the table does not have. */
const pick = <K extends string>(t: Table<K>, v: unknown): K | undefined => (typeof v === "number" ? t.name[v] : undefined);
const pickOrNull = <K extends string>(t: Table<K>, v: unknown): K | null | undefined => (v === null ? null : pick(t, v));

/**
 * The events of a batch, each stamped with the batch's `t`. A tuple the client does not understand (an unknown kind code
 * from a newer server, a missing or mistyped field) is skipped, never thrown on: the rest of the batch still plays.
 */
export function unpackFx(batch: FxBatch): TimedFx[] {
  const out: TimedFx[] = [];
  const t = batch?.t;
  if (typeof t !== "number" || !Number.isFinite(t) || !Array.isArray(batch.l)) return out;
  for (const tuple of batch.l) {
    const fx = unpackOne(tuple);
    if (fx) out.push({ ...fx, t });
  }
  return out;
}

function unpackOne(tuple: unknown): FxEvent | null {
  if (!Array.isArray(tuple)) return null;
  const kind = pick(KIND, tuple[0]);
  switch (kind) {
    case "windup": {
      const by = str(tuple[1]), weapon = pick(WEAPON, tuple[2]), a = dec(tuple[3], ANGLE), ms = dec(tuple[4], MS);
      return by !== undefined && weapon !== undefined && a !== undefined && ms !== undefined ? { kind, by, weapon, a, ms } : null;
    }
    case "swing": {
      const by = str(tuple[1]), weapon = pick(WEAPON, tuple[2]);
      const x = dec(tuple[3], POS), y = dec(tuple[4], POS), a = dec(tuple[5], ANGLE);
      return by !== undefined && weapon !== undefined && x !== undefined && y !== undefined && a !== undefined
        ? { kind, by, weapon, x, y, a }
        : null;
    }
    case "hit": {
      const id = str(tuple[1]), by = strOrNull(tuple[2]), amount = dec(tuple[3], AMOUNT), weapon = pickOrNull(WEAPON, tuple[4]);
      if (id === undefined || by === undefined || amount === undefined || weapon === undefined) return null;
      if (tuple[5] === undefined) return { kind, id, by, amount, weapon };
      const sig = pick(SIG, tuple[5]);
      return sig !== undefined ? { kind, id, by, amount, weapon, sig } : null;
    }
    case "block": {
      const id = str(tuple[1]), by = str(tuple[2]), weapon = pick(WEAPON, tuple[3]);
      if (id === undefined || by === undefined || weapon === undefined) return null;
      return tuple[4] === 1 ? { kind, id, by, weapon, passive: true } : { kind, id, by, weapon };
    }
    case "stagger": {
      const id = str(tuple[1]);
      return id !== undefined ? { kind, id } : null;
    }
    case "projEnd": {
      const id = str(tuple[1]), proj = pick(PROJECTILE, tuple[2]), reason = pick(END, tuple[3]);
      const x = dec(tuple[4], POS), y = dec(tuple[5], POS), x0 = dec(tuple[6], POS), y0 = dec(tuple[7], POS), t0 = dec(tuple[8], MS);
      return id !== undefined && proj !== undefined && reason !== undefined && x !== undefined && y !== undefined
        && x0 !== undefined && y0 !== undefined && t0 !== undefined
        ? { kind, id, proj, x0, y0, t0, x, y, reason }
        : null;
    }
    case "death": {
      const id = str(tuple[1]), x = dec(tuple[2], POS), y = dec(tuple[3], POS), by = strOrNull(tuple[4]);
      return id !== undefined && x !== undefined && y !== undefined && by !== undefined ? { kind, id, x, y, by } : null;
    }
    case "heal": {
      const id = str(tuple[1]), amount = dec(tuple[2], AMOUNT);
      return id !== undefined && amount !== undefined ? { kind, id, amount } : null;
    }
    case "teleport":
      return { kind };
    case "bounty": {
      const id = str(tuple[1]), name = str(tuple[2]), bounty = dec(tuple[3], 1);
      return id !== undefined && name !== undefined && bounty !== undefined ? { kind, id, name, bounty } : null;
    }
    case "buff": {
      const id = str(tuple[1]), stat = pick(STAT, tuple[2]), stacks = dec(tuple[3], STACKS), total = dec(tuple[4], STACKS);
      return id !== undefined && stat !== undefined && stacks !== undefined && total !== undefined
        ? { kind, id, stat, stacks, total }
        : null;
    }
    case "combo": {
      const id = str(tuple[1]), combo = pick(COMBO, tuple[2]), proc = flag(tuple[3]);
      return id !== undefined && combo !== undefined && proc !== undefined ? { kind, id, combo, proc } : null;
    }
    case "victory": {
      const id = strOrNull(tuple[1]), name = strOrNull(tuple[2]), draw = flag(tuple[3]);
      return id !== undefined && name !== undefined && draw !== undefined ? { kind, id, name, draw } : null;
    }
    default:
      return null;
  }
}
