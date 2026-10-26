// Synced room state. Server imports this at runtime; the client only imports types
// (it decodes via schema reflection sent in the join handshake).
import { schema, t, type SchemaType } from "@colyseus/schema";

export const ItemState = schema({
  uid: t.string().default(""),
  /** A WeaponId. */
  def: t.string().default(""),
}, "ItemState");
export type ItemState = SchemaType<typeof ItemState>;

// Players and mobs share these fighter fields (the sim's Combatant reads and writes both the same way).
// float32 and uint32 here are wire widths only: the server's own values keep full double precision, and a client reads
// them rounded to float32 (positions, angles, hp) or truncated to whole ms (the timers). Timers must stay in 0..2^32.
export const PlayerState = schema({
  name: t.string().default(""),
  /** Equipped cosmetics as a packed word (see packLook in cosmetics.ts). Set when the player joins, never changed after. */
  look: t.uint32().default(0),
  x: t.float32().default(0),
  y: t.float32().default(0),
  /** Radians, ground plane: where the fighter aims (the shield faces it), or the way it walks when it doesn't aim. */
  facing: t.float32().default(0),
  hp: t.float32().default(0),
  maxHp: t.float32().default(0),
  /** PlayerStatus */
  status: t.string().default("lobby"),
  /** FactionId: picked in the hub (JoinOptions.faction), else a server default. */
  faction: t.string().default(""),
  /** The two weapon slots (WeaponId, "" = empty) and which one is in hand. */
  weapon0: t.string().default(""),
  weapon1: t.string().default(""),
  slot: t.uint8().default(0),
  /** The `seq` of the last `move` or `stop` the sim applied (0..255, wrapping): tells the client when its order took effect. */
  moveSeq: t.uint8().default(0),
  /** The state key of the fighter this player has locked and auto-attacks (a `target` order), or "" for none. */
  attackTarget: t.string().default(""),
  /** Server time the current bow draw (its windup) began; 0 when not drawing. Every client draws the pull from it. */
  drawStartedAt: t.uint32().default(0),
  /** Server time the shared attack cooldown ends (the next attack, or draw, may start then). */
  readyAt: t.uint32().default(0),
  kills: t.uint8().default(0),
  /** GV earned so far this run (kills and mobs; a win bonus is added only when the run resolves). */
  gv: t.uint16().default(0),
  /** GV whoever kills this player is paid (see bountyFor); 0 until they have enough player kills. */
  bounty: t.uint16().default(0),
  /** Server time until which damage to this player is ignored (teleport immunity); 0 = none. */
  immuneUntil: t.uint32().default(0),
  /** Signatures acting on this fighter (SIG_* bits: chilled, burning, diseased, execute), for visuals. */
  sig: t.uint8().default(0),
  /** How far the strongest Sentenced mark on this fighter has grown, in percent (steps of 5); 0 = not marked. */
  brand: t.uint8().default(0),
  /** Mobs killed this run (feed = kills + FEED_MOB_KILL_WEIGHT x this; it sets the mob reward curve; the bounty ignores mobs). */
  mobKills: t.uint16().default(0),
  // --- Buffs and stat mirrors (roguelike R4a; shared/buffs.ts, sim/buffs.ts, sim/mods.ts) ---
  /**
   * Buff stacks held, keyed by BuffId (a mob type id, shared/buffs.ts): real numbers, since a kill's grant is scaled by the
   * reward curve and a bounty moves half of each. An entry appears with the first stacks of that buff and is never removed
   * during the run. What they give follows buffs.ts (buffRows); the mirrors below carry what a client needs exactly.
   */
  buffs: t.map("float32"),
  /**
   * In wire form: the server's sim/mods.ts folds them and simulates with exactly these values (D22). Read them through
   * decodeMirrors (or decodeMult / decodeFlat) in shared/mods.ts, never raw. The multipliers are uint16 thousandths
   * (1000 = x1); the flat bonuses int16 tenths of a point. The defaults are the identity, and a mirror patches only when its
   * quantized value changes, so a fighter nothing buffs never patches them.
   */
  asMult: t.uint16().default(1000),
  windupMult: t.uint16().default(1000),
  speedMult: t.uint16().default(1000),
  armorBonus: t.int16().default(0),
  shieldBonus: t.int16().default(0),
  // --- end of the buffs and stat mirrors ---

  /** Hp a barrier still absorbs; 0 = none (no source since the kill combos went; R6 skills add one). Not the faction's magic `shield` stat. */
  barrier: t.float32().default(0),

  // --- Planning (roguelike R3, sim/planning.ts) ---
  /** The player pressed Ready on the planning screen (a latch). Only meaningful while phase is "planning"; the deal itself is private. */
  planReady: t.boolean().default(false),
  // --- end of planning ---
}, "PlayerState");
export type PlayerState = SchemaType<typeof PlayerState>;

