import { CARDS, cardRows } from "../../packages/shared/src/cards.ts";
import { f64, fromF64 } from "./float.ts";
import {
  BOOST_STATS, CONVERT_FROMS, CONVERT_TOS, EFFECT_FLAGS, MULT_KEYS, PRESET_COUNTS, STAT_KEYS, WHILE_CONDS,
  parseCaseSpec, semanticKey,
  type BoostStat, type CaseInput, type CaseKind, type CaseSpec, type ConvertFrom, type FoldInput, type MultKey, type Origin,
  type Preset, type Row, type SourceInput, type StatKey,
} from "./schema.ts";

const f = f64;
const SOURCE = (): SourceInput => ({ asMult: f(1), speedMult: f(1), windupMult: f(1), armor: f(0), shield: f(0) });
const FLAT_STATS = new Set<StatKey>(["armor", "shield", "ad", "ap"]);
const statRow = (stat: StatKey, v = 0.125): Row => FLAT_STATS.has(stat)
  ? { k: "flat", stat: stat as "armor" | "shield" | "ad" | "ap", v: f(v) }
  : { k: "stat", stat: stat as Exclude<StatKey, "armor" | "shield" | "ad" | "ap">, v: f(v) };
const whileRow = (cond: (typeof WHILE_CONDS)[number], stat: StatKey = "attackSpeed", v = 0.25): Row => ({
  k: "while", cond, arg: f(cond === "hpBelow" ? 0.5 : cond === "fightTime" ? 3 : 0), stat, v: f(v), ...(cond === "notShooting" || cond === "afterCast" ? { ms: f(500) } : {}),
});
const convertRow = (from: ConvertFrom, to: (typeof CONVERT_TOS)[number], per = 0.25, cap?: number): Row => ({
  k: "convert", from, to, per: f(per), ...(cap === undefined ? {} : { cap: f(cap) }),
});
const multRow = (key: MultKey, v = 1.5): Row => ({ k: "mult", key, v: f(v) });
const flagRow = (flag: (typeof EFFECT_FLAGS)[number]): Row => ({ k: "flag", flag });
const answers = (rows: Row[], value: boolean | Array<boolean | null> = true): Array<boolean | null> => Array.isArray(value)
  ? value
  : rows.map((row) => row.k === "while" ? value : null);
const allRequirements = (rows: Row[]): string[] => [...new Set(rows.flatMap((row) => row.requires ?? []))];

interface FoldOptions {
  farmRows?: Row[];
  holds?: boolean | Array<boolean | null>;
  farmHolds?: boolean | Array<boolean | null>;
  owned?: string[] | null;
  baseMaxHp?: number | null;
  boosts?: Array<number | null> | null;
  source?: SourceInput;
  farmAsEfficiency?: number;
}
function foldInput(rows: Row[], options: FoldOptions = {}): FoldInput {
  const farmRows = options.farmRows ?? [];
  return {
    rows, farmRows, holds: answers(rows, options.holds ?? true), farmHolds: answers(farmRows, options.farmHolds ?? true),
    owned: options.owned === undefined ? allRequirements([...rows, ...farmRows]) : options.owned,
    baseMaxHp: options.baseMaxHp === null ? null : f(options.baseMaxHp ?? 1000),
    boosts: options.boosts === null || options.boosts === undefined ? options.boosts ?? null : options.boosts.map((picks) => picks === null ? null : f(picks)),
    source: options.source ?? SOURCE(), farmAsEfficiency: f(options.farmAsEfficiency ?? 1),
  };
}
function mix32(value: number): number {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}
function rowTags(rows: Row[], holds: Array<boolean | null>, prefix = ""): string[] {
  const tags: string[] = [];
  rows.forEach((row, index) => {
    switch (row.k) {
      case "stat": case "flat": tags.push(`${prefix}stat:${row.stat}`); break;
      case "while": tags.push(`${prefix}stat:${row.stat}`, `${prefix}while:${row.cond}:${holds[index] ? "true" : "false"}`); break;
      case "mult": tags.push(`${prefix}mult:${row.key}`); break;
      case "flag": tags.push(`${prefix}flag:${row.flag}`); break;
      case "convert": tags.push(`${prefix}convert-source:${row.from}`, `${prefix}convert-target:${row.to}`); break;
      case "vs": tags.push(`${prefix}ignored:vs`); break;
      case "scale": tags.push(`${prefix}ignored:scale`); break;
      case "onHit": tags.push(`${prefix}ignored:onHit`); break;
      case "trigger": tags.push(`${prefix}ignored:trigger`, `${prefix}trigger-action:${row.do.do}`); break;
    }
    if (row.requires === undefined) tags.push(`${prefix}requirements:absent`);
    else if (row.requires.length === 0) tags.push(`${prefix}requirements:empty`);
  });
  return tags;
}
const unique = (tags: string[]): string[] => [...new Set(tags)];

