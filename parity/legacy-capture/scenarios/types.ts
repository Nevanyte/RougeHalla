import type { FactionId, Vec2 } from "@raid/shared";
import type { World, SimConfig } from "../../../packages/server/src/sim/world";
export interface PlayerDef { id: string; faction: FactionId; at: Vec2; hp?: number; barrier?: number; weapon0?: string; weapon1?: string }
export interface Input { tick: number; player: string; type: string; msg: unknown; accepted?: boolean }
export interface Ctx { world: World; tick: number; send: (player: string, type: string, msg: unknown) => void; pos: (id: string) => Vec2 }
export interface Scenario {
  name: string;
  description: string;
  /** Which parts the Rust slice is expected to reproduce (the harness reads this). */
  parity: "slice" | "capture-only";
  rows: string[];
  randomSeed: number;
  players: PlayerDef[];
  maxTicks: number;
  budgeted?: boolean;
  /** Packet that will promote a catalogue scenario to the Rust comparison gate. */
  packet?: string;
  requires?: string[];
  modules?: string[];
  config?: Partial<SimConfig>;
  secrets?: { rewardSalt?: [number, number, number, number]; questSalt?: [number, number, number, number] };
  record?: Array<"mobs" | "fields" | "statuses" | "containers" | "combat" | "locks" | "signatures" | "landed" | "holyInactive" | "plague" | "roam">;
  generatedMapSeed?: number;
  vision?: { viewers: string[]; points: Vec2[]; spawnSeed?: number };
  factionSlice?: "player-engagement-holy-plague/1" | "player-engagement-holy-plague-fire/1" | "player-engagement-holy-plague-fire-frost/1" | "player-engagement-holy-plague-fire-frost-sentenced/1" | "player-engagement-holy-plague-fire-frost-sentenced-fireroam/1";
  containers?: Array<{ weapon: string; at: Vec2 }>;
  /** Explicit trusted raid bootstrap for the bounded Sentenced public producer triple. */
  bootstrapSpawns?: Vec2[];
  /** Called before each step with the tick about to run. */
  drive: (ctx: Ctx) => void;
  /** Out-of-band actions applied between steps, after the step of `tick` (as the Room does): a leave, a dropped connection,
   * a reconnect. Recorded in the fixture's `actions` so the Rust harness replays them. */
  actions?: Array<{ tick: number; player: string } & ({ kind: "remove" | "drop" | "reconnect"; type?: never } | { type: "leave" | "join" | "drop"; kind?: never })>;
}
