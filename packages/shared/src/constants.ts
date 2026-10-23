// Network
export const ROOM_NAME = "raid";
export const SERVER_PORT = 2567;
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const PATCH_MS = TICK_MS;
/** Clients render this far behind the estimated server clock (two ticks). */
export const INTERP_DELAY_MS = 100;
/**
 * How far back the server rewinds targets to match what an attacker saw (lag compensation).
 * Covers INTERP_DELAY_MS + RTT + one tick for clients up to ~150 ms RTT.
 */
export const MAX_REWIND_MS = 300;
/** A per-tick jump larger than this is treated as a teleport and not interpolated. */
export const TELEPORT_DISTANCE = 200;

// World
export const TILE = 32;
export const MAP_TILES_W = 64;
export const MAP_TILES_H = 64;
export const WORLD_W = MAP_TILES_W * TILE;
export const WORLD_H = MAP_TILES_H * TILE;
export const PLAYER_RADIUS = 12;
export const PLAYER_SPEED = 170;
export const PLAYER_MAX_HP = 100;
export const INTERACT_RANGE = 56;
export const INVENTORY_SLOTS = 6;

// Raid flow
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS_TO_START = 2;
export const LOBBY_SECONDS = 15;
/** Once MIN players are in, the lobby waits at most this long for more before starting. */
export const LOBBY_FILL_SECONDS = 5;
export const RAID_SECONDS = 360;
export const EXTRACT_SECONDS = 5;
export const EXTRACT_RADIUS = 64;
export const RECONNECT_SECONDS = 10;
/** How long an ended room lingers so clients receive their results before disconnect. */
export const ENDED_LINGER_SECONDS = 5;

// Zone
/** Damage per second outside the zone at stage 1; zoneDps() multiplies it by the stage number. */
export const ZONE_DPS = 6;
/** The last circle, centred on one extract. */
export const ZONE_FINAL_RADIUS = 96;
/** Intermediate circles between the whole-map start circle and the final one (shrink stages = this + 1). */
export const ZONE_STAGES = 4;
/** The stages share this fraction of the raid; the final circle then holds for the rest. */
export const ZONE_TIMELINE_FRACTION = 0.85;
/** Share of each stage spent holding still before it shrinks. */
export const ZONE_HOLD_FRACTION = 0.5;
/** Fraction of the allowed region (inside the previous circle, still holding the final one) used when placing each centre. */
export const ZONE_DRIFT_FRACTION = 0.8;

// Rendering (client only, but kept here so tools/bots agree on the projection)
export const Y_SCALE = 0.8;
