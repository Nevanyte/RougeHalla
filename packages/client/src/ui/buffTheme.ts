// Colours shared by the HUD's buff rows and the world effects, so a stat looks the same everywhere (colour is the only code).
import type { BuffStat } from "@raid/shared";

export const STAT_COLOR: Readonly<Record<BuffStat, number>> = {
  hp: 0xef9a9a,
  attackSpeed: 0xffb74d,
  moveSpeed: 0x4dd0e1,
};

/** The kill barrier (the hp combos' shield): a pale blue, apart from the stat colours and the teleport shield's 0x4fc3f7. */
export const BARRIER_COLOR = 0x81d4fa;

/** A mob a notch above the rest. */
export const ELITE_COLOR = 0xffd54f;
