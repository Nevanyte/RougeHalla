using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// PRESENTATION ONLY. The server decides what the player sees: it sends an actor only when the actor stands on a tile the
    /// player's eyes reached within the last 30 s (rh-sim <c>vision.rs</c>). This is the client's mirror of that rule, used to
    /// draw a fog of war that agrees with where actors stop being delivered. It never decides what exists, never feeds gameplay
    /// and can only dim: a delivered actor is always drawn, whatever this says (see <see cref="FogMask.Compose"/>).
    /// <para>
    /// MIRRORED CONSTANTS. The values below are copies of rh-sim constants. <c>protocol/fixtures/sight_v1.json</c> carries the
    /// Rust values and <c>SightGoldenTests</c> asserts every one of them equal, so a drift fails a test. Protocol 16 delivers the live
    /// values in the Welcome (<see cref="WireVision"/>); these are only the defaults when none arrive.
    /// </para>
    /// </summary>
    public sealed class VisionRule
    {
        // ---- MIRRORED FROM rh-sim/src/constants.rs (asserted by sight_v1.json) -------------------------------------------
        // Defaults, used only when the server delivers no vision block (an older server or a fixture without one).
        /// <summary>VISION_RADIUS (u).</summary>
        public const double DefaultRadius = 900.0;
        /// <summary>TILE (u).</summary>
        public const double DefaultTile = 32.0;
        /// <summary>VISION_TRAIL_MS: a revealed tile stays visible this long after the last time the eyes reached it.</summary>
        public const double DefaultTrailMs = 30000.0;
        /// <summary>VISION_UPDATE_MS: the trail takes a sample at most this often.</summary>
        public const double DefaultUpdateMs = 100.0;
        /// <summary>TICK_MS (1000 / TICK_RATE).</summary>
        public const double TickMs = 50.0;
        /// <summary>MASK_SIGHT: tile-class bits that block sight. Only the wall class (1) has bit 0; LOW cover (2) does not.</summary>
        public const byte DefaultSightMask = 0x01;
        /// <summary>BUSH_REVEAL_RADIUS (u) and BUSH_REVEAL_MS: bush concealment is per actor, not per tile (not mirrored in the fog).</summary>
        public const double BushRevealRadius = 64.0;
        public const double BushRevealMs = 1000.0;
        /// <summary>The region-plane code of the coliseum (mapdata RegionId::Coliseum).</summary>
        public const byte RegionColiseum = 6;
        // -------------------------------------------------------------------------------------------------------------------

        /// <summary>The only rules version this client mirrors.</summary>
        public const byte SupportedVersion = 1;

        readonly MapBlob _map;
        readonly int _w, _h;
        /// <summary>Effective values: the delivered ones, or the defaults when none were delivered.</summary>
        public double Radius { get; private set; }
        public double Tile { get; private set; }
        public double TrailMs { get; private set; }
        public double UpdateMs { get; private set; }
        public byte SightMask { get; private set; }
        /// <summary>False when the delivered rules are not ones this client can mirror (unknown version, or a non-finite or
        /// non-positive radius, tile or period): the fog must then be off, never a guess.</summary>
        public bool Usable { get; private set; }
        readonly int _coliseumX, _coliseumY, _coliseumW, _coliseumH;

        static bool Good(double v) { return double.IsFinite(v) && v > 0.0; }

        public VisionRule(MapBlob map, WireVision vision = null)
        {
            _map = map ?? throw new ArgumentNullException(nameof(map));
            _w = map.W; _h = map.H;
            Radius = DefaultRadius; Tile = DefaultTile; TrailMs = DefaultTrailMs; UpdateMs = DefaultUpdateMs; SightMask = DefaultSightMask;
            Usable = true;
            if (vision != null)
            {
                Radius = vision.Radius; Tile = vision.Tile; TrailMs = vision.TrailMs; UpdateMs = vision.UpdateMs; SightMask = vision.SightMask;
                Usable = vision.Version == SupportedVersion && Good(Radius) && Good(Tile) && Good(UpdateMs)
                    && double.IsFinite(TrailMs) && TrailMs >= 0.0;
            }
            // The server reveals the coliseum's whole rectangle to anyone standing in it. The wire carries the region plane, not
            // the rectangle, so take the bounding box of the coliseum tiles (the golden asserts it equals the server's rectangle). A delivered rectangle wins over this.
            _coliseumX = _coliseumY = _coliseumW = _coliseumH = 0;
            if (vision != null && vision.HasColiseum)
            {
                _coliseumX = vision.ColiseumX; _coliseumY = vision.ColiseumY; _coliseumW = vision.ColiseumW; _coliseumH = vision.ColiseumH;
            }
            else if (map.Regions != null && map.Regions.Length == _w * _h)
            {
                int x0 = int.MaxValue, y0 = int.MaxValue, x1 = -1, y1 = -1;
                for (int y = 0; y < _h; y++)
                    for (int x = 0; x < _w; x++)
                        if (map.Regions[y * _w + x] == RegionColiseum)
                        {
                            if (x < x0) x0 = x;
                            if (x > x1) x1 = x;
                            if (y < y0) y0 = y;
                            if (y > y1) y1 = y;
                        }
                if (x1 >= 0) { _coliseumX = x0; _coliseumY = y0; _coliseumW = x1 - x0 + 1; _coliseumH = y1 - y0 + 1; }
            }
        }

        public MapBlob Map { get { return _map; } }
        public int Width { get { return _w; } }
        public int Height { get { return _h; } }
        public bool HasColiseum { get { return _coliseumW > 0; } }
        /// <summary>Tile rectangle of the coliseum (x, y, w, h), zeros without a region plane.</summary>
        public void ColiseumRect(out int x, out int y, out int w, out int h) { x = _coliseumX; y = _coliseumY; w = _coliseumW; h = _coliseumH; }

        /// <summary><c>TileMap::blocked(tx, ty, MASK_SIGHT)</c>: off the map blocks.</summary>
        public bool Blocked(long tx, long ty)
        {
            if (tx < 0 || ty < 0 || tx >= _w || ty >= _h) return true;
            return (_map.Tiles[ty * _w + tx] & SightMask) != 0;
        }

        /// <summary>vision.rs <c>in_radius</c>.</summary>
        public bool InRadius(double ax, double ay, double bx, double by)
        {
            double dx = bx - ax, dy = by - ay;
            return dx * dx + dy * dy <= Radius * Radius;
        }

        long TileOf(double v) { return (long)Math.Floor(v / Tile); }

        /// <summary>
        /// vision.rs <c>scene_line_blocked</c> (legacy hasVisionLineOfSight), operation for operation: the first wall face is
        /// visible, crossing a corner next to either wall blocks, and the walk stops on reaching the end tile. Not symmetric.
        /// </summary>
        public bool LineBlocked(double x, double y, double endX, double endY)
        {
            if (!double.IsFinite(x + y + endX + endY)) return true;
            // Far outside the world the start or end tile is off the map, which blocks (Rust saturates its i64 cast).
            const double Far = 1e12;
            if (Math.Abs(x) > Far || Math.Abs(y) > Far || Math.Abs(endX) > Far || Math.Abs(endY) > Far) return true;
            long tx = TileOf(x), ty = TileOf(y);
            long ex = TileOf(endX), ey = TileOf(endY);
            if (ex < 0 || ey < 0 || ex >= _w || ey >= _h || Blocked(tx, ty)) return true;
            double dx = endX - x, dy = endY - y;
            long sx = dx > 0.0 ? 1 : dx < 0.0 ? -1 : 0;
            long sy = dy > 0.0 ? 1 : dy < 0.0 ? -1 : 0;
            double crossX = Crossing(tx, sx, x, dx), crossY = Crossing(ty, sy, y, dy);
            while (tx != ex || ty != ey)
            {
                double cross = Math.Min(crossX, crossY);
                bool acrossX = crossX == cross, acrossY = crossY == cross;
                if (acrossX && acrossY && (Blocked(tx + sx, ty) || Blocked(tx, ty + sy))) return true;
                if (acrossX) { tx += sx; crossX = Crossing(tx, sx, x, dx); }
                if (acrossY) { ty += sy; crossY = Crossing(ty, sy, y, dy); }
                if ((tx != ex || ty != ey) && Blocked(tx, ty)) return true;
            }
            return false;
        }

        double Crossing(long at, long sign, double start, double d)
        {
            if (sign == 0) return double.PositiveInfinity;
            return ((at + (sign > 0 ? 1 : 0)) * Tile - start) / d;
        }

        /// <summary>
        /// vision.rs <c>reveals_tile</c>: whether an eye at (ox, oy) reaches tile (tx, ty): the whole coliseum rectangle when the eye
        /// stands in the coliseum; the standing tile itself; otherwise the tile centre within the radius and in line of sight.
        /// </summary>
        public bool RevealsTile(double ox, double oy, int tx, int ty)
        {
            if (HasColiseum && tx >= _coliseumX && ty >= _coliseumY && tx < _coliseumX + _coliseumW && ty < _coliseumY + _coliseumH
                && InColiseum(ox, oy)) return true;
            long sx = TileOf(ox), sy = TileOf(oy);
            if (sx == tx && sy == ty) return !Blocked(sx, sy);
            double cx = (tx + 0.5) * Tile, cy = (ty + 0.5) * Tile;
            return InRadius(ox, oy, cx, cy) && !LineBlocked(ox, oy, cx, cy);
        }

        bool InColiseum(double x, double y)
        {
            if (_map.Regions == null || _map.Regions.Length != _w * _h || !double.IsFinite(x + y)) return false;
            long tx = TileOf(x), ty = TileOf(y);
            if (tx < 0 || ty < 0 || tx >= _w || ty >= _h) return false;
            return _map.Regions[ty * _w + tx] == RegionColiseum;
        }
    }

    /// <summary>
    /// The tiles the local eyes have reached in the last <see cref="VisionRule.TrailMs"/>: the server's per-tile trail, rebuilt from
    /// the player's own delivered position. A tile counts as seen until its deadline (exclusive); the legacy client drew its fog the
    /// same way. A client that joined mid-match does not know the earlier 30 s, so its fog can be darker than the server's view for up
    /// to 30 s; that errs on the side of hiding, and delivered actors are always cleared anyway.
    /// </summary>
    public sealed class VisionField
    {
        readonly VisionRule _rule;
        readonly int _w, _h;
        readonly double[] _expires;
        readonly byte[] _fogged;   // 1 = not seen (fog), 0 = seen
        int[] _lastRevealed = new int[4096];
        int _lastRevealedCount;
        double _lastOx = double.NaN, _lastOy = double.NaN, _lastSampleMs = double.NegativeInfinity;
        double _minExpiry = double.PositiveInfinity;
        int _dMinX, _dMinY, _dMaxX, _dMaxY;
        bool _dirty;

        public VisionField(VisionRule rule)
        {
            _rule = rule ?? throw new ArgumentNullException(nameof(rule));
            _w = rule.Width; _h = rule.Height;
            _expires = new double[_w * _h];
            _fogged = new byte[_w * _h];
            Reset();
        }

        public int Width { get { return _w; } }
        public int Height { get { return _h; } }
        public VisionRule Rule { get { return _rule; } }
        /// <summary>1 where the tile is not seen (fog), 0 where it is; row-major, shared storage (do not write).</summary>
        public byte[] Fogged { get { return _fogged; } }
        /// <summary>True once at least one sample has been taken since <see cref="Reset"/>.</summary>
        public bool HasSample { get { return !double.IsNaN(_lastOx); } }

        public bool IsFogged(int tx, int ty) { return tx < 0 || ty < 0 || tx >= _w || ty >= _h || _fogged[ty * _w + tx] != 0; }

        /// <summary>Forgets everything (a new match, a resume, a map change): every tile is unseen until the next sample.</summary>
        public void Reset()
        {
            for (int i = 0; i < _fogged.Length; i++) { _fogged[i] = 1; _expires[i] = double.NegativeInfinity; }
            _lastRevealedCount = 0; _lastOx = _lastOy = double.NaN; _lastSampleMs = double.NegativeInfinity; _minExpiry = double.PositiveInfinity;
            _dMinX = 0; _dMinY = 0; _dMaxX = _w - 1; _dMaxY = _h - 1; _dirty = true;
        }

        /// <summary>
        /// Advances to server time <paramref name="nowMs"/> with the eyes at (ox, oy) (the newest delivered own position). Samples at
        /// most every <see cref="VisionRule.UpdateMs"/>; recomputes the reach only when the position changed; expires old tiles.
        /// Returns true when any tile changed state (the dirty rectangle says where).
        /// </summary>
        public bool Update(double ox, double oy, double nowMs)
        {
            if (!double.IsFinite(ox + oy + nowMs)) return false;
            // A clock that went backwards is a new timeline: start over rather than keep stamps from a later one.
            if (nowMs < _lastSampleMs) Reset();
            if (nowMs - _lastSampleMs >= _rule.UpdateMs) Sample(ox, oy, nowMs);
            if (nowMs >= _minExpiry) Expire(nowMs);
            return _dirty;
        }

        void Sample(double ox, double oy, double nowMs)
        {
            _lastSampleMs = nowMs;
            double until = nowMs + _rule.TrailMs;
            if (!(ox == _lastOx && oy == _lastOy)) ComputeReach(ox, oy);
            _lastOx = ox; _lastOy = oy;
            for (int k = 0; k < _lastRevealedCount; k++)
            {
                int i = _lastRevealed[k];
                _expires[i] = until;
                if (_fogged[i] != 0) { _fogged[i] = 0; Touch(i % _w, i / _w); }
            }
            if (_lastRevealedCount > 0 && until < _minExpiry) _minExpiry = until;
        }

        void ComputeReach(double ox, double oy)
        {
            _lastRevealedCount = 0;
            int span = (int)Math.Ceiling(_rule.Radius / _rule.Tile) + 1;
            int cx = (int)Math.Floor(ox / _rule.Tile), cy = (int)Math.Floor(oy / _rule.Tile);
            int x0 = Math.Max(0, cx - span), x1 = Math.Min(_w - 1, cx + span), y0 = Math.Max(0, cy - span), y1 = Math.Min(_h - 1, cy + span);
            // Standing in the coliseum reveals all of it, including tiles outside the radius box.
            if (_rule.HasColiseum)
            {
                _rule.ColiseumRect(out int rx, out int ry, out int rw, out int rh);
                if (cx >= rx && cy >= ry && cx < rx + rw && cy < ry + rh)
                {
                    x0 = Math.Min(x0, rx); y0 = Math.Min(y0, ry); x1 = Math.Max(x1, rx + rw - 1); y1 = Math.Max(y1, ry + rh - 1);
                }
            }
            for (int y = y0; y <= y1; y++)
                for (int x = x0; x <= x1; x++)
                    if (_rule.RevealsTile(ox, oy, x, y))
                    {
                        if (_lastRevealedCount == _lastRevealed.Length) Array.Resize(ref _lastRevealed, _lastRevealed.Length * 2);
                        _lastRevealed[_lastRevealedCount++] = y * _w + x;
                    }
        }

        void Expire(double nowMs)
        {
            double min = double.PositiveInfinity;
            for (int i = 0; i < _expires.Length; i++)
            {
                if (_fogged[i] != 0) continue;
                double e = _expires[i];
                if (nowMs >= e) { _fogged[i] = 1; Touch(i % _w, i / _w); }
                else if (e < min) min = e;
            }
            _minExpiry = min;
        }

        void Touch(int x, int y)
        {
            if (!_dirty) { _dMinX = _dMaxX = x; _dMinY = _dMaxY = y; _dirty = true; return; }
            if (x < _dMinX) _dMinX = x;
            if (x > _dMaxX) _dMaxX = x;
            if (y < _dMinY) _dMinY = y;
            if (y > _dMaxY) _dMaxY = y;
        }

        /// <summary>Reads and clears the rectangle of tiles that changed since the last call. False when nothing changed.</summary>
        public bool TakeDirty(out int minX, out int minY, out int maxX, out int maxY)
        {
            minX = _dMinX; minY = _dMinY; maxX = _dMaxX; maxY = _dMaxY;
            bool d = _dirty; _dirty = false;
            return d;
        }
    }

    /// <summary>One area the fog must leave clear: a delivered actor (or a fading one), in tile units.</summary>
    public struct FogClearing
    {
        public float TileX, TileY;
        /// <summary>1 fully clears, 0 leaves the fog as it is (a fading actor's clearing fades with it).</summary>
        public float Strength;
        public FogClearing(float tileX, float tileY, float strength) { TileX = tileX; TileY = tileY; Strength = strength; }
    }

    /// <summary>
    /// The fog as one byte per tile (0 clear, 255 full fog): the unseen tiles softened by a small blur so the edge is not a staircase,
    /// then carved clear around every delivered actor. The result feeds one texture shared by the world layer, the minimap and the Tab
    /// map. Allocation-free after construction.
    /// </summary>
    public sealed class FogMask
    {
        /// <summary>Tiles around a delivered actor that are fully clear, and the width of the soft edge beyond it.</summary>
        public const float ClearInnerTiles = 1.6f, ClearOuterTiles = 3.4f;

        readonly int _w, _h;
        readonly byte[] _base;    // blurred fog before any clearing
        readonly byte[] _alpha;   // base with clearings carved
        readonly byte[] _tmp, _work;
        readonly int[] _carved = new int[4 * 160];
        int _carvedCount;
        int _softness = 2;
        float _strength = 1f;

        public FogMask(int w, int h)
        {
            _w = w; _h = h;
            _base = new byte[w * h]; _alpha = new byte[w * h]; _tmp = new byte[w * h]; _work = new byte[w * h];
        }

        public int Width { get { return _w; } }
        public int Height { get { return _h; } }
        /// <summary>Final fog per tile, row-major. Shared storage.</summary>
        public byte[] Alpha { get { return _alpha; } }
        /// <summary>The fog before clearing (for tests).</summary>
        public byte[] Base { get { return _base; } }
        /// <summary>Blur passes, 0 (hard tile edge) to 3. Quality may lower it; it never switches the fog off.</summary>
        public int Softness { get { return _softness; } set { _softness = Math.Max(0, Math.Min(3, value)); } }
        /// <summary>Peak fog opacity, 0..1 (the shader/colour owns the look; this only scales the mask).</summary>
        public float Strength { get { return _strength; } set { _strength = Math.Max(0f, Math.Min(1f, value)); } }

        /// <summary>Re-derives the base fog (all of it) from the field and discards the clearings.</summary>
        public void RebuildAll(VisionField field)
        {
            Rebuild(field, 0, 0, _w - 1, _h - 1);
        }

        /// <summary>
        /// Re-derives the base fog inside the dirty rectangle (grown by the blur reach) from the field. Each pass spreads one tile, so the
        /// working window is the output rectangle grown by the passes again; the result equals a full rebuild.
        /// </summary>
        public void Rebuild(VisionField field, int minX, int minY, int maxX, int maxY)
        {
            int r = _softness;
            int ox0 = Math.Max(0, minX - r), oy0 = Math.Max(0, minY - r), ox1 = Math.Min(_w - 1, maxX + r), oy1 = Math.Min(_h - 1, maxY + r);
            int ix0 = Math.Max(0, minX - 2 * r), iy0 = Math.Max(0, minY - 2 * r), ix1 = Math.Min(_w - 1, maxX + 2 * r), iy1 = Math.Min(_h - 1, maxY + 2 * r);
            byte[] f = field.Fogged;
            byte full = (byte)Math.Round(255f * _strength);
            for (int y = iy0; y <= iy1; y++)
                for (int x = ix0; x <= ix1; x++)
                    _work[y * _w + x] = f[y * _w + x] != 0 ? full : (byte)0;
            for (int pass = 0; pass < r; pass++)
            {
                for (int y = iy0; y <= iy1; y++)
                    for (int x = ix0; x <= ix1; x++)
                    {
                        int l = _work[y * _w + Math.Max(ix0, x - 1)], c = _work[y * _w + x], rr = _work[y * _w + Math.Min(ix1, x + 1)];
                        _tmp[y * _w + x] = (byte)((l + 2 * c + rr + 2) >> 2);
                    }
                for (int y = iy0; y <= iy1; y++)
                    for (int x = ix0; x <= ix1; x++)
                    {
                        int u = _tmp[Math.Max(iy0, y - 1) * _w + x], c = _tmp[y * _w + x], d = _tmp[Math.Min(iy1, y + 1) * _w + x];
                        _work[y * _w + x] = (byte)((u + 2 * c + d + 2) >> 2);
                    }
            }
            // The previous clearings sit on stale base values; the rectangle is restored from the new base and carved again by Compose.
            for (int y = oy0; y <= oy1; y++)
                for (int x = ox0; x <= ox1; x++)
                {
                    byte v = _work[y * _w + x];
                    _base[y * _w + x] = v; _alpha[y * _w + x] = v;
                }
        }

        /// <summary>
        /// Carves the clearings out of the base fog. Fail-safe rule: wherever the server delivered an actor the player must see it, so a
        /// clearing always wins over the fog the client computed itself. Restores the previously carved boxes first. Returns the number
        /// of tiles written (0 when there was nothing to restore or carve).
        /// </summary>
        public int Compose(FogClearing[] clearings, int count)
        {
            int written = 0;
            if (_carvedCount > _carved.Length / 4) { Array.Copy(_base, _alpha, _base.Length); written = _base.Length; }
            else
                for (int k = 0; k < _carvedCount; k++)
                {
                    int o = k * 4;
                    written += Restore(_carved[o], _carved[o + 1], _carved[o + 2], _carved[o + 3]);
                }
            _carvedCount = 0;
            for (int i = 0; i < count; i++)
            {
                var c = clearings[i];
                if (!(c.Strength > 0f) || float.IsNaN(c.TileX) || float.IsNaN(c.TileY)) continue;
                int x0 = Math.Max(0, (int)Math.Floor(c.TileX - ClearOuterTiles)), x1 = Math.Min(_w - 1, (int)Math.Ceiling(c.TileX + ClearOuterTiles));
                int y0 = Math.Max(0, (int)Math.Floor(c.TileY - ClearOuterTiles)), y1 = Math.Min(_h - 1, (int)Math.Ceiling(c.TileY + ClearOuterTiles));
                if (x0 > x1 || y0 > y1) continue;
                float s = Math.Min(1f, c.Strength);
                for (int y = y0; y <= y1; y++)
                    for (int x = x0; x <= x1; x++)
                    {
                        float dx = x + 0.5f - c.TileX, dy = y + 0.5f - c.TileY;
                        float d = (float)Math.Sqrt(dx * dx + dy * dy);
                        float t = (d - ClearInnerTiles) / (ClearOuterTiles - ClearInnerTiles);
                        t = t <= 0f ? 0f : t >= 1f ? 1f : t * t * (3f - 2f * t);
                        float keep = 1f + (t - 1f) * s;        // lerp(1, t, s)
                        int cur = _alpha[y * _w + x];
                        int next = (int)(cur * keep + 0.5f);
                        if (next < cur) { _alpha[y * _w + x] = (byte)next; written++; }
                    }
                if (_carvedCount < _carved.Length / 4)
                {
                    int o = _carvedCount++ * 4;
                    _carved[o] = x0; _carved[o + 1] = y0; _carved[o + 2] = x1; _carved[o + 3] = y1;
                }
                else
                {
                    // More actors than boxes remembered: a full restore next time keeps the invariant.
                    _carvedCount = _carved.Length / 4 + 1;
                }
            }
            return written;
        }

        int Restore(int x0, int y0, int x1, int y1)
        {
            if (x0 > x1) return 0;
            int n = 0;
            for (int y = y0; y <= y1; y++)
                for (int x = x0; x <= x1; x++) { _alpha[y * _w + x] = _base[y * _w + x]; n++; }
            return n;
        }

        /// <summary>Restores every carved box (and, after an overflow, the whole map).</summary>
        public void ClearClearings()
        {
            if (_carvedCount > _carved.Length / 4) { Array.Copy(_base, _alpha, _base.Length); _carvedCount = 0; return; }
            for (int k = 0; k < _carvedCount; k++) { int o = k * 4; Restore(_carved[o], _carved[o + 1], _carved[o + 2], _carved[o + 3]); }
            _carvedCount = 0;
        }
    }
}
