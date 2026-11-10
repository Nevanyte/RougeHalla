using System;

namespace Roguehalla.Net.Protocol
{
    /// <summary>
    /// One row of the weapon table a Welcome carries (protocol 16; rh-protocol weapon.rs), right after the vision block and
    /// before the map: <c>count u8</c>, then per row a fixed 34 bytes <c>id u8, kind u8, reach f64, halfArc f64, speed f64,
    /// radius f64</c>, ids strictly ascending. The rows come from the server's Rust content (each weapon's hit shape), so a
    /// client draws the true melee sector or projectile reach from here and never keeps its own copy.
    /// <list type="bullet">
    /// <item><see cref="KindNone"/>: a weapon with no hit shape; all four values zero.</item>
    /// <item><see cref="KindArc"/>: a melee arc of <see cref="Reach"/> sim units and <see cref="HalfArc"/> radians each side of
    /// the aim (0 &lt; HalfArc &lt;= PI); <see cref="Speed"/> and <see cref="Radius"/> zero.</item>
    /// <item><see cref="KindProjectile"/>: <see cref="Reach"/> is the maximum range (sim units), <see cref="Speed"/> sim units
    /// per second (both &gt; 0), <see cref="Radius"/> the projectile's body-contact radius; <see cref="HalfArc"/> zero.</item>
    /// </list>
    /// Every value is finite and lies in 0..1e6.
    /// </summary>
    public sealed class WireWeapon
    {
        public const int MaxRows = 32, RowLength = 1 + 1 + 8 * 4;
        public const byte KindNone = 0, KindArc = 1, KindProjectile = 2;
        public const double MaxValue = 1e6;
        /// <summary>The weapon's wire code (the snapshot's weapon id).</summary>
        public byte Id;
        public byte Kind;
        /// <summary>Arc reach, or projectile range, sim units.</summary>
        public double Reach;
        /// <summary>Half the arc's opening, radians (arcs only).</summary>
        public double HalfArc;
        /// <summary>Projectile speed, sim units per second (projectiles only).</summary>
        public double Speed;
        /// <summary>Projectile body-contact radius, sim units (projectiles only).</summary>
        public double Radius;

        static bool InRange(double v) { return !double.IsNaN(v) && !double.IsInfinity(v) && v >= 0 && v <= MaxValue; }

        internal bool Valid()
        {
            if (!InRange(Reach) || !InRange(HalfArc) || !InRange(Speed) || !InRange(Radius)) return false;
            switch (Kind)
            {
                case KindNone: return Reach == 0 && HalfArc == 0 && Speed == 0 && Radius == 0;
                case KindArc: return Reach > 0 && HalfArc > 0 && HalfArc <= Math.PI && Speed == 0 && Radius == 0;
                case KindProjectile: return Reach > 0 && Speed > 0 && HalfArc == 0;
                default: return false;
            }
        }

        internal static int TableLength(WireWeapon[] rows) { return 1 + rows.Length * RowLength; }

        internal static void Validate(WireWeapon[] rows)
        {
            if (rows.Length > MaxRows) throw new ArgumentException("weapon count");
            for (int i = 0; i < rows.Length; i++)
            {
                if (rows[i] == null) throw new ArgumentException("weapon");
                if (rows[i].Kind > KindProjectile) throw new ArgumentException("weapon kind");
                if (!rows[i].Valid()) throw new ArgumentException("weapon");
                if (i > 0 && rows[i].Id <= rows[i - 1].Id) throw new ArgumentException("weapon order");
            }
        }

        internal static void WriteTable(Writer w, WireWeapon[] rows)
        {
            Validate(rows);
            w.U8((byte)rows.Length);
            foreach (var a in rows)
            {
                w.U8(a.Id); w.U8(a.Kind); w.F64(a.Reach); w.F64(a.HalfArc); w.F64(a.Speed); w.F64(a.Radius);
            }
        }

        internal static WireWeapon[] ReadTable(ref Reader r)
        {
            int n = r.U8();
            if (n > MaxRows) throw new DecodeException(DecodeError.BadField, "weapon count");
            var rows = n == 0 ? Array.Empty<WireWeapon>() : new WireWeapon[n];
            for (int i = 0; i < n; i++)
            {
                var a = new WireWeapon { Id = r.U8(), Kind = r.U8() };
                if (a.Kind > KindProjectile) throw new DecodeException(DecodeError.BadField, "weapon kind");
                a.Reach = r.F64(); a.HalfArc = r.F64(); a.Speed = r.F64(); a.Radius = r.F64();
                rows[i] = a;
            }
            // Same order of reasons as the Rust table_fault: values first, then id order.
            foreach (var a in rows) if (!a.Valid()) throw new DecodeException(DecodeError.BadField, "weapon");
            for (int i = 1; i < n; i++)
                if (rows[i].Id <= rows[i - 1].Id) throw new DecodeException(DecodeError.BadField, "weapon order");
            return rows;
        }

        /// <summary>The row with this id, or null.</summary>
        public static WireWeapon Find(WireWeapon[] rows, byte id)
        {
            if (rows == null) return null;
            foreach (var a in rows) if (a != null && a.Id == id) return a;
            return null;
        }
    }
}
