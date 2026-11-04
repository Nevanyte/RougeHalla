using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// Stage 1 prediction of the LOCAL player's walk only. The server is the authority; this only hides the round trip of a move order.
    /// Never predicts attacks, damage, deaths or other players.
    ///
    /// LIMITATION: the server walks an A* path around obstacles (legacy findPath); this model walks a straight line and slides along
    /// walls. Around corners the prediction therefore diverges and the server's snapshots correct it (smoothly under 96 u, by a snap
    /// beyond). Porting the pathfinder (crates/rh-sim/src/pathfind.rs) is a later stage.
    /// </summary>
    public sealed class LocalMotion
    {
        public const float PlayerSpeed = 170f, PlayerRadius = 12f, TileSize = 32f;
        public const double VisualTauMs = 100, OrderExpireMs = 1000;
        public const float SnapDistance = 96f;
        const float SubStep = 4f;
        const double HistoryMs = 1500;

        readonly MapBlob _map;
        readonly double[] _ht = new double[128];
        readonly float[] _hx = new float[128], _hy = new float[128];
        int _hCount, _hHead;

        float _gx, _gy;
        bool _hasGoal, _pending;
        byte _lastSeq;
        double _pendingSince, _lastStep = double.NaN;

        public bool Initialized { get; private set; }
        /// <summary>The model's position (what the walk integrates).</summary>
        public float SimX { get; private set; }
        public float SimY { get; private set; }
        /// <summary>Smoothing offset: drawn = sim + visual. Decays with tau 100 ms; reconciliation moves error here, never into a jump.</summary>
        public float VisualX { get; private set; }
        public float VisualY { get; private set; }
        public float DrawnX { get { return SimX + VisualX; } }
        public float DrawnY { get { return SimY + VisualY; } }
        public bool HasGoal { get { return _hasGoal; } }
        /// <summary>An order was sent and its move_seq has not been seen in a snapshot yet.</summary>
        public bool OrderPending { get { return _pending; } }
        /// <summary>One-way latency estimate in ms: a snapshot is compared with where the model was this long ago.</summary>
        public double LatencyMs = 50;
        public int Snaps { get; private set; }
        public int Reconciles { get; private set; }

        public LocalMotion(MapBlob map) { _map = map; }

        public void Order(float x, float y, byte seq, double nowMs)
        {
            Advance(nowMs);
            _gx = Math.Max(0, Math.Min(_map.W * TileSize, x));
            _gy = Math.Max(0, Math.Min(_map.H * TileSize, y));
            _hasGoal = Initialized;
            Pend(seq, nowMs);
        }

        public void StopOrder(byte seq, double nowMs)
        {
            Advance(nowMs);
            _hasGoal = false;
            Pend(seq, nowMs);
        }

        void Pend(byte seq, double nowMs) { _lastSeq = seq; _pending = true; _pendingSince = nowMs; }

        /// <summary>Integrates the model up to <paramref name="nowMs"/> (call every frame).</summary>
        public void Step(double nowMs) { Advance(nowMs); }

        void Advance(double nowMs)
        {
            if (double.IsNaN(_lastStep)) _lastStep = nowMs;
            double dtMs = Math.Min(100, Math.Max(0, nowMs - _lastStep));
            _lastStep = nowMs;
            if (!Initialized) return;
            if (dtMs > 0)
            {
                float decay = (float)Math.Exp(-dtMs / VisualTauMs);
                VisualX *= decay;
                VisualY *= decay;
                if (_hasGoal) Walk((float)(dtMs / 1000.0 * PlayerSpeed));
            }
            Record(nowMs);
        }

        void Walk(float budget)
        {
            while (budget > 0 && _hasGoal)
            {
                float dx = _gx - SimX, dy = _gy - SimY;
                float dist = (float)Math.Sqrt(dx * dx + dy * dy);
                if (dist <= 0.25f) { _hasGoal = false; break; }
                float step = Math.Min(Math.Min(SubStep, budget), dist);
                float ux = dx / dist, uy = dy / dist;
                float nx = SimX + ux * step, ny = SimY + uy * step;
                if (!Blocked(nx, ny)) { SimX = nx; SimY = ny; }
                else if (Math.Abs(ux) > 0.01f && !Blocked(nx, SimY)) SimX = nx;
                else if (Math.Abs(uy) > 0.01f && !Blocked(SimX, ny)) SimY = ny;
                else { _hasGoal = false; break; } // wedged against a wall: the server's path (if any) corrects us
                budget -= step;
                if (step >= dist - 1e-4f && !_hasGoal) break;
            }
        }

        /// <summary>True when a body disc at (x, y) overlaps any non-floor tile (or leaves the map).</summary>
        public bool Blocked(float x, float y)
        {
            int x0 = (int)Math.Floor((x - PlayerRadius) / TileSize), x1 = (int)Math.Floor((x + PlayerRadius) / TileSize);
            int y0 = (int)Math.Floor((y - PlayerRadius) / TileSize), y1 = (int)Math.Floor((y + PlayerRadius) / TileSize);
            for (int ty = y0; ty <= y1; ty++)
                for (int tx = x0; tx <= x1; tx++)
                {
                    bool solid = tx < 0 || ty < 0 || tx >= _map.W || ty >= _map.H || _map.Tiles[ty * _map.W + tx] != MapBlob.Floor;
                    if (!solid) continue;
                    float cx = Math.Max(tx * TileSize, Math.Min(x, tx * TileSize + TileSize));
                    float cy = Math.Max(ty * TileSize, Math.Min(y, ty * TileSize + TileSize));
                    float ddx = x - cx, ddy = y - cy;
                    if (ddx * ddx + ddy * ddy < PlayerRadius * PlayerRadius) return true;
                }
            return false;
        }

        void Record(double nowMs)
        {
            _ht[_hHead] = nowMs; _hx[_hHead] = SimX; _hy[_hHead] = SimY;
            _hHead = (_hHead + 1) % _ht.Length;
            if (_hCount < _ht.Length) _hCount++;
        }

        bool ModelAt(double t, out float x, out float y)
        {
            x = SimX; y = SimY;
            if (_hCount == 0) return false;
            int newest = (_hHead - 1 + _ht.Length) % _ht.Length;
            int oldest = (_hHead - _hCount + _ht.Length) % _ht.Length;
            if (t >= _ht[newest]) return true;
            if (t <= _ht[oldest]) { x = _hx[oldest]; y = _hy[oldest]; return true; }
            for (int k = _hCount - 1; k > 0; k--)
            {
                int b = (_hHead - _hCount + k + _ht.Length) % _ht.Length, a = (b - 1 + _ht.Length) % _ht.Length;
                if (_ht[a] <= t && t <= _ht[b])
                {
                    double span = _ht[b] - _ht[a];
                    float f = span <= 0 ? 1f : (float)((t - _ht[a]) / span);
                    x = _hx[a] + (_hx[b] - _hx[a]) * f; y = _hy[a] + (_hy[b] - _hy[a]) * f;
                    return true;
                }
            }
            return true;
        }

        void ShiftHistory(float dx, float dy) { for (int i = 0; i < _hCount; i++) { int k = (_hHead - 1 - i + _ht.Length) % _ht.Length; _hx[k] += dx; _hy[k] += dy; } }

        /// <summary>Reconciles against the authoritative self state of a snapshot received at local time <paramref name="nowMs"/>.</summary>
        public void OnSnapshot(WireSelf me, double nowMs)
        {
            Advance(nowMs);
            Snaps++;
            if (!Initialized)
            {
                Initialized = true;
                SimX = me.X; SimY = me.Y; VisualX = VisualY = 0;
                _hCount = 0; Record(nowMs);
                return;
            }
            if (me.Hp <= 0) _hasGoal = false;
            if (_pending && me.MoveSeq == _lastSeq) _pending = false;
            else if (_pending && nowMs - _pendingSince > OrderExpireMs) _pending = false; // the server never applied it
            if (_pending) return; // the server position predates our order: comparing would read our lead as an error
            float mx, my;
            ModelAt(nowMs - LatencyMs, out mx, out my);
            float ex = me.X - mx, ey = me.Y - my;
            float err = (float)Math.Sqrt(ex * ex + ey * ey);
            Reconciles++;
            SimX += ex; SimY += ey;
            ShiftHistory(ex, ey);
            if (err > SnapDistance) { VisualX = VisualY = 0; }
            else { VisualX -= ex; VisualY -= ey; } // drawn position unchanged this frame; it then decays
        }
    }
}
