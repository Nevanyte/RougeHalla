using System;

namespace Roguehalla.Net.Protocol
{
    /// <summary>The canonical public map: tile classes row-major (0 floor, 1 wall, 2 low). Mirror of rh-protocol map.rs.</summary>
    public sealed class MapBlob
    {
        public ushort W, H;
        public byte[] Tiles;
        public uint LayerHash;

        public const byte Floor = 0, Wall = 1, Low = 2;

        public MapBlob(ushort w, ushort h, byte[] tiles)
        {
            W = w; H = h; Tiles = tiles;
            LayerHash = ComputeHash(w, h, tiles);
        }

        MapBlob() { }

        /// <summary>FNV-1a 32 over (w u32 LE, h u32 LE, tiles).</summary>
        public static uint ComputeHash(uint w, uint h, byte[] tiles)
        {
            uint hash = 0x811c9dc5;
            unchecked
            {
                for (int i = 0; i < 4; i++) { hash ^= (byte)(w >> (8 * i)); hash *= 0x01000193; }
                for (int i = 0; i < 4; i++) { hash ^= (byte)(h >> (8 * i)); hash *= 0x01000193; }
                foreach (byte b in tiles) { hash ^= b; hash *= 0x01000193; }
            }
            return hash;
        }

        public byte At(int tx, int ty) { return Tiles[ty * W + tx]; }

        /// <summary>Length of the run starting at <paramref name="i"/>: equal tiles, at most ushort.MaxValue (longer ones split).</summary>
        int RunAt(int i)
        {
            byte t = Tiles[i];
            int end = Math.Min(Tiles.Length, i + ushort.MaxValue), j = i + 1;
            while (j < end && Tiles[j] == t) j++;
            return j - i;
        }

        int RunCount()
        {
            int runs = 0;
            for (int i = 0; i < Tiles.Length; i += RunAt(i)) runs++;
            return runs;
        }

        /// <summary>Exact size of what <see cref="Write"/> writes.</summary>
        public int EncodedLength { get { return 12 + 3 * RunCount(); } }

        /// <summary>w u16, h u16, hash u32, runs u32, then runs x (tile u8, length u16).</summary>
        public void Write(Writer w)
        {
            w.U16(W); w.U16(H); w.U32(LayerHash);
            w.U32((uint)RunCount());
            for (int i = 0; i < Tiles.Length;)
            {
                int n = RunAt(i);
                w.U8(Tiles[i]); w.U16((ushort)n);
                i += n;
            }
        }

        public static MapBlob Read(ref Reader r)
        {
            ushort w = r.U16(), h = r.U16();
            uint hash = r.U32();
            uint runs = r.U32();
            long total = (long)w * h;
            if (w == 0 || h == 0 || total > Wire.MaxMapTiles) throw new DecodeException(DecodeError.BadMap, "size");
            var tiles = new byte[total];
            int len = 0;
            // The run count is untrusted: the loop ends by Truncated long before an absurd count matters.
            for (uint i = 0; i < runs; i++)
            {
                byte t = r.U8();
                int n = r.U16();
                if (t > 2 || n == 0 || len + n > total) throw new DecodeException(DecodeError.BadMap, "run");
                for (int k = 0; k < n; k++) tiles[len++] = t;
            }
            if (len != total) throw new DecodeException(DecodeError.BadMap, "length");
            if (ComputeHash(w, h, tiles) != hash) throw new DecodeException(DecodeError.BadMap, "hash");
            return new MapBlob { W = w, H = h, Tiles = tiles, LayerHash = hash };
        }
    }
}
