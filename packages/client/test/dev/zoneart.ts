// The zone art dev page (test/dev/zoneart.html): see the html for the query. Dev only, never in the game build. It exposes
// `window.__zoneart` for the browser measurements (bake time, frame cost at camera spots) and screenshots.
import Phaser from "phaser";
import { TILE, WORLD_H, WORLD_W, Y_SCALE, generateMap, isEliteCamp, type GameMap } from "@raid/shared";
import "../../src/style.css";
import { MapView } from "../../src/render/MapView";
import { Minimap } from "../../src/ui/minimap";
import { PlanningView, type PlanningFrame } from "../../src/ui/planning";
import { RouteState } from "../../src/ui/route";
import { setView } from "../../src/view/viewState";
import { computeLayout } from "../../src/view/viewport";
import { ViewportManager, measureLayout } from "../../src/view/viewportManager";
import { synthMap } from "../synthFeatures";

const q = new URLSearchParams(location.search);
const seed = Number(q.get("seed") ?? 3);
const mode = q.get("mode") ?? "game";
const map: GameMap = q.get("synth") === "0" ? generateMap(seed) : synthMap({ seed });
const report = document.getElementById("report")!;
const say = (text: string): void => { report.textContent = text; };

interface Stats { n: number; avg: number; p50: number; p95: number; p99: number; max: number }
function stat(v: number[]): Stats {
  const s = [...v].sort((a, b) => a - b);
  const at = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return { n: v.length, avg: v.reduce((a, b) => a + b, 0) / Math.max(1, v.length), p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1] ?? 0 };
}

const api: Record<string, unknown> = { map, seed, mode };
(window as unknown as { __zoneart: Record<string, unknown> }).__zoneart = api;

