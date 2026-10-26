// What the client knows about its own fighter's speed and roots, for LocalMotion (net/localMotion.ts): the synced stat mirrors'
// walking speed and attack speed (never the buff stacks: later effects feed the mirrors too), a kill's burst, the chill, the
// axe's root after its swing, and what the abilities do to it: a stun or a root, a cast's own root, Last Stand's haste, and a
// blink (`noteCast`, which the scene calls when the player casts). Presentation only, and only as good as the client's
// knowledge: anything it gets wrong the server's samples correct (a wrong guess costs a small slide, never a wrong position).
// Slow magnitudes are not predicted (only a bit is synced) until the stat mirrors carry them. The ground is: the bog's slow is
// read at the MODEL's position (where the server will be a delay later) and the product is floored as the server floors it, and
// the ice's traction under any point is handed to the motion (`FrameInput.slipAt`) so it can slide where the server slides.
import {
  attackInterval, CAST_TELEPORT_GRACE_MS, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, decodeMult, EFFECT_CASTING, EFFECT_HASTE, EFFECT_ROOTED, EFFECT_STUNNED,
  FACTIONS, hasteMultiplier, hazardsOf, isFactionId, killEffects, LAST_STAND_SPEED_BONUS, MOVE_MULT_FLOOR, SIG_CHILLED, surfaceAt, weaponTimings,
  type GameMap, type TimedFx, type Vec2,
} from "@raid/shared";
import { LocalMotion, ORDER_EXPIRE_MS, seqAcked, type AuthSample, type FrameInput } from "./localMotion";

/** The synced fields of the local player this reads. */
export interface LocalFighter {
  x: number;
  y: number;
  faction: string;
  sig: number;
  /** The buff stacks: they still drive the kill combos (a burst), not the speeds. */
  stacksHp: number;
  stacksAs: number;
  stacksMs: number;
  /** `PlayerState.effects` (EFFECT_* bits): the fallback for a stun, root, cast or haste no fx told of (a join mid-effect). */
  effects: number;
  /** The stat mirrors (wire form; decodeMult): the attack and walking speed the server simulates with. */
  asMult: number;
  speedMult: number;
}

/** Another player, as far as the chill needs to know. */
export interface OtherFighter { x: number; y: number; faction: string; status: string }

interface Burst { mult: number; from: number; until: number }
/** A span of server time [from, until) the fighter cannot walk: a stun or a root status, or a cast's own root. */
interface Root {
  kind: "status" | "cast";
  from: number;
  until: number;
  /** A cast root the client predicted: dropped at this client time unless a `cast` fx of ours replaced it by then... */
  expires?: number;
  /** ...or when the patch acks the cast's order number (`moveSeq`) without one: the server refused the cast. */
  seq?: number;
}
interface Haste { from: number; until: number; bonus: number }
/** How long (ms) after one ends a known root or haste still counts as "told by fx": the synced bit lags it, and must not extend it. */
const FX_GRACE_MS = 2000;

/** Where the local fighter is drawn from this frame. */
export type LocalDrawSource = "predicted" | "frozen" | "snapshot";

/**
 * The prediction while the fighter is on its feet in a running fight and the screen shows the world as it is now. Once the
 * patch says it is dead, or a teleport's fx has arrived, the state is ahead of what is drawn (everyone else is drawn 100 ms
 * back): until the death or the cut is due the fighter stays where it was last drawn (`frozen`), instead of being thrown back
 * to the snapshots. Anything else is drawn from the snapshots, like everyone.
 */
export function localDrawSource(s: {
  alive: boolean; running: boolean; ready: boolean; beforeCut: boolean; deathPending: boolean; hasFrozen: boolean;
}): LocalDrawSource {
  if (s.alive && s.running && s.ready && !s.beforeCut) return "predicted";
  return s.hasFrozen && (s.deathPending || s.beforeCut) ? "frozen" : "snapshot";
}

/** A cast just sent: its order number, what the slot's ready time was, and until when (client clock) the answer is waited for. */
export interface SentCast { slot: string; seq: number; readyAt: number; until: number }

