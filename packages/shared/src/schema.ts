// Synced room state. Server imports this at runtime; the client only imports types
// (it decodes via schema reflection sent in the join handshake).
import { schema, t, type SchemaType } from "@colyseus/schema";

export const ItemState = schema({
  uid: t.string().default(""),
  def: t.string().default(""),
}, "ItemState");
export type ItemState = SchemaType<typeof ItemState>;

export const PlayerState = schema({
  name: t.string().default(""),
  /** Equipped cosmetics as a packed word (see packLook in cosmetics.ts). Set when the player joins, never changed after. */
  look: t.uint32().default(0),
  x: t.number().default(0),
  y: t.number().default(0),
  /** Radians, ground plane. Purely cosmetic (last move/attack direction). */
  facing: t.number().default(0),
  hp: t.number().default(0),
  maxHp: t.number().default(0),
  /** PlayerStatus */
  status: t.string().default("lobby"),
  inventory: t.array(ItemState),
  kills: t.uint8().default(0),
  /** GV earned so far this run (kills and mobs; a win bonus is added only when the run resolves). */
  gv: t.uint16().default(0),
  /** GV whoever kills this player is paid (see bountyFor); 0 while they aren't fed. */
  bounty: t.uint16().default(0),
  /** Server time until which damage to this player is ignored (teleport immunity); 0 = none. */
  immuneUntil: t.number().default(0),
}, "PlayerState");
export type PlayerState = SchemaType<typeof PlayerState>;

export const ContainerState = schema({
  id: t.string().default(""),
  /** ContainerKind */
  kind: t.string().default("crate"),
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
  containers: t.map(ContainerState),
}, "RaidState");
export type RaidState = SchemaType<typeof RaidState>;
