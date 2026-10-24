import Phaser from "phaser";
import { PLAYER_RADIUS, Y_SCALE } from "@raid/shared";
import type { MobState } from "@raid/shared/schema";
import { ELITE_COLOR } from "../ui/buffTheme";
import { BodyFlash, FighterArt, HpBar, factionColor } from "./FighterArt";
import { BODY_LIFT, depthFor, projX, projY, screenAngle } from "./projection";
import { SignatureArt } from "./SignatureArt";

const HIT_FLASH_MS = 120;
/** A mob's hp is far larger than a player's, so its bar is wider to match its weight on screen; an elite's wider still. */
const HP_BAR_W = 36;
const ELITE_BAR_W = 48;
const BAR_TOP = -BODY_LIFT - PLAYER_RADIUS - 8;
const LABEL_Y = -BODY_LIFT - PLAYER_RADIUS - 18;
/** A mob going down shrinks to this share of its size and fades out over this long (server time, so it follows render time). */
const DEATH_MS = 450;
const DEATH_SHRINK = 0.45;
/** An idle mob at full health keeps its name faint; once hurt or fighting it reads at full strength. */
const IDLE_LABEL_ALPHA = 0.5;

const LABEL_COLOR = "#b0bec5";
const ELITE_LABEL_COLOR = "#ffd54f";

/**
 * A neutral fighter drawn like a player without the player-only marks: the training dummy (grey, bar and name always on),
 * a regional mob (its faction's colour; the bar shows only once it is hurt or fighting, the name stays faint until then)
 * and an elite (the same, plus a gold ring on the ground, a gold-rimmed body, a star over the name and a gold name).
 */