if (mode === "game") {
  class ArtScene extends Phaser.Scene {
    view!: MapView;
    me!: Phaser.GameObjects.Arc;
    constructor() { super("art"); }
    create(): void {
      const t0 = performance.now();
      this.view = new MapView(this, map);
      const bakeMs = performance.now() - t0;
      this.me = this.add.circle(0, 0, 12, 0x69f0ae).setStrokeStyle(2, 0x0b0e11).setDepth(1e5);
      this.go(Number(q.get("cx") ?? 68), Number(q.get("cy") ?? 68));
      const z = q.get("zoom");
      if (z) this.cameras.main.setZoom(Number(z));
      api.bakeCtorMs = bakeMs;
      api.stats = this.view.bakeStats;
      api.children = this.children.length;
      this.time.delayedCall(200, () => { api.ready = true; });
      const fxStats = (this.view as unknown as { fx: { stats: unknown } | null }).fx?.stats;
      say(`seed ${seed} synth=${q.get("synth") !== "0"} bakeCtor ${bakeMs.toFixed(0)} ms  ${JSON.stringify(this.view.bakeStats)}  children ${this.children.length} fx ${JSON.stringify(fxStats)}`);
      this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
        const step = e.shiftKey ? 10 : 3;
        const c = this.cameras.main;
        const at = this.centre();
        if (e.key === "ArrowLeft" || e.key === "a") this.go(at.x - step, at.y);
        if (e.key === "ArrowRight" || e.key === "d") this.go(at.x + step, at.y);
        if (e.key === "ArrowUp" || e.key === "w") this.go(at.x, at.y - step);
        if (e.key === "ArrowDown" || e.key === "s") this.go(at.x, at.y + step);
        void c;
      });
    }
    centre(): { x: number; y: number } {
      const c = this.cameras.main;
      return { x: (c.scrollX + c.width / 2) / TILE, y: (c.scrollY + c.height / 2) / (TILE * Y_SCALE) };
    }
    /** The camera centre at tile (tx, ty). */
    go(tx: number, ty: number): void {
      const c = this.cameras.main;
      c.centerOn(tx * TILE, ty * TILE * Y_SCALE);
      this.me.setPosition(tx * TILE, ty * TILE * Y_SCALE);
    }
  }
  const start = measureLayout();
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent: "game", backgroundColor: "#1b1f24",
    scale: { mode: Phaser.Scale.NONE, width: start.deviceW, height: start.deviceH, zoom: 1 },
    disableContextMenu: true, render: { powerPreference: "high-performance", antialiasGL: false },
    scene: [ArtScene],
  });
  new ViewportManager(game);
  api.game = game;
  const scene = (): ArtScene => game.scene.getScene("art") as ArtScene;
  api.go = (tx: number, ty: number): void => scene().go(tx, ty);

  /**
   * Frame cost at camera spots: for each [tx, ty], warm up `warmMs`, then sample `frames` frames, as the CPU per frame (prestep to
   * postrender) and as the time between frames. Returns both per spot.
   */
  api.bench = async (spots: Array<[number, number]>, frames = 240, warmMs = 400): Promise<Array<{ spot: [number, number]; cpu: Stats; gap: Stats }>> => {
    const out: Array<{ spot: [number, number]; cpu: Stats; gap: Stats }> = [];
    for (const spot of spots) {
      scene().go(spot[0], spot[1]);
      await new Promise((r) => setTimeout(r, warmMs));
      const cpu: number[] = [];
      const gap: number[] = [];
      let t0 = 0;
      let last = performance.now();
      const onPre = (): void => { t0 = performance.now(); };
      const onPost = (): void => { if (t0) cpu.push(performance.now() - t0); t0 = 0; const now = performance.now(); gap.push(now - last); last = now; };
      game.events.on("prestep", onPre);
      game.events.on("postrender", onPost);
      await new Promise<void>((resolve) => {
        const tick = (): void => { if (cpu.length >= frames) resolve(); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      game.events.off("prestep", onPre);
      game.events.off("postrender", onPost);
      gap.shift();
      out.push({ spot, cpu: stat(cpu), gap: stat(gap) });
    }
    return out;
  };
} else {
  setView(computeLayout({ cssW: window.innerWidth, cssH: window.innerHeight, dpr: window.devicePixelRatio, hiDpi: true }));
  const root = document.getElementById("ui")!;
  const layout = measureLayout();
  root.style.setProperty("--ui-w", `${layout.uiW}px`);
  root.style.setProperty("--ui-h", `${layout.uiH}px`);
  root.style.setProperty("--ui-scale", String(layout.uiScale));
  setView(layout);
  if (mode === "minimap") {
    const mm = new Minimap();
    mm.setMap(map);
    mm.update(1000, { x: WORLD_W / 2, y: WORLD_H / 2 + 400 }, true, { x: WORLD_W / 2, y: (WORLD_H / 2) * Y_SCALE });
    api.minimap = mm;
    say(`minimap, ${map.camps.length} camps (${map.camps.filter(isEliteCamp).length} elite), features ${map.features.length}`);
    api.ready = true;
  } else {
    const route = new RouteState(null, null);
    const view = new PlanningView({ map, route, send: () => undefined });
    const m = mode === "tab" ? "map" : mode === "preview" ? "preview" : "planning";
    const frame: PlanningFrame = {
      mode: m, serverNow: 0, endsAt: 12_000, meReady: false,
      players: [{ faction: "plague", ready: false, me: true }, { faction: "holy", ready: false, me: false }, { faction: "fire", ready: true, me: false }],
      campTypes: [], local: m === "map" ? { x: WORLD_W / 2, y: WORLD_H / 2 + 600, alive: true } : null,
    };
    const a = 0, b = Math.max(1, map.spawnPool.findIndex((s) => s.zone !== map.spawnPool[a]!.zone));
    view.setPlan({ endsAt: 12_000, spawns: [a, b], taken: [false, false], pick: -1, boons: [], boon: -1 });
    view.update(frame);
    api.planning = view;
    say(`${mode}, ${map.camps.length} camps, features ${map.features.length}`);
    api.ready = true;
  }
}
