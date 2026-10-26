// App flow: walkable hub → run (or training) → results → hub. Phaser owns the world canvas; menus are DOM.
import Phaser from "phaser";
import type { FxBatch, JoinOptions, RoomMode, RunResult, ServerMessages } from "@raid/shared";
import "./style.css";
import { detachRoom, isCallsignBusy, joinRaid, joinTraining, type RaidRoom } from "./net/connection";
import { JOIN_CLOSED_MESSAGE, JOIN_SLOW_MESSAGE, friendlyClose, friendlyError } from "./net/errors";
import { FxInbox } from "./net/fxInbox";
import { HubScene, type HubSceneData } from "./scenes/HubScene";
import { RaidScene } from "./scenes/RaidScene";
import { Banner } from "./ui/banner";
import { Chrome } from "./ui/chrome";
import { LoadingScreen, whenReady } from "./ui/loading";
import { Menu, type RaidRequest } from "./ui/menu";
import { ResultsScreen } from "./ui/results";
import { Toasts, type ToastTone } from "./ui/toast";
import { ViewportManager, measureLayout } from "./view/viewportManager";

const startView = measureLayout();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#1b1f24",
  // NONE: the viewport manager sizes the canvas (stage x devicePixelRatio, see view/viewportManager.ts), Phaser does not follow its parent.
  scale: { mode: Phaser.Scale.NONE, width: startView.deviceW, height: startView.deviceH, zoom: 1 },
  // Right-click is move-to. Set here once: a per-run call would add another canvas listener every run.
  disableContextMenu: true,
  scene: [HubScene, RaidScene],
});
// Keeps the stage, the canvas size, the cameras' zoom and the overlay's scale matching the window for the whole page.
new ViewportManager(game);

/** A killed player sees the "YOU DIED" line on its own this long before the results panel replaces it (other outcomes show at once). */
const DEATH_RESULTS_DELAY_MS = 1500;

let room: RaidRoom | null = null;
/** A `died` result waiting out DEATH_RESULTS_DELAY_MS; null otherwise. */
let pendingResult: { result: RunResult; timer: ReturnType<typeof setTimeout> } | null = null;

const menu = new Menu({
  onStart: (request) => void enterRoom("arena", request),
  onTraining: (request) => void enterRoom("training", request),
  onError: (message) => toasts.show(message, "error"),
});
const results = new ResultsScreen({ onContinue: () => backToMenu() });
const banner = new Banner();
const toasts = new Toasts();
// Takes over index.html's static #boot screen: up from page load until the hub is drawn, and again while a room is joined.
const loading = new LoadingScreen();
// FPS/ping readout, fullscreen, settings and help for the whole page. `chrome.modalOpen` is for the hub's `isBlocked`.
const chrome = new Chrome({ game, room: () => room });

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
  isBlocked: () => menu.modalOpen || chrome.modalOpen,
  leftInset: () => menu.dockInset(),
  state: () => ({ profile: menu.profile, faction: menu.faction, busy: menu.isBusy }),
};

function startHub(): void {
  game.scene.start("hub", hubData);
}


/** A join with no first state after this long is given up on, so the loading screen can never hold the page. */
const JOIN_TIMEOUT_MS = 15_000;
/** The page-load screen waits for the hub and the profile at most this long; the menu shows its own state after that. */
const BOOT_TIMEOUT_MS = 6_000;
/** Bumped by every join and every give-up: a join that finds it changed is no longer wanted and drops its room. */
let joinAttempt = 0;

/** A scene is running (started, created, not stopped). */
const sceneRunning = (key: string): boolean => game.scene.isActive(key) === true;

/** A join that failed or was given up on: the reason goes to the menu's status line and to a toast. */
function joinFailed(message: string): void {
  loading.hide();
  menu.show(message, "error");
  toasts.show(message, "error");
}

/**
 * Joins a room and hands it to the raid scene. An arena run is matchmade and ends with a result; training is a private
 * room of one that records nothing, so it has no result and leaving it just goes back to the hub.
 */