/**
 * A neutral fighter: a training dummy ("dummy": no AI, no faction) or a regional mob ("mob" or "elite": its region's
 * faction scaled down, its region's weapon, an AI; see shared/mobs.ts). A dead mob stays "dead" for MOB_CORPSE_MS, then goes.
 */
export const MobState = schema({
  /** MobKind */
  kind: t.string().default("dummy"),
  name: t.string().default(""),
  x: t.float32().default(0),
  y: t.float32().default(0),
  facing: t.float32().default(0),
  hp: t.float32().default(0),
  maxHp: t.float32().default(0),
  /** "alive" | "dead" */
  status: t.string().default("alive"),
  /** FactionId, or "" for none (no armor or shield). */
  faction: t.string().default(""),
  weapon0: t.string().default(""),
  weapon1: t.string().default(""),
  slot: t.uint8().default(0),
  drawStartedAt: t.uint32().default(0),
  readyAt: t.uint32().default(0),
  sig: t.uint8().default(0),
  brand: t.uint8().default(0),
  /** A regional mob's type (MobTypeId, shared/mobs.ts MOB_TYPES): its skin and the buff it gives; "" for a dummy. */
  type: t.string().default(""),
  /** The camp it belongs to: its index in map.camps (and RaidState.camps) + 1; 0 = none (a dummy). */
  camp: t.uint8().default(0),
}, "MobState");
export type MobState = SchemaType<typeof MobState>;

/**
 * One camp's public runtime (roguelike R4a/R5), at the same index as its CampDef in `map.camps`; the geometry stays
 * seed-derived. Rosters are rolled server-side (world.rewardRandom) and published here at world build.
 */
export const CampState = schema({
  /** MobTypeId of the camp's normal mobs (an elite camp's elite is its zone's elite type). */
  type: t.string().default(""),
  /** "" | "?" | "skills" | "relic" | "cursed": what clearing it gives ("?" hides it until the first damage, R7). */
  reward: t.string().default(""),
  /** Mobs of the camp still alive. */
  alive: t.uint8().default(0),
  /** 0 idle, 1 engaged, 2 cleared. */
  state: t.uint8().default(0),
}, "CampState");
export type CampState = SchemaType<typeof CampState>;

export const ContainerState = schema({
  id: t.string().default(""),
  /** ContainerKind */
  kind: t.string().default("chest"),
  x: t.number().default(0),
  y: t.number().default(0),
  label: t.string().default(""),
  items: t.array(ItemState),
}, "ContainerState");
export type ContainerState = SchemaType<typeof ContainerState>;

export const RaidState = schema({
  /** RaidPhase */
  phase: t.string().default("lobby"),
  seed: t.uint32().default(0),
  /** Server clock in ms since room creation, stamped every tick. Clients interpolate against it. */
  serverTime: t.number().default(0),
  /** Fixed steps run since the room was created. Server only (the sim orders actions by it); clients use `serverTime`. */
  tick: t.uint32().noSync().default(0),
  lobbyEndsAt: t.number().default(0),
  raidStartedAt: t.number().default(0),
  minPlayers: t.uint8().default(0),
  /** Players in the run when it started (leavers are removed from `players`, so this is the HUD's N). */
  startedWith: t.uint8().default(0),
  /** Server time of the next teleport into the coliseum. 0 while the gates are locked, and outside an active run. */
  patienceEndsAt: t.number().default(0),
  /** True from the first teleport to the end of the run. */
  inColiseum: t.boolean().default(false),
  /** True from a teleport until the next death. Phase 8b derives the gate geometry from it with `withGates(map)`. */
  gatesLocked: t.boolean().default(false),
  /** While the gates are locked, the server time sudden death starts; 0 otherwise. */
  suddenDeathAt: t.number().default(0),
  /** Display name of the winner once the run is over; "" before that, and after a draw or a run nobody won. */
  winner: t.string().default(""),
  /** A training room (mode "training"): no timer, no results, no GV; a fighter who goes down is put back on its feet. */
  training: t.boolean().default(false),
  players: t.map(PlayerState),
  mobs: t.map(MobState),
  containers: t.map(ContainerState),
  /**
   * Every player and mob id, in the order the server first saw them; never reordered, shortened or reused. The fx
   * batches name a fighter by its index here (a byte, against 10 for a session id), see fxCodec.ts. Server code only
   * appends, through FxChannel.
   */
  roster: t.array("string"),
  /**
   * Server time the planning phase ends (roguelike R3; it can end sooner when every connected player is ready). Set when
   * planning starts, 0 outside it. The dealt spawns, picks and taken flags are never synced: they go in private `plan` messages.
   */
  planEndsAt: t.uint32().default(0),
  /** One per map camp, in `map.camps` order (roguelike R4a; filled at world build by the camps track, empty until then). */
  camps: t.array(CampState),
}, "RaidState");
export type RaidState = SchemaType<typeof RaidState>;
