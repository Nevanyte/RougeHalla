// What the client knows about its own fighter's speed and roots (net/localPrediction.ts): the synced stat mirrors in wire form
// (thousandths), the chill, and the axe's root. Nothing here reads the cards held or any kill: what a card does reaches the
// client only through the mirrors the server folds it into.
import { describe, expect, it } from "vitest";
import {
  attackInterval, CAST_TELEPORT_GRACE_MS, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, decodeMult, EFFECT_CASTING, EFFECT_HASTE, EFFECT_ROOTED,
  EFFECT_SILENCED, EFFECT_STUNNED, encodeMult, FACTIONS, hasteMultiplier, LAST_STAND_SPEED_BONUS, mapFromTiles, MOVE_MULT_FLOOR,
  PLAYER_SPEED, SIG_CHILLED, cardRows, SWIFT_BOOTS_PAUSE_MS, TERRAIN_BOG, TERRAIN_ICE, TILE, TILE_FLOOR, TILE_WALL,
  WIRE_IDENTITY_MIRRORS, weaponTimings, type GameMap, type TimedFx,
} from "@raid/shared";
import { ORDER_EXPIRE_MS } from "../src/net/localMotion";
import { LocalPrediction, castUnanswered, inTeleportGrace, localDrawSource, type LocalFighter, type OtherFighter, type SentCast } from "../src/net/localPrediction";

const ME = "me";
/** A fighter as the state carries it: the mirrors in wire form, the identity (1000 thousandths) unless given. */
const fighter = (o: Partial<LocalFighter> = {}): LocalFighter => ({
  x: 100, y: 100, faction: "fire", sig: 0, effects: 0, ...WIRE_IDENTITY_MIRRORS, ...o,
});
/** A fighter whose mirrors hold these multipliers, encoded as the server writes them. */
const mirrored = (m: { speed?: number; as?: number; windup?: number }, o: Partial<LocalFighter> = {}): LocalFighter =>
  fighter({
    speedMult: encodeMult(m.speed ?? 1), asMult: encodeMult(m.as ?? 1), windupMult: encodeMult(m.windup ?? 1), ...o,
  });
const other = (o: Partial<OtherFighter> = {}): OtherFighter => ({ x: 150, y: 100, faction: "frost", status: "alive", ...o });
const windup = (t: number, ms: number, weapon: "axe" | "sword" = "axe", by = ME): TimedFx => ({ kind: "windup", by, weapon, a: 0, ms, t });

describe("order numbers", () => {
  it("count 1..255 and round again, never 0 (the state's default 'no order yet')", () => {
    const p = new LocalPrediction();
    const seen = Array.from({ length: 600 }, () => p.nextSeq());
    expect(seen[0]).toBe(1);
    expect(seen[254]).toBe(255);
    expect(seen[255]).toBe(1);
    expect(seen.every((n) => n >= 1 && n <= 255 && Number.isInteger(n))).toBe(true);
  });

  it("restart after a reset", () => {
    const p = new LocalPrediction();
    p.nextSeq();
    p.nextSeq();
    p.reset();
    expect(p.nextSeq()).toBe(1);
  });
});

