// Tournament report (docs/BOTS.md 9.3): aggregates GameSummary rows into per-tier, per-persona and per-faction figures, prints
// them, and judges the pass criteria. Pure: no clock, no I/O, so a handcrafted set of summaries gives an exact report (tested).
// The criteria are informational: the tuning target, not CI. Nothing here throws on an odd set of games (no games, a tier
// missing from the lineup): a figure with no data is NaN and prints as "-".
import { FACTION_IDS } from "@raid/shared";
import { PERSONA_IDS, TIER_IDS, TIERS, type TierId } from "../brain/types";
import type { BotGameSummary, GameSummary } from "./game";

// ============================================================================================================== statistics

export interface Proportion {
  readonly k: number;
  readonly n: number;
  readonly p: number;
  readonly lo: number;
  readonly hi: number;
}

/** The Wilson score interval of k successes in n trials (z = 1.96 is 95%). */
export function wilson(k: number, n: number, z = 1.96): Proportion {
  if (n <= 0) return { k, n, p: NaN, lo: NaN, hi: NaN };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { k, n, p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** The q-quantile (0..1) of an ascending list, linearly interpolated between neighbours. NaN for an empty list. */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface MeanInterval {
  readonly n: number;
  readonly mean: number;
  readonly lo: number;
  readonly hi: number;
}

/** Mean and a normal-approximation interval (z = 1.645 is 90%) from the standard error of the mean. */
export function meanInterval(xs: readonly number[], z = 1.645): MeanInterval {
  const n = xs.length;
  if (n === 0) return { n, mean: NaN, lo: NaN, hi: NaN };
  let sum = 0;
  for (const x of xs) sum += x;
  const mean = sum / n;
  if (n < 2) return { n, mean, lo: mean, hi: mean };
  let ss = 0;
  for (const x of xs) ss += (x - mean) * (x - mean);
  const se = Math.sqrt(ss / (n - 1) / n);
  return { n, mean, lo: mean - z * se, hi: mean + z * se };
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
const sumOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

// ================================================================================================================ aggregates

/** Stimuli whose delay is the plain reaction time (the others are scaled by attention or reading, or are the daze). */
const READING_KINDS: ReadonlySet<string> = new Set(["announcement", "chestUp", "planOffer"]);
const SCALED_KINDS: ReadonlySet<string> = new Set(["newThreat", "teleport", ...READING_KINDS]);

/** The mean the tier table promises for a stimulus kind (mu + tau; the daze for a teleport; reading x1.5), before attention. */
export function tableReactionMean(tier: TierId, kind: string): number {
  const t = TIERS[tier];
  if (kind === "teleport") return t.daze.mu + t.daze.tau;
  const base = t.reaction.mu + t.reaction.tau;
  return READING_KINDS.has(kind) ? base * 1.5 : base;
}

export interface ReactionRow {
  readonly kind: string;
  readonly n: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  readonly mean: number;
  readonly table: number;
}

export interface TierAgg {
  readonly tier: TierId;
  /** Bot-games: one per bot per game. */
  readonly botGames: number;
  readonly wins: number;
  readonly draws: number;
  readonly capped: number;
  /** Per-bot win share: wins per bot-game, with its 95% Wilson interval. */
  readonly winRate: Proportion;
  /** This tier's wins over all wins of the tournament. */
  readonly shareOfWins: number;
  /** Mean placement (lower is better): per game the tier's mean, then the mean over games with a 90% interval. */
  readonly place: MeanInterval;
  readonly killsPerBot: number;
  readonly deathsPerBot: number;
  readonly damagePerBot: number;
  readonly mobDamagePerBot: number;
  readonly mobKillsPerBot: number;
  readonly gvPerBot: number;
  /** Mean seconds alive since the raid started. */
  readonly aliveSeconds: number;
  /** Bot-games that dealt no damage to anyone, player or mob. */
  readonly neverFought: number;
  readonly diedTo: { readonly bot: number; readonly mob: number; readonly arena: number };
  readonly reactions: readonly ReactionRow[];
  /** Plain-reaction stimuli pooled against the tier's mu + tau. */
  readonly pooled: { readonly n: number; readonly mean: number; readonly table: number; readonly ratio: number };
  readonly targetClicks: number;
  /** Lock clicks that picked nobody / the wrong fighter, per lock click. */
  readonly missRate: number;
  readonly wrongRate: number;
  /** Commands per minute alive, pooled over the tier's bot-games, and the per-game peak over 60 s (mean, max, limit, breaches). */
  readonly apmMean: number;
  readonly apmPeakMean: number;
  readonly apmPeakMax: number;
  readonly apmLimit: number;
  readonly apmBreaches: number;
  readonly dodgesPerBot: number;
  readonly jukesPerBot: number;
  readonly kiteCyclesPerBot: number;
  readonly hesitationsPerBot: number;
  readonly throttledPerBot: number;
  readonly maxStallMs: number;
  /** Bot-games whose longest stall passed STALL_LIMIT_MS (the e2e's bound). */
  readonly stalls: number;
}

export interface GroupAgg {
  readonly key: string;
  readonly botGames: number;
  readonly winRate: Proportion;
  readonly meanPlace: number;
  readonly killsPerBot: number;
}

export interface Report {
  readonly games: number;
  readonly decided: number;
  readonly draws: number;
  readonly capped: number;
  readonly duration: { readonly meanS: number; readonly p50S: number; readonly minS: number; readonly maxS: number };
  readonly firstDeathMedianS: number;
  readonly teleportShare: number;
  readonly suddenDeathShare: number;
  readonly refused: number;
  readonly lost: number;
  readonly errors: number;
  readonly tiers: readonly TierAgg[];
  readonly personas: readonly GroupAgg[];
  readonly factions: readonly GroupAgg[];
}

/** The e2e's stall bound (test/e2e.test.ts MAX_STALL_MS). */
export const STALL_LIMIT_MS = 8_000;

function group(key: string, rows: readonly BotGameSummary[]): GroupAgg {
  const wins = rows.filter((b) => b.outcome === "won").length;
  return {
    key,
    botGames: rows.length,
    winRate: wilson(wins, rows.length),
    meanPlace: mean(rows.map((b) => b.place)),
    killsPerBot: mean(rows.map((b) => b.kills)),
  };
}

function tierAgg(tier: TierId, games: readonly GameSummary[], totalWins: number): TierAgg {
  const rows: BotGameSummary[] = [];
  const perGamePlace: number[] = [];
  for (const g of games) {
    const mine = g.bots.filter((b) => b.tier === tier);
    if (mine.length === 0) continue;
    rows.push(...mine);
    perGamePlace.push(mean(mine.map((b) => b.place)));
  }
  const n = rows.length;
  const wins = rows.filter((b) => b.outcome === "won").length;
  const per = (f: (b: BotGameSummary) => number): number => (n === 0 ? NaN : sumOf(rows.map(f)) / n);

  const byKind = new Map<string, number[]>();
  for (const b of rows) {
    for (const [kind, samples] of Object.entries(b.behaviour.reactions)) {
      let list = byKind.get(kind);
      if (!list) byKind.set(kind, (list = []));
      for (const x of samples) list.push(x);
    }
  }
  const reactions: ReactionRow[] = [];
  const pool: number[] = [];
  for (const kind of [...byKind.keys()].sort()) {
    const xs = byKind.get(kind)!.sort((a, b) => a - b);
    reactions.push({
      kind, n: xs.length, p10: percentile(xs, 0.1), p50: percentile(xs, 0.5), p90: percentile(xs, 0.9), mean: mean(xs),
      table: tableReactionMean(tier, kind),
    });
    if (!SCALED_KINDS.has(kind)) for (const x of xs) pool.push(x);
  }
  const table = TIERS[tier].reaction.mu + TIERS[tier].reaction.tau;
  const pooledMean = mean(pool);

  const aliveMs = (g: GameSummary, b: BotGameSummary): number => b.diedAtMs ?? g.durationMs;
  let commands = 0;
  let aliveMin = 0;
  for (const g of games) {
    for (const b of g.bots) {
      if (b.tier !== tier) continue;
      commands += b.behaviour.commandsTotal;
      aliveMin += aliveMs(g, b) / 60_000;
    }
  }
  const apmLimit = TIERS[tier].apm + TIERS[tier].burst;
  const clicks = sumOf(rows.map((b) => b.behaviour.targetClicks));

  return {
    tier,
    botGames: n,
    wins,
    draws: rows.filter((b) => b.outcome === "draw").length,
    capped: rows.filter((b) => b.outcome === "capped").length,
    winRate: wilson(wins, n),
    shareOfWins: totalWins === 0 ? NaN : wins / totalWins,
    place: meanInterval(perGamePlace),
    killsPerBot: per((b) => b.kills),
    deathsPerBot: per((b) => b.deaths),
    damagePerBot: per((b) => b.damage),
    mobDamagePerBot: per((b) => b.mobDamage),
    mobKillsPerBot: per((b) => b.mobKills),
    gvPerBot: per((b) => b.gv),
    aliveSeconds: n === 0 ? NaN : sumOf(games.flatMap((g) => g.bots.filter((b) => b.tier === tier).map((b) => aliveMs(g, b)))) / n / 1000,
    neverFought: rows.filter((b) => b.damage === 0 && b.mobDamage === 0).length,
    diedTo: {
      bot: rows.filter((b) => b.diedTo === "bot").length,
      mob: rows.filter((b) => b.diedTo === "mob").length,
      arena: rows.filter((b) => b.diedTo === "arena").length,
    },
    reactions,
    pooled: { n: pool.length, mean: pooledMean, table, ratio: pooledMean / table },
    targetClicks: clicks,
    missRate: clicks === 0 ? NaN : sumOf(rows.map((b) => b.behaviour.clickMissed)) / clicks,
    wrongRate: clicks === 0 ? NaN : sumOf(rows.map((b) => b.behaviour.clickWrong)) / clicks,
    apmMean: aliveMin === 0 ? NaN : commands / aliveMin,
    apmPeakMean: per((b) => b.behaviour.apmPeak),
    apmPeakMax: rows.reduce((m, b) => Math.max(m, b.behaviour.apmPeak), 0),
    apmLimit,
    apmBreaches: rows.filter((b) => b.behaviour.apmPeak > apmLimit).length,
    dodgesPerBot: per((b) => b.behaviour.dodges),
    jukesPerBot: per((b) => b.behaviour.jukes),
    kiteCyclesPerBot: per((b) => b.behaviour.kiteCycles),
    hesitationsPerBot: per((b) => b.behaviour.hesitations),
    throttledPerBot: per((b) => b.behaviour.throttled),
    maxStallMs: rows.reduce((m, b) => Math.max(m, b.behaviour.maxStallMs), 0),
    stalls: rows.filter((b) => b.behaviour.maxStallMs > STALL_LIMIT_MS).length,
  };
}

export function aggregate(games: readonly GameSummary[]): Report {
  const all = games.flatMap((g) => g.bots);
  const totalWins = all.filter((b) => b.outcome === "won").length;
  const secs = games.map((g) => g.durationMs / 1000).sort((a, b) => a - b);
  const firstDeaths = games.flatMap((g) => (g.firstDeathMs === null ? [] : [g.firstDeathMs / 1000])).sort((a, b) => a - b);
  const share = (f: (g: GameSummary) => boolean): number => (games.length === 0 ? NaN : games.filter(f).length / games.length);
  const present = (tier: TierId): boolean => all.some((b) => b.tier === tier);
  return {
    games: games.length,
    decided: games.filter((g) => g.winner !== null).length,
    draws: games.filter((g) => g.draw).length,
    capped: games.filter((g) => !g.ended).length,
    duration: { meanS: mean(secs), p50S: percentile(secs, 0.5), minS: secs[0] ?? NaN, maxS: secs[secs.length - 1] ?? NaN },
    firstDeathMedianS: percentile(firstDeaths, 0.5),
    teleportShare: share((g) => g.teleportMs !== null),
    suddenDeathShare: share((g) => g.suddenDeathMs !== null),
    refused: sumOf(games.map((g) => g.manager.refused)),
    lost: sumOf(games.map((g) => g.manager.lost)),
    errors: sumOf(games.map((g) => g.manager.errors)),
    tiers: TIER_IDS.filter(present).map((t) => tierAgg(t, games, totalWins)),
    personas: PERSONA_IDS.map((p) => group(p, all.filter((b) => b.persona === p))).filter((g) => g.botGames > 0),
    factions: FACTION_IDS.map((f) => group(f, all.filter((b) => b.faction === f))).filter((g) => g.botGames > 0),
  };
}

// ================================================================================================================= criteria

export interface Criterion {
  /** null = not checkable on this data (a tier is missing). */
  readonly ok: boolean | null;
  readonly text: string;
}

const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : "-");
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : "-");
const f0 = (x: number): string => (Number.isFinite(x) ? String(Math.round(x)) : "-");
const pct = (x: number, d = 1): string => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "-");

