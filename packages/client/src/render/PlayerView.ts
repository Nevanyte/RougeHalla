import Phaser from "phaser";
import { PLAYER_RADIUS, TELEPORT_IMMUNITY_MS, Y_SCALE, barrierStrength } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { BARRIER_COLOR } from "../ui/buffTheme";
import { BodyFlash, FighterArt, HpBar, factionColor } from "./FighterArt";
import { BODY_LIFT, depthFor, projX, projY, screenAngle } from "./projection";

const HIT_FLASH_MS = 120;
const SHIELD_COLOR = 0x4fc3f7;
/** The kill barrier's bubble, redrawn when it moves by one of this many steps of a full (biggest combo) shield. */
const BARRIER_STEPS = 8;
/** The local player's marks: a white ring on the ground and a white rim on the body. */
const LOCAL_MARK = 0xffffff;

// The bounty crown sits above the name label, drawn from its base centre so scaling it grows it upward.
const CROWN_COLOR = 0xffd54f;
const CROWN_EDGE = 0x5d4037;
const CROWN_W = 22;
const CROWN_H = 13;
/** Clear of the name label (bottom at -BODY_LIFT - PLAYER_RADIUS - 18, 11px tall). */
const CROWN_BASE_Y = -BODY_LIFT - PLAYER_RADIUS - 33;
/** The crown grows from 1x to 1 + CROWN_GROWTH as the bounty approaches CROWN_FULL_BOUNTY (about a feed score of 8). */
const CROWN_GROWTH = 0.5;
const CROWN_FULL_BOUNTY = 150;

