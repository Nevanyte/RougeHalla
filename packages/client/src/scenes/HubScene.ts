// The walkable hub: a client-only scene (no room, no server) shown whenever the player is not in a run. The avatar walks
// around one room and uses stations; what a station does is the menu's business, reached through `onStation`. The layout
// and the walking rules are pure (hub/hubLayout.ts), the look is hub/hubArt.ts, and the avatar is a normal PlayerView fed
// a PlayerState lookalike (hub/hubAvatar.ts), so the player's skin, outline, title, trail and faction show here too.
import Phaser from "phaser";
import {
  FACTIONS, FACTION_WHEEL, PLAYER_RADIUS, PLAYER_SPEED, SIGNATURE_WEAPONS, WEAPONS, WEAPON_WHEEL, Y_SCALE, cssColor,
  type FactionId, type ProfileDTO,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { hubAvatarState, type HubAvatar } from "../hub/hubAvatar";
import {
  GEM_LIFT, KIOSK_HEIGHT, PILLAR_HEIGHT, PORTAL_HEIGHT, STEP_COUNT, STEP_RISE, WALL_HEIGHT_NORTH,
  drawDoor, drawFlame, drawFloorDecor, drawGem, drawKiosk, drawPedestal, drawPillar, drawShell, drawStairs, drawStationRing,
  drawWheel, shade,
} from "../hub/hubArt";
import {
  HUB_LAYOUT, frameAxis, kioskLabelAnchor, moveWithCollision, nearestStation, spawnPoint, stationRect,
  type HubLayout, type HubStation, type HubStationId, type Vec,
} from "../hub/hubLayout";
import { PlayerView } from "../render/PlayerView";
import { isTypingTarget } from "../ui/chrome";
import { projX, projY, unproject } from "../render/projection";
import { scrollForTopLeft } from "../view/viewport";
import { currentView } from "../view/viewState";

/** What the menu knows about the player; read when the scene starts, then kept current through the setters. */
export interface HubSceneState {
  profile: ProfileDTO | null;
  faction: FactionId | null;
  busy: boolean;
}

export interface HubSceneData {
  /** A station was used (E, or a click on it). The menu decides what that means. */
  onStation: (id: HubStationId) => void;
  /** True while a modal (the hub panels) is open: keys and clicks are ignored. */
  isBlocked?: () => boolean;
  /** Where the menu docked on the left ends, in the window's CSS pixels; the room is centred in what is left. */
  leftInset?: () => number;
  /** The player as the menu has it now (profile, pick, busy), so a restarted scene doesn't wait for the next change. */
  state?: () => HubSceneState;
}

// Everything stands on the floor layer or sorts by ground y like in a run; signs and prompts sit above all of it.
const DEPTH_FLOOR = -1e6;
const DEPTH_DECAL = -5e5;
const DEPTH_PROP = -4.9e5;
const DEPTH_SIGN = 1e5;
const DEPTH_PROMPT = 1e5 + 1;

/** Screen pixels a station's prop rises above its footprint: the click box and the highlight ring cover them. */
const LIFT: Readonly<Record<HubStation["kind"], number>> = {
  stairs: STEP_COUNT * STEP_RISE + PORTAL_HEIGHT + 8,
  door: 0,
  kiosk: KIOSK_HEIGHT + 20,
  decal: 0,
  pedestal: GEM_LIFT + 12,
};

/** The counter wheel's two pentagrams, centred this far left and right of the decal's middle. */
const WHEEL_OFFSET = 130;
const WHEEL_RADIUS = 64;
/** A node's name sits this far out on the same ray, on the side away from the node. */
const WHEEL_LABEL_SCALE = 1.2;

/** The room as the camera frames it: the back wall and its sign rise above the top of the floor. */
const VIEW_TOP = -(WALL_HEIGHT_NORTH + 34);
const VIEW_BOTTOM = HUB_LAYOUT.bounds.h * Y_SCALE + 12;
const VIEW_LEFT = 0;
const VIEW_RIGHT = HUB_LAYOUT.bounds.w;

const ARRIVE_DISTANCE = 2;
/** A walk that covers less than this share of its step is pressed against something: give up on it. */
const STUCK_SHARE = 0.2;
const INSET_POLL_MS = 250;

const DIRECTIONS: Readonly<Record<string, Vec>> = {
  KeyW: { x: 0, y: -1 }, ArrowUp: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 }, ArrowDown: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 }, ArrowLeft: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 }, ArrowRight: { x: 1, y: 0 },
};