class Builder {
  readonly cases: CaseSpec[] = [];
  private readonly semantics = new Set<string>();
  constructor(readonly preset: Preset) {}
  add(kind: CaseKind, input: CaseInput["input"], label: string, tags: string[] = [], origin?: Origin, rejectDuplicate = true): boolean {
    const semantic = semanticKey({ kind, input } as CaseInput);
    if (this.semantics.has(semantic)) {
      if (rejectDuplicate) throw new Error(`semantic duplicate at ${label}`);
      return false;
    }
    const index = this.cases.length;
    const spec = {
      id: `${this.preset}-${index.toString().padStart(5, "0")}`,
      seed: mix32((this.preset === "canonical" ? 0x1f0d : this.preset === "ci" ? 0xc141 : 0x50a4) + index),
      origin: origin ?? { kind: "synthetic", label }, tags: unique([`kind:${kind}`, ...tags]), kind, input,
    } as CaseSpec;
    parseCaseSpec(spec);
    this.semantics.add(semantic); this.cases.push(spec); return true;
  }
  fold(label: string, rows: Row[], options: FoldOptions = {}, tags: string[] = [], origin?: Origin): void {
    const input = foldInput(rows, options);
    this.add("fold", input, label, [...tags, ...rowTags(rows, input.holds), ...rowTags(input.farmRows, input.farmHolds, "farm:")], origin);
  }
  statFold(label: string, rows: Row[], holds: boolean | Array<boolean | null> = true, owned?: string[] | null, tags: string[] = [], origin?: Origin): void {
    const input = { rows, holds: answers(rows, holds), owned: owned === undefined ? allRequirements(rows) : owned };
    this.add("statFold", input, label, [...tags, ...rowTags(rows, input.holds)], origin);
  }
}

