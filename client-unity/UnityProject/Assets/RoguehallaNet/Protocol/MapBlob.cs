using System;

namespace Roguehalla.Net.Protocol
{
    /// <summary>One camp marker (protocol 17), index-aligned with the WireCamp rows: legacy CampDef x, y and clearing radius r
    /// in world units, zone code 1..5.</summary>
    public readonly struct MapCamp
    {
        public readonly ushort X, Y, R;
        public readonly byte Zone;
        public MapCamp(ushort x, ushort y, ushort r, byte zone) { X = x; Y = y; R = r; Zone = zone; }
    }

    /// <summary>A tile coordinate inside the map.</summary>
    public readonly struct MapTile
    {
        public readonly ushort X, Y;
        public MapTile(ushort x, ushort y) { X = x; Y = y; }
    }

    /// <summary>A coliseum gate: side 0 north, 1 east, 2 south, 3 west; its tiles in legacy order.</summary>
    public sealed class MapGate
    {
        public readonly byte Side;
        public readonly MapTile[] Tiles;
        public MapGate(byte side, MapTile[] tiles) { Side = side; Tiles = tiles; }
    }

    /// <summary>The coliseum rectangle in tiles and its gates in legacy order.</summary>
    public sealed class MapColiseum
    {
        public readonly ushort X, Y, W, H;
        public readonly MapGate[] Gates;
        public MapColiseum(ushort x, ushort y, ushort w, ushort h, MapGate[] gates) { X = x; Y = y; W = w; H = h; Gates = gates; }
    }

    /// <summary>A cosmetic prop of the server's map dressing (P-DRESS-BAKE-1). x, y in world units; rows sorted by (y, x, kind).
    /// Validated on decode; no Unity script draws it until P-UNITY-DRESS-1.</summary>
    public readonly struct MapProp
    {
        public readonly byte Kind, Variant, Flags;
        public readonly ushort X, Y;
        public MapProp(byte kind, ushort x, ushort y, byte variant, byte flags) { Kind = kind; X = x; Y = y; Variant = variant; Flags = flags; }
    }

    /// <summary>The canonical public map: collision tile classes row-major (0 floor, 1 wall, 2 low), the public ground planes and
    /// (protocol 17) the public sections legacy clients generated themselves: camps, coliseum and gates, bushes, props, ground
    /// variants.</summary>
    public sealed class MapBlob
    {
        /// <summary>Extension layout version: protocol 17 is version 2; version 1 is refused.</summary>
        const byte GroundVersion = 2;
        const byte TerrainPresent = 0x01, RegionPresent = 0x02, CampsPresent = 0x04, ColiseumPresent = 0x08,
            BushesPresent = 0x10, PropsPresent = 0x20, GroundVariantsPresent = 0x40, KnownPresence = 0x7f;
        public const int MaxCamps = 64, MaxColiseumGates = 8, MaxGateTiles = 16, MaxProps = 8192;
        const byte MaxCampZone = 5, MaxGateSide = 3;
        /// <summary>Dressing value caps (P-DRESS-BAKE-1), the same as Rust's `rh_protocol::map`: prop flags tall and legacy;
        /// a rule prop's kind 1..MaxPropKind and variant at most MaxPropVariant; a legacy prop's kind below LegacyPropKinds;
        /// every ground-variant cell at most MaxGroundVariant.</summary>
        public const byte PropFlagTall = 1, PropFlagLegacy = 2, MaxPropKind = 100, LegacyPropKinds = 34, MaxPropVariant = 3,
            MaxGroundVariant = 15;
        /// <summary>World units per tile: a prop's tile (x / 32, y / 32) must be inside the map.</summary>
        const int PropTile = 32;
        const int CampRowLength = 7, PropRowLength = 7;
        static readonly MapCamp[] NoCamps = new MapCamp[0];
        static readonly MapProp[] NoProps = new MapProp[0];
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
        /// <summary>Camp markers in map order (the WireCamp row order). Empty when the section is absent.</summary>
        public MapCamp[] Camps { get; private set; } = NoCamps;
        /// <summary>The coliseum rectangle and gates, or null when absent.</summary>
        public MapColiseum Coliseum { get; private set; }
        /// <summary>Row-major bush plane: 0 none, else the legacy bush id. Null when absent.</summary>
        public byte[] Bushes { get; private set; }
        /// <summary>Cosmetic props (reserved). Empty when absent.</summary>
        public MapProp[] Props { get; private set; } = NoProps;
        /// <summary>Row-major ground-variant plane (reserved). Null when absent.</summary>
        public byte[] GroundVariants { get; private set; }

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

