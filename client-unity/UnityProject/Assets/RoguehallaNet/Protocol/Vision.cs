using System;

namespace Roguehalla.Net.Protocol
{
    /// <summary>
    /// The vision rule's parameters a Welcome carries (protocol 16; rh-protocol vision.rs), right after the archetype table and
    /// before the map: <c>version u8, tile f64, radius f64, trailMs f64, updateMs f64, sightMask u8, coliseum u8</c> (0 absent,
    /// 1 present) and, when present, the coliseum rectangle in tiles <c>x u16, y u16, w u16, h u16</c>. The values come from
    /// the server's Rust source (public constants and public map metadata); a client that mirrors the sight rule reads them
    /// here instead of keeping its own copy, and checks <see cref="Version"/> against the rule it implements.
    /// </summary>
    public sealed class WireVision
    {
        public const int BlockLength = 1 + 8 * 4 + 1 + 1, MaxBlockLength = BlockLength + 8;
        /// <summary>The vision-rules version (1 today; 0 is refused).</summary>
        public byte Version = 1;
        /// <summary>Sim units per tile.</summary>
        public double Tile = 32;
        /// <summary>Sight radius, sim units.</summary>
        public double Radius = 900;
        /// <summary>How long a seen tile stays remembered, ms.</summary>
        public double TrailMs = 30000;
        /// <summary>How often the sight memory is refreshed, ms.</summary>
        public double UpdateMs = 100;
        /// <summary>Tile-class bits that block sight: a tile blocks when <c>(class &amp; SightMask) != 0</c>.</summary>
        public byte SightMask = 1;
        /// <summary>Whether the map has a coliseum rectangle; when false the rectangle fields are zero.</summary>
        public bool HasColiseum;
        /// <summary>The rectangle (whole tiles) standing in the coliseum reveals.</summary>
        public ushort ColiseumX, ColiseumY, ColiseumW, ColiseumH;

        internal int Length() { return HasColiseum ? MaxBlockLength : BlockLength; }

        static bool Within(double v, double lo, double hi, bool open) { return !double.IsNaN(v) && !double.IsInfinity(v) && v <= hi && (open ? v > lo : v >= lo); }

        internal bool Valid()
        {
            return Version != 0 && Within(Tile, 0, 1024, true) && Within(Radius, 0, 1e6, true) && Within(TrailMs, 0, 1e9, false)
                && Within(UpdateMs, 0, 1e6, true) && SightMask != 0 && (!HasColiseum || (ColiseumW > 0 && ColiseumH > 0));
        }

        /// <summary>Does the coliseum rectangle lie inside a map of <paramref name="w"/> x <paramref name="h"/> tiles?</summary>
        public bool Fits(ushort w, ushort h) { return !HasColiseum || (ColiseumX + ColiseumW <= w && ColiseumY + ColiseumH <= h); }

        internal void Write(Writer w)
        {
            w.U8(Version); w.F64(Tile); w.F64(Radius); w.F64(TrailMs); w.F64(UpdateMs); w.U8(SightMask);
            if (HasColiseum) { w.U8(1); w.U16(ColiseumX); w.U16(ColiseumY); w.U16(ColiseumW); w.U16(ColiseumH); }
            else w.U8(0);
        }

        internal static WireVision Read(ref Reader r)
        {
            var v = new WireVision { Version = r.U8(), Tile = r.F64(), Radius = r.F64(), TrailMs = r.F64(), UpdateMs = r.F64(), SightMask = r.U8() };
            byte flag = r.U8();
            if (flag > 1) throw new DecodeException(DecodeError.BadField, "vision");
            if (flag == 1) { v.HasColiseum = true; v.ColiseumX = r.U16(); v.ColiseumY = r.U16(); v.ColiseumW = r.U16(); v.ColiseumH = r.U16(); }
            if (!v.Valid()) throw new DecodeException(DecodeError.BadField, "vision");
            return v;
        }
    }
}
