import Phaser from "phaser";
import { GOLD_COLOR, GOLD_EDGE, PLAYER_RADIUS, TELEPORT_IMMUNITY_MS, activeGold, cssColor, unpackLook, type Look } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { depthFor, projX, projY } from "./projection";
import { TrailView } from "./TrailView";

/** Screen pixels the body disc floats above the ground shadow; shots and floating text are drawn at this height too. */
export const BODY_LIFT = 14;
const LOCAL_COLOR = 0x4caf50;
const REMOTE_COLOR = 0xe5a823;
const HIT_COLOR = 0xffffff;
/** The flash on a near-white skin (it would not show): a light red instead. */
const HIT_COLOR_ON_PALE = 0xff8a80;
const HIT_FLASH_MS = 120;
const PALE_SKIN_LUMA = 0.8;
const DARK_SKIN_LUMA = 0.25;
const OUTLINE_WIDTH = 2;
const OUTLINE_COLOR = 0x111111;
const OUTLINE_ALPHA = 0.8;
const NOSE_COLOR = 0x111111;
const NOSE_COLOR_ON_DARK = 0xeceff1;
const NOSE_ALPHA = 0.8;
const SHIELD_COLOR = 0x4fc3f7;

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

/** The title hangs under the feet, clear of everything above the head: the shadow ellipse ends 0.55 * PLAYER_RADIUS below. */
const TITLE_Y = Math.ceil(PLAYER_RADIUS * 0.55) + 2;

/** Golden faction: a halo hugging the body that breathes between these alphas. */
const GOLD_HALO_RADIUS = PLAYER_RADIUS + 3;
const GOLD_PULSE_MS = 350;
const GOLD_PULSE_MIN = 0.7;
/** How much of the equipped outline's colour turns gold under a golden faction. */
const GOLD_OUTLINE_MIX = 0.5;

/** Perceived brightness of a 0xrrggbb colour, 0 to 1. */
function luma(color: number): number {
  return (0.299 * ((color >> 16) & 255) + 0.587 * ((color >> 8) & 255) + 0.114 * (color & 255)) / 255;
}

