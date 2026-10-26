// Perception and the delay ring (docs/BOTS.md 3): what a bot may read of the state, the window, the parity of the two
// drivers, hidden and untargetable fighters, which fx it observes, and how frames.ts delays, interpolates and hands out
// events. The metamorphic fairness suite over many seeded states is fairness.test.ts.
import { describe, expect, it, vi } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import {
  ABILITIES, EFFECT_CASTING, EFFECT_HIDDEN, EFFECT_STUNNED,
  FACTION_IDS, factionEdge, generateMap, hasLineOfSight, INTERACT_RANGE, matchupScore, matchupTint, mulberry32, TICK_MS, Y_SCALE,
  type FxBatch, type FxEvent, type ProjectileLaunch, type Vec2,
} from "@raid/shared";
import { PlayerState, type RaidState } from "@raid/shared/schema";
import { computeLayout, REF_VIEW_H } from "../../../client/src/view/viewport";
import { createFrameRing } from "../../src/bots/brain/frames";
import { detectFeatures, perceive, type PerceptionInput, type StateLike } from "../../src/bots/brain/perception";
import {
  BOT_VIEW, BOT_VIEW_REF_H, FRAME_MARGIN, HP_QUANT, MINIMAP_QUANT,
  type ComposeConfig, type Features, type Frame, type MinimapView, type ObservedEvent, type Percept,
} from "../../src/bots/brain/types";
import { FxChannel } from "../../src/rooms/FxChannel";
import { createGameWorld } from "../../src/sim/gameplay";
import { enqueueClientMessage } from "../../src/sim/inputs";
import { addPlayer, step } from "../../src/sim/step";
import {
  buildScenario, FRAME_MS, IN_PROCESS, plainContainer, plainMob, plainPlayer, plainState, runPerception, scenarioInputs, T0,
  toSchemaState, type PlainState, type Scenario, type ScenarioFrame,
} from "./fairnessKit";
import { features as featureSet, testMap } from "./fixtures";

// A pass-through, except that a batch carrying `testExt` also yields those fx: on this branch the codec knows no fx kind the
// brain does not name, so this is how a Wishes cast (decoded by a newer codec) reaches perception in a test.
vi.mock("@raid/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@raid/shared")>();
  return {
    ...actual,
    unpackFx: (batch: FxBatch, roster: ArrayLike<string>, onDrop?: (tuple: unknown, unresolved: boolean) => void) => {
      const extra = (batch as FxBatch & { testExt?: Array<Record<string, unknown>> }).testExt ?? [];
      return [...actual.unpackFx(batch, roster, onDrop), ...extra.map((fx) => ({ ...fx, t: batch.t }))];
    },
  };
});

// ================================================================================================================= helpers

const SELF: Vec2 = { x: 1000, y: 1000 };

interface Spec {
  state: PlainState;
  events?: FxEvent[];
  launches?: ProjectileLaunch[];
  toasts?: string[];
  ext?: Array<Record<string, unknown>>;
}

/** n frames FRAME_MS apart from T0, each built by `build(k, t)`, as a scenario the kit can run. */
function scenarioOf(n: number, build: (k: number, t: number) => Spec, features: Features = featureSet()): { s: Scenario; ext: Spec["ext"][] } {
  const specs = Array.from({ length: n }, (_, k) => build(k, T0 + k * FRAME_MS));
  const frames: ScenarioFrame[] = specs.map((sp, k) => {
    sp.state.serverTime = T0 + k * FRAME_MS;
    if (sp.state.roster.length === 0) sp.state.roster = [...sp.state.players.keys(), ...sp.state.mobs.keys()];
    return { state: sp.state, events: sp.events ?? [], launches: sp.launches ?? [], toasts: sp.toasts ?? [] };
  });
  const roles = {
    onscreenPlayers: [], onscreenMobs: [], farPlayers: [], farMobs: [], ringPlayers: [], ringMobs: [], hidden: [], farContainers: [],
    shutChests: [], announced: [],
  };
  return { s: { seed: 0, map: testMap(), selfId: "me", features, frames, roles }, ext: specs.map((sp) => sp.ext) };
}

function run(n: number, build: (k: number, t: number) => Spec, opts: { features?: Features; selfDelayMs?: number; worldDelayMs?: number } = {}): Percept[] {
  const { s, ext } = scenarioOf(n, build, opts.features);
  return runPerception(s, {
    selfDelayMs: opts.selfDelayMs, worldDelayMs: opts.worldDelayMs,
    mapInput: (input, i) => (ext[i] ? { ...input, fxs: [...(input.fxs ?? []), { t: input.state.serverTime, l: [], testExt: ext[i] } as FxBatch] } : input),
  });
}

/** A state with the bot standing at SELF and the given others. */
function world(others: { players?: Record<string, Partial<ReturnType<typeof plainPlayer>>>; mobs?: Record<string, Partial<ReturnType<typeof plainMob>>> } = {}): PlainState {
  const s = plainState();
  s.players.set("me", plainPlayer({ name: "Me", ...SELF, faction: "fire", weapon0: "axe" }));
  for (const [id, p] of Object.entries(others.players ?? {})) s.players.set(id, plainPlayer({ name: id.toUpperCase(), ...p }));
  for (const [id, m] of Object.entries(others.mobs ?? {})) s.mobs.set(id, plainMob({ name: `Mob ${id}`, ...m }));
  return s;
}

const ids = (list: ReadonlyArray<{ id: string }>): string[] => list.map((e) => e.id).sort();
const lastOf = (ps: readonly Percept[]): Percept => ps[ps.length - 1]!;
const allEvents = (ps: readonly Percept[]): ObservedEvent[] => ps.flatMap((p) => p.events);

