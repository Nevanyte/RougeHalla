// What the client knows about its own fighter's speed and roots, for LocalMotion (net/localMotion.ts): the synced stat mirrors'
// walking speed and attack speed (never the buff stacks: later effects feed the mirrors too), a kill's burst, the chill, the
// axe's root after its swing. Presentation only, and only as good as the client's knowledge: anything it gets wrong the server's
// samples correct (a wrong guess costs a small slide, never a wrong position).
import {
  attackInterval, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, decodeMult, FACTIONS, isFactionId, killEffects, SIG_CHILLED, weaponTimings,
  type TimedFx,
} from "@raid/shared";
import { LocalMotion, type FrameInput } from "./localMotion";

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
  /** The stat mirrors (wire form; decodeMult): the attack and walking speed the server simulates with. */
  asMult: number;
  speedMult: number;
}

/** Another player, as far as the chill needs to know. */
export interface OtherFighter { x: number; y: number; faction: string; status: string }

interface Burst { mult: number; from: number; until: number }

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

export class LocalPrediction {
  readonly motion = new LocalMotion();
  private seq = 0;
  /** The axe's root after its swing has landed, in server time: [from, until). */
  private axeRoot: { from: number; until: number } | null = null;
  private bursts: Burst[] = [];

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
      case "death":
        if (fx.id === localId) {
          this.axeRoot = null;
          this.bursts = [];
          // A training room puts the fighter back on its feet in place, with no walk left: the sample that follows snaps.
          this.motion.cut(fx.t);
        }
        if (fx.by === localId && me) {
          const { bursts } = killEffects({ hp: me.stacksHp, attackSpeed: me.stacksAs, moveSpeed: me.stacksMs });
          for (const b of bursts) this.bursts.push({ mult: b.mult, from: fx.t, until: fx.t + b.ms });
        }
        break;
      case "teleport":
        // Everyone is moved and every walk cancelled: the sample from this tick on is a cut, however short the jump.
        this.axeRoot = null;
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
   * time the speed and the root are judged at.
   */
  frameInput(c: number, active: boolean, me: LocalFighter | undefined, others: Iterable<OtherFighter>, aiming: boolean): FrameInput {
    const t = c + this.motion.delay;
    return {
      alive: active,
      speedMult: me ? this.speedMult(t, me, others) : 1,
      rooted: this.axeRoot !== null && t >= this.axeRoot.from && t < this.axeRoot.until,
      aiming,
    };
  }

  /** The walk speed multiplier at server time `t`: the speed mirror, the strongest kill burst running, and the chill. */
  speedMult(t: number, me: LocalFighter, others: Iterable<OtherFighter>): number {
    let m = decodeMult(me.speedMult);
    let best = 1;
    for (let i = this.bursts.length - 1; i >= 0; i--) if (t >= this.bursts[i]!.until + 2000) this.bursts.splice(i, 1);
    for (const b of this.bursts) if (t >= b.from && t < b.until && b.mult > best) best = b.mult;
    m *= best;
    // The server slows a fighter it is chilling when the Frost doing it is within CHILL_MOVE_RADIUS; here: any Frost that close.
    if ((me.sig & SIG_CHILLED) !== 0) {
      for (const o of others) {
        if (o.faction === "frost" && o.status === "alive" && Math.hypot(o.x - me.x, o.y - me.y) <= CHILL_MOVE_RADIUS) {
          m *= CHILL_MOVE_MULT;
          break;
        }
      }
    }
    return m;
  }

  private dropRootBefore(t: number): void {
    if (this.axeRoot && t < this.axeRoot.from) this.axeRoot = null;
  }
}
