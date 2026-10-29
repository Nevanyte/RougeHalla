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
  /** A server-filled bot (sim/step.ts addPlayer): set when the seat is created, never changes. It has no profile and banks nothing. */
  bot: t.boolean().default(false),
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
  /** How far the strongest Sentenced mark on this fighter has grown, in percent (markTier x 25); 0 = not marked. */
  brand: t.uint8().default(0),
  /** Mobs killed this run (feed = kills + FEED_MOB_KILL_WEIGHT x this; it sets the mob reward curve; the bounty ignores mobs). */
  mobKills: t.uint16().default(0),
  // --- Stat mirrors (roguelike R4a; shared/mods.ts, sim/mods.ts) ---
  /**
   * In wire form: the server's sim/mods.ts folds them and simulates with exactly these values (D22). Read them through
   * decodeMirrors (or decodeMult / decodeFlat) in shared/mods.ts, never raw. The multipliers are uint16 thousandths
   * (1000 = x1); the flat bonuses int16 tenths of a point. The defaults are the identity, and a mirror patches only when its
   * quantized value changes, so a fighter nothing modifies never patches them.
   */
  asMult: t.uint16().default(1000),
  windupMult: t.uint16().default(1000),
  speedMult: t.uint16().default(1000),
  armorBonus: t.int16().default(0),
  shieldBonus: t.int16().default(0),
  /** Attack damage and ability power (balance pass, BALANCE_CONTRACT 3.3): int16 tenths of a point like the two above, written only by recomputeMods. */
  adBonus: t.int16().default(0),
  apBonus: t.int16().default(0),
  // --- end of the stat mirrors ---

  /**
   * The run's cards (balance pass; shared/cards.ts): card id -> how many, from the camps' shared chests and quests. A base card
   * stacks ("ad2" held twice is 2); a conditional or an augment is held once. An entry appears with the first copy of that card and
   * is never removed during the run. What the cards give folds through sim/mods.ts (the mirrors above carry what a client needs);
   * cards.ts cardPower(build) is the power the PvP factor reads. Read it through cards.ts countIn (which also takes undefined or a
   * plain record).
   */
  build: t.map("uint8"),

  /** Hp a barrier still absorbs; 0 = none (no source since the kill combos went; R6 skills add one). Not the faction's magic `shield` stat. */
  barrier: t.float32().default(0),

  // --- Planning (roguelike R3, sim/planning.ts) ---
  /** The player pressed Ready on the planning screen (a latch). Only meaningful while phase is "planning"; the deal itself is private. */
  planReady: t.boolean().default(false),
  // --- end of planning ---
  /** Active statuses as EFFECT_* bits (status.ts): crowd control, slows, hidden, casting... For prediction, targeting and art. */
  effects: t.uint16().default(0),
  /** Server time each ability slot is ready again (0 = ready), read and written through slotReadyAt / setSlotReadyAt (abilities.ts). */
  wishReadyAt: t.uint32().default(0),
  qReadyAt: t.uint32().default(0),
  eReadyAt: t.uint32().default(0),
  /** +1 (wrapping) for every forced or ability displacement (a blink, a pull): a changed value is a cut for the interpolation, not a slide. */
  displaceSeq: t.uint8().default(0),
  // --- The mark (docs/SENTENCED_REDESIGN.md; appended after the Wishes' fields) ---
  /** The strongest Sentenced mark on this fighter: its tier 0..4 (0 = none), who holds it ("" = none), and the attack-speed cut the tax is making, in percent. */
  markTier: t.uint8().default(0),
  markBy: t.string().default(""),
  markTax: t.uint8().default(0),
  /** A Sentenced's kill-stacks this run, 0..MARK_KILL_STACK_CAP: each player kill, and a denied execute once per mark. */
  sentence: t.uint8().default(0),
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
  /** A regional mob's type (MobTypeId, shared/mobs.ts MOB_TYPES): its skin and its name; "" for a dummy. */
  type: t.string().default(""),
  /** The camp it belongs to: its index in map.camps (and RaidState.camps) + 1; 0 = none (a dummy). */
  camp: t.uint8().default(0),
  /** EFFECT_* bits, as on PlayerState. */
  effects: t.uint16().default(0),
  displaceSeq: t.uint8().default(0),
  /** The strongest Sentenced mark on this fighter, as on PlayerState. */
  markTier: t.uint8().default(0),
  markBy: t.string().default(""),
  markTax: t.uint8().default(0),
}, "MobState");
export type MobState = SchemaType<typeof MobState>;

/**
 * One camp's public runtime (roguelike R4a/R5), at the same index as its CampDef in `map.camps`; the geometry stays
 * seed-derived. Rosters are rolled server-side (world.rewardRandom) and published here at world build.
 */
export const CampState = schema({
  /** MobTypeId of the camp's normal mobs. */
  type: t.string().default(""),
  /**
   * "" | "?" | "skills" | "relic" | "cursed": what clearing it gives ("?" hides it until the first damage, R7). Left "" in R5:
   * every camp, elite ones included (D8), drops a skill chest until R7 sets the kinds.
   */
  reward: t.string().default(""),
  /** Mobs of the camp still alive. */
  alive: t.uint8().default(0),
  /**
   * 0 idle, 1 engaged, 2 cleared awaiting a full roster respawn. A respawn starts a new idle cycle.
   */
  state: t.uint8().default(0),
  /** MobTypeId of the camp's elite (the one standing at its `eliteSpot`), "" for a camp without an elite (balance contract 6.4). */
  elite: t.string().default(""),
  /** Public clear and full-roster respawn clocks; zero before a clear and after respawn. */
  clearedAt: t.number().default(0),
  respawnAt: t.number().default(0),
  /** Only this player receives the camp ward's vision, until its public expiry. */
  wardOwner: t.string().default(""),
  wardExpiresAt: t.number().default(0),
}, "CampState");
export type CampState = SchemaType<typeof CampState>;