/** A state whose every read is logged by owner ("state", "player:p1", "mob:m1", "container:c1"). */
function logged(plain: PlainState): { state: StateLike; reads: Map<string, Set<string>> } {
  const reads = new Map<string, Set<string>>();
  const log = (who: string, key: PropertyKey) => {
    if (typeof key !== "string") return;
    let set = reads.get(who);
    if (!set) reads.set(who, (set = new Set()));
    set.add(key);
  };
  const wrap = <T extends object>(who: string, obj: T): T => new Proxy(obj, { get: (t, k, r) => { log(who, k); return Reflect.get(t, k, r); } });
  const keyed = <V extends object>(kind: string, map: Map<string, V>) => {
    const cache = new Map<string, V>();
    const val = (id: string, v: V | undefined): V | undefined => {
      if (!v) return v;
      let w = cache.get(id);
      if (!w) cache.set(id, (w = wrap(`${kind}:${id}`, v)));
      return w;
    };
    return {
      get: (id: string) => val(id, map.get(id)),
      get size() { return map.size; },
      *[Symbol.iterator]() { for (const [k, v] of map) yield [k, val(k, v)!] as const; },
    };
  };
  const players = keyed("player", plain.players), mobs = keyed("mob", plain.mobs), containers = keyed("container", plain.containers);
  const state = new Proxy(plain, {
    get(t, k, r) {
      log("state", k);
      if (k === "players") return players;
      if (k === "mobs") return mobs;
      if (k === "containers") return containers;
      return Reflect.get(t, k, r);
    },
  });
  return { state: state as unknown as StateLike, reads };
}

/** A floor point of the test map with a clear line 160 u east and 40 u west (so tints and pickups see what they should). */
function openSpot(): Vec2 {
  const m = testMap();
  for (let ty = 2; ty < m.h - 2; ty++) {
    for (let tx = 2; tx < m.w - 8; tx++) {
      const p = { x: tx * 32 + 16, y: ty * 32 + 16 };
      if (hasLineOfSight(m, p, { x: p.x + 160, y: p.y }) && hasLineOfSight(m, p, { x: p.x - 40, y: p.y }) && hasLineOfSight(m, p, { x: p.x, y: p.y + 40 })) return p;
    }
  }
  throw new Error("no open spot");
}

const offBox = (self: Vec2, p: Vec2) =>
  Math.abs(p.x - self.x) > BOT_VIEW.halfW + FRAME_MARGIN || Math.abs(p.y - self.y) > BOT_VIEW.halfH + FRAME_MARGIN;

// ======================================================================================================== field allowlist

describe("perception reads only what the client draws", () => {
  const OTHER_NEVER = [
    "stacksHp", "stacksAs", "stacksMs", "kills", "gv", "readyAt", "attackTarget", "moveSeq", "look", "mobKills", "asMult", "windupMult",
    "speedMult", "armorBonus", "shieldBonus",
  ];

  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`seed ${seed}: never tick; off the box a player gives x, y, status, name and a mob x, y, status, kind, faction`, () => {
      const s = buildScenario(seed);
      let lastMinimap: MinimapView | null = null;
      for (const input of scenarioInputs(s)) {
        const plain = input.state as PlainState;
        const { state, reads } = logged(plain);
        const frame = perceive({ ...input, state }, { selfId: "me", map: s.map, features: s.features, lastMinimap });
        lastMinimap = frame.minimap;
        const self = plain.players.get("me")!;
        expect(reads.get("state")!.has("tick")).toBe(false);
        for (const [id, p] of plain.players) {
          if (id === "me") continue;
          const read = [...(reads.get(`player:${id}`) ?? [])];
          // The weapon slot not in hand is never drawn.
          const never = [...OTHER_NEVER, p.slot === 1 ? "weapon0" : "weapon1"];
          expect(read.filter((k) => never.includes(k)), `player ${id}`).toEqual([]);
          if (offBox(self, p)) expect(read.filter((k) => !["x", "y", "status", "name"].includes(k)), `off-screen ${id}`).toEqual([]);
        }
        for (const [id, m] of plain.mobs) {
          const read = [...(reads.get(`mob:${id}`) ?? [])];
          expect(read.filter((k) => k === "readyAt" || k === (m.slot === 1 ? "weapon0" : "weapon1")), `mob ${id}`).toEqual([]);
          if (offBox(self, m)) expect(read.filter((k) => !["x", "y", "status", "kind", "faction"].includes(k)), `off-screen mob ${id}`).toEqual([]);
        }
        for (const [id, c] of plain.containers) {
          if (offBox(self, c)) expect(reads.get(`container:${id}`)?.has("items") ?? false, `off-screen container ${id}`).toBe(false);
        }
      }
    });
  }

  it("a far player's name is read only for its announcement", () => {
    const s = buildScenario(2);
    const reads = scenarioInputs(s).map((input) => {
      const { state, reads } = logged(input.state as PlainState);
      perceive({ ...input, state }, { selfId: "me", map: s.map, features: s.features, lastMinimap: null });
      return reads.get("player:f3") ?? new Set<string>();
    });
    for (const r of reads) expect(r.has("name")).toBe(false);
  });
});

// =============================================================================================================== plain data

describe("a Percept is plain data", () => {
  it("only plain objects and arrays, primitive leaves, and structuredClone gives it back unchanged", () => {
    for (const seed of [11, 12, 13]) {
      for (const p of runPerception(buildScenario(seed))) {
        const walk = (v: unknown, path: string): void => {
          if (v === null || typeof v !== "object") {
            expect(["string", "number", "boolean", "undefined"].includes(typeof v) || v === null, path).toBe(true);
            return;
          }
          const proto = Object.getPrototypeOf(v);
          expect(proto === Object.prototype || proto === Array.prototype, `${path} prototype`).toBe(true);
          for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
        };
        walk(p, "percept");
        expect(structuredClone(p)).toEqual(p);
      }
    }
  });
});

// ================================================================================================================== window