describe("walk speed", () => {
  const p = new LocalPrediction();

  it("is 1 with the identity mirrors (1000 thousandths): the plain walk", () => {
    expect(WIRE_IDENTITY_MIRRORS.speedMult).toBe(1000);
    expect(p.speedMult(0, fighter(), [])).toBe(1);
    expect(p.speedMult(0, mirrored({ speed: 1 }), [])).toBe(1);
  });

  it("follows the speed mirror, decoded from thousandths", () => {
    expect(p.speedMult(0, fighter({ speedMult: 1050 }), [])).toBe(1.05);
    expect(p.speedMult(0, mirrored({ speed: 1.37 }), [])).toBe(1.37);
    expect(p.speedMult(0, fighter({ speedMult: 700 }), [])).toBe(0.7);
    expect(p.speedMult(0, mirrored({ speed: 1.37 }), [])).toBe(decodeMult(1370));
  });

  it("reads the speed mirror and nothing else: the other mirrors, cards held and a kill do not move it", () => {
    const base = p.speedMult(0, mirrored({ speed: 1.1 }), []);
    expect(p.speedMult(0, mirrored({ speed: 1.1, as: 1.6, windup: 0.5 }), [])).toBe(base);
    // A fighter's cards (the state carries them) are not part of what the prediction is told.
    const held = { ...mirrored({ speed: 1.1 }), build: new Map([["fleet3", 9], ["haste2", 9]]) } as LocalFighter;
    expect(p.speedMult(0, held, [])).toBe(base);
    const q = new LocalPrediction();
    q.noteFx({ kind: "death", id: "foe", x: 0, y: 0, by: ME, t: 10_000 }, ME, held);
    expect(q.speedMult(0, held, [])).toBe(base);
  });

  it("is slowed only when chilled and a Frost is within the chill radius", () => {
    const chilled = fighter({ sig: SIG_CHILLED });
    expect(p.speedMult(0, chilled, [other({ x: 100 + CHILL_MOVE_RADIUS - 1 })])).toBe(CHILL_MOVE_MULT);
    expect(p.speedMult(0, chilled, [other({ x: 100 + CHILL_MOVE_RADIUS + 1 })])).toBe(1);
    expect(p.speedMult(0, chilled, [other({ faction: "fire" })])).toBe(1);
    expect(p.speedMult(0, chilled, [other({ status: "dead" })])).toBe(1);
    expect(p.speedMult(0, fighter(), [other()])).toBe(1); // not chilled: a Frost nearby does not slow it
    expect(p.speedMult(0, chilled, [])).toBe(1);
  });

  it("uses the synced thaw multiplier as the source of truth for prediction", () => {
    const wire = encodeMult(0.85);
    expect(p.speedMult(0, fighter({ frostMoveMult: wire }), [])).toBe(decodeMult(wire));
    expect(p.speedMult(0, fighter({ sig: SIG_CHILLED, frostMoveMult: 1000 }), [other()])).toBe(1);
    expect(p.speedMult(0, fighter({ frostMoveMult: wire }), [other({ faction: "fire" })])).toBe(decodeMult(wire));
  });

  it("Fleet: the walk is the mirror through the pause after a shot, which the server writes as 1.06 -> 1 -> 1.06 (Fleet I)", () => {
    // Owner ruling "No boost while shooting": the server turns the bonus off while a bow or wand attack winds up and for
    // SWIFT_BOOTS_PAUSE_MS after the shot, by patching `speedMult` (sim/mods.ts `notShooting`). The client knows no rule of its own:
    // it decodes whichever value the latest patch carries, on and off, exactly as the sim's movement multiplies it.
    for (const id of ["fleet1", "fleet2", "fleet3"] as const) {
      const row = cardRows(id)[0]!;
      expect(row).toMatchObject({ k: "while", cond: "notShooting", ms: SWIFT_BOOTS_PAUSE_MS });
      const on = decodeMult(encodeMult(1 + (row.k === "while" ? row.v : 0)));
      expect([1.06, 1.1, 1.15]).toContain(on);
      const sequence = [encodeMult(on), encodeMult(1), encodeMult(1), encodeMult(on)];
      const seen = sequence.map((wire) => p.speedMult(0, fighter({ speedMult: wire }), []));
      expect(seen).toEqual([on, 1, 1, on]);
      // It composes with the chill and with Last Stand's haste as any other speed mirror does, in the pause and out of it.
      const chilled = (wire: number) => fighter({ speedMult: wire, sig: SIG_CHILLED });
      expect(p.speedMult(0, chilled(encodeMult(on)), [other()])).toBeCloseTo(on * CHILL_MOVE_MULT, 12);
      expect(p.speedMult(0, chilled(encodeMult(1)), [other()])).toBeCloseTo(CHILL_MOVE_MULT, 12);
      // The model walks at that speed: a frame is handed the mirror's own number.
      const q = new LocalPrediction();
      expect(q.frameInput(0, true, fighter({ speedMult: encodeMult(on) }), [], false).speedMult).toBe(on);
      expect(q.frameInput(0, true, fighter({ speedMult: encodeMult(1) }), [], false).speedMult).toBe(1);
    }
  });

  it("the mirror multiplies with the chill", () => {
    const f = mirrored({ speed: 1.2 }, { sig: SIG_CHILLED });
    expect(p.speedMult(0, f, [other()])).toBeCloseTo(1.2 * CHILL_MOVE_MULT, 12);
    expect(p.speedMult(0, mirrored({}, { sig: SIG_CHILLED }), [other()])).toBe(CHILL_MOVE_MULT);
  });
});

describe("no kill bursts: a kill does not move the walk", () => {
  const kill = (t: number, by = ME): TimedFx => ({ kind: "death", id: "foe", x: 0, y: 0, by, t });

  it("the local player's kill leaves the walk at the mirror, at the kill's tick and after", () => {
    const p = new LocalPrediction();
    const me = mirrored({ speed: 1.1, as: 1.5 });
    const plain = 1.1;
    p.noteFx(kill(10_000), ME, me);
    for (const t of [9_999, 10_000, 10_100, 10_399, 10_400, 11_000, 13_001]) {
      expect(p.frameInput(t - p.motion.delay, true, me, [], false).speedMult, `at ${t}`).toBe(plain);
    }
  });
});

describe("the axe's root", () => {
  it("does not root after launch when recovery root is zero", () => {
    for (const faction of Object.keys(FACTIONS) as Array<keyof typeof FACTIONS>) {
      for (const as of [1, 1.25, 1.6]) {
        const who = mirrored({ as }, { faction });
        const timing = weaponTimings("axe", attackInterval(FACTIONS[faction], "axe", decodeMult(encodeMult(as))));
        expect(timing.root, `${faction} as=${as}`).toBe(0);
        const p = new LocalPrediction();
        p.noteFx(windup(10_000, timing.windup * 1000), ME, who);
        for (const elapsed of [0, timing.windup * 1000 - 1, timing.windup * 1000, timing.windup * 1000 + 500]) {
          expect(p.frameInput(10_000 + elapsed - p.motion.delay, true, who, [], false).rooted, `${faction} as=${as} at ${elapsed}ms`).toBe(false);
        }
      }
    }
  });
});

describe("frameInput", () => {
  it("passes alive and aiming through, and a lone default is 1 / not rooted", () => {
    const p = new LocalPrediction();
    expect(p.frameInput(0, true, fighter(), [], true)).toEqual({ alive: true, speedMult: 1, rooted: false, aiming: true });
    expect(p.frameInput(0, false, undefined, [], false)).toEqual({ alive: false, speedMult: 1, rooted: false, aiming: false });
  });
});

