// Perception (docs/BOTS.md 3): the one brain file that reads the synced state. Each frame it copies out what the game client
// would draw for this player and nothing more, as plain data (a Frame): positions through Math.fround and timers truncated,
// so the server's doubles and a client's decoded float32s give the same Frame; other fighters' hp as a bar; no field the
// client never draws (the other weapon slot, card power, kills, gv, readyAt, attackTarget, moveSeq, look, mirrors). A Frame
// holds a FRAME_MARGIN beyond the window so frames.ts can apply the exact window around the delayed self.
//
// Both drivers build a PerceptionInput: BotManager from the server's RaidState and the very `fxs` batches the Room
// broadcasts, BotClient from the SDK-decoded room.state and the batches it received. The fx are decoded against
// state.roster with unpackFx/unpackLaunches, exactly as RaidScene does.
import * as shared from "@raid/shared";
import {
  abilityInSlot, cardPower, CHEST_PANEL_SLACK, CHEST_RANGE, CLIENT_MESSAGE_TYPES, decodeMult, EFFECT_CASTING, FACTION_IDS, hasLineOfSight,
  hpBarFractions, INTERACT_RANGE, isDot,
  isFactionId, isWeaponId, MASK_MOVE, TELEPORT_IMMUNITY_MS, TERRAIN_EMBER, TERRAIN_LIGHT, unpackFx, unpackLaunches, WEAPONS, withGates,
  type FactionId, type FxBatch, type GameMap, type RunResult, type TimedFx, type Vec2, type WeaponId,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import {
  BOT_VIEW, FRAME_MARGIN, HP_QUANT, MINIMAP_QUANT, MINIMAP_REFRESH_MS, WORLD_RENDER_DELAY_MS,
  type CampView, type ContainerSeen, type Features, type FieldView, type FighterId, type FighterSeen, type Frame, type HudView, type MinimapMob,
  type MinimapView, type MobSeen, type ObservedEvent, type Perceive, type PerceptExtras, type ProjectileView, type RewardChestView,
  type SelfView, type WishView,
} from "./types";

// ============================================================================================================ input shapes

/** A keyed collection: a Colyseus MapSchema (server or decoded) and a Map both iterate as `[key, value]` and answer get/size. */
export interface KeyedLike<V> extends Iterable<readonly [string, V]> {
  get(key: string): V | undefined;
  readonly size: number;
}

/** A list: an ArraySchema or an array. */
export interface ListLike<T> {
  readonly length: number;
  at(index: number): T | undefined;
}

/** The fields players and mobs share that perception may read (and only when the client draws them). */
export interface FighterLike {
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly status: string;
  readonly faction: string;
  readonly weapon0: string;
  readonly weapon1: string;
  readonly slot: number;
  readonly drawStartedAt: number;
  readonly sig: number;
  readonly brand: number;
  /** EFFECT_* bits (Wishes branch); read only when Features.statusEffects. */
  readonly effects?: number;
}

/** A PlayerState. The extra fields are read for the bot itself only (its HUD), never for anyone else. */
export interface PlayerLike extends FighterLike {
  readonly name: string;
  readonly bot: boolean;
  readonly barrier: number;
  readonly bounty: number;
  readonly immuneUntil: number;
  readonly attackTarget: string;
  readonly readyAt: number;
  readonly kills: number;
  readonly mobKills: number;
  readonly gv: number;
  readonly moveSeq: number;
  /** The cards held, id -> count (the build strip). Optional: a server that predates them leaves it out. */
  readonly build?: { forEach(cb: (count: number, id: string) => void): void };
  readonly asMult: number;
  /** The windup mirror, wire form (thousandths). Optional: a server that predates it leaves it out. */
  readonly windupMult?: number;
  readonly speedMult: number;
  /** The Wish's ready time (server ms, 0 = ready): the weapon bar's cooldown widget shows it. Read for the bot itself only. */
  readonly wishReadyAt?: number;
  /** Normal mob stat stacks; read for the bot itself only. */
  readonly mobStats?: { forEach(cb: (count: number, id: string) => void): void };
}

export interface MobLike extends FighterLike {
  readonly kind: string;
  readonly name: string;
  readonly type?: string;
}

export interface ItemLike {
  readonly def: string;
}

export interface ContainerLike {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly items: ListLike<ItemLike>;
  /** A camp's shared chest (kind "reward", R5): when it vanishes, its cards, who took each, and who has picked. Absent on a server without them. */
  readonly expiresAt?: number;
  readonly options?: ListLike<string>;
  readonly takenBy?: ListLike<string>;
  readonly pickers?: ListLike<string>;
}

/** A RaidState.camps entry (R5). */
export interface CampLike {
  readonly clearedAt?: number;
  readonly respawnAt?: number;
  readonly wardOwner?: string;
  readonly wardExpiresAt?: number;
  readonly type: string;
  readonly reward: string;
  readonly alive: number;
  readonly state: number;
}

/** A Wishes FieldState (kind and ability are indices into shared FIELD_KINDS / ABILITY_IDS there). */
export interface FieldLike {
  readonly kind: number | string;
  readonly ability: number | string;
  readonly x: number;
  readonly y: number;
  readonly x2: number;
  readonly y2: number;
  readonly r: number;
  readonly owner: string;
  readonly endsAt: number;
}

/** The room state as either driver holds it. Never `tick` (noSync, server only): perception does not read it. */
export interface StateLike {
  readonly phase: string;
  readonly serverTime: number;
  readonly lobbyEndsAt: number;
  readonly raidStartedAt: number;
  readonly minPlayers: number;
  readonly startedWith: number;
  readonly patienceEndsAt: number;
  readonly inColiseum: boolean;
  readonly gatesLocked: boolean;
  readonly suddenDeathAt: number;
  readonly winner: string;
  readonly training: boolean;
  readonly players: KeyedLike<PlayerLike>;
  readonly mobs: KeyedLike<MobLike>;
  readonly containers: KeyedLike<ContainerLike>;
  /** Only to decode the fx batches; never copied into a Frame. */
  readonly roster: ArrayLike<string>;
  readonly fields?: KeyedLike<FieldLike>;
  /** One per map camp, in `map.camps` order (R5). */
  readonly camps?: ArrayLike<CampLike>;
}

/** Compile-time proof that the server's (and the SDK's decoded) RaidState is a StateLike. */
type RaidStateFits = RaidState extends StateLike ? true : never;
const RAID_STATE_FITS: RaidStateFits = true;
void RAID_STATE_FITS;

/** A private server message to this bot (R3 `plan`, R7 `reveal`). */
export interface PrivateMessage {
  readonly type: string;
  readonly msg: unknown;
}

/**
 * What a driver hands perception once per frame (one patch): the state as it now stands, plus what arrived for this bot
 * since the previous frame. Every field but `state` may be left out when nothing came.
 */
export interface PerceptionInput {
  readonly state: StateLike;
  /** The `fxs` batches since the last frame, in arrival order (decoded here against state.roster). */
  readonly fxs?: readonly FxBatch[];
  /** `toast` texts addressed to this bot. */
  readonly toasts?: readonly string[];
  /** This bot's run result, if it arrived. */
  readonly result?: RunResult | null;
  readonly privates?: readonly PrivateMessage[];
}

// ======================================================================================================== small helpers

/** Wishes status bits (shared status.ts there): hidden fighters are not drawn for anyone else; untargetable ones are not picked. */
const EFFECT_UNTARGETABLE = 128;
const EFFECT_HIDDEN = 256;

const f32 = Math.fround;
/** A uint32 timer as the wire carries it: whole ms. */
const u32 = (v: number): number => v >>> 0;
const HP_STEPS = Math.round(1 / HP_QUANT);
/** Client ProjectileView: a projectile that stopped within this of where it started has no flight to draw. */
const MIN_FLIGHT = 2;
/** Client FxView: heals smaller than this are not drawn. */
const MIN_HEAL_SHOWN = 1;

const weaponOf = (id: string): WeaponId | null => (isWeaponId(id) ? id : null);
const factionOf = (id: string): FactionId | null => (isFactionId(id) ? id : null);
/** The weapon in hand: only the slot in hand is read (the other is never drawn). */
const inHandOf = (f: FighterLike): WeaponId | null => weaponOf(f.slot === 1 ? f.weapon1 : f.weapon0);

/** A share read off a bar: HP_QUANT steps, and a sliver (one step) for anything above 0. */
function barShare(v: number): number {
  if (!(v > 0)) return 0;
  return Math.max(1, Math.round(v * HP_STEPS)) / HP_STEPS;
}

const quantMinimap = (v: number): number => Math.round(v / MINIMAP_QUANT) * MINIMAP_QUANT;

/** Inside the window (plus `pad`) centred on (cx, cy): the centre's |dx| <= halfW and |dy| <= halfH. */
export function inView(cx: number, cy: number, x: number, y: number, pad = 0): boolean {
  return Math.abs(x - cx) <= BOT_VIEW.halfW + pad && Math.abs(y - cy) <= BOT_VIEW.halfH + pad;
}

/** A field touches the window (plus `pad`): a trail is its segment widened by r, anything else a disc. */
export function fieldInView(cx: number, cy: number, f: Pick<FieldView, "kind" | "x" | "y" | "x2" | "y2" | "r">, pad = 0): boolean {
  const line = f.kind === "trail";
  const x0 = line ? Math.min(f.x, f.x2) : f.x, x1 = line ? Math.max(f.x, f.x2) : f.x;
  const y0 = line ? Math.min(f.y, f.y2) : f.y, y1 = line ? Math.max(f.y, f.y2) : f.y;
  const w = BOT_VIEW.halfW + pad + f.r, h = BOT_VIEW.halfH + pad + f.r;
  return x1 >= cx - w && x0 <= cx + w && y1 >= cy - h && y0 <= cy + h;
}

/** A JSON-like deep copy of message data: no prototypes, functions or references survive. */
export function plainCopy(v: unknown, depth = 0): unknown {
  if (v === null) return null;
  const type = typeof v;
  if (type === "function" || type === "symbol" || type === "bigint") return undefined;
  if (type !== "object") return v;
  if (depth > 8) return undefined;
  if (Array.isArray(v)) return v.map((x) => plainCopy(x, depth + 1) ?? null);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as object)) {
    const x = plainCopy((v as Record<string, unknown>)[k], depth + 1);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

// ======================================================================================================== feature detection

/** What detectFeatures inspects: instances, never classes (perception may not import the schema at runtime). */
export interface FeatureProbe {
  /** The room state (a RaidState instance, or a decoded one). */
  readonly state: object;
  /** A PlayerState instance: `new PlayerState()` in-process, any decoded player over the network. Default: the state's first. */
  readonly player?: object | null;
  /** The room's map (generateMap(seed, attempt)): its floor hazards (`terrain`, R2's zone terrain), by presence. */
  readonly map?: GameMap | null;
  /** The message types the server accepts. Default shared CLIENT_MESSAGE_TYPES (client and server ship together). */
  readonly messageTypes?: readonly string[];
}

/** A shared export by name, or undefined on a branch that lacks it (never imported by name: it may not exist here). */
function sharedExport(name: string): unknown {
  const exported = shared as unknown as Record<string, unknown>;
  return name in exported ? exported[name] : undefined;
}

/** Does any faction have an ability in the Q or E slot? The schema carries the fields before the skills exist (R6), and until then they are unused. */
function skillSlotsFilled(): boolean {
  try {
    return FACTION_IDS.some((faction) => abilityInSlot({ faction }, "q") !== null || abilityInSlot({ faction }, "e") !== null);
  } catch {
    return false;
  }
}

function firstPlayer(state: object): object | null {
  const players = (state as { players?: unknown }).players as Iterable<readonly [string, object]> | undefined;
  if (!players || typeof (players as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== "function") return null;
  for (const [, p] of players) return p;
  return null;
}

/**
 * What this server and branch can do (docs/BOTS.md 8), by runtime presence only: message types, schema fields by
 * `key in instance` (prototype accessors answer), shared exports by name, the map's hazards. Once per room.
 */
/** A tile of ember, bog, ice or light anywhere (the floor kinds that act on a fighter; lava, fence and crevasse only block). */
function hasFloorHazard(map: GameMap): boolean {
  const terrain = (map as { terrain?: ArrayLike<number> }).terrain;
  if (!terrain) return false;
  for (let i = 0; i < terrain.length; i++) if (terrain[i]! >= TERRAIN_EMBER && terrain[i]! <= TERRAIN_LIGHT) return true;
  return false;
}

export function detectFeatures(probe: FeatureProbe): Features {
  const types = [...(probe.messageTypes ?? CLIENT_MESSAGE_TYPES)];
  const accepts = (t: string): boolean => types.includes(t);
  const player = probe.player ?? firstPlayer(probe.state);
  const has = (o: object | null | undefined, key: string): boolean => o != null && key in o;
  const hazards = probe.map != null && (hasFloorHazard(probe.map)
    || (has(probe.map, "hazards") && (probe.map as unknown as Record<string, unknown>)["hazards"] != null));
  return {
    messageTypes: types,
    wishes: accepts("cast") && has(player, "wishReadyAt") && sharedExport("ABILITIES") !== undefined,
    statusEffects: has(player, "effects"),
    fields: has(probe.state, "fields"),
    planning: accepts("plan"),
    chests: accepts("choose"),
    skills: accepts("cast") && has(player, "qReadyAt") && has(player, "eReadyAt") && skillSlotsFilled(),
    relics: has(player, "build"),
    camps: has(probe.state, "camps"),
    hazards,
  };
}

// ================================================================================================================ perceive

/** The synced build map (id -> count) as a plain record; what the bot's own cards row shows. */
function buildRecord(build: PlayerLike["build"]): Record<string, number> {
  const out: Record<string, number> = {};
  build?.forEach((count, id) => { if (count > 0) out[id] = count; });
  return out;
}

function mobStatsRecord(map: PlayerLike["mobStats"]): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  map?.forEach((count, id) => { if (count > 0) out[id] = count; });
  return out;
}

function selfView(id: FighterId, p: PlayerLike): SelfView {
  return {
    id,
    name: p.name,
    x: f32(p.x),
    y: f32(p.y),
    facing: f32(p.facing),
    status: p.status,
    hp: f32(p.hp),
    maxHp: f32(p.maxHp),
    barrier: f32(p.barrier),
    faction: factionOf(p.faction),
    weapons: [weaponOf(p.weapon0), weaponOf(p.weapon1)],
    slot: p.slot === 1 ? 1 : 0,
    attackTarget: p.attackTarget === "" ? null : p.attackTarget,
    drawStartedAt: u32(p.drawStartedAt),
    readyAt: u32(p.readyAt),
    immuneUntil: u32(p.immuneUntil),
    sig: p.sig,
    brand: p.brand,
    power: cardPower(p.build),
    build: buildRecord(p.build),
    mobStats: mobStatsRecord(p.mobStats),
    asMult: decodeMult(p.asMult),
    windupMult: p.windupMult === undefined ? 1 : decodeMult(p.windupMult),
    speedMult: decodeMult(p.speedMult),
    kills: p.kills,
    mobKills: p.mobKills,
    gv: p.gv,
    bounty: p.bounty,
    moveSeq: p.moveSeq,
  };
}

/** The bot is not in the state (not joined yet, or gone): a placeholder that sees nothing of its own. */
function absentSelf(id: FighterId): SelfView {
  return {
    id, name: "", x: 0, y: 0, facing: 0, status: "mia", hp: 0, maxHp: 0, barrier: 0, faction: null, weapons: [null, null], slot: 0,
    attackTarget: null, drawStartedAt: 0, readyAt: 0, immuneUntil: 0, sig: 0, brand: 0,
    power: 0, asMult: 1, speedMult: 1, kills: 0, mobKills: 0, mobStats: {}, gv: 0, bounty: 0, moveSeq: 0,
  };
}

function fighterSeen(
  id: FighterId, p: PlayerLike, x: number, y: number, status: string, effects: number, t: number, marks: boolean,
): FighterSeen {
  const maxHp = f32(p.maxHp);
  const bar = hpBarFractions(f32(p.hp), maxHp, f32(p.barrier));
  // The teleport shield is drawn against render time (PlayerView): the frame's time less the render delay.
  const until = u32(p.immuneUntil);
  const left = until - (t - WORLD_RENDER_DELAY_MS);
  return {
    id,
    name: p.name,
    bot: p.bot,
    x,
    y,
    facing: f32(p.facing),
    status,
    hpFrac: barShare(bar.hp),
    barrierFrac: barShare(bar.barrier),
    faction: factionOf(p.faction),
    inHand: inHandOf(p),
    drawStartedAt: u32(p.drawStartedAt),
    bounty: p.bounty,
    immune: until > 0 && left > 0 && left <= TELEPORT_IMMUNITY_MS,
    sig: marks ? p.sig : 0,
    brand: marks ? p.brand : 0,
    targetable: (effects & EFFECT_UNTARGETABLE) === 0,
  };
}

function mobSeen(id: FighterId, m: MobLike, x: number, y: number, status: string, kind: string, faction: string, marks: boolean): MobSeen {
  return {
    id,
    kind,
    name: m.name,
    type: typeof m.type === "string" && m.type.length > 0 ? m.type : undefined,
    faction: factionOf(faction),
    x,
    y,
    facing: f32(m.facing),
    status,
    hpFrac: barShare(hpBarFractions(f32(m.hp), f32(m.maxHp), 0).hp),
    inHand: inHandOf(m),
    drawStartedAt: u32(m.drawStartedAt),
    sig: marks ? m.sig : 0,
    brand: marks ? m.brand : 0,
  };
}

/** The first item's weapon (what a pickup takes), read only for a container that shows it. */
function firstWeapon(c: ContainerLike): WeaponId | null {
  const items = c.items;
  return items.length > 0 ? weaponOf(items.at(0)?.def ?? "") : null;
}

/** What one frame's fx decoding needs: who is drawn in the frame's box (players and mobs not hidden), and where. */
interface Seen {
  readonly selfId: FighterId;
  readonly self: Vec2;
  readonly state: StateLike;
  readonly shown: ReadonlyMap<FighterId, Vec2>;
  readonly near: (x: number, y: number) => boolean;
  readonly canSee?: (point: Vec2) => boolean;
}

const KNOWN_FX: ReadonlySet<string> = new Set([
  "windup", "swing", "hit", "block", "stagger", "cancel", "projEnd", "death", "heal", "teleport", "bounty", "victory",
]);

/** A fighter the bot can see in this frame (itself, or drawn in the box), and where. */
function seenAt(s: Seen, id: string | null | undefined): Vec2 | null {
  if (id == null) return null;
  if (id === s.selfId) return s.self;
  return s.shown.get(id) ?? null;
}

const visibleId = (s: Seen, id: string | null | undefined): FighterId | null => (seenAt(s, id) ? (id as string) : null);

/**
 * One decoded fx as the bot observes it (docs/BOTS.md 3.4), or null when it cannot. This applies the frame's box;
 * frames.ts applies the exact window at render time and masks names again against what is drawn then. projEnd is
 * always kept (its stop point caps the flight the ring flies, as the client's noteEnd does) and windowed there.
 */
function observe(fx: TimedFx, s: Seen): ObservedEvent | null {
  const t = fx.t;
  switch (fx.kind) {
    case "windup": {
      const at = seenAt(s, fx.by);
      return at ? { kind: "windup", t, at, by: fx.by, weapon: fx.weapon, a: fx.a, ms: fx.ms } : null;
    }
    case "swing": {
      const at = seenAt(s, fx.by);
      return at ? { kind: "swing", t, at, by: fx.by, weapon: fx.weapon, a: fx.a } : null;
    }
    case "hit": {
      const at = seenAt(s, fx.id);
      if (!at) return null;
      // The number drawn: whole points (a blow is at least 1).
      const amount = !isDot(fx.sig) && fx.amount > 0 ? Math.max(1, Math.round(fx.amount)) : Math.round(fx.amount);
      return { kind: "hit", t, at, id: fx.id, by: visibleId(s, fx.by), amount, weapon: fx.weapon, sig: fx.sig ?? null };
    }
    case "block": {
      const at = seenAt(s, fx.id);
      return at ? { kind: "block", t, at, id: fx.id, by: visibleId(s, fx.by), weapon: fx.weapon } : null;
    }
    case "stagger":
    case "cancel": {
      const at = seenAt(s, fx.id);
      return at ? { kind: fx.kind, t, at, id: fx.id } : null;
    }
    case "projEnd":
      return { kind: "projEnd", t, at: { x: fx.x, y: fx.y }, id: fx.id, proj: fx.proj, reason: fx.reason };
    case "death": {
      const player = s.state.players.get(fx.id);
      const mob = player ? undefined : s.state.mobs.get(fx.id);
      const near = s.near(fx.x, fx.y);
      const kind = mob ? mob.kind : "";
      if (kind === "mob") {
        // A regional mob's death is a burst where it fell, no line.
        return near ? { kind: "death", t, at: { x: fx.x, y: fx.y }, id: fx.id, name: mob!.name, by: visibleId(s, fx.by), mob: true } : null;
      }
      if (kind === "elite") {
        // FxView announces it to everyone, killer named: "<elite> was slain by <killer>".
        return { kind: "death", t, at: near ? { x: fx.x, y: fx.y } : null, id: fx.id, name: mob!.name, by: fx.by, mob: true };
      }
      // A player (or a dummy): "<name> was killed", for everyone; where and by whom only on screen. Unnamed (it has left) and
      // off screen: nothing shows.
      const name = player ? player.name : mob ? mob.name : "";
      if (!player && !mob && !near) return null;
      return {
        kind: "death", t, at: near ? { x: fx.x, y: fx.y } : null, id: fx.id, name, by: near ? visibleId(s, fx.by) : null,
        mob: mob !== undefined,
      };
    }
    case "heal": {
      const at = seenAt(s, fx.id);
      if (!at || !(fx.amount >= MIN_HEAL_SHOWN)) return null;
      return { kind: "heal", t, at, id: fx.id, amount: Math.round(fx.amount) };
    }
    case "teleport":
      return { kind: "teleport", t, at: null };
    case "bounty": {
      const name = s.state.players.get(fx.id)?.name || fx.name;
      return { kind: "bounty", t, at: null, id: fx.id, name, bounty: Math.round(fx.bounty) };
    }
    case "victory":
      return { kind: "victory", t, at: null, id: fx.id, name: fx.name, draw: fx.draw };
    default:
      return observeExt(fx as unknown as Readonly<Record<string, unknown>>, s, t);
  }
}

/** An fx kind this brain does not name (Wishes' cast, castLand, castEnd, status): its subject's rule, names masked. */
function observeExt(fx: Readonly<Record<string, unknown>>, s: Seen, t: number): ObservedEvent | null {
  const kind = typeof fx["kind"] === "string" ? fx["kind"] : "";
  if (kind === "" || KNOWN_FX.has(kind)) return null;
  const fighter = (v: unknown): v is string =>
    typeof v === "string" && (v === s.selfId || s.state.players.get(v) !== undefined || s.state.mobs.get(v) !== undefined);
  // Its subject is the fighter it names (`by`, else `id`); one about something else (an area) shows at its own point.
  const subject = fighter(fx["by"]) ? fx["by"] : fighter(fx["id"]) ? fx["id"] : null;
  let at: Vec2 | null;
  if (subject !== null) at = seenAt(s, subject);
  else {
    const x = fx["x"], y = fx["y"];
    at = typeof x === "number" && typeof y === "number" && s.near(x, y) ? { x, y } : null;
  }
  if (!at) return null;
  const data: Record<string, unknown> = {};
  for (const k of Object.keys(fx)) {
    if (k === "kind" || k === "t") continue;
    const v = fx[k];
    if (typeof v === "string" && (s.state.players.get(v) !== undefined || s.state.mobs.get(v) !== undefined)) {
      data[k] = seenAt(s, v) ? v : null;
    } else {
      const copy = plainCopy(v);
      if (copy !== undefined) data[k] = copy;
    }
  }
  return { kind: "ext", t, at, fx: kind, data };
}

/** A projectile no launch announced (loosed and stopped in one step): the client flies it from the projEnd's own start. */
function shortFlight(fx: Extract<TimedFx, { kind: "projEnd" }>): ProjectileView | null {
  const len = Math.hypot(fx.x - fx.x0, fx.y - fx.y0);
  if (len < MIN_FLIGHT) return null;
  const shape = WEAPONS[fx.proj === "ball" ? "wand" : "bow"].shape;
  const speed = shape.kind === "projectile" ? shape.speed : 0;
  const range = shape.kind === "projectile" ? shape.range : 0;
  return {
    id: fx.id, kind: fx.proj, x: fx.x0, y: fx.y0, vx: ((fx.x - fx.x0) / len) * speed, vy: ((fx.y - fx.y0) / len) * speed,
    x0: fx.x0, y0: fx.y0, t0: fx.t0, range, from: null,
  };
}

const byId = (a: { readonly id: string }, b: { readonly id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function fieldName(table: string, v: number | string): string {
  if (typeof v === "string") return v;
  const list = sharedExport(table);
  return Array.isArray(list) && typeof list[v] === "string" ? (list[v] as string) : String(v);
}

/**
 * The state plus what arrived since the last frame -> one Frame. Pure: the only memory it gets is ctx.lastMinimap (the
 * minimap repaints at 10 Hz). Reads, per fighter off the box: a player's x, y, status (and name for an announcement); a
 * mob's x, y, status, kind, faction (the minimap). Never `tick`, and never a container's items off the box.
 */
export const perceive: Perceive<PerceptionInput> = (input, ctx) => {
  const state = input.state;
  const t = state.serverTime;
  const selfId = ctx.selfId;
  const statusBits = ctx.features.statusEffects;
  const phase = state.phase;
  const marks = phase === "active";
  const gatesLocked = state.gatesLocked;
  const players = state.players;
  const mobs = state.mobs;

  const me = players.get(selfId);
  const self = me ? selfView(selfId, me) : absentSelf(selfId);
  const sx = self.x, sy = self.y;
  const canSee = ctx.canSee ?? (() => true);
  const near = (x: number, y: number): boolean => inView(sx, sy, x, y, FRAME_MARGIN) && canSee({ x, y });
  const effects: Record<FighterId, number> | null = statusBits ? {} : null;
  if (effects && me) effects[selfId] = me.effects ?? 0;

  const shown = new Map<FighterId, Vec2>();
  let alive = 0;
  const fighters: FighterSeen[] = [];
  for (const [id, p] of players) {
    const status = p.status;
    if (status === "alive") alive++;
    if (id === selfId) continue;
    const x = f32(p.x), y = f32(p.y);
    if (!near(x, y)) continue;
    const bits = statusBits ? (p.effects ?? 0) : 0;
    // A hidden fighter (a Swarm) is drawn for no one else: not in the frame, in no fx, credited with nothing.
    if ((bits & EFFECT_HIDDEN) !== 0) continue;
    fighters.push(fighterSeen(id, p, x, y, status, bits, t, marks));
    shown.set(id, { x, y });
    if (effects) effects[id] = bits;
  }
  fighters.sort(byId);

  const last = ctx.lastMinimap;
  const repaint = last === null || !(t - last.t < MINIMAP_REFRESH_MS) || last.t > t;
  const dots: MinimapMob[] = [];
  const mobList: MobSeen[] = [];
  for (const [id, m] of mobs) {
    const x = f32(m.x), y = f32(m.y);
    if (!canSee({ x, y })) continue;
    // Visibility was checked for the map-wide minimap dot above; only the box remains to check here.
    const inBox = inView(sx, sy, x, y, FRAME_MARGIN);
    if (!repaint && !inBox) continue;
    const status = m.status, kind = m.kind, faction = m.faction;
    if (repaint && status === "alive" && (kind === "mob" || kind === "elite")) {
      dots.push({ id, x: quantMinimap(x), y: quantMinimap(y), faction: factionOf(faction), elite: kind === "elite" });
    }
    if (!inBox) continue;
    mobList.push(mobSeen(id, m, x, y, status, kind, faction, marks));
    shown.set(id, { x, y });
    if (effects) effects[id] = m.effects ?? 0;
  }
  mobList.sort(byId);
  dots.sort(byId);
  const minimap: MinimapView = last !== null && !repaint ? (ctx.canSee ? { ...last, mobs: last.mobs.filter(canSee) } : last) : { t, mobs: dots, gatesLocked };

  const containers = seeContainers(state, ctx.map, self, near);

  const hud: HudView = {
    phase,
    training: state.training === true,
    lobbyEndsAt: state.lobbyEndsAt,
    raidStartedAt: state.raidStartedAt,
    patienceEndsAt: state.patienceEndsAt,
    suddenDeathAt: state.suddenDeathAt,
    inColiseum: state.inColiseum,
    gatesLocked,
    startedWith: state.startedWith,
    alive,
    playerCount: players.size,
    minPlayers: state.minPlayers,
    winner: state.winner,
  };

  const seen: Seen = { selfId, self: { x: sx, y: sy }, state, shown, near, canSee: ctx.canSee };
  const events: ObservedEvent[] = [];
  const projectiles: ProjectileView[] = [];
  for (const batch of input.fxs ?? []) {
    for (const l of unpackLaunches(batch)) {
      projectiles.push({
        id: l.id, kind: l.kind, x: l.x, y: l.y, vx: l.vx, vy: l.vy, x0: l.x, y0: l.y, t0: l.t, range: l.range, from: null,
      });
    }
    for (const fx of unpackFx(batch, state.roster)) {
      if (fx.kind === "projEnd") {
        const flight = shortFlight(fx);
        if (flight) projectiles.push(flight);
      }
      const ev = observe(fx, seen);
      if (ev) events.push(ev);
    }
  }

  const immediate: ObservedEvent[] = [];
  for (const text of input.toasts ?? []) immediate.push({ kind: "toast", t, at: null, text });
  if (input.result) immediate.push({ kind: "result", t, at: null, result: plainCopy(input.result) as RunResult });
  for (const pm of input.privates ?? []) {
    if (ctx.canSee && pm.type === "vision") continue;
    const msg = plainCopy(pm.msg);
    immediate.push({
      kind: "private", t, at: null, type: pm.type,
      msg: msg !== null && typeof msg === "object" && !Array.isArray(msg) ? (msg as Record<string, unknown>) : { value: msg ?? null },
    });
  }

  const extras: { -readonly [K in keyof PerceptExtras]: PerceptExtras[K] } = {};
  if (effects) extras.effects = effects;
  const wish = ctx.features.wishes && me ? wishView(me) : null;
  if (wish) extras.wish = wish;
  if (ctx.features.fields && state.fields) extras.fields = seeFields(state.fields, seen, sx, sy);
  if (ctx.features.chests) extras.chests = seeChests(state, ctx.map, self, selfId, canSee);
  if (ctx.features.camps && state.camps) extras.camps = seeCamps(state.camps, ctx.map, ctx.canSee !== undefined, selfId);

  return { t, self, hud, fighters, mobs: mobList, containers, projectiles, minimap, events, immediate, extras };
};

/** The Wish slot as the weapon bar's cooldown widget shows it: the faction's Wish, when it is ready, whether a cast is under way. */
function wishView(me: PlayerLike): WishView | null {
  const slot = abilityInSlot(me, "wish");
  if (!slot) return null;
  return {
    ability: slot.def.id, def: slot.def, rank: slot.rank, readyAt: u32(me.wishReadyAt ?? 0),
    casting: ((me.effects ?? 0) & EFFECT_CASTING) !== 0,
  };
}

/**
 * Containers in the box, as ContainerView draws them: a chest shut or open, a loose weapon's icon, a body and its label. A
 * chest's or a body's weapon shows only for the interaction target: the nearest container with a weapon within
 * INTERACT_RANGE and a line that nothing solid crosses, LOW included (the movement mask, as the server's pickup and the client's
 * `canInteract` read it: a hand does not go through a fence) from the bot's latest position (the highlight, the weapon bar's hint,
 * what F takes).
 */
function seeContainers(state: StateLike, map: GameMap, self: SelfView, near: (x: number, y: number) => boolean): ContainerSeen[] {
  const sight = state.gatesLocked ? withGates(map) : map;
  const canAct = self.status === "alive";
  const boxed: Array<{ id: string; c: ContainerLike; x: number; y: number; kind: string; reach: boolean }> = [];
  let target: string | null = null;
  let targetWeapon: WeaponId | null = null;
  let bestSq = Infinity;
  for (const [id, c] of state.containers) {
    const x = f32(c.x), y = f32(c.y);
    if (!near(x, y)) continue;
    const kind = c.kind;
    const reach = canAct && Math.hypot(self.x - x, self.y - y) <= INTERACT_RANGE && hasLineOfSight(sight, self, { x, y }, MASK_MOVE);
    boxed.push({ id, c, x, y, kind, reach });
    if (!reach) continue;
    const w = firstWeapon(c);
    const sq = (x - self.x) ** 2 + (y - self.y) ** 2;
    if (w !== null && sq < bestSq) {
      target = id;
      targetWeapon = w;
      bestSq = sq;
    }
  }
  const out: ContainerSeen[] = [];
  for (const b of boxed) {
    const isTarget = b.id === target;
    let closed: boolean;
    let weapon: WeaponId | null | undefined;
    if (isTarget) {
      closed = true;
      weapon = targetWeapon;
    } else if (b.kind === "ground") {
      weapon = firstWeapon(b.c);
      closed = weapon !== null;
    } else if (b.kind === "body") {
      // A body looks the same full or empty: it reads empty only when standing at it lights nothing up.
      const empty = b.reach && target === null;
      closed = !empty;
      weapon = empty ? null : undefined;
    } else {
      // A chest (or a newer kind) is drawn shut while it holds a weapon.
      closed = firstWeapon(b.c) !== null;
      weapon = closed ? undefined : null;
    }
    out.push({
      id: b.id, kind: b.kind, x: b.x, y: b.y, label: b.kind === "body" ? b.c.label : "", closed, weapon, interactable: isTarget,
    });
  }
  out.sort(byId);
  return out;
}

/** Whether a list holds `v`. */
function listHas(list: ListLike<string> | undefined, v: string): boolean {
  for (let i = 0; list && i < list.length; i++) if (list.at(i) === v) return true;
  return false;
}

/**
 * The reward chests as the client shows them (ui/minimap.ts, ui/chestPanel.ts). Every chest that is up is a gold blip on the
 * minimap with its seconds left, wherever it stands, so its place and expiry are known map-wide. Its cards, and which are taken,
 * show only while the panel is open: within CHEST_RANGE less CHEST_PANEL_SLACK of the bot's latest server position and in sight
 * (ui/chestMath.ts `pickReward`). Another player's pick is "?" here, whoever made it: the bot needs only to know it is gone.
 */
function seeChests(state: StateLike, map: GameMap, self: SelfView, selfId: FighterId, canSee: (point: Vec2) => boolean): RewardChestView[] {
  const sight = state.gatesLocked ? withGates(map) : map;
  const out: RewardChestView[] = [];
  for (const [id, c] of state.containers) {
    if (c.kind !== "reward") continue;
    const x = f32(c.x), y = f32(c.y);
    if (!canSee({ x, y })) continue;
    const open = self.status === "alive" && Math.hypot(self.x - x, self.y - y) <= CHEST_RANGE - CHEST_PANEL_SLACK && hasLineOfSight(sight, self, { x, y });
    const options: string[] | null = open ? Array.from({ length: c.options?.length ?? 0 }, (_, i) => c.options!.at(i) ?? "") : null;
    const takenBy = options === null ? [] : options.map((_, i) => { const by = c.takenBy?.at(i) ?? ""; return by === "" || by === selfId ? by : "?"; });
    out.push({ id, x, y, expiresAt: u32(c.expiresAt ?? 0), options, takenBy, picked: listHas(c.pickers, selfId) });
  }
  out.sort(byId);
  return out;
}

/** RaidState.camps as the minimap and the planning screen mark them: what each camp is, how many of it live, and its state. */
function seeCamps(camps: ArrayLike<CampLike>, map: GameMap, vision: boolean, selfId: string): CampView[] {
  const out: CampView[] = [];
  for (let i = 0; i < camps.length; i++) {
    const c = camps[i];
    if (c) out.push({
      ...(!vision || c.clearedAt === undefined ? {} : { clearedAt: c.clearedAt, respawnAt: c.respawnAt, wardOwner: c.wardOwner === selfId ? selfId : c.wardOwner ? "?" : "", wardExpiresAt: c.wardExpiresAt }),
      index: i, id: map.camps[i]?.id ?? `camp${i}`, type: c.type, reward: c.reward, alive: c.alive, state: c.state === 1 || c.state === 2 ? c.state : 0 });
  }
  return out;
}

/** Wishes areas in the box; the caster is named only when it is drawn. */
function seeFields(fields: KeyedLike<FieldLike>, s: Seen, sx: number, sy: number): FieldView[] {
  const out: FieldView[] = [];
  for (const [id, f] of fields) {
    if (s.canSee && (!s.canSee(f) || (fieldName("FIELD_KINDS", f.kind) === "trail" && !s.canSee({ x: f.x2, y: f.y2 })))) continue;
    const view: FieldView = {
      id, kind: fieldName("FIELD_KINDS", f.kind), ability: fieldName("ABILITY_IDS", f.ability), x: f32(f.x), y: f32(f.y),
      x2: f32(f.x2), y2: f32(f.y2), r: f32(f.r), owner: f.owner === "" ? null : visibleId(s, f.owner), endsAt: u32(f.endsAt),
    };
    if (fieldInView(sx, sy, view, FRAME_MARGIN)) out.push(view);
  }
  out.sort(byId);
  return out;
}