export class MobView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Arc;
  private readonly nose: Phaser.GameObjects.Rectangle;
  private readonly hpBar: HpBar;
  private readonly label: Phaser.GameObjects.Text;
  private readonly eliteRing: Phaser.GameObjects.Graphics;
  private readonly eliteStar: Phaser.GameObjects.Graphics;
  private readonly art: FighterArt;
  private readonly signatures: SignatureArt;
  private readonly flashing: BodyFlash;
  /** What the elite marks and name were last set for. */
  private elite = false;
  private labelText = "";
  private labelAlpha = 1;
  /** Server time of the patch that first said this mob is dead; -1 while alive. The fade runs from it in render time. */
  private diedAt = -1;
  private fade = 1;

  constructor(scene: Phaser.Scene) {
    const shadow = scene.add.ellipse(0, 0, PLAYER_RADIUS * 2.2, PLAYER_RADIUS * 1.1, 0x000000, 0.35);
    // Two gold rings on the ground, flattened like every ground shape; drawn once, shown for elites.
    this.eliteRing = scene.add.graphics().setVisible(false);
    this.eliteRing.lineStyle(2.5, ELITE_COLOR, 0.95).strokeEllipse(0, 0, PLAYER_RADIUS * 3.4, PLAYER_RADIUS * 3.4 * Y_SCALE);
    this.eliteRing.lineStyle(1.5, ELITE_COLOR, 0.5).strokeEllipse(0, 0, PLAYER_RADIUS * 4.2, PLAYER_RADIUS * 4.2 * Y_SCALE);
    this.art = new FighterArt(scene);
    this.signatures = new SignatureArt(scene, HP_BAR_W / 2);
    this.body = scene.add.circle(0, -BODY_LIFT, PLAYER_RADIUS, factionColor("")).setStrokeStyle(2, 0x111111, 0.8);
    this.flashing = new BodyFlash(this.body, factionColor(""));
    this.nose = scene.add.rectangle(0, -BODY_LIFT, PLAYER_RADIUS, 4, 0x111111, 0.8).setOrigin(0, 0.5);
    this.hpBar = new HpBar(scene);
    this.label = scene.add.text(0, LABEL_Y, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: LABEL_COLOR, stroke: "#000000", strokeThickness: 2,
    }).setOrigin(0.5, 1);
    this.eliteStar = scene.add.graphics().setVisible(false);
    this.eliteStar.fillStyle(ELITE_COLOR, 1).lineStyle(1.5, 0x5d4037, 1);
    traceStar(this.eliteStar, 0, 0, 7, 3);
    this.eliteStar.fillPath().strokePath();
    this.root = scene.add.container(0, 0, [
      shadow, this.eliteRing, this.signatures.ground, this.art.ground, this.body, this.nose, this.art.held, this.signatures.aura,
      this.hpBar.g, this.label, this.eliteStar,
    ]);
  }

  flash(ms = HIT_FLASH_MS): void {
    this.flashing.trigger(ms);
  }

  /** `signatures`: draw the faction signature marks (only while a run is active, see PlayerView.update). */
  update(x: number, y: number, m: MobState, renderT: number, patchT: number, signatures = false): void {
    this.flashing.tick();
    const fade = this.deathFade(m, renderT, patchT);
    this.root.setVisible(fade > 0);
    if (fade <= 0) return;
    if (fade !== this.fade) {
      this.fade = fade;
      this.root.setAlpha(fade).setScale(1 - (1 - fade) * (1 - DEATH_SHRINK));
    }
    this.setElite(m.kind === "elite");
    this.flashing.setColor(factionColor(m.faction));
    this.root.setPosition(projX(x), projY(y));
    this.root.setDepth(depthFor(y));
    const weapon = this.art.update(m, renderT, patchT);
    this.nose.setVisible(weapon === null).setRotation(screenAngle(m.facing));

    this.signatures.update(m.sig, m.brand, signatures);
    // On the same clock as the fade: the state is dead ~INTERP_DELAY_MS before the body goes, and the bar and name stay until it does.
    const dying = this.diedAt >= 0 && renderT >= this.diedAt;
    // The dummy keeps its bar and name on. A regional mob shows its bar when hurt or fighting (its cooldown is running or a
    // bow is drawn), an elite always; a returning mob is hurt until it arrives, where it is whole again.
    const hurt = m.hp < m.maxHp - 0.01;
    const fighting = m.drawStartedAt > 0 || m.readyAt > patchT;
    const calm = m.kind !== "dummy" && !hurt && !fighting;
    if (dying || (calm && !this.elite) || m.maxHp <= 0) this.hpBar.hide();
    else this.hpBar.draw(m.hp, m.maxHp, 0, BAR_TOP, this.elite ? ELITE_BAR_W : HP_BAR_W);

    if (m.name !== this.labelText) {
      this.labelText = m.name;
      this.label.setText(m.name);
    }
    const alpha = calm && !this.elite && !dying ? IDLE_LABEL_ALPHA : 1;
    if (alpha !== this.labelAlpha) {
      this.labelAlpha = alpha;
      this.label.setAlpha(alpha);
    }
    this.label.setVisible(!dying);
    this.eliteStar.setVisible(this.elite && !dying);
  }

  destroy(): void {
    this.root.destroy();
  }

  /** 1 while alive; for a mob the state calls dead, how much of it is left (0..1) as the fade plays out in render time. */
  private deathFade(m: MobState, renderT: number, patchT: number): number {
    if (m.status === "alive") {
      this.diedAt = -1;
      return 1;
    }
    // The patch is ahead of what is drawn: the mob keeps its place until render time reaches it.
    if (this.diedAt < 0) this.diedAt = patchT;
    return Math.max(0, Math.min(1, 1 - (renderT - this.diedAt) / DEATH_MS));
  }

  private setElite(elite: boolean): void {
    if (elite === this.elite) return;
    this.elite = elite;
    this.eliteRing.setVisible(elite);
    this.body.setStrokeStyle(elite ? 3 : 2, elite ? ELITE_COLOR : 0x111111, elite ? 1 : 0.8);
    this.label.setColor(elite ? ELITE_LABEL_COLOR : LABEL_COLOR).setFontStyle(elite ? "bold" : "").setFontSize(elite ? 12 : 11);
    // Clear of the name's top edge; the bar and name sit where every mob's do.
    this.eliteStar.setPosition(0, LABEL_Y - 23);
  }
}

/** A star path (`points` tips, outer radius `outer`, inner `inner`) centred on (cx, cy), point up; the caller fills and strokes it. */
function traceStar(g: Phaser.GameObjects.Graphics, cx: number, cy: number, outer: number, inner: number, points = 5): void {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}
