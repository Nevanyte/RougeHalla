using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// Chooses the destination for keyboard steering (port of legacy <c>keyboardMoveGoal</c>). It only picks which point to send:
    /// the first body-clear straight goal, trying the held heading and, on a diagonal, each single axis, from 64 down to 8
    /// units. Collision truth stays in Rust; the server still validates and plans the order.
    /// </summary>
    public static class KeyboardSteer
    {
        public const double AheadMax = 64.0, AheadMin = 8.0, AheadStep = 8.0;

        /// <summary>
        /// (keyX, keyY) are the held direction in server axes (-1, 0 or 1; +y is down the screen). Returns false when no goal is
        /// clear, or no key is held: the caller then sends no new order (and stops if it was moving).
        /// </summary>
        public static bool TryGoal(Pathfinder pf, MapBlob map, double originX, double originY, int keyX, int keyY,
            out double goalX, out double goalY)
        {
            return TryGoal(pf, map, originX, originY, keyX, keyY, Footprint.Legacy, out goalX, out goalY);
        }

        /// <summary>As above for the mover's own footprint (its archetype's foot box, ADR0024).</summary>
        public static bool TryGoal(Pathfinder pf, MapBlob map, double originX, double originY, int keyX, int keyY, Footprint foot,
            out double goalX, out double goalY)
        {
            goalX = originX; goalY = originY;
            if (pf == null || map == null || (keyX == 0 && keyY == 0)) return false;
            keyX = Math.Sign(keyX); keyY = Math.Sign(keyY);
            double len = Math.Sqrt(keyX * keyX + keyY * keyY);
            int headings = keyX != 0 && keyY != 0 ? 3 : 1;
            for (int h = 0; h < headings; h++)
            {
                double hx = h == 0 ? keyX / len : h == 1 ? keyX : 0;
                double hy = h == 0 ? keyY / len : h == 1 ? 0 : keyY;
                for (double d = AheadMax; d >= AheadMin; d -= AheadStep)
                {
                    double gx = originX + hx * d, gy = originY + hy * d;
                    if (pf.SegmentClear(map, originX, originY, gx, gy, foot)) { goalX = gx; goalY = gy; return true; }
                }
            }
            return false;
        }
    }
}