/**
 * Whether the cast sent is still unanswered, so a second press of the slot is ignored: the patch has not shown the slot's new
 * ready time, the wait has not run out, and the server has not yet echoed the cast's order number (`orderPending`). A refused
 * cast is answered by that echo alone, which frees the slot at once however slow the link is; so does an order the prediction
 * has forgotten.
 */
export function castUnanswered(sent: SentCast | null, slot: string, now: number, readyAt: number, orderPending: boolean): boolean {
  return sent !== null && sent.slot === slot && now < sent.until && readyAt === sent.readyAt && orderPending;
}

/**
 * Whether a cast pressed at server time `serverNow` would reach the server inside CAST_TELEPORT_GRACE_MS of the coliseum
 * teleport (`teleportAt`, the fx's server time; 0 = none yet), which the server refuses for free. The client's clock lags the
 * server's by the downlink, so a press this check lets through arrives after the grace: it errs on the side of refusing.
 */
export function inTeleportGrace(teleportAt: number, serverNow: number): boolean {
  return teleportAt > 0 && serverNow < teleportAt + CAST_TELEPORT_GRACE_MS;
}

export class LocalPrediction {
  readonly motion = new LocalMotion();
  private seq = 0;
  /** The axe's root after its swing has landed, in server time: [from, until). */
  private axeRoot: { from: number; until: number } | null = null;
  private bursts: Burst[] = [];
  /** Server-time spans of stuns, roots and casts, and of haste (Last Stand), as the fx told them (or the cast predicted them). */
  private roots: Root[] = [];
  private hastes: Haste[] = [];
  /** The traction lookup handed to the motion, rebuilt only when the map or the faction it reads changes (a frame allocates nothing). */
  private slipFn: { map: GameMap; faction: string; at: (x: number, y: number) => number } | null = null;

  /** The next order number: 1..255 and round again (0 is "no order yet" in `moveSeq`). */
  nextSeq(): number {
    this.seq = (this.seq % 255) + 1;
    return this.seq;
  }

  reset(): void {
    this.motion.reset();
    this.seq = 0;
    this.axeRoot = null;
    this.bursts = [];
    this.roots = [];
    this.hastes = [];
    this.slipFn = null;
  }

  /**
   * The player just cast an ability at client clock `c`, carrying order number `seq` (every cast sends one: the server echoes it
   * in `moveSeq` whether it takes the cast or refuses it), and the client expects the server to take it (the way `expectLock`
   * expects a lock). A cast with a telegraph roots the fighter from the moment the server applies it, which is `motion.delay`
   * from now: that root is predicted here, and dropped unless a `cast` fx of ours confirms it: at the patch that acks `seq`
   * with none (a refusal), or at the latest ORDER_EXPIRE_MS later. A blink (`landing`: the shared `blinkLanding` the server
   * will also compute) moves the model at once (LocalMotion.blink); any other cast stands in the motion's order list, so
   * orders before it are acked with it.
   */
  noteCast(c: number, cast: { castMs: number; seq: number; blink?: { landing: Vec2 } }): void {
    if (cast.castMs > 0) {
      const from = c + this.motion.delay;
      this.roots.push({ kind: "cast", from, until: from + cast.castMs, expires: c + ORDER_EXPIRE_MS, seq: cast.seq });
    }
    if (cast.blink) this.motion.blink(cast.seq, c, cast.blink.landing);
    else this.motion.noteOrder(cast.seq, c);
  }

  /**
   * A patch arrived: the local fighter's server state. The motion takes it; and a predicted cast root whose order number the
   * patch acks with no `cast` fx of ours having replaced it was refused: it is dropped (the fx of a tick arrive before its patch).
   */
  observe(s: AuthSample, c: number): void {
    this.motion.observe(s, c);
    if (s.moveSeq === 0) return;
    for (let i = this.roots.length - 1; i >= 0; i--) {
      const r = this.roots[i]!;
      if (r.expires !== undefined && r.seq !== undefined && seqAcked(r.seq, s.moveSeq)) this.roots.splice(i, 1);
    }
  }