describe("the window", () => {
  it("is the client's 1920 x 1080 view: computeLayout's world size, the height unsquashed by Y_SCALE", () => {
    const layout = computeLayout({ cssW: 1920, cssH: 1080, dpr: 1, hiDpi: false });
    expect(BOT_VIEW.halfW * 2).toBe(layout.worldW);
    expect(BOT_VIEW.halfH * 2).toBe(layout.worldH / Y_SCALE);
    expect(BOT_VIEW_REF_H).toBe(REF_VIEW_H);
  });

  it("puts fighters, mobs, containers and projectiles at the edge +-0.5 in and out exactly, on every side", () => {
    const { halfW, halfH } = BOT_VIEW;
    const sides: Array<[string, number, number]> = [["E", 1, 0], ["W", -1, 0], ["S", 0, 1], ["N", 0, -1]];
    const at = (dx: number, dy: number, inside: boolean): Vec2 => {
      const d = inside ? -0.5 : 0.5;
      return { x: SELF.x + (dx === 0 ? 37 : dx * (halfW + d)), y: SELF.y + (dy === 0 ? -41 : dy * (halfH + d)) };
    };
    const ps = run(8, (k, t) => {
      const s = world();
      const launches: ProjectileLaunch[] = [];
      for (const [name, dx, dy] of sides) {
        for (const inside of [true, false]) {
          const tag = `${name}${inside ? "in" : "out"}`;
          const p = at(dx, dy, inside);
          s.players.set(`p${tag}`, plainPlayer({ name: `P${tag}`, ...p }));
          s.mobs.set(`m${tag}`, plainMob({ ...p, y: p.y + (dx === 0 ? 0 : 60) }));
          s.containers.set(`c${tag}`, plainContainer({ id: `c${tag}`, ...p, x: p.x + (dy === 0 ? 0 : 90), items: [{ uid: "u", def: "bow" }] }));
          // Each flies along its edge, so it stays exactly as far in or out as it started.
          if (k === 2) {
            launches.push({
              id: `a${tag}`, kind: "arrow", x: p.x + (dy === 0 ? 0 : -80), y: p.y + (dx === 0 ? 0 : -80), vx: dy === 0 ? 0 : 900, vy: dx === 0 ? 0 : 900,
              t, range: 240,
            });
          }
        }
      }
      return { state: s, launches };
    });
    const p = ps.find((x) => x.projectiles.length > 0)!;
    const expected = sides.map(([name]) => `${name}in`).sort();
    const strip = (list: string[], prefix: string) => list.filter((id) => id.startsWith(prefix)).map((id) => id.slice(1)).sort();
    expect(strip(ids(p.fighters), "p")).toEqual(expected);
    expect(strip(ids(p.mobs), "m")).toEqual(expected);
    expect(strip(ids(p.containers), "c")).toEqual(expected);
    expect(strip(ids(p.projectiles), "a")).toEqual(expected);
  });
});

// ================================================================================================================== parity

/** The SDK's view of a state: schema classes from the handshake's reflection, then the full state. */
function decodedCopy(state: RaidState): RaidState {
  const encoder = new Encoder(state);
  const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
  decoder.decode(encoder.encodeAll());
  return decoder.state;
}

describe("both drivers perceive the same", () => {
  it("a plain state, its schema copy and that copy through the real encoder and decoder give identical Frames", () => {
    // Without Wishes' status bits: this branch's schema has no `effects` field to carry them.
    for (const seed of [21, 22, 23]) {
      const s = buildScenario(seed, { statusEffects: false });
      let a: MinimapView | null = null, b: MinimapView | null = null, c: MinimapView | null = null;
      for (const input of scenarioInputs(s)) {
        // Fractions everywhere: the wire narrows positions and hp to float32 and timers to whole ms.
        const plain = input.state as PlainState;
        for (const p of plain.players.values()) {
          p.x += 0.123456789; p.y -= 0.987654321; p.hp -= 0.3333; p.readyAt += 0.77; p.drawStartedAt += 0.5; p.immuneUntil += 0.25;
          p.stacksHp += 0.1234567;
        }
        for (const m of plain.mobs.values()) { m.x += 0.31415926; m.hp -= 0.2718281; }
        const server = toSchemaState(plain);
        const client = decodedCopy(server);
        const ctx = (last: MinimapView | null) => ({ selfId: "me", map: s.map, features: s.features, lastMinimap: last });
        const fp = perceive({ ...input, state: plain }, ctx(a));
        const fs = perceive({ ...input, state: server }, ctx(b));
        const fc = perceive({ ...input, state: client }, ctx(c));
        a = fp.minimap; b = fs.minimap; c = fc.minimap;
        expect(JSON.stringify(fs)).toBe(JSON.stringify(fc));
        expect(fs).toEqual(fc);
        expect(JSON.stringify(fp)).toBe(JSON.stringify(fs));
      }
    }
  });

  it("a real run: the server's state and a decoded client's give identical Frames and Percepts, tick by tick", () => {
    let uid = 0;
    const w = createGameWorld({
      seed: 5,
      config: { minPlayers: 3, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: 60, patienceMinSeconds: 60, suddenDeathSeconds: 30, mobs: true },
      random: mulberry32(6),
      newItemUid: () => `L${++uid}`,
    });
    for (const [i, id] of ["me", "b", "c", "d"].entries()) addPlayer(w, id, `n${i}`);
    const map = generateMap(w.state.seed);
    const encoder = new Encoder(w.state);
    const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
    decoder.decode(encoder.encodeAll());
    const channel = new FxChannel();
    const features = detectFeatures({ state: w.state, player: new PlayerState(), map });
    const ring = { server: createFrameRing(), client: createFrameRing() };
    const last: { server: MinimapView | null; client: MinimapView | null } = { server: null, client: null };
    const cfg: ComposeConfig = { ...IN_PROCESS, map, features, attentionCentral: 0.65 };
    let percepts = 0, fx = 0;
    for (let tick = 0; tick < 140; tick++) {
      if (w.state.phase === "active" && tick % 10 === 0) {
        // Walk about and pick fights, so there is motion, locks and fx.
        for (const id of ["b", "c", "d"]) {
          const rt = w.players.get(id)!;
          const me = w.state.players.get("me")!;
          if (tick % 20 === 0) enqueueClientMessage(rt.inputs, "target", { id: "me" });
          else enqueueClientMessage(rt.inputs, "move", { x: me.x + 40 * Math.cos(tick), y: me.y + 40 * Math.sin(tick) });
        }
      }
      const events = step(w, TICK_MS);
      const fxs = events.flatMap((e) => (e.type === "fx" ? [e.fx] : []));
      const batch = channel.batch(fxs, w.state.serverTime, w.projectiles);
      channel.extendRoster(w.state);
      decoder.decode(encoder.encode());
      encoder.discardChanges();
      channel.rosterSent();
      fx += fxs.length;
      for (const side of ["server", "client"] as const) {
        const state = side === "server" ? w.state : decoder.state;
        const input: PerceptionInput = { state, fxs: batch ? [batch] : [] };
        const frame = perceive(input, { selfId: "me", map, features, lastMinimap: last[side] });
        last[side] = frame.minimap;
        ring[side].push(frame);
      }
      const ps = ring.server.compose(cfg), pc = ring.client.compose(cfg);
      expect(JSON.stringify(ps)).toBe(JSON.stringify(pc));
      if (ps) percepts++;
    }
    expect(percepts).toBeGreaterThan(100);
    expect(fx).toBeGreaterThan(0);
  });

  it("detects features by presence on schema instances, decoded ones and plain ones alike", () => {
    const server = toSchemaState(buildScenario(2, { statusEffects: false }).frames[0]!.state);
    const client = decodedCopy(server);
    for (const [state, player] of [[server, new PlayerState()], [client, client.players.get("me")!]] as const) {
      const f = detectFeatures({ state, player, map: testMap() });
      // The merged schema: the Wish, the status bits and the areas exist; the Q/E fields are in the schema but no ability fills them.
      expect(f).toEqual(featureSet({
        messageTypes: ["move", "stop", "target", "aim", "attack", "release", "swap", "pickup", "cast"],
        wishes: true, statusEffects: true, fields: true, skills: false,
      }));
      expect("barrier" in player).toBe(true);
      expect("wishReadyAt" in player).toBe(true);
      expect("qReadyAt" in player && "eReadyAt" in player).toBe(true);
    }
    // A branch with the fields on the instances and "cast" accepted: the Wish needs the shared catalog too (it is there), and the
    // skills stay off while abilityInSlot(.., "q") has nothing to return.
    const wishy = detectFeatures({
      state: { players: new Map(), fields: new Map() }, player: { effects: 0, wishReadyAt: 0, qReadyAt: 0, eReadyAt: 0 }, map: null,
      messageTypes: ["move", "stop", "target", "swap", "pickup", "cast"],
    });
    expect(wishy).toMatchObject({ statusEffects: true, fields: true, skills: false, wishes: true, planning: false, chests: false, hazards: false });
    // Without "cast" accepted there is no Wish to press, whatever the schema carries.
    expect(detectFeatures({ state: { players: new Map() }, player: { effects: 0, wishReadyAt: 0 }, map: null, messageTypes: ["move"] }))
      .toMatchObject({ wishes: false, skills: false, statusEffects: true });
    expect(detectFeatures({ state: {}, player: null, map: { ...testMap(), hazards: [] } as never }).hazards).toBe(true);
  });
});

