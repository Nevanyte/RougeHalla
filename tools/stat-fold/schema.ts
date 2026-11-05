import { isF64, type F64 } from "./float.ts";

export const FORMAT = "rh-stat-fold/1";
export const BASE_COMMIT = "de6f1c196f9b6a42e50dfdf19327d72bd3683fc8";
export const PRESET_COUNTS = { ci: 4096, soak: 10000 } as const;

/** Numeric records are arrays in these source orders, never JSON objects keyed by stat. */
export const STAT_KEYS = [
  "maxHp", "attackSpeed", "moveSpeed", "damage", "windup", "lifesteal", "markRate", "healTaken", "damageTaken", "cooldown",
  "executeBand", "slowResist", "lifestealMult", "lifestealDot", "critChance", "healBarrier", "armor", "shield", "ad", "ap",
] as const;
export const MULT_KEYS = ["asPost", "hit", "dot", "returned", "ap", "wishCooldown", "hpRace", "linger"] as const;
export const EFFECT_FLAGS = [
  "lockSecondSlot", "noCrit", "dotCrit", "plagueDotCritConversion", "gambler", "thirdCharm", "eyeForAnEye", "twiceUnarmed",
  "blockHits", "plantFeet", "festering", "heavierSentence", "swiftJudgment", "gallowsPatience", "noCommutation", "finalVerdict",
] as const;
export const CONVERT_FROMS = ["ad", "maxHp", "bonusAttackSpeed", "bonusMoveSpeed"] as const;
export const CONVERT_TOS = STAT_KEYS.filter((key) => key !== "maxHp") as unknown as readonly [Exclude<StatKey, "maxHp">];
export const MIRROR_FIELDS = ["asMult", "windupMult", "speedMult", "armorBonus", "shieldBonus", "adBonus", "apBonus"] as const;
export const BOOST_STATS = ["ad", "ap", "armor", "shield", "maxHp", "attackSpeed", "moveSpeed", "lifesteal"] as const;
export const WHILE_CONDS = ["chasingLock", "hpBelow", "afterCast", "notShooting", "unarmed", "fightTime"] as const;
export const VS_TESTS = ["hpAbove", "hpBelow", "slowed", "rooted", "streak", "thirdParty", "higherFeed", "elite", "higherPower", "playerAbove"] as const;
export const SCALE_SOURCES = ["ownMissingHp", "campsCleared", "streak"] as const;
export const ON_HIT_STATUSES = ["slowMove", "slowAttack", "antiHeal", "dot"] as const;
export const TRIGGER_ONS = ["hpBelow", "kill", "hitTaken", "hit", "block"] as const;
export const STATUS_KINDS = [
  "stun", "root", "silence", "slowMove", "slowAttack", "antiHeal", "dot", "invulnerable", "untargetable", "hidden", "zoned",
  "deathFloor", "haste", "shred",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];
export type MultKey = (typeof MULT_KEYS)[number];
export type EffectFlag = (typeof EFFECT_FLAGS)[number];
export type ConvertFrom = (typeof CONVERT_FROMS)[number];
export type ConvertTo = (typeof CONVERT_TOS)[number];
export type BoostStat = (typeof BOOST_STATS)[number];
export type Preset = "canonical" | "ci" | "soak";
export type CaseKind = "fold" | "statFold" | "requirements" | "boostBonus" | "boostGain" | "multCodec" | "flatCodec" | "mirrors";

