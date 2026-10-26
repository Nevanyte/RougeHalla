// When and where a bot casts an ability, by the intent its def is tagged with (`AbilityDef.ai`), never by ability id (D29): one
// policy per intent serves every Wish and every skill a later phase adds, and a mob's casting can read the same tags. Pure:
// the bot describes the situation it can see and gets the cast it should send (the cursor point, and a unit target's id), or null.
//
// The intents are tried in the order the def lists them, and the first that fires decides:
//   escape   in trouble (low hp with a threat close, or low hp and being hit): a self cast goes as it is; a point cast (a blink)
//            goes away from the threat, at the first of a few headings that has a valid landing; a unit cast is not an escape
//   sustain  low hp and being hit: a self cast
//   engage / control   a targetable PLAYER foe in line of sight within the ability's range: a unit cast on it, or a point or
//            direction toward it (a blink stops short of it)
//   peel     a targetable enemy right on us and chasing: a unit cast on it
//   burst / zone / buff   not used until skills arrive
// Nothing is cast while a status the def lists as blocking is on the bot, or while it is already casting.
import {
  blinkLanding, EFFECT_CASTING, EFFECT_ROOTED, EFFECT_SILENCED, EFFECT_STUNNED, rankOf,
  type AbilityDef, type AbilityEffect, type GameMap, type TargetRule, type Vec2,
} from "@raid/shared";

export interface CastSituation {
  me: { x: number; y: number; hpFrac: number; effects: number; recentlyHit: boolean };
  /** What the bot fights now (a player or a mob, `mob`), if anything. A once-a-run ability is never spent on a mob to engage or control it. */
  foe: { id: string; x: number; y: number; d: number; los: boolean; targetable: boolean; mob?: boolean } | null;
  /** The nearest enemy player. `id`, `los` and `targetable` are only needed to peel with a unit cast (absent: it cannot). */
  threat: { x: number; y: number; d: number; chasing: boolean; id?: string; los?: boolean; targetable?: boolean } | null;
  map: GameMap;
  gatesLocked: boolean;
}

export interface CastChoice { x: number; y: number; id?: string }

/** In trouble: this close with low hp... */
export const ESCAPE_THREAT_DISTANCE = 260;
export const ESCAPE_HP_THREATENED = 0.5;
/** ...or this low while being hit. */
export const ESCAPE_HP_HIT = 0.55;
/** A last-ditch heal waits for this much hp (and being hit). */
export const SUSTAIN_HP = 0.35;
/** A unit cast starts this much inside its range, so a foe walking off does not make it fizzle. */
export const ENGAGE_RANGE_MARGIN = 16;
/** An enemy this close that is chasing us is worth peeling. */
export const PEEL_DISTANCE = 150;
/** A blink to close a gap is worth it from this far, and stops this far short of the foe. */
export const ENGAGE_BLINK_MIN_DISTANCE = 120;
export const ENGAGE_BLINK_STOP_SHORT = 40;

const BLOCK_BITS = { stun: EFFECT_STUNNED, silence: EFFECT_SILENCED, root: EFFECT_ROOTED } as const;

/** Headings tried for an escaping blink, as angles off straight away from the threat. */
const ESCAPE_HEADINGS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, -(3 * Math.PI) / 4];

/** The cast to send for `def` at `rank` in this situation, or null. */
export function decideCast(def: AbilityDef, rank: number, s: CastSituation): CastChoice | null {
  if ((s.me.effects & EFFECT_CASTING) !== 0) return null;
  for (const b of def.blockedBy) if ((s.me.effects & BLOCK_BITS[b]) !== 0) return null;
  const r = rankOf(def, rank);
  for (const intent of def.ai) {
    let choice: CastChoice | null = null;
    switch (intent) {
      case "escape": choice = escape(r.targeting, r.effects, s); break;
      case "sustain": choice = s.me.hpFrac < SUSTAIN_HP && s.me.recentlyHit && r.targeting.kind === "self" ? self(s) : null; break;
      case "engage":
      case "control": choice = engage(r.targeting, r.effects, s); break;
      case "peel": choice = peel(r.targeting, s); break;
      case "burst":
      case "zone":
      case "buff":
        break;
      default: {
        const unknown: never = intent;
        void unknown;
      }
    }
    if (choice) return choice;
  }
  return null;
}