async function enterRoom(mode: RoomMode, request: RaidRequest): Promise<void> {
  const training = mode === "training";
  const attempt = ++joinAttempt;
  const wanted = (): boolean => attempt === joinAttempt;
  let pending: RaidRoom | null = null;
  let handedOver = false;
  const label = training ? "Entering training…" : "Joining run…";
  menu.setBusy(true, label);
  loading.show(label, {
    timeoutMs: JOIN_TIMEOUT_MS,
    onTimeout: () => {
      // Once the scene has the room, a slow first frame is not a failed join: the screen has hidden itself, that is all.
      if (!wanted() || handedOver) return;
      joinAttempt++;
      if (pending) {
        if (room === pending) room = null;
        detachRoom(pending);
      }
      joinFailed(JOIN_SLOW_MESSAGE);
    },
  });
  try {
    // A faction is sent only after a deliberate pick; without one the server assigns its default.
    const options: JoinOptions = { profile: request.profile, token: request.token, ...(request.faction ? { faction: request.faction } : {}) };
    pending = training ? await joinTraining(options) : await joinRaid(options);
  } catch (err) {
    console.error(err);
    if (!wanted()) return;
    if (isCallsignBusy(err)) {
      loading.hide();
      menu.showCallsignBusy();
      toasts.show(friendlyError(err), "error");
      return;
    }
    joinFailed(friendlyError(err));
    return;
  }
  // The wait ran out while the server was still answering: the room that arrived late is not wanted.
  if (!wanted()) {
    detachRoom(pending);
    return;
  }
  room = pending;
  const joined = pending;
  // Before anything is awaited: the server's first batch for a client that joins while arrows fly comes right after the full
  // state, and the scene is not there yet to take it. The SDK drops a message no handler is registered for.
  const fxs = new FxInbox();
  joined.onMessage("fxs", (batch: FxBatch) => fxs.push(batch));
  if (!(await firstState(joined))) {
    // The room closed before its first patch, so the leave handler below was never registered.
    if (room === joined) room = null;
    if (wanted()) joinFailed(JOIN_CLOSED_MESSAGE);
    return;
  }
  if (!wanted()) return;
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
  joined.onDrop((code, reason) => {
    if (room !== joined) return;
    console.warn(`room connection dropped (code ${code})`, reason);
    banner.reconnecting();
  });
  joined.onReconnect(() => {
    if (room !== joined) return;
    banner.reconnected();
  });
  joined.onLeave((code, reason) => {
    if (room !== joined) return;
    console.warn(`room closed (code ${code})`, reason);
    banner.hide();
    room = null;
    const message = friendlyClose(code, training);
    if (training) {
      backToMenu(message);
      toasts.show(message, "error");
      return;
    }
    // Losing the room during the death hold must not lose the results: show them now instead of waiting.
    flushPendingResult();
    if (!results.visible) {
      backToMenu(message);
      toasts.show(message, "error");
    }
  });
  menu.hide();
  game.scene.stop("hub");
  game.scene.start("raid", {
    room: joined,
    fxs,
    toast: (text: string, tone?: ToastTone) => toasts.show(text, tone),
    resultsVisible: () => results.visible,
    ...(training ? { leaveTraining: () => backToMenu() } : {}),
  });
  handedOver = true;
  // The loading screen goes once the raid scene has drawn; its own timeout covers a scene that never gets there.
  void whenReady(() => sceneRunning("raid")).then(() => { if (wanted()) loading.hide(); });
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
  loading.hide();
  results.hide();
  toasts.clear();
  game.scene.stop("raid");
  startHub();
  // Reloads the profile, so the GV balance includes what this run paid out.
  menu.show(message);
}

startHub();
menu.show();
// index.html's #boot goes once the hub scene has drawn and the profile has loaded or failed (the menu shows which).
loading.show("Loading…", { timeoutMs: BOOT_TIMEOUT_MS });
void Promise.all([whenReady(() => sceneRunning("hub")), menu.whenLoaded()]).then(() => { if (joinAttempt === 0) loading.hide(); });
