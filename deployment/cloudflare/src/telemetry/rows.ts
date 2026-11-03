// RunRecord -> the summary rows of docs/TELEMETRY.md 7.2. Pure: the Worker flattens, the Durable Object only runs SQL.
import {
  TELEMETRY_HEAT_CELL_TILES,
  TELEMETRY_MAP_TILES,
  TILE_ABSENT,
  telemetryDay,
  telemetryObjectKey,
  unpackTiles,
  type DamageBySource,
  type RunRecord,
} from "@raid/shared/telemetry";
import type { SqlValue } from "./store";

export type Row = Record<string, SqlValue>;

/** One record's rows, one array per table (column name -> value). `heat` adds to cross-run cells. */
export interface IngestRows {
  runId: string;
  run: Row;
  players: Row[];
  player_weapons: Row[];
  player_zones: Row[];
  player_cards: Row[];
  player_mobs: Row[];
  player_amounts: Row[];
  power_snaps: Row[];
  offers: Row[];
  offer_options: Row[];
  camp_clears: Row[];
  duels: Row[];
  duel_cards: Row[];
  heat_cells: Row[];
}

/** The child tables in insert order (and delete order for retention). */
export const CHILD_TABLES = [
  "players", "player_weapons", "player_zones", "player_cards", "player_mobs", "player_amounts", "power_snaps",
  "offers", "offer_options", "camp_clears", "duels", "duel_cards",
] as const;
export type ChildTable = (typeof CHILD_TABLES)[number];

/** The map is TELEMETRY_MAP_TILES (160) tiles square; cells are TELEMETRY_HEAT_CELL_TILES wide (40 x 40). */
export const HEAT_GRID = Math.ceil(TELEMETRY_MAP_TILES / TELEMETRY_HEAT_CELL_TILES);

const b = (x: boolean | undefined): number => (x ? 1 : 0);
const r1 = (x: number): number => Math.round(x * 10) / 10;
const num = (x: unknown, fallback = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : fallback);
const str = (x: unknown, fallback = ""): string => (typeof x === "string" ? x : fallback);
const optNum = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

function sum(m: Record<string, number | undefined> | undefined): number {
  let t = 0;
  if (m) for (const v of Object.values(m)) t += num(v);
  return r1(t);
}

function amounts(runId: string, slot: number, dir: string, m: Record<string, number | undefined> | undefined, out: Row[]): void {
  if (!m) return;
  for (const [source, v] of Object.entries(m)) {
    if (num(v) === 0) continue;
    out.push({ run_id: runId, slot, dir, source, amount: r1(num(v)) });
  }
}

/**
 * Flattens a validated record. `receivedAt` is the ingest's stamp (the record's own `receivedAt` when it carries one,
 * which an R2 reindex does). Unknown or missing optional fields become zeros, never a throw.
 */
/** A Trophy option carries its gain (kill:ad:6.0); offers compare it by stat (kill:ad), as duel_cards and analyze.py do. */
export function optionGroup(kind: string, option: string): string {
  return kind === "trophy" && option.startsWith("kill:") ? option.split(":").slice(0, 2).join(":") : option;
}