describe("a Frost mob chills as a Frost player does", () => {
  it("is taken into account when the scene hands the mobs over with the players", () => {
    const p = new LocalPrediction();
    const mob: OtherFighter = { x: 150, y: 100, faction: "frost", status: "alive" };
    expect(p.speedMult(0, fighter({ sig: SIG_CHILLED }), [mob])).toBe(CHILL_MOVE_MULT);
    expect(p.speedMult(0, fighter({ sig: SIG_CHILLED }), [{ ...mob, status: "dead" }])).toBe(1);
    expect(p.speedMult(0, fighter({ sig: SIG_CHILLED }), [{ ...mob, faction: "fire" }])).toBe(1);
  });
});

describe("what the server does to the fighter on its own cuts the prediction", () => {
  const arena = (): GameMap => {
    const tiles = new Uint8Array(40 * 20).fill(TILE_FLOOR);
    for (let x = 0; x < 40; x++) { tiles[x] = TILE_WALL; tiles[19 * 40 + x] = TILE_WALL; }
    for (let y = 0; y < 20; y++) { tiles[y * 40] = TILE_WALL; tiles[y * 40 + 39] = TILE_WALL; }
    return mapFromTiles(40, 20, tiles);
  };
  const alive = { alive: true, speedMult: 1, rooted: false, aiming: false };

  /** A fighter walking east on a bare map, its model a few frames in. */
  function walking(): LocalPrediction {
    const p = new LocalPrediction();
    p.motion.observe({ x: 300, y: 300, t: 0, moveSeq: 0 }, 0);
    p.motion.frame(0, 16, alive);
    p.motion.order("move", p.nextSeq(), 10, { x: 1000, y: 300 }, arena());
    for (let i = 1; i <= 3; i++) p.motion.frame(10 + i * 16, 16, alive);
    expect(p.motion.walking).toBe(true);
    return p;
  }

  it("a teleport fx: the walk and its orders are void, and the first sample from its tick on snaps, however short the jump", () => {
    const p = walking();
    p.noteFx({ kind: "teleport", t: 100 }, ME, fighter());
    expect(p.motion.walking).toBe(false);
    expect(p.motion.pendingOrders).toBe(0);
    p.motion.observe({ x: 345, y: 300, t: 100, moveSeq: 0 }, 110);
    p.motion.frame(126, 16, alive);
    expect(p.motion.drawn).toEqual({ x: 345, y: 300 });
    expect(p.motion.visualOffset).toBe(0);
  });

  it("the local fighter's death fx does the same (a training room puts it back on its feet in place)", () => {
    const p = walking();
    p.noteFx({ kind: "death", id: ME, x: 345, y: 300, by: null, t: 100 }, ME, fighter());
    expect(p.motion.walking).toBe(false);
    p.motion.observe({ x: 345, y: 300, t: 100, moveSeq: 0 }, 110);
    p.motion.frame(126, 16, alive);
    expect(p.motion.drawn).toEqual({ x: 345, y: 300 });
  });

  it("anyone else's death, or a cancel, leaves the walk alone", () => {
    const p = walking();
    p.noteFx({ kind: "death", id: "someone", x: 0, y: 0, by: ME, t: 100 }, ME, fighter());
    p.noteFx({ kind: "cancel", id: ME, t: 100 }, ME, fighter());
    expect(p.motion.pendingOrders).toBe(1);
    p.motion.frame(130, 16, alive);
    expect(p.motion.walking).toBe(true);
  });
});

describe("where the local fighter is drawn from", () => {
  const base = { alive: true, running: true, ready: true, beforeCut: false, deathPending: false, hasFrozen: true };

  it("its prediction while it is on its feet in a running fight", () => {
    expect(localDrawSource(base)).toBe("predicted");
    expect(localDrawSource({ ...base, hasFrozen: false })).toBe("predicted");
  });

  it("where it was last drawn while its death is still ahead of what is drawn: not thrown back to the snapshots", () => {
    // The patch already says dead (alive false) and the death fx has been noted: the screen has not caught up.
    expect(localDrawSource({ ...base, alive: false, deathPending: true })).toBe("frozen");
    // Nothing to hold it at (it was never predicted): the snapshots.
    expect(localDrawSource({ ...base, alive: false, deathPending: true, hasFrozen: false })).toBe("snapshot");
    // Once the death is drawn, the snapshots again (the body is the death fx's).
    expect(localDrawSource({ ...base, alive: false, deathPending: false })).toBe("snapshot");
  });

  it("where it was last drawn until the teleport's cut is drawn, then its prediction again", () => {
    expect(localDrawSource({ ...base, beforeCut: true })).toBe("frozen");
    expect(localDrawSource({ ...base, beforeCut: true, hasFrozen: false })).toBe("snapshot");
    expect(localDrawSource({ ...base, beforeCut: false })).toBe("predicted");
  });

  it("the snapshots in the lobby, after the run, and before the first sample", () => {
    expect(localDrawSource({ ...base, alive: false, hasFrozen: false })).toBe("snapshot"); // lobby
    expect(localDrawSource({ ...base, running: false, hasFrozen: false })).toBe("snapshot"); // the run is over
    expect(localDrawSource({ ...base, ready: false, hasFrozen: false })).toBe("snapshot"); // nothing observed yet
    expect(localDrawSource({ ...base, running: false })).toBe("snapshot"); // frozen only waits for a death or a cut
  });
});

