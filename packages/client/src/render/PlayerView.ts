import Phaser from "phaser";
import {
  EFFECT_HIDDEN, GOLD_COLOR, GOLD_EDGE, PLAYER_RADIUS, TELEPORT_IMMUNITY_MS, WIRE_IDENTITY_MIRRORS, Y_SCALE, activeGold, barrierStrength,
  combatReadability, isFactionId, type CombatReadability,
  cssColor, unpackLook, wishOf, type Look,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { BARRIER_COLOR } from "../ui/buffTheme";
import { drawCombatIcon, STAT_ICON_COLORS } from "../ui/combatIcons";
import { around, bakedImage, ensureBake, pixelImage, placeBake, scaledPart, type Region } from "./bake";
import { BodyDisc, BodyFlash, FighterArt, HpBar, factionColor, heldWeapon, shadowImage, type FighterFields } from "./FighterArt";
import { FigureJuice, type DustSink } from "./FigureJuice";
import { displayName } from "./displayName";
import { BODY_LIFT, depthFor, projX, projY, screenAngle } from "./projection";
import { SignatureArt } from "./SignatureArt";
import { MarkPlate } from "./MarkPlate";
import { MarksMemory } from "./signatureLook";
import { StatusArt } from "./StatusArt";
import { TrailView } from "./TrailView";
import { FeetFx, NO_STATES, showsFeet, type TerrainStates } from "./zoneArt/terrainFeedback";
import { drawAbilityIcon } from "./wishArt";
import { juiceScale } from "./juice";

const HIT_FLASH_MS = 120;
const SHIELD_COLOR = 0x4fc3f7;
/** The barrier's bubble, redrawn when it moves by one of this many steps of a full shield (BARRIER_FULL_SHARE of max hp). */
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

/**
 * A skin is the body's inner core, not its whole fill: the outer disc stays the faction colour, which players need to
 * read at a distance (see "Readability" in the design doc).
 */
const SKIN_CORE_RADIUS = PLAYER_RADIUS * 0.55;

/** The local player's ring on the ground, as baked: its drawing's own coordinates around the feet. */
const LOCAL_RING_W = PLAYER_RADIUS * 2.9;
const LOCAL_RING_REGION: Region = { x0: -LOCAL_RING_W / 2 - 3, y0: -LOCAL_RING_W * Y_SCALE / 2 - 3, x1: LOCAL_RING_W / 2 + 3, y1: LOCAL_RING_W * Y_SCALE / 2 + 3 };
/** The default rim of a fighter's body: dark, or white on the local player. */
const RIM_DEFAULT = { width: 2, color: 0x111111, alpha: 0.8 } as const;
const RIM_LOCAL = { width: 2, color: LOCAL_MARK, alpha: 0.95 } as const;

/** The viewer's own fighter is drawn this faint while it is hidden (a Swarm); a hidden remote fighter is not drawn at all. */
const HIDDEN_LOCAL_ALPHA = 0.45;

/** The Wish icon beside the name: its box, the gap to the name, and the name's own bottom edge (see the label below). */
const WISH_ICON_SIZE = 10;
const WISH_ICON_GAP = 3;
/** The icon's drawing is baked around its own centre, once per Wish and ready state. */
const WISH_ICON_REGION: Region = around(WISH_ICON_SIZE / 2 + 2);
const LABEL_Y = -BODY_LIFT - PLAYER_RADIUS - 18;

/** The title hangs under the feet, clear of everything above the head: the shadow ellipse ends 0.55 * PLAYER_RADIUS below. */
const TITLE_Y = Math.ceil(PLAYER_RADIUS * 0.55) + 2;

/** Golden faction: a halo hugging the body that breathes between these alphas. */
const GOLD_HALO_RADIUS = PLAYER_RADIUS + 3;
const GOLD_PULSE_MS = 350;
const GOLD_PULSE_MIN = 0.7;
/** How much of the equipped outline's colour turns gold under a golden faction. */
const GOLD_OUTLINE_MIX = 0.5;

function mixColor(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * One player drawn as a raised disc over a ground shadow, y-sorted by ground position. The disc takes its faction's
 * colour; equipped cosmetics (skin core, outline, title, trail, golden looks) come from the synced `look` word.
 */
export class PlayerView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly body: BodyDisc;
  private readonly core: BodyDisc;
  private readonly nose: Phaser.GameObjects.Image;
  private readonly hpBar: HpBar;
  private readonly barrierRing: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly markPlate: MarkPlate;
  private readonly shieldRing: Phaser.GameObjects.Graphics;
  private readonly crown: Phaser.GameObjects.Graphics;
  private readonly crownLabel: Phaser.GameObjects.Text;
  private readonly goldHalo: Phaser.GameObjects.Graphics;
  private readonly fireRoamGlow: Phaser.GameObjects.Graphics;
  private readonly strengthGlow: Phaser.GameObjects.Graphics;
  private readonly buildMarks: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly art: FighterArt;
  private readonly signatures: SignatureArt;
  private readonly status: StatusArt;
  /** The ground under it: flames, ripples, a skid streak, a resting ring. A scene object one depth under the container, not a child. Made the first time it has something to show, so a map without hazards (and the hub) allocates none. */
  private feet: FeetFx | null = null;
  /** The faction's Wish, drawn small to the left of the name: coloured while its cooldown is over, grey before. */
  private readonly wishIcon: Phaser.GameObjects.Image;
  /** What the icon was last drawn for (ability, ready, name: the name sets where it sits); "" = none. */
  private wishKey = "";
  /** The container's alpha as last set (1, or HIDDEN_LOCAL_ALPHA for the local fighter while hidden). */
  private bodyAlpha = 1;
  private readonly flashing: BodyFlash;
  private readonly marks = new MarksMemory();
  /** The bounty the crown was last drawn for (0 = hidden), so it is redrawn only when the number changes. */
  private crownBounty = 0;
  /** The barrier bubble as last drawn, in BARRIER_STEPS (0 = none). */
  private barrierStep = 0;
  private glowStep = -1;
  private buildMarksKey = "";
  private combatReadabilityKey = "";
  private cachedReadability: CombatReadability | null = null;
  /** The look word `look` was decoded from; -1 (never a uint32) until the first update, so even word 0 is decoded once. */
  private lookWord = -1;
  private look: Look | null = null;
  /** The fields the art reads, with the facing replaced: reused every frame a predicted facing is shown. */
  private readonly faced: FighterFields = {
    facing: 0, faction: "", weapon0: "", weapon1: "", slot: 0, drawStartedAt: 0,
    asMult: WIRE_IDENTITY_MIRRORS.asMult, windupMult: WIRE_IDENTITY_MIRRORS.windupMult,
  };
  private usingFaction: string | undefined;
  private usingWeapon: string | undefined;
  private factionGold = false;
  private trail: TrailView | null = null;
  /** Juice: the figure's pose (anticipation, lunge, squash and stretch); FxView sends its cues through `cues`. */
  private readonly fig: FigureJuice;
  readonly cues: FigureJuice["pose"];

  constructor(private readonly scene: Phaser.Scene, readonly isLocal: boolean, puffs?: DustSink) {
    const shadow = shadowImage(scene);
    // Local player: a ring around the feet, so it stays recognisable whatever its faction colour is.
    const mark = bakedImage(scene, "ring:local", LOCAL_RING_REGION, (g) => {
      g.lineStyle(2, LOCAL_MARK, 0.9).strokeEllipse(0, 0, LOCAL_RING_W, LOCAL_RING_W * Y_SCALE);
    }).setVisible(isLocal);
    this.art = new FighterArt(scene);
    this.signatures = new SignatureArt(scene);
    this.status = new StatusArt(scene);
    this.wishIcon = pixelImage(scene).setVisible(false);
    placeBake(this.wishIcon, WISH_ICON_REGION);
    this.strengthGlow = scene.add.graphics();
    this.goldHalo = scene.add.graphics().setVisible(false);
    this.fireRoamGlow = scene.add.graphics();
    this.buildMarks = scene.add.container(0, 0);
    this.body = new BodyDisc(scene, PLAYER_RADIUS, factionColor(""), this.isLocal ? RIM_LOCAL : RIM_DEFAULT);
    this.body.image.setPosition(0, -BODY_LIFT);
    this.core = new BodyDisc(scene, SKIN_CORE_RADIUS, 0xffffff);
    this.core.image.setPosition(0, -BODY_LIFT).setVisible(false);
    this.flashing = new BodyFlash(this.body, factionColor(""));
    // Shows the facing while nothing is in hand.
    this.nose = pixelImage(scene).setOrigin(0, 0.5).setPosition(0, -BODY_LIFT).setDisplaySize(PLAYER_RADIUS, 4).setTint(0x111111).setAlpha(0.8);
    this.hpBar = new HpBar(scene);
    this.barrierRing = scene.add.graphics();
    this.shieldRing = scene.add.graphics();
    this.label = scene.add.text(0, LABEL_Y, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: isLocal ? "#b9f6ca" : "#eceff1",
      stroke: "#000000", strokeThickness: 2,
    }).setOrigin(0.5, 1);
    this.markPlate = new MarkPlate(scene, LABEL_Y);
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
    this.setStroke(null, false);
    this.root = scene.add.container(0, 0, [
      shadow, mark, this.signatures.ground, this.strengthGlow, this.goldHalo, this.art.ground, this.body.image, this.barrierRing, this.core.image, this.nose,
      this.art.held, this.signatures.aura, this.shieldRing, this.hpBar.root, this.label, this.crown, this.crownLabel, this.title,
      this.status.g, this.wishIcon, this.buildMarks, this.markPlate.pips, this.markPlate.cues, this.fireRoamGlow,
    ]);
    this.fig = new FigureJuice([
      { obj: scaledPart(this.body.image), y0: -BODY_LIFT, scaled: true }, { obj: scaledPart(this.core.image), y0: -BODY_LIFT, scaled: true },
      { obj: this.goldHalo, y0: 0, scaled: true }, { obj: this.strengthGlow, y0: -BODY_LIFT, scaled: true }, { obj: this.barrierRing, y0: 0, scaled: true },
      { obj: this.shieldRing, y0: 0, scaled: true }, { obj: this.nose, y0: -BODY_LIFT, scaled: false },
      { obj: this.art.held, y0: -BODY_LIFT, scaled: false }, { obj: this.signatures.aura, y0: 0, scaled: false },
    ], this.art, puffs);
    this.cues = this.fig.pose;
  }

  /** Paints the body white for a moment (a hit landed on this player). */
  flash(ms = HIT_FLASH_MS): void {
    this.flashing.trigger(ms);
  }

  /**
   * What the player is using right now, for the golden variants (faction and weapon ids as in `GOLD_TARGETS`): update()
   * reports the faction and the weapon in hand. Cheap to call every frame: it only repaints on a change.
   */
  setUsing(using: { faction?: string; weapon?: string }): void {
    if (using.faction === this.usingFaction && using.weapon === this.usingWeapon) return;
    this.usingFaction = using.faction;
    this.usingWeapon = using.weapon;
    if (this.look) this.applyGold(this.look);
  }

  /**
   * `renderT`: the server time this frame is drawn at. `patchT`: the server time of the newest patch (see FighterArt).
   * `drawAsAlive`: the player's death is still ahead of the render time they are drawn at, so keep showing them.
   * `signatures`: draw the faction signature marks (the synced values freeze when a run ends, so only while it is active).
   * `facing`: the local player's predicted facing (net/localMotion.ts), which replaces the synced one while it walks; null for the synced one.
   * `ground`: what the tile under its feet does to it (render/zoneArt/terrainFeedback.ts); the feet effects show it.
   */
  update(
    x: number, y: number, p: PlayerState, renderT: number, patchT: number, drawAsAlive = false, signatures = false,
    facing: number | null = null, ground: TerrainStates = NO_STATES, markDim = false,
  ): void {
    const now = performance.now();
    // The look is set once at join and never changes in a run, so this decodes once per player.
    if (p.look !== this.lookWord) this.applyLook(p.look);
    this.flashing.tick();
    // A hidden fighter (a Swarm) is not drawn for anyone else; its owner sees it faint. The bit is read from the latest patch, like hp.
    const effects = p.effects | 0;
    const hidden = (effects & EFFECT_HIDDEN) !== 0;
    const visible = (drawAsAlive || p.status === "alive" || p.status === "lobby") && !(hidden && !this.isLocal);
    this.root.setVisible(visible);
    if (!visible) {
      this.trail?.reset();
      this.marks.read(0, 0, false);
      this.fig.reset();
      this.status.reset();
      this.feet?.hide();
      return;
    }
    const alpha = hidden && this.isLocal ? HIDDEN_LOCAL_ALPHA : 1;
    if (alpha !== this.bodyAlpha) {
      this.bodyAlpha = alpha;
      this.root.setAlpha(alpha);
    }
    this.flashing.setColor(factionColor(p.faction));
    this.root.setPosition(projX(x), projY(y));
    this.root.setDepth(depthFor(y));
    // Before art.update(), so a golden weapon look is on the very frame the weapon is drawn.
    const held = heldWeapon(p);
    this.setUsing({ faction: p.faction || undefined, weapon: held ?? undefined });
    const face = facing ?? p.facing;
    this.fig.frame(x, y, face, renderT, now); // juice: before the art, which reads the weapon's turn
    const weapon = this.art.update(facing === null ? p : this.facedAs(p, facing), renderT, patchT);
    this.nose.setVisible(weapon === null).setRotation(screenAngle(face));
    this.label.setText(displayName(p));
    this.markPlate.update(signatures ? p.markTier : 0, signatures ? p.markTax : 0, signatures ? p.sig : 0, markDim, this.label.width);
    this.setWishIcon(p, renderT);
    const readability = this.readabilityFor(p);
    this.drawStrength(readability);
    this.drawBuildMarks(readability, p);
    // A death still ahead of render time: the patch already shows the fighter down with its marks cleared, so keep the last ones.
    this.marks.read(p.sig, p.brand, drawAsAlive && p.status !== "alive");
    this.signatures.update(this.marks.sig, this.marks.brand, signatures);
    this.status.update(effects, now);

    // The barrier (public state) rides the bar as a pale blue segment and wraps the body as a bubble.
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
    this.drawFireRoamGlow(p, now);

    // Only a drawn player is marked: the early return above hides the whole container (crown included) for the dead.
    this.setCrown(p.bounty > 0 ? Math.floor(p.bounty) : 0);

    if (this.factionGold) this.goldHalo.setAlpha(GOLD_PULSE_MIN + (1 - GOLD_PULSE_MIN) * (0.5 + 0.5 * Math.sin(now / GOLD_PULSE_MS)));
    this.trail?.update(x, y, now);
    if (this.feet === null && showsFeet(ground)) this.feet = new FeetFx(this.scene);
    this.feet?.update(ground, x, y, now);
  }

  /** A quiet ring winds up at full charge, then holds a bright ready glow around Fire's body. */
  private drawFireRoamGlow(p: PlayerState, now: number): void {
    this.fireRoamGlow.clear();
    if (p.faction !== "fire" || !p.roamReady) return;
    const motion = juiceScale("motion");
    const pulse = motion > 0 ? 0.5 + 0.5 * Math.sin(now / 180) : 0.5;
    const radius = PLAYER_RADIUS + 5 + pulse * 3;
    this.fireRoamGlow.lineStyle(2 + pulse, 0xff8a3d, 0.45 + pulse * 0.45);
    this.fireRoamGlow.strokeCircle(0, -BODY_LIFT, radius);
    this.fireRoamGlow.lineStyle(1, 0xffd166, 0.25 + pulse * 0.35);
    this.fireRoamGlow.strokeCircle(0, -BODY_LIFT, radius + 3);
  }

  /** The art's view of `p` with `facing` in place of the synced one. */
  private facedAs(p: PlayerState, facing: number): FighterFields {
    const f = this.faced;
    f.facing = facing;
    f.faction = p.faction;
    f.weapon0 = p.weapon0;
    f.weapon1 = p.weapon1;
    f.slot = p.slot;
    f.drawStartedAt = p.drawStartedAt;
    f.asMult = p.asMult;
    f.windupMult = p.windupMult;
    return f;
  }

  /** Decodes `word` and restyles the skin core, title and trail. Runs on the first update and whenever the word changes. */
  private applyLook(word: number): void {
    this.lookWord = word;
    const look = unpackLook(word);
    this.look = look;

    if (look.skin) {
      this.core.setFill(look.skin.color);
      this.core.image.setVisible(true);
    } else {
      this.core.image.setVisible(false);
    }

    if (look.title) this.title.setText(look.title.text).setColor(cssColor(look.title.color)).setVisible(true);
    else this.title.setVisible(false);

    if (this.trail?.cosmetic !== look.trail) {
      this.trail?.destroy();
      this.trail = look.trail ? new TrailView(this.scene, look.trail) : null;
    }

    this.applyGold(look);
  }

  /** The body's rim: the equipped outline, else the default (white on the local player). `gold` shifts it toward gold. */
  private setStroke(outline: Look["outline"] | null, gold: boolean): void {
    if (outline) {
      this.body.setRim(outline.width, gold ? mixColor(outline.color, GOLD_COLOR, GOLD_OUTLINE_MIX) : outline.color, 1);
    } else if (gold) {
      this.body.setRim(2.5, GOLD_EDGE, 1);
    } else {
      this.body.setRim(2, this.isLocal ? LOCAL_MARK : 0x111111, this.isLocal ? 0.95 : 0.8);
    }
  }

  /** Rim, golden-faction halo and golden weapon: everything that depends on both the look and what the player is using. */
  private applyGold(look: Look): void {
    const using: { faction?: string; weapon?: string } = {};
    if (this.usingFaction !== undefined) using.faction = this.usingFaction;
    if (this.usingWeapon !== undefined) using.weapon = this.usingWeapon;
    const gold = activeGold(look, using);

    this.setStroke(look.outline ?? null, gold.faction !== undefined);

    this.factionGold = gold.faction !== undefined;
    this.goldHalo.clear().setVisible(this.factionGold).setAlpha(1);
    if (this.factionGold) {
      this.goldHalo.fillStyle(GOLD_COLOR, 0.2).fillCircle(0, -BODY_LIFT, GOLD_HALO_RADIUS + 3);
      this.goldHalo.lineStyle(2, GOLD_COLOR, 0.95).strokeCircle(0, -BODY_LIFT, GOLD_HALO_RADIUS);
    }

    this.art.setGold(gold.weapon !== undefined);
  }

  /**
   * The faction's Wish beside the name, redrawn only when its look changes: coloured once `renderT` has passed its ready time
   * (the cooldown, or the first 45 s of a run, is over), grey before. Nothing for a fighter with no faction, nor in the lobby,
   * where every ready time is 0 until the run starts and the icon would read "ready".
   */
  private setWishIcon(p: PlayerState, renderT: number): void {
    const def = p.status === "lobby" ? null : wishOf(p.faction);
    const ready = renderT >= p.wishReadyAt;
    const key = def ? `${def.id}|${ready ? 1 : 0}|${p.name}` : "";
    if (key === this.wishKey) return;
    this.wishKey = key;
    this.wishIcon.setVisible(def !== null);
    if (!def) return;
    const texture = ensureBake(this.scene, `wish:${def.id}:${ready ? 1 : 0}`, WISH_ICON_REGION, (g) => {
      drawAbilityIcon(g, def, 0, 0, WISH_ICON_SIZE, ready);
    });
    if (this.wishIcon.texture.key !== texture) this.wishIcon.setTexture(texture);
    // Left of the name's left edge (Phaser's text width once set; a fake or a font not yet measured falls back to an estimate).
    const width = typeof this.label.width === "number" && this.label.width > 0 ? this.label.width : p.name.length * 6;
    this.wishIcon.setPosition(-width / 2 - WISH_ICON_GAP - WISH_ICON_SIZE / 2, LABEL_Y - 6.5);
  }

  /** Draws the barrier bubble at `strength` (0..1: barrierStrength, a barrier against BARRIER_FULL_SHARE of max hp); 0 clears it. A no-op while the step is unchanged. */
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

  /** Cache the card-based strength summary until its public inputs change. */
  private readabilityFor(p: PlayerState): CombatReadability {
    let buildKey = "";
    p.build?.forEach((count, id) => { buildKey += `${id}:${count},`; });
    let mobKey = "";
    p.mobStats?.forEach((count, id) => { mobKey += `${id}:${count},`; });
    const key = `${p.faction}|${p.maxHp}|${p.asMult}|${p.adBonus}|${p.apBonus}|${p.armorBonus}|${p.shieldBonus}|${p.speedMult}|${p.campClears}|${buildKey}|${mobKey}`;
    if (key !== this.combatReadabilityKey || this.cachedReadability === null) {
      this.combatReadabilityKey = key;
      this.cachedReadability = combatReadability(p);
    }
    return this.cachedReadability;
  }

  /** A soft perimeter glow scales with public card-power growth, without implying a matchup result. */
  private drawStrength(readability: CombatReadability): void {
    const step = Math.max(0, Math.min(8, Math.round(readability.power * 8)));
    if (step === this.glowStep) return;
    this.glowStep = step;
    const g = this.strengthGlow;
    g.clear();
    if (step === 0) return;
    const strength = step / 8;
    g.fillStyle(0xffc857, 0.025 + strength * 0.065).fillCircle(0, -BODY_LIFT, PLAYER_RADIUS + 7 + strength * 3);
    g.lineStyle(1 + strength * 2, 0xffd36a, 0.12 + strength * 0.34)
      .strokeCircle(0, -BODY_LIFT, PLAYER_RADIUS + 4 + strength * 2);
  }

  /** Three icons summarize the strongest stat investments; a fresh fighter has no invented rankings. */
  private drawBuildMarks(readability: CombatReadability, p: PlayerState): void {
    const stats = readability.investedStats.slice(0, 3);
    const crownScale = 1 + CROWN_GROWTH * Math.min(1, Math.max(0, p.bounty) / CROWN_FULL_BOUNTY);
    this.buildMarks.setY(p.bounty > 0 ? CROWN_BASE_Y - CROWN_H * crownScale - 12 : LABEL_Y - 25);
    const key = stats.map((s) => `${s.key}:${Math.round(s.score * 100)}`).join("|");
    if (key === this.buildMarksKey) return;
    this.buildMarksKey = key;
    this.buildMarks.removeAll(true);
    if (stats.length === 0) return;
    stats.forEach((stat, i) => {
      const x = (i - (stats.length - 1) / 2) * 14;
      const color = STAT_ICON_COLORS[stat.key];
      const mark = this.scene.add.graphics();
      mark.fillStyle(0x101820, 0.95).fillRoundedRect(x - 7, -7, 14, 14, 4);
      mark.lineStyle(1, color, 0.95).strokeRoundedRect(x - 7, -7, 14, 14, 4);
      drawCombatIcon(mark, stat.key, x, 0, 10, color);
      mark.setName(`${stat.label}: ${stat.score.toFixed(2)}`);
      this.buildMarks.add(mark);
    });
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
    this.feet?.destroy();
    this.feet = null;
    this.trail?.destroy();
    this.trail = null;
  }
}
