using System;
using System.Text;

namespace Roguehalla.Net.Protocol
{
    /// <summary>
    /// One row of the hitbox archetype table a Welcome carries (protocol 16, ADR0024; rh-protocol archetype.rs). Sizes are whole
    /// sim units, north is -y. A circle row (<see cref="Hull"/> 0) is the legacy disc of radius <see cref="R"/>; a box row
    /// (<see cref="Hull"/> 1) has a foot box (<see cref="Fx"/>, <see cref="Fy"/>) centred on the feet, for walls and paths, and a
    /// body box (<see cref="Bx"/>, <see cref="By"/>) centred at the feet plus (<see cref="Ox"/>, <see cref="Oy"/>), for hits.
    /// <see cref="Chest"/> is how high above the feet projectiles fly. The table comes from the server's Rust source; the
    /// client never keeps its own copy.
    /// </summary>
    public sealed class WireArchetype
    {
        public const int MaxRows = 32, MaxKey = 24;
        public byte Id;
        public string Key = "";
        public byte Hull;
        public byte R;
        public byte Fx, Fy, Bx, By;
        public sbyte Ox, Oy;
        public byte Chest;

        internal bool Valid()
        {
            if (string.IsNullOrEmpty(Key) || Encoding.UTF8.GetByteCount(Key) > MaxKey) return false;
            foreach (char c in Key) if (c < 0x21 || c > 0x7e) return false;
            if (Hull == 0) return R > 0;
            if (Hull == 1) return Fx > 0 && Fy > 0 && Bx > 0 && By > 0;
            return false;
        }

        internal int Length() { return 1 + 1 + Encoding.UTF8.GetByteCount(Key) + 1 + (Hull == 0 ? 1 : 6) + 1; }

        internal static int TableLength(WireArchetype[] rows)
        {
            int n = 1;
            foreach (var a in rows) n += a.Length();
            return n;
        }

        internal static void Validate(WireArchetype[] rows)
        {
            if (rows.Length > MaxRows) throw new ArgumentException("archetype count");
            for (int i = 0; i < rows.Length; i++)
            {
                if (rows[i] == null || !rows[i].Valid()) throw new ArgumentException("archetype");
                if (i > 0 && rows[i].Id <= rows[i - 1].Id) throw new ArgumentException("archetype order");
            }
        }

        internal static void WriteTable(Writer w, WireArchetype[] rows)
        {
            Validate(rows);
            w.U8((byte)rows.Length);
            foreach (var a in rows)
            {
                w.U8(a.Id); w.Str(a.Key); w.U8(a.Hull);
                if (a.Hull == 0) w.U8(a.R);
                else { w.U8(a.Fx); w.U8(a.Fy); w.U8(a.Bx); w.U8(a.By); w.U8(unchecked((byte)a.Ox)); w.U8(unchecked((byte)a.Oy)); }
                w.U8(a.Chest);
            }
        }

        internal static WireArchetype[] ReadTable(ref Reader r)
        {
            int n = r.U8();
            if (n > MaxRows) throw new DecodeException(DecodeError.BadField, "archetype count");
            var rows = n == 0 ? Array.Empty<WireArchetype>() : new WireArchetype[n];
            for (int i = 0; i < n; i++)
            {
                var a = new WireArchetype { Id = r.U8(), Key = r.Str(), Hull = r.U8() };
                if (a.Hull == 0) a.R = r.U8();
                else if (a.Hull == 1)
                {
                    a.Fx = r.U8(); a.Fy = r.U8(); a.Bx = r.U8(); a.By = r.U8();
                    a.Ox = unchecked((sbyte)r.U8()); a.Oy = unchecked((sbyte)r.U8());
                }
                else throw new DecodeException(DecodeError.BadField, "archetype hull");
                a.Chest = r.U8();
                if (!a.Valid()) throw new DecodeException(DecodeError.BadField, "archetype");
                if (i > 0 && a.Id <= rows[i - 1].Id) throw new DecodeException(DecodeError.BadField, "archetype order");
                rows[i] = a;
            }
            return rows;
        }

        /// <summary>The row with this id, or null.</summary>
        public static WireArchetype Find(WireArchetype[] rows, byte id)
        {
            if (rows == null) return null;
            foreach (var a in rows) if (a.Id == id) return a;
            return null;
        }
    }
}