        /// <summary>A copy carrying the protocol 17 public sections, hashes recomputed. Empty or null means absent. Refuses (never
        /// clamps) a section a decoder would refuse.</summary>
        public MapBlob WithPublic(MapCamp[] camps, MapColiseum coliseum, byte[] bushes, MapProp[] props, byte[] groundVariants)
        {
            var map = new MapBlob
            {
                W = W, H = H, Tiles = Tiles, LayerHash = LayerHash, Terrain = Terrain, Regions = Regions, TerrainMode = TerrainMode,
                Camps = camps ?? NoCamps, Coliseum = coliseum, Bushes = bushes, Props = props ?? NoProps, GroundVariants = groundVariants,
            };
            CheckPublic(map.W, map.H, map.Camps, map.Coliseum, map.Bushes, map.Props, map.GroundVariants);
            map.SemanticHash = map.PublicSemanticHash();
            map.ContextHash = ComputeContextHash(map.LayerHash, map.SemanticHash, map.TerrainMode);
            return map;
        }

        uint PublicSemanticHash() => ComputeSemanticHash(W, H, Terrain, Regions, Camps, Coliseum, Bushes, Props, GroundVariants);

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

        /// <summary>FNV-1a32 of the ground semantic bytes of a map without public sections (domain, dimensions, version, presence,
        /// present planes).</summary>
        public static uint ComputeSemanticHash(ushort w, ushort h, byte[] terrain, byte[] regions)
        {
            return ComputeSemanticHash(w, h, terrain, regions, null, null, null, null, null);
        }

        /// <summary>Version 2 semantic hash: domain, w u32, h u32, [version, presence], then in wire order the terrain and region
        /// cells, the camps section's wire bytes, the coliseum section's wire bytes, the bush cells, the props section's wire
        /// bytes and the ground-variant cells (absent sections contribute nothing).</summary>
        public static uint ComputeSemanticHash(ushort w, ushort h, byte[] terrain, byte[] regions,
            MapCamp[] camps, MapColiseum coliseum, byte[] bushes, MapProp[] props, byte[] groundVariants)
        {
            byte presence = Presence(terrain, regions, camps, coliseum, bushes, props, groundVariants);
            uint hash = BeginSemanticHash(w, h, presence);
            if (terrain != null) Feed(ref hash, terrain);
            if (regions != null) Feed(ref hash, regions);
            var lists = new Writer();
            WriteCamps(lists, camps);
            Feed(ref hash, lists.Finish());
            lists = new Writer();
            WriteColiseum(lists, coliseum);
            Feed(ref hash, lists.Finish());
            if (bushes != null) Feed(ref hash, bushes);
            lists = new Writer();
            WriteProps(lists, props);
            Feed(ref hash, lists.Finish());
            if (groundVariants != null) Feed(ref hash, groundVariants);
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
                && SameOptionalBytes(Regions, other.Regions)
                && SameCamps(Camps, other.Camps) && SameColiseum(Coliseum, other.Coliseum)
                && SameOptionalBytes(Bushes, other.Bushes) && SameProps(Props, other.Props)
                && SameOptionalBytes(GroundVariants, other.GroundVariants);
        }

        static bool SameCamps(MapCamp[] a, MapCamp[] b)
        {
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
                if (a[i].X != b[i].X || a[i].Y != b[i].Y || a[i].R != b[i].R || a[i].Zone != b[i].Zone) return false;
            return true;
        }