export interface RowCommon {
  requires?: string[];
  needs?: "status";
}
export type Row = RowCommon & (
  | { k: "stat"; stat: Exclude<StatKey, "armor" | "shield" | "ad" | "ap">; v: F64 }
  | { k: "flat"; stat: "armor" | "shield" | "ad" | "ap"; v: F64 }
  | { k: "vs"; test: (typeof VS_TESTS)[number]; arg: F64; v: F64 }
  | { k: "scale"; src: (typeof SCALE_SOURCES)[number]; per: F64; step: F64; cap?: F64 }
  | { k: "while"; cond: (typeof WHILE_CONDS)[number]; arg: F64; stat: StatKey; v: F64; ms?: F64 }
  | { k: "onHit"; status: (typeof ON_HIT_STATUSES)[number]; per: F64; cap: F64; ms: F64 }
  | { k: "convert"; from: ConvertFrom; to: ConvertTo; per: F64; cap?: F64 }
  | { k: "mult"; key: MultKey; v: F64 }
  | { k: "flag"; flag: EffectFlag }
  | { k: "trigger"; on: (typeof TRIGGER_ONS)[number]; arg: F64; once?: boolean; rearm?: "teleport"; do: TriggerAction }
);

export type TriggerAction =
  | { do: "status"; to: "self" | "target"; status: (typeof STATUS_KINDS)[number]; ms: F64; value?: F64 }
  | { do: "cleanse"; to: "self" | "target"; classes: Array<"soft" | "hard" | "never"> }
  | { do: "heal"; share: F64; ignoreLockout?: boolean; ms?: F64 }
  | { do: "barrier"; share: F64; ms: F64 }
  | { do: "cooldown"; ms: F64 }
  | { do: "boost"; as: F64; move: F64; ms: F64 }
  | { do: "return"; share: F64; melee?: true }
  | { do: "fortify"; per: F64; cap: F64 }
  | { do: "splash"; radius: F64 };

export interface SourceInput {
  asMult: F64;
  speedMult: F64;
  windupMult: F64;
  armor: F64;
  shield: F64;
}
export interface FoldInput {
  rows: Row[];
  farmRows: Row[];
  /** One entry per row. Non-while entries are null; each while entry is its location-specific injected answer. */
  holds: Array<boolean | null>;
  farmHolds: Array<boolean | null>;
  /** Null means the ownership callback is absent, not that an installed callback owns nothing. */
  owned: string[] | null;
  /** Null omits baseMaxHp. */
  baseMaxHp: F64 | null;
  /** Null omits boosts; otherwise eight entries in BOOST_STATS order, with null omitting one stat. */
  boosts: Array<F64 | null> | null;
  source: SourceInput;
  farmAsEfficiency: F64;
}
export interface StatFoldInput {
  rows: Row[];
  holds: Array<boolean | null>;
  owned: string[] | null;
}
export interface RequirementsInput {
  row: Row;
  owned: string[] | null;
}
export interface BoostBonusInput { picks: F64 }
export interface BoostGainInput { stat: BoostStat; picks: F64; current: F64 }
/** Null decodes as an absent/undefined legacy field; non-finite values always use F64 wrappers. */
export interface CodecInput { value: F64 | null; wire: F64 | null }
export interface MirrorsInput { values: Array<F64 | null>; wire: Array<F64 | null> }

export type CaseInput =
  | { kind: "fold"; input: FoldInput }
  | { kind: "statFold"; input: StatFoldInput }
  | { kind: "requirements"; input: RequirementsInput }
  | { kind: "boostBonus"; input: BoostBonusInput }
  | { kind: "boostGain"; input: BoostGainInput }
  | { kind: "multCodec" | "flatCodec"; input: CodecInput }
  | { kind: "mirrors"; input: MirrorsInput };

export interface FoldOutput {
  plain: F64[];
  sums: F64[];
  farmSums: F64[];
  mults: F64[];
  flags: EffectFlag[];
  maxHp: F64;
  mirrorsFromSums: F64[];
  mirrorsFromFold: F64[];
  encoded: F64[];
  decoded: F64[];
}
export interface StatFoldOutput { sums: F64[] }
export interface RequirementsOutput { met: boolean }
export interface BoostBonusOutput { bonus: F64 }
export interface BoostGainOutput { gain: F64 }
export interface CodecOutput { encoded: F64; decoded: F64 }
export interface MirrorsOutput { encoded: F64[]; decoded: F64[] }
export type CaseOutput = FoldOutput | StatFoldOutput | RequirementsOutput | BoostBonusOutput | BoostGainOutput | CodecOutput | MirrorsOutput;

