// How a player's name is drawn: a server-filled bot carries a tag, so nobody mistakes it for a person (nameplates, the
// kill feed, announcements, the results). Pure: the scene hands it the synced fields, and `bot` may be absent (state from
// an older server, the hub's avatar lookalike), which reads as a person.

/** What the tag says; the nameplate is short, so this leads the name rather than trailing off the end. */
export const BOT_TAG = "[BOT]";

export interface Nameable {
  name: string;
  bot?: boolean;
}

export function displayName(p: Nameable): string {
  return p.bot === true ? `${BOT_TAG} ${p.name}` : p.name;
}

/** Something to walk the room's players with: a MapSchema's `forEach`, or an array's. */
export interface PlayerWalk {
  forEach(each: (p: Nameable) => void): void;
}

/**
 * The winner as the run-over line shows them. The state names the winner by bare name, so the tag comes from the player of
 * that name who is still in the room (a bot stays in until the room closes; a person who left has no tag to show).
 */
export function winnerLabel(winner: string, players: PlayerWalk): string {
  if (!winner) return winner;
  let label = winner;
  players.forEach((p) => { if (p.name === winner && p.bot === true) label = displayName(p); });
  return label;
}
