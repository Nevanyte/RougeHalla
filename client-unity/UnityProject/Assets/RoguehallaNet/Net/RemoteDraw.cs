using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// Bounded draw-ahead of remote players (competitive netcode plan, Wave 2). PRESENTATION ONLY: nothing here decides a hit, a
    /// cooldown or an outcome, and the only server-facing number it touches is the render time attached to attacks
    /// (<see cref="AttackTime"/>).
    /// Remote players are sampled <see cref="LeadMs"/> later than the render clock, so they are drawn about 50 ms fresher. Where that
    /// time is still inside the snapshot buffer this is plain interpolation (exact). Past the newest snapshot the pose is extrapolated
    /// along the last segment's velocity for at most <see cref="LeadMs"/> and <see cref="MaxLeadDistance"/> units, and only for a
    /// live actor that is walking steadily: no lead when it stopped, turned sharply, took damage, carries any effect (stun, root,
    /// cast, ...), was displaced or has fewer than 3 samples. The drawn figure follows that target through a speed-capped follower
    /// (<see cref="MovingCorrectSpeed"/>/<see cref="RestCorrectSpeed"/>), so a wrong guess is blended back at a bounded speed and
    /// never snaps by more than a few units in a frame; only an error past <see cref="SnapDistance"/> (or a cut) snaps.
    /// Steady-state sampling makes no garbage. <see cref="Enabled"/> = false is exactly <c>SnapshotBuffer.Sample(renderMs, ...)</c>.
    /// </summary>
    public sealed class RemoteDraw
    {
        /// <summary>How far past the render clock remote players are sampled, and the most they are extrapolated beyond the newest snapshot (one tick).</summary>
        public const double LeadMs = 50;
        /// <summary>The most a figure is drawn past its newest snapshot (world units); PLAYER_SPEED 170 u/s over one tick is 8.5.</summary>
        public const float MaxLeadDistance = 10f;
        /// <summary>A last-segment step shorter than this per tick is standing still (no lead).</summary>
        public const float StopStep = 0.5f;
        /// <summary>Two consecutive segments whose directions differ by more than about 45 degrees are a turn (no lead).</summary>
        public const float TurnCos = 0.7f;
        /// <summary>Error between drawn and target past this snaps (u). Also the cut limit.</summary>
        public const float SnapDistance = 32f;
        /// <summary>Follower speed caps (u/s): a walking figure may close an error at 1.5x walk speed, a resting one slides slowly.</summary>
        public const float MovingCorrectSpeed = 255f, RestCorrectSpeed = 80f;
        const double MaxFrameMs = 250;

        /// <summary>The single switch. False draws exactly what <see cref="SnapshotBuffer.Sample"/> returns and leaves attack times alone.</summary>
        public bool Enabled;

        sealed class State
        {
            public float X, Y, TX, TY;
            public byte Displace;
            public ActorStatus Status;
            public int Frame;
        }

        struct Walk { public uint Id; public float Vx, Vy; public bool Ok; }

        readonly SnapshotBuffer _snaps;
        readonly Dictionary<uint, State> _state = new Dictionary<uint, State>();
        readonly List<InterpActor> _n0 = new List<InterpActor>(), _n1 = new List<InterpActor>(), _n2 = new List<InterpActor>();
        readonly List<Walk> _walk = new List<Walk>();
        readonly List<uint> _stale = new List<uint>();
        double _walkFor = double.NaN, _lastRender = double.NaN;
        int _frame;

        public RemoteDraw(SnapshotBuffer snaps) { _snaps = snaps; }

        /// <summary>Forget all per-actor state (new match, source-clock cut).</summary>
        public void Reset() { _state.Clear(); _walk.Clear(); _walkFor = double.NaN; _lastRender = double.NaN; }

        /// <summary>
        /// The render time attacks report: the same lead the player sees (so the server rewinds to the pose they aimed at), never newer than
        /// the newest snapshot the client holds, hence always inside the server window (which ends at the apply time, newer than any snapshot).
        /// Identity when disabled.
        /// </summary>
        public double AttackTime(double renderMs)
        {
            if (!Enabled) return renderMs;
            double newest = _snaps.NewestMs;
            if (double.IsNaN(newest)) return renderMs;
            return Math.Max(renderMs, Math.Min(renderMs + LeadMs, newest));
        }

        /// <summary>Fills <paramref name="outActors"/> with the actors to draw at render time <paramref name="renderMs"/>. False when empty.</summary>
        public bool Sample(double renderMs, List<InterpActor> outActors)
        {
            if (!Enabled)
            {
                if (_state.Count != 0) Reset();
                return _snaps.Sample(renderMs, outActors);
            }
            double rd = renderMs + LeadMs;
            if (!_snaps.Sample(rd, outActors)) return false;
            double dt = double.IsNaN(_lastRender) ? 0 : renderMs - _lastRender;
            _lastRender = renderMs;
            bool cut = double.IsNaN(dt) || dt < 0 || dt > MaxFrameMs;
            _frame++;
            double newest = _snaps.NewestMs;
            double ahead = Math.Min(rd - newest, LeadMs);
            bool extrapolate = ahead > 0 && _snaps.Count >= 3 && _snaps.OldestMs <= newest - 2 * Wire.TickMs;
            if (extrapolate) RefreshWalk(newest);
            float dtS = (float)(Math.Max(0, Math.Min(dt, MaxFrameMs)) / 1000.0);
            int w = 0;
            for (int i = 0; i < outActors.Count; i++)
            {
                var a = outActors[i];
                if (a.Kind != ActorKind.Player) continue;
                float tx = a.X, ty = a.Y;
                bool moving = false;
                if (extrapolate && a.Status == ActorStatus.Alive && FindWalk(a.Id, ref w, out Walk k))
                {
                    double ms = ahead;
                    float speed = (float)Math.Sqrt(k.Vx * k.Vx + k.Vy * k.Vy);
                    if (speed > 0) ms = Math.Min(ms, MaxLeadDistance / speed * 1000.0);
                    // The sample at rd is already the held newest pose, so the extrapolated target starts from it.
                    tx += (float)(k.Vx * ms / 1000.0); ty += (float)(k.Vy * ms / 1000.0);
                    moving = true;
                }
                if (!_state.TryGetValue(a.Id, out State s)) { s = new State { X = tx, Y = ty, TX = tx, TY = ty, Displace = a.DisplaceSeq, Status = a.Status }; _state.Add(a.Id, s); }
                else
                {
                    float ex = tx - s.X, ey = ty - s.Y;
                    float dist = (float)Math.Sqrt(ex * ex + ey * ey);
                    bool snap = cut || dist > SnapDistance || s.Displace != a.DisplaceSeq || s.Status != a.Status;
                    if (snap) { s.X = tx; s.Y = ty; }
                    else
                    {
                        float cap = (moving || Math.Abs(tx - s.TX) + Math.Abs(ty - s.TY) > 0.01f ? MovingCorrectSpeed : RestCorrectSpeed) * dtS;
                        if (dist <= cap) { s.X = tx; s.Y = ty; }
                        else { s.X += ex / dist * cap; s.Y += ey / dist * cap; }
                    }
                    s.Displace = a.DisplaceSeq; s.Status = a.Status;
                }
                s.TX = tx; s.TY = ty; s.Frame = _frame;
                a.X = s.X; a.Y = s.Y;
                outActors[i] = a;
            }
            _stale.Clear();
            foreach (var kv in _state) if (kv.Value.Frame != _frame) _stale.Add(kv.Key);
            for (int i = 0; i < _stale.Count; i++) _state.Remove(_stale[i]);
            return true;
        }

        // Last-segment velocity per player, recomputed only when a new snapshot arrived. The three samples are the newest pose and
        // the poses one and two ticks earlier; a displaced actor is held at its new pose by Sample, so its step is zero (no lead).
        void RefreshWalk(double newest)
        {
            if (newest == _walkFor) return;
            _walkFor = newest;
            _walk.Clear();
            _snaps.Sample(newest, _n0);
            // A hair before the tick so the pose and its status come from the earlier snapshot of the pair, not the newest.
            _snaps.Sample(newest - Wire.TickMs - 0.001, _n1);
            _snaps.Sample(newest - 2 * Wire.TickMs - 0.001, _n2);
            double inv = 1000.0 / Wire.TickMs;
            int j = 0, k = 0;
            for (int i = 0; i < _n0.Count; i++)
            {
                var c = _n0[i];
                var wk = new Walk { Id = c.Id };
                if (c.Kind == ActorKind.Player && Find(_n1, c.Id, ref j, out InterpActor b) && Find(_n2, c.Id, ref k, out InterpActor a))
                {
                    float v1x = c.X - b.X, v1y = c.Y - b.Y, v0x = b.X - a.X, v0y = b.Y - a.Y;
                    float s1 = (float)Math.Sqrt(v1x * v1x + v1y * v1y), s0 = (float)Math.Sqrt(v0x * v0x + v0y * v0y);
                    bool steady = s1 >= StopStep && (s0 < StopStep || (v1x * v0x + v1y * v0y) / (s1 * s0) >= TurnCos);
                    bool calm = c.Effects == 0 && c.HpPct >= b.HpPct && c.Status == ActorStatus.Alive && b.Status == ActorStatus.Alive
                        && c.DisplaceSeq == b.DisplaceSeq && s1 <= SnapshotBuffer.TeleportDistance;
                    if (steady && calm) { wk.Ok = true; wk.Vx = (float)(v1x * inv); wk.Vy = (float)(v1y * inv); }
                }
                _walk.Add(wk);
            }
        }

        static bool Find(List<InterpActor> l, uint id, ref int hint, out InterpActor found)
        {
            // Lists are id-ascending, so the hint only moves forward; a hand-made unsorted list falls back to a scan.
            while (hint < l.Count && l[hint].Id < id) hint++;
            if (hint < l.Count && l[hint].Id == id) { found = l[hint]; return true; }
            for (int i = 0; i < l.Count; i++) if (l[i].Id == id) { found = l[i]; return true; }
            found = default(InterpActor); return false;
        }

        bool FindWalk(uint id, ref int hint, out Walk found)
        {
            while (hint < _walk.Count && _walk[hint].Id < id) hint++;
            if (hint < _walk.Count && _walk[hint].Id == id) { found = _walk[hint]; return found.Ok; }
            for (int i = 0; i < _walk.Count; i++) if (_walk[i].Id == id) { found = _walk[i]; return found.Ok; }
            found = default(Walk); return false;
        }
    }
}
