// App flow: menu → raid → results → menu. Phaser owns the world canvas; menus are DOM.
import Phaser from "phaser";
import type { RaidResult, ServerMessages } from "@raid/shared";
import "./style.css";
import { joinErrorMessage, joinRaid, type RaidRoom } from "./net/connection";
import { RaidScene } from "./scenes/RaidScene";
import { Banner } from "./ui/banner";
import { Menu, type RaidRequest } from "./ui/menu";
import { ResultsScreen } from "./ui/results";
import { Toasts } from "./ui/toast";

class IdleScene extends Phaser.Scene {
  constructor() { super("idle"); }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#1b1f24",
  scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
  // Right-click is move-to. Set here once: a per-raid call would add another canvas listener every raid.
  disableContextMenu: true,
  scene: [IdleScene, RaidScene],
});

/** A killed player sees the "YOU DIED" line on its own this long before the results panel replaces it. */
const DEATH_RESULTS_DELAY_MS = 1500;

let room: RaidRoom | null = null;
/** A `died` result waiting out DEATH_RESULTS_DELAY_MS; null otherwise. */
let pendingResult: { result: RaidResult; timer: ReturnType<typeof setTimeout> } | null = null;

const menu = new Menu({ onStart: (request) => void startRaid(request) });
const results = new ResultsScreen({ onContinue: () => backToMenu() });
const banner = new Banner();
const toasts = new Toasts();

async function startRaid(request: RaidRequest): Promise<void> {
  menu.setBusy(true, "Joining raid…");
  try {
    room = await joinRaid(request);
  } catch (err) {
    console.error(err);
    // show() reloads the profile: a refused join may still have changed what the stash holds.
    menu.show(`Could not join: ${joinErrorMessage(err)}`);
    return;
  }
  const joined = room;
  if (!(await firstState(joined))) {
    // The room closed before its first patch, so the leave handler below was never registered.
    room = null;
    menu.show("Could not join: connection closed");
    return;
  }
  joined.onMessage("result", (r: RaidResult) => {
    if (r.outcome !== "died") { results.show(r); return; }
    cancelPendingResult();
    pendingResult = { result: r, timer: setTimeout(flushPendingResult, DEATH_RESULTS_DELAY_MS) };
  });
  joined.onMessage("toast", (t: ServerMessages["toast"]) => toasts.show(t.text));
  joined.onDrop(() => banner.show("Connection lost — reconnecting…"));
  joined.onReconnect(() => banner.hide());
  joined.onLeave((code) => {
    banner.hide();
    if (room !== joined) return;
    room = null;
    // Losing the room during the death hold must not lose the results: show them now instead of waiting.
    flushPendingResult();
    if (!results.visible) backToMenu(`Disconnected from raid (code ${code}).`);
  });
  menu.hide();
  game.scene.stop("idle");
  game.scene.start("raid", {
    room: joined,
    toast: (text: string) => toasts.show(text),
    resultsVisible: () => results.visible,
  });
}

function flushPendingResult(): void {
  const pending = pendingResult;
  if (!pending) return;
  cancelPendingResult();
  results.show(pending.result);
}

function cancelPendingResult(): void {
  if (pendingResult) clearTimeout(pendingResult.timer);
  pendingResult = null;
}

/**
 * joinOrCreate resolves before the first full state arrives; scenes assume a populated state.
 * Resolves false instead if the room closes first, which would otherwise leave the caller waiting forever.
 */
function firstState(r: RaidRoom): Promise<boolean> {
  if (r.state?.players) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onState = () => { r.onLeave.remove(onLeave); resolve(true); };
    const onLeave = () => { r.onStateChange.remove(onState); resolve(false); };
    r.onStateChange.once(onState);
    r.onLeave.once(onLeave);
  });
}

function backToMenu(message = ""): void {
  const leaving = room;
  room = null;
  void leaving?.leave();
  cancelPendingResult();
  results.hide();
  toasts.clear();
  game.scene.stop("raid");
  game.scene.start("idle");
  // Reloads the profile, so the stash shows what came home (or no longer has what was lost).
  menu.show(message);
}

menu.show();
