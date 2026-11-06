/** Thin actual-source oracle: no stat-fold arithmetic is reimplemented in this file. */
import {
  decodeFlat, decodeMirrors, decodeMult, encodeFlat, encodeMirrors, encodeMult, foldRows, foldStatRows, mirrorsFromFold, mirrorsFromSums,
  type FoldContext, type SourceMods, type StatMirrors,
} from "../../packages/shared/src/mods.ts";
import { requirementsMet, type Effect } from "../../packages/shared/src/effects.ts";
import { chestBoostBonus, chestBoostGain } from "../../packages/shared/src/chestBoosts.ts";
import { encodeFloats, f64, fromF64 } from "./float.ts";
import {
  BOOST_STATS, MIRROR_FIELDS, MULT_KEYS, parseCaseSpec, STAT_KEYS,
  type BoostGainInput, type CaseOutput, type CaseSpec, type CodecInput, type FoldInput, type MirrorsInput, type Row,
  type StatFoldInput, type TriggerAction,
} from "./schema.ts";

function number(value: Parameters<typeof fromF64>[0] | null | undefined): number | undefined {
  return value === null || value === undefined ? undefined : fromF64(value);
}
function common(row: Row): { requires?: string[]; needs?: "status" } {
  return { ...(row.requires === undefined ? {} : { requires: [...row.requires] }), ...(row.needs === undefined ? {} : { needs: row.needs }) };
}
function action(input: TriggerAction): unknown {
  switch (input.do) {
    case "status": return { ...input, ms: fromF64(input.ms), ...(input.value === undefined ? {} : { value: fromF64(input.value) }) };
    case "cleanse": return { ...input, classes: [...input.classes] };
    case "heal": return {
      ...input, share: fromF64(input.share), ...(input.ms === undefined ? {} : { ms: fromF64(input.ms) }),
    };
    case "barrier": return { ...input, share: fromF64(input.share), ms: fromF64(input.ms) };
    case "cooldown": return { ...input, ms: fromF64(input.ms) };
    case "boost": return { ...input, as: fromF64(input.as), move: fromF64(input.move), ms: fromF64(input.ms) };
    case "return": return { ...input, share: fromF64(input.share) };
    case "fortify": return { ...input, per: fromF64(input.per), cap: fromF64(input.cap) };
    case "splash": return { ...input, radius: fromF64(input.radius) };
  }
}
export function decodeRow(input: Row): Effect {
  switch (input.k) {
    case "stat": case "flat": return { ...common(input), k: input.k, stat: input.stat, v: fromF64(input.v) } as Effect;
    case "vs": return { ...common(input), k: input.k, test: input.test, arg: fromF64(input.arg), v: fromF64(input.v) };
    case "scale": return {
      ...common(input), k: input.k, src: input.src, per: fromF64(input.per), step: fromF64(input.step),
      ...(input.cap === undefined ? {} : { cap: fromF64(input.cap) }),
    };
    case "while": return {
      ...common(input), k: input.k, cond: input.cond, arg: fromF64(input.arg), stat: input.stat, v: fromF64(input.v),
      ...(input.ms === undefined ? {} : { ms: fromF64(input.ms) }),
    };
    case "onHit": return { ...common(input), k: input.k, status: input.status, per: fromF64(input.per), cap: fromF64(input.cap), ms: fromF64(input.ms) };
    case "convert": return {
      ...common(input), k: input.k, from: input.from, to: input.to, per: fromF64(input.per),
      ...(input.cap === undefined ? {} : { cap: fromF64(input.cap) }),
    };
    case "mult": return { ...common(input), k: input.k, key: input.key, v: fromF64(input.v) };
    case "flag": return { ...common(input), k: input.k, flag: input.flag };
    case "trigger": return {
      ...common(input), k: input.k, on: input.on, arg: fromF64(input.arg),
      ...(input.once === undefined ? {} : { once: input.once }), ...(input.rearm === undefined ? {} : { rearm: input.rearm }),
      do: action(input.do),
    } as Effect;
  }
}
function ownership(ids: string[] | null): ((id: string) => boolean) | undefined {
  if (ids === null) return undefined;
  const owned = new Set(ids);
  return (id) => owned.has(id);
}
function holds(rows: Effect[], answers: Array<boolean | null>): WeakMap<Effect, boolean> {
  const map = new WeakMap<Effect, boolean>();
  rows.forEach((row, index) => { if (row.k === "while") map.set(row, answers[index]!); });
  return map;
}
function context(input: FoldInput | StatFoldInput, rows: Effect[], farmRows: Effect[] = []): FoldContext {
  const mainHolds = holds(rows, input.holds);
  const earnedHolds = "farmHolds" in input ? holds(farmRows, input.farmHolds) : new WeakMap<Effect, boolean>();
  const ctx: FoldContext = {
    owns: ownership(input.owned),
    holds: (row) => mainHolds.get(row) ?? earnedHolds.get(row) ?? false,
  };
  if ("baseMaxHp" in input) {
    const baseMaxHp = number(input.baseMaxHp);
    if (baseMaxHp !== undefined) ctx.baseMaxHp = baseMaxHp;
    ctx.farmRows = farmRows;
    if (input.boosts !== null) {
      const boosts: NonNullable<FoldContext["boosts"]> = {};
      input.boosts.forEach((picks, index) => {
        if (picks !== null) boosts[BOOST_STATS[index]] = fromF64(picks);
      });
      ctx.boosts = boosts;
    }
  }
  return ctx;
}
function mirrors(value: StatMirrors): ReturnType<typeof encodeFloats> {
  return encodeFloats(MIRROR_FIELDS.map((key) => value[key]));
}
function nullableNumbers(values: MirrorsInput["values"]): Array<number | undefined> {
  return values.map(number);
}
function mirrorObject(values: Array<number | undefined>): StatMirrors {
  return Object.fromEntries(MIRROR_FIELDS.map((key, index) => [key, values[index]])) as unknown as StatMirrors;
}

