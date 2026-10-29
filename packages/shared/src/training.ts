// The training room's practice console (roguelike R4a/R5): the numbers both sides read. The `train` message itself is in
// messages.ts (TrainMessage); the server's handler is sim/training.ts, which refuses it outside a training world.
import { CHEST_OPTIONS } from "./constants";

/** The commands of a `train` message. */
export const TRAIN_CMDS = ["card", "stat", "camp", "chest", "clear"] as const;
export type TrainCmd = (typeof TRAIN_CMDS)[number];

/** A `card` with no `count` sets this many copies. */
export const TRAIN_DEFAULT_CARD_COUNT = 1;
/** The most copies of one card the console sets (a `count` above it is clamped; 0 removes the card; a unique card is capped at 1). */
export const TRAIN_MAX_CARD_COUNT = 9;
/** The copy counts the client's picker offers for a base card. */
export const TRAIN_CARD_COUNT_CHOICES: readonly number[] = [1, 2, 3, TRAIN_MAX_CARD_COUNT];
/** The normal-mob kill stacks the practice console can set. */
export const TRAIN_MOB_STAT_CHOICES: readonly number[] = [1, 5, 10];
/** Exact integer range shared with the uncapped mob-stat wire map. */
export const TRAIN_MAX_MOB_STAT_COUNT = Number.MAX_SAFE_INTEGER;

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