export type Origin = { kind: "synthetic"; label: string } | { kind: "card"; cardId: string; faction: string | null };
export type CaseSpec = CaseInput & { id: string; seed: number; origin: Origin; tags: string[] };
export type CorpusCase = CaseSpec & { expected: CaseOutput };
export interface SourceHash { path: string; sha256: string }
export interface Provenance {
  mode: "canonical" | "diagnostic";
  command: string;
  commit: string;
  base: string;
  runtime: { node: string; platform: string; arch: string };
  sources: SourceHash[];
}
export interface CoverageEntry { id: string; count: number }
export interface Corpus {
  format: typeof FORMAT;
  preset: Preset;
  provenance: Provenance;
  coverage: CoverageEntry[];
  /** Array order is part of the inventory; comparators must not sort it. */
  cases: CorpusCase[];
}

type Obj = Record<string, unknown>;
function object(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Obj {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: expected object`);
  const out = value as Obj;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(out)) if (!allowed.has(key)) throw new Error(`${path}.${key}: unknown key`);
  for (const key of required) if (!Object.hasOwn(out, key)) throw new Error(`${path}.${key}: missing key`);
  return out;
}
function array(value: unknown, path: string, length?: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected array`);
  if (length !== undefined && value.length !== length) throw new Error(`${path}: expected length ${length}, got ${value.length}`);
  return value;
}
function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path}: expected nonempty string`);
  return value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path}: expected boolean`);
  return value;
}
function uint(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${path}: expected nonnegative safe integer`);
  return value as number;
}
function choice<T extends string>(value: unknown, path: string, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`${path}: unknown variant ${JSON.stringify(value)}`);
  return value as T;
}
function float(value: unknown, path: string): F64 {
  if (!isF64(value)) throw new Error(`${path}: expected exact binary64 wrapper`);
  return value;
}
function nullableFloat(value: unknown, path: string): F64 | null {
  return value === null ? null : float(value, path);
}
function floats(value: unknown, path: string, length: number): F64[] {
  return array(value, path, length).map((entry, index) => float(entry, `${path}[${index}]`));
}
function nullableFloats(value: unknown, path: string, length: number): Array<F64 | null> {
  return array(value, path, length).map((entry, index) => nullableFloat(entry, `${path}[${index}]`));
}
function strings(value: unknown, path: string): string[] {
  return array(value, path).map((entry, index) => string(entry, `${path}[${index}]`));
}
function common(row: Obj, path: string): void {
  if (row.requires !== undefined) strings(row.requires, `${path}.requires`);
  if (row.needs !== undefined) choice(row.needs, `${path}.needs`, ["status"] as const);
}
function rowObject(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Obj {
  const row = object(value, path, ["k", ...required], ["requires", "needs", ...optional]);
  common(row, path);
  return row;
}

export function parseTriggerAction(value: unknown, path = "action"): TriggerAction {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: expected object`);
  const action = value as Obj;
  switch (choice(action.do, `${path}.do`, ["status", "cleanse", "heal", "barrier", "cooldown", "boost", "return", "fortify", "splash"] as const)) {
    case "status": {
      object(value, path, ["do", "to", "status", "ms"], ["value"]);
      choice(action.to, `${path}.to`, ["self", "target"] as const);
      choice(action.status, `${path}.status`, STATUS_KINDS);
      float(action.ms, `${path}.ms`);
      if (action.value !== undefined) float(action.value, `${path}.value`);
      break;
    }
    case "cleanse": {
      object(value, path, ["do", "to", "classes"]);
      choice(action.to, `${path}.to`, ["self", "target"] as const);
      array(action.classes, `${path}.classes`).forEach((entry, i) => choice(entry, `${path}.classes[${i}]`, ["soft", "hard", "never"] as const));
      break;
    }
    case "heal":
      object(value, path, ["do", "share"], ["ignoreLockout", "ms"]);
      float(action.share, `${path}.share`);
      if (action.ignoreLockout !== undefined) boolean(action.ignoreLockout, `${path}.ignoreLockout`);
      if (action.ms !== undefined) float(action.ms, `${path}.ms`);
      break;
    case "barrier":
      object(value, path, ["do", "share", "ms"]); float(action.share, `${path}.share`); float(action.ms, `${path}.ms`); break;
    case "cooldown": object(value, path, ["do", "ms"]); float(action.ms, `${path}.ms`); break;
    case "boost":
      object(value, path, ["do", "as", "move", "ms"]);
      float(action.as, `${path}.as`); float(action.move, `${path}.move`); float(action.ms, `${path}.ms`); break;
    case "return":
      object(value, path, ["do", "share"], ["melee"]); float(action.share, `${path}.share`);
      if (action.melee !== undefined && action.melee !== true) throw new Error(`${path}.melee: expected true`);
      break;
    case "fortify":
      object(value, path, ["do", "per", "cap"]); float(action.per, `${path}.per`); float(action.cap, `${path}.cap`); break;
    case "splash": object(value, path, ["do", "radius"]); float(action.radius, `${path}.radius`); break;
  }
  return value as TriggerAction;
}

