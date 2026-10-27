// The quest dialog's rules, pure so they are tested without a DOM (ui/questDialog.ts draws them): who the local player can talk to,
// and what a key press asks of the dialog. Nothing here is ever sent: the server decides every accept; this only avoids offering one
// it would refuse.
import { QUEST_ACCEPT_RANGE, hasLineOfSight, type GameMap, type Vec2 } from "@raid/shared";

/** An open dialog closes only beyond this, a little past the range it opens at, so weaving on the edge does not flicker it. */
export const QUEST_DIALOG_HYSTERESIS = 4;
export const QUEST_DIALOG_CLOSE_RANGE = QUEST_ACCEPT_RANGE + QUEST_DIALOG_HYSTERESIS;

/**
 * The server's accept rule (sim/quests.ts handleQuestAccept): within `range` of the giver and a line between the two that no
 * wall crosses (the collision map, gates included). Callers pass the local player's latest SERVER position, not the interpolated
 * one. A null map skips the line (a caller that has none).
 */
export function canTalk(map: GameMap | null, from: Vec2, to: Vec2, range = QUEST_ACCEPT_RANGE): boolean {
  if (Math.hypot(from.x - to.x, from.y - to.y) > range) return false;
  return map === null || hasLineOfSight(map, from, to);
}

/** What a key press asks of the dialog. */
export type QuestDialogKeyAction = { kind: "accept" } | { kind: "close" };

/**
 * Which dialog action a key press asks for, as KeyboardEvent.code: Enter or 1 accepts; Esc or F closes. They count only while
 * the dialog itself has the focus (opening it with F gives it the focus), so the digits are the weapon slots and Esc and F are the
 * game's whenever the player has clicked back into the world.
 */
export function questDialogKeyAction(code: string, s: { focused: boolean; shift: boolean }): QuestDialogKeyAction | null {
  if (s.shift || !s.focused) return null;
  if (code === "Enter" || code === "NumpadEnter" || code === "Digit1" || code === "Numpad1") return { kind: "accept" };
  if (code === "Escape" || code === "KeyF") return { kind: "close" };
  return null;
}
