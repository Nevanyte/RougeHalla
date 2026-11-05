import type { SimEvent } from "../../packages/server/src/sim/world";

export const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Canonical JSON for every legacy payload: keys sorted recursively, undefined omitted, all numbers rounded alike. */
export function canonicalJson(value: unknown): any {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite capture number: ${value}`);
    return r6(value);
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value instanceof Map) return canonicalJson([...value.entries()]);
  if (value instanceof Set) return canonicalJson([...value]);
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonicalJson(v)]));
}

/** GV remains checked through results; resolved has its own result stream. No fx kind loses a field. */
export function canonicalEvent(event: SimEvent): unknown | null {
  if (event.type === "gv" || event.type === "resolved") return null;
  if (event.type === "fx") return canonicalJson(event.fx);
  const { type, ...fields } = event;
  return canonicalJson({ kind: type, ...fields });
}