const self = (s: CastSituation): CastChoice => ({ x: s.me.x, y: s.me.y });

function blinkOf(effects: readonly AbilityEffect[]): Extract<AbilityEffect, { do: "blink" }> | undefined {
  for (const e of effects) if (e.do === "blink") return e;
  return undefined;
}

/** Valid landing for a blink toward `to` (the server's own rule: shared/blink.ts), or null. */
function landing(blink: Extract<AbilityEffect, { do: "blink" }>, s: CastSituation, to: Vec2): Vec2 | null {
  return blinkLanding(s.map, s.gatesLocked, s.me, to, blink.maxDist, blink.minDist);
}

function escape(rule: TargetRule, effects: readonly AbilityEffect[], s: CastSituation): CastChoice | null {
  const m = s.me;
  const trouble = (m.hpFrac < ESCAPE_HP_THREATENED && s.threat !== null && s.threat.d < ESCAPE_THREAT_DISTANCE)
    || (m.hpFrac < ESCAPE_HP_HIT && m.recentlyHit);
  if (!trouble) return null;
  if (rule.kind === "self") return self(s);
  if (rule.kind === "unit") return null;
  // Away from the enemy that is on us; failing that, away from what we are fighting.
  const from = s.threat ?? s.foe;
  if (!from) return null;
  const dx = m.x - from.x;
  const dy = m.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0.5)) return null;
  const range = rule.kind === "point" ? rule.range : 300;
  const blink = blinkOf(effects);
  const base = Math.atan2(dy, dx);
  for (const turn of ESCAPE_HEADINGS) {
    const to = { x: m.x + Math.cos(base + turn) * range, y: m.y + Math.sin(base + turn) * range };
    if (blink) {
      const at = landing(blink, s, to);
      // A landing that does not get further from the enemy is no escape.
      if (at && Math.hypot(at.x - from.x, at.y - from.y) > len + 24) return to;
    } else if (turn === 0) {
      return to;
    }
  }
  return null;
}

function engage(rule: TargetRule, effects: readonly AbilityEffect[], s: CastSituation): CastChoice | null {
  const f = s.foe;
  if (!f || !f.targetable || f.mob) return null;
  if (rule.kind === "unit") {
    if (!f.los || f.d > rule.range - ENGAGE_RANGE_MARGIN) return null;
    return { x: f.x, y: f.y, id: f.id };
  }
  if (rule.kind === "dir") return f.los ? { x: f.x, y: f.y } : null;
  if (rule.kind === "point") {
    // A blink to close a gap: only a gap worth it and within reach, landing next to the foe rather than on it.
    if (f.d < ENGAGE_BLINK_MIN_DISTANCE || f.d > rule.range - ENGAGE_RANGE_MARGIN) return null;
    const k = Math.max(0, f.d - ENGAGE_BLINK_STOP_SHORT) / f.d;
    const to = { x: s.me.x + (f.x - s.me.x) * k, y: s.me.y + (f.y - s.me.y) * k };
    const blink = blinkOf(effects);
    if (blink && !landing(blink, s, to)) return null;
    return to;
  }
  return null;
}

function peel(rule: TargetRule, s: CastSituation): CastChoice | null {
  const t = s.threat;
  if (!t || !t.chasing || t.d > PEEL_DISTANCE || t.targetable === false) return null;
  if (rule.kind === "unit") {
    if (t.id === undefined || t.los === false || t.d > rule.range - ENGAGE_RANGE_MARGIN) return null;
    return { x: t.x, y: t.y, id: t.id };
  }
  return null;
}
