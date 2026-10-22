// App flow: menu → raid → results → menu. Phaser owns the world canvas; menus are DOM.
import Phaser from "phaser";
import type { RaidResult, ServerMessages } from "@raid/shared";
import "./style.css";
import { joinRaid, type RaidRoom } from "./net/connection";
import { RaidScene } from "./scenes/RaidScene";
import { Banner } from "./ui/banner";
import { Menu } from "./ui/menu";
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

let room: RaidRoom | null = null;

const menu = new Menu({ onStart: (profile) => void startRaid(profile) });
const results = new ResultsScreen({ onContinue: () => backToMenu() });
const banner = new Banner();
const toasts = new Toasts();

async function startRaid(profile: string): Promise<void> {
  menu.setBusy(true, "Joining raid…");
  try {
    room = await joinRaid({ profile, loadout: [] });
  } catch (err) {
    console.error(err);
    menu.show(`Could not join: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const joined = room;
  await firstState(joined);
  joined.onMessage("result", (r: RaidResult) => results.show(r));
  joined.onMessage("toast", (t: ServerMessages["toast"]) => toasts.show(t.text));
  joined.onDrop(() => banner.show("Connection lost — reconnecting…"));
  joined.onReconnect(() => banner.hide());
  joined.onLeave((code) => {
    banner.hide();
    if (room !== joined) return;
    room = null;
    if (!results.visible) backToMenu(`Disconnected from raid (code ${code}).`);
  });
  menu.hide();
  game.scene.stop("idle");
  game.scene.start("raid", { room: joined });
}

/** joinOrCreate resolves before the first full state arrives; scenes assume a populated state. */
function firstState(r: RaidRoom): Promise<void> {
  if (r.state?.players) return Promise.resolve();
  return new Promise((resolve) => r.onStateChange.once(() => resolve()));
}

function backToMenu(message = ""): void {
  const leaving = room;
  room = null;
  void leaving?.leave();
  results.hide();
  toasts.clear();
  game.scene.stop("raid");
  game.scene.start("idle");
  menu.show(message);
}

menu.show();
