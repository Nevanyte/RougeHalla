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
  x: t.number().default(0),
  y: t.number().default(0),
  /** Radians, ground plane. Purely cosmetic (last move/attack direction). */
  facing: t.number().default(0),
  hp: t.number().default(0),
  maxHp: t.number().default(0),
  /** PlayerStatus */
  status: t.string().default("lobby"),
  inventory: t.array(ItemState),
  /** 0..1 while extracting, 0 otherwise. */
  extractProgress: t.number().default(0),
  kills: t.uint8().default(0),
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

export const ZoneState = schema({
  x: t.number().default(0),
  y: t.number().default(0),
  r: t.number().default(0),
  /** Where the circle is shrinking to during the current stage. */
  nextX: t.number().default(0),
  nextY: t.number().default(0),
  nextR: t.number().default(0),
  stage: t.uint8().default(0),
}, "ZoneState");
export type ZoneState = SchemaType<typeof ZoneState>;

export const RaidState = schema({
  /** RaidPhase */
  phase: t.string().default("lobby"),
  seed: t.uint32().default(0),
  /** Server clock in ms since room creation, stamped every tick. Clients interpolate against it. */
  serverTime: t.number().default(0),
  tick: t.uint32().default(0),
  lobbyEndsAt: t.number().default(0),
  raidStartedAt: t.number().default(0),
  raidEndsAt: t.number().default(0),
  minPlayers: t.uint8().default(0),
  zone: t.ref(ZoneState),
  players: t.map(PlayerState),
  containers: t.map(ContainerState),
}, "RaidState");
export type RaidState = SchemaType<typeof RaidState>;