function sourceRows(from: ConvertFrom): Row[] {
  switch (from) {
    case "ad": return [statRow("ad", 40)];
    case "maxHp": return [statRow("maxHp", 0.2)];
    case "bonusAttackSpeed": return [statRow("attackSpeed", 0.2)];
    case "bonusMoveSpeed": return [statRow("moveSpeed", 0.2)];
  }
}
function ignoredRows(): Row[] {
  return [
    { k: "vs", test: "hpAbove", arg: f(0.25), v: f(0.5), requires: ["ignored"] },
    { k: "scale", src: "ownMissingHp", per: f(0.01), step: f(0.1), cap: f(0.4) },
    { k: "onHit", status: "slowAttack", per: f(0.03), cap: f(0.15), ms: f(2000), needs: "status" },
    { k: "trigger", on: "hpBelow", arg: f(0.25), once: true, rearm: "teleport", do: { do: "heal", share: f(0.2), ignoreLockout: true, ms: f(1500) } },
    { k: "trigger", on: "hit", arg: f(0), do: { do: "status", to: "target", status: "stun", ms: f(100), value: f(0.2) } },
    { k: "trigger", on: "hitTaken", arg: f(0), do: { do: "cleanse", to: "self", classes: ["soft", "hard", "never"] } },
    { k: "trigger", on: "block", arg: f(0), do: { do: "barrier", share: f(0.1), ms: f(1000) } },
    { k: "trigger", on: "hit", arg: f(0), do: { do: "cooldown", ms: f(1000) } },
    { k: "trigger", on: "hitTaken", arg: f(0.1), do: { do: "boost", as: f(0.4), move: f(0.4), ms: f(2000) } },
    { k: "trigger", on: "hitTaken", arg: f(0), do: { do: "return", share: f(0.15), melee: true } },
    { k: "trigger", on: "block", arg: f(0), do: { do: "fortify", per: f(1), cap: f(250) } },
    { k: "trigger", on: "kill", arg: f(0), do: { do: "splash", radius: f(200) } },
  ];
}
function addCanonical(builder: Builder): void {
  for (const card of CARDS) {
    const variants: Array<string | null> = [null, ...Object.keys(card.byFaction ?? {})];
    for (const faction of variants) {
      const rows = cardRows(card.id, faction ?? undefined).map((row) => structuredClone(row)) as unknown as Row[];
      for (const row of rows) wrapRowNumbers(row);
      const origin: Origin = { kind: "card", cardId: card.id, faction };
      const cardTag = `card:${card.id}:${faction ?? "default"}`;
      builder.fold(`actual card ${card.id} ${faction ?? "default"}`, rows, { owned: null }, [cardTag, faction === null ? "card:default" : "card:faction"], origin);
      builder.statFold(`actual card stat fold ${card.id} ${faction ?? "default"}`, rows, true, null, [cardTag, faction === null ? "card:default" : "card:faction"], origin);
    }
  }

  builder.fold("identity", [], { baseMaxHp: null }, ["identity"]);
  for (const stat of STAT_KEYS) builder.fold(`single stat ${stat}`, [statRow(stat)], {}, ["coverage:single-stat"]);
  builder.fold("product stat source order", [statRow("lifestealMult", 1), statRow("lifestealMult", 0.5), statRow("lifestealMult", -0.25)], {}, ["row-order", "product-stat"]);
  for (const key of MULT_KEYS) builder.fold(`single mult ${key}`, [multRow(key)], {}, ["coverage:single-mult"]);
  builder.fold("flags first insertion and duplicate", [flagRow("noCrit"), flagRow("lockSecondSlot"), flagRow("noCrit"), ...EFFECT_FLAGS.slice(2).map(flagRow)], {}, ["flags:first-insertion"]);

  const requirementRow: Row = { ...statRow("damage", 0.1), requires: ["alpha", "beta"] };
  const requirementCases: Array<[string, Row, string[] | null, string]> = [
    ["absent", statRow("damage"), null, "requirements:absent"],
    ["empty", { ...statRow("damage"), requires: [] }, null, "requirements:empty"],
    ["missing ownership", requirementRow, null, "requirements:missing"],
    ["none owned", requirementRow, [], "requirements:none"],
    ["partly owned", requirementRow, ["alpha"], "requirements:partly"],
    ["all owned", requirementRow, ["beta", "alpha"], "requirements:all"],
  ];
  for (const [label, row, owned, tag] of requirementCases) builder.add("requirements", { row, owned }, `requirements ${label}`, [tag]);
  builder.fold("nonempty requirements default false", [requirementRow], { owned: null }, ["requirements:missing"]);
  builder.fold("empty requirements with missing ownership", [{ ...statRow("ap", 12), requires: [] }], { owned: null }, ["requirements:empty"]);

  for (const cond of WHILE_CONDS) for (const holds of [false, true]) {
    const row = whileRow(cond);
    builder.fold(`while ${cond} ${holds}`, [row], { holds: [holds] }, [`while:${cond}:${holds}`]);
  }
  builder.fold("while answers are row-location-specific", [whileRow("hpBelow", "ad", 10), statRow("attackSpeed", 0.1), whileRow("hpBelow", "ap", 20)], {
    holds: [true, null, false],
  }, ["row-order", "while:location"]);
  builder.fold("while answers reverse at the same locations", [whileRow("hpBelow", "ad", 10), statRow("attackSpeed", 0.1), whileRow("hpBelow", "ap", 20)], {
    holds: [false, null, true],
  }, ["row-order", "while:location"]);

  for (const from of CONVERT_FROMS) for (const to of CONVERT_TOS) {
    builder.fold(`conversion ${from} to ${to}`, [...sourceRows(from), convertRow(from, to)], {}, [
      `convert-source:${from}`, `convert-target:${to}`, ...(to === "lifestealMult" ? ["convert:no-op-product"] : []),
    ]);
  }
  builder.fold("conversion one-pass chain", [statRow("ad", 40), statRow("attackSpeed", 0.2), convertRow("bonusAttackSpeed", "ad", 100), convertRow("ad", "armor", 0.25)], {}, ["conversion:one-pass"]);
  builder.fold("conversion per-row caps before aggregate", [statRow("ad", 100), convertRow("ad", "ap", 1, 30), convertRow("ad", "ap", 1, 50)], {}, ["cap:conversion-row", "cap:conversion-aggregate"]);

  builder.fold("all ignored variants with complete payloads", ignoredRows(), { owned: null }, ["ignored:validated"]);
  builder.statFold("convert mult flag rows ignored by stat fold", [convertRow("ad", "ap"), multRow("ap", 2), flagRow("noCrit")], true, [], ["statFold:ignored-fold-rows"]);
  builder.fold("farm convert mult flag rows ignored", [], { farmRows: [convertRow("ad", "ap"), multRow("ap", 2), flagRow("noCrit")] }, ["farm:ignored-fold-rows"]);

  for (const stat of ["armor", "shield"] as const) for (const value of [199.999999, 200, 200.000001]) {
    builder.fold(`defense cap ${stat} ${value}`, [statRow(stat, value)], {}, ["cap:defense"]);
  }
  for (const value of [0.299999999, 0.3, 0.300000001, -0.2]) builder.fold(`move cap ${value}`, [statRow("moveSpeed", value)], {}, ["cap:move"]);
  for (const per of [1.49999999, 1.5, 1.50000001]) builder.fold(`conversion aggregate cap ${per}`, [statRow("ad", 40), convertRow("ad", "ap", per)], {}, ["cap:conversion-aggregate"]);
  for (const value of [0.49, 0.5, 0.51, 1.99, 2, 2.01, Number.NaN, -1]) builder.fold(`asPost guard ${value}`, [multRow("asPost", value)], {}, ["cap:asPost"]);
  for (const [key, value] of [["hit", 2.500001], ["wishCooldown", 0.499999], ["hpRace", 2.500001], ["linger", -2]] as Array<[MultKey, number]>) {
    builder.fold(`mult guard ${key}`, [multRow(key, value)], {}, [`cap:${key}`]);
  }
  for (const value of [-0.499999, -0.5, -0.500001]) builder.fold(`max hp floor ${value}`, [statRow("maxHp", value)], { baseMaxHp: 1000 }, ["cap:maxHp"]);
  builder.fold("cap attack speed before asPost", [statRow("attackSpeed", 1), multRow("asPost", 2)], { source: { ...SOURCE(), asMult: f(0.75) } }, ["cap:before-asPost", "source"]);
  builder.fold("farm rows outside card ceiling", [statRow("attackSpeed", 1), statRow("armor", 300), multRow("ap", 1.5)], {
    farmRows: [statRow("attackSpeed", 2), statRow("armor", 1000), statRow("ap", 100)],
    source: { ...SOURCE(), asMult: f(0.5), armor: f(40) },
  }, ["farm", "source", "farm:outside-cap"]);
  builder.fold("boost gains share one pre-boost sheet", [statRow("ad", 25), statRow("ap", 25)], {
    boosts: BOOST_STATS.map((stat) => stat === "ad" || stat === "ap" ? 2 : null),
  }, ["boost", "boost:pre-sheet"]);
  builder.fold("farm boost source combination", [statRow("attackSpeed", 0.8), statRow("ad", 25)], {
    farmRows: [statRow("attackSpeed", 0.2), statRow("ad", 5)], boosts: BOOST_STATS.map((stat) => stat === "attackSpeed" || stat === "ad" ? 1 : null),
    source: { asMult: f(0.75), speedMult: f(1.1), windupMult: f(0.9), armor: f(20), shield: f(-10) }, farmAsEfficiency: 0.5,
  }, ["farm", "boost", "source", "farm-boost-source"]);
  for (const efficiency of [0, 0.5, 1, -1, Number.NaN, Number.POSITIVE_INFINITY, -0]) {
    builder.fold(`farm efficiency ${efficiency}`, [statRow("attackSpeed", 0.5)], { farmRows: [statRow("attackSpeed", 0.25), statRow("moveSpeed", -0.1)], farmAsEfficiency: efficiency }, ["farm:efficiency"]);
  }
  builder.fold("NaN propagation through source Math.min and max", [statRow("armor", 10), convertRow("bonusMoveSpeed", "damage", Number.NaN)], {
    source: { ...SOURCE(), armor: f(Number.NaN) },
  }, ["special:nonfinite", "special:js-min-max"]);
  builder.fold("signed zero inputs", [statRow("attackSpeed", -0), statRow("ad", -0)], {
    baseMaxHp: -0, source: { asMult: f(-0), speedMult: f(-0), windupMult: f(-0), armor: f(-0), shield: f(-0) }, farmAsEfficiency: -0,
  }, ["special:signed-zero"]);

  const boostPicks = [Number.NEGATIVE_INFINITY, -1, -0, 0, 0.9, 1, 1.9, 2, 2.9, 3, 4, Number.POSITIVE_INFINITY, Number.NaN];
  for (const picks of boostPicks) builder.add("boostBonus", { picks: f(picks) }, `boost bonus ${picks}`, ["boost:bonus"]);
  for (const stat of BOOST_STATS) for (const [picks, current] of [[0, 0], [1, 0], [2, 25], [3, 1000], [9, 25], [Number.NaN, 25], [1, Number.NaN], [1, Number.POSITIVE_INFINITY]] as Array<[number, number]>) {
    builder.add("boostGain", { stat, picks: f(picks), current: f(current) }, `boost gain ${stat} ${picks} ${current}`, ["boost:gain", `boost:${stat}`]);
  }

  const special = [
    Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -0, Number.MIN_VALUE, -Number.MIN_VALUE,
    0.0495, 0.05, 0.0505, 1.2345, 1.2355, -0.05, -0.06, -7.86, 7.86, 1e9,
    Number.MAX_VALUE / 1000, Number.MAX_VALUE / 10, Number.MAX_VALUE,
  ];
  for (const kind of ["multCodec", "flatCodec"] as const) {
    for (const value of special) builder.add(kind, { value: f(value), wire: f(value) }, `${kind} ${value}`, [
      "codec:special", ...(Number.isFinite(value) ? [] : ["codec:nonfinite"]), ...(Math.abs(value) === Number.MAX_VALUE ? ["codec:overflow"] : []),
    ]);
    builder.add(kind, { value: null, wire: null }, `${kind} missing`, ["codec:missing"]);
    builder.add(kind, { value: f(kind === "multCodec" ? 1.2345 : -0.05), wire: f(50) }, `${kind} half-up tie`, ["codec:ties"]);
  }
  builder.add("mirrors", {
    values: [1, 1, 1, 0, 0, 0, 0].map(f), wire: [1000, 1000, 1000, 0, 0, 0, 0].map(f),
  }, "complete identity mirrors", ["mirrors:identity"]);
  builder.add("mirrors", {
    values: [0.75, 1.12, 1.3, 12.3, -4, 33, 7.86].map(f), wire: [750, 1120, 1300, 123, -40, 330, 79].map(f),
  }, "complete ordinary mirrors", ["mirrors:ordinary"]);
  builder.add("mirrors", {
    values: [Number.NaN, Number.POSITIVE_INFINITY, -0, -0.05, Number.MAX_VALUE, Number.NEGATIVE_INFINITY, Number.MIN_VALUE].map(f),
    wire: [null, Number.NaN, Number.POSITIVE_INFINITY, null, -0, Number.MAX_VALUE, Number.NEGATIVE_INFINITY].map((value) => value === null ? null : f(value)),
  }, "complete special and missing mirrors", ["mirrors:special", "codec:missing", "codec:nonfinite", "special:signed-zero"]);
}

