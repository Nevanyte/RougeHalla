// The training room's practice console (roguelike R4a/R5): the numbers both sides read. The `train` message itself is in
// messages.ts (TrainMessage); the server's handler is sim/training.ts, which refuses it outside a training world.
import { CHEST_OPTIONS } from "./constants";

/** The commands of a `train` message. */
export const TRAIN_CMDS = ["buff", "passive", "camp", "chest", "clear"] as const;
export type TrainCmd = (typeof TRAIN_CMDS)[number];

/** A `buff` with no `amount` sets this many stacks (the quoted value of every buff, BUFF_REF_STACKS). */
export const TRAIN_DEFAULT_STACKS = 3;
/** The most stacks the console sets (an `amount` above it is clamped; 0 removes the buff). */
export const TRAIN_MAX_STACKS = 12;
/** The stack counts the client's picker offers. */
export const TRAIN_STACK_CHOICES: readonly number[] = [1, 3, 6, TRAIN_MAX_STACKS];

/** A `passive` with no `rank` sets this one. Ranks run 0 (removes the passive) to SKILL_MAX_RANK. */
export const TRAIN_DEFAULT_RANK = 1;

/** A `chest` offers at most this many chosen options (the same as a camp's chest: CHEST_OPTIONS). */
export const TRAIN_MAX_CHEST_OPTIONS = CHEST_OPTIONS;

/** Practice mobs alive at once, and ever spawned in one training room (the fx roster never shrinks, so spawns are bounded). */
export const TRAIN_MAX_MOBS = 12;
export const TRAIN_MAX_MOBS_SPAWNED = 150;
/** Reward chests standing at once. */
export const TRAIN_MAX_CHESTS = 6;
/** A camp or a chest is refused when the last one was dropped less than this long ago (server ms). */
export const TRAIN_SPAWN_GAP_MS = 300;

/** How many mobs `camp` spawns: a camp of a normal type has this many, an elite type's is a lone elite. */
export const TRAIN_CAMP_SIZE = 3;