/** Full ignored vs/scale/onHit/trigger payloads are validated here before any Rust-side ignored-marker projection. */
export function parseRow(value: unknown, path = "row"): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: expected object`);
  const kind = choice((value as Obj).k, `${path}.k`, ["stat", "flat", "vs", "scale", "while", "onHit", "convert", "mult", "flag", "trigger"] as const);
  switch (kind) {
    case "stat": {
      const row = rowObject(value, path, ["stat", "v"]);
      choice(row.stat, `${path}.stat`, STAT_KEYS.filter((key) => !["armor", "shield", "ad", "ap"].includes(key)));
      float(row.v, `${path}.v`); break;
    }
    case "flat": {
      const row = rowObject(value, path, ["stat", "v"]);
      choice(row.stat, `${path}.stat`, ["armor", "shield", "ad", "ap"] as const); float(row.v, `${path}.v`); break;
    }
    case "vs": {
      const row = rowObject(value, path, ["test", "arg", "v"]);
      choice(row.test, `${path}.test`, VS_TESTS); float(row.arg, `${path}.arg`); float(row.v, `${path}.v`); break;
    }
    case "scale": {
      const row = rowObject(value, path, ["src", "per", "step"], ["cap"]);
      choice(row.src, `${path}.src`, SCALE_SOURCES); float(row.per, `${path}.per`); float(row.step, `${path}.step`);
      if (row.cap !== undefined) float(row.cap, `${path}.cap`); break;
    }
    case "while": {
      const row = rowObject(value, path, ["cond", "arg", "stat", "v"], ["ms"]);
      choice(row.cond, `${path}.cond`, WHILE_CONDS); float(row.arg, `${path}.arg`); choice(row.stat, `${path}.stat`, STAT_KEYS);
      float(row.v, `${path}.v`); if (row.ms !== undefined) float(row.ms, `${path}.ms`); break;
    }
    case "onHit": {
      const row = rowObject(value, path, ["status", "per", "cap", "ms"]);
      choice(row.status, `${path}.status`, ON_HIT_STATUSES); float(row.per, `${path}.per`); float(row.cap, `${path}.cap`); float(row.ms, `${path}.ms`); break;
    }
    case "convert": {
      const row = rowObject(value, path, ["from", "to", "per"], ["cap"]);
      choice(row.from, `${path}.from`, CONVERT_FROMS); choice(row.to, `${path}.to`, CONVERT_TOS); float(row.per, `${path}.per`);
      if (row.cap !== undefined) float(row.cap, `${path}.cap`); break;
    }
    case "mult": {
      const row = rowObject(value, path, ["key", "v"]); choice(row.key, `${path}.key`, MULT_KEYS); float(row.v, `${path}.v`); break;
    }
    case "flag": rowObject(value, path, ["flag"]); choice((value as Obj).flag, `${path}.flag`, EFFECT_FLAGS); break;
    case "trigger": {
      const row = rowObject(value, path, ["on", "arg", "do"], ["once", "rearm"]);
      choice(row.on, `${path}.on`, TRIGGER_ONS); float(row.arg, `${path}.arg`);
      if (row.once !== undefined) boolean(row.once, `${path}.once`);
      if (row.rearm !== undefined) choice(row.rearm, `${path}.rearm`, ["teleport"] as const);
      parseTriggerAction(row.do, `${path}.do`); break;
    }
  }
  return value as Row;
}

function rows(value: unknown, path: string): Row[] {
  return array(value, path).map((entry, index) => parseRow(entry, `${path}[${index}]`));
}
function holds(value: unknown, path: string, rowValues: Row[]): Array<boolean | null> {
  const answers = array(value, path, rowValues.length);
  return answers.map((answer, index) => {
    if (rowValues[index].k === "while") return boolean(answer, `${path}[${index}]`);
    if (answer !== null) throw new Error(`${path}[${index}]: non-while row must have null answer`);
    return null;
  });
}
function owned(value: unknown, path: string): string[] | null {
  return value === null ? null : strings(value, path);
}
function source(value: unknown, path: string): SourceInput {
  const src = object(value, path, ["asMult", "speedMult", "windupMult", "armor", "shield"]);
  for (const key of ["asMult", "speedMult", "windupMult", "armor", "shield"]) float(src[key], `${path}.${key}`);
  return value as SourceInput;
}
export function parseFoldInput(value: unknown, path = "input"): FoldInput {
  const input = object(value, path, ["rows", "farmRows", "holds", "farmHolds", "owned", "baseMaxHp", "boosts", "source", "farmAsEfficiency"]);
  const parsedRows = rows(input.rows, `${path}.rows`);
  const farmRows = rows(input.farmRows, `${path}.farmRows`);
  holds(input.holds, `${path}.holds`, parsedRows); holds(input.farmHolds, `${path}.farmHolds`, farmRows);
  owned(input.owned, `${path}.owned`); nullableFloat(input.baseMaxHp, `${path}.baseMaxHp`);
  if (input.boosts !== null) nullableFloats(input.boosts, `${path}.boosts`, BOOST_STATS.length);
  source(input.source, `${path}.source`); float(input.farmAsEfficiency, `${path}.farmAsEfficiency`);
  return value as FoldInput;
}
export function parseStatFoldInput(value: unknown, path = "input"): StatFoldInput {
  const input = object(value, path, ["rows", "holds", "owned"]);
  const parsedRows = rows(input.rows, `${path}.rows`); holds(input.holds, `${path}.holds`, parsedRows); owned(input.owned, `${path}.owned`);
  return value as StatFoldInput;
}
function codecInput(value: unknown, path: string): CodecInput {
  const input = object(value, path, ["value", "wire"]);
  nullableFloat(input.value, `${path}.value`); nullableFloat(input.wire, `${path}.wire`); return value as CodecInput;
}
export function parseCaseInput(kind: CaseKind, value: unknown, path = "input"): CaseInput {
  switch (kind) {
    case "fold": parseFoldInput(value, path); break;
    case "statFold": parseStatFoldInput(value, path); break;
    case "requirements": {
      const input = object(value, path, ["row", "owned"]); parseRow(input.row, `${path}.row`); owned(input.owned, `${path}.owned`); break;
    }
    case "boostBonus": float(object(value, path, ["picks"]).picks, `${path}.picks`); break;
    case "boostGain": {
      const input = object(value, path, ["stat", "picks", "current"]);
      choice(input.stat, `${path}.stat`, BOOST_STATS); float(input.picks, `${path}.picks`); float(input.current, `${path}.current`); break;
    }
    case "multCodec": case "flatCodec": codecInput(value, path); break;
    case "mirrors": {
      const input = object(value, path, ["values", "wire"]);
      nullableFloats(input.values, `${path}.values`, MIRROR_FIELDS.length); nullableFloats(input.wire, `${path}.wire`, MIRROR_FIELDS.length); break;
    }
  }
  return { kind, input: value } as CaseInput;
}
function origin(value: unknown, path: string): Origin {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: expected object`);
  const kind = choice((value as Obj).kind, `${path}.kind`, ["synthetic", "card"] as const);
  if (kind === "synthetic") string(object(value, path, ["kind", "label"]).label, `${path}.label`);
  else {
    const out = object(value, path, ["kind", "cardId", "faction"]); string(out.cardId, `${path}.cardId`);
    if (out.faction !== null) string(out.faction, `${path}.faction`);
  }
  return value as Origin;
}
function caseBase(value: unknown, path: string): Obj {
  const out = object(value, path, ["id", "seed", "origin", "tags", "kind", "input"], ["expected"]);
  string(out.id, `${path}.id`); uint(out.seed, `${path}.seed`); if ((out.seed as number) > 0xffffffff) throw new Error(`${path}.seed: above uint32`);
  origin(out.origin, `${path}.origin`);
  const tags = strings(out.tags, `${path}.tags`); if (new Set(tags).size !== tags.length) throw new Error(`${path}.tags: duplicate tag`);
  return out;
}
export function parseCaseSpec(value: unknown, path = "case"): CaseSpec {
  const out = caseBase(value, path);
  if (out.expected !== undefined) throw new Error(`${path}.expected: inventory case cannot contain expected output`);
  const kind = choice(out.kind, `${path}.kind`, ["fold", "statFold", "requirements", "boostBonus", "boostGain", "multCodec", "flatCodec", "mirrors"] as const);
  parseCaseInput(kind, out.input, `${path}.input`); return value as CaseSpec;
}
function output(value: unknown, kind: CaseKind, path: string): CaseOutput {
  switch (kind) {
    case "fold": {
      const out = object(value, path, ["plain", "sums", "farmSums", "mults", "flags", "maxHp", "mirrorsFromSums", "mirrorsFromFold", "encoded", "decoded"]);
      floats(out.plain, `${path}.plain`, STAT_KEYS.length); floats(out.sums, `${path}.sums`, STAT_KEYS.length); floats(out.farmSums, `${path}.farmSums`, STAT_KEYS.length);
      floats(out.mults, `${path}.mults`, MULT_KEYS.length); array(out.flags, `${path}.flags`).forEach((flag, i) => choice(flag, `${path}.flags[${i}]`, EFFECT_FLAGS));
      float(out.maxHp, `${path}.maxHp`); for (const key of ["mirrorsFromSums", "mirrorsFromFold", "encoded", "decoded"]) floats(out[key], `${path}.${key}`, MIRROR_FIELDS.length); break;
    }
    case "statFold": floats(object(value, path, ["sums"]).sums, `${path}.sums`, STAT_KEYS.length); break;
    case "requirements": boolean(object(value, path, ["met"]).met, `${path}.met`); break;
    case "boostBonus": float(object(value, path, ["bonus"]).bonus, `${path}.bonus`); break;
    case "boostGain": float(object(value, path, ["gain"]).gain, `${path}.gain`); break;
    case "multCodec": case "flatCodec": {
      const out = object(value, path, ["encoded", "decoded"]); float(out.encoded, `${path}.encoded`); float(out.decoded, `${path}.decoded`); break;
    }
    case "mirrors": {
      const out = object(value, path, ["encoded", "decoded"]); floats(out.encoded, `${path}.encoded`, MIRROR_FIELDS.length); floats(out.decoded, `${path}.decoded`, MIRROR_FIELDS.length); break;
    }
  }
  return value as CaseOutput;
}
export function parseCorpusCase(value: unknown, path = "case"): CorpusCase {
  const out = object(value, path, ["id", "seed", "origin", "tags", "kind", "input", "expected"]);
  parseCaseSpec({ id: out.id, seed: out.seed, origin: out.origin, tags: out.tags, kind: out.kind, input: out.input }, path);
  output(out.expected, out.kind as CaseKind, `${path}.expected`); return value as CorpusCase;
}
function provenance(value: unknown): Provenance {
  const out = object(value, "provenance", ["mode", "command", "commit", "base", "runtime", "sources"]);
  choice(out.mode, "provenance.mode", ["canonical", "diagnostic"] as const); string(out.command, "provenance.command");
  string(out.commit, "provenance.commit"); if (out.base !== BASE_COMMIT) throw new Error("provenance.base: wrong packet base");
  const runtime = object(out.runtime, "provenance.runtime", ["node", "platform", "arch"]);
  string(runtime.node, "provenance.runtime.node"); string(runtime.platform, "provenance.runtime.platform"); string(runtime.arch, "provenance.runtime.arch");
  const seen = new Set<string>();
  array(out.sources, "provenance.sources").forEach((entry, i) => {
    const sourceEntry = object(entry, `provenance.sources[${i}]`, ["path", "sha256"]); const path = string(sourceEntry.path, `provenance.sources[${i}].path`);
    if (!/^[0-9a-f]{64}$/.test(sourceEntry.sha256 as string)) throw new Error(`provenance.sources[${i}].sha256: malformed`);
    if (seen.has(path)) throw new Error(`provenance.sources: duplicate ${path}`); seen.add(path);
  });
  return value as Provenance;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Obj).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, stable(entry)]));
  return value;
}
export function semanticKey(value: CaseInput): string {
  return JSON.stringify(stable(value));
}