function wrapRowNumbers(row: Row): void {
  const wrap = (value: unknown): unknown => typeof value === "number" ? f(value) : Array.isArray(value) ? value.map(wrap) : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, wrap(entry)])) : value;
  for (const [key, value] of Object.entries(row)) {
    if (key !== "k" && key !== "requires" && key !== "needs") (row as unknown as Record<string, unknown>)[key] = wrap(value);
  }
}

class Random {
  constructor(private state: number) {}
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let x = this.state;
    x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number { return Math.floor(this.next() * n); }
  pick<T>(values: readonly T[]): T { return values[this.int(values.length)]; }
  bool(): boolean { return this.next() < 0.5; }
  number(): number {
    if (this.int(12) === 0) return this.pick([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE]);
    return this.pick([-1, -0.5, -0.05, 0, 0.0495, 0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 2.5, 10, 25, 60, 200, 1000]) + this.next() * 0.0001;
  }
}
function randomRow(random: Random): Row {
  const common = random.int(4) === 0 ? { requires: Array.from({ length: random.int(3) }, () => random.pick(["alpha", "beta", "gamma"])) } : {};
  switch (random.int(10)) {
    case 0: return { ...statRow(random.pick(STAT_KEYS.filter((key) => !FLAT_STATS.has(key))), random.number()), ...common } as Row;
    case 1: return { ...statRow(random.pick(["armor", "shield", "ad", "ap"] as const), random.number()), ...common };
    case 2: return { ...whileRow(random.pick(WHILE_CONDS), random.pick(STAT_KEYS), random.number()), ...common };
    case 3: return { ...convertRow(random.pick(CONVERT_FROMS), random.pick(CONVERT_TOS), random.number(), random.bool() ? random.number() : undefined), ...common };
    case 4: return { ...multRow(random.pick(MULT_KEYS), random.number()), ...common };
    case 5: return { ...flagRow(random.pick(EFFECT_FLAGS)), ...common };
    case 6: return { k: "vs", test: "hpBelow", arg: f(random.number()), v: f(random.number()), ...common };
    case 7: return { k: "scale", src: random.pick(["ownMissingHp", "campsCleared", "streak"] as const), per: f(random.number()), step: f(random.number()), ...common };
    case 8: return { k: "onHit", status: random.pick(["slowMove", "slowAttack", "antiHeal", "dot"] as const), per: f(random.number()), cap: f(random.number()), ms: f(random.number()), ...common };
    default: return { k: "trigger", on: random.pick(["hpBelow", "kill", "hitTaken", "hit", "block"] as const), arg: f(random.number()), do: { do: "heal", share: f(random.number()) }, ...common };
  }
}
function randomInput(random: Random, kind: CaseKind): CaseInput["input"] {
  switch (kind) {
    case "fold": case "statFold": {
      const rows = Array.from({ length: random.int(8) }, () => randomRow(random));
      const owned = random.int(5) === 0 ? null : ["alpha", "beta", "gamma"].filter(() => random.bool());
      if (kind === "statFold") return { rows, holds: answers(rows, rows.map((row) => row.k === "while" ? random.bool() : null)), owned };
      const farmRows = Array.from({ length: random.int(4) }, () => randomRow(random));
      const boosts = random.int(3) === 0 ? null : BOOST_STATS.map(() => random.bool() ? null : random.pick([0, 1, 2, 3, 4, -1, 1.5, Number.NaN]));
      const source: SourceInput = { asMult: f(random.number()), speedMult: f(random.number()), windupMult: f(random.number()), armor: f(random.number()), shield: f(random.number()) };
      return foldInput(rows, {
        farmRows, holds: rows.map((row) => row.k === "while" ? random.bool() : null), farmHolds: farmRows.map((row) => row.k === "while" ? random.bool() : null),
        owned, baseMaxHp: random.bool() ? random.number() : null, boosts, source, farmAsEfficiency: random.number(),
      });
    }
    case "requirements": return { row: randomRow(random), owned: random.bool() ? null : ["alpha", "beta"].filter(() => random.bool()) };
    case "boostBonus": return { picks: f(random.number()) };
    case "boostGain": return { stat: random.pick(BOOST_STATS), picks: f(random.number()), current: f(random.number()) };
    case "multCodec": case "flatCodec": return { value: random.bool() ? f(random.number()) : null, wire: random.bool() ? f(random.number()) : null };
    case "mirrors": return {
      values: Array.from({ length: 7 }, () => random.bool() ? f(random.number()) : null),
      wire: Array.from({ length: 7 }, () => random.bool() ? f(random.number()) : null),
    };
  }
}

