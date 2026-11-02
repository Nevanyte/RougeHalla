// The telemetry recorder (docs/TELEMETRY.md sections 2-4): counters on existing hooks, one per-tick system, and the record's
// draft assembled once at the run's end. It never changes an outcome: listeners read state and write the recorder's own typed
// arrays, and it calls no RNG, nextId, payLater, emit, heal, addStatus, recomputeMods or path search, and reads no map props.
// Installed AFTER createGameWorld (installTelemetry), so a world without it has exactly today's hook chains and systems, and its
// listeners run last in every chain and its system after every other system of the tick.
//
// Allocation: the steady tick allocates nothing. Opening a duel segment, closing one, a death, an offer, a pick, a camp clear, a
// power snapshot minute and the final record allocate (each bounded by its cap).
import {
  ALL_WEAPON_IDS, cardDef, cardPower, comebackOf, classifyDuelEnd, DAMAGE_SOURCES, decodeMirrors, DUEL_GAP_MS, FARM_CONTACT_MS,
  HEAL_SOURCES, KILL_CREDIT_SECONDS, MAX_PLAYERS, packTiles, REGION_IDS, regionAt, SUDDEN_DEATH_KILLER, TELEMETRY_MAX_CAMP_CLEARS,
  TELEMETRY_MAX_DUEL_CARDS, TELEMETRY_MAX_DUELS, TELEMETRY_MAX_OFFERS, TELEMETRY_MAX_SAMPLES, TELEMETRY_SAMPLE_MS,
  TELEMETRY_SCHEMA_VERSION, TELEMETRY_SNAPSHOT_MINUTES, TERRAINS, terrainAt, THIRD_ARENA, THIRD_MOB, THIRD_PLAYER, TICK_MS,
  TILE_ABSENT, worldToTile,
  type AbilityId, type BuildSnapshot, type CampClearRecord, type DamageBySource, type DamageSource, type DeathCause,
  type DuelEndFacts, type DuelRecord, type DuelSide, type FactionId, type FirstStriker, type GvSource, type HealBySource,
  type HealSource, type OfferKind, type OfferRecord, type PlayerOutcome, type PlayerRecord, type PowerSnapshot, type RegionId,
  type RunEnd, type RunRecord, type RunResult, type WeaponId,
} from "@raid/shared";
import type { ContainerState, PlayerState } from "@raid/shared/schema";
import { activeWeapon, creditedPlayerId, type Combatant } from "./combatant";
import { chainHook, type StatusInstance, type DamagePacket, type DamageSource as LedgerSource, type LedgerEntry, type OverkillHit, type PlayerRuntime, type SimEvent, type World } from "./world";

const N = MAX_PLAYERS;
const NSRC = DAMAGE_SOURCES.length;
const NHEAL = HEAL_SOURCES.length;
const NW = ALL_WEAPON_IDS.length;
const NZ = REGION_IDS.length;
const NSNAP = TELEMETRY_SNAPSHOT_MINUTES.length;
const PAIRS = (N * (N - 1)) / 2;
const GV_KEYS = ["kills", "mobs", "bounty", "quest", "win", "skip"] as const satisfies readonly GvSource[];
const NGV = GV_KEYS.length;

const SRC = Object.fromEntries(DAMAGE_SOURCES.map((s, i) => [s, i])) as Record<DamageSource, number>;
const HEAL = Object.fromEntries(HEAL_SOURCES.map((s, i) => [s, i])) as Record<HealSource, number>;
const WIDX = new Map<string, number>(ALL_WEAPON_IDS.map((w, i) => [w, i]));
const ZIDX = new Map<string, number>(REGION_IDS.map((z, i) => [z, i]));
const GV_OF: Record<string, number> = { kill: 0, mob: 1, elite: 1, bounty: 2, quest: 3, skip: 5 };
const WISH_CASTS = 0, WISH_LANDED = 1, WISH_FIZZLED = 2, WISH_INTERRUPTED = 3, WISH_CANCELLED = 4;
const NWISH = 5;

/** Slot pair (a < b) -> its index in the 28-entry pair table. */
function pairIndex(a: number, b: number): number {
  return (a * (2 * N - a - 1)) / 2 + (b - a - 1);
}
const PAIR_A = new Uint8Array(PAIRS);
const PAIR_B = new Uint8Array(PAIRS);
for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) { PAIR_A[pairIndex(a, b)] = a; PAIR_B[pairIndex(a, b)] = b; }

/** The recorder's per-run memory. Everything indexed by slot is `slot * K + index` in a preallocated typed array. */
export interface TelemetryRecorder {
  readonly world: World;
  readonly positions: boolean;
  started: boolean;
  /** serverTime at raidStarted (run time 0). */
  startAt: number;
  /** serverTime when the run ended (runEnded), or -1. */
  endAt: number;
  n: number;
  slotOf: Map<string, number>;
  ids: string[];
  profiles: string[];
  bots: boolean[];
  factions: FactionId[];
  spawns: PlayerRecord["spawn"][];
  dealtP: Float64Array;
  dealtM: Float64Array;
  taken: Float64Array;
  healed: Float64Array;
  overkill: Float64Array;
  gv: Float64Array;
  weaponMs: Float64Array;
  zoneMs: Float64Array;
  farmMs: Float64Array;
  lastMobContact: Float64Array;
  tiles: Uint8Array[];
  sampleCount: number;
  samplesDropped: number;
  snapTaken: Uint8Array;
  snapshots: PowerSnapshot[][];
  mobKills: Map<string, number>[];
  eliteKills: Int32Array;
  campsCleared: Int32Array;
  wish: Int32Array;
  wishHits: Int32Array;
  wishDmg: Float64Array;
  potSmall: Int32Array;
  potLarge: Int32Array;
  potGranted: Int32Array;
  questsAccepted: string[][];
  questsCompleted: string[][];
  /** 0 in the run, 1 down, 2 removed. */
  out: Uint8Array;
  outAt: Float64Array;
  finals: (BuildSnapshot | null)[];
  botKills: Int32Array;
  deaths: (DeathCause | null)[];
  results: (RunResult | null)[];
  planningMia: number;
  // The killing-pass scratch per victim slot (docs/TELEMETRY.md 3.5), reset after the system reads it.
  kDirty: number;
  kPAmt: Float64Array;
  kPEntry: (LedgerEntry | null)[];
  kMAmt: Float64Array;
  kMEntry: (LedgerEntry | null)[];
  kSD: Float64Array;
  kTerr: Float64Array;
  /** Slots that went down (died) this tick: bit per slot. */
  downMask: number;
  // Duel segments (section 4), one per unordered slot pair.
  pOpen: Uint8Array;
  openCount: number;
  pWrite: Uint8Array;
  pStart: Float64Array;
  pLast: Float64Array;
  pOpenTick: Float64Array;
  pFirstBits: Uint8Array;
  pFirstDmg: Float64Array;
  pThird: Uint8Array;
  pDmg: Float64Array;
  pHpEnd: Float64Array;
  pWishes: Int32Array;
  pWeapons: Uint16Array;
  pSides: (DuelSide[] | null)[];
  pZone: RegionId[];
  pColiseum: Uint8Array;
  duels: DuelRecord[];
  duelsWritten: number;
  duelsDropped: number;
  offers: OfferRecord[];
  offerOf: Map<string, number>;
  offersDropped: number;
  camps: CampClearRecord[];
  campsDropped: number;
  campEngaged: Float64Array;
  campContrib: Uint8Array;
  campDeaths: Int32Array;
  campCycle: Int32Array;
  teleports: number[];
  suddenDeath: number[];
  sdNoted: boolean;
  firstBlood: RunRecord["firstBlood"];
}

