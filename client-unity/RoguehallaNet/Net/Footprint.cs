using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// What a mover occupies on the ground for walls and paths (ADR0024 Decision 3; rh-sim <c>geometry::Footprint</c>). A disc is
    /// the legacy circle of that radius; a box is an axis-aligned foot box centred on the feet with half-extents
    /// (<see cref="Hx"/> east-west, <see cref="Hy"/> north-south). Sim axes: +x east, +y south. The numbers always come from the
    /// archetype table in the Welcome (<see cref="FromArchetype"/>); the client keeps no table of its own. With no table, an
    /// unknown id or the legacy row the footprint is the 12 u disc, exactly the behaviour before protocol 16.
    /// </summary>
    public readonly struct Footprint : System.IEquatable<Footprint>
    {
        /// <summary>rh-sim <c>PLAYER_RADIUS</c>: the legacy disc, and the fallback when the server sends no table.</summary>
        public const double LegacyRadius = 12.0;

        /// <summary>True for an axis-aligned box, false for a disc.</summary>
        public readonly bool IsBox;
        /// <summary>The disc radius, or the box half-extent along x.</summary>
        public readonly double Hx;
        /// <summary>The disc radius, or the box half-extent along y.</summary>
        public readonly double Hy;

        Footprint(bool isBox, double hx, double hy) { IsBox = isBox; Hx = hx; Hy = hy; }

        public static Footprint Disc(double radius) { return new Footprint(false, radius, radius); }
        public static Footprint Box(double hx, double hy) { return new Footprint(true, hx, hy); }

        /// <summary>The legacy 12 u disc.</summary>
        public static Footprint Legacy { get { return Disc(LegacyRadius); } }

        /// <summary>The foot of a table row: a circle hull is its disc, a box hull is the foot box. Null is the legacy disc.</summary>
        public static Footprint FromArchetype(WireArchetype row)
        {
            if (row == null) return Legacy;
            return row.Hull == 1 ? Box(row.Fx, row.Fy) : Disc(row.R);
        }

        /// <summary>The foot of archetype <paramref name="id"/> in the Welcome table; the legacy disc when there is no such row.</summary>
        public static Footprint For(WireArchetype[] table, byte id) { return FromArchetype(WireArchetype.Find(table, id)); }

        public static implicit operator Footprint(double radius) { return Disc(radius); }

        public bool Equals(Footprint o) { return IsBox == o.IsBox && Hx == o.Hx && Hy == o.Hy; }
        public override bool Equals(object o) { return o is Footprint && Equals((Footprint)o); }
        public override int GetHashCode() { unchecked { return (IsBox ? 1 : 0) ^ (Hx.GetHashCode() * 397) ^ Hy.GetHashCode(); } }

        public override string ToString() { return IsBox ? "Box(" + Hx + ", " + Hy + ")" : "Disc(" + Hx + ")"; }
    }
}
