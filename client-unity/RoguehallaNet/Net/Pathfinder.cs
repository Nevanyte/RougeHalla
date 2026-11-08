using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>A waypoint in world units (x right, y down), as <c>rh_sim::math::Vec2</c> on the server.</summary>
    public readonly struct PathPoint
    {
        public readonly double X;
        public readonly double Y;

        public PathPoint(double x, double y) { X = x; Y = y; }
        public override string ToString() { return "(" + X + ", " + Y + ")"; }
    }

    /// <summary>
    /// Exact C# port of the Rust authoritative pathfinder (<c>crates/rh-sim/src/pathfind.rs</c> <c>find_path</c>, itself an
    /// exact port of legacy <c>packages/shared/src/pathfind.ts</c>): A* over floor tiles with string pulling.
    /// <para>
    /// Everything that changes a waypoint is kept operation for operation: the binary heap with its sift order and the
    /// non-transitive <c>before</c> comparator (PATH_TIE_EPS 1e-9 ties fall through to g and then node index), the neighbour
    /// order d = 0..8, the octile heuristic with sqrt(2), the tile snap rings (SNAP_RADIUS 4), the start-centre slack 0.5,
    /// the goal clamp, the pull window 96 and the string pull's linear scan down from the far end of the window (clearness
    /// is not monotonic in j). All math is <c>double</c>; nothing is converted to <c>float</c> here.
    /// </para>
    /// <para>
    /// The map is the client's decoded <see cref="MapBlob"/> (the client never generates maps); the movement mask is
    /// MASK_MOVE (0xFF), so walls <em>and</em> LOW cover block. Derived navigation tables are built once per map instance.
    /// The instance holds scratch for one query at a time and is not thread-safe (the library is single-threaded by design).
    /// </para>
    /// </summary>
    public sealed class Pathfinder
    {
        /// <summary>Player body radius (rh-sim <c>PLAYER_RADIUS</c>).</summary>
        public const double PlayerRadius = 12.0;

        const double Tile = 32.0;                 // rh-sim TILE
        const double HalfTile = 16.0;             // TILE / 2
        const double Sqrt2 = 1.4142135623730951;  // core::f64::consts::SQRT_2
        const double PathTieEps = 1e-9;           // PATH_TIE_EPS
        const double StartCenterSlack = 0.5;      // START_CENTER_SLACK
        const int SnapRadius = 4;                 // SNAP_RADIUS
        const int PullWindow = 96;                // PULL_WINDOW
        const int MoveMask = 0xff;                // MASK_MOVE: walls and LOW block

        // Candidate disc memo (pathfind.rs UNKNOWN/CLEAR/BLOCKED).
        const byte DiscUnknown = 0, DiscClear = 1, DiscBlocked = 2;

        static readonly int[] StepDx = { 1, -1, 0, 0, 1, 1, -1, -1 };
        static readonly int[] StepDy = { 0, 0, 1, -1, 1, -1, 1, -1 };

        struct Node
        {
            public double G;
            public int Parent;
            public uint Stamp;
        }

        struct HeapItem
        {
            public int Node;
            public double F;
            public double G;
        }

        // ---- map identity and derived tables (built once per MapBlob instance) ----
        MapBlob _map;
        int _w, _h;
        byte[] _nav;
        int[] _comp;

        // ---- A* scratch (the generation stamp replaces a full clear, as in Rust) ----
        Node[] _nodes;
        uint _base;
        int _n;
        HeapItem[] _heap;
        int _heapCount;
        long _searches;

        // ---- path scratch ----
        int[] _tilePath = new int[16];
        int _tilePathLen;
        double[] _candX = new double[16];
        double[] _candY = new double[16];
        int _candLen;
        byte[] _candClear = new byte[16];
        PathPoint[] _out = new PathPoint[16];
        int _outLen;

        /// <summary>Searches run (diagnostics, mirrors <c>Pathfinder::searches</c>).</summary>
        public long Searches { get { return _searches; } }

        /// <summary>
        /// Waypoints (excluding the start point) that walk a disc of <see cref="PlayerRadius"/> from the start to the goal;
        /// empty when the goal is unreachable. A goal inside a wall snaps to the nearest floor tile within four rings; the
        /// last waypoint is the exact goal when the disc fits there.
        /// </summary>
        public PathPoint[] FindPath(MapBlob map, double fromX, double fromY, double toX, double toY)
        {
            return FindPath(map, fromX, fromY, toX, toY, PlayerRadius);
        }

        /// <summary>As <see cref="FindPath(MapBlob,double,double,double,double)"/> with an explicit body radius.</summary>
        public PathPoint[] FindPath(MapBlob map, double fromX, double fromY, double toX, double toY, double radius)
        {
            Plan(map, fromX, fromY, toX, toY, radius);
            var result = new PathPoint[_outLen];
            Array.Copy(_out, result, _outLen);
            return result;
        }

        /// <summary>
        /// Allocation-free form: writes the waypoints into <paramref name="destination"/> and returns their count (0 when
        /// unreachable). The destination must hold at least <c>map.W * map.H</c> entries to be safe for any query.
        /// </summary>
        public int FindPath(MapBlob map, double fromX, double fromY, double toX, double toY, double radius, PathPoint[] destination)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            Plan(map, fromX, fromY, toX, toY, radius);
            if (_outLen > destination.Length)
                throw new ArgumentException("destination holds " + destination.Length + " waypoints, the path needs " + _outLen, nameof(destination));
            Array.Copy(_out, destination, _outLen);
            return _outLen;
        }

        // ----------------------------------------------------------------------------------------------------------------
        // Planning (find_path_into)

        void Plan(MapBlob map, double fromX, double fromY, double toX, double toY, double radius)
        {
            _outLen = 0;
            Prepare(map);
            // Each coordinate on its own: opposite extremes cancel in a sum.
            if (!(Finite(fromX) && Finite(fromY) && Finite(toX) && Finite(toY))) return;

            int w = _w;
            long sx = WorldToTile(fromX);
            long sy = WorldToTile(fromY);
            bool startInWall = !IsFloor(sx, sy);
            if (startInWall)
            {
                if (!SnapToFloor(fromX, fromY, out sx, out sy)) return;
            }
            long gx = WorldToTile(toX);
            long gy = WorldToTile(toY);
            var target = new PathPoint(toX, toY);
            bool goalInWall = !IsFloor(gx, gy);
            if (goalInWall)
            {
                if (!SnapToFloor(toX, toY, out gx, out gy)) return;
                target = new PathPoint(TileToCenter(gx), TileToCenter(gy));
            }
            if (!goalInWall) target = ClampClear(target, gx, gy, radius);

            // The end discs of from and target are pure functions of the map: evaluated at most once per query.
            bool? fromClear = null;
            bool? targetClear = null;
            if (!startInWall)
            {
                // segment_clear(from, target): the disc at from, the disc at target, then the rays.
                bool a = CircleClear(fromX, fromY, radius);
                fromClear = a;
                if (a)
                {
                    bool b = CircleClear(target.X, target.Y, radius);
                    targetClear = b;
                    if (b && SegmentRaysClear(new PathPoint(fromX, fromY), target, radius))
                    {
                        AddOut(target);
                        return;
                    }
                }
            }

            int si = (int)(sy * w + sx);
            int gi = (int)(gy * w + gx);
            if (_comp[si] != _comp[gi]) return;
            if (!AStar(si, gi)) return;

            // Candidates: the start tile centre when the start is in a wall or off-centre, the interior tiles, the goal
            // centre, and the clamped goal when it is not exactly that centre.
            _candLen = 0;
            if (_tilePathLen > 1
                && (startInWall
                    || Math.Abs(fromX - TileToCenter(sx)) > StartCenterSlack
                    || Math.Abs(fromY - TileToCenter(sy)) > StartCenterSlack))
            {
                AddCand(TileToCenter(_tilePath[0] % w), TileToCenter(_tilePath[0] / w));
            }
            if (_tilePathLen > 2)
            {
                for (int k = 1; k < _tilePathLen - 1; k++)
                    AddCand(TileToCenter(_tilePath[k] % w), TileToCenter(_tilePath[k] / w));
            }
            int goalTile = _tilePath[_tilePathLen - 1];
            double goalCx = TileToCenter(goalTile % w);
            double goalCy = TileToCenter(goalTile / w);
            AddCand(goalCx, goalCy);
            if (target.X != goalCx || target.Y != goalCy) AddCand(target.X, target.Y);

            // The last candidate equals target (it is target, or a tile centre numerically equal to it): its disc verdict is
            // known if the direct test evaluated it.
            EnsureCandClear();
            Array.Clear(_candClear, 0, _candLen);
            if (targetClear.HasValue) _candClear[_candLen - 1] = targetClear.Value ? DiscClear : DiscBlocked;

            // String pulling: from each anchor, the farthest j in the window whose segment is clear, scanning down from the
            // far end exactly as legacy segmentClear(anchor, cand[j]) does, with the end discs read from the memo.
            var anchor = new PathPoint(fromX, fromY);
            int anchorJ = -1; // -1: the anchor is the start point; otherwise the candidate index.
            int i = 0;
            while (i < _candLen)
            {
                int j = Math.Min(_candLen - 1, i + PullWindow);
                while (j > i)
                {
                    bool anchorClear;
                    if (anchorJ >= 0)
                    {
                        anchorClear = Disc(anchorJ, radius);
                    }
                    else
                    {
                        if (!fromClear.HasValue) fromClear = CircleClear(fromX, fromY, radius);
                        anchorClear = fromClear.Value;
                    }
                    if (anchorClear
                        && Disc(j, radius)
                        && SegmentRaysClear(anchor, CandAt(j), radius))
                    {
                        break;
                    }
                    j--;
                }
                var waypoint = CandAt(j);
                AddOut(waypoint);
                anchor = waypoint;
                anchorJ = j;
                i = j + 1;
            }
        }

        bool Disc(int j, double radius)
        {
            if (_candClear[j] == DiscUnknown)
                _candClear[j] = CircleClear(_candX[j], _candY[j], radius) ? DiscClear : DiscBlocked;
            return _candClear[j] == DiscClear;
        }

        // ----------------------------------------------------------------------------------------------------------------
        // A* (astar) and its heap

        /// <summary>f1/g1/n1 sorts before f2/g2/n2: f within PATH_TIE_EPS, then larger g, then smaller node index.</summary>
        static bool Before(double f1, double g1, int n1, double f2, double g2, int n2)
        {
            if (Math.Abs(f1 - f2) > PathTieEps) return f1 < f2;
            if (g1 != g2) return g1 > g2;
            return n1 < n2;
        }

        static double Octile(long x, long y, long gx, long gy)
        {
            double dx = Math.Abs((double)(x - gx));
            double dy = Math.Abs((double)(y - gy));
            return dx + dy + (Sqrt2 - 2.0) * Math.Min(dx, dy);
        }

        void Reset(int n)
        {
            if (_n != n || _base >= uint.MaxValue - 2)
            {
                _n = n;
                _nodes = new Node[n];
                _base = 0;
                if (_heap == null) _heap = new HeapItem[1024];
            }
            // Every stamp is now below base: g = infinity, open.
            _base += 2;
            _heapCount = 0;
        }

        void Push(int node, double f, double g)
        {
            if (_heapCount == _heap.Length) Array.Resize(ref _heap, _heap.Length * 2);
            _heap[_heapCount++] = new HeapItem { Node = node, F = f, G = g };
            int i = _heapCount - 1;
            while (i > 0)
            {
                int p = (i - 1) >> 1;
                if (!Before(f, g, node, _heap[p].F, _heap[p].G, _heap[p].Node)) break;
                _heap[i] = _heap[p];
                i = p;
            }
            _heap[i] = new HeapItem { Node = node, F = f, G = g };
        }

        int Pop()
        {
            int top = _heap[0].Node;
            HeapItem lastItem = _heap[--_heapCount];
            int last = _heapCount;
            if (last > 0)
            {
                int node = lastItem.Node;
                double f = lastItem.F, g = lastItem.G;
                int i = 0;
                while (true)
                {
                    int c = 2 * i + 1;
                    if (c >= last) break;
                    if (c + 1 < last
                        && Before(_heap[c + 1].F, _heap[c + 1].G, _heap[c + 1].Node, _heap[c].F, _heap[c].G, _heap[c].Node))
                    {
                        c++;
                    }
                    if (!Before(_heap[c].F, _heap[c].G, _heap[c].Node, f, g, node)) break;
                    _heap[i] = _heap[c];
                    i = c;
                }
                _heap[i] = lastItem;
            }
            return top;
        }

        bool AStar(int start, int goal)
        {
            int w = _w;
            Reset(w * _h);
            _searches++;
            uint baseStamp = _base;
            uint closed = baseStamp + 1;
            int gx = goal % w;
            int gy = goal / w;
            _nodes[start] = new Node { G = 0.0, Parent = -1, Stamp = baseStamp };
            Push(start, Octile(start % w, start / w, gx, gy), 0.0);
            while (_heapCount > 0)
            {
                int node = Pop();
                if (_nodes[node].Stamp == closed) continue;
                _nodes[node].Stamp = closed;
                if (node == goal)
                {
                    _tilePathLen = 0;
                    int n = node;
                    while (n != -1)
                    {
                        AddTile(n);
                        n = _nodes[n].Parent;
                    }
                    Array.Reverse(_tilePath, 0, _tilePathLen);
                    return true;
                }
                int x = node % w;
                int y = node / w;
                double g = _nodes[node].G;
                byte steps = _nav[node];
                for (int d = 0; d < 8; d++)
                {
                    if ((steps & (1 << d)) == 0) continue;
                    int nx = x + StepDx[d];
                    int ny = y + StepDy[d];
                    int ni = ny * w + nx;
                    Node nn = _nodes[ni];
                    if (nn.Stamp == closed) continue;
                    double ng = g + (d >= 4 ? Sqrt2 : 1.0);
                    double oldG = nn.Stamp == baseStamp ? nn.G : double.PositiveInfinity;
                    if (ng < oldG)
                    {
                        _nodes[ni] = new Node { G = ng, Parent = node, Stamp = baseStamp };
                        Push(ni, ng + Octile(nx, ny, gx, gy), ng);
                    }
                }
            }
            return false;
        }

        // ----------------------------------------------------------------------------------------------------------------
        // Snapping, clamping, line of sight (geometry.rs / map.rs)

        static bool Finite(double v) { return !double.IsNaN(v) && !double.IsInfinity(v); }

        static long FloorI64(double v)
        {
            if (double.IsNaN(v)) return 0;
            if (v >= 9223372036854775808.0) return long.MaxValue;
            if (v <= -9223372036854775808.0) return long.MinValue;
            long t = (long)v;
            if ((double)t > v) t--;
            return t;
        }

        static long CeilI64(double v)
        {
            if (double.IsNaN(v)) return 0;
            if (v >= 9223372036854775808.0) return long.MaxValue;
            if (v <= -9223372036854775808.0) return long.MinValue;
            long t = (long)v;
            if ((double)t < v) t++;
            return t;
        }

        static long SatAdd(long a, long b)
        {
            if (b > 0 && a > long.MaxValue - b) return long.MaxValue;
            if (b < 0 && a < long.MinValue - b) return long.MinValue;
            return a + b;
        }

        static long SatSub(long a, long b)
        {
            if (b > 0 && a < long.MinValue + b) return long.MinValue;
            if (b < 0 && a > long.MaxValue + b) return long.MaxValue;
            return a - b;
        }

        // f64::max / f64::min: a NaN argument yields the other one.
        static double Max(double a, double b)
        {
            if (double.IsNaN(a)) return b;
            if (double.IsNaN(b)) return a;
            return a > b ? a : b;
        }

        static double Min(double a, double b)
        {
            if (double.IsNaN(a)) return b;
            if (double.IsNaN(b)) return a;
            return a < b ? a : b;
        }

        static long WorldToTile(double v) { return FloorI64(v / Tile); }

        static double TileToCenter(long t) { return (double)t * Tile + HalfTile; }

        bool IsFloor(long tx, long ty)
        {
            return tx >= 0 && ty >= 0 && tx < _w && ty < _h && _map.Tiles[(int)(ty * _w + tx)] == MapBlob.Floor;
        }

        bool Blocked(long tx, long ty)
        {
            if (tx < 0 || ty < 0 || tx >= _w || ty >= _h) return true;
            return (_map.Tiles[(int)(ty * _w + tx)] & MoveMask) != 0;
        }

        bool SnapToFloor(double x, double y, out long sx, out long sy)
        {
            long cx = WorldToTile(x);
            long cy = WorldToTile(y);
            for (long ring = 1; ring <= SnapRadius; ring++)
            {
                bool found = false;
                long bestX = 0, bestY = 0;
                double bestD = double.PositiveInfinity;
                for (long dy = -ring; dy <= ring; dy++)
                {
                    long rest = ring - Math.Abs(dy);
                    long dx0 = rest == 0 ? 0 : -rest;
                    long dx1 = rest == 0 ? 0 : rest;
                    for (long dx = dx0; dx <= dx1; dx = dx1)
                    {
                        long tx = SatAdd(cx, dx);
                        long ty = SatAdd(cy, dy);
                        if (IsFloor(tx, ty))
                        {
                            double ex = TileToCenter(tx) - x;
                            double ey = TileToCenter(ty) - y;
                            double d = ex * ex + ey * ey;
                            if (d < bestD)
                            {
                                bestD = d;
                                bestX = tx;
                                bestY = ty;
                                found = true;
                            }
                        }
                        if (dx == dx1) break;
                    }
                }
                if (found)
                {
                    sx = bestX;
                    sy = bestY;
                    return true;
                }
            }
            sx = 0;
            sy = 0;
            return false;
        }

        PathPoint ClampClear(PathPoint p, long gx, long gy, double radius)
        {
            if (CircleClear(p.X, p.Y, radius)) return p;
            double x0 = (double)gx * Tile;
            double y0 = (double)gy * Tile;
            double x = p.X;
            double y = p.Y;
            if (Blocked(gx - 1, gy)) x = Max(x, x0 + radius);
            if (Blocked(gx + 1, gy)) x = Min(x, x0 + Tile - radius);
            if (Blocked(gx, gy - 1)) y = Max(y, y0 + radius);
            if (Blocked(gx, gy + 1)) y = Min(y, y0 + Tile - radius);
            var clamped = new PathPoint(x, y);
            if (CircleClear(clamped.X, clamped.Y, radius)) return clamped;
            return new PathPoint(TileToCenter(gx), TileToCenter(gy));
        }

        /// <summary>Does a disc of radius at (cx, cy) overlap no wall or LOW tile? (circle_clear, MASK_MOVE)</summary>
        bool CircleClear(double cx, double cy, double radius)
        {
            if (!Finite(cx + cy + radius)) return false;
            long tx = FloorI64(cx / Tile);
            long ty = FloorI64(cy / Tile);
            if (radius <= 0.0) return !Blocked(tx, ty);
            long reach = Math.Max(1L, CeilI64(radius / Tile));
            // A 3x3 block of floor tiles has no blocked tile in reach 1.
            if (reach == 1 && IsFloor(tx, ty) && NavAt(tx, ty) == 0xFF) return true;
            double r2 = radius * radius;
            long j0 = SatSub(ty, reach), j1 = SatAdd(ty, reach);
            long i0 = SatSub(tx, reach), i1 = SatAdd(tx, reach);
            for (long j = j0; ; j++)
            {
                for (long i = i0; ; i++)
                {
                    if (Blocked(i, j))
                    {
                        double nx = Min(Max(cx, (double)i * Tile), (double)SatAdd(i, 1) * Tile);
                        double ny = Min(Max(cy, (double)j * Tile), (double)SatAdd(j, 1) * Tile);
                        double ddx = cx - nx;
                        double ddy = cy - ny;
                        if (ddx * ddx + ddy * ddy < r2) return false;
                    }
                    if (i == i1) break;
                }
                if (j == j1) break;
            }
            return true;
        }

        byte NavAt(long tx, long ty) { return _nav[(int)(ty * _w + tx)]; }

        /// <summary>The ray part of segment_clear: the centre ray and the side rays (both end discs known clear).</summary>
        bool SegmentRaysClear(PathPoint a, PathPoint b, double radius)
        {
            if (RayBlocked(a.X, a.Y, b.X, b.Y)) return false;
            double dx = b.X - a.X;
            double dy = b.Y - a.Y;
            double len = Math.Sqrt(dx * dx + dy * dy);
            if (len == 0.0 || radius <= 0.0) return true;
            double nx = -dy / len;
            double ny = dx / len;
            long rays = CeilI64(radius / Tile);
            for (long k = 1; k <= rays; k++)
            {
                double off = (radius * (double)k) / (double)rays;
                double ox = nx * off;
                double oy = ny * off;
                if (RayBlocked(a.X + ox, a.Y + oy, b.X + ox, b.Y + oy)) return false;
                if (RayBlocked(a.X - ox, a.Y - oy, b.X - ox, b.Y - oy)) return false;
            }
            return true;
        }

        /// <summary>Grid traversal verdict (ray_blocked / ray_blocked_checked): same decisions as rh-sim geometry.rs.</summary>
        bool RayBlocked(double x0, double y0, double x1, double y1)
        {
            if (!Finite(x0 + y0 + x1 + y1)) return true;
            long tx = FloorI64(x0 / Tile);
            long ty = FloorI64(y0 / Tile);
            if (Blocked(tx, ty)) return true;
            double dx = x1 - x0;
            double dy = y1 - y0;
            if (dx * dx + dy * dy == 0.0) return false;
            long stepX = dx > 0.0 ? 1 : dx < 0.0 ? -1 : 0;
            long stepY = dy > 0.0 ? 1 : dy < 0.0 ? -1 : 0;
            double tMaxX = stepX == 0 ? double.PositiveInfinity : (Edge(tx, stepX) - x0) / dx;
            double tMaxY = stepY == 0 ? double.PositiveInfinity : (Edge(ty, stepY) - y0) / dy;
            for (; ; )
            {
                double t = tMaxX < tMaxY ? tMaxX : tMaxY;
                if (t > 1.0) return false;
                bool crossX = tMaxX <= t;
                bool crossY = tMaxY <= t;
                if (crossX && crossY && (Blocked(tx + stepX, ty) || Blocked(tx, ty + stepY))) return true;
                if (crossX)
                {
                    tx += stepX;
                    tMaxX = (Edge(tx, stepX) - x0) / dx;
                }
                if (crossY)
                {
                    ty += stepY;
                    tMaxY = (Edge(ty, stepY) - y0) / dy;
                }
                if (Blocked(tx, ty)) return true;
            }
        }

        static double Edge(long t, long step)
        {
            return (double)(t + (step > 0 ? 1 : 0)) * Tile;
        }

        // ----------------------------------------------------------------------------------------------------------------
        // Derived map tables

        void Prepare(MapBlob map)
        {
            if (map == null) throw new ArgumentNullException(nameof(map));
            if (ReferenceEquals(map, _map)) return;
            _map = map;
            _w = map.W;
            _h = map.H;
            BuildTables();
            // Force the next Reset to allocate the node array for this map size.
            _n = 0;
            _base = 0;
            _heapCount = 0;
            _tilePathLen = 0;
            _candLen = 0;
            _outLen = 0;
        }

        void BuildTables()
        {
            int n = _w * _h;
            byte[] tiles = _map.Tiles;
            _comp = new int[n];
            for (int i = 0; i < n; i++) _comp[i] = -1;
            var queue = new int[n];
            int id = 0;
            for (int s = 0; s < n; s++)
            {
                if (tiles[s] != MapBlob.Floor || _comp[s] >= 0) continue;
                int head = 0, tail = 0;
                queue[tail++] = s;
                _comp[s] = id;
                while (head < tail)
                {
                    int i = queue[head++];
                    int x = i % _w;
                    if (x > 0) Visit(i - 1, id, tiles, queue, ref tail);
                    if (x < _w - 1) Visit(i + 1, id, tiles, queue, ref tail);
                    if (i >= _w) Visit(i - _w, id, tiles, queue, ref tail);
                    if (i < n - _w) Visit(i + _w, id, tiles, queue, ref tail);
                }
                id++;
            }

            _nav = new byte[n];
            for (int y = 0; y < _h; y++)
            {
                for (int x = 0; x < _w; x++)
                {
                    int e = FloorBit(x + 1, y);
                    int wv = FloorBit(x - 1, y);
                    int s = FloorBit(x, y + 1);
                    int no = FloorBit(x, y - 1);
                    _nav[y * _w + x] = (byte)(e
                        | wv << 1
                        | s << 2
                        | no << 3
                        | ((FloorBit(x + 1, y + 1) & e & s) << 4)
                        | ((FloorBit(x + 1, y - 1) & e & no) << 5)
                        | ((FloorBit(x - 1, y + 1) & wv & s) << 6)
                        | ((FloorBit(x - 1, y - 1) & wv & no) << 7));
                }
            }
        }

        void Visit(int j, int id, byte[] tiles, int[] queue, ref int tail)
        {
            if (tiles[j] == MapBlob.Floor && _comp[j] < 0)
            {
                _comp[j] = id;
                queue[tail++] = j;
            }
        }

        int FloorBit(int x, int y)
        {
            return x >= 0 && y >= 0 && x < _w && y < _h && _map.Tiles[y * _w + x] == MapBlob.Floor ? 1 : 0;
        }

        // ----------------------------------------------------------------------------------------------------------------
        // Scratch growth

        void AddTile(int tile)
        {
            if (_tilePathLen == _tilePath.Length) Array.Resize(ref _tilePath, _tilePath.Length * 2);
            _tilePath[_tilePathLen++] = tile;
        }

        void AddCand(double x, double y)
        {
            if (_candLen == _candX.Length)
            {
                Array.Resize(ref _candX, _candX.Length * 2);
                Array.Resize(ref _candY, _candY.Length * 2);
            }
            _candX[_candLen] = x;
            _candY[_candLen] = y;
            _candLen++;
        }

        PathPoint CandAt(int j) { return new PathPoint(_candX[j], _candY[j]); }

        void EnsureCandClear()
        {
            if (_candClear.Length < _candLen) _candClear = new byte[Math.Max(_candLen, _candClear.Length * 2)];
        }

        void AddOut(PathPoint p)
        {
            if (_outLen == _out.Length) Array.Resize(ref _out, _out.Length * 2);
            _out[_outLen++] = p;
        }
    }
}