// ================================================================================================== hidden and untargetable

describe("hidden and untargetable fighters (Features.statusEffects)", () => {
  const statusOn = featureSet({ statusEffects: true });
  const scene = (k: number): Spec => ({
    state: world({
      players: {
        h: { x: 1100, y: 1000, effects: 256 }, u: { x: 1150, y: 1050, effects: 128 }, v: { x: 900, y: 950, effects: 8 },
      },
    }),
    events: k === 3 ? [
      { kind: "windup", by: "h", weapon: "wand", a: 0, ms: 400 },
      { kind: "hit", id: "me", by: "h", amount: 30, weapon: "wand" },
      { kind: "hit", id: "me", by: "u", amount: 20, weapon: "axe" },
      { kind: "heal", id: "h", amount: 9 },
    ] : [],
    launches: k === 3 ? [{ id: "ball", kind: "ball", x: 1100, y: 1000, vx: -380, vy: 0, t: T0 + 150, range: 220 }] : [],
  });

  it("drops a hidden fighter from fighters, effects, fx and projectile credit; keeps an untargetable one, not targetable", () => {
    const ps = run(10, scene, { features: statusOn });
    const p = lastOf(ps);
    expect(ids(p.fighters)).toEqual(["u", "v"]);
    expect(p.fighters.find((f) => f.id === "u")!.targetable).toBe(false);
    expect(p.fighters.find((f) => f.id === "v")!.targetable).toBe(true);
    expect(p.extras.effects).toEqual({ me: 0, u: 128, v: 8 });
    const evs = allEvents(ps);
    expect(evs.some((e) => e.kind === "windup" || e.kind === "heal")).toBe(false);
    const hits = evs.filter((e) => e.kind === "hit");
    expect(hits.map((e) => (e.kind === "hit" ? e.by : "?"))).toEqual([null, "u"]);
    const ball = ps.flatMap((x) => x.projectiles).find((q) => q.id === "ball");
    expect(ball?.from).toBeNull();
  });

  it("with the feature off the bits are not read: everyone is drawn and there is no effects extra", () => {
    const p = lastOf(run(10, scene));
    expect(ids(p.fighters)).toEqual(["h", "u", "v"]);
    expect(p.fighters.every((f) => f.targetable)).toBe(true);
    expect(p.extras.effects).toBeUndefined();
  });
});

// ============================================================================================================== the Wish slot

describe("the Wish slot (Features.wishes)", () => {
  const wishOn = featureSet({ wishes: true, statusEffects: true });
  /** The bot at SELF with a Wish ready at `wishReadyAt`, and a rival that also has one (its ready time is public in the game, not in the Percept). */
  const wishWorld = (faction: string, wishReadyAt: number, effects = 0): PlainState => {
    const s = plainState();
    s.players.set("me", Object.assign(plainPlayer({ name: "Me", ...SELF, faction, weapon0: "axe", effects }), { wishReadyAt }));
    s.players.set("rival", Object.assign(plainPlayer({ name: "Rival", x: SELF.x + 150, y: SELF.y, faction: "frost", weapon0: "sword" }), { wishReadyAt: 777_000 }));
    return s;
  };
  const wishOf = (faction: string, wishReadyAt: number, effects = 0, features: Features = wishOn) =>
    lastOf(run(8, () => ({ state: wishWorld(faction, wishReadyAt, effects) }), { features })).extras.wish;

  it("is the faction's Wish as shared names it, with its ready time as the weapon bar shows it", () => {
    for (const [faction, ability] of [["frost", "freeze"], ["plague", "swarm"], ["sentenced", "trial"], ["fire", "blaze"], ["holy", "lastStand"]] as const) {
      const w = wishOf(faction, 91_234.6)!;
      expect(w.ability).toBe(ability);
      expect(w.def).toBe(ABILITIES[ability]);
      expect(w.rank).toBe(1);
      expect(w.readyAt).toBe(91_234);
      expect(w.casting).toBe(false);
    }
  });

  it("says casting while the bot's own bits do (and only then)", () => {
    expect(wishOf("plague", 0, EFFECT_CASTING)!.casting).toBe(true);
    expect(wishOf("plague", 0, EFFECT_CASTING | EFFECT_STUNNED)!.casting).toBe(true);
    expect(wishOf("plague", 0, EFFECT_STUNNED)!.casting).toBe(false);
    expect(wishOf("plague", 0, EFFECT_HIDDEN)!.casting).toBe(false);
  });

  it("is absent without the feature, and for a faction that has no Wish", () => {
    expect(wishOf("plague", 0, 0, featureSet({ statusEffects: true }))).toBeUndefined();
    expect(wishOf("", 0)).toBeUndefined();
    expect(wishOf("not-a-faction", 0)).toBeUndefined();
  });

  it("reads the ready time of the bot itself, never of another player", () => {
    const plain = wishWorld("holy", 5000);
    const { state, reads } = logged(plain);
    const frame = perceive({ state }, { selfId: "me", map: testMap(), features: wishOn, lastMinimap: null });
    expect(frame.extras.wish?.readyAt).toBe(5000);
    expect(reads.get("player:me")!.has("wishReadyAt")).toBe(true);
    expect(reads.get("player:rival")!.has("wishReadyAt")).toBe(false);
  });

  it("is plain data, and a plain state, its schema copy and a decoded client give the same Frame", () => {
    const plain = wishWorld("fire", 123_456);
    const frames = run(6, () => ({ state: wishWorld("fire", 123_456) }), { features: wishOn });
    const wish = lastOf(frames).extras.wish!;
    expect(structuredClone(lastOf(frames))).toEqual(lastOf(frames));
    expect(wish.def).toEqual(JSON.parse(JSON.stringify(ABILITIES.blaze)));
    const server = toSchemaState(plain);
    const client = decodedCopy(server);
    const ctx = { selfId: "me", map: testMap(), features: wishOn, lastMinimap: null };
    const fs = perceive({ state: server }, ctx);
    const fc = perceive({ state: client }, ctx);
    expect(fs.extras.wish).toMatchObject({ ability: "blaze", readyAt: 123_456 });
    expect(JSON.stringify(fs)).toBe(JSON.stringify(fc));
  });
});

