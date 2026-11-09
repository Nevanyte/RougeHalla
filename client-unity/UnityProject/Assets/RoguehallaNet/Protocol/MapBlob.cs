using System;

namespace Roguehalla.Net.Protocol
{
    /// <summary>The canonical public map: collision tile classes row-major (0 floor, 1 wall, 2 low).</summary>
    public sealed class MapBlob
    {
        const byte GroundVersion = 1;
        const byte TerrainPresent = 1, RegionPresent = 2;
        const int GroundFixedLength = 11; // version, flags, semantic hash, mode and context hash
        static readonly byte[] GroundDomain = { (byte)'r', (byte)'h', (byte)'-', (byte)'g', (byte)'r', (byte)'o', (byte)'u', (byte)'n', (byte)'d', (byte)'/', (byte)'1', 0 };
        static readonly byte[] ContextDomain = { (byte)'r', (byte)'h', (byte)'-', (byte)'m', (byte)'a', (byte)'p', (byte)'-', (byte)'c', (byte)'o', (byte)'n', (byte)'t', (byte)'e', (byte)'x', (byte)'t', (byte)'/', (byte)'1', 0 };

        public ushort W, H;
        public byte[] Tiles;
        public uint LayerHash;
        /// <summary>Optional row-major terrain plane. Null means absent; an all-zero array is present data.</summary>
        public byte[] Terrain { get; private set; }
        /// <summary>Optional row-major region plane. Null means absent; an all-zero array is present data.</summary>
        public byte[] Regions { get; private set; }
        /// <summary>Actual room selector: 0 Off, 1 Map, 2 All.</summary>
        public byte TerrainMode { get; private set; }
        public uint SemanticHash { get; private set; }
        public uint ContextHash { get; private set; }

        public const byte Floor = 0, Wall = 1, Low = 2;
        public const byte GroundTerrainOff = 0, GroundTerrainMap = 1, GroundTerrainAll = 2;

        public MapBlob(ushort w, ushort h, byte[] tiles)
            : this(w, h, tiles, null, null, GroundTerrainOff)
        {
        }

        public MapBlob(ushort w, ushort h, byte[] tiles, byte[] terrain, byte[] regions, byte terrainMode = GroundTerrainOff)
        {
            W = w;
            H = h;
            Tiles = tiles;
            LayerHash = ComputeHash(w, h, tiles);
            Terrain = terrain;
            Regions = regions;
            TerrainMode = terrainMode;
            SemanticHash = ComputeSemanticHash(w, h, terrain, regions);
            ContextHash = ComputeContextHash(LayerHash, SemanticHash, terrainMode);
        }

        MapBlob() { }

        /// <summary>FNV-1a 32 over (w u32 LE, h u32 LE, collision tiles), unchanged from protocol 13.</summary>
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

        /// <summary>FNV-1a32 of the exact protocol-14 ground semantic bytes (domain, dimensions, version, presence, present planes).</summary>
        public static uint ComputeSemanticHash(ushort w, ushort h, byte[] terrain, byte[] regions)
        {
            byte presence = Presence(terrain, regions);
            uint hash = 0x811c9dc5;
            unchecked
            {
                Feed(ref hash, GroundDomain);
                FeedU32(ref hash, w);
                FeedU32(ref hash, h);
                Feed(ref hash, GroundVersion);
                Feed(ref hash, presence);
                if (terrain != null) Feed(ref hash, terrain);
                if (regions != null) Feed(ref hash, regions);
            }
            return hash;
        }

        /// <summary>FNV-1a32 of the exact protocol-14 map context bytes.</summary>
        public static uint ComputeContextHash(uint collisionHash, uint semanticHash, byte terrainMode)
        {
            uint hash = 0x811c9dc5;
            unchecked
            {
                Feed(ref hash, ContextDomain);
                FeedU32(ref hash, collisionHash);
                FeedU32(ref hash, semanticHash);
                Feed(ref hash, terrainMode);
            }
            return hash;
        }