export function toRows(record: RunRecord & { receivedAt?: number }, receivedAt = record.receivedAt ?? record.endedAtEpoch): IngestRows {
  const runId = record.runId;
  const day = telemetryDay(record.endedAtEpoch);
  const build = record.build.server;
  const bySlot = new Map(record.players.map((p) => [p.slot, p]));
  const winner = bySlot.get(record.winnerSlot);
  const fbVictim = record.firstBlood ? bySlot.get(record.firstBlood.victim) : undefined;
  const truncated = record.truncated && Object.values(record.truncated).some((v) => v) ? 1 : 0;
  const out: IngestRows = {
    runId,
    run: {
      run_id: runId, v: record.v, source: str(record.source, "dev"), build, commit_sha: record.build.commit ?? null, day,
      started_at: num(record.startedAtEpoch), ended_at: num(record.endedAtEpoch), duration_ms: Math.round(num(record.durationMs)),
      end_reason: str(record.end, "winner"), seed: num(record.seed), attempt: num(record.attempt), map_hash: num(record.mapHash),
      humans: num(record.humans), bots: num(record.bots), winner_slot: num(record.winnerSlot, -1),
      winner_faction: winner?.faction ?? null, win_bonus_paid: b(record.winBonusPaid),
      teleports: record.coliseum?.teleports?.length ?? 0, first_teleport_ms: optNum(record.coliseum?.teleports?.[0]),
      first_blood_ms: optNum(record.firstBlood?.at), first_blood_victim_faction: fbVictim?.faction ?? null,
      duels: record.duels.length, truncated, raw_key: telemetryObjectKey(build, record.endedAtEpoch, runId), received_at: num(receivedAt),
    },
    players: [], player_weapons: [], player_zones: [], player_cards: [], player_mobs: [], player_amounts: [], power_snaps: [],
    offers: [], offer_options: [], camp_clears: [], duels: [], duel_cards: [], heat_cells: [],
  };

  const campType = new Map<number, string>();
  for (const c of record.camps) if (!campType.has(c.camp)) campType.set(c.camp, c.type);
  const heat = new Map<number, number>();

  for (const p of record.players) {
    const slot = p.slot;
    const d = p.death ?? null;
    let detail = "";
    if (d?.kind === "mob") detail = str(d.mobType);
    else if ((d?.kind === "player" || d?.kind === "zombie") && d.bySlot !== undefined) detail = bySlot.get(d.bySlot)?.faction ?? "";
    const deathCamp = d && typeof d.camp === "number" ? d.camp : null;
    const f = p.final;
    out.players.push({
      run_id: runId, slot, pid: p.pid ?? null, bot: b(p.bot), tier: p.tier ?? null, persona: p.persona ?? null,
      faction: p.faction, spawn_zone: str(p.spawn?.zone, "none"), spawn_picked: b(p.spawn?.picked),
      place: num(p.place), outcome: str(p.outcome, "alive"), won: b(p.outcome === "won"), alive_ms: Math.round(num(p.aliveMs)),
      death_kind: d?.kind ?? null, death_detail: d ? detail : null, death_ms: d ? optNum(d.at) : null,
      death_zone: d ? str(d.zone, "none") : null, death_coliseum: d ? b(d.coliseum) : null,
      death_camp: deathCamp, death_camp_type: d?.kind === "mob" ? (deathCamp !== null && campType.get(deathCamp)) || str(d.mobType) : null,
      kills: num(p.kills), bot_kills: num(p.botKills), mob_kills: Math.round(sum(p.mobKills)), elite_kills: num(p.eliteKills),
      camps_cleared: num(p.campsCleared), farm_ms: Math.round(num(p.farmMs)), main_weapon: p.mainWeapon,
      card_power: num(f?.cardPower), mob_stats_total: num(f?.mobStatsTotal), boosts_total: num(f?.boostsTotal), max_hp: num(f?.maxHp),
      dmg_players: sum(p.dealt?.players), dmg_mobs: sum(p.dealt?.mobs), dmg_taken: sum(p.taken), overkill: r1(num(p.overkill)),
      healed: sum(p.healed), wish_casts: num(p.wish?.casts), wish_landed: num(p.wish?.landed),
      potions: num(p.potions?.small) + num(p.potions?.large),
      quests_accepted: p.quests?.accepted?.length ?? 0, quests_completed: p.quests?.completed?.length ?? 0,
      gv_total: sum(p.gv), drops: num(p.net?.drops), reconnects: num(p.net?.reconnects),
      fps_p50: optNum(p.client?.fpsP50), frame_p95: optNum(p.client?.frameMsP95), rtt_p50: optNum(p.client?.rttP50), rtt_p95: optNum(p.client?.rttP95),
      afk: b(p.afk), afk_ms: Math.round(num(p.afkMs)), quit: b(p.quit),
    });
    for (const [weapon, ms] of Object.entries(p.weaponMs ?? {})) if (num(ms) > 0) out.player_weapons.push({ run_id: runId, slot, weapon, ms: Math.round(num(ms)) });
    for (const [zone, ms] of Object.entries(p.zoneMs ?? {})) if (num(ms) > 0) out.player_zones.push({ run_id: runId, slot, zone, ms: Math.round(num(ms)) });
    const cards = new Map<string, number>();
    for (const [card, n] of Object.entries(f?.cards ?? {})) if (num(n) > 0) cards.set(card, num(n));
    for (const [stat, n] of Object.entries(f?.boosts ?? {})) if (num(n) > 0) cards.set(`boost:${stat}`, num(n));
    for (const [stat, n] of Object.entries(f?.trophies ?? {})) if (num(n) > 0) cards.set(`kill:${stat}`, num(n));
    for (const [card, count] of cards) out.player_cards.push({ run_id: runId, slot, card, count });
    for (const [mobType, kills] of Object.entries(p.mobKills ?? {})) if (num(kills) > 0) out.player_mobs.push({ run_id: runId, slot, mob_type: mobType, kills: num(kills) });
    amounts(runId, slot, "dealtPlayers", p.dealt?.players as DamageBySource, out.player_amounts);
    amounts(runId, slot, "dealtMobs", p.dealt?.mobs as DamageBySource, out.player_amounts);
    amounts(runId, slot, "taken", p.taken, out.player_amounts);
    amounts(runId, slot, "healed", p.healed, out.player_amounts);
    amounts(runId, slot, "gv", p.gv, out.player_amounts);
    const minutes = new Set<number>();
    for (const s of p.snapshots ?? []) {
      if (minutes.has(s.minute)) continue;
      minutes.add(s.minute);
      out.power_snaps.push({
        run_id: runId, slot, minute: num(s.minute), card_power: num(s.cardPower), mob_stats_total: num(s.mobStatsTotal),
        boosts_total: num(s.boostsTotal), max_hp: num(s.maxHp), ad: num(s.ad), ap: num(s.ap), armor: num(s.armor),
        shield: num(s.shield), as_mult: num(s.asMult, 1), speed_mult: num(s.speedMult, 1),
      });
    }
    if (p.tiles) {
      const bytes = unpackTiles(p.tiles);
      if (bytes) {
        const bot = b(p.bot);
        for (let i = 0; i + 1 < bytes.length; i += 2) {
          const tx = bytes[i];
          const ty = bytes[i + 1];
          if (tx === TILE_ABSENT || ty === TILE_ABSENT) continue;
          const cx = Math.floor(tx / TELEMETRY_HEAT_CELL_TILES);
          const cy = Math.floor(ty / TELEMETRY_HEAT_CELL_TILES);
          if (cx >= HEAT_GRID || cy >= HEAT_GRID) continue;
          const key = (bot * HEAT_GRID + cy) * HEAT_GRID + cx;
          heat.set(key, (heat.get(key) ?? 0) + 1);
        }
      }
    }
  }

  for (const [key, secs] of heat) {
    const cx = key % HEAT_GRID;
    const cy = Math.floor(key / HEAT_GRID) % HEAT_GRID;
    const bot = Math.floor(key / (HEAT_GRID * HEAT_GRID));
    out.heat_cells.push({ build, day, source: str(record.source, "dev"), bot, cx, cy, secs });
  }

  const seenOffers = new Set<number>();
  for (const o of record.offers) {
    if (!o || !Array.isArray(o.options) || typeof o.i !== "number" || seenOffers.has(o.i)) continue;
    seenOffers.add(o.i);
    out.offers.push({ run_id: runId, i: o.i, kind: str(o.kind, "augment"), at_ms: Math.round(num(o.at)), camp: num(o.camp, -1), elite: b(o.elite), options: JSON.stringify(o.options) });
    const choice = new Map<number, number>();
    for (const pick of o.picks ?? []) if (pick && !choice.has(pick.slot)) choice.set(pick.slot, num(pick.option, -1));
    // Anyone in range may pick (a crate's eligible list is only who stood in range at the drop): a picker was offered it too.
    const slots = new Set<number>([...(o.eligible ?? []), ...choice.keys()]);
    for (const slot of slots) {
      if (!bySlot.has(slot)) continue;
      const c = choice.has(slot) ? choice.get(slot)! : -2;
      const kind = str(o.kind, "augment");
      o.options.forEach((option, pos) => {
        out.offer_options.push({ run_id: runId, i: o.i, slot, pos, kind, option: optionGroup(kind, str(option)), picked: b(c === pos), choice: c });
      });
    }
  }

  const seenCamps = new Set<string>();
  for (const c of record.camps) {
    if (!c || typeof c.camp !== "number" || typeof c.cycle !== "number" || seenCamps.has(`${c.camp}:${c.cycle}`)) continue;
    seenCamps.add(`${c.camp}:${c.cycle}`);
    const killer = bySlot.get(c.killerSlot);
    let mask = 0;
    for (const s of c.contributors ?? []) if (s >= 0 && s < 31) mask |= 1 << s;
    out.camp_clears.push({
      run_id: runId, camp: c.camp, cycle: c.cycle, zone: str(c.zone, "none"), mob_type: str(c.type), elite_type: str(c.elite),
      engaged_ms: Math.round(num(c.engagedAt)), cleared_ms: Math.round(num(c.clearedAt)),
      clear_ms: Math.max(0, Math.round(num(c.clearedAt) - num(c.engagedAt))),
      killer_slot: num(c.killerSlot, -1), killer_faction: killer?.faction ?? null, killer_weapon: killer?.mainWeapon ?? null,
      killer_bot: killer ? b(killer.bot) : null, contributors: mask, player_deaths: num(c.playerDeaths),
    });
  }

  const seenDuels = new Set<number>();
  for (const d of record.duels) {
    if (typeof d.i !== "number" || seenDuels.has(d.i)) continue;
    seenDuels.add(d.i);
    const [a, z] = d.sides;
    const total = (m: DamageBySource) => sum(m as Record<string, number>);
    out.duels.push({
      run_id: runId, i: d.i, start_ms: Math.round(num(d.start)), dur_ms: Math.max(0, Math.round(num(d.end) - num(d.start))),
      a_slot: a.slot, b_slot: z.slot, bots: b(a.bot) + b(z.bot),
      a_faction: str(a.faction), b_faction: str(z.faction), a_weapon: str(a.weapon, "fists"), b_weapon: str(z.weapon, "fists"),
      a_power: num(a.cardPower), b_power: num(z.cardPower),
      a_stacks: num(a.mobStatsTotal) + num(a.boostsTotal), b_stacks: num(z.mobStatsTotal) + num(z.boostsTotal),
      a_hp: num(a.hp), b_hp: num(z.hp), a_hp_end: num(a.hpEnd), b_hp_end: num(z.hpEnd),
      a_dmg: total(a.dmg), b_dmg: total(z.dmg), a_wishes: num(a.wishes), b_wishes: num(z.wishes),
      first: num(d.first, 2), outcome: str(d.outcome), winner: num(d.winner, -1), third: num(d.third),
      clean: b(d.clean), zone: str(d.zone, "none"), coliseum: b(d.coliseum),
      comeback: d.comeback === null || d.comeback === undefined ? null : b(d.comeback),
    });
    d.sides.forEach((side, s) => {
      for (const card of new Set(side.augments ?? [])) if (typeof card === "string") out.duel_cards.push({ run_id: runId, i: d.i, side: s, card });
    });
  }
  return out;
}