export function coverageRequirements(): string[] {
  return [
    ...STAT_KEYS.map((key) => `stat:${key}`), ...MULT_KEYS.map((key) => `mult:${key}`), ...EFFECT_FLAGS.map((flag) => `flag:${flag}`),
    ...CONVERT_FROMS.map((from) => `convert-source:${from}`), ...CONVERT_TOS.map((to) => `convert-target:${to}`),
    ...WHILE_CONDS.flatMap((cond) => [`while:${cond}:true`, `while:${cond}:false`]),
    "requirements:absent", "requirements:empty", "requirements:missing", "requirements:none", "requirements:partly", "requirements:all",
    "row-order", "conversion:one-pass", "cap:before-asPost", "cap:defense", "cap:move", "cap:conversion-row",
    "cap:conversion-aggregate", "cap:asPost", "cap:hit", "cap:wishCooldown", "cap:hpRace", "cap:linger", "cap:maxHp",
    "farm", "boost", "source", "farm:outside-cap", "boost:pre-sheet", "farm-boost-source", "farm:efficiency",
    "flags:first-insertion", "convert:no-op-product", "statFold:ignored-fold-rows", "farm:ignored-fold-rows", "ignored:validated",
    "codec:ties", "codec:overflow", "codec:missing", "codec:nonfinite", "special:signed-zero", "special:js-min-max", "mirrors:special",
    ...(["fold", "statFold", "requirements", "boostBonus", "boostGain", "multCodec", "flatCodec", "mirrors"] as const).map((kind) => `kind:${kind}`),
    ...CARDS.flatMap((card) => [
      `card:${card.id}:default`, ...Object.keys(card.byFaction ?? {}).map((faction) => `card:${card.id}:${faction}`),
    ]),
  ];
}