        static bool SameProps(MapProp[] a, MapProp[] b)
        {
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
                if (a[i].Kind != b[i].Kind || a[i].X != b[i].X || a[i].Y != b[i].Y || a[i].Variant != b[i].Variant || a[i].Flags != b[i].Flags) return false;
            return true;
        }

        static bool SameColiseum(MapColiseum a, MapColiseum b)
        {
            if (a == null || b == null) return a == null && b == null;
            if (a.X != b.X || a.Y != b.Y || a.W != b.W || a.H != b.H || a.Gates.Length != b.Gates.Length) return false;
            for (int g = 0; g < a.Gates.Length; g++)
            {
                MapGate x = a.Gates[g], y = b.Gates[g];
                if (x.Side != y.Side || x.Tiles.Length != y.Tiles.Length) return false;
                for (int t = 0; t < x.Tiles.Length; t++) if (x.Tiles[t].X != y.Tiles[t].X || x.Tiles[t].Y != y.Tiles[t].Y) return false;
            }
            return true;
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

        /// <summary>Exact size of the collision blob and the version-2 extension (ground planes and public sections).</summary>
        public int EncodedLength
        {
            get
            {
                long extension = GroundFixedLength
                    + (Terrain == null ? 0L : 4L + 3L * RunCount(Terrain))
                    + (Regions == null ? 0L : 4L + 3L * RunCount(Regions))
                    + PublicLength();
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
            int extensionLength = checked((int)(GroundFixedLength
                + (Terrain == null ? 0 : 4 + 3 * RunCount(Terrain))
                + (Regions == null ? 0 : 4 + 3 * RunCount(Regions))
                + PublicLength()));
            // EncodedLength includes the fixed Welcome header check, before its Writer allocates.
            _ = EncodedLength;

            w.U16(W); w.U16(H); w.U32(LayerHash);
            WritePlane(w, Tiles);
            w.U32((uint)extensionLength);
            w.U8(GroundVersion);
            w.U8(Presence(Terrain, Regions, Camps, Coliseum, Bushes, Props, GroundVariants));
            w.U32(SemanticHash);
            if (Terrain != null) WritePlane(w, Terrain);
            if (Regions != null) WritePlane(w, Regions);
            WriteCamps(w, Camps);
            WriteColiseum(w, Coliseum);
            if (Bushes != null) WritePlane(w, Bushes);
            WriteProps(w, Props);
            if (GroundVariants != null) WritePlane(w, GroundVariants);
            w.U8(terrainMode);
            w.U32(ComputeContextHash(LayerHash, SemanticHash, terrainMode));
        }

        long PublicLength()
        {
            long n = 0;
            if (Camps.Length > 0) n += 1 + (long)CampRowLength * Camps.Length;
            if (Coliseum != null)
            {
                n += 9;
                foreach (var g in Coliseum.Gates) n += 2 + 4L * g.Tiles.Length;
            }
            if (Bushes != null) n += 4 + 3L * RunCount(Bushes);
            if (Props.Length > 0) n += 2 + (long)PropRowLength * Props.Length;
            if (GroundVariants != null) n += 4 + 3L * RunCount(GroundVariants);
            return n;
        }

        static void WriteCamps(Writer w, MapCamp[] camps)
        {
            if (camps == null || camps.Length == 0) return;
            w.U8((byte)camps.Length);
            foreach (var c in camps) { w.U16(c.X); w.U16(c.Y); w.U16(c.R); w.U8(c.Zone); }
        }

        static void WriteColiseum(Writer w, MapColiseum c)
        {
            if (c == null) return;
            w.U16(c.X); w.U16(c.Y); w.U16(c.W); w.U16(c.H);
            w.U8((byte)c.Gates.Length);
            foreach (var g in c.Gates)
            {
                w.U8(g.Side);
                w.U8((byte)g.Tiles.Length);
                foreach (var t in g.Tiles) { w.U16(t.X); w.U16(t.Y); }
            }
        }

        static void WriteProps(Writer w, MapProp[] props)
        {
            if (props == null || props.Length == 0) return;
            w.U16((ushort)props.Length);
            foreach (var p in props) { w.U8(p.Kind); w.U16(p.X); w.U16(p.Y); w.U8(p.Variant); w.U8(p.Flags); }
        }

        static void CheckPublic(ushort w, ushort h, MapCamp[] camps, MapColiseum coliseum, byte[] bushes, MapProp[] props, byte[] groundVariants)
        {
            int total = CheckedTileCount(w, h);
            if (camps.Length > MaxCamps) throw new EncodeException("bad map camp count");
            foreach (var c in camps) if (c.Zone == 0 || c.Zone > MaxCampZone) throw new EncodeException("bad map camp zone");
            if (coliseum != null)
            {
                if (!ColiseumRectFits(coliseum.X, coliseum.Y, coliseum.W, coliseum.H, w, h)) throw new EncodeException("bad map coliseum rect");
                if (coliseum.Gates == null || coliseum.Gates.Length > MaxColiseumGates) throw new EncodeException("bad map gate count");
                foreach (var g in coliseum.Gates)
                {
                    if (g.Side > MaxGateSide) throw new EncodeException("bad map gate side");
                    if (g.Tiles == null || g.Tiles.Length == 0 || g.Tiles.Length > MaxGateTiles) throw new EncodeException("bad map gate tiles");
                    foreach (var t in g.Tiles) if (t.X >= w || t.Y >= h) throw new EncodeException("bad map gate tile");
                }
            }
            if (bushes != null && bushes.Length != total) throw new EncodeException("bad map plane length");
            if (groundVariants != null && groundVariants.Length != total) throw new EncodeException("bad map plane length");
            if (props.Length > MaxProps) throw new EncodeException("bad map prop count");
            for (int i = 0; i < props.Length; i++)
            {
                string fault = PropFault(props[i], i > 0, i > 0 ? props[i - 1] : default, w, h);
                if (fault != null) throw new EncodeException("bad map " + fault);
            }
            if (groundVariants != null)
                foreach (var v in groundVariants) if (v > MaxGroundVariant) throw new EncodeException("bad map ground variant");
        }

        /// <summary>The value checks of one prop row in the wire rules' order (flags, kind, variant, tile, order), shared by the
        /// encoder and the decoder: null when the row is valid, else the Rust reason.</summary>
        static string PropFault(MapProp p, bool hasPrevious, MapProp previous, ushort w, ushort h)
        {
            if ((p.Flags & ~(PropFlagTall | PropFlagLegacy)) != 0) return "prop flags";
            if ((p.Flags & PropFlagLegacy) != 0)
            {
                // A legacy prop's kind is a generator catalogue index; its variant is the generator's v (not checked).
                if (p.Kind >= LegacyPropKinds) return "prop kind";
            }
            else
            {
                if (p.Kind == 0 || p.Kind > MaxPropKind) return "prop kind";
                if (p.Variant > MaxPropVariant) return "prop variant";
            }
            if (p.X / PropTile >= w || p.Y / PropTile >= h) return "prop tile";
            if (hasPrevious && !PropAfter(previous, p)) return "prop order";
            return null;
        }

        /// <summary>Whether <paramref name="b"/> is strictly after <paramref name="a"/> in (y, x, kind).</summary>
        static bool PropAfter(MapProp a, MapProp b)
        {
            if (b.Y != a.Y) return b.Y > a.Y;
            if (b.X != a.X) return b.X > a.X;
            return b.Kind > a.Kind;
        }

        static bool ColiseumRectFits(ushort x, ushort y, ushort cw, ushort ch, ushort w, ushort h)
            => cw >= 1 && ch >= 1 && x + cw <= w && y + ch <= h;

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

            // Only now allocate the decoded planes; total decoded plane storage is explicitly capped at 5 MiB.
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
            MapCamp[] camps = (presence & CampsPresent) != 0 ? ReadCamps(ref body) : NoCamps;
            MapColiseum coliseum = (presence & ColiseumPresent) != 0 ? ReadColiseum(ref body) : null;
            byte[] bushes = (presence & BushesPresent) != 0 ? DecodeSemanticPlane(ref body, total, byte.MaxValue) : null;
            MapProp[] props = (presence & PropsPresent) != 0 ? ReadProps(ref body) : NoProps;
            byte[] groundVariants = (presence & GroundVariantsPresent) != 0 ? DecodeSemanticPlane(ref body, total, byte.MaxValue) : null;
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
                Camps = camps, Coliseum = coliseum, Bushes = bushes, Props = props, GroundVariants = groundVariants,
            };
        }