/**
 * An area of the ability framework (a Trial's zone, a Swarm's cloud, a Blaze Step's trail). The server sets an entry once and
 * deletes it when it ends; it never moves one (a moving area is position(T) = (x, y) + v * (T - startedAt) / 1000, so clients
 * move it themselves). Kinds and abilities are indices into FIELD_KINDS and ABILITY_IDS (abilities.ts).
 */
export const FieldState = schema({
  kind: t.uint8().default(0),
  /** Styles the art. */
  ability: t.uint8().default(0),
  x: t.float32().default(0),
  y: t.float32().default(0),
  /** A line's other end. */
  x2: t.float32().default(0),
  y2: t.float32().default(0),
  /** Radius, or a line's half-width. */
  r: t.float32().default(0),
  /** A moving area's velocity; 0 for every area today. */
  vx: t.float32().default(0),
  vy: t.float32().default(0),
  /** The fighter that cast it, and the one it is on (a zone's subject; "" for none). */
  owner: t.string().default(""),
  subject: t.string().default(""),
  startedAt: t.uint32().default(0),
  endsAt: t.uint32().default(0),
}, "FieldState");
export type FieldState = SchemaType<typeof FieldState>;

export const ContainerState = schema({
  id: t.string().default(""),
  /** ContainerKind */
  kind: t.string().default("chest"),
  x: t.number().default(0),
  y: t.number().default(0),
  label: t.string().default(""),
  items: t.array(ItemState),
  // --- A camp's shared chest (kind "reward"; roguelike R5, sim/chests.ts). Unused (0 and empty) on every other kind. The
  // three empty arrays on each weapon container cost ~0.15-0.25 KB/s per client (they push every later ref id, players and
  // mobs, past one varint byte); `.optional()` on them would win it back (a Known TODO). ---
  /** The camp it dropped for: its index in map.camps (and RaidState.camps) + 1; 0 = none. */
  camp: t.uint8().default(0),
  /** Server time it vanishes (dropped + CHEST_SECONDS); a pick at or after it is refused. */
  expiresAt: t.uint32().default(0),
  /** The options, as SkillIds (shared/skills.ts), in card order. Public by design (D17): the UI shows them only in range. */
  options: t.array("string"),
  /** Parallel to `options`: "" while free, else the id of the player who took it. */
  takenBy: t.array("string"),
  /** Every player who has made their one pick here, an option or a skip, in the order they made it. */
  pickers: t.array("string"),
}, "ContainerState");
export type ContainerState = SchemaType<typeof ContainerState>;

/**
 * One publicly visible quest offer (shared/quests.ts has the def, keyed by `def`). Unknown quests stay in the server
 * runtime and have no entry here until their reveal head start ends. Every visible quest is a standing offer to all:
 * the first player to finish takes the reward.
 */
export const QuestState = schema({
  id: t.string().default(""),
  /** QuestDef id (the catalog is shared code, so only the id crosses the wire). */
  def: t.string().default(""),
  /** The giver's position (also a kind "quest" entry in `mobs`). */
  x: t.float32().default(0),
  y: t.float32().default(0),
  /** "open" | "done" | "expired". Public expired offers stay here for the quest log. */
  status: t.string().default("open"),
  /** Display name of who finished it. */
  doneBy: t.string().default(""),
  /** Server time the offer lapses. */
  expiresAt: t.number().default(0),
  /** Player id carrying this fetch quest's parcel, "" while it lies on the ground. */
  carrier: t.string().default(""),
  /** Objective progress per player id (kills or tokens, capped at the def's count). Only an accepting player's progress counts. */
  progress: t.map("float32"),
  /** Player ids that accepted this offer at its giver (`questAccept`); public, like `progress`. Nothing counts for a player not in it. */
  accepted: t.map("boolean"),
  /** Comma-separated visited zone ids per accepting player for the Grand Tour. */
  visitedRegions: t.map("string"),
}, "QuestState");
export type QuestState = SchemaType<typeof QuestState>;

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
  /** Public and revealed quest offers by runtime id. Unknown offers are absent, including their ids, defs and positions. */
  quests: t.map(QuestState),
  /** Number of offers still hidden from everyone. This count is the only synced information about them. */
  unknownQuests: t.uint8().default(0),
  /** The ability areas, keyed by field id: set once, then deleted. */
  fields: t.map(FieldState),
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

  // The map (roguelike R2, D20): it is never synced, only how to build it. Set once at world build.
  /** The certified generator attempt of `seed`: clients and bots run exactly `generateMap(seed, attempt)`, one attempt. */
  attempt: t.uint8().default(0),
  /** `mapHashU32` of the server's map. A client whose own map hashes to anything else has desynced, and leaves. */
  mapHash: t.uint32().default(0),
}, "RaidState");
export type RaidState = SchemaType<typeof RaidState>;
