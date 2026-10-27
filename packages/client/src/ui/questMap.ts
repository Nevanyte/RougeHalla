import { questKindCss, type QuestMapBlip } from "./questModel";

export function paintQuestBlips(
  ctx: CanvasRenderingContext2D, blips: readonly QuestMapBlip[], k: number, px: number,
): void {
  for (const blip of blips) {
    const x = blip.x * k;
    const y = blip.y * k;
    const color = questKindCss(blip.kind);
    ctx.fillStyle = color;
    ctx.strokeStyle = "#101318";
    ctx.lineWidth = Math.max(1, px);
    if (blip.role === "giver") {
      const r = 3 * px;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (blip.role === "carrier") {
      const r = 3.4 * px;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 2.2 * px, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }
}