describe("casts and statuses on the local fighter", () => {
  const FROM = 1050; // a cast noted at client clock 1000, with the initial delay estimate (50 ms)
  const rooted = (p: LocalPrediction, c: number, me: LocalFighter | undefined = fighter()) => p.frameInput(c, true, me, [], false).rooted;
  const cast = (t: number, ms: number, by = ME): TimedFx => ({ kind: "cast", by, ability: "freeze", ms, target: null, x: 0, y: 0, t });
  const castEnd = (t: number, by = ME): TimedFx => ({ kind: "castEnd", by, ability: "freeze", reason: "interrupted", t });
  const status = (t: number, kind: "stun" | "root" | "haste", ms: number, id = ME): TimedFx => ({ kind: "status", id, status: kind, ms, by: "foe", t });

  describe("noteCast", () => {
    it("a cast with a telegraph roots the model from the moment the server will apply it, for castMs", () => {
      const p = new LocalPrediction();
      expect(p.motion.delay).toBe(50);
      p.noteCast(1000, { castMs: 250, seq: 7 });
      expect(rooted(p, 1000)).toBe(true); // model time 1050 = FROM
      expect(rooted(p, 999)).toBe(false);
      expect(rooted(p, FROM + 250 - 50 - 1)).toBe(true);
      expect(rooted(p, FROM + 250 - 50)).toBe(false);
      expect(p.castEndsAt(1000)).toBe(FROM + 250);
    });

    it("no root for a cast that lands in the tick it is applied (castMs 0)", () => {
      const p = new LocalPrediction();
      p.noteCast(1000, { castMs: 0, seq: 7 });
      expect(rooted(p, 1000)).toBe(false);
      expect(p.castEndsAt(0)).toBe(0);
    });

    it("is replaced by the server's own span once its cast fx arrives", () => {
      const p = new LocalPrediction();
      p.noteCast(1000, { castMs: 250, seq: 7 });
      p.noteFx(cast(1100, 250), ME, fighter());
      expect(rooted(p, 1100 - 50 - 1)).toBe(false); // before the server's own start: the prediction is gone
      expect(rooted(p, 1100 - 50)).toBe(true);
      expect(rooted(p, 1350 - 50 - 1)).toBe(true);
      expect(rooted(p, 1350 - 50)).toBe(false);
      expect(p.castEndsAt(1200)).toBe(1350);
    });

    it("is dropped when no cast fx confirms it within ORDER_EXPIRE_MS (the server refused the cast)", () => {
      const p = new LocalPrediction();
      p.noteCast(1000, { castMs: 2000, seq: 7 });
      expect(rooted(p, 1000 + ORDER_EXPIRE_MS - 1)).toBe(true);
      expect(rooted(p, 1000 + ORDER_EXPIRE_MS)).toBe(false);
      expect(p.castEndsAt(1000 + ORDER_EXPIRE_MS)).toBe(0);
    });

    describe("a cast the server refuses (its order number is echoed in moveSeq with no cast fx)", () => {
      const sample = (t: number, moveSeq: number) => ({ x: 300, y: 300, t, moveSeq, displaceSeq: 0 });
      const arena = (): GameMap => {
        const tiles = new Uint8Array(60 * 20).fill(TILE_FLOOR);
        for (let x = 0; x < 60; x++) { tiles[x] = TILE_WALL; tiles[19 * 60 + x] = TILE_WALL; }
        for (let y = 0; y < 20; y++) { tiles[y * 60] = TILE_WALL; tiles[y * 60 + 59] = TILE_WALL; }
        return mapFromTiles(60, 20, tiles);
      };
      /** A prediction whose motion has seen its first sample, so later ones are real patches. */
      const started = () => {
        const p = new LocalPrediction();
        p.observe(sample(0, 0), 0);
        p.motion.frame(0, 16, { alive: true, speedMult: 1, rooted: false, aiming: false });
        return p;
      };

      it("drops the predicted root at the patch that acks the cast", () => {
        const p = started();
        p.noteCast(1000, { castMs: 250, seq: 7 });
        p.observe(sample(1020, 3), 1100); // an older order's ack: the cast is not answered yet
        expect(rooted(p, 1100)).toBe(true);
        p.observe(sample(1070, 7), 1150);
        expect(rooted(p, 1100)).toBe(false);
        expect(p.castEndsAt(0)).toBe(0);
      });

      it("keeps the server's root when its cast fx came first (the fx of a tick arrive before its patch)", () => {
        const p = started();
        p.noteCast(1000, { castMs: 250, seq: 7 });
        p.noteFx(cast(1100, 250), ME, fighter());
        p.observe(sample(1100, 7), 1150);
        expect(rooted(p, 1100 - 50)).toBe(true);
        expect(rooted(p, 1349 - 50)).toBe(true);
      });

      it("is dropped by the ack of a later order of the same tick too, and not by an older one, wrapping 255 to 1 included", () => {
        const p = started();
        p.noteCast(1000, { castMs: 250, seq: 7 });
        p.observe(sample(1070, 8), 1150); // a move sent after it, the last to apply in the tick
        expect(rooted(p, 1100)).toBe(false);
        const q = started();
        q.noteCast(1000, { castMs: 250, seq: 254 });
        q.observe(sample(1020, 253), 1100);
        expect(rooted(q, 1100)).toBe(true);
        q.observe(sample(1070, 2), 1150); // 254, 255, 1, 2: acked
        expect(rooted(q, 1100)).toBe(false);
      });

      it("leaves a root of a status or a confirmed cast alone", () => {
        const p = started();
        p.noteFx(status(1000, "stun", 1250), ME, fighter());
        p.noteFx(cast(1000, 350), ME, fighter());
        p.observe(sample(1070, 9), 1150);
        expect(rooted(p, 1100)).toBe(true);
      });

      it("a cast that is not a blink stands in the motion's orders: its ack measures the delay and acks the order before it", () => {
        const p = started();
        p.motion.order("move", 5, 1000, { x: 900, y: 300 }, arena());
        p.noteCast(1010, { castMs: 250, seq: 6 });
        expect(p.motion.pendingOrders).toBe(2);
        // Only the cast's seq is echoed (it was the last in its tick): the move before it counts as applied too.
        p.observe(sample(1000 + 50 + 60, 6), 1200);
        expect(p.motion.pendingOrders).toBe(0);
      });
    });

    it("a blink moves the model at once, with its order number, and roots nothing", () => {
      const p = new LocalPrediction();
      p.motion.observe({ x: 300, y: 300, t: 0, moveSeq: 0, displaceSeq: 0 }, 0);
      p.motion.frame(0, 16, { alive: true, speedMult: 1, rooted: false, aiming: false });
      p.noteCast(20, { castMs: 0, seq: p.nextSeq(), blink: { landing: { x: 560, y: 300 } } });
      expect(p.motion.predicted).toEqual({ x: 560, y: 300 });
      expect(p.motion.pendingOrders).toBe(1);
      expect(rooted(p, 20)).toBe(false);
    });
  });

  describe("fx the server sent", () => {
    it("a cast by the local fighter roots it for ms from the tick it began, and a castEnd cuts the root at its tick", () => {
      const p = new LocalPrediction();
      p.noteFx(cast(2000, 350), ME, fighter());
      expect(rooted(p, 2000 - 50)).toBe(true);
      expect(rooted(p, 2349 - 50)).toBe(true);
      expect(rooted(p, 2350 - 50)).toBe(false);
      p.noteFx(castEnd(2100), ME, fighter());
      expect(rooted(p, 2099 - 50)).toBe(true);
      expect(rooted(p, 2100 - 50)).toBe(false);
      expect(p.castEndsAt(2000)).toBe(2100);
    });

    it("someone else's cast, castEnd and status change nothing", () => {
      const p = new LocalPrediction();
      p.noteFx(cast(2000, 350, "foe"), ME, fighter());
      p.noteFx(status(2000, "stun", 1000, "foe"), ME, fighter());
      p.noteFx(status(2000, "haste", 1000, "foe"), ME, fighter());
      expect(rooted(p, 2100 - 50)).toBe(false);
      expect(p.speedMult(2100, fighter(), [])).toBe(1);
      p.noteFx(cast(2000, 350), ME, fighter());
      p.noteFx(castEnd(2100, "foe"), ME, fighter());
      expect(rooted(p, 2200 - 50)).toBe(true);
    });

    it("a stun or a root status roots it for ms from the tick it was applied", () => {
      for (const kind of ["stun", "root"] as const) {
        const p = new LocalPrediction();
        p.noteFx(status(5000, kind, 1250), ME, fighter());
        expect(rooted(p, 5000 - 50 - 1), kind).toBe(false);
        expect(rooted(p, 5000 - 50), kind).toBe(true);
        expect(rooted(p, 6249 - 50), kind).toBe(true);
        expect(rooted(p, 6250 - 50), kind).toBe(false);
      }
    });

    it("a death or a teleport clears every root and haste", () => {
      for (const how of ["death", "teleport"] as const) {
        const p = new LocalPrediction();
        p.noteFx(status(5000, "stun", 3000), ME, fighter());
        p.noteFx(status(5000, "haste", 5000), ME, fighter());
        p.noteFx(cast(5000, 350), ME, fighter());
        expect(rooted(p, 5100 - 50)).toBe(true);
        if (how === "death") p.noteFx({ kind: "death", id: ME, x: 0, y: 0, by: null, t: 5100 }, ME, fighter());
        else p.noteFx({ kind: "teleport", t: 5100 }, ME, fighter());
        expect(rooted(p, 5200 - 50), how).toBe(false);
        expect(p.speedMult(5200, fighter(), [])).toBe(1);
        expect(p.castEndsAt(5200)).toBe(0);
      }
    });
  });

  describe("the synced bits when no fx told of it", () => {
    it("stunned, rooted and casting hold the fighter; silenced alone does not", () => {
      const p = new LocalPrediction();
      for (const bit of [EFFECT_STUNNED, EFFECT_ROOTED, EFFECT_CASTING]) expect(rooted(p, 100, fighter({ effects: bit })), `${bit}`).toBe(true);
      expect(rooted(p, 100, fighter({ effects: EFFECT_SILENCED }))).toBe(false);
      expect(rooted(p, 100, fighter({ effects: EFFECT_HASTE }))).toBe(false);
      expect(rooted(p, 100, fighter())).toBe(false);
      expect(rooted(p, 100, undefined)).toBe(false);
    });

    it("do not stretch a root the fx told of: the bit lags its end by a round trip", () => {
      const p = new LocalPrediction();
      p.noteFx(status(5000, "stun", 1250), ME, fighter());
      const stale = fighter({ effects: EFFECT_STUNNED });
      expect(rooted(p, 6249 - 50, stale)).toBe(true);
      expect(rooted(p, 6250 - 50, stale)).toBe(false);
      expect(rooted(p, 6250 - 50 + 1900, stale)).toBe(false);
    });

    it("count again once the fx's own memory has run out (a later, unannounced effect)", () => {
      const p = new LocalPrediction();
      p.noteFx(status(5000, "stun", 1000), ME, fighter());
      expect(rooted(p, 6000 + 2100 - 50, fighter({ effects: EFFECT_ROOTED }))).toBe(true);
    });
  });

  describe("haste (Last Stand)", () => {
    it("adds its share of the base speed on top of the speed mirror, for the span the fx gave", () => {
      const p = new LocalPrediction();
      p.noteFx(status(5000, "haste", 5000), ME, fighter());
      expect(p.speedMult(4999, fighter(), [])).toBe(1);
      expect(p.speedMult(5000, fighter(), [])).toBeCloseTo(1 + LAST_STAND_SPEED_BONUS, 12);
      expect(p.speedMult(9999, fighter(), [])).toBeCloseTo(1 + LAST_STAND_SPEED_BONUS, 12);
      expect(p.speedMult(10_000, fighter(), [])).toBe(1);
      // Additive, not multiplicative: the speed mirror first (a fed fighter's), then the same added speed.
      const fed = mirrored({ speed: 1.12 });
      const base = decodeMult(fed.speedMult);
      expect(p.speedMult(6000, fed, [])).toBeCloseTo(base * hasteMultiplier(base, LAST_STAND_SPEED_BONUS), 12);
      expect(p.speedMult(6000, fed, [])).toBeCloseTo(base + LAST_STAND_SPEED_BONUS, 12);
    });

    it("a kill adds nothing (no bursts since R4a), and the chill still multiplies the sum", () => {
      const p = new LocalPrediction();
      const me = mirrored({ speed: 1.25 }, { sig: SIG_CHILLED });
      p.noteFx({ kind: "death", id: "foe", x: 0, y: 0, by: ME, t: 5000 }, ME, me);
      p.noteFx(status(5000, "haste", 5000), ME, me);
      expect(p.speedMult(5100, me, [])).toBeCloseTo(1.25 + LAST_STAND_SPEED_BONUS, 12);
      expect(p.speedMult(5100, me, [other()])).toBeCloseTo((1.25 + LAST_STAND_SPEED_BONUS) * CHILL_MOVE_MULT, 12);
    });

    it("the synced bit stands in when no fx told of it, and is not trusted past an fx's end", () => {
      const p = new LocalPrediction();
      expect(p.speedMult(100, fighter({ effects: EFFECT_HASTE }), [])).toBeCloseTo(1 + LAST_STAND_SPEED_BONUS, 12);
      const q = new LocalPrediction();
      q.noteFx(status(5000, "haste", 5000), ME, fighter());
      expect(q.speedMult(10_100, fighter({ effects: EFFECT_HASTE }), [])).toBe(1);
    });
  });

  it("holds the model still while rooted and lets it walk on afterwards (the walk in hand is kept)", () => {
    const p = new LocalPrediction();
    const tiles = new Uint8Array(60 * 20).fill(TILE_FLOOR);
    for (let x = 0; x < 60; x++) { tiles[x] = TILE_WALL; tiles[19 * 60 + x] = TILE_WALL; }
    for (let y = 0; y < 20; y++) { tiles[y * 60] = TILE_WALL; tiles[y * 60 + 59] = TILE_WALL; }
    const map = mapFromTiles(60, 20, tiles);
    p.motion.observe({ x: 300, y: 300, t: 0, moveSeq: 0 }, 0);
    p.motion.frame(0, 16, p.frameInput(0, true, fighter(), [], false));
    p.motion.order("move", p.nextSeq(), 0, { x: 1500, y: 300 }, map);
    let c = 0;
    const step = (ms: number) => { for (const end = c + ms; c < end; ) { c += 10; p.motion.frame(c, 10, p.frameInput(c, true, fighter(), [], false)); } };
    step(100);
    const x1 = p.motion.predicted.x;
    expect(x1).toBeGreaterThan(300 + PLAYER_SPEED * 0.09);
    p.noteCast(c, { castMs: 300, seq: p.nextSeq() });
    step(250);
    expect(p.motion.predicted.x).toBeCloseTo(x1, 6);
    step(500);
    expect(p.motion.predicted.x).toBeGreaterThan(x1 + PLAYER_SPEED * 0.2);
  });
});

