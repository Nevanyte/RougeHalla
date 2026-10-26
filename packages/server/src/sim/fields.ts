// Areas of the ability framework: a Trial's zone, a Swarm's cloud, a Blaze Step's trail. The runtime table is
// `world.abilities.fields`; each entry is mirrored ONCE into the synced `state.fields` (clients draw it from the entry and
// never get an update) and deleted from both when it ends. The server never moves one: a moving area carries its velocity
// and clients move it themselves. A leaf module: shared, the schema and world only.
import { ABILITY_IDS, distPointToSegment, FIELD_KINDS, type Vec2 } from "@raid/shared";
import { FieldState } from "@raid/shared/schema";
import { nextId, type AbilitiesRuntime, type FieldRuntime, type World } from "./world";

/** The ability runtime, created on first use (`world.abilities` is null until something needs it). */
export function abilitiesRt(world: World): AbilitiesRuntime {
  return (world.abilities ??= { fields: new Map(), dot: new Map(), dotSince: world.state.serverTime });
}

export function addField(world: World, f: Omit<FieldRuntime, "id">): FieldRuntime {
  const field: FieldRuntime = { id: nextId(world, "fld"), ...f };
  abilitiesRt(world).fields.set(field.id, field);
  const s = new FieldState();
  s.kind = Math.max(0, FIELD_KINDS.indexOf(field.kind));
  s.ability = Math.max(0, ABILITY_IDS.indexOf(field.ability));
  s.x = field.x;
  s.y = field.y;
  s.x2 = field.x2;
  s.y2 = field.y2;
  s.r = field.r;
  s.vx = field.vx;
  s.vy = field.vy;
  s.owner = field.owner.id;
  s.subject = field.subject ?? "";
  s.startedAt = field.startedAt;
  s.endsAt = field.endsAt;
  world.state.fields.set(field.id, s);
  return field;
}

export function removeField(world: World, id: string): FieldRuntime | null {
  const fields = world.abilities?.fields;
  const f = fields?.get(id);
  if (!fields || !f) return null;
  fields.delete(id);
  world.state.fields.delete(id);
  return f;
}

/** Removes every field the predicate picks (decided before any is removed) and returns them. */
export function removeFieldsWhere(world: World, pred: (f: FieldRuntime) => boolean): FieldRuntime[] {
  const fields = world.abilities?.fields;
  if (!fields || fields.size === 0) return [];
  const hit: FieldRuntime[] = [];
  for (const f of fields.values()) if (pred(f)) hit.push(f);
  for (const f of hit) removeField(world, f.id);
  return hit;
}

const NO_FIELDS: ReadonlyMap<string, FieldRuntime> = new Map();

export function fieldsOf(world: World): ReadonlyMap<string, FieldRuntime> {
  return world.abilities?.fields ?? NO_FIELDS;
}

/** Is `p` within a trail's half-width of its segment? */
export function onTrail(f: FieldRuntime, p: Vec2): boolean {
  return distPointToSegment(p.x, p.y, f.x, f.y, f.x2, f.y2) <= f.r;
}