/** One player drawn as a raised disc over a ground shadow, y-sorted by ground position. The disc takes its faction's colour. */
export class PlayerView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Arc;
  private readonly nose: Phaser.GameObjects.Rectangle;
  private readonly hpBar: HpBar;
  private readonly barrierRing: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly shieldRing: Phaser.GameObjects.Graphics;
  private readonly crown: Phaser.GameObjects.Graphics;
  private readonly crownLabel: Phaser.GameObjects.Text;
  private readonly art: FighterArt;
  private readonly flashing: BodyFlash;
  /** The bounty the crown was last drawn for (0 = hidden), so it is redrawn only when the number changes. */
  private crownBounty = 0;
  /** The barrier bubble as last drawn, in BARRIER_STEPS (0 = none). */
  private barrierStep = 0;

  constructor(scene: Phaser.Scene, readonly isLocal: boolean) {
    const shadow = scene.add.ellipse(0, 0, PLAYER_RADIUS * 2.2, PLAYER_RADIUS * 1.1, 0x000000, 0.35);
    // Local player: a ring around the feet, so it stays recognisable whatever its faction colour is.
    const mark = scene.add.graphics().setVisible(isLocal);
    mark.lineStyle(2, LOCAL_MARK, 0.9).strokeEllipse(0, 0, PLAYER_RADIUS * 2.9, PLAYER_RADIUS * 2.9 * Y_SCALE);
    this.art = new FighterArt(scene);
    this.body = scene.add.circle(0, -BODY_LIFT, PLAYER_RADIUS, factionColor(""))
      .setStrokeStyle(2, isLocal ? LOCAL_MARK : 0x111111, isLocal ? 0.95 : 0.8);
    this.flashing = new BodyFlash(this.body, factionColor(""));
    // Shows the facing while nothing is in hand.
    this.nose = scene.add.rectangle(0, -BODY_LIFT, PLAYER_RADIUS, 4, 0x111111, 0.8).setOrigin(0, 0.5);
    this.hpBar = new HpBar(scene);
    this.barrierRing = scene.add.graphics();
    this.shieldRing = scene.add.graphics();
    this.label = scene.add.text(0, -BODY_LIFT - PLAYER_RADIUS - 18, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: isLocal ? "#b9f6ca" : "#eceff1",
      stroke: "#000000", strokeThickness: 2,
    }).setOrigin(0.5, 1);
    this.crown = scene.add.graphics().setVisible(false);
    this.crown.fillStyle(CROWN_COLOR, 1).lineStyle(1.5, CROWN_EDGE, 1);
    this.crown.beginPath()
      .moveTo(-CROWN_W / 2, 0).lineTo(-CROWN_W / 2, -CROWN_H * 0.7).lineTo(-CROWN_W / 4, -CROWN_H * 0.3)
      .lineTo(0, -CROWN_H).lineTo(CROWN_W / 4, -CROWN_H * 0.3).lineTo(CROWN_W / 2, -CROWN_H * 0.7)
      .lineTo(CROWN_W / 2, 0).closePath().fillPath().strokePath();
    this.crown.setPosition(0, CROWN_BASE_Y);
    this.crownLabel = scene.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", fontStyle: "bold",
      color: "#ffe082", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 1).setVisible(false);
    this.root = scene.add.container(0, 0, [
      shadow, mark, this.art.ground, this.body, this.barrierRing, this.nose, this.art.held, this.shieldRing, this.hpBar.g, this.label,
      this.crown, this.crownLabel,
    ]);
  }

  /** Paints the body white for a moment (a hit landed on this player). */
  flash(ms = HIT_FLASH_MS): void {
    this.flashing.trigger(ms);
  }

  /**
   * `renderT`: the server time this frame is drawn at. `patchT`: the server time of the newest patch (see FighterArt).
   * `drawAsAlive`: the player's death is still ahead of the render time they are drawn at, so keep showing them.
   */
  update(x: number, y: number, p: PlayerState, renderT: number, patchT: number, drawAsAlive = false): void {
    this.flashing.tick();
    const visible = drawAsAlive || p.status === "alive" || p.status === "lobby";
    this.root.setVisible(visible);
    if (!visible) return;
    this.flashing.setColor(factionColor(p.faction));
    this.root.setPosition(projX(x), projY(y));
    this.root.setDepth(depthFor(y));
    const weapon = this.art.update(p, renderT, patchT);
    this.nose.setVisible(weapon === null).setRotation(screenAngle(p.facing));
    this.label.setText(p.name);

    // The kill barrier (public state) rides the bar as a pale blue segment and wraps the body as a bubble.
    const barrier = p.barrier > 0 ? p.barrier : 0;
    this.hpBar.draw(p.hp, p.maxHp, barrier, -BODY_LIFT - PLAYER_RADIUS - 8);
    this.setBarrier(barrierStrength(barrier, p.maxHp));

    // Immunity runs from the teleport tick `t` to t + TELEPORT_IMMUNITY_MS. `p` is the latest patch, ahead of the delayed
    // positions drawn here, so the ring is judged at render time: it shows from the moment this body lands in the
    // coliseum until the drawn world passes the end. Against server now it would sit on the old spot for ~INTERP_DELAY_MS
    // before the jump and vanish that much early.
    this.shieldRing.clear();
    const left = p.immuneUntil - renderT;
    if (left > 0 && left <= TELEPORT_IMMUNITY_MS) {
      this.shieldRing.lineStyle(3, SHIELD_COLOR, 0.35 + 0.65 * (left / TELEPORT_IMMUNITY_MS));
      this.shieldRing.strokeCircle(0, -BODY_LIFT, PLAYER_RADIUS + 6);
    }

    // Only a drawn player is marked: the early return above hides the whole container (crown included) for the dead.
    this.setCrown(p.bounty > 0 ? Math.floor(p.bounty) : 0);
  }

  /** Draws the barrier bubble at `strength` (0..1: how close to the biggest shield any combo gives); 0 clears it. A no-op while the step is unchanged. */
  private setBarrier(strength: number): void {
    const step = strength > 0 ? Math.max(1, Math.round(strength * BARRIER_STEPS)) : 0;
    if (step === this.barrierStep) return;
    this.barrierStep = step;
    const g = this.barrierRing;
    g.clear();
    if (step === 0) return;
    const s = step / BARRIER_STEPS;
    g.fillStyle(BARRIER_COLOR, 0.1 + 0.14 * s).fillCircle(0, -BODY_LIFT, PLAYER_RADIUS + 4);
    g.lineStyle(2 + s, BARRIER_COLOR, 0.45 + 0.5 * s).strokeCircle(0, -BODY_LIFT, PLAYER_RADIUS + 4);
  }

  /** Shows the crown for `bounty` GV, scaled with it; 0 hides it. A no-op while the number is unchanged. */
  private setCrown(bounty: number): void {
    if (bounty === this.crownBounty) return;
    this.crownBounty = bounty;
    const on = bounty > 0;
    this.crown.setVisible(on);
    this.crownLabel.setVisible(on);
    if (!on) return;
    const scale = 1 + CROWN_GROWTH * Math.min(1, bounty / CROWN_FULL_BOUNTY);
    this.crown.setScale(scale);
    this.crownLabel.setText(String(bounty)).setPosition(0, CROWN_BASE_Y - CROWN_H * scale - 1);
  }

  destroy(): void {
    this.root.destroy();
  }
}