        /// <summary>Canonical equality for reuse: hashes are only quick rejects, never proof of equality.</summary>
        public bool CanonicalEquals(MapBlob other)
        {
            return other != null && W == other.W && H == other.H && TerrainMode == other.TerrainMode
                && SameBytes(Tiles, other.Tiles) && SameOptionalBytes(Terrain, other.Terrain)
                && SameOptionalBytes(Regions, other.Regions);
        }

        public byte At(int tx, int ty) { return Tiles[ty * W + tx]; }

        /// <summary>Length of the run starting at <paramref name="tiles"/> index <paramref name="i"/>.</summary>
        static int RunAt(byte[] tiles, int i)
        {
            byte t = tiles[i];
            int end = Math.Min(tiles.Length, i + ushort.MaxValue), j = i + 1;
            while (j < end && tiles[j] == t) j++;
            return j - i;
        }

        static int RunCount(byte[] tiles)
        {
            if (tiles == null) return 0;
            int runs = 0;
            for (int i = 0; i < tiles.Length; i += RunAt(tiles, i)) runs++;
            return runs;
        }

        /// <summary>Exact size of the protocol-14 collision blob and version-1 ground extension.</summary>
        public int EncodedLength
        {
            get
            {
                long extension = GroundFixedLength
                    + (Terrain == null ? 0L : 4L + 3L * RunCount(Terrain))
                    + (Regions == null ? 0L : 4L + 3L * RunCount(Regions));
                long encoded = 12L + 3L * RunCount(Tiles) + 4L + extension;
                if (60L + encoded > Wire.MaxServerFrame) throw new EncodeException("welcome too large");
                return checked((int)encoded);
            }
        }

        public void Write(Writer w) { Write(w, TerrainMode); }

        /// <summary>Writes semantic map content using the room's actual context selector.</summary>
        public void Write(Writer w, byte terrainMode)
        {
            CheckContent();
            if (terrainMode > GroundTerrainAll) throw new EncodeException("bad map terrain mode");
            int extensionLength = checked(GroundFixedLength
                + (Terrain == null ? 0 : 4 + 3 * RunCount(Terrain))
                + (Regions == null ? 0 : 4 + 3 * RunCount(Regions)));
            // EncodedLength includes the fixed Welcome header check, before its Writer allocates.
            _ = EncodedLength;

            w.U16(W); w.U16(H); w.U32(LayerHash);
            WritePlane(w, Tiles);
            w.U32((uint)extensionLength);
            w.U8(GroundVersion);
            w.U8(Presence(Terrain, Regions));
            w.U32(SemanticHash);
            if (Terrain != null) WritePlane(w, Terrain);
            if (Regions != null) WritePlane(w, Regions);
            w.U8(terrainMode);
            w.U32(ComputeContextHash(LayerHash, SemanticHash, terrainMode));
        }

        static void WritePlane(Writer w, byte[] plane)
        {
            w.U32((uint)RunCount(plane));
            for (int i = 0; i < plane.Length;)
            {
                int n = RunAt(plane, i);
                w.U8(plane[i]); w.U16((ushort)n);
                i += n;
            }
        }

        /// <summary>Reads the retained collision-only parity-fixture format. Never used for network Welcome decoding.</summary>
        public static MapBlob ReadCollisionFixture(ref Reader r)
        {
            Reader scan = r;
            ushort w = scan.U16(), h = scan.U16();
            uint expectedHash = scan.U32(), runs = scan.U32();
            int total = CheckedTileCount(w, h);
            Reader plane = scan;
            uint countedRuns = 0;
            if (ValidateCollisionPlane(ref scan, w, h, total, runs, ref countedRuns) != expectedHash)
                throw BadMap("hash");
            scan.End();
            byte[] tiles = DecodePlane(ref plane, runs, total, 2);
            plane.End();
            r = plane;
            return new MapBlob(w, h, tiles);
        }

