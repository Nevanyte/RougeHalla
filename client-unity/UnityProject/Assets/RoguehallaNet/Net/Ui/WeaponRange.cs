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

    /// <summary>Pure geometry of legacy's weapon range guide (WeaponRangeView.weaponRangeGeometry). Lane/circle/arc by the row's kind; the caller says whether a projectile is a ball.</summary>
    public static class WeaponRange
    {
        /// <param name="row">The weapon's Welcome table row, or null.</param>
        /// <param name="bodyHalfWidth">The firing body's half-width in sim units (legacy: PLAYER_RADIUS; archetype: the body box half-width).</param>
        /// <param name="aim">Aim in sim radians; non-finite counts as 0.</param>
        /// <param name="ball">True for a projectile that is a ball (legacy wand), drawn as a circle; the wire does not say.</param>
        public static WeaponRangeShape Of(WireWeapon row, float bodyHalfWidth, float aim, bool ball)
        {
            var s = default(WeaponRangeShape);
            if (row == null) return s;
            float dir = float.IsNaN(aim) || float.IsInfinity(aim) ? 0f : aim;
            if (row.Kind == WireWeapon.KindArc)
            {
                s.Kind = WeaponRangeKind.Arc; s.Length = (float)row.Reach; s.HalfArc = (float)row.HalfArc; s.Direction = dir;
            }
            else if (row.Kind == WireWeapon.KindProjectile)
            {
                s.Length = (float)row.Reach;
                if (ball) s.Kind = WeaponRangeKind.Circle;
                else { s.Kind = WeaponRangeKind.Lane; s.Width = 2f * (bodyHalfWidth + (float)row.Radius); s.Direction = dir; }
            }
            return s;
        }
    }
}