describe("castUnanswered (a second press of the slot is ignored until the first is answered)", () => {
  const sent = (over: Partial<SentCast> = {}): SentCast => ({ slot: "wish", seq: 7, readyAt: 0, until: 1000 + 600, ...over });

  it("holds while the ready time stands, the wait has not run out and the order is in flight, for the same slot only", () => {
    expect(castUnanswered(null, "wish", 1000, 0, true)).toBe(false);
    expect(castUnanswered(sent(), "wish", 1100, 0, true)).toBe(true);
    expect(castUnanswered(sent(), "wish", 1599, 0, true)).toBe(true);
    expect(castUnanswered(sent(), "wish", 1600, 0, true)).toBe(false); // waited long enough
    expect(castUnanswered(sent(), "q", 1100, 0, true)).toBe(false);
  });

  it("is answered by the slot's new ready time (the cast was taken)", () => {
    expect(castUnanswered(sent(), "wish", 1100, 301_100, true)).toBe(false);
  });

  it("is answered by the echo of the cast's order number alone: a refusal frees the slot at once, a blink or not", () => {
    expect(castUnanswered(sent(), "wish", 1100, 0, false)).toBe(false);
    const blink = sent({ until: 1000 + 1500 });
    expect(castUnanswered(blink, "wish", 1700, 0, true)).toBe(true); // a slow link: past the flat 600 ms of an ordinary wait
    expect(castUnanswered(blink, "wish", 2499, 0, true)).toBe(true);
    expect(castUnanswered(blink, "wish", 2500, 0, true)).toBe(false); // the hard cap
    expect(castUnanswered(blink, "wish", 1200, 0, false)).toBe(false);
  });
});