  /** The server time the local fighter's cast root (predicted or confirmed) ends, or 0 if none is running or due at `t`. */
  castEndsAt(t: number): number {
    let end = 0;
    for (const r of this.roots) if (r.kind === "cast" && r.until > t && r.until > end) end = r.until;
    return end;
  }

  /** An fx batch event: the ones about the local fighter that change how it can walk. */
  noteFx(fx: TimedFx, localId: string, me: LocalFighter | undefined): void {
    switch (fx.kind) {
      case "windup": {
        if (fx.by !== localId || fx.weapon !== "axe") break;
        // The axe roots from its start for twice its windup (weapons.ts): what follows the swing's landing is the root this knows.
        const f = me && isFactionId(me.faction) ? FACTIONS[me.faction] : null;
        const windup = f ? weaponTimings("axe", attackInterval(f, "axe", decodeMult(me!.asMult))).windup * 1000 : fx.ms;
        const lands = fx.t + fx.ms;
        this.axeRoot = { from: lands, until: lands + windup };
        break;
      }
      case "cancel":
      case "stagger":
        // Before it landed, the attack's root goes with it; after, it stays.
        if (fx.id === localId) this.dropRootBefore(fx.t);
        break;
      case "status":
        if (fx.id !== localId) break;
        if (fx.status === "stun" || fx.status === "root") this.roots.push({ kind: "status", from: fx.t, until: fx.t + fx.ms });
        else if (fx.status === "haste") this.hastes.push({ from: fx.t, until: fx.t + fx.ms, bonus: LAST_STAND_SPEED_BONUS });
        break;
      case "cast":
        if (fx.by !== localId) break;
        // The server's word replaces the one predicted at the key press.
        this.roots = this.roots.filter((r) => r.expires === undefined);
        if (fx.ms > 0) this.roots.push({ kind: "cast", from: fx.t, until: fx.t + fx.ms });
        break;
      case "castEnd":
        // Fizzled, interrupted or cancelled: the root goes with it, from the tick it ended.
        if (fx.by !== localId) break;
        for (const r of this.roots) if (r.kind === "cast" && r.until > fx.t) r.until = Math.max(r.from, fx.t);
        break;
      case "death":
        if (fx.id === localId) {
          this.axeRoot = null;
          this.bursts = [];
          this.roots = [];
          this.hastes = [];
          // A training room puts the fighter back on its feet in place, with no walk left: the sample that follows snaps.
          this.motion.cut(fx.t);
        }
        if (fx.by === localId && me) {
          const { bursts } = killEffects({ hp: me.stacksHp, attackSpeed: me.stacksAs, moveSpeed: me.stacksMs });
          for (const b of bursts) this.bursts.push({ mult: b.mult, from: fx.t, until: fx.t + b.ms });
        }
        break;
      case "teleport":
        // Everyone is moved and every walk cancelled: the sample from this tick on is a cut, however short the jump. Statuses end.
        this.axeRoot = null;
        this.roots = [];
        this.hastes = [];
        this.motion.cut(fx.t);
        break;
      default:
        break;
    }
  }

  /** The weapon in hand changed at server time `t` (a swap cancels an attack still winding up, and its root). */
  noteWeaponChange(t: number): void {
    this.dropRootBefore(t);
  }

  /**
   * What `LocalMotion.frame` is told. `c` is the client clock; the model runs `motion.delay` ahead of it, so that is the server
   * time the speed and the root are judged at. `map` is the one the scene plans on (the gated copy while the gates are locked;
   * its terrain is shared): the ground the model stands on slows it (bog) and lets it slide (ice). Null: plain ground.
   */
  frameInput(
    c: number, active: boolean, me: LocalFighter | undefined, others: Iterable<OtherFighter>, aiming: boolean, map: GameMap | null = null,
  ): FrameInput {
    const t = c + this.motion.delay;
    const input: FrameInput = {
      alive: active,
      speedMult: me ? this.speedMult(t, me, others, map) : 1,
      rooted: (this.axeRoot !== null && t >= this.axeRoot.from && t < this.axeRoot.until) || this.rootedAt(c, t, me),
      aiming,
    };
    const slipAt = me && map ? this.slipAtFor(map, me.faction) : undefined;
    if (slipAt && map) {
      input.slipAt = slipAt;
      input.map = map;
    }
    return input;
  }

