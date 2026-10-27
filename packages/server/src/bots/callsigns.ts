// Callsigns and ids of the server-filled bots (docs/BOTS.md 7.2 "Names"). The names are meant to read like players' own
// (every one passes PROFILE_RE); a bot is told apart by the [BOT] tag the client draws, not by what it is called.
import type { Rng } from "@raid/shared";
import { BOT_ID_PREFIX } from "./brain/types";

export const CALLSIGN_POOL: readonly string[] = [
  "Wren", "Kestrel_7", "mossy", "Varga", "Ashlyn", "grimm", "Tovik", "Pip",
  "Marrow", "Jorund", "Sable", "dusk_rat", "Orrin", "Lyra", "Brannock", "Halvar",
  "Quill", "redfox", "Nettle", "Iska", "Fenwick", "Thorne", "Mags", "cinder",
  "Rook", "Elowen", "Bjorn_k", "Tamsin", "Skarn", "Odalys", "vexx", "Corwin",
  "Isolde", "Baldr", "junebug", "Hale", "Ragnhild", "Dax", "Yara", "Wolfe",
  "Mirren", "Torvald", "kitsune", "Eryx", "Bramble", "Sigrun", "Oskar", "nox",
  "Ptolemy", "Leif", "Saffi", "Garrick", "Rue", "Ulf", "Zephyr_9", "Maren",
  "Draven", "tinker", "Hollis", "Svea", "Kodi", "Finnick", "Aldous", "lowtide",
];

const two = (n: number): string => String(n).padStart(2, "0");

/**
 * A pool name that `taken` refuses neither as written nor in lower case (so a predicate over a lower-cased set works too).
 * One draw picks among the free names; with the whole pool taken, a name gets two digits appended, walking on from a random
 * start until one is free. Same rng and same predicate give the same name.
 */
export function pickCallsign(rng: Rng, taken: (name: string) => boolean): string {
  const refused = (name: string): boolean => taken(name) || taken(name.toLowerCase());
  const free = CALLSIGN_POOL.filter((name) => !refused(name));
  if (free.length > 0) return free[Math.floor(rng() * free.length) % free.length]!;

  const start = Math.floor(rng() * CALLSIGN_POOL.length * 100);
  const total = CALLSIGN_POOL.length * 100;
  for (let i = 0; i < total; i++) {
    const k = (start + i) % total;
    const name = `${CALLSIGN_POOL[Math.floor(k / 100)]!}${two(k % 100)}`;
    if (!refused(name)) return name;
  }
  // Every spelling is taken (a room of 5,000 players): any name is as good as another.
  return `${CALLSIGN_POOL[start % CALLSIGN_POOL.length]!}${two(start % 100)}`;
}

/** The synced id of the n-th bot of a room: `~` never appears in a Colyseus session id. */
export function botId(n: number): string {
  return `${BOT_ID_PREFIX}${n}`;
}
