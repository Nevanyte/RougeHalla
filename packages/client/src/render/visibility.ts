// Who the viewer may see. A hidden (Swarm) fighter is not drawn on anyone else's screen, so nothing else may draw at its
// position either: a damage number, a burst, stars, a telegraph, the lock ring. The scene keeps every fighter's interpolated
// position (the state syncs them all), so what the effects ask for goes through `visiblePosition`, which answers "nowhere"
// for a remote fighter that is hidden. The viewer's own fighter is always where it is drawn.
import { EFFECT_HIDDEN, type Vec2 } from "@raid/shared";

/** The part of a player state this reads. */
export interface HasEffects {
  effects: number;
}

/** True for another player whose synced effects include the hidden bit (read from the latest patch, like hp). */
export function isHiddenRemote(players: { get(id: string): HasEffects | undefined }, localId: string, id: string): boolean {
  if (id === localId) return false;
  const p = players.get(id);
  return p !== undefined && ((p.effects | 0) & EFFECT_HIDDEN) !== 0;
}

/** Where fighter `id` is drawn, or undefined if it is not drawn or is a remote fighter that is hidden. */
export function visiblePosition(
  drawn: { get(id: string): Vec2 | undefined }, players: { get(id: string): HasEffects | undefined }, localId: string, id: string,
): Vec2 | undefined {
  const at = drawn.get(id);
  if (at === undefined || isHiddenRemote(players, localId, id)) return undefined;
  return at;
}