function mixColor(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** One player drawn as a raised disc over a ground shadow, y-sorted by ground position. */
export class PlayerView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Arc;
  private readonly nose: Phaser.GameObjects.Rectangle;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly shieldRing: Phaser.GameObjects.Graphics;
  private readonly crown: Phaser.GameObjects.Graphics;
  private readonly crownLabel: Phaser.GameObjects.Text;
  private readonly goldHalo: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly defaultColor: number;
  /** What the body is filled with when not flashing: the equipped skin, else the local/remote default. */
  private baseColor: number;
  private flashColor = HIT_COLOR;
  private darkBody = false;
  /** The look word `look` was decoded from; -1 (never a uint32) until the first update, so even word 0 is decoded once. */
  private lookWord = -1;
  private look: Look | null = null;
  private usingFaction: string | undefined;
  private usingWeapon: string | undefined;
  private factionGold = false;
  private trail: TrailView | null = null;
  /** The bounty the crown was last drawn for (0 = hidden), so it is redrawn only when the number changes. */
  private crownBounty = 0;
  /** performance.now() deadline of the hit flash; 0 when idle. Polled in update() so no timer needs cleaning up. */
  private flashUntil = 0;
  private flashing = false;

  constructor(private readonly scene: Phaser.Scene, readonly isLocal: boolean) {
    const color = isLocal ? LOCAL_COLOR : REMOTE_COLOR;
    this.defaultColor = this.baseColor = color;
    const shadow = scene.add.ellipse(0, 0, PLAYER_RADIUS * 2.2, PLAYER_RADIUS * 1.1, 0x000000, 0.35);
    this.goldHalo = scene.add.graphics().setVisible(false);
    this.body = scene.add.circle(0, -BODY_LIFT, PLAYER_RADIUS, color).setStrokeStyle(OUTLINE_WIDTH, OUTLINE_COLOR, OUTLINE_ALPHA);
    this.nose = scene.add.rectangle(0, -BODY_LIFT, PLAYER_RADIUS, 4, NOSE_COLOR, NOSE_ALPHA).setOrigin(0, 0.5);
    this.hpBar = scene.add.graphics();
    this.shieldRing = scene.add.graphics();
    this.label = scene.add.text(0, -BODY_LIFT - PLAYER_RADIUS - 18, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: isLocal ? "#b9f6ca" : "#ffe0a3",
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
    this.title = scene.add.text(0, TITLE_Y, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "10px", fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 0).setVisible(false);
    this.root = scene.add.container(0, 0, [
      shadow, this.goldHalo, this.body, this.nose, this.shieldRing, this.hpBar, this.label, this.crown, this.crownLabel, this.title,
    ]);
  }

  /** Paints the body white for a moment (a hit landed on this player). */
  flash(ms = HIT_FLASH_MS): void {
    this.flashUntil = performance.now() + ms;
    if (!this.flashing) {
      this.flashing = true;
      this.body.setFillStyle(this.flashColor);
    }
  }

  /**
   * What the player is using right now, for the golden variants (faction and weapon ids as in `GOLD_TARGETS`). The sim does
   * not report either yet; until something calls this, nothing glitters. Cheap to call every frame: it only repaints on a change.
   */
  setUsing(using: { faction?: string; weapon?: string }): void {
    if (using.faction === this.usingFaction && using.weapon === this.usingWeapon) return;
    this.usingFaction = using.faction;
    this.usingWeapon = using.weapon;
    if (this.look) this.applyGold(this.look);
  }

  /**
   * `renderT`: the server time this frame is drawn at. `drawAsAlive`: the player's death is still ahead of the render
   * time they are drawn at, so keep showing them.
   */
  update(x: number, y: number, p: PlayerState, renderT: number, drawAsAlive = false): void {
    const now = performance.now();
    // The look is set once at join and never changes in a run, so this decodes once per player.
    if (p.look !== this.lookWord) this.applyLook(p.look);
    if (this.flashing && now >= this.flashUntil) {
      this.flashing = false;
      this.flashUntil = 0;
      this.body.setFillStyle(this.baseColor);
    }
    const visible = drawAsAlive || p.status === "alive" || p.status === "lobby";
    this.root.setVisible(visible);
    if (!visible) {
      this.trail?.reset();
      return;
    }
    this.root.setPosition(projX(x), projY(y));
    this.root.setDepth(depthFor(y));
    this.nose.setRotation(p.facing);
    this.label.setText(p.name);

    const w = 28;
    const frac = p.maxHp > 0 ? Math.max(0, p.hp / p.maxHp) : 0;
    const top = -BODY_LIFT - PLAYER_RADIUS - 8;
    this.hpBar.clear();
    this.hpBar.fillStyle(0x000000, 0.6).fillRect(-w / 2, top, w, 4);
    this.hpBar.fillStyle(frac > 0.5 ? 0x66bb6a : frac > 0.25 ? 0xffca28 : 0xef5350, 1).fillRect(-w / 2, top, w * frac, 4);

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

    if (this.factionGold) this.goldHalo.setAlpha(GOLD_PULSE_MIN + (1 - GOLD_PULSE_MIN) * (0.5 + 0.5 * Math.sin(now / GOLD_PULSE_MS)));
    this.trail?.update(x, y, now);
  }

  /** Decodes `word` and restyles the body, title and trail. Runs on the first update and whenever the word changes. */
  private applyLook(word: number): void {
    this.lookWord = word;
    const look = unpackLook(word);
    this.look = look;

    const skin = look.skin?.color;
    this.baseColor = skin ?? this.defaultColor;
    const l = skin === undefined ? 0.5 : luma(skin);
    this.flashColor = l > PALE_SKIN_LUMA ? HIT_COLOR_ON_PALE : HIT_COLOR;
    this.darkBody = l < DARK_SKIN_LUMA;
    // A hit flash in progress is restored to the (now correct) base colour by update().
    if (!this.flashing) this.body.setFillStyle(this.baseColor);

    if (look.title) this.title.setText(look.title.text).setColor(cssColor(look.title.color)).setVisible(true);
    else this.title.setVisible(false);

    if (this.trail?.cosmetic !== look.trail) {
      this.trail?.destroy();
      this.trail = look.trail ? new TrailView(this.scene, look.trail) : null;
    }

    this.applyGold(look);
  }

  /** Outline, golden-faction halo and nose: everything that depends on both the look and what the player is using. */
  private applyGold(look: Look): void {
    const using: { faction?: string; weapon?: string } = {};
    if (this.usingFaction !== undefined) using.faction = this.usingFaction;
    if (this.usingWeapon !== undefined) using.weapon = this.usingWeapon;
    const gold = activeGold(look, using);
    const outline = look.outline;

    if (gold.faction) {
      if (outline) this.body.setStrokeStyle(outline.width, mixColor(outline.color, GOLD_COLOR, GOLD_OUTLINE_MIX), 1);
      else this.body.setStrokeStyle(OUTLINE_WIDTH + 0.5, GOLD_EDGE, 1);
    } else if (outline) {
      this.body.setStrokeStyle(outline.width, outline.color, 1);
    } else {
      this.body.setStrokeStyle(OUTLINE_WIDTH, OUTLINE_COLOR, OUTLINE_ALPHA);
    }

    this.factionGold = gold.faction !== undefined;
    this.goldHalo.clear().setVisible(this.factionGold).setAlpha(1);
    if (this.factionGold) {
      this.goldHalo.fillStyle(GOLD_COLOR, 0.2).fillCircle(0, -BODY_LIFT, GOLD_HALO_RADIUS + 3);
      this.goldHalo.lineStyle(2, GOLD_COLOR, 0.95).strokeCircle(0, -BODY_LIFT, GOLD_HALO_RADIUS);
    }

    if (gold.weapon) this.nose.setFillStyle(GOLD_COLOR, 1).setStrokeStyle(1, GOLD_EDGE, 1);
    else this.nose.setFillStyle(this.darkBody ? NOSE_COLOR_ON_DARK : NOSE_COLOR, NOSE_ALPHA).setStrokeStyle();
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
    this.trail?.destroy();
    this.trail = null;
  }
}
