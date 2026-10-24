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
export const PlayerState = schema({
  name: t.string().default(""),
  /** Equipped cosmetics as a packed word (see packLook in cosmetics.ts). Set when the player joins, never changed after. */
  look: t.uint32().default(0),
  x: t.number().default(0),
  y: t.number().default(0),
  /** Radians, ground plane: where the fighter aims (the shield faces it), or the way it walks when it doesn't aim. */
  facing: t.number().default(0),
  hp: t.number().default(0),
  maxHp: t.number().default(0),
  /** PlayerStatus */
  status: t.string().default("lobby"),
  /** FactionId: picked in the hub (JoinOptions.faction), else a server default. */
  faction: t.string().default(""),
  /** The two weapon slots (WeaponId, "" = empty) and which one is in hand. */
  weapon0: t.string().default(""),
  weapon1: t.string().default(""),
  slot: t.uint8().default(0),
  /** Server time the current bow draw began; 0 when not drawing. Every client draws the pull from it. */
  drawStartedAt: t.number().default(0),
  /** Server time the shared attack cooldown ends (the next attack, or draw, may start then). */
  readyAt: t.number().default(0),
  kills: t.uint8().default(0),
  /** GV earned so far this run (kills and mobs; a win bonus is added only when the run resolves). */
  gv: t.uint16().default(0),
  /** GV whoever kills this player is paid (see bountyFor); 0 while they aren't fed. */
  bounty: t.uint16().default(0),
  /** Server time until which damage to this player is ignored (teleport immunity); 0 = none. */
  immuneUntil: t.number().default(0),
  /** Signatures acting on this fighter (SIG_* bits: chilled, burning, diseased, execute), for visuals. */
  sig: t.uint8().default(0),
  /** How far the strongest Sentenced mark on this fighter has grown, in percent (steps of 5); 0 = not marked. */
  brand: t.uint8().default(0),
}, "PlayerState");
export type PlayerState = SchemaType<typeof PlayerState>;

/** A neutral fighter. Phase 9 has only training dummies ("dummy": no AI, no faction); Phase 11 adds regional mobs. */
export const MobState = schema({
  kind: t.string().default("dummy"),
  name: t.string().default(""),
  x: t.number().default(0),
  y: t.number().default(0),
  facing: t.number().default(0),
  hp: t.number().default(0),
  maxHp: t.number().default(0),
  /** "alive" | "dead" */
  status: t.string().default("alive"),
  /** FactionId, or "" for none (no armor or shield). */
  faction: t.string().default(""),
  weapon0: t.string().default(""),
  weapon1: t.string().default(""),
  slot: t.uint8().default(0),
  drawStartedAt: t.number().default(0),
  readyAt: t.number().default(0),
  sig: t.uint8().default(0),
  brand: t.uint8().default(0),
}, "MobState");
export type MobState = SchemaType<typeof MobState>;

/**
 * An arrow or a wand ball, synced once when loosed and never updated: every client computes its straight flight,
 * position(T) = (x, y) + (vx, vy) * (T - t) / 1000, until a `projEnd` fx gives where it stopped. Removed from the
 * state when it stops. A reflection removes it and adds a new one.
 */
export const ProjectileState = schema({
  /** ProjectileKind: "arrow" | "ball" */
  kind: t.string().default("arrow"),
  /** The combatant who owns it (the shooter, or the shield holder for a reflected arrow). */
  owner: t.string().default(""),
  x: t.number().default(0),
  y: t.number().default(0),
  /** World units per second. */
  vx: t.number().default(0),
  vy: t.number().default(0),
  /** Server time it left (x, y). */
  t: t.number().default(0),
  /** The most it can travel from (x, y). */
  range: t.number().default(0),
}, "ProjectileState");
export type ProjectileState = SchemaType<typeof ProjectileState>;

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
  tick: t.uint32().default(0),
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
  projectiles: t.map(ProjectileState),
  containers: t.map(ContainerState),
}, "RaidState");
export type RaidState = SchemaType<typeof RaidState>;
