// A tuning diagnostic (docs/BOTS_TUNING.md): `--tune '{"tiers":{"easy":{"knowledge":0.95}},"personas":{"hunter":{"engageEdge":0}}}'`
// patches the TIERS / PERSONAS tables in place before the games run, so an ablation (one tier with another's knowledge, one persona
// with a different threshold) needs no edit of types.ts. It deep-merges plain numbers and booleans only, and only into keys the
// tables already have, so a typo is an error and not a silent no-op. Absent, a tournament is exactly what it was.
import { PERSONAS, TIERS } from "../brain/types";

export interface TuneSpec {
  readonly tiers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly personas?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

function merge(target: Record<string, unknown>, patch: Readonly<Record<string, unknown>>, path: string): void {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in target)) throw new Error(`--tune: unknown key ${path}.${k}`);
    const old = target[k];
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      if (old === null || typeof old !== "object") throw new Error(`--tune: ${path}.${k} is not a group`);
      merge(old as Record<string, unknown>, v as Record<string, unknown>, `${path}.${k}`);
    } else if (typeof v !== typeof old) {
      throw new Error(`--tune: ${path}.${k} must be a ${typeof old}`);
    } else target[k] = v;
  }
}

const done = new WeakSet<object>();

/** Patches the tables once per spec object (a batch calls it for every game). */
export function applyTune(spec: TuneSpec | undefined): void {
  if (!spec || done.has(spec)) return;
  done.add(spec);
  for (const [id, patch] of Object.entries(spec.tiers ?? {})) {
    const t = (TIERS as unknown as Record<string, Record<string, unknown>>)[id];
    if (!t) throw new Error(`--tune: unknown tier ${id}`);
    merge(t, patch, `tiers.${id}`);
  }
  for (const [id, patch] of Object.entries(spec.personas ?? {})) {
    const p = (PERSONAS as unknown as Record<string, Record<string, unknown>>)[id];
    if (!p) throw new Error(`--tune: unknown persona ${id}`);
    merge(p, patch, `personas.${id}`);
  }
}