// ============================================================================================================ fx visibility

describe("which fx a bot observes (docs/BOTS.md 3.4)", () => {
  // `on` stands in the window, `off` far off it, `near` in the margin band (in the frame, not in the window).
  const others = {
    players: { on: { x: 1200, y: 1000 }, off: { x: 3000, y: 3000 }, near: { x: SELF.x + BOT_VIEW.halfW + 30, y: 1000 } },
    mobs: { mon: { x: 900, y: 1100 }, moff: { x: 3100, y: 3100 }, eoff: { x: 3200, y: 2900, kind: "elite" } },
  };
  const at = (k: number, events: FxEvent[]): Spec => ({ state: world(others), events: k === 2 ? events : [] });
  const seen = (events: FxEvent[]): ObservedEvent[] => allEvents(run(10, (k) => at(k, events)));

  it("windup, swing, stagger, cancel, heal, buff, combo: only when the subject is drawn, or is the bot", () => {
    const evs = seen([
      { kind: "windup", by: "on", weapon: "axe", a: 1, ms: 250 },
      { kind: "windup", by: "off", weapon: "axe", a: 1, ms: 250 },
      { kind: "windup", by: "near", weapon: "axe", a: 1, ms: 250 },
      { kind: "swing", by: "mon", weapon: "axe", x: 900, y: 1100, a: 0 },
      { kind: "swing", by: "moff", weapon: "axe", x: 0, y: 0, a: 0 },
      { kind: "stagger", id: "on" }, { kind: "stagger", id: "off" },
      { kind: "cancel", id: "me" }, { kind: "cancel", id: "near" },
      { kind: "heal", id: "on", amount: 7.6 }, { kind: "heal", id: "on", amount: 0.4 }, { kind: "heal", id: "off", amount: 7 },
      { kind: "buff", id: "on", stat: "hp", stacks: 0.734, total: 2.5 }, { kind: "buff", id: "me", stat: "hp", stacks: 0.734, total: 2.5 },
      { kind: "combo", id: "off", combo: "dash", proc: true }, { kind: "combo", id: "me", combo: "dash", proc: false },
    ]);
    const brief = evs.map((e) => `${e.kind}:${"by" in e ? e.by : "id" in e ? e.id : ""}`);
    expect(brief).toEqual(["windup:on", "swing:mon", "stagger:on", "cancel:me", "heal:on", "buff:on", "buff:me", "combo:me"]);
    // Numbers as drawn: a whole heal, someone else's buff as "+0.7" with no total, the bot's own exact.
    expect(evs.find((e) => e.kind === "heal")).toMatchObject({ amount: 8 });
    expect(evs.filter((e) => e.kind === "buff")).toMatchObject([{ id: "on", stacks: 0.7, total: -1 }, { id: "me", stacks: 0.734, total: 2.5 }]);
  });

  it("hit and block: when the victim is drawn (or is the bot); the attacker only when it is drawn too", () => {
    const evs = seen([
      { kind: "hit", id: "on", by: "off", amount: 12.4, weapon: "bow" },
      { kind: "hit", id: "me", by: "on", amount: 3.2, weapon: "axe" },
      { kind: "hit", id: "me", by: "near", amount: 5, weapon: "bow" },
      { kind: "hit", id: "off", by: "me", amount: 9, weapon: "axe" },
      { kind: "hit", id: "on", by: "me", amount: 0.3, weapon: null, sig: "burn" },
      { kind: "block", id: "mon", by: "off", weapon: "sword" },
      { kind: "block", id: "off", by: "on", weapon: "sword" },
    ]);
    expect(evs.map((e) => (e.kind === "hit" || e.kind === "block" ? [e.kind, e.id, e.by] : []))).toEqual([
      ["hit", "on", null], ["hit", "me", "on"], ["hit", "me", null], ["hit", "on", "me"], ["block", "mon", null],
    ]);
    expect(evs.filter((e) => e.kind === "hit").map((e) => (e.kind === "hit" ? e.amount : 0))).toEqual([12, 3, 5, 0]);
  });

  it("deaths: a player's by name everywhere (where and by whom on screen); a mob's on screen; an elite's everywhere, killer named", () => {
    const evs = seen([
      { kind: "death", id: "off", x: 3000, y: 3000, by: "on" },
      { kind: "death", id: "on", x: 1200, y: 1000, by: "off" },
      { kind: "death", id: "near", x: SELF.x + BOT_VIEW.halfW + 30, y: 1000, by: "on" },
      { kind: "death", id: "mon", x: 900, y: 1100, by: "me" },
      { kind: "death", id: "moff", x: 3100, y: 3100, by: "off" },
      { kind: "death", id: "eoff", x: 3200, y: 2900, by: "off" },
    ]);
    expect(evs.map((e) => (e.kind === "death" ? [e.id, e.name, e.at === null, e.by, e.mob] : []))).toEqual([
      ["off", "OFF", true, null, false],
      ["on", "ON", false, null, false],
      ["near", "NEAR", true, null, false],
      ["mon", "Mob mon", false, "me", true],
      ["eoff", "Mob eoff", true, "off", true],
    ]);
  });

  it("projEnd where it stops on screen; bounty, teleport and victory always; never a field naming someone unseen", () => {
    const evs = seen([
      { kind: "projEnd", id: "x1", proj: "arrow", x0: 1100, y0: 1000, t0: T0, x: 1150, y: 1000, reason: "wall" },
      { kind: "projEnd", id: "x2", proj: "arrow", x0: 3000, y0: 3000, t0: T0, x: 3050, y: 3000, reason: "wall" },
      { kind: "bounty", id: "off", name: "OFF", bounty: 10 },
      { kind: "victory", id: "off", name: "OFF", draw: false },
      { kind: "teleport" },
    ]);
    expect(evs.map((e) => e.kind)).toEqual(["projEnd", "bounty", "victory", "teleport"]);
    expect(evs[0]).toMatchObject({ id: "x1", at: { x: 1150, y: 1000 } });
  });

  it("an fx kind the brain does not name passes as `ext` under its subject's rule, names of the unseen masked", () => {
    const ext = [
      { kind: "cast", by: "on", ability: "freeze", target: "off", x: 1, y: 2, ms: 250 },
      { kind: "cast", by: "off", ability: "swarm", target: "on", ms: 250 },
      { kind: "castLand", by: "near", ability: "trial" },
      { kind: "status", id: "me", status: "stun", ms: 900 },
      { kind: "zoneFlash", x: 1100, y: 1000 },
      { kind: "zoneFlash", x: 3000, y: 3000 },
      { kind: "fieldEnd", id: "field7", x: 1050, y: 990 },
    ];
    const evs = allEvents(run(10, (k) => ({ state: world(others), ext: k === 2 ? ext : undefined })));
    expect(evs).toMatchObject([
      { kind: "ext", fx: "cast", data: { by: "on", ability: "freeze", target: null, x: 1, y: 2, ms: 250 } },
      { kind: "ext", fx: "status", data: { id: "me", status: "stun", ms: 900 } },
      { kind: "ext", fx: "zoneFlash", at: { x: 1100, y: 1000 } },
      { kind: "ext", fx: "fieldEnd", at: { x: 1050, y: 990 }, data: { id: "field7" } },
    ]);
  });
});

