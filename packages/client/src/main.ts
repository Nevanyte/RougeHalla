// App flow: walkable hub → run (or training) → results → hub. Phaser owns the world canvas; menus are DOM.
import Phaser from "phaser";
import type { JoinOptions, RoomMode, RunResult, ServerMessages } from "@raid/shared";
import "./style.css";
import { detachRoom, isCallsignBusy, joinErrorMessage, joinRaid, joinTraining, type RaidRoom } from "./net/connection";
import { HubScene, type HubSceneData } from "./scenes/HubScene";
import { RaidScene } from "./scenes/RaidScene";
import { Banner } from "./ui/banner";
import { Menu, type RaidRequest } from "./ui/menu";
import { ResultsScreen } from "./ui/results";
import { Toasts } from "./ui/toast";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#1b1f24",
  scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
  // Right-click is move-to. Set here once: a per-run call would add another canvas listener every run.
  disableContextMenu: true,
  scene: [HubScene, RaidScene],
});

/** A killed player sees the "YOU DIED" line on its own this long before the results panel replaces it (other outcomes show at once). */
const DEATH_RESULTS_DELAY_MS = 1500;

let room: RaidRoom | null = null;
/** A `died` result waiting out DEATH_RESULTS_DELAY_MS; null otherwise. */
let pendingResult: { result: RunResult; timer: ReturnType<typeof setTimeout> } | null = null;

const menu = new Menu({
  onStart: (request) => void enterRoom("arena", request),
  onTraining: (request) => void enterRoom("training", request),
});
const results = new ResultsScreen({ onContinue: () => backToMenu() });
const banner = new Banner();
const toasts = new Toasts();

// The menu docks over the walkable hub; the scene and the menu mirror each other through these.
menu.setDocked(true);

/** Null until Phaser has booted its scenes. A stopped scene keeps what it is told and shows it when it starts again. */
function hubScene(): HubScene | null {
  const scene = game.scene.getScene("hub");
  return scene instanceof HubScene ? scene : null;
}
menu.onProfileChange((profile) => hubScene()?.setProfile(profile));
menu.onFactionChange((faction) => hubScene()?.setFaction(faction));
menu.onBusyChange((busy) => hubScene()?.setBusy(busy));

const hubData: HubSceneData = {
  onStation: (id) => menu.onStation(id),
  isBlocked: () => menu.modalOpen,
  leftInset: () => menu.dockInset(),
  state: () => ({ profile: menu.profile, faction: menu.faction, busy: menu.isBusy }),
};

function startHub(): void {
  game.scene.start("hub", hubData);
}


/**
 * Joins a room and hands it to the raid scene. An arena run is matchmade and ends with a result; training is a private
 * room of one that records nothing, so it has no result and leaving it just goes back to the hub.
 */
async function enterRoom(mode: RoomMode, request: RaidRequest): Promise<void> {
  const training = mode === "training";
  menu.setBusy(true, training ? "Entering training…" : "Joining run…");
  try {
    // A faction is sent only after a deliberate pick; without one the server assigns its default.
    const options: JoinOptions = { profile: request.profile, token: request.token, ...(request.faction ? { faction: request.faction } : {}) };
    room = training ? await joinTraining(options) : await joinRaid(options);
  } catch (err) {
    console.error(err);
    if (isCallsignBusy(err)) {
      menu.showCallsignBusy();
      return;
    }
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
  // Every handler ignores a room that is no longer the current one: a room left behind must not touch the next run.
  if (!training) {
    joined.onMessage("result", (r: RunResult) => {
      if (room !== joined) return;
      if (r.outcome !== "died") { results.show(r); return; }
      cancelPendingResult();
      pendingResult = { result: r, timer: setTimeout(flushPendingResult, DEATH_RESULTS_DELAY_MS) };
    });
  }
  joined.onMessage("toast", (t: ServerMessages["toast"]) => {
    if (room !== joined) return;
    toasts.show(t.text);
  });
  joined.onDrop(() => {
    if (room !== joined) return;
    banner.show("Connection lost — reconnecting…");
  });
  joined.onReconnect(() => {
    if (room !== joined) return;
    banner.hide();
  });
  joined.onLeave((code) => {
    if (room !== joined) return;
    banner.hide();
    room = null;
    if (training) {
      backToMenu(`Disconnected from training (code ${code}).`);
      return;
    }
    // Losing the room during the death hold must not lose the results: show them now instead of waiting.
    flushPendingResult();
    if (!results.visible) backToMenu(`Disconnected from the run (code ${code}).`);
  });
  menu.hide();
  game.scene.stop("hub");
  game.scene.start("raid", {
    room: joined,
    toast: (text: string) => toasts.show(text),
    resultsVisible: () => results.visible,
    ...(training ? { leaveTraining: () => backToMenu() } : {}),
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
  // Before the detach: a death result still waiting out its delay must not surface over the menu or the next run.
  cancelPendingResult();
  const leaving = room;
  room = null;
  // Detached rather than left politely: the room may be mid-reconnect, where leave() does nothing or throws, and
  // its handlers would never run again to hide the "reconnecting" banner.
  if (leaving) detachRoom(leaving);
  banner.hide();
  results.hide();
  toasts.clear();
  game.scene.stop("raid");
  startHub();
  // Reloads the profile, so the GV balance includes what this run paid out.
  menu.show(message);
}

startHub();
menu.show();