        // Decoders for sections the preflight already validated.
        static MapCamp[] ReadCamps(ref Reader r)
        {
            var camps = new MapCamp[r.U8()];
            for (int i = 0; i < camps.Length; i++)
            {
                ushort x = r.U16(), y = r.U16(), radius = r.U16();
                camps[i] = new MapCamp(x, y, radius, r.U8());
            }
            return camps;
        }

        static MapColiseum ReadColiseum(ref Reader r)
        {
            ushort x = r.U16(), y = r.U16(), w = r.U16(), h = r.U16();
            var gates = new MapGate[r.U8()];
            for (int g = 0; g < gates.Length; g++)
            {
                byte side = r.U8();
                var tiles = new MapTile[r.U8()];
                for (int t = 0; t < tiles.Length; t++)
                {
                    ushort tx = r.U16();
                    tiles[t] = new MapTile(tx, r.U16());
                }
                gates[g] = new MapGate(side, tiles);
            }
            return new MapColiseum(x, y, w, h, gates);
        }

        static MapProp[] ReadProps(ref Reader r)
        {
            var props = new MapProp[r.U16()];
            for (int i = 0; i < props.Length; i++)
            {
                byte kind = r.U8();
                ushort x = r.U16(), y = r.U16();
                byte variant = r.U8();
                props[i] = new MapProp(kind, x, y, variant, r.U8());
            }
            return props;
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
            if ((presence & ~KnownPresence) != 0) throw BadMap("presence");
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
            // Protocol 17 public sections, in presence-bit order. List sections hash their exact wire bytes.
            if ((presence & CampsPresent) != 0)
            {
                Reader start = extension;
                ValidateCamps(ref extension);
                FeedConsumed(ref actualSemanticHash, start, extension.Remaining);
            }
            if ((presence & ColiseumPresent) != 0)
            {
                Reader start = extension;
                ValidateColiseum(ref extension, w, h);
                FeedConsumed(ref actualSemanticHash, start, extension.Remaining);
            }
            if ((presence & BushesPresent) != 0)
            {
                uint runs = extension.U32();
                countedRuns = AddRunCount(countedRuns, runs, total, extension.Remaining);
                ValidatePublicPlane(ref extension, runs, total, ref actualSemanticHash);
            }
            if ((presence & PropsPresent) != 0)
            {
                Reader start = extension;
                ValidateProps(ref extension, w, h);
                FeedConsumed(ref actualSemanticHash, start, extension.Remaining);
            }
            if ((presence & GroundVariantsPresent) != 0)
            {
                uint runs = extension.U32();
                countedRuns = AddRunCount(countedRuns, runs, total, extension.Remaining);
                // The run checks first ("run", "length"), then the values, as Rust does.
                if (ValidatePublicPlane(ref extension, runs, total, ref actualSemanticHash) > MaxGroundVariant)
                    throw BadMap("ground variant");
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

        /// <summary>Feeds the bytes a section validator consumed: from <paramref name="start"/> until <paramref name="remainingAfter"/>
        /// bytes are left.</summary>
        static void FeedConsumed(ref uint hash, Reader start, int remainingAfter)
        {
            int consumed = start.Remaining - remainingAfter;
            for (int i = 0; i < consumed; i++) Feed(ref hash, start.U8());
        }

        static void ValidateCamps(ref Reader r)
        {
            int count = r.U8();
            if (count == 0 || count > MaxCamps) throw BadMap("camp count");
            if (r.Remaining < count * CampRowLength) throw new DecodeException(DecodeError.Truncated);
            for (int i = 0; i < count; i++)
            {
                r.U16(); r.U16(); r.U16();
                byte zone = r.U8();
                if (zone == 0 || zone > MaxCampZone) throw BadMap("camp zone");
            }
        }

        static void ValidateColiseum(ref Reader r, ushort w, ushort h)
        {
            ushort x = r.U16(), y = r.U16(), cw = r.U16(), ch = r.U16();
            if (!ColiseumRectFits(x, y, cw, ch, w, h)) throw BadMap("coliseum rect");
            int gates = r.U8();
            if (gates > MaxColiseumGates) throw BadMap("gate count");
            for (int g = 0; g < gates; g++)
            {
                if (r.U8() > MaxGateSide) throw BadMap("gate side");
                int tiles = r.U8();
                if (tiles == 0 || tiles > MaxGateTiles) throw BadMap("gate tiles");
                for (int t = 0; t < tiles; t++)
                {
                    ushort tx = r.U16(), ty = r.U16();
                    if (tx >= w || ty >= h) throw BadMap("gate tile");
                }
            }
        }

        static void ValidateProps(ref Reader r, ushort w, ushort h)
        {
            int count = r.U16();
            if (count == 0 || count > MaxProps) throw BadMap("prop count");
            if (r.Remaining < count * PropRowLength) throw new DecodeException(DecodeError.Truncated);
            MapProp previous = default;
            for (int i = 0; i < count; i++)
            {
                byte kind = r.U8();
                ushort x = r.U16(), y = r.U16();
                byte variant = r.U8();
                var prop = new MapProp(kind, x, y, variant, r.U8());
                string fault = PropFault(prop, i > 0, previous, w, h);
                if (fault != null) throw BadMap(fault);
                previous = prop;
            }
        }

        /// <summary>A bush or ground-variant plane: a zero or overlong run is "run", a short plane "length". Returns the
        /// largest value (the caller checks its own cap).</summary>
        static byte ValidatePublicPlane(ref Reader r, uint runs, int total, ref uint hash)
        {
            int length = 0;
            byte max = 0;
            for (uint i = 0; i < runs; i++)
            {
                byte value = r.U8();
                int runLength = r.U16();
                if (runLength == 0 || runLength > total - length) throw BadMap("run");
                length += runLength;
                if (value > max) max = value;
                for (int j = 0; j < runLength; j++) Feed(ref hash, value);
            }
            if (length != total) throw BadMap("length");
            return max;
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
            CheckPublic(W, H, Camps, Coliseum, Bushes, Props, GroundVariants);
            if (PublicSemanticHash() != SemanticHash) throw new EncodeException("bad semantic hash");
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

        /// <summary>Decoded planes besides collision: terrain, regions, bushes, ground variants.</summary>
        static int CountPresent(byte presence) => ((presence & TerrainPresent) == 0 ? 0 : 1) + ((presence & RegionPresent) == 0 ? 0 : 1)
            + ((presence & BushesPresent) == 0 ? 0 : 1) + ((presence & GroundVariantsPresent) == 0 ? 0 : 1);
        static byte Presence(byte[] terrain, byte[] regions, MapCamp[] camps, MapColiseum coliseum, byte[] bushes, MapProp[] props, byte[] groundVariants)
            => (byte)((terrain == null ? 0 : TerrainPresent) | (regions == null ? 0 : RegionPresent)
                | (camps == null || camps.Length == 0 ? 0 : CampsPresent) | (coliseum == null ? 0 : ColiseumPresent)
                | (bushes == null ? 0 : BushesPresent) | (props == null || props.Length == 0 ? 0 : PropsPresent)
                | (groundVariants == null ? 0 : GroundVariantsPresent));

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
