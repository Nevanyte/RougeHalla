import Phaser from "phaser";
import { FACTIONS, SIG_EXEC_BLOCKED, SIG_SUPPRESSED, SIG_TAXED } from "@raid/shared";

const PIP_COLORS = [0x9e9e9e, 0xffb300, 0xe53935, 0x171717] as const;

/** Small nameplate cues for Sentenced marks. Repaints only when the server state or proximity changes. */
export class MarkPlate {
  readonly pips: Phaser.GameObjects.Graphics;
  readonly cues: Phaser.GameObjects.Text;
  private key = "";

  constructor(private readonly scene: Phaser.Scene, private readonly y: number) {
    this.pips = scene.add.graphics().setVisible(false);
    this.cues = scene.add.text(0, y - 1, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "9px", fontStyle: "bold", color: "#fff",
      stroke: "#000", strokeThickness: 2,
    }).setOrigin(0.5, 1).setVisible(false);
  }

  update(tier: number, tax: number, sig: number, dim: boolean, labelWidth: number): void {
    const t = Math.max(0, Math.min(4, Math.floor(tier)));
    const key = `${t}|${tax}|${sig & (SIG_TAXED | SIG_SUPPRESSED | SIG_EXEC_BLOCKED)}|${dim ? 1 : 0}|${labelWidth}`;
    if (key === this.key) return;
    this.key = key;
    const on = t > 0;
    this.pips.setVisible(on);
    this.pips.clear();
    if (on) {
      const gap = 4, w = 5, h = 3;
      const total = gap * 3 + w * 4;
      const left = -total / 2;
      for (let i = 0; i < 4; i++) {
        this.pips.fillStyle(PIP_COLORS[i]!, i < t ? (dim ? 0.28 : 1) : 0.2);
        this.pips.fillRoundedRect(left + i * (w + gap), this.y - 12, w, h, 1);
      }
      this.pips.lineStyle(0.7, 0xffffff, dim ? 0.22 : 0.7);
      this.pips.strokeRoundedRect(left + (t - 1) * (w + gap), this.y - 12, w, h, 1);
    }
    const parts: string[] = [];
    if ((sig & SIG_TAXED) !== 0 && tax > 0) parts.push(`AS −${Math.round(tax)}%`);
    if ((sig & SIG_SUPPRESSED) !== 0) parts.push(`DMG −${Math.round((1 - FACTIONS.sentenced.params.suppress!) * 100)}%`);
    if ((sig & SIG_EXEC_BLOCKED) !== 0) parts.push("☠ EXEC BLOCKED");
    this.cues.setText(parts.join("  ")).setVisible(parts.length > 0).setPosition(labelWidth / 2 + 4, this.y - 1);
    this.cues.setOrigin(0, 1);
  }
}