  /** The slide traction under a point for a fighter of `faction` (0 for the faction that grips ice, and off ice); undefined on a map without ice. */
  private slipAtFor(map: GameMap, faction: string): ((x: number, y: number) => number) | undefined {
    if (!hazardsOf(map).slip) return undefined;
    const f = this.slipFn;
    if (f !== null && f.map === map && f.faction === faction) return f.at;
    const at = (x: number, y: number): number => surfaceAt(map, x, y, faction).accel;
    this.slipFn = { map, faction, at };
    return at;
  }

  /**
   * Whether a stun, a root or a cast holds the fighter at server time `t` (client clock `c`). The fx are what the client
   * trusts, as they carry the exact span; the synced bits only stand in when no fx told of any (a join in the middle of an
   * effect), since they lag an effect's end by a round trip and a delay.
   */
  private rootedAt(c: number, t: number, me: LocalFighter | undefined): boolean {
    for (let i = this.roots.length - 1; i >= 0; i--) {
      const r = this.roots[i]!;
      if ((r.expires !== undefined && c >= r.expires) || t >= r.until + FX_GRACE_MS) this.roots.splice(i, 1);
    }
    for (const r of this.roots) if (t >= r.from && t < r.until) return true;
    return this.roots.length === 0 && me !== undefined && (me.effects & (EFFECT_STUNNED | EFFECT_ROOTED | EFFECT_CASTING)) !== 0;
  }

  /** Last Stand's added speed (a share of PLAYER_SPEED) at server time `t`: what the fx told of, else the synced bit's. */
  private hasteAt(t: number, me: LocalFighter): number {
    for (let i = this.hastes.length - 1; i >= 0; i--) if (t >= this.hastes[i]!.until + FX_GRACE_MS) this.hastes.splice(i, 1);
    let bonus = 0;
    for (const h of this.hastes) if (t >= h.from && t < h.until && h.bonus > bonus) bonus = h.bonus;
    if (bonus === 0 && this.hastes.length === 0 && (me.effects & EFFECT_HASTE) !== 0) bonus = LAST_STAND_SPEED_BONUS;
    return bonus;
  }

  /**
   * The walk speed multiplier at server time `t`: the speed mirror, the strongest kill burst running, Last Stand's haste
   * (added on top, as the server adds it: `hasteMultiplier`), the chill, and the bog under the MODEL (`motion.predicted`: the
   * server meets that tile a delay from now, not the one it has the fighter on at the newest patch). The product is floored at
   * MOVE_MULT_FLOOR while above 0, as the server floors it; a root's 0 is the `rooted` flag, not this.
   */
  speedMult(t: number, me: LocalFighter, others: Iterable<OtherFighter>, map: GameMap | null = null): number {
    let m = decodeMult(me.speedMult);
    let best = 1;
    for (let i = this.bursts.length - 1; i >= 0; i--) if (t >= this.bursts[i]!.until + 2000) this.bursts.splice(i, 1);
    for (const b of this.bursts) if (t >= b.from && t < b.until && b.mult > best) best = b.mult;
    m *= best;
    const haste = this.hasteAt(t, me);
    if (haste > 0) m *= hasteMultiplier(m, haste);
    // The server slows a fighter it is chilling when the Frost doing it is within CHILL_MOVE_RADIUS; here: any Frost that close.
    if ((me.sig & SIG_CHILLED) !== 0) {
      for (const o of others) {
        if (o.faction === "frost" && o.status === "alive" && Math.hypot(o.x - me.x, o.y - me.y) <= CHILL_MOVE_RADIUS) {
          m *= CHILL_MOVE_MULT;
          break;
        }
      }
    }
    if (map && hazardsOf(map).slow) {
      const at = this.motion.predicted;
      m *= surfaceAt(map, at.x, at.y, me.faction).speedMult;
    }
    return m > 0 && m < MOVE_MULT_FLOOR ? MOVE_MULT_FLOOR : m;
  }

  private dropRootBefore(t: number): void {
    if (this.axeRoot && t < this.axeRoot.from) this.axeRoot = null;
  }
}