// ======================================================================================================== the delay ring

describe("frames.ts: delay, interpolation, velocity and events", () => {
  /** A foe walking east at 200 u/s from x 1000 + 100, the bot standing. */
  const walking = (k: number): Spec => ({ state: world({ players: { w: { x: 1100 + 10 * k, y: 1000 } } }) });

  it("is null until the ring covers the world delay, then one Percept per frame at now - 130", () => {
    const { s } = scenarioOf(8, walking);
    const ring = createFrameRing();
    const cfg: ComposeConfig = { ...IN_PROCESS, map: s.map, features: s.features, attentionCentral: 0.65 };
    const out: Array<Percept | null> = [];
    for (const input of scenarioInputs(s)) {
      ring.push(perceive(input, { selfId: "me", map: s.map, features: s.features, lastMinimap: null }));
      out.push(ring.compose(cfg));
    }
    expect(out.map((p) => p !== null)).toEqual([false, false, false, true, true, true, true, true]);
    for (const [k, p] of out.entries()) if (p) expect([p.now, p.viewT]).toEqual([T0 + k * FRAME_MS, T0 + k * FRAME_MS - 130]);
  });

  it("interpolates others at viewT, never ahead, and reads velocity off two samples 100 ms apart once both were on screen", () => {
    const ps = run(12, walking);
    for (const p of ps) {
      const f = p.fighters.find((x) => x.id === "w")!;
      expect(f.x).toBeCloseTo(1100 + (200 * (p.viewT - T0)) / 1000, 9);
      expect(f.dist).toBeCloseTo(f.x - SELF.x, 9);
      if (p.viewT - 100 >= T0) expect([f.vx, f.vy].map((v) => Math.round(v))).toEqual([200, 0]);
      else expect([f.vx, f.vy]).toEqual([0, 0]);
    }
  });

  it("gives 0 velocity to a fighter that was not on screen 100 ms earlier", () => {
    // It walks in from just past the right edge at 600 u/s.
    const ps = run(14, (k) => ({ state: world({ players: { w: { x: SELF.x + BOT_VIEW.halfW + 40 - 30 * k, y: 1000 } } }) }));
    const first = ps.find((p) => p.fighters.length > 0)!;
    const later = lastOf(ps).fighters[0]!;
    expect(first.fighters[0]!.vx).toBe(0);
    expect(Math.round(later.vx)).toBe(-600);
  });

  it("takes the bot from now - selfDelayMs, and what a client reads off its latest patch (hp, weapon) from that frame too", () => {
    const build = (k: number): Spec => ({
      state: (() => {
        const s = world({ players: { w: { x: 1200, y: 1000, hp: 500 - 50 * k, maxHp: 500 } } });
        s.players.get("me")!.x = SELF.x + k;
        return s;
      })(),
    });
    for (const p of run(10, build)) {
      const k = (p.now - T0) / FRAME_MS;
      // In-process: the newest frame at or before now - 30 is the one before the newest.
      expect(p.self.x).toBe(SELF.x + (k - 1));
      expect(p.fighters[0]!.hpFrac).toBeCloseTo(Math.round(((500 - 50 * (k - 1)) / 500) / HP_QUANT) * HP_QUANT, 9);
    }
    for (const p of run(10, build, { selfDelayMs: 0, worldDelayMs: 100 })) {
      expect([p.self.x, p.viewT]).toEqual([SELF.x + (p.now - T0) / FRAME_MS, p.now - 100]);
    }
  });

  it("hands out every event exactly once: world fx at render time, toasts and results at the self delay", () => {
    const n = 16;
    const { s } = scenarioOf(n, (k) => ({
      state: world({ players: { on: { x: 1200, y: 1000 } } }),
      events: [{ kind: "heal", id: "on", amount: 10 + k }, { kind: "heal", id: "me", amount: 100 + k }],
      toasts: [`toast ${k}`],
    }));
    const ring = createFrameRing();
    const cfg: ComposeConfig = { ...IN_PROCESS, map: s.map, features: s.features, attentionCentral: 0.65 };
    const got: ObservedEvent[] = [];
    for (const input of scenarioInputs(s)) {
      ring.push(perceive(input, { selfId: "me", map: s.map, features: s.features, lastMinimap: null }));
      const p = ring.compose(cfg);
      // Composing again before the next frame hands out nothing new.
      const again = ring.compose(cfg);
      expect(again?.events ?? []).toEqual([]);
      for (const ev of p?.events ?? []) {
        if (ev.kind !== "toast") expect(ev.t).toBeLessThanOrEqual(p!.viewT);
        else expect(ev.t).toBeLessThanOrEqual(p!.now - IN_PROCESS.selfDelayMs);
        got.push(ev);
      }
    }
    const heals = got.filter((e) => e.kind === "heal").map((e) => (e.kind === "heal" ? e.amount : 0));
    const toasts = got.filter((e) => e.kind === "toast").map((e) => (e.kind === "toast" ? e.text : ""));
    // Everything up to the last percept's viewT (and toasts up to its self time) came out, once each, in order.
    const lastView = T0 + (n - 1) * FRAME_MS - 130;
    const dueFrames = Array.from({ length: n }, (_, k) => k).filter((k) => T0 + k * FRAME_MS <= lastView);
    expect(heals).toEqual(dueFrames.flatMap((k) => [10 + k, 100 + k]));
    expect(toasts).toEqual(Array.from({ length: n - 1 }, (_, k) => `toast ${k}`));
  });

  it("never slides across a teleport: the old place holds until render time reaches it", () => {
    const ps = run(12, (k) => ({
      state: world({ players: { w: { x: k < 6 ? 1100 : 1180, y: 1000 } } }),
      events: k === 6 ? [{ kind: "teleport" }] : [],
    }));
    const cutT = T0 + 6 * FRAME_MS;
    for (const p of ps) {
      const w = p.fighters.find((f) => f.id === "w")!;
      expect(w.x).toBe(p.viewT < cutT ? 1100 : 1180);
      // A jump is not motion: no velocity across the cut.
      if (p.viewT >= cutT && p.viewT - 100 < cutT) expect(w.vx).toBe(0);
    }
  });

  it("keeps the screen around the old spot until a teleport of the bot itself is drawn, as the client's camera does", () => {
    const far = { x: SELF.x + 2400, y: SELF.y + 1500 };
    const ps = run(12, (k) => {
      const moved = k >= 6;
      const s = world({ players: { old: { x: SELF.x + 100, y: SELF.y }, arrive: moved ? { x: far.x + 100, y: far.y } : { x: 5000, y: 5000 } } });
      Object.assign(s.players.get("me")!, moved ? far : SELF);
      return { state: s, events: k === 6 ? [{ kind: "teleport" }] : [] };
    });
    const cutT = T0 + 6 * FRAME_MS;
    for (const p of ps) {
      const drawn = p.viewT < cutT;
      // The HUD (and SelfView) follows the latest patch at once; the window waits for the cut.
      if (p.now - IN_PROCESS.selfDelayMs >= cutT) expect([p.self.x, p.self.y]).toEqual([far.x, far.y]);
      expect(ids(p.fighters), `at ${p.viewT}`).toEqual(drawn ? ["old"] : ["arrive"]);
      if (drawn) expect(p.fighters[0]!.dist).toBe(100);
    }
    expect(ps.some((p) => p.viewT < cutT && p.self.x === far.x)).toBe(true);
  });

  it("ignores a frame older than the newest", () => {
    const { s } = scenarioOf(6, walking);
    const ring = createFrameRing();
    const frames = scenarioInputs(s).map((input) => perceive(input, { selfId: "me", map: s.map, features: s.features, lastMinimap: null }));
    for (const f of frames) ring.push(f);
    ring.push({ ...frames[1]!, events: [{ kind: "teleport", t: frames[1]!.t, at: null }] });
    expect(ring.size).toBeLessThanOrEqual(frames.length);
    const p = ring.compose({ ...IN_PROCESS, map: s.map, features: s.features, attentionCentral: 0.65 })!;
    expect(p.events.some((e) => e.kind === "teleport")).toBe(false);
  });

  it("keeps a dead player standing until its death plays, a mob fading 450 ms after, and a body hidden until then", () => {
    const ps = run(24, (k, t) => {
      const s = world({
        players: { v: { x: 1200, y: 1000, status: k >= 4 ? "dead" : "alive", hp: k >= 4 ? 0 : 300 } },
        mobs: { m: { x: 900, y: 1000, status: k >= 4 ? "dead" : "alive", hp: k >= 4 ? 0 : 100 } },
      });
      if (k >= 4) s.containers.set("body", plainContainer({ id: "body", kind: "body", x: 1200, y: 1000, label: "V", items: [] }));
      return { state: s, events: k === 4 ? [{ kind: "death", id: "v", x: 1200, y: 1000, by: "me" }, { kind: "death", id: "m", x: 900, y: 1000, by: "me" }] : [] };
    });
    const died = T0 + 4 * FRAME_MS;
    for (const p of ps) {
      const v = p.fighters.find((f) => f.id === "v"), m = p.mobs.find((x) => x.id === "m");
      const body = p.containers.some((c) => c.id === "body");
      expect(v !== undefined, `player at ${p.viewT}`).toBe(p.viewT < died);
      expect(body, `body at ${p.viewT}`).toBe(p.now - 30 >= died && p.viewT >= died);
      expect(m !== undefined, `mob at ${p.viewT}`).toBe(p.viewT < died + 450);
      if (v && p.now - 30 >= died) expect(v.status).toBe("dead");
    }
  });
});

