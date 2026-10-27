// Where the J quest log sits. Pure: the overlay's laid-out size (`--ui-w` x `--ui-h`, view/viewport.ts) and the HUD plate's box
// in, a box out. The plate (status, vitals, arena timer, hint and the cards row) is the one thing on the
// left that matters, and it grows with the cards held, so the log is placed under its measured bottom edge instead
// of at a fixed top. The rest of the log's neighbourhood: the weapon bar and the toast stack at the bottom centre, the
// coliseum/sudden-death lines at the top centre, the minimap and the chest panel on the right.

/** The overlay's side gutter, as the HUD plate's own `left`. */
export const QUEST_LOG_GUTTER = 12;
/** Air between the plate and the log. */
export const QUEST_LOG_GAP = 8;
export const QUEST_LOG_MAX_WIDTH = 370;
export const QUEST_LOG_MIN_WIDTH = 260;
/** The log keeps its right edge short of the top-centre lines (sudden death, the teleport shield): about a third of the width. */
export const QUEST_LOG_WIDTH_SHARE = 0.34;
/** The weapon bar sits 14 px from the bottom, 64 px tall, with a hint line above it: nothing of the log goes below this. */
export const QUEST_LOG_BOTTOM_RESERVE = 108;
/** Room for the title and a slice of one row: a log squeezed by a very tall plate still scrolls. */
export const QUEST_LOG_MIN_HEIGHT = 96;
/** The plate's usual bottom when it cannot be measured (a status, the vitals and one line). */
export const QUEST_LOG_FALLBACK_PLATE_BOTTOM = 84;

export interface UiSize { w: number; h: number }

/** A box in the overlay's own (unscaled) pixels: what `offsetLeft`/`offsetTop`/`offsetWidth`/`offsetHeight` give. */
export interface PlateBox { left: number; top: number; right: number; bottom: number }

export interface QuestLogPlacement { left: number; top: number; width: number; maxHeight: number }

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

export function placeQuestLog(ui: UiSize, plate: PlateBox | null): QuestLogPlacement {
  const uiW = Math.max(0, finite(ui.w, 800));
  const uiH = Math.max(0, finite(ui.h, 600));
  const left = plate ? Math.max(0, Math.floor(finite(plate.left, QUEST_LOG_GUTTER))) : QUEST_LOG_GUTTER;
  const width = Math.max(
    0,
    Math.min(
      Math.max(QUEST_LOG_MIN_WIDTH, Math.min(QUEST_LOG_MAX_WIDTH, Math.round(uiW * QUEST_LOG_WIDTH_SHARE))),
      uiW - left - QUEST_LOG_GUTTER,
    ),
  );
  const plateBottom = plate ? finite(plate.bottom, QUEST_LOG_FALLBACK_PLATE_BOTTOM) : QUEST_LOG_FALLBACK_PLATE_BOTTOM;
  const top = Math.max(QUEST_LOG_GUTTER + 8, Math.ceil(plateBottom) + QUEST_LOG_GAP);
  const maxHeight = Math.max(QUEST_LOG_MIN_HEIGHT, Math.floor(uiH - top - QUEST_LOG_BOTTOM_RESERVE));
  return { left, top, width, maxHeight };
}
