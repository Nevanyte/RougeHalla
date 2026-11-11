using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    public enum WeaponRangeKind : byte { None = 0, Lane = 1, Circle = 2, Arc = 3 }

    /// <summary>The ground shape of the held weapon's reach, in sim units and radians (sim +y south). Kind None draws nothing.</summary>
    public struct WeaponRangeShape
    {
        public WeaponRangeKind Kind;
        /// <summary>Lane: range. Circle: radius. Arc: reach.</summary>
        public float Length;
        /// <summary>Lane only: full width across the path. Zero for the others.</summary>
        public float Width;
        /// <summary>Arc only: radians each side of <see cref="Direction"/>.</summary>
        public float HalfArc;
        /// <summary>Lane and arc: the aim in sim radians. Circle: 0.</summary>
        public float Direction;
    }

    /// <summary>Pure geometry of legacy's weapon range guide (WeaponRangeView.weaponRangeGeometry). STUB: draws nothing until implemented.</summary>
    public static class WeaponRange
    {
        /// <param name="row">The weapon's Welcome table row, or null.</param>
        /// <param name="bodyHalfWidth">The firing body's half-width in sim units (legacy: PLAYER_RADIUS; archetype: the body box half-width).</param>
        /// <param name="aim">Aim in sim radians; non-finite counts as 0.</param>
        /// <param name="ball">True for a projectile that is a ball (legacy wand), drawn as a circle; the wire does not say.</param>
        public static WeaponRangeShape Of(WireWeapon row, float bodyHalfWidth, float aim, bool ball)
        {
            return default(WeaponRangeShape);
        }
    }
}