interface HitBox { id: HubStationId; x0: number; y0: number; x1: number; y1: number }
/** Where the prompt goes and which corner of it sits there. */
interface Anchor { x: number; y: number; ox: number; oy: number }

/** A kiosk's sign is centred on its art: the counter's top face plus the prop on it reach about this far above the ground point. */
const KIOSK_SIGN_LIFT = 24;

/** Shortcuts must never fire while the player types; arrows also belong to a focused radio group or tab strip. */
function keyBelongsToPage(e: KeyboardEvent): boolean {
  for (const node of [e.target, document.activeElement]) {
    if (!(node instanceof HTMLElement)) continue;
    if (isTypingTarget(node)) return true;
    if (e.code.startsWith("Arrow") && node.closest('[role="radio"], [role="tab"]')) return true;
  }
  return false;
}

export class HubScene extends Phaser.Scene {
  private host: HubSceneData = { onStation: () => {} };
  private readonly layout: HubLayout = HUB_LAYOUT;

  // Kept across stops and restarts: the menu may call the setters while the scene is not running.
  private profile: ProfileDTO | null = null;
  private faction: FactionId | null = null;
  private busy = false;

  private built = false;
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private pos: Vec = spawnPoint(HUB_LAYOUT);
  private facing = Math.PI / 2;
  private avatar: HubAvatar = hubAvatarState(null, null, 0);
  private view: PlayerView | null = null;
  private walkTo: Vec | null = null;
  /** A station the avatar is walking to because it was clicked from out of reach; it is used on arrival. */
  private pending: HubStationId | null = null;
  private nearest: HubStation | null = null;
  private readonly held = new Set<string>();

  private wheels: Phaser.GameObjects.Graphics | null = null;
  private plates: Phaser.GameObjects.Graphics | null = null;
  private ring: Phaser.GameObjects.Graphics | null = null;
  private prompt: Phaser.GameObjects.Text | null = null;
  private gems: Array<{ gfx: Phaser.GameObjects.Graphics; y: number; phase: number }> = [];
  private flames: Array<{ gfx: Phaser.GameObjects.Graphics; phase: number }> = [];
  private hits: HitBox[] = [];
  private readonly promptAt = new Map<HubStationId, Anchor>();
  private insetTarget = 0;
  private insetNow = 0;
  private insetPolledAt = -Infinity;

  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
  private readonly onKeyUp = (e: KeyboardEvent): void => { this.held.delete(e.code); };
  private readonly onFocusLoss = (): void => { this.held.clear(); };
  private readonly onVisibility = (): void => { if (document.hidden) this.held.clear(); };

  constructor() {
    super("hub");
  }

  init(data?: HubSceneData): void {
    // Phaser re-sends the last data on a restart without any, and hands over {} when it never had some.
    if (data && typeof data.onStation === "function") this.host = data;
  }