/** Strict corpus admission for the future comparator. Expected values are validated but never returned as kernel inputs. */
export function parseCorpus(value: unknown, requiredCoverage: readonly string[] = []): Corpus {
  const out = object(value, "corpus", ["format", "preset", "provenance", "coverage", "cases"]);
  if (out.format !== FORMAT) throw new Error(`format: expected ${FORMAT}`);
  const preset = choice(out.preset, "preset", ["canonical", "ci", "soak"] as const);
  provenance(out.provenance);
  const cases = array(out.cases, "cases").map((entry, i) => parseCorpusCase(entry, `cases[${i}]`));
  if (cases.length === 0) throw new Error("cases: empty inventory");
  if (preset !== "canonical" && cases.length !== PRESET_COUNTS[preset]) throw new Error(`cases: ${preset} requires exactly ${PRESET_COUNTS[preset]}`);
  const ids = new Set<string>(); const semantics = new Set<string>(); const tagCounts = new Map<string, number>();
  for (const testCase of cases) {
    if (ids.has(testCase.id)) throw new Error(`cases: duplicate id ${testCase.id}`); ids.add(testCase.id);
    const key = semanticKey({ kind: testCase.kind, input: testCase.input } as CaseInput);
    if (semantics.has(key)) throw new Error(`cases: semantic duplicate ${testCase.id}`); semantics.add(key);
    for (const tag of testCase.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const coverageIds = new Set<string>();
  const coverage = array(out.coverage, "coverage").map((entry, i) => {
    const item = object(entry, `coverage[${i}]`, ["id", "count"]); const id = string(item.id, `coverage[${i}].id`);
    if (coverageIds.has(id)) throw new Error(`coverage: duplicate ${id}`); coverageIds.add(id);
    const count = uint(item.count, `coverage[${i}].count`); if (count !== tagCounts.get(id)) throw new Error(`coverage.${id}: count does not match cases`);
    return { id, count };
  });
  for (const required of requiredCoverage) if (!coverageIds.has(required) || (tagCounts.get(required) ?? 0) === 0) throw new Error(`coverage: missing ${required}`);
  return { ...out, format: FORMAT, preset, cases, coverage } as Corpus;
}