/** What telemetryDraft returns: the record minus the Room's own fields (identity, wall clock, network, client, AFK). */
export interface PlayerDraft extends Omit<PlayerRecord, "pid" | "tier" | "persona" | "net" | "client" | "afkMs" | "afk"> {
  /** The session id (Room-side lookups) and the callsign (the pid's input). Both are dropped before the record is sent. */
  id: string;
  profile: string;
}
export interface RunDraft extends Omit<RunRecord, "runId" | "source" | "build" | "startedAtEpoch" | "endedAtEpoch" | "players" | "config"> {
  players: PlayerDraft[];
  config: Omit<RunRecord["config"], "botsFillTo">;
}

const filled = (n: number, v: number): Float64Array => new Float64Array(n).fill(v);

function newRecorder(world: World, positions: boolean): TelemetryRecorder {
  const nc = world.map.camps.length;
  return {
    world, positions, started: false, startAt: 0, endAt: -1, n: 0,
    slotOf: new Map(), ids: [], profiles: [], bots: [], factions: [], spawns: [],
    dealtP: new Float64Array(N * NSRC), dealtM: new Float64Array(N * NSRC), taken: new Float64Array(N * NSRC),
    healed: new Float64Array(N * NHEAL), overkill: new Float64Array(N), gv: new Float64Array(N * NGV),
    weaponMs: new Float64Array(N * NW), zoneMs: new Float64Array(N * NZ), farmMs: new Float64Array(N), lastMobContact: filled(N, -Infinity),
    tiles: [], sampleCount: 0, samplesDropped: 0,
    snapTaken: new Uint8Array(N * NSNAP), snapshots: [],
    mobKills: [], eliteKills: new Int32Array(N), campsCleared: new Int32Array(N),
    wish: new Int32Array(N * NWISH), wishHits: new Int32Array(N), wishDmg: new Float64Array(N),
    potSmall: new Int32Array(N), potLarge: new Int32Array(N), potGranted: new Int32Array(N),
    questsAccepted: [], questsCompleted: [],
    out: new Uint8Array(N), outAt: new Float64Array(N), finals: [], botKills: new Int32Array(N), deaths: [], results: [], planningMia: 0,
    kDirty: 0, kPAmt: new Float64Array(N), kPEntry: new Array(N).fill(null), kMAmt: new Float64Array(N), kMEntry: new Array(N).fill(null),
    kSD: new Float64Array(N), kTerr: new Float64Array(N), downMask: 0,
    pOpen: new Uint8Array(PAIRS), openCount: 0, pWrite: new Uint8Array(PAIRS), pStart: new Float64Array(PAIRS), pLast: new Float64Array(PAIRS),
    pOpenTick: new Float64Array(PAIRS), pFirstBits: new Uint8Array(PAIRS), pFirstDmg: new Float64Array(PAIRS * 2), pThird: new Uint8Array(PAIRS),
    pDmg: new Float64Array(PAIRS * 2 * NSRC), pHpEnd: new Float64Array(PAIRS * 2), pWishes: new Int32Array(PAIRS * 2), pWeapons: new Uint16Array(PAIRS * 2),
    pSides: new Array(PAIRS).fill(null), pZone: new Array(PAIRS).fill("none"), pColiseum: new Uint8Array(PAIRS),
    duels: [], duelsWritten: 0, duelsDropped: 0,
    offers: [], offerOf: new Map(), offersDropped: 0,
    camps: [], campsDropped: 0, campEngaged: filled(nc, -1), campContrib: new Uint8Array(nc), campDeaths: new Int32Array(nc), campCycle: new Int32Array(nc),
    teleports: [], suddenDeath: [], sdNoted: false, firstBlood: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Small readers (no allocation)

const runMs = (rec: TelemetryRecorder): number => Math.round(rec.world.state.serverTime - rec.startAt);

function playerOf(rec: TelemetryRecorder, slot: number): { p: PlayerState; rt: PlayerRuntime } | null {
  const id = rec.ids[slot]!;
  const p = rec.world.state.players.get(id);
  const rt = rec.world.players.get(id);
  return p && rt ? { p, rt } : null;
}

function standingSlot(rec: TelemetryRecorder, slot: number): boolean {
  const id = rec.ids[slot]!;
  const p = rec.world.state.players.get(id);
  const rt = rec.world.players.get(id);
  return !!p && !!rt && p.status === "alive" && !rt.down && !rt.resolved;
}

/** A slot's hp fraction now (0 once it has left the state); no allocation. */
function slotHpFrac(rec: TelemetryRecorder, slot: number): number {
  const p = rec.world.state.players.get(rec.ids[slot]!);
  return p ? hpFrac(p) : 0;
}

function hpFrac(p: PlayerState): number {
  return p.maxHp > 0 ? Math.max(0, (p.hp + p.barrier) / p.maxHp) : 0;
}

/** The player slot an entry is credited to (a zombie's hit is its owner's), or -1. */
function creditSlot(rec: TelemetryRecorder, by: LedgerSource): number {
  const id = by.ownerId ?? creditedPlayerId(rec.world, by.id);
  return rec.slotOf.get(id) ?? -1;
}

function isZombieHit(rec: TelemetryRecorder, by: LedgerSource): boolean {
  return by.ownerId !== undefined || rec.world.state.mobs.get(by.id)?.kind === "zombie";
}

function isRegionalMob(rec: TelemetryRecorder, id: string): boolean {
  return rec.world.mobs.get(id)?.brain !== undefined;
}

/** docs/TELEMETRY.md 3.4, in its order (the arena's entries reach arenaHurt, never here). */
function sourceOf(rec: TelemetryRecorder, e: LedgerEntry): number {
  if (e.ability !== undefined) return SRC.wish;
  if (isZombieHit(rec, e.by)) return SRC.zombie;
  if (isRegionalMob(rec, e.by.id)) return SRC.mob;
  if (e.sig !== undefined) return SRC.signature;
  if (e.derived) return SRC.splash;
  if (e.passive) return SRC.returned;
  if (e.dot) return SRC.card;
  return SRC.weapon;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

function bySource(arr: Float64Array, base: number): DamageBySource {
  const out: DamageBySource = {};
  for (let i = 0; i < NSRC; i++) {
    const v = arr[base + i]!;
    if (v > 0) out[DAMAGE_SOURCES[i]!] = r1(v);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Snapshots

function sumMap(m: { forEach(cb: (v: number) => void): void } | undefined): number {
  let t = 0;
  m?.forEach((v) => { t += v; });
  return t;
}

function toRecord(m: { forEach(cb: (v: number, k: string) => void): void } | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  m?.forEach((v, k) => { if (v !== 0) out[k] = v; });
  return out;
}

function statsOf(p: PlayerState): { maxHp: number; ad: number; ap: number; armor: number; shield: number; asMult: number; speedMult: number } {
  const m = decodeMirrors(p);
  return { maxHp: r1(p.maxHp), ad: r1(m.adBonus), ap: r1(m.apBonus), armor: r1(m.armorBonus), shield: r1(m.shieldBonus), asMult: m.asMult, speedMult: m.speedMult };
}

function buildSnapshot(p: PlayerState): BuildSnapshot {
  return {
    ...statsOf(p),
    cards: toRecord(p.build),
    cardPower: cardPower(p.build),
    boosts: toRecord(p.extra.chestBoosts),
    boostsTotal: sumMap(p.extra.chestBoosts),
    trophies: toRecord(p.extra.killStats),
    mobStats: toRecord(p.mobStats),
    mobStatsTotal: r1(sumMap(p.mobStats)),
  };
}

function takeFinal(rec: TelemetryRecorder, slot: number): void {
  const pr = playerOf(rec, slot);
  if (!pr) return;
  rec.finals[slot] = buildSnapshot(pr.p);
  rec.botKills[slot] = pr.rt.botKills ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Run start

function begin(rec: TelemetryRecorder): void {
  const w = rec.world;
  if (rec.started) return;
  rec.started = true;
  rec.startAt = w.state.serverTime;
  let slot = 0;
  for (const [id, p] of w.state.players) {
    const rt = w.players.get(id);
    if (!rt || slot >= N || p.status !== "alive") continue;
    rec.slotOf.set(id, slot);
    rec.ids.push(id);
    rec.profiles.push(rt.profile);
    rec.bots.push(rt.bot === true);
    rec.factions.push(p.faction as FactionId);
    const zone = regionAt(w.map, p.x, p.y);
    const deal = w.planning?.deals.get(id);
    rec.spawns.push({ zone, tx: worldToTile(p.x), ty: worldToTile(p.y), picked: deal !== undefined && deal.pick >= 0 });
    rec.tiles.push(rec.positions ? new Uint8Array(2 * TELEMETRY_MAX_SAMPLES).fill(TILE_ABSENT) : new Uint8Array(0));
    rec.snapshots.push([]);
    rec.mobKills.push(new Map());
    rec.questsAccepted.push([]);
    rec.questsCompleted.push([]);
    rec.finals.push(null);
    rec.deaths.push(null);
    rec.results.push(null);
    slot++;
  }
  rec.n = slot;
}

// ---------------------------------------------------------------------------------------------------------------------
// Duels

function sideOf(rec: TelemetryRecorder, slot: number): DuelSide {
  const pr = playerOf(rec, slot)!;
  const p = pr.p;
  const augments: string[] = [];
  p.build.forEach((count, id) => { if (count > 0 && cardDef(id)?.kind === "augment") augments.push(id); });
  augments.sort();
  if (augments.length > TELEMETRY_MAX_DUEL_CARDS) augments.length = TELEMETRY_MAX_DUEL_CARDS;
  const t = TERRAINS[terrainAt(rec.world.map, p.x, p.y)];
  return {
    slot, bot: rec.bots[slot]!, faction: rec.factions[slot]!, weapon: activeWeapon(p) ?? "fists", weaponsUsed: [], augments,
    cardPower: cardPower(p.build), mobStatsTotal: r1(sumMap(p.mobStats)), boostsTotal: sumMap(p.extra.chestBoosts),
    hp: Math.round(pr.rt.hpFracAtTickStart * 1000) / 1000, hpEnd: 0, dmg: {}, wishes: 0, terrain: t && t.key !== "none" ? t.key : "",
  };
}

function openPair(rec: TelemetryRecorder, k: number): void {
  const now = rec.world.state.serverTime;
  rec.pOpen[k] = 1;
  rec.openCount++;
  rec.pStart[k] = now;
  rec.pLast[k] = now;
  rec.pOpenTick[k] = rec.world.state.tick;
  rec.pFirstBits[k] = 0;
  rec.pFirstDmg[2 * k] = 0;
  rec.pFirstDmg[2 * k + 1] = 0;
  rec.pThird[k] = 0;
  rec.pDmg.fill(0, k * 2 * NSRC, (k + 1) * 2 * NSRC);
  rec.pWishes[2 * k] = 0;
  rec.pWishes[2 * k + 1] = 0;
  rec.pWeapons[2 * k] = 0;
  rec.pWeapons[2 * k + 1] = 0;
  const a = PAIR_A[k]!, b = PAIR_B[k]!;
  const pa = playerOf(rec, a), pb = playerOf(rec, b);
  rec.pHpEnd[2 * k] = pa ? hpFrac(pa.p) : 0;
  rec.pHpEnd[2 * k + 1] = pb ? hpFrac(pb.p) : 0;
  if (rec.duelsWritten < TELEMETRY_MAX_DUELS && pa && pb) {
    rec.duelsWritten++;
    rec.pWrite[k] = 1;
    rec.pSides[k] = [sideOf(rec, a), sideOf(rec, b)];
    rec.pZone[k] = regionAt(rec.world.map, (pa.p.x + pb.p.x) / 2, (pa.p.y + pb.p.y) / 2);
    rec.pColiseum[k] = rec.world.state.gatesLocked ? 1 : 0;
  } else {
    rec.pWrite[k] = 0;
    rec.pSides[k] = null;
    rec.duelsDropped++;
  }
}

/** A contact from slot `x` to slot `y` (docs/TELEMETRY.md 4.1): opens the pair if needed and adds `amount` to x's side. */
function contact(rec: TelemetryRecorder, x: number, y: number, src: number, amount: number, weapon: WeaponId | null): void {
  const a = x < y ? x : y, b = x < y ? y : x;
  const k = pairIndex(a, b);
  if (!rec.pOpen[k]) {
    // A shot that outlived its shooter, or a hit on someone already gone, opens nothing. A side down THIS tick still counts:
    // a one-shot kill opens and closes its segment in the same tick.
    if ((rec.out[x] !== 0 && !(rec.downMask & (1 << x))) || (rec.out[y] !== 0 && !(rec.downMask & (1 << y)))) return;
    openPair(rec, k);
  }
  const side = x === a ? 0 : 1;
  rec.pLast[k] = rec.world.state.serverTime;
  if (amount > 0) rec.pDmg[(2 * k + side) * NSRC + src] += amount;
  if (weapon !== null && src !== SRC.wish && src !== SRC.zombie) {
    const wi = WIDX.get(weapon);
    if (wi !== undefined) rec.pWeapons[2 * k + side] |= 1 << wi;
  }
  if (rec.pOpenTick[k] === rec.world.state.tick) {
    rec.pFirstBits[k] |= side === 0 ? 1 : 2;
    rec.pFirstDmg[2 * k + side] += amount;
  }
}

/** Marks every open segment of `victim` but the one with `except` (-1: none) as hurt by a third party. */
function markThird(rec: TelemetryRecorder, victim: number, except: number, bit: number): void {
  if (rec.openCount === 0) return;
  for (let o = 0; o < rec.n; o++) {
    if (o === victim || o === except) continue;
    const k = o < victim ? pairIndex(o, victim) : pairIndex(victim, o);
    if (rec.pOpen[k]) rec.pThird[k] |= bit;
  }
}

function firstOf(rec: TelemetryRecorder, k: number): FirstStriker {
  const bits = rec.pFirstBits[k]!;
  if (bits === 1) return 0;
  if (bits === 2) return 1;
  const da = rec.pFirstDmg[2 * k]!, db = rec.pFirstDmg[2 * k + 1]!;
  return da > db ? 0 : db > da ? 1 : 2;
}

function closePair(rec: TelemetryRecorder, k: number, f: DuelEndFacts, endAt: number): void {
  if (!rec.pOpen[k]) return;
  rec.pOpen[k] = 0;
  rec.openCount--;
  if (!rec.pWrite[k]) return;
  const sides = rec.pSides[k] as [DuelSide, DuelSide];
  rec.pSides[k] = null;
  const res = classifyDuelEnd(f) ?? { outcome: "runEnd" as const, winner: -1 as const };
  for (let s = 0; s < 2; s++) {
    const side = sides[s]!;
    side.dmg = bySource(rec.pDmg, (2 * k + s) * NSRC);
    side.wishes = rec.pWishes[2 * k + s]!;
    side.hpEnd = Math.round(rec.pHpEnd[2 * k + s]! * 1000) / 1000;
    const bits = rec.pWeapons[2 * k + s]!;
    for (let i = 0; i < NW; i++) if (bits & (1 << i)) side.weaponsUsed.push(ALL_WEAPON_IDS[i]!);
  }
  const third = rec.pThird[k]!;
  rec.duels.push({
    i: rec.duels.length,
    start: Math.round(rec.pStart[k]! - rec.startAt),
    end: Math.round(endAt - rec.startAt),
    sides,
    first: firstOf(rec, k),
    outcome: res.outcome,
    winner: res.winner,
    third,
    clean: (third & (THIRD_PLAYER | THIRD_MOB)) === 0,
    zone: rec.pZone[k]!,
    coliseum: rec.pColiseum[k] === 1,
    comeback: comebackOf(sides, res.winner),
  });
}

const NO_FACTS: DuelEndFacts = { downA: false, downB: false, quit: false, teleport: false, runEnd: false, gapExpired: false };

function closeSlotPairs(rec: TelemetryRecorder, slot: number, f: DuelEndFacts): void {
  if (rec.openCount === 0) return;
  const now = rec.world.state.serverTime;
  for (let o = 0; o < rec.n; o++) {
    if (o === slot) continue;
    const k = o < slot ? pairIndex(o, slot) : pairIndex(slot, o);
    if (rec.pOpen[k]) closePair(rec, k, f, now);
  }
}

function closeAll(rec: TelemetryRecorder, f: DuelEndFacts): void {
  if (rec.openCount === 0) return;
  const now = rec.world.state.serverTime;
  for (let k = 0; k < PAIRS; k++) if (rec.pOpen[k]) closePair(rec, k, f, now);
}

/** Who a downed side's death is credited to, relative to its pair partner (classifyDuelEnd's `credit`). */
function creditFor(rec: TelemetryRecorder, victim: number, partner: number): DuelEndFacts["creditA"] {
  const d = rec.deaths[victim];
  if (!d) return "third";
  if (d.kind === "player" || d.kind === "zombie") return d.bySlot === partner ? "pair" : "third";
  if (d.kind === "mob") return "mob";
  if (d.kind === "terrain" || d.kind === "suddenDeath") return "arena";
  return "third";
}

function duelTick(rec: TelemetryRecorder): void {
  const now = rec.world.state.serverTime;
  for (let k = 0; k < PAIRS; k++) {
    if (!rec.pOpen[k]) continue;
    const a = PAIR_A[k]!, b = PAIR_B[k]!;
    const downA = (rec.downMask & (1 << a)) !== 0;
    const downB = (rec.downMask & (1 << b)) !== 0;
    if (downA || downB || rec.pLast[k] === now) {
      rec.pHpEnd[2 * k] = slotHpFrac(rec, a);
      rec.pHpEnd[2 * k + 1] = slotHpFrac(rec, b);
    }
    if (downA || downB) {
      closePair(rec, k, {
        ...NO_FACTS, downA, downB,
        ...(downA ? { creditA: creditFor(rec, a, b) } : {}),
        ...(downB ? { creditB: creditFor(rec, b, a) } : {}),
      }, now);
    } else if (now - rec.pLast[k]! >= DUEL_GAP_MS) {
      closePair(rec, k, { ...NO_FACTS, gapExpired: true }, rec.pLast[k]!);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Damage (3.4)

function onHitLanded(rec: TelemetryRecorder, e: LedgerEntry, amount: number): void {
  if (!rec.started || !(amount > 0)) return;
  const w = rec.world;
  const vSlot = rec.slotOf.get(e.victim) ?? -1;
  const regionalVictim = vSlot < 0 && isRegionalMob(rec, e.victim);
  if (vSlot < 0 && !regionalVictim) return; // dummies, quest givers, zombies
  const src = sourceOf(rec, e);
  const aSlot = creditSlot(rec, e.by);
  const now = w.state.serverTime;
  if (regionalVictim) {
    // As the ledger counts it (landedShare): the hp a mob's hits removed, not the overkill.
    const L = w.combat.landed;
    const last = L[L.length - 1];
    const amt = last && last.victim === e.victim && last.by === e.by.id ? last.amount : amount;
    if (aSlot >= 0) {
      rec.dealtM[aSlot * NSRC + src] += amt;
      rec.lastMobContact[aSlot] = now;
      if (src === SRC.wish) rec.wishDmg[aSlot] += amt;
      if (src === SRC.wish && !e.dot) rec.wishHits[aSlot]++;
    }
    const campRef = w.state.mobs.get(e.victim)?.camp ?? 0;
    const ci = campRef - 1;
    if (ci >= 0 && ci < rec.campEngaged.length) {
      if (rec.campEngaged[ci]! < 0) rec.campEngaged[ci] = now;
      if (aSlot >= 0) rec.campContrib[ci] |= 1 << aSlot;
    }
    return;
  }
  // A player victim.
  rec.taken[vSlot * NSRC + src] += amount;
  const fromMob = src === SRC.mob;
  if (fromMob) rec.lastMobContact[vSlot] = now;
  // The killing-pass scratch (3.5): the largest rival entry and the largest mob entry of this tick.
  rec.kDirty |= 1 << vSlot;
  if (aSlot >= 0 && aSlot !== vSlot) {
    if (amount > rec.kPAmt[vSlot]!) { rec.kPAmt[vSlot] = amount; rec.kPEntry[vSlot] = e; }
  } else if (fromMob && amount > rec.kMAmt[vSlot]!) {
    rec.kMAmt[vSlot] = amount;
    rec.kMEntry[vSlot] = e;
  }
  if (aSlot >= 0 && aSlot !== vSlot) {
    rec.dealtP[aSlot * NSRC + src] += amount;
    if (src === SRC.wish) { rec.wishDmg[aSlot] += amount; if (!e.dot) rec.wishHits[aSlot]++; }
    markThird(rec, vSlot, aSlot, THIRD_PLAYER);
    contact(rec, aSlot, vSlot, src, amount, e.weapon);
  } else if (fromMob) {
    markThird(rec, vSlot, -1, THIRD_MOB);
  }
}

function onArenaHurt(rec: TelemetryRecorder, victim: string, by: LedgerSource, hp: number): void {
  if (!rec.started || !(hp > 0)) return;
  const v = rec.slotOf.get(victim);
  if (v === undefined) return;
  const sd = by.id === SUDDEN_DEATH_KILLER;
  rec.taken[v * NSRC + (sd ? SRC.suddenDeath : SRC.terrain)] += hp;
  rec.kDirty |= 1 << v;
  if (sd) rec.kSD[v] += hp;
  else rec.kTerr[v] += hp;
  markThird(rec, v, -1, THIRD_ARENA);
}

function onOverkilled(rec: TelemetryRecorder, victim: Combatant, hits: readonly OverkillHit[], overkill: number, total: number): void {
  if (!rec.started || victim.kind !== "player" || !(total > 0)) return;
  for (const h of hits) {
    const a = creditSlot(rec, h.entry.by);
    if (a >= 0 && a !== rec.slotOf.get(victim.id)) rec.overkill[a] += (overkill * h.amount) / total;
  }
}

function onBlocked(rec: TelemetryRecorder, holder: Combatant, attacker: Combatant, prevented: DamagePacket): void {
  if (!rec.started || !(prevented.raw > 0)) return;
  const y = rec.slotOf.get(holder.id);
  const x = rec.slotOf.get(creditedPlayerId(rec.world, attacker.id));
  if (x === undefined || y === undefined || x === y) return;
  contact(rec, x, y, SRC.weapon, 0, null);
}

// ---------------------------------------------------------------------------------------------------------------------
// Deaths (3.5)

function resolveDeath(rec: TelemetryRecorder, v: number): void {
  const w = rec.world;
  const now = w.state.serverTime;
  const pr = playerOf(rec, v);
  const at = runMs(rec);
  const zone = pr ? regionAt(w.map, pr.p.x, pr.p.y) : "none";
  const base = { at, zone, coliseum: w.state.gatesLocked };
  let cause: DeathCause;
  const pEntry = rec.kPEntry[v];
  const lastHit = pr?.rt.lastHit ?? null;
  const rivalSlot = (id: string | undefined): number => {
    if (id === undefined) return -1;
    const s = rec.slotOf.get(id);
    const rt = w.players.get(id);
    return s !== undefined && rt && !rt.resolved ? s : -1;
  };
  if (rec.kPAmt[v]! > 0 && pEntry) {
    // The ledger's credit: the largest rival hit of the killing pass (applyHits set lastHit to it).
    const bySlot = rivalSlot(lastHit?.by) >= 0 ? rivalSlot(lastHit?.by) : creditSlot(rec, pEntry.by);
    cause = {
      kind: isZombieHit(rec, pEntry.by) ? "zombie" : "player", ...base, bySlot,
      ...(pEntry.weapon ? { weapon: pEntry.weapon } : {}), ...(pEntry.sig ? { sig: pEntry.sig } : {}),
      ...(pEntry.ability ? { ability: pEntry.ability } : {}),
    };
  } else {
    const sd = rec.kSD[v]!, terr = rec.kTerr[v]!, mob = rec.kMAmt[v]!;
    const recent = lastHit && now - lastHit.at <= KILL_CREDIT_SECONDS * 1000 ? rivalSlot(lastHit.by) : -1;
    const mEntry = rec.kMEntry[v];
    if (sd > 0 && sd >= terr && sd >= mob) cause = { kind: "suddenDeath", ...base };
    else if (recent >= 0) cause = { kind: "player", ...base, bySlot: recent };
    else if (mob > 0 && mob >= terr && mEntry) {
      const m = w.state.mobs.get(mEntry.by.id);
      const camp = m && m.camp > 0 ? m.camp - 1 : -1;
      cause = { kind: "mob", ...base, mobType: m?.type ?? "", elite: w.mobs.get(mEntry.by.id)?.brain?.elite === true, camp };
      if (camp >= 0 && camp < rec.campDeaths.length) rec.campDeaths[camp]++;
    } else if (terr > 0) cause = { kind: "terrain", ...base };
    else if (sd > 0) cause = { kind: "suddenDeath", ...base };
    else cause = { kind: "unknown", ...base };
  }
  rec.deaths[v] = cause;
  if (!rec.firstBlood) rec.firstBlood = { at, victim: v, killer: cause.bySlot ?? -1 };
}

function onFighterOut(rec: TelemetryRecorder, id: string, why: "down" | "removed"): void {
  if (!rec.started) return;
  const s = rec.slotOf.get(id);
  if (s === undefined || rec.out[s] === 2) return;
  const w = rec.world;
  const first = rec.out[s] === 0;
  if (first) {
    rec.outAt[s] = w.state.serverTime;
    takeFinal(rec, s);
  }
  if (why === "down") {
    rec.out[s] = 1;
    const outcome = w.players.get(id)?.down?.outcome;
    if (outcome === "died") {
      rec.downMask |= 1 << s;
      // A death outside a step (a test's direct damage) has no system after it this tick: resolve it now.
      if (!w.stepping) {
        resolveDeath(rec, s);
        if (rec.openCount > 0) duelTick(rec);
        rec.downMask &= ~(1 << s);
      }
    } else if (outcome === "mia") {
      rec.deaths[s] = { kind: "quit", at: runMs(rec), zone: "none", coliseum: w.state.gatesLocked };
      closeSlotPairs(rec, s, { ...NO_FACTS, quit: true });
    }
    return;
  }
  rec.out[s] = 2;
  // A void (shutdown) abandons everyone: their segments end with the run, not as a quit.
  closeSlotPairs(rec, s, w.arena.voided ? { ...NO_FACTS, runEnd: true } : { ...NO_FACTS, quit: true });
}

// ---------------------------------------------------------------------------------------------------------------------
// The system: deaths, duel gaps and ends, the 1 Hz sampler (3.3)

function system(rec: TelemetryRecorder): void {
  const w = rec.world;
  if (!rec.started || rec.endAt >= 0 || w.state.phase !== "active") return;
  const now = w.state.serverTime;
  if (rec.downMask !== 0) {
    for (let s = 0; s < rec.n; s++) if (rec.downMask & (1 << s)) resolveDeath(rec, s);
  }
  if (rec.openCount > 0) duelTick(rec);
  rec.downMask = 0;
  if (rec.kDirty !== 0) {
    for (let s = 0; s < rec.n; s++) {
      if (!(rec.kDirty & (1 << s))) continue;
      rec.kPAmt[s] = 0; rec.kPEntry[s] = null; rec.kMAmt[s] = 0; rec.kMEntry[s] = null; rec.kSD[s] = 0; rec.kTerr[s] = 0;
    }
    rec.kDirty = 0;
  }
  const st = w.state;
  if (!rec.sdNoted && st.gatesLocked && st.suddenDeathAt > 0 && now >= st.suddenDeathAt) {
    rec.sdNoted = true;
    rec.suddenDeath.push(runMs(rec));
  }
  const t = now - rec.startAt;
  if (t % TELEMETRY_SAMPLE_MS < TICK_MS && t >= TELEMETRY_SAMPLE_MS) {
    sample(rec, t);
    restartWholeCamps(rec);
  }
}

/**
 * A camp whose fight was given up is whole again (every member alive, idle at home and at full hp: a walk home or the
 * teleport): its cycle's engagement starts over, so a clear is timed from the fight that cleared it and credits only
 * that fight's contributors (an early poke at 40 s and a clear at 300 s is not a 260 s clear). Read-only on the world.
 */
export function restartWholeCamps(rec: TelemetryRecorder): void {
  const n = rec.campEngaged.length;
  let any = false;
  for (let i = 0; i < n; i++) if (rec.campEngaged[i]! >= 0) { any = true; break; }
  if (!any) return;
  const w = rec.world;
  const busy = new Uint8Array(n);
  for (const rt of w.mobs.values()) {
    const m = w.state.mobs.get(rt.id);
    if (m === undefined || m.status !== "alive") continue;
    const ci = m.camp - 1;
    if (ci < 0 || ci >= n || rec.campEngaged[ci]! < 0) continue;
    if (rt.brain?.mode !== "idle" || m.hp < m.maxHp) busy[ci] = 1;
  }
  for (let ci = 0; ci < n; ci++) {
    if (rec.campEngaged[ci]! < 0 || busy[ci]) continue;
    const st = w.state.camps[ci];
    const spots = w.map.camps[ci]?.spots.length ?? 0;
    if (!st || st.alive < spots) continue; // a member is dead: the fight is not over, it is only paused
    rec.campEngaged[ci] = -1;
    rec.campContrib[ci] = 0;
  }
}

function sample(rec: TelemetryRecorder, t: number): void {
  const w = rec.world;
  const k = rec.sampleCount++;
  const keep = k < TELEMETRY_MAX_SAMPLES;
  if (!keep) rec.samplesDropped++;
  const now = w.state.serverTime;
  for (let s = 0; s < rec.n; s++) {
    for (let i = 0; i < NSNAP; i++) {
      const idx = s * NSNAP + i;
      if (rec.snapTaken[idx] || t < TELEMETRY_SNAPSHOT_MINUTES[i]! * 60_000) continue;
      rec.snapTaken[idx] = 1;
      if (standingSlot(rec, s)) {
        const p = playerOf(rec, s)!.p;
        rec.snapshots[s]!.push({
          minute: TELEMETRY_SNAPSHOT_MINUTES[i]!, ...statsOf(p), cardPower: cardPower(p.build),
          mobStatsTotal: r1(sumMap(p.mobStats)), boostsTotal: sumMap(p.extra.chestBoosts),
        });
      }
    }
    if (!standingSlot(rec, s)) continue;
    const p = w.state.players.get(rec.ids[s]!)!;
    const wi = WIDX.get(activeWeapon(p) ?? "fists") ?? WIDX.get("fists")!;
    rec.weaponMs[s * NW + wi] += TELEMETRY_SAMPLE_MS;
    const zi = ZIDX.get(regionAt(w.map, p.x, p.y)) ?? 0;
    rec.zoneMs[s * NZ + zi] += TELEMETRY_SAMPLE_MS;
    if (now - rec.lastMobContact[s]! <= FARM_CONTACT_MS) rec.farmMs[s] += TELEMETRY_SAMPLE_MS;
    if (keep && rec.positions) {
      const tiles = rec.tiles[s]!;
      tiles[2 * k] = Math.min(254, Math.max(0, worldToTile(p.x)));
      tiles[2 * k + 1] = Math.min(254, Math.max(0, worldToTile(p.y)));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Offers, camps, the rest

function onOffered(rec: TelemetryRecorder, box: ContainerState, kind: OfferKind, camp: number, eligible: readonly string[]): void {
  if (!rec.started) return;
  if (rec.offers.length >= TELEMETRY_MAX_OFFERS) { rec.offersDropped++; return; }
  const slots: number[] = [];
  for (const id of eligible) { const s = rec.slotOf.get(id); if (s !== undefined) slots.push(s); }
  const def = camp >= 0 ? rec.world.map.camps[camp] : undefined;
  const i = rec.offers.length;
  rec.offers.push({
    i, kind, at: runMs(rec), camp,
    elite: kind === "augment" && (camp < 0 || (def !== undefined && def.eliteSpot >= 0)),
    options: Array.from(box.options), eligible: slots, picks: [],
  });
  rec.offerOf.set(box.id, i);
}

function onChosen(rec: TelemetryRecorder, c: Combatant, box: ContainerState, option: number): void {
  const i = rec.offerOf.get(box.id);
  const s = rec.slotOf.get(c.id);
  if (i === undefined || s === undefined) return;
  rec.offers[i]!.picks.push({ slot: s, option, at: runMs(rec) });
}

function onCampCleared(rec: TelemetryRecorder, camp: number): void {
  if (!rec.started || camp < 0 || camp >= rec.campEngaged.length) return;
  const w = rec.world;
  const st = w.state.camps[camp];
  const def = w.map.camps[camp];
  const contributors: number[] = [];
  const bits = rec.campContrib[camp]!;
  for (let s = 0; s < rec.n; s++) if (bits & (1 << s)) { contributors.push(s); rec.campsCleared[s]++; }
  if (rec.camps.length < TELEMETRY_MAX_CAMP_CLEARS) {
    const engaged = rec.campEngaged[camp]!;
    rec.camps.push({
      camp, cycle: rec.campCycle[camp]!, zone: (def?.zone ?? "none") as RegionId, type: st?.type ?? "", elite: st?.elite ?? "",
      engagedAt: engaged >= 0 ? Math.round(engaged - rec.startAt) : runMs(rec), clearedAt: runMs(rec),
      killerSlot: st && st.wardOwner !== "" ? rec.slotOf.get(st.wardOwner) ?? -1 : -1,
      contributors, playerDeaths: rec.campDeaths[camp]!,
    });
  } else rec.campsDropped++;
  rec.campCycle[camp]++;
  rec.campEngaged[camp] = -1;
  rec.campContrib[camp] = 0;
  rec.campDeaths[camp] = 0;
}

function onCast(rec: TelemetryRecorder, c: Combatant): void {
  const s = rec.slotOf.get(c.id);
  if (s === undefined || !rec.started) return;
  rec.wish[s * NWISH + WISH_CASTS]++;
  if (rec.openCount === 0) return;
  for (let o = 0; o < rec.n; o++) {
    if (o === s) continue;
    const k = o < s ? pairIndex(o, s) : pairIndex(s, o);
    if (rec.pOpen[k]) rec.pWishes[2 * k + (s < o ? 0 : 1)]++;
  }
}

function onCastEnded(rec: TelemetryRecorder, c: Combatant, reason: string): void {
  const s = rec.slotOf.get(c.id);
  if (s === undefined || !rec.started) return;
  const i = reason === "landed" ? WISH_LANDED : reason === "fizzle" ? WISH_FIZZLED : reason === "interrupted" ? WISH_INTERRUPTED : WISH_CANCELLED;
  rec.wish[s * NWISH + i]++;
}

/** docs/TELEMETRY.md 2: installed after createGameWorld, never in training. */
export function installTelemetry(world: World, opts: { positions?: boolean } = {}): TelemetryRecorder {
  const rec = newRecorder(world, opts.positions !== false);
  chainHook(world, "raidStarted", () => begin(rec));
  // The hot taps are linked with a fixed arity (chainHook's rest-parameter wrapper would allocate an argument array per call).
  const hitPrev = world.hooks.hitLanded;
  world.hooks.hitLanded = hitPrev
    ? (w, e, amount) => { hitPrev(w, e, amount); onHitLanded(rec, e, amount); }
    : (_w, e, amount) => { onHitLanded(rec, e, amount); };
  const arenaPrev = world.hooks.arenaHurt;
  world.hooks.arenaHurt = arenaPrev
    ? (w, victim, by, hp) => { arenaPrev(w, victim, by, hp); onArenaHurt(rec, victim, by, hp); }
    : (_w, victim, by, hp) => { onArenaHurt(rec, victim, by, hp); };
  chainHook(world, "overkilled", (_w, victim, hits, overkill, total) => onOverkilled(rec, victim, hits, overkill, total));
  chainHook(world, "blocked", (_w, holder, attacker, prevented) => onBlocked(rec, holder, attacker, prevented));
  chainHook(world, "fighterOut", (_w, id, why) => onFighterOut(rec, id, why));
  chainHook(world, "teleported", () => {
    if (!rec.started) return;
    rec.teleports.push(runMs(rec));
    rec.sdNoted = false;
    restartWholeCamps(rec); // mobLife's hook (chained before this one) has put every mob back on its spot at full hp
    closeAll(rec, { ...NO_FACTS, teleport: true });
  });
  chainHook(world, "runEnded", () => {
    if (!rec.started || rec.endAt >= 0) return;
    // The ending tick's downs were resolved by the system; whatever is still open ends with the run.
    closeAll(rec, { ...NO_FACTS, runEnd: true });
    rec.endAt = world.state.serverTime;
  });
  chainHook(world, "mobKilled", (_w, killer, mob) => {
    const s = rec.slotOf.get(killer.id);
    if (s === undefined || !rec.started) return;
    const m = rec.mobKills[s]!;
    m.set(mob.type, (m.get(mob.type) ?? 0) + 1);
    if (mob.elite) rec.eliteKills[s]++;
  });
  chainHook(world, "campCleared", (_w, camp) => onCampCleared(rec, camp));
  const onHealed = (c: Combatant, gained: number, source: HealSource): void => {
    const s = rec.slotOf.get(c.id);
    if (s !== undefined && rec.started) rec.healed[s * NHEAL + HEAL[source]] += gained;
  };
  const healPrev = world.hooks.healed;
  world.hooks.healed = healPrev
    ? (w, c, gained, source) => { healPrev(w, c, gained, source); onHealed(c, gained, source); }
    : (_w, c, gained, source) => { onHealed(c, gained, source); };
  chainHook(world, "rewardOffered", (_w, box, kind, camp, eligible) => onOffered(rec, box, kind, camp, eligible));
  chainHook(world, "rewardChosen", (_w, c, box, option) => onChosen(rec, c, box, option));
  chainHook(world, "consumableUsed", (_w, c, id) => {
    const s = rec.slotOf.get(c.id);
    if (s === undefined || !rec.started) return;
    if (id === "potionLarge") rec.potLarge[s]++;
    else rec.potSmall[s]++;
  });
  chainHook(world, "consumableGranted", (_w, c) => {
    const s = rec.slotOf.get(c.id);
    if (s !== undefined && rec.started) rec.potGranted[s]++;
  });
  chainHook(world, "questAccepted", (_w, c, def) => { const s = rec.slotOf.get(c.id); if (s !== undefined) rec.questsAccepted[s]!.push(def); });
  chainHook(world, "questCompleted", (_w, c, def) => { const s = rec.slotOf.get(c.id); if (s !== undefined) rec.questsCompleted[s]!.push(def); });
  chainHook(world, "castAccepted", (_w, c) => onCast(rec, c));
  chainHook(world, "castEnded", (_w, c, _ability, reason) => onCastEnded(rec, c, reason));
  const onStatus = (c: Combatant, st: StatusInstance, fresh: boolean): void => {
    if (!fresh || st.ability === undefined || !rec.started || st.source.id === c.id) return;
    const s = rec.slotOf.get(creditedPlayerId(world, st.source.id));
    if (s !== undefined && rec.slotOf.get(c.id) !== s) rec.wishHits[s]++;
  };
  const statusPrev = world.hooks.statusApplied;
  world.hooks.statusApplied = statusPrev
    ? (w, c, st, fresh) => { statusPrev(w, c, st, fresh); onStatus(c, st, fresh); }
    : (_w, c, st, fresh) => { onStatus(c, st, fresh); };
  world.systems.push(() => system(rec));
  return rec;
}

/** The Room's events the recorder needs (docs/TELEMETRY.md 6.1): `resolved` and `gv`. */
export function noteRoomEvent(rec: TelemetryRecorder, ev: SimEvent): void {
  if (ev.type === "gv") {
    const s = rec.slotOf.get(ev.id);
    const i = GV_OF[ev.reason];
    if (s !== undefined && i !== undefined) rec.gv[s * NGV + i] += ev.amount;
    return;
  }
  if (ev.type !== "resolved") return;
  const s = rec.slotOf.get(ev.id);
  if (s === undefined) {
    if (!rec.started && ev.result.outcome === "mia") rec.planningMia++;
    return;
  }
  rec.results[s] = ev.result;
  if (ev.result.gv.win > 0) rec.gv[s * NGV + 4] = ev.result.gv.win;
  // The final build at the resolve, while the player is still in the state (a leaver was snapshotted at its fighterOut).
  if (rec.world.state.players.has(ev.id)) takeFinal(rec, s);
}

function fromArr<K extends string>(keys: readonly K[], arr: Float64Array, base: number): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (let i = 0; i < keys.length; i++) { const v = arr[base + i]!; if (v > 0) out[keys[i]!] = r1(v); }
  return out;
}

/**
 * The record minus the Room's fields, from the recorder's memory and the world as it stands (docs/TELEMETRY.md 6.1). Off the
 * tick, once per run. A void or abandoned end (the Room's) closes the segments still open as `runEnd` first; that is the only
 * change it makes, and only to the recorder's own state.
 */
export function telemetryDraft(world: World, rec: TelemetryRecorder, end?: "void" | "abandoned"): RunDraft | null {
  if (!rec.started) return null;
  if (rec.openCount > 0) closeAll(rec, { ...NO_FACTS, runEnd: true });
  const endAt = rec.endAt >= 0 ? rec.endAt : world.state.serverTime;
  const players: PlayerDraft[] = [];
  let winnerSlot = -1;
  let winBonusPaid = false;
  let draw = false;
  for (let s = 0; s < rec.n; s++) {
    const pr = playerOf(rec, s);
    if (!rec.finals[s] && pr) takeFinal(rec, s);
    const result = rec.results[s];
    const outcome: PlayerOutcome = result?.outcome ?? "alive";
    if (outcome === "won") { winnerSlot = s; winBonusPaid = result?.winBonusWithheld !== true; }
    if (outcome === "draw") draw = true;
    let mainWeapon: WeaponId = "fists";
    let best = 0;
    const weaponMs: Partial<Record<WeaponId, number>> = {};
    for (let i = 0; i < NW; i++) {
      const v = rec.weaponMs[s * NW + i]!;
      if (v > 0) weaponMs[ALL_WEAPON_IDS[i]!] = v;
      if (v > best) { best = v; mainWeapon = ALL_WEAPON_IDS[i]!; }
    }
    if (best === 0 && pr) mainWeapon = activeWeapon(pr.p) ?? "fists";
    const zoneMs: Partial<Record<RegionId, number>> = {};
    for (let i = 0; i < NZ; i++) { const v = rec.zoneMs[s * NZ + i]!; if (v > 0) zoneMs[REGION_IDS[i]!] = v; }
    const aliveEnd = rec.out[s] ? rec.outAt[s]! : endAt;
    const final = rec.finals[s] ?? {
      maxHp: 0, ad: 0, ap: 0, armor: 0, shield: 0, asMult: 1, speedMult: 1, cards: {}, cardPower: 0, boosts: {}, boostsTotal: 0,
      trophies: {}, mobStats: {}, mobStatsTotal: 0,
    };
    const mobKills: Record<string, number> = {};
    rec.mobKills[s]!.forEach((v, k) => { mobKills[k] = v; });
    const healed: HealBySource = fromArr(HEAL_SOURCES, rec.healed, s * NHEAL);
    const wb = s * NWISH;
    const kills = result ? result.kills : Math.max(0, (pr?.p.kills ?? 0) - rec.botKills[s]!);
    const draft: PlayerDraft = {
      id: rec.ids[s]!, profile: rec.profiles[s]!,
      slot: s, bot: rec.bots[s]!, faction: rec.factions[s]!, spawn: rec.spawns[s]!,
      place: result?.place ?? 0, outcome,
      aliveMs: Math.max(0, Math.round(aliveEnd - rec.startAt)),
      death: outcome === "died" || outcome === "mia" ? rec.deaths[s] ?? null : null,
      kills, botKills: rec.botKills[s]!,
      weaponMs, mainWeapon, zoneMs, final, snapshots: rec.snapshots[s]!,
      mobKills, eliteKills: rec.eliteKills[s]!, campsCleared: rec.campsCleared[s]!, farmMs: rec.farmMs[s]!,
      dealt: { players: bySource(rec.dealtP, s * NSRC), mobs: bySource(rec.dealtM, s * NSRC) },
      taken: bySource(rec.taken, s * NSRC), overkill: r1(rec.overkill[s]!), healed,
      wish: {
        casts: rec.wish[wb + WISH_CASTS]!, landed: rec.wish[wb + WISH_LANDED]!, fizzled: rec.wish[wb + WISH_FIZZLED]!,
        interrupted: rec.wish[wb + WISH_INTERRUPTED]!, cancelled: rec.wish[wb + WISH_CANCELLED]!, hits: rec.wishHits[s]!, damage: r1(rec.wishDmg[s]!),
      },
      potions: { small: rec.potSmall[s]!, large: rec.potLarge[s]!, granted: rec.potGranted[s]! },
      quests: { accepted: rec.questsAccepted[s]!.slice(), completed: rec.questsCompleted[s]!.slice() },
      gv: fromArr(GV_KEYS, rec.gv, s * NGV),
      ...(result?.winBonusWithheld !== undefined ? { winBonusWithheld: result.winBonusWithheld } : {}),
      ...(result?.winBonusWhy ? { winBonusWhy: result.winBonusWhy } : {}),
      quit: outcome === "mia",
    };
    if (rec.positions) draft.tiles = packTiles(rec.tiles[s]!.subarray(0, 2 * Math.min(rec.sampleCount, TELEMETRY_MAX_SAMPLES)));
    players.push(draft);
  }
  const runEnd: RunEnd = end ?? (winnerSlot >= 0 ? "winner" : draw ? "draw" : rec.endAt >= 0 ? "draw" : "abandoned");
  const truncated: NonNullable<RunRecord["truncated"]> = {};
  if (rec.duelsDropped > 0) truncated.duels = rec.duelsDropped;
  if (rec.offersDropped > 0) truncated.offers = rec.offersDropped;
  if (rec.campsDropped > 0) truncated.camps = rec.campsDropped;
  if (rec.samplesDropped > 0) truncated.samples = rec.samplesDropped;
  let humans = 0;
  for (const b of rec.bots) if (!b) humans++;
  const cfg = world.config;
  return {
    v: TELEMETRY_SCHEMA_VERSION,
    kind: "run",
    durationMs: Math.max(0, Math.round(endAt - rec.startAt)),
    end: runEnd,
    seed: world.state.seed,
    attempt: world.state.attempt,
    mapHash: world.state.mapHash,
    config: { planSeconds: cfg.planSeconds ?? 0, quests: cfg.quests === true, mobs: cfg.mobs === true, coliseumSchedule: cfg.coliseumSchedule !== undefined },
    humans,
    bots: rec.n - humans,
    players,
    winnerSlot,
    winBonusPaid: winnerSlot >= 0 && winBonusPaid,
    coliseum: { teleports: rec.teleports.slice(), suddenDeath: rec.suddenDeath.slice() },
    firstBlood: rec.firstBlood,
    ...(rec.planningMia > 0 ? { planningMia: rec.planningMia } : {}),
    duels: rec.duels,
    offers: rec.offers,
    camps: rec.camps,
    ...(Object.keys(truncated).length > 0 ? { truncated } : {}),
  };
}

// Re-exported for the tests' readability.
export type { AbilityId };
