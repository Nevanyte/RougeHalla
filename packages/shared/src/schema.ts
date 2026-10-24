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
  /** Server time the current bow draw began; 0 when not drawing. Every client draws the pull from it. */
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
  /** Buff stacks per stat (real numbers: mob drops scale with the reward curve). The bonuses follow buffs.ts. */
  stacksHp: t.float32().default(0),
  stacksAs: t.float32().default(0),
  stacksMs: t.float32().default(0),
  /** Hp the kill barrier (the hp combos) still absorbs; 0 = none. Not the faction's magic `shield` stat. */
  barrier: t.float32().default(0),
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
}, "MobState");
export type MobState = SchemaType<typeof MobState>;

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
  players: t.map(PlayerState),
  mobs: t.map(MobState),
  containers: t.map(ContainerState),
  /**
   * Every player and mob id, in the order the server first saw them; never reordered, shortened or reused. The fx
   * batches name a fighter by its index here (a byte, against 10 for a session id), see fxCodec.ts. Server code only
   * appends, through FxChannel.
   */
  roster: t.array("string"),
}, "RaidState");
export type RaidState = SchemaType<typeof RaidState>;