// ================================================================================================= what else is composed

describe("projectiles, tint, containers, minimap", () => {
  it("flies a launch to viewT, credits the drawn shooter, stops it when its projEnd plays, flies an unannounced one too", () => {
    const ps = run(16, (k, t) => ({
      state: world({ players: { s: { x: 1100, y: 1000 } } }),
      launches: k === 3 ? [{ id: "a", kind: "arrow", x: 1100, y: 1000, vx: -900, vy: 0, t, range: 240 }] : [],
      events: [
        ...(k === 5 ? [{ kind: "projEnd", id: "a", proj: "arrow", x0: 0, y0: 0, t0: 0, x: 1000, y: 1000, reason: "hit" } as FxEvent] : []),
        ...(k === 6 ? [{ kind: "projEnd", id: "b", proj: "ball", x0: 1050, y0: 900, t0: t - 40, x: 1050, y: 950, reason: "wall" } as FxEvent] : []),
      ],
    }));
    const launchT = T0 + 3 * FRAME_MS, endT = T0 + 5 * FRAME_MS;
    for (const p of ps) {
      const a = p.projectiles.find((q) => q.id === "a");
      if (p.viewT < launchT || p.viewT >= endT) expect(a).toBeUndefined();
      else {
        expect(a).toMatchObject({ from: "s", y: 1000, x0: 1100 });
        expect(a!.x).toBeCloseTo(Math.max(1000, 1100 - 0.9 * (p.viewT - launchT)), 9);
      }
    }
    expect(ps.some((p) => p.projectiles.some((q) => q.id === "b" && q.kind === "ball" && q.from === null))).toBe(true);
  });

  it("tints only the nearest foe in sight within MATCHUP_RANGE, and none when a mob is nearer", () => {
    const spot = openSpot();
    // A faction the bot's (fire) has an edge over, so the hue is not 0.
    const prey = FACTION_IDS.find((f) => factionEdge("fire", f) !== 0)!;
    const scene = (mob: boolean) => lastOf(run(8, () => {
      const s = world({
        players: {
          near: { x: spot.x + 80, y: spot.y, faction: prey, weapon0: "axe" }, far: { x: spot.x + 140, y: spot.y, faction: prey, weapon0: "bow" },
        },
      });
      Object.assign(s.players.get("me")!, spot);
      if (mob) s.mobs.set("mob", plainMob({ x: spot.x + 30, y: spot.y, faction: "holy" }));
      return { state: s };
    }));
    const p = scene(false);
    const near = p.fighters.find((f) => f.id === "near")!, far = p.fighters.find((f) => f.id === "far")!;
    expect([near.los, far.los]).toEqual([true, true]);
    expect(near.tint).toBe(matchupTint(matchupScore({ faction: "fire", weapon: "axe" }, { faction: prey, weapon: "axe" }), near.dist));
    expect(near.tint).not.toBe(0);
    expect(far.tint).toBe(0);
    expect(scene(true).fighters.map((f) => f.tint)).toEqual([0, 0]);
  });

  it("shows a chest's weapon only on the interaction target, a loose weapon's always, and an empty body only at it", () => {
    const spot = openSpot();
    const ps = run(8, () => {
      const s = world();
      Object.assign(s.players.get("me")!, spot);
      s.containers.set("near", plainContainer({ id: "near", kind: "chest", x: spot.x + 10, y: spot.y, items: [{ uid: "1", def: "bow" }] }));
      s.containers.set("near2", plainContainer({ id: "near2", kind: "chest", x: spot.x + 20, y: spot.y, items: [{ uid: "2", def: "wand" }] }));
      s.containers.set("far", plainContainer({ id: "far", kind: "chest", x: spot.x + 300, y: spot.y, items: [{ uid: "3", def: "axe" }] }));
      s.containers.set("open", plainContainer({ id: "open", kind: "chest", x: spot.x - 300, y: spot.y, items: [] }));
      s.containers.set("loose", plainContainer({ id: "loose", kind: "ground", x: spot.x, y: spot.y + 300, items: [{ uid: "4", def: "shield" }] }));
      return { state: s };
    });
    const c = Object.fromEntries(lastOf(ps).containers.map((x) => [x.id, x]));
    expect(c["near"]).toMatchObject({ interactable: true, closed: true, weapon: "bow" });
    expect(c["near2"]).toMatchObject({ interactable: false, closed: true, weapon: undefined });
    expect(c["far"]).toMatchObject({ interactable: false, closed: true, weapon: undefined });
    expect(c["open"]).toMatchObject({ closed: false, weapon: null });
    expect(c["loose"]).toMatchObject({ closed: true, weapon: "shield" });
    expect(c["near"]!.dist).toBeLessThanOrEqual(INTERACT_RANGE);
  });

  it("puts every living regional mob on the minimap, 16 u steps, repainted every 100 ms", () => {
    const ps = run(10, (k) => ({
      state: world({
        mobs: {
          a: { x: 5003 + k, y: 77, kind: "elite", faction: "holy" }, b: { x: 1200, y: 1000 }, d: { x: 40, y: 40, kind: "dummy" },
          dead: { x: 60, y: 60, status: "dead" },
        },
      }),
    }));
    for (const p of ps) {
      expect(p.minimap.mobs.map((d) => d.id)).toEqual(["a", "b"]);
      // Repainted at T0, T0 + 100...; the percept shows the latest patch's (the self frame's).
      expect((p.minimap.t - T0) % 100).toBe(0);
      expect(p.now - p.minimap.t).toBeLessThanOrEqual(150);
      for (const d of p.minimap.mobs) expect([d.x % MINIMAP_QUANT, d.y % MINIMAP_QUANT]).toEqual([0, 0]);
      expect(p.minimap.mobs[0]).toMatchObject({ elite: true, faction: "holy", y: 80 });
    }
  });
});

