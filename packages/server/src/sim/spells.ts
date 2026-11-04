// The spell slot's world side (shared/spells.ts has the rules): spell finds placed on the map when the run starts, the pickup that
// puts one in the slot (and lays the held one down in its place), and the held spell dropping where its holder falls. Casting is
// the ordinary cast pipeline (sim/abilities.ts handleCast, slot "spell"), whose stock clock is the spell's reload.
//
// No spell exists yet, so the pool is empty: nothing is placed, no hash is taken and no random stream is drawn from, and a run
// plays exactly as it did before the slot existed.
import {
  ABILITIES, heldSpell, isSpellId, SPELL_FIND_CLEARANCE_TILES, SPELL_FINDS_PER_ZONE, SPELL_REFUSAL, chooseSpellFinds, spellIds,
  spellPool, spellReadyAt, spellTakenText, type AbilityId, type Vec2,
} from "@raid/shared";
import type { ContainerState, PlayerState } from "@raid/shared/schema";
import type { Combatant } from "./combatant";
import { addContainer, forgetBirth } from "./loot";
import { chainHook, emit, saltedUnit, type World } from "./world";

type Player = Extract<Combatant, { kind: "player" }>;

/** "SPEL": the salt of the finds' choices (order-free hashes of the world's secret salt, never world.random or the public seed). */
const SPELL_SALT = 0x5350454c;

/** A spell lying on the ground at `at`, its copy's reload clock `fullAt` (0 or past: loaded). */
export function dropSpell(world: World, at: Vec2, spell: AbilityId, fullAt = 0): ContainerState {
  const box = addContainer(world, "spell", at, ABILITIES[spell].name, [{ uid: world.newItemUid(), def: spell }]);
  box.readyAt = fullAt > world.state.serverTime ? fullAt : 0;
  return box;
}

/** Empties the spell slot, leaving the spell (with its clock) at `at`; nothing for an empty slot. */
export function dropHeldSpell(world: World, p: PlayerState, at: Vec2 = p): ContainerState | null {
  const def = heldSpell(p);
  const fullAt = p.extra.spellFullAt;
  clearSpellSlot(p);
  return def ? dropSpell(world, at, def.id, fullAt) : null;
}

/** Written only where it differs, so an empty slot (every slot while no spell exists) never patches. */
function clearSpellSlot(p: PlayerState): void {
  const x = p.extra;
  if (x.spell !== "") x.spell = "";
  if (x.spellReadyAt !== 0) x.spellReadyAt = 0;
  if (x.spellFullAt !== 0) x.spellFullAt = 0;
}

/**
 * A `pickup` of a spell find (loot.ts handlePickup has checked the range, the reach and that the player may act). The find's spell
 * goes in the slot with the find's own reload clock; the spell held before lies down where the find was, with its clock, so a
 * swap neither reloads nor loses one. Refused while the slot's own cast is under way (its refund would land on the other spell).
 */
export function takeSpell(world: World, c: Player, box: ContainerState): void {
  const item = box.items.length > 0 ? box.items.at(0) : undefined;
  if (!item || !isSpellId(item.def)) { emit(world, { type: "toast", to: c.id, text: "Nothing to take" }); return; }
  if (c.rt.cast?.slot === "spell") { emit(world, { type: "toast", to: c.id, text: SPELL_REFUSAL.casting }); return; }
  const def = ABILITIES[item.def];
  const fullAt = box.readyAt > world.state.serverTime ? box.readyAt : 0;
  const at = { x: box.x, y: box.y };
  world.state.containers.delete(box.id);
  forgetBirth(world, box.id);
  dropHeldSpell(world, c.s, at);
  c.s.extra.spell = def.id;
  c.s.extra.spellFullAt = fullAt;
  c.s.extra.spellReadyAt = spellReadyAt(def, fullAt);
  world.hooks.spellTaken?.(world, c, def.id);
  emit(world, { type: "toast", to: c.id, text: spellTakenText(def) });
}

/** raidStarted: every slot starts empty, and (outside training) the run's spell finds are laid out. */
function raidStarted(world: World): void {
  for (const p of world.state.players.values()) clearSpellSlot(p);
  if (world.config.training) return;
  const pool = spellPool();
  if (pool.length === 0) return;
  const taken = [...world.state.containers.values()].map((b) => ({ x: b.x, y: b.y }));
  const finds = chooseSpellFinds(world.map, pool, SPELL_FINDS_PER_ZONE, taken, SPELL_FIND_CLEARANCE_TILES,
    (stream, spot) => saltedUnit(world, SPELL_SALT, stream, spot));
  for (const f of finds) dropSpell(world, f.at, f.spell);
}

/** The training rack's spells: one find of every spell in the catalog (spawnWeight 0 included). Empty today. */
export function trainingSpells(): AbilityId[] {
  return spellIds();
}

export function install(world: World): void {
  chainHook(world, "raidStarted", raidStarted);
  // A player who goes down drops the spell where they fall, as they drop their weapons (training keeps them: its dropBody is a no-op).
  const prevDrop = world.hooks.dropBody;
  world.hooks.dropBody = (w, p) => {
    prevDrop(w, p);
    dropHeldSpell(w, p);
  };
}