/** Informational bands of 9.3: the starting win shares to tune toward. */
export const WIN_BANDS: Readonly<Record<TierId, readonly [number, number]>> = {
  hard: [0.25, 0.35], normal: [0.13, 0.2], easy: [0.04, 0.1],
};

export function evaluate(r: Report): Criterion[] {
  const by = new Map(r.tiers.map((t) => [t.tier, t]));
  const easy = by.get("easy");
  const normal = by.get("normal");
  const hard = by.get("hard");
  const out: Criterion[] = [];

  const order = (label: string, vals: Array<[string, number]>, higherIsBetter: boolean): void => {
    const have = vals.filter(([, v]) => Number.isFinite(v));
    if (have.length < 2) {
      out.push({ ok: null, text: `${label}: needs two tiers in the lineup` });
      return;
    }
    let ok = true;
    for (let i = 1; i < have.length; i++) ok &&= higherIsBetter ? have[i - 1]![1] > have[i]![1] : have[i - 1]![1] < have[i]![1];
    out.push({ ok, text: `${label}: ${have.map(([n, v]) => `${n} ${f2(v)}`).join(higherIsBetter ? " > " : " < ")}` });
  };
  const tiers = [hard, normal, easy].filter((t): t is TierAgg => t !== undefined);
  order("mean placement orders Hard < Normal < Easy (lower is better)", tiers.map((t) => [t.tier, t.place.mean]), false);
  order("win share orders Hard > Normal > Easy (per-bot)", tiers.map((t) => [t.tier, t.winRate.p]), true);
  // Non-overlapping 90% intervals of mean placement, between neighbouring tiers.
  for (let i = 1; i < tiers.length; i++) {
    const a = tiers[i - 1]!, b = tiers[i]!;
    out.push({
      ok: a.place.hi < b.place.lo,
      text: `mean-placement 90% intervals ${a.tier} [${f2(a.place.lo)}, ${f2(a.place.hi)}] and ${b.tier} [${f2(b.place.lo)}, ${f2(b.place.hi)}] do not overlap`,
    });
  }
  if (hard) out.push({ ok: hard.winRate.p <= 0.4, text: `Hard per-bot win share ${f2(hard.winRate.p)} <= 0.40` });
  if (easy) out.push({ ok: easy.winRate.p >= 0.03, text: `Easy per-bot win share ${f2(easy.winRate.p)} >= 0.03` });
  for (const t of tiers) {
    const [lo, hi] = WIN_BANDS[t.tier];
    out.push({ ok: t.winRate.p >= lo && t.winRate.p <= hi, text: `${t.tier} per-bot win share ${f2(t.winRate.p)} in the starting band ${lo.toFixed(2)}-${hi.toFixed(2)}` });
  }
  for (const t of [...tiers].reverse()) {
    out.push({
      ok: Number.isFinite(t.pooled.ratio) ? Math.abs(t.pooled.ratio - 1) <= 0.1 : null,
      text: `${t.tier} measured reaction mean ${f0(t.pooled.mean)} ms (n=${t.pooled.n}) within +-10% of the table's ${f0(t.pooled.table)} ms (ratio ${f2(t.pooled.ratio)})`,
    });
  }
  out.push({ ok: r.refused === 0, text: `zero commands refused by enqueueClientMessage (${r.refused})` });
  out.push({ ok: r.errors === 0, text: `zero brain errors (${r.errors})` });
  const breaches = sumOf(r.tiers.map((t) => t.apmBreaches));
  out.push({ ok: breaches === 0, text: `zero APM breaches (a 60 s window above the tier's apm + burst): ${breaches}` });
  out.push({ ok: r.capped === 0, text: `no game hit the 12-minute cap (${r.capped})` });
  const stalls = sumOf(r.tiers.map((t) => t.stalls));
  out.push({ ok: stalls === 0, text: `no bot stood stalled for more than ${STALL_LIMIT_MS / 1000} s (${stalls} bot-games)` });
  return out;
}

