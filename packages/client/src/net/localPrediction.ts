// What the client knows about its own fighter's speed and roots, for LocalMotion (net/localMotion.ts): the synced stat mirrors'
// walking speed, attack speed and windup (never the buff stacks or any effect: whatever feeds the mirrors, the server folds it
// and the client reads the decoded result), the chill, the axe's root after its swing. Presentation only, and only as good as
// the client's knowledge: anything it gets wrong the server's samples correct (a wrong guess costs a small slide, never a
// wrong position).
import {
  attackInterval, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, decodeMult, FACTIONS, isFactionId, scaleWindup, SIG_CHILLED, weaponTimings,
  type FactionSpec, type TimedFx, type WeaponTimings,
} from "@raid/shared";
import { LocalMotion, type FrameInput } from "./localMotion";

/** The synced fields of the local player this reads. */
export interface LocalFighter {
  x: number;
  y: number;
  faction: string;
  sig: number;
  /** The stat mirrors (wire form, thousandths; decodeMult): the attack speed, windup and walking speed the server simulates with. */
  asMult: number;
  windupMult: number;
  speedMult: number;
}

/** Another player, as far as the chill needs to know. */
export interface OtherFighter { x: number; y: number; faction: string; status: string }

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

  /** The next order number: 1..255 and round again (0 is "no order yet" in `moveSeq`). */
  nextSeq(): number {
    this.seq = (this.seq % 255) + 1;
    return this.seq;
  }

  reset(): void {
    this.motion.reset();
    this.seq = 0;
    this.axeRoot = null;
  }

  /** An fx batch event: the ones about the local fighter that change how it can walk. */
  noteFx(fx: TimedFx, localId: string, me: LocalFighter | undefined): void {
    switch (fx.kind) {
      case "windup": {
        if (fx.by !== localId || fx.weapon !== "axe") break;
        // The axe roots from its start for `root` seconds (weapons.ts; the server's rootUntil), and the swing lands `fx.ms` in:
        // what follows the landing is the root this knows. The mirrors (attack speed, windup) shape both, as the server's timingsOf.
        const f = me && isFactionId(me.faction) ? FACTIONS[me.faction] : null;
        const lands = fx.t + fx.ms;
        const root = f && me ? axeTimings(f, me).root * 1000 : 2 * fx.ms;
        this.axeRoot = { from: lands, until: Math.max(lands, fx.t + root) };
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
          // A training room puts the fighter back on its feet in place, with no walk left: the sample that follows snaps.
          this.motion.cut(fx.t);
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
      speedMult: me ? this.speedMult(me, others) : 1,
      rooted: this.axeRoot !== null && t >= this.axeRoot.from && t < this.axeRoot.until,
      aiming,
    };
  }

  /** The walk speed multiplier: the speed mirror (the server's own number, whatever feeds it), and the chill. */
  speedMult(me: LocalFighter, others: Iterable<OtherFighter>): number {
    let m = decodeMult(me.speedMult);
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

/** The axe's timings with this fighter's mirrors applied: the server's timingsOf (attack speed, then the windup mirror). */
function axeTimings(faction: FactionSpec, me: LocalFighter): WeaponTimings {
  return scaleWindup(weaponTimings("axe", attackInterval(faction, "axe", decodeMult(me.asMult))), decodeMult(me.windupMult));
}
