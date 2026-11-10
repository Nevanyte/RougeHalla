using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// The aim the client sends so a projectile that leaves the shooter's chest passes through the cursor (ADR0024 Decision 6).
    /// Projectiles are simulated on a ground track and drawn raised by the shooter's chest height <c>h</c> (sim units, from the
    /// Welcome archetype table), i.e. drawn at (x, y - h) with +y south. The cursor is mapped to the ground, point C. The drawn
    /// line is the ground line shifted by (0, -h), so it passes through C exactly when the ground line passes through
    /// (Cx, Cy + h): the aim target is the cursor's ground point shifted <c>h</c> toward screen-down. With h = 0 (legacy hitboxes,
    /// no table) this is the plain angle from the feet to the cursor. Pure maths; the sim takes the angle as given.
    /// </summary>
    public static class ChestAim
    {
        /// <summary>The ground point the aim line must pass through: the cursor shifted <paramref name="chest"/> south.</summary>
        public static void Target(double cursorX, double cursorY, double chest, out double targetX, out double targetY)
        {
            targetX = cursorX; targetY = cursorY + chest;
        }

        /// <summary>Aim angle (radians, 0 = east, +y south) from the feet (fromX, fromY) for a cursor ground point and a chest height.</summary>
        public static double Angle(double fromX, double fromY, double cursorX, double cursorY, double chest)
        {
            return Math.Atan2(cursorY + chest - fromY, cursorX - fromX);
        }

        /// <summary>The chest height of an archetype in the Welcome table; 0 for no table, an unknown id or the legacy row.</summary>
        public static double ChestOf(WireArchetype[] table, byte id)
        {
            var row = WireArchetype.Find(table, id);
            return row == null ? 0.0 : row.Chest;
        }
    }
}