describe("inTeleportGrace (the server refuses every cast that reaches it within CAST_TELEPORT_GRACE_MS of the teleport)", () => {
  it("is false before there was a teleport (its time is 0)", () => {
    expect(inTeleportGrace(0, 0)).toBe(false);
    expect(inTeleportGrace(0, 5000)).toBe(false);
  });

  it("covers the grace from the teleport's server time, and ends with it", () => {
    expect(inTeleportGrace(60_000, 59_999)).toBe(true); // the client's clock may read just before it
    expect(inTeleportGrace(60_000, 60_000)).toBe(true);
    expect(inTeleportGrace(60_000, 60_000 + CAST_TELEPORT_GRACE_MS - 1)).toBe(true);
    expect(inTeleportGrace(60_000, 60_000 + CAST_TELEPORT_GRACE_MS)).toBe(false);
  });
});

describe("the ground under the model (bog slows the walk, ice lets it slide)", () => {
  const W = 20;
  const H = 12;
  /** A walled room; (3, 3) is bog, (6, 3) ice, (9, 3) bog, (12, 3) ice; everything else plain. */
  function ground(): GameMap {
    const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
    for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
    for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
    const terrain = new Uint8Array(W * H);
    terrain[3 * W + 3] = TERRAIN_BOG;
    terrain[3 * W + 6] = TERRAIN_ICE;
    terrain[3 * W + 9] = TERRAIN_BOG;
    terrain[3 * W + 12] = TERRAIN_ICE;
    return mapFromTiles(W, H, tiles, 0, terrain);
  }
  const centre = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
  const BOG = centre(3, 3);
  const ICE = centre(6, 3);
  const FLOOR = centre(4, 5);
  /** A prediction whose model stands at `at` (the synced position of the fighter is whatever `fighter({x, y})` says). */
  const modelAt = (at: { x: number; y: number }): LocalPrediction => {
    const p = new LocalPrediction();
    p.motion.observe({ x: at.x, y: at.y, t: 0, moveSeq: 0 }, 0);
    return p;
  };
  const map = ground();
  const BOG_MULT = 0.7;

  describe("bog is read where the MODEL stands, not where the last patch has the fighter", () => {
    it("the model on bog: 0.7 (the synced position elsewhere); the model on plain ground beside a synced bog position: 1", () => {
      expect(modelAt(BOG).speedMult(0, fighter({ ...FLOOR }), [], map)).toBe(BOG_MULT);
      expect(modelAt(FLOOR).speedMult(0, fighter({ ...BOG }), [], map)).toBe(1);
    });

    it("multiplies with the speed mirror and the chill, and a kill's burst is no longer part of it", () => {
      const p = modelAt(BOG);
      const MIRROR = 1.37;
      const me = mirrored({ speed: MIRROR }, { sig: SIG_CHILLED, ...FLOOR });
      expect(p.speedMult(0, mirrored({ speed: MIRROR }, { ...FLOOR }), [], map)).toBeCloseTo(MIRROR * BOG_MULT, 12);
      expect(p.speedMult(0, me, [other({ x: FLOOR.x + 10, y: FLOOR.y })], map)).toBeCloseTo(MIRROR * CHILL_MOVE_MULT * BOG_MULT, 12);
      p.noteFx({ kind: "death", id: "foe", x: 0, y: 0, by: ME, t: 10_000 }, ME, me); // a kill moves nothing now
      expect(p.speedMult(10_100, me, [other({ x: FLOOR.x + 10, y: FLOOR.y })], map)).toBeCloseTo(MIRROR * CHILL_MOVE_MULT * BOG_MULT, 12);
      expect(p.speedMult(10_500, me, [], map)).toBeCloseTo(MIRROR * BOG_MULT, 12); // nobody chills
    });

    it("Plague is at home in the bog: it gets 1, and the speed mirror is all there is", () => {
      const p = modelAt(BOG);
      expect(p.speedMult(0, fighter({ faction: "plague", ...FLOOR }), [], map)).toBe(1);
      expect(p.speedMult(0, mirrored({ speed: 1.37 }, { faction: "plague", ...FLOOR }), [], map)).toBe(1.37);
    });

    it("plain and ice ground do not slow; no map is plain ground", () => {
      expect(modelAt(FLOOR).speedMult(0, fighter(), [], map)).toBe(1);
      expect(modelAt(ICE).speedMult(0, fighter(), [], map)).toBe(1);
      expect(modelAt(BOG).speedMult(0, fighter(), [], null)).toBe(1);
      expect(modelAt(BOG).speedMult(0, fighter(), [])).toBe(1);
    });

    it("the product is floored as the server floors it: never under MOVE_MULT_FLOOR while above 0, and a 0 stays 0", () => {
      const p = modelAt(BOG);
      expect(MOVE_MULT_FLOOR).toBe(0.35);
      // 0.5 (a slow in the mirror) x 0.7 (chill) x 0.7 (bog) = 0.245: floored.
      const slow = fighter({ speedMult: encodeMult(0.5), sig: SIG_CHILLED, ...FLOOR });
      expect(p.speedMult(0, slow, [other({ x: FLOOR.x + 10, y: FLOOR.y })], map)).toBe(MOVE_MULT_FLOOR);
      // The floor needs no bog: 0.4 x 0.7 = 0.28 on plain ground.
      expect(modelAt(FLOOR).speedMult(0, mirrored({ speed: 0.4 }, { sig: SIG_CHILLED }), [other()], map)).toBe(MOVE_MULT_FLOOR);
      expect(modelAt(FLOOR).speedMult(0, mirrored({ speed: 0.4 }, { sig: SIG_CHILLED }), [other()])).toBe(MOVE_MULT_FLOOR);
      // At and above it, nothing changes (0.49 is the chill in the bog).
      expect(p.speedMult(0, fighter({ sig: SIG_CHILLED, ...FLOOR }), [other({ x: FLOOR.x + 10, y: FLOOR.y })], map)).toBeCloseTo(CHILL_MOVE_MULT * BOG_MULT, 12);
      expect(modelAt(FLOOR).speedMult(0, mirrored({ speed: 0.35 }), [], map)).toBe(0.35);
      // A zero (not a slow: a stopped fighter) is not lifted.
      expect(modelAt(FLOOR).speedMult(0, fighter({ speedMult: 0 }), [], map)).toBe(0);
    });

    it("frameInput carries it, judged at the model's position: the same fighter is slowed on the bog and not beside it", () => {
      expect(modelAt(BOG).frameInput(0, true, fighter({ ...FLOOR }), [], false, map).speedMult).toBe(BOG_MULT);
      expect(modelAt(FLOOR).frameInput(0, true, fighter({ ...BOG }), [], false, map).speedMult).toBe(1);
    });
  });

  describe("slipAt, the traction handed to the motion", () => {
    const TRACTION = (PLAYER_SPEED * 1000) / 400;

    it("is 425 on ice for a fighter that does not grip it, and 0 off ice", () => {
      const p = new LocalPrediction();
      const input = p.frameInput(0, true, fighter({ faction: "plague" }), [], false, map);
      expect(input.slipAt).toBeTypeOf("function");
      expect(input.slipAt!(ICE.x, ICE.y)).toBe(TRACTION);
      expect(input.slipAt!(centre(12, 3).x, centre(12, 3).y)).toBe(TRACTION);
      expect(input.slipAt!(FLOOR.x, FLOOR.y)).toBe(0);
      expect(input.slipAt!(BOG.x, BOG.y)).toBe(0);
      expect(input.slipAt!(-50, -50)).toBe(0); // off the map
      expect(input.map).toBe(map);
    });

    it("is 0 on ice too for Frost, whose home it is", () => {
      const input = new LocalPrediction().frameInput(0, true, fighter({ faction: "frost" }), [], false, map);
      expect(input.slipAt).toBeTypeOf("function");
      expect(input.slipAt!(ICE.x, ICE.y)).toBe(0);
      expect(input.slipAt!(FLOOR.x, FLOOR.y)).toBe(0);
    });

    it("every other faction slides", () => {
      for (const faction of ["fire", "sentenced", "plague", "holy"]) {
        const input = new LocalPrediction().frameInput(0, true, fighter({ faction }), [], false, map);
        expect(input.slipAt!(ICE.x, ICE.y), faction).toBe(TRACTION);
      }
    });

    it("is absent on a map with no ice, with no map, and with no fighter: nothing for the motion to do", () => {
      const p = new LocalPrediction();
      const bogOnly = mapFromTiles(W, H, ground().tiles, 0, Uint8Array.from(ground().terrain, (k) => (k === TERRAIN_ICE ? 0 : k)));
      expect(p.frameInput(0, true, fighter(), [], false, bogOnly).slipAt).toBeUndefined();
      expect(p.frameInput(0, true, fighter(), [], false, null).slipAt).toBeUndefined();
      expect(p.frameInput(0, true, fighter(), [], false).slipAt).toBeUndefined();
      expect(p.frameInput(0, true, undefined, [], false, map).slipAt).toBeUndefined();
      expect(p.frameInput(0, true, fighter(), [], false, bogOnly).map).toBeUndefined();
      expect(p.frameInput(0, true, fighter(), [], false, mapFromTiles(W, H, ground().tiles)).slipAt).toBeUndefined();
    });

    it("is one function per map and faction (a frame allocates none), and follows a change of either", () => {
      const p = new LocalPrediction();
      const a = p.frameInput(0, true, fighter({ faction: "fire" }), [], false, map).slipAt;
      expect(p.frameInput(16, true, fighter({ faction: "fire" }), [], false, map).slipAt).toBe(a);
      const b = p.frameInput(32, true, fighter({ faction: "frost" }), [], false, map).slipAt;
      expect(b).not.toBe(a);
      expect(b!(ICE.x, ICE.y)).toBe(0);
      const other = ground();
      const c = p.frameInput(48, true, fighter({ faction: "frost" }), [], false, other).slipAt;
      expect(c).not.toBe(b);
      p.reset();
      expect(p.frameInput(64, true, fighter({ faction: "fire" }), [], false, map).slipAt).not.toBe(a);
    });

    it("a frame input with a map and no hazards still equals today's, field for field", () => {
      const flat = mapFromTiles(W, H, ground().tiles);
      const p = new LocalPrediction();
      expect(p.frameInput(0, true, fighter(), [], true, flat)).toEqual({ alive: true, speedMult: 1, rooted: false, aiming: true });
    });
  });
});