// ============================================================================================================== performance

describe("cost", () => {
  it("perceive + compose stay a small part of the brain's 1.5 ms per tick for 8 bots", () => {
    const scenarios = Array.from({ length: 8 }, (_, i) => buildScenario(100 + i, { frames: 40 }));
    // 60 mobs about, as on a full map.
    for (const s of scenarios) {
      for (const f of s.frames) {
        for (let i = 0; i < 50; i++) f.state.mobs.set(`x${i}`, plainMob({ x: (i * 397) % 2048, y: (i * 911) % 2048 }));
      }
    }
    const inputs = scenarios.map(scenarioInputs);
    const rings = scenarios.map(() => createFrameRing());
    const last: Array<MinimapView | null> = scenarios.map(() => null);
    let frames: Frame[] = [];
    const t0 = performance.now();
    for (let k = 0; k < 40; k++) {
      frames = [];
      for (const [b, s] of scenarios.entries()) {
        const frame = perceive(inputs[b]![k]!, { selfId: "me", map: s.map, features: s.features, lastMinimap: last[b]! });
        last[b] = frame.minimap;
        rings[b]!.push(frame);
        rings[b]!.compose({ ...IN_PROCESS, map: s.map, features: s.features, attentionCentral: 0.65 });
        frames.push(frame);
      }
    }
    const perTick = (performance.now() - t0) / 40;
    expect(frames.length).toBe(8);
    // Measured about 0.25 ms per tick for all 8 once warm (perceive 0.12, compose 0.11); the bound only catches a pathological regression.
    expect(perTick).toBeLessThan(3);
  });
});