        /// <summary>Strict current network map, including its mandatory protocol-14 ground section.</summary>
        public static MapBlob Read(ref Reader r)
        {
            ushort w = r.U16(), h = r.U16();
            uint collisionHash = r.U32();
            uint collisionRuns = r.U32();
            int total = CheckedTileCount(w, h);

            // Preflight with value-copy readers over the original bounded frame. No tile plane or run vector is allocated.
            Reader collisionStart = r;
            Reader scan = r;
            uint countedRuns = 0;
            uint calculatedCollisionHash = ValidateCollisionPlane(ref scan, w, h, total, collisionRuns, ref countedRuns);
            if (calculatedCollisionHash != collisionHash) throw BadMap("hash");
            uint extensionLength = scan.U32();
            if (extensionLength < GroundFixedLength || extensionLength > Wire.MaxServerFrame || extensionLength > scan.Remaining)
                throw BadMap("extension length");
            Reader extension = scan.TakeReader((int)extensionLength);
            GroundHeader ground = ValidateGroundExtension(extension, collisionStart, collisionRuns, total, countedRuns, collisionHash, w, h);
            scan.End();

            // Only now allocate the decoded planes; total decoded plane storage is explicitly capped at 3 MiB.
            Reader decode = r;
            byte[] tiles = DecodePlane(ref decode, collisionRuns, total, 2);
            uint decodeExtensionLength = decode.U32();
            if (decodeExtensionLength != extensionLength) throw BadMap("extension length");
            Reader body = decode.TakeReader((int)decodeExtensionLength);
            byte version = body.U8();
            byte presence = body.U8();
            uint semanticHash = body.U32();
            byte[] terrain = (presence & TerrainPresent) != 0 ? DecodeSemanticPlane(ref body, total, 7) : null;
            byte[] regions = (presence & RegionPresent) != 0 ? DecodeSemanticPlane(ref body, total, 6) : null;
            byte terrainMode = body.U8();
            uint contextHash = body.U32();
            body.End();
            r = decode;

            if (version != ground.Version || presence != ground.Presence || semanticHash != ground.SemanticHash
                || terrainMode != ground.TerrainMode || contextHash != ground.ContextHash)
                throw BadMap("ground changed after validation");
            return new MapBlob
            {
                W = w, H = h, Tiles = tiles, LayerHash = collisionHash,
                Terrain = terrain, Regions = regions, TerrainMode = terrainMode,
                SemanticHash = semanticHash, ContextHash = contextHash,
            };
        }

        struct GroundHeader
        {
            public byte Version, Presence, TerrainMode;
            public uint SemanticHash, ContextHash;
        }

        static GroundHeader ValidateGroundExtension(
            Reader extension, Reader collisionStart, uint collisionRuns, int total, uint countedRuns, uint collisionHash, ushort w, ushort h)
        {
            byte version = extension.U8();
            if (version != GroundVersion) throw BadMap("section version");
            byte presence = extension.U8();
            if ((presence & ~(TerrainPresent | RegionPresent)) != 0) throw BadMap("presence");
            uint expectedSemanticHash = extension.U32();
            uint actualSemanticHash = BeginSemanticHash(w, h, presence);

            if ((presence & TerrainPresent) != 0)
            {
                uint runs = extension.U32();
                countedRuns = AddRunCount(countedRuns, runs, total, extension.Remaining);
                Reader terrainCompatibility = extension;
                ValidateSemanticPlane(ref extension, runs, total, 7, "terrain value", ref actualSemanticHash);
                if (!CompatibleTerrain(collisionStart, collisionRuns, terrainCompatibility, runs, total))
                    throw BadMap("terrain collision");
            }
            if ((presence & RegionPresent) != 0)
            {
                uint runs = extension.U32();
                countedRuns = AddRunCount(countedRuns, runs, total, extension.Remaining);
                ValidateSemanticPlane(ref extension, runs, total, 6, "region value", ref actualSemanticHash);
            }
            if (actualSemanticHash != expectedSemanticHash) throw BadMap("semantic hash");

            byte terrainMode = extension.U8();
            if (terrainMode > GroundTerrainAll) throw new DecodeException(DecodeError.BadField, "terrain mode");
            uint contextHash = extension.U32();
            if (ComputeContextHash(collisionHash, expectedSemanticHash, terrainMode) != contextHash)
                throw BadMap("context hash");
            if (extension.Remaining != 0) throw BadMap("extension trailing");
            extension.End();
            if ((long)total * (1 + CountPresent(presence)) > Wire.MaxMapDecodedBytes)
                throw BadMap("decoded bytes");
            if (countedRuns > Wire.MaxMapRuns) throw BadMap("run count");
            return new GroundHeader
            {
                Version = version, Presence = presence, TerrainMode = terrainMode,
                SemanticHash = expectedSemanticHash, ContextHash = contextHash,
            };
        }