export function generateInventory(preset: Preset): CaseSpec[] {
  const builder = new Builder(preset);
  addCanonical(builder);
  const target = preset === "canonical" ? builder.cases.length : PRESET_COUNTS[preset];
  const random = new Random(preset === "ci" ? 0xc1c1c1 : 0x50a41000);
  const kinds: CaseKind[] = ["fold", "statFold", "requirements", "boostBonus", "boostGain", "multCodec", "flatCodec", "mirrors"];
  let attempts = 0;
  while (builder.cases.length < target) {
    const kind = kinds[builder.cases.length % kinds.length];
    builder.add(kind, randomInput(random, kind), `generated ${preset} ${attempts}`, ["generated"], undefined, false);
    attempts += 1;
    if (attempts > target * 100) throw new Error(`${preset}: inventory generation did not converge`);
  }
  const required = coverageRequirements();
  const tags = new Set(builder.cases.flatMap((testCase) => testCase.tags));
  const missing = required.filter((tag) => !tags.has(tag));
  if (missing.length > 0) throw new Error(`${preset}: missing coverage ${missing.join(", ")}`);
  if (preset !== "canonical" && builder.cases.length !== PRESET_COUNTS[preset]) throw new Error(`${preset}: wrong case count`);
  return builder.cases;
}

export function coverageFor(cases: readonly CaseSpec[]): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const testCase of cases) for (const tag of testCase.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return coverageRequirements().map((id) => {
    const count = counts.get(id) ?? 0;
    if (count === 0) throw new Error(`coverage requirement ${id} has no case`);
    return { id, count };
  });
}

/** Ephemeral runner batches are slices of the same full inventory; no batch is checked in wholesale. */
export function inventoryBatch(preset: Exclude<Preset, "canonical">, offset: number, count: number): CaseSpec[] {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(count) || count <= 0) throw new Error("invalid batch bounds");
  const total = PRESET_COUNTS[preset];
  if (offset >= total || count > total - offset) throw new Error("batch outside preset inventory");
  return generateInventory(preset).slice(offset, offset + count);
}