  create(): void {
    const state = this.host.state?.();
    if (state) {
      this.profile = state.profile;
      this.faction = state.faction;
      this.busy = state.busy;
    }
    this.pos = spawnPoint(this.layout);
    this.facing = Math.PI / 2;
    this.walkTo = null;
    this.pending = null;
    this.nearest = null;
    this.held.clear();
    this.insetPolledAt = -Infinity;
    this.insetNow = this.insetTarget = this.pollInset();

    this.buildRoom();
    this.buildStations();
    this.buildWheelLabels();
    this.avatar = hubAvatarState(this.profile, this.faction, performance.now(), this.facing);
    this.view = new PlayerView(this, true);
    this.redrawPicks();
    this.refreshPrompt();
    this.frameCamera(0);

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.handlePointer(pointer));
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onFocusLoss);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.built = true;
  }

  // ------------------------------------------------------------------------------------------ menu → scene

  setProfile(profile: ProfileDTO | null): void {
    this.profile = profile;
    if (this.built) this.avatar = hubAvatarState(profile, this.faction, performance.now(), this.facing);
  }

  setFaction(faction: FactionId | null): void {
    if (faction === this.faction) return;
    this.faction = faction;
    if (!this.built) return;
    this.avatar = hubAvatarState(this.profile, faction, performance.now(), this.facing);
    this.redrawPicks();
    this.refreshPrompt();
  }

  setBusy(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    if (this.built) this.refreshPrompt();
  }

  // ------------------------------------------------------------------------------------------ frame

  update(time: number, delta: number): void {
    if (!this.built || !this.view) return;
    const dt = Math.min(delta, 100) / 1000;
    this.walk(dt);
    this.trackNearest();
    this.animate(time);

    this.avatar.facing = this.facing;
    this.avatar.x = this.pos.x;
    this.avatar.y = this.pos.y;
    const now = performance.now();
    this.view.update(this.pos.x, this.pos.y, this.avatar as unknown as PlayerState, now, now);
    this.frameCamera(dt, time);
  }

  private blocked(): boolean {
    return this.host.isBlocked?.() ?? false;
  }

  /** Keys first, else the right-click target. Both move the avatar through moveWithCollision at PLAYER_SPEED. */
  private walk(dt: number): void {
    let dx = 0;
    let dy = 0;
    if (!this.blocked()) {
      for (const code of this.held) {
        const d = DIRECTIONS[code];
        if (d) { dx += d.x; dy += d.y; }
      }
    }
    let step: Vec | null = null;
    if (dx !== 0 || dy !== 0) {
      this.walkTo = null;
      this.pending = null;
      const len = Math.hypot(dx, dy);
      step = { x: (dx / len) * PLAYER_SPEED * dt, y: (dy / len) * PLAYER_SPEED * dt };
    } else if (!this.blocked()) {
      const pointer = this.input.activePointer;
      // Holding the right button keeps steering; the press must have begun on the canvas, not on a menu.
      if (pointer.rightButtonDown() && pointer.downElement === this.game.canvas) {
        this.walkTo = this.pointerGround(pointer);
        this.pending = null;
      }
      if (this.walkTo) {
        const tx = this.walkTo.x - this.pos.x;
        const ty = this.walkTo.y - this.pos.y;
        const dist = Math.hypot(tx, ty);
        if (dist < ARRIVE_DISTANCE) this.walkTo = null;
        else {
          const reach = Math.min(dist, PLAYER_SPEED * dt);
          step = { x: (tx / dist) * reach, y: (ty / dist) * reach };
        }
      }
    }
    if (!step) return;
    const next = moveWithCollision(this.pos, step, PLAYER_RADIUS, this.layout);
    const wanted = Math.hypot(step.x, step.y);
    const moved = Math.hypot(next.x - this.pos.x, next.y - this.pos.y);
    this.pos = next;
    if (wanted > 0) this.facing = Math.atan2(step.y, step.x);
    if (this.walkTo && moved < wanted * STUCK_SHARE) this.walkTo = null;
  }

  /** Keeps `nearest` (and with it the prompt) current, and uses a station the avatar was sent to once it is in reach. */
  private trackNearest(): void {
    const s = nearestStation(this.pos, this.layout);
    if (s?.id !== this.nearest?.id) {
      this.nearest = s;
      this.refreshPrompt();
    }
    if (!this.pending) return;
    if (s?.id === this.pending) {
      const id = this.pending;
      this.pending = null;
      this.walkTo = null;
      this.fire(id);
    } else if (!this.walkTo) {
      this.pending = null;
    }
  }

  private animate(time: number): void {
    this.ring?.setAlpha(0.65 + 0.35 * Math.sin(time / 180));
    for (const g of this.gems) g.gfx.setY(g.y + Math.sin(time / 420 + g.phase) * 3);
    for (const f of this.flames) f.gfx.setScale(1, 0.88 + 0.18 * Math.sin(time / 85 + f.phase)).setAlpha(0.85 + 0.15 * Math.sin(time / 130 + f.phase));
  }

  /** The docked menu's right edge in the stage's own CSS pixels (the menu reports window pixels; bars can sit left of the stage). */
  private pollInset(): number {
    const inset = (this.host.leftInset?.() ?? 0) - currentView().stage.x;
    return Number.isFinite(inset) ? Math.max(0, inset) : 0;
  }

  /**
   * The room is centred when it fits in the part of the view the docked menu leaves free, else the view follows the
   * avatar and stops at the room's edges. The camera is zoomed (device pixels per world pixel) and the menu's inset is in
   * CSS pixels, so both are brought to world pixels: the view is `cam.width / zoom` wide and a CSS pixel is `dpr / zoom`.
   * Phaser zooms about the camera's centre, so the framed top-left goes through scrollForTopLeft.
   */
  private frameCamera(dt: number, time = 0): void {
    const cam = this.cameras.main;
    const zoom = cam.zoom;
    if (time - this.insetPolledAt >= INSET_POLL_MS) {
      this.insetPolledAt = time;
      this.insetTarget = this.pollInset();
    }
    const gap = this.insetTarget - this.insetNow;
    this.insetNow = Math.abs(gap) < 0.5 || dt === 0 ? this.insetTarget : this.insetNow + gap * Math.min(1, dt * 12);
    const viewW = cam.width / zoom;
    const viewH = cam.height / zoom;
    const inset = Math.min(this.insetNow * currentView().dpr / zoom, viewW * 0.6);
    const sx = frameAxis(projX(this.pos.x), viewW - inset, VIEW_LEFT, VIEW_RIGHT);
    const sy = frameAxis(projY(this.pos.y), viewH, VIEW_TOP, VIEW_BOTTOM);
    const scroll = scrollForTopLeft(sx - inset, sy, cam.width, cam.height, zoom);
    cam.setScroll(scroll.x, scroll.y);
  }

  // ------------------------------------------------------------------------------------------ input

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || this.blocked() || keyBelongsToPage(e)) return;
    if (Object.hasOwn(DIRECTIONS, e.code)) {
      this.held.add(e.code);
    } else if (e.code === "KeyE" && !e.repeat && this.nearest) {
      this.fire(this.nearest.id);
    }
  }

  private handlePointer(pointer: Phaser.Input.Pointer): void {
    // Phaser also hears presses on the DOM overlay; only ones that began on the canvas count.
    if (pointer.downElement !== this.game.canvas || this.blocked()) return;
    if (pointer.button === 2) {
      this.walkTo = this.pointerGround(pointer);
      this.pending = null;
    } else if (pointer.button === 0 && pointer.leftButtonDown()) {
      pointer.updateWorldPoint(this.cameras.main);
      const hit = this.hitStation(pointer.worldX, pointer.worldY);
      if (!hit) return;
      if (this.nearest?.id === hit.id) {
        this.fire(hit.id);
      } else {
        this.walkTo = { x: hit.stand.x, y: hit.stand.y };
        this.pending = hit.id;
      }
    }
  }

  private pointerGround(pointer: Phaser.Input.Pointer): Vec {
    pointer.updateWorldPoint(this.cameras.main);
    return unproject(pointer.worldX, pointer.worldY);
  }

  /** The station drawn under a world pixel, the southernmost first (it is in front). */
  private hitStation(wx: number, wy: number): HubStation | null {
    let best: HitBox | null = null;
    for (const h of this.hits) {
      if (wx < h.x0 || wx > h.x1 || wy < h.y0 || wy > h.y1) continue;
      if (!best || h.y1 > best.y1) best = h;
    }
    return best ? this.layout.stations.find((s) => s.id === best!.id) ?? null : null;
  }

  private fire(id: HubStationId): void {
    if (this.blocked()) return;
    if (this.busy && (id === "arena" || id === "training")) return;
    this.host.onStation(id);
  }

  // ------------------------------------------------------------------------------------------ prompt

  private promptText(s: HubStation): string {
    if (this.busy && (s.id === "arena" || s.id === "training")) return "Joining…";
    if (s.faction && s.faction === this.faction) return `${FACTIONS[s.faction].displayName} is your pick`;
    return `${s.key}: ${s.verb}`;
  }

  private refreshPrompt(): void {
    const s = this.nearest;
    const at = s ? this.promptAt.get(s.id) : undefined;
    if (!this.prompt || !this.ring) return;
    this.ring.clear();
    if (!s || !at) {
      this.prompt.setVisible(false);
      return;
    }
    // A pedestal's ring lies on the floor under the avatar; a prop's goes over it.
    this.ring.setDepth(s.kind === "pedestal" ? DEPTH_PROP + 2 : DEPTH_SIGN - 1);
    drawStationRing(this.ring, s, LIFT[s.kind]);
    this.prompt.setText(this.promptText(s)).setOrigin(at.ox, at.oy).setPosition(at.x, at.y).setVisible(true);
  }

  // ------------------------------------------------------------------------------------------ building

  private track<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.objects.push(object);
    return object;
  }

  private label(
    x: number, y: number, text: string, color: string, ox = 0.5, oy = 1, size = 12, depth = DEPTH_SIGN,
  ): Phaser.GameObjects.Text {
    return this.track(this.add.text(x, y, text, {
      fontFamily: "system-ui, sans-serif", fontSize: `${size}px`, fontStyle: "bold", color, align: "center",
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(ox, oy).setDepth(depth));
  }

  private buildRoom(): void {
    const shell = this.track(this.add.graphics().setDepth(DEPTH_FLOOR));
    drawShell(shell, this.layout);
    const decor = this.track(this.add.graphics().setDepth(DEPTH_FLOOR + 1));
    drawFloorDecor(decor, this.layout);
  }

  private buildStations(): void {
    this.hits = [];
    this.promptAt.clear();
    this.gems = [];
    this.flames = [];

    for (const r of this.layout.obstacles) {
      if (this.layout.stations.some((s) => s.kind === "kiosk" && sameRect(stationRect(s), r))) continue;
      const g = this.track(this.add.graphics().setDepth(r.y + r.h));
      drawPillar(g, r);
      const flame = this.track(this.add.graphics().setDepth(r.y + r.h + 0.1).setPosition(projX(r.x + r.w / 2), projY(r.y + r.h / 2) - PILLAR_HEIGHT));
      drawFlame(flame);
      this.flames.push({ gfx: flame, phase: r.x * 0.07 + r.y * 0.03 });
    }

    const groundTop = projY(this.layout.floor.y);
    for (const s of this.layout.stations) {
      const r = stationRect(s);
      const signColor = cssColor(shade(s.color, 0.55));
      switch (s.kind) {
        case "stairs": {
          drawStairs(this.track(this.add.graphics().setDepth(DEPTH_PROP)), s, this.layout);
          const sign = this.label(projX(s.x), groundTop - WALL_HEIGHT_NORTH - 6, s.label, signColor, 0.5, 1, 14);
          this.promptAt.set(s.id, { x: sign.x, y: sign.y - sign.height - 4, ox: 0.5, oy: 1 });
          break;
        }
        case "door": {
          drawDoor(this.track(this.add.graphics().setDepth(DEPTH_PROP)), s);
          const sign = this.label(projX(r.x) - 20, projY(r.y) - 34, s.label, signColor, 1, 1, 12);
          this.promptAt.set(s.id, { x: sign.x - sign.width / 2, y: sign.y - sign.height - 4, ox: 0.5, oy: 1 });
          break;
        }
        case "kiosk": {
          drawKiosk(this.track(this.add.graphics().setDepth(r.y + r.h)), s);
          // To the east of the counter, below the avatars (it stands on this walkway), with the prompt after the text.
          const at = kioskLabelAnchor(s);
          const sign = this.label(projX(at.x), projY(at.y) - KIOSK_SIGN_LIFT, s.label, signColor, 0, 0.5, 11, DEPTH_PROP + 1);
          this.promptAt.set(s.id, { x: sign.x + sign.width + 8, y: sign.y, ox: 0, oy: 0.5 });
          break;
        }
        case "decal": {
          const sign = this.label(projX(s.x), projY(r.y) - 8, s.label, signColor, 0.5, 1, 12, DEPTH_DECAL + 5);
          this.promptAt.set(s.id, { x: sign.x, y: sign.y - sign.height - 4, ox: 0.5, oy: 1 });
          break;
        }
        case "pedestal": {
          const name = s.faction ? WEAPONS[SIGNATURE_WEAPONS[s.faction]].name : "";
          const sign = this.label(projX(s.x), projY(s.y) + s.w * 0.4 + 6, `${s.label}\n${name}`, cssColor(s.color), 0.5, 0, 11, DEPTH_PROP + 1);
          const gem = this.track(this.add.graphics().setDepth(s.y - 8).setPosition(projX(s.x), projY(s.y) - GEM_LIFT));
          drawGem(gem, s.color);
          this.gems.push({ gfx: gem, y: gem.y, phase: s.x * 0.05 });
          this.promptAt.set(s.id, { x: projX(s.x), y: projY(s.y) - GEM_LIFT - 22, ox: 0.5, oy: 1 });
          break;
        }
      }
      const lift = LIFT[s.kind];
      this.hits.push({ id: s.id, x0: projX(r.x), x1: projX(r.x + r.w), y0: projY(r.y) - lift, y1: projY(r.y + r.h) });
    }

    this.plates = this.track(this.add.graphics().setDepth(DEPTH_PROP));
    this.wheels = this.track(this.add.graphics().setDepth(DEPTH_DECAL));
    this.ring = this.track(this.add.graphics().setDepth(DEPTH_PROP + 2));
    this.prompt = this.track(this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", fontStyle: "bold", color: "#ffe082",
      backgroundColor: "rgba(20, 24, 30, 0.88)", padding: { x: 7, y: 3 },
    }).setOrigin(0.5, 1).setDepth(DEPTH_PROMPT).setVisible(false));
  }

  /** Names beside the nodes of both pentagrams, and a title under each. Static: only the highlight changes with the pick. */
  private buildWheelLabels(): void {
    const decal = this.layout.stations.find((s) => s.kind === "decal");
    if (!decal) return;
    const place = (cx: number, nodes: ReadonlyArray<{ x: number; y: number }>, names: string[], colors: number[], title: string): void => {
      nodes.forEach((n, i) => {
        const x = projX(cx + n.x * WHEEL_RADIUS * WHEEL_LABEL_SCALE);
        const y = projY(decal.y + n.y * WHEEL_RADIUS * WHEEL_LABEL_SCALE);
        // Text grows away from its node, so names never sit on a marker or run into the other wheel's.
        const ox = n.x > 0.3 ? 0 : n.x < -0.3 ? 1 : 0.5;
        const oy = Math.abs(n.x) > 0.3 ? 0.5 : n.y < 0 ? 1 : 0;
        this.label(x, y, names[i]!, cssColor(shade(colors[i]!, 0.35)), ox, oy, 9, DEPTH_DECAL + 5).setStroke("#000000", 2);
      });
      this.label(projX(cx), projY(decal.y + decal.h / 2) + 3, title, "#aeb7c2", 0.5, 0, 10, DEPTH_DECAL + 5);
    };
    place(decal.x - WHEEL_OFFSET, FACTION_WHEEL.nodes, FACTION_WHEEL.nodes.map((n) => FACTIONS[n.id].displayName),
      FACTION_WHEEL.nodes.map((n) => FACTIONS[n.id].color), "FACTIONS");
    place(decal.x + WHEEL_OFFSET, WEAPON_WHEEL.nodes, WEAPON_WHEEL.nodes.map((n) => WEAPONS[n.id].name),
      WEAPON_WHEEL.nodes.map((n) => WEAPONS[n.id].color), "WEAPONS");
  }

  /** The two pentagrams and the five pedestal plates, with the player's pick lit. */
  private redrawPicks(): void {
    const decal = this.layout.stations.find((s) => s.kind === "decal");
    if (this.wheels && decal) {
      this.wheels.clear();
      const weapon = this.faction ? SIGNATURE_WEAPONS[this.faction] : null;
      drawWheel(this.wheels, FACTION_WHEEL, decal.x - WHEEL_OFFSET, decal.y, WHEEL_RADIUS, (id) => FACTIONS[id].color, this.faction);
      drawWheel(this.wheels, WEAPON_WHEEL, decal.x + WHEEL_OFFSET, decal.y, WHEEL_RADIUS, (id) => WEAPONS[id].color, weapon);
    }
    if (this.plates) {
      this.plates.clear();
      for (const s of this.layout.stations) {
        if (s.kind === "pedestal") drawPedestal(this.plates, s, s.faction === this.faction);
      }
    }
  }

  // ------------------------------------------------------------------------------------------ shutdown

  private teardown(): void {
    this.built = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onFocusLoss);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.input.removeAllListeners();
    this.held.clear();
    this.view?.destroy();
    this.view = null;
    // Phaser has usually destroyed these with the scene already; destroy() is a no-op the second time.
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.wheels = this.plates = this.ring = this.prompt = null;
    this.gems = [];
    this.flames = [];
    this.hits = [];
    this.promptAt.clear();
    this.nearest = null;
    this.walkTo = null;
    this.pending = null;
  }
}

function sameRect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
