import { questKindCss, type QuestMapBlip } from "./questModel";

export function paintQuestBlips(
  ctx: CanvasRenderingContext2D, blips: readonly QuestMapBlip[], k: number, px: number,
): void {
  // The explicit quest route follows the same MASK_MOVE pathfinding waypoints as server movement.
  const tracked = blips.find((blip) => blip.tracked && blip.route && blip.route.length > 1);
  if (tracked?.route) {
    ctx.save();
    ctx.strokeStyle = questKindCss(tracked.kind);
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = Math.max(1.5, px * 1.7);
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.beginPath();
    ctx.moveTo(tracked.route[0]!.x * k, tracked.route[0]!.y * k);
    for (let i = 1; i < tracked.route.length; i++) ctx.lineTo(tracked.route[i]!.x * k, tracked.route[i]!.y * k);
    ctx.stroke();
    ctx.restore();
  }
  for (const blip of blips) {
    const x = blip.x * k;
    const y = blip.y * k;
    const color = questKindCss(blip.kind);
    ctx.fillStyle = color;
    ctx.strokeStyle = "#101318";
    ctx.lineWidth = Math.max(1, px);
    if (blip.tracked && blip.role === "objective") {
      // A quest destination must stand out from yellow terrain and the many nearby chest/giver marks.
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 5.5 * px, 0, Math.PI * 2);
      ctx.fillStyle = "#101318";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5 * px;
      ctx.fill();
      ctx.stroke();
      ctx.font = `bold ${8 * px}px system-ui, sans-serif`;
      const left = x > ctx.canvas.width - 26 * px;
      ctx.textAlign = left ? "right" : "left";
      ctx.textBaseline = "bottom";
      const labelX = x + (left ? -8 : 8) * px;
      ctx.strokeStyle = "#101318";
      ctx.lineWidth = 3 * px;
      ctx.strokeText("GO", labelX, y - 3 * px);
      ctx.fillStyle = "#ffffff";
      ctx.fillText("GO", labelX, y - 3 * px);
      ctx.restore();
    }
    if (blip.role === "giver") {
      const r = 3 * px;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      // An offer not yet accepted is an outline, one the player holds is solid: a call to action against a job in hand.
      if (blip.accepted === false) {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 1.5 * px);
        ctx.stroke();
      } else {
        ctx.fill();
        ctx.stroke();
      }
    } else if (blip.role === "carrier") {
      const r = 3.4 * px;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, (blip.tracked ? 3.4 : 2.2) * px, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(blip.tracked ? 2 * px : px, 1);
      ctx.stroke();
      if (blip.tracked) {
        ctx.beginPath();
        ctx.arc(x, y, 1.1 * px, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
  }
}