export function captureCase(spec: CaseSpec): CaseOutput {
  parseCaseSpec(spec);
  switch (spec.kind) {
    case "fold": {
      const rows = spec.input.rows.map(decodeRow); const farmRows = spec.input.farmRows.map(decodeRow);
      const folded = foldRows(rows, context(spec.input, rows, farmRows));
      const fromSums = mirrorsFromSums(folded.sums);
      const src = Object.fromEntries(Object.entries(spec.input.source).map(([key, value]) => [key, fromF64(value)])) as unknown as SourceMods;
      const fromFold = mirrorsFromFold(folded, src, fromF64(spec.input.farmAsEfficiency));
      const encoded = encodeMirrors(fromFold); const decoded = decodeMirrors(encoded);
      return {
        plain: encodeFloats(STAT_KEYS.map((key) => folded.plain[key])),
        sums: encodeFloats(STAT_KEYS.map((key) => folded.sums[key])),
        farmSums: encodeFloats(STAT_KEYS.map((key) => folded.farmSums[key])),
        mults: encodeFloats(MULT_KEYS.map((key) => folded.mults[key])),
        flags: [...folded.flags], maxHp: f64(folded.maxHp), mirrorsFromSums: mirrors(fromSums), mirrorsFromFold: mirrors(fromFold),
        encoded: mirrors(encoded), decoded: mirrors(decoded),
      };
    }
    case "statFold": {
      const rows = spec.input.rows.map(decodeRow); const sums = foldStatRows(rows, context(spec.input, rows));
      return { sums: encodeFloats(STAT_KEYS.map((key) => sums[key])) };
    }
    case "requirements": return { met: requirementsMet(decodeRow(spec.input.row), ownership(spec.input.owned)) };
    case "boostBonus": return { bonus: f64(chestBoostBonus(fromF64(spec.input.picks))) };
    case "boostGain": {
      const input: BoostGainInput = spec.input;
      return { gain: f64(chestBoostGain(input.stat, fromF64(input.picks), fromF64(input.current))) };
    }
    case "multCodec": case "flatCodec": {
      const input: CodecInput = spec.input;
      const value = number(input.value); const wire = number(input.wire);
      return spec.kind === "multCodec"
        ? { encoded: f64(encodeMult(value as number)), decoded: f64(decodeMult(wire as number)) }
        : { encoded: f64(encodeFlat(value as number)), decoded: f64(decodeFlat(wire as number)) };
    }
    case "mirrors": {
      const encoded = encodeMirrors(mirrorObject(nullableNumbers(spec.input.values)));
      const decoded = decodeMirrors(mirrorObject(nullableNumbers(spec.input.wire)));
      return { encoded: mirrors(encoded), decoded: mirrors(decoded) };
    }
  }
}