        static uint ValidateCollisionPlane(ref Reader r, ushort w, ushort h, int total, uint runs, ref uint countedRuns)
        {
            countedRuns = AddRunCount(countedRuns, runs, total, r.Remaining);
            uint hash = 0x811c9dc5;
            unchecked
            {
                FeedU32(ref hash, w);
                FeedU32(ref hash, h);
                int length = 0;
                for (uint i = 0; i < runs; i++)
                {
                    byte value = r.U8();
                    int runLength = r.U16();
                    if (value > Low || runLength == 0 || runLength > total - length) throw BadMap("run");
                    length += runLength;
                    for (int j = 0; j < runLength; j++) Feed(ref hash, value);
                }
                if (length != total) throw BadMap("length");
            }
            return hash;
        }

        static void ValidateSemanticPlane(ref Reader r, uint runs, int total, byte maxValue, string valueError, ref uint hash)
        {
            int length = 0;
            unchecked
            {
                for (uint i = 0; i < runs; i++)
                {
                    byte value = r.U8();
                    int runLength = r.U16();
                    if (value > maxValue) throw BadMap(valueError);
                    if (runLength == 0 || runLength > total - length) throw BadMap("run");
                    length += runLength;
                    for (int j = 0; j < runLength; j++) Feed(ref hash, value);
                }
            }
            if (length != total) throw BadMap("run");
        }

        static bool CompatibleTerrain(Reader collision, uint collisionRuns, Reader terrain, uint terrainRuns, int total)
        {
            int collisionRemaining = 0, terrainRemaining = 0, read = 0;
            byte collisionValue = 0, terrainValue = 0;
            uint collisionIndex = 0, terrainIndex = 0;
            while (read < total)
            {
                if (collisionRemaining == 0)
                {
                    if (collisionIndex >= collisionRuns) return false;
                    collisionValue = collision.U8(); collisionRemaining = collision.U16(); collisionIndex++;
                    if (collisionRemaining == 0 || collisionRemaining > total - read || collisionValue > Low) return false;
                }
                if (terrainRemaining == 0)
                {
                    if (terrainIndex >= terrainRuns) return false;
                    terrainValue = terrain.U8(); terrainRemaining = terrain.U16(); terrainIndex++;
                    if (terrainRemaining == 0 || terrainRemaining > total - read || terrainValue > 7) return false;
                }
                if (terrainValue >= 1 && terrainValue <= 3 && collisionValue != Wall && collisionValue != Low) return false;
                if (terrainValue >= 4 && collisionValue != Floor) return false;
                int take = Math.Min(collisionRemaining, terrainRemaining);
                read += take;
                collisionRemaining -= take;
                terrainRemaining -= take;
            }
            return collisionRemaining == 0 && terrainRemaining == 0 && collisionIndex == collisionRuns && terrainIndex == terrainRuns;
        }

        static byte[] DecodePlane(ref Reader r, uint runs, int total, byte maxValue)
        {
            byte[] plane = new byte[total];
            int length = 0;
            for (uint i = 0; i < runs; i++)
            {
                byte value = r.U8();
                int runLength = r.U16();
                if (value > maxValue || runLength == 0 || runLength > total - length) throw BadMap("run");
                Array.Fill(plane, value, length, runLength);
                length += runLength;
            }
            if (length != total) throw BadMap("length");
            return plane;
        }

