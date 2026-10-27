// Every card of the catalog is live since the phase-B hooks landed, but the machinery around a card that is NOT live (the chest never
// rolls it, the sim folds no rows of it, the console flags it) is still code, and its tests need one: this makes named cards wait
// for a hook for the length of `fn`, then puts them back. (The catalog's cards are plain objects; `ready` is the only field it touches.)
import { cardDef } from "@raid/shared";

export function withNotLive<T>(ids: readonly string[], fn: () => T): T {
  const defs = ids.map((id) => {
    const def = cardDef(id) as { ready: string } | undefined;
    if (!def) throw new Error(`withNotLive: no card "${id}"`);
    return { def, was: def.ready };
  });
  for (const d of defs) d.def.ready = "b";
  try {
    return fn();
  } finally {
    for (const d of defs) d.def.ready = d.was;
  }
}