// ================================================================================================================= printing

const pad = (s: string, w: number): string => (s.length >= w ? s : s + " ".repeat(w - s.length));
const lpad = (s: string, w: number): string => (s.length >= w ? s : " ".repeat(w - s.length) + s);

/** Rows as a left-aligned first column and right-aligned others. */
function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: readonly string[]): string => r.map((c, i) => (i === 0 ? pad(c, w[i]!) : lpad(c, w[i]!))).join("  ").trimEnd();
  return [line(head), line(w.map((n) => "-".repeat(n))), ...rows.map(line)];
}

const interval = (p: Proportion): string => `${pct(p.p)} [${pct(p.lo)}, ${pct(p.hi)}]`;

export interface ReportMeta {
  readonly lineup: string;
  readonly seed: number;
  readonly learn: boolean;
  readonly persona: string;
  readonly faction: string;
  readonly workers: number;
  /** Wall time of the whole run, ms (null when the report is of stored games). */
  readonly wallMs: number | null;
  /** Mean wall time of one game inside its worker, ms (the rate without the workers' start-up). */
  readonly gameMs: number | null;
}

export function formatReport(r: Report, meta: ReportMeta): string {
  const L: string[] = [];
  const simTotalS = r.duration.meanS * r.games;
  L.push(`TOURNAMENT  ${r.games} games  lineup ${meta.lineup}  seed ${meta.seed}  persona ${meta.persona}  faction ${meta.faction}  learning ${meta.learn ? "on (per worker, in memory)" : "off"}`);
  L.push(`games: ${r.decided} with a winner, ${r.draws} draws, ${r.capped} cut off at the cap`);
  L.push(`length: mean ${f1(r.duration.meanS)} s, median ${f1(r.duration.p50S)} s, min ${f1(r.duration.minS)} s, max ${f1(r.duration.maxS)} s (simulated, raid start to end)`);
  L.push(`first death: median ${f1(r.firstDeathMedianS)} s into the raid; teleport in ${pct(r.teleportShare, 0)} of games, sudden death in ${pct(r.suddenDeathShare, 0)}`);
  if (meta.wallMs !== null && meta.wallMs > 0) {
    const sec = meta.wallMs / 1000;
    L.push(`throughput: ${r.games} games in ${f1(sec)} s wall = ${f2(r.games / sec)} games/s with ${meta.workers} worker${meta.workers === 1 ? "" : "s"} (${f1(simTotalS / sec)} simulated s per wall s)`);
    if (meta.gameMs !== null) {
      L.push(`per game: ${f0(meta.gameMs)} ms of wall in a worker on average (${f1(r.duration.meanS * 1000 / meta.gameMs)} simulated s per wall s per worker, so ${f1(1000 / meta.gameMs)} games/s per worker once started)`);
    }
  }
  L.push("");

  L.push("PER TIER  (a bot-game is one bot in one game; win/bot = wins per bot-game, Wilson 95%; place = mean of the tier's placements per game, 90% interval)");
  L.push(...table(
    ["tier", "bot-games", "wins", "win/bot [95%]", "share of wins", "draws", "place [90%]", "kills", "deaths", "dmg", "mob dmg", "mob kills", "gv", "alive s"],
    r.tiers.map((t) => [
      t.tier, String(t.botGames), String(t.wins), interval(t.winRate), pct(t.shareOfWins), String(t.draws),
      `${f2(t.place.mean)} [${f2(t.place.lo)}, ${f2(t.place.hi)}]`, f2(t.killsPerBot), f2(t.deathsPerBot), f0(t.damagePerBot),
      f0(t.mobDamagePerBot), f2(t.mobKillsPerBot), f1(t.gvPerBot), f1(t.aliveSeconds),
    ]),
  ));
  L.push("(kills, deaths, dmg, mob dmg, mob kills, gv are per bot-game; dmg is damage to players, from the hit fx)");
  L.push("");

  L.push("HOW THEY DIED  (bot-games; a bot that won or was cut off is in none)");
  L.push(...table(
    ["tier", "to a bot", "to a mob", "to sudden death", "never fought"],
    r.tiers.map((t) => [t.tier, String(t.diedTo.bot), String(t.diedTo.mob), String(t.diedTo.arena), String(t.neverFought)]),
  ));
  L.push("");

  L.push("REACTION DELAYS  (ms from the percept that first showed the stimulus to the click; the last 256 per bot, pooled)");
  L.push("table = the tier's mu + tau (daze for a teleport, x1.5 for reading); newThreat, teleport and reading are further scaled by attention");
  for (const t of r.tiers) {
    L.push(...table(
      [`${t.tier}`, "n", "p10", "p50", "p90", "mean", "table", "ratio"],
      [
        ...t.reactions.map((x) => [x.kind, String(x.n), f0(x.p10), f0(x.p50), f0(x.p90), f0(x.mean), f0(x.table), f2(x.mean / x.table)]),
        ["pooled (plain)", String(t.pooled.n), "", "", "", f0(t.pooled.mean), f0(t.pooled.table), f2(t.pooled.ratio)],
      ],
    ));
    L.push("");
  }

  L.push("CLICKS, RATE AND MANEUVERS  (per bot-game unless stated)");
  L.push(...table(
    ["tier", "lock clicks", "miss", "wrong", "APM mean", "APM peak mean", "peak max", "limit", "breaches", "dodges", "jukes", "orb-walk cycles", "hesitations", "throttled", "max stall ms"],
    r.tiers.map((t) => [
      t.tier, String(t.targetClicks), pct(t.missRate), pct(t.wrongRate), f1(t.apmMean), f1(t.apmPeakMean), String(t.apmPeakMax),
      String(t.apmLimit), String(t.apmBreaches), f2(t.dodgesPerBot), f2(t.jukesPerBot), f2(t.kiteCyclesPerBot), f2(t.hesitationsPerBot),
      f2(t.throttledPerBot), String(t.maxStallMs),
    ]),
  ));
  L.push("(miss / wrong are per lock click; the table's lone-bot rates: easy ~7.4% / normal ~1.2% / hard ~0.2% misses; move-scatter RMS is not measured)");
  L.push("");

  for (const [title, groups] of [["PER PERSONA", r.personas], ["PER FACTION", r.factions]] as const) {
    L.push(title);
    L.push(...table(
      ["", "bot-games", "win/bot [95%]", "mean place", "kills"],
      groups.map((g) => [g.key, String(g.botGames), interval(g.winRate), f2(g.meanPlace), f2(g.killsPerBot)]),
    ));
    L.push("");
  }

  L.push(`MANAGER  refused ${r.refused}, lost ${r.lost}, brain errors ${r.errors}`);
  L.push("");
  L.push("CRITERIA  (informational; the tool exits 0)");
  for (const c of evaluate(r)) L.push(`  ${c.ok === null ? "n/a " : c.ok ? "PASS" : "FAIL"}  ${c.text}`);
  return L.join("\n");
}