        static byte[] DecodeSemanticPlane(ref Reader r, int total, byte maxValue)
        {
            uint runs = r.U32();
            CheckRunCount(runs, total, r.Remaining);
            return DecodePlane(ref r, runs, total, maxValue);
        }

        static uint AddRunCount(uint accumulated, uint runs, int total, int available)
        {
            CheckRunCount(runs, total, available);
            ulong sum = (ulong)accumulated + runs;
            if (sum > Wire.MaxMapRuns) throw BadMap("run count");
            return (uint)sum;
        }

        static void CheckRunCount(uint runs, int total, int available)
        {
            if (runs == 0 || runs > total) throw BadMap("run");
            if ((ulong)runs * 3 > (ulong)available) throw new DecodeException(DecodeError.Truncated);
        }

        static int CheckedTileCount(ushort w, ushort h)
        {
            long total = (long)w * h;
            if (w == 0 || h == 0 || total > Wire.MaxMapTiles) throw BadMap("size");
            return (int)total;
        }

        void CheckContent()
        {
            int total = CheckedTileCount(W, H);
            if (Tiles == null || Tiles.Length != total) throw new EncodeException("bad map length");
            for (int i = 0; i < Tiles.Length; i++) if (Tiles[i] > Low) throw new EncodeException("bad map tile");
            if (ComputeHash(W, H, Tiles) != LayerHash) throw new EncodeException("bad map hash");
            CheckPlaneForWrite(Terrain, total, 7, "terrain");
            CheckPlaneForWrite(Regions, total, 6, "region");
            if (Terrain != null && !CompatibleTerrainArrays(Tiles, Terrain)) throw new EncodeException("bad terrain collision");
            if (ComputeSemanticHash(W, H, Terrain, Regions) != SemanticHash) throw new EncodeException("bad semantic hash");
        }

        static void CheckPlaneForWrite(byte[] plane, int total, byte maxValue, string name)
        {
            if (plane == null) return;
            if (plane.Length != total) throw new EncodeException("bad " + name + " length");
            for (int i = 0; i < plane.Length; i++) if (plane[i] > maxValue) throw new EncodeException("bad " + name + " value");
        }

        static bool CompatibleTerrainArrays(byte[] tiles, byte[] terrain)
        {
            for (int i = 0; i < terrain.Length; i++)
            {
                byte kind = terrain[i], collision = tiles[i];
                if (kind >= 1 && kind <= 3 && collision != Wall && collision != Low) return false;
                if (kind >= 4 && collision != Floor) return false;
            }
            return true;
        }

        static int CountPresent(byte presence) => ((presence & TerrainPresent) == 0 ? 0 : 1) + ((presence & RegionPresent) == 0 ? 0 : 1);
        static byte Presence(byte[] terrain, byte[] regions) => (byte)((terrain == null ? 0 : TerrainPresent) | (regions == null ? 0 : RegionPresent));

        static bool SameOptionalBytes(byte[] a, byte[] b) => a == null ? b == null : b != null && SameBytes(a, b);
        static bool SameBytes(byte[] a, byte[] b)
        {
            if (ReferenceEquals(a, b)) return true;
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        static void Feed(ref uint hash, byte value) { unchecked { hash = (hash ^ value) * 0x01000193; } }
        static void Feed(ref uint hash, byte[] values) { for (int i = 0; i < values.Length; i++) Feed(ref hash, values[i]); }
        static void FeedU32(ref uint hash, uint value)
        {
            Feed(ref hash, (byte)value);
            Feed(ref hash, (byte)(value >> 8));
            Feed(ref hash, (byte)(value >> 16));
            Feed(ref hash, (byte)(value >> 24));
        }

        static uint BeginSemanticHash(ushort w, ushort h, byte presence)
        {
            uint hash = 0x811c9dc5;
            Feed(ref hash, GroundDomain);
            FeedU32(ref hash, w);
            FeedU32(ref hash, h);
            Feed(ref hash, GroundVersion);
            Feed(ref hash, presence);
            return hash;
        }

        static DecodeException BadMap(string reason) => new DecodeException(DecodeError.BadMap, reason);
    }
}
