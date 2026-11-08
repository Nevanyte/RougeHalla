using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// Presentation-only prediction of the local player's walk (P-NET-1 Phase 2; ADR 0008's one narrow prediction exception).
    /// <para>
    /// An order plans the same A* path the server will plan (the Phase 1 <see cref="Pathfinder"/>, built from the client's decoded
    /// <see cref="MapBlob"/>) and <see cref="Step"/> walks that path at the server's base <c>PLAYER_SPEED</c>. The walk is presented
    /// as <c>drawn = sim + visual</c>: <see cref="SimX"/>/<see cref="SimY"/> are the last accepted authoritative self position (updated
    /// on every snapshot, even while an order is pending), and <see cref="VisualX"/>/<see cref="VisualY"/> are the offset from the
    /// model plus the smoothing correction. Nothing here is ever sent: <see cref="Session"/> queues orders, this type only presents
    /// them; it has no reference to <see cref="InputSender"/> and never increases the order rate.
    /// </para>
    /// <para>
    /// Reconciliation is skipped while an order is pending and clears only when the self block's <c>move_seq</c> echoes its
    /// sequence (sequences are 1..255; 0 means "no order yet"). With no order pending, a sample error above 96 u snaps the model to
    /// the server, and smaller errors are absorbed into the visual offset, which decays with a 100 ms time constant. An order the
    /// server has not echoed within one second is forgotten (the pending gate clears; the predicted walk itself continues along its
    /// path and the next snapshot reconciles it, snapping if it is more than 96 u from the server).
    /// </para>
    /// <para>
    /// Only the local walk is predicted. Attacks, HP, deaths, other actors and mobs are never predicted; hidden speed modifiers
    /// (windup, roots, slows) are deliberately not guessed, so a server correction owns them (see <see cref="SpeedModifier"/>).
    /// </para>
    /// <para>Single-threaded; no allocation per frame (the pathfinder reuses one scratch instance per <see cref="LocalMotion"/>; an
    /// order allocates only the waypoint array it keeps).</para>
    /// </summary>
    public sealed class LocalMotion
    {
        /// <summary>The server's base walk speed (<c>PLAYER_SPEED</c>), world units per second.</summary>
        public const double PlayerSpeed = 170.0;
        /// <summary>The server tick (<c>TICK_MS</c>): its walk is planned and sampled on this grid.</summary>
        public const double TickMs = 50.0;
        /// <summary>An error up to this many world units is absorbed smoothly; beyond it the presented walk snaps to the server.</summary>
        public const double SnapDistance = 96.0;
        /// <summary>The correction offset's exponential time constant, in milliseconds (<c>VISUAL_TAU_MS</c>).</summary>
        public const double VisualTauMs = 100.0;
        /// <summary>An order the server has not echoed within this long is forgotten (<c>ORDER_EXPIRE_MS</c>).</summary>
        public const double OrderExpireMs = 1000.0;
        /// <summary>A sample this far from the model is a divergence for the consecutive-sample counter (legacy <c>DIVERGE_ERR</c>).</summary>
        public const double DivergeErr = 6.0;

        /// <summary>A stalled frame walks at most this much (legacy <c>MAX_FRAME_MS</c>); it can never tunnel through a wall.</summary>
        const double MaxStepMs = 100.0;
        const double ZeroSegmentSq = 1e-18;

        static readonly PathPoint[] NoPath = new PathPoint[0];

        readonly MapBlob _map;
        readonly Pathfinder _pathfinder = new Pathfinder();

        // Authoritative self, as last accepted (wire floats, widened for path and smoothing arithmetic).
        double _simX, _simY;
        // Predicted walk model (the server's position along the same path, carried forward by Step).
        double _modelX, _modelY;
        // Smoothing correction kept out of the model: drawn = model + correction (and therefore sim + visual).
        double _corrX, _corrY;
        double _lastStepMs;
        bool _stepClock;

        // The outstanding order and the walk it started.
        bool _pending;
        byte _lastSeq;
        double _orderAtMs;
        double _goalX, _goalY;
        bool _goalHeld;
        PathPoint[] _path = NoPath;
        int _pathIndex;
        double _walkFromX, _walkFromY;

        public bool Initialized { get; private set; }

        /// <summary>The last accepted authoritative self position (the server's x; updated on every snapshot).</summary>
        public float SimX { get { return (float)_simX; } }
        public float SimY { get { return (float)_simY; } }

        /// <summary>The correction offset from the authoritative position: <c>drawn - sim</c>. Zero when nothing is being corrected.</summary>
        public float VisualX { get { return (float)((_modelX + _corrX) - _simX); } }
        public float VisualY { get { return (float)((_modelY + _corrY) - _simY); } }

        /// <summary>The presented position: <c>sim + visual</c>, i.e. the predicted walk plus the decaying correction.</summary>
        public float DrawnX { get { return SimX + VisualX; } }
        public float DrawnY { get { return SimY + VisualY; } }

        /// <summary>True from an order until the server's <c>move_seq</c> echo (or the one-second expiry) clears it.</summary>
        public bool OrderPending { get { return _pending; } }

        /// <summary>Reconciliations that found an error past <see cref="SnapDistance"/> and moved the model to the server.</summary>
        public int Snaps { get; private set; }
        /// <summary>Orders forgotten after <see cref="OrderExpireMs"/> without a matching echo.</summary>
        public int ExpiredOrders { get; private set; }
        /// <summary>Samples in a row more than <see cref="DivergeErr"/> from the model while reconciliation was active.</summary>
        public int ConsecutiveOutOfToleranceSamples { get; private set; }

        /// <summary>Keeps the map the server walks; the Phase 1 pathfinder builds its navigation tables once for it.</summary>
        public LocalMotion(MapBlob map) { _map = map; }

        /// <summary>
        /// Records a move order and starts predicting the walk from the local model position (which is the accepted authoritative
        /// position whenever the walk is settled, so the plan root is where the server will apply the order). <paramref name="seq"/>
        /// 0 means the input was dropped and is ignored.
        /// </summary>
        public void Order(float x, float y, byte seq, double nowMs)
        {
            if (seq == 0) return;
            ExpireOrders(nowMs);
            _lastSeq = seq;
            _pending = true;
            _orderAtMs = nowMs;
            _goalX = x;
            _goalY = y;
            _goalHeld = true;
            MarkStepClock(nowMs);
            if (Initialized) PlanFrom(_modelX, _modelY);
            else ClearPath();
        }

        /// <summary>Records a stop order: the predicted walk ends now and waits for the stop's echo. Sequence 0 is ignored.</summary>
        public void StopOrder(byte seq, double nowMs)
        {
            if (seq == 0) return;
            ExpireOrders(nowMs);
            _lastSeq = seq;
            _pending = true;
            _orderAtMs = nowMs;
            _goalHeld = false;
            ClearPath();
            MarkStepClock(nowMs);
        }

        /// <summary>
        /// Presentation tick: advance the predicted walk by the elapsed time (at <see cref="PlayerSpeed"/> times
        /// <see cref="SpeedModifier"/>) and fade the correction offset. Call once per frame with the injected monotonic clock.
        /// </summary>
        public void Step(double nowMs)
        {
            if (!_stepClock) { _lastStepMs = nowMs; _stepClock = true; }
            double dt = nowMs - _lastStepMs;
            _lastStepMs = nowMs;
            if (!(dt > 0)) dt = 0; // also guards NaN and a clock that resynced backwards
            ExpireOrders(nowMs);
            if (dt <= 0) return;
            if (Initialized && _pathIndex < _path.Length)
                Walk(Math.Min(dt, MaxStepMs) / 1000.0, nowMs); // a stall must not walk the model through a wall
            Decay(dt); // the correction fades with the real elapsed time, not the capped walk time
        }

        /// <summary>
        /// Applies an accepted authoritative self sample. <see cref="SimX"/>/<see cref="SimY"/> always move to it (so the server's
        /// position stays visible while an order is pending); reconciliation against the model is skipped until the sample's
        /// <c>move_seq</c> echoes the order's sequence. The echo is checked before the one-second expiry, so a sample at the
        /// boundary acknowledges the order instead of counting it as forgotten.
        /// </summary>
        public void OnSnapshot(WireSelf me, double nowMs)
        {
            if (me == null) { Clear(); return; }
            // An echo in this very sample acknowledges the order even at the expiry boundary: it is not forgotten.
            if (_pending && me.MoveSeq == _lastSeq) _pending = false;
            if (_pending) ExpireOrders(nowMs);
            if (!Initialized)
            {
                Initialized = true;
                _simX = me.X;
                _simY = me.Y;
                _modelX = _simX;
                _modelY = _simY;
                _corrX = 0;
                _corrY = 0;
                MarkStepClock(nowMs);
                // An order can only be planned once the first self position is known; start it from the server's position.
                if (_pending && _goalHeld && _path.Length == 0) PlanFrom(_simX, _simY);
            }
            else
            {
                _simX = me.X;
                _simY = me.Y;
            }
            if (_pending) return; // reconciliation waits for the echo
            Reconcile();
        }

        /// <summary>Clears the presented self, any pending order and the walk (a snapshot without this player, or a fresh Welcome).</summary>
        public void Clear()
        {
            Initialized = false;
            _simX = _simY = 0;
            _modelX = _modelY = 0;
            _corrX = _corrY = 0;
            _lastStepMs = 0;
            _stepClock = false;
            _pending = false;
            _lastSeq = 0;
            _orderAtMs = 0;
            _goalX = _goalY = 0;
            _goalHeld = false;
            ClearPath();
            Snaps = 0;
            ExpiredOrders = 0;
            ConsecutiveOutOfToleranceSamples = 0;
        }

        /// <summary>
        /// The walk-speed multiplier for a predicted step. This packet predicts the base walk only (1.0): hidden weapon windup,
        /// roots and slows are not guessed, because guessing them would show a walk the server is not doing (ADR 0008). The server
        /// corrects the difference. P-NET-2 may extend the body; callers should go through <see cref="Step"/>.
        /// </summary>
        public static double SpeedModifier(double nowMs) { return 1.0; }

        /// <summary>
        /// The render time to stamp on an attack or release. There is no draw-ahead in this packet, so it is the identity; the hook
        /// exists so P-NET-2 can change one body instead of every call site. <c>MatchClient.cs</c> already sends
        /// <c>Session.Clock.RenderMs</c>, which is what this returns.
        /// </summary>
        public static double AttackTime(double renderMs) { return renderMs; }

        // ----------------------------------------------------------------------------------------------------------------
        // Walk model

        void Walk(double seconds, double nowMs)
        {
            // Mirrors rh-sim systems/movement.rs advance_along_path: a budget spent waypoint by waypoint, landing exactly on a
            // waypoint when the budget covers it. All arithmetic is double, as on the server.
            double budget = PlayerSpeed * SpeedModifier(nowMs) * seconds;
            while (budget > 0.0 && _pathIndex < _path.Length)
            {
                PathPoint target = _path[_pathIndex];
                double dx = target.X - _modelX;
                double dy = target.Y - _modelY;
                double dist = Math.Sqrt(dx * dx + dy * dy);
                if (dist <= budget)
                {
                    _modelX = target.X;
                    _modelY = target.Y;
                    budget -= dist;
                    _pathIndex++;
                }
                else
                {
                    _modelX += dx / dist * budget;
                    _modelY += dy / dist * budget;
                    budget = 0.0;
                }
            }
        }

        void PlanFrom(double fromX, double fromY)
        {
            _walkFromX = fromX;
            _walkFromY = fromY;
            _path = _map == null ? NoPath : _pathfinder.FindPath(_map, fromX, fromY, _goalX, _goalY);
            _pathIndex = 0;
        }

        void ClearPath()
        {
            _path = NoPath;
            _pathIndex = 0;
        }

        void Decay(double dtMs)
        {
            double k = Math.Exp(-dtMs / VisualTauMs);
            _corrX *= k;
            _corrY *= k;
            if (Math.Abs(_corrX) < 1e-9) _corrX = 0;
            if (Math.Abs(_corrY) < 1e-9) _corrY = 0;
        }

        // ----------------------------------------------------------------------------------------------------------------
        // Reconciliation

        void Reconcile()
        {
            double ex = _modelX - _simX;
            double ey = _modelY - _simY;
            double err = Math.Sqrt(ex * ex + ey * ey);
            if (err > SnapDistance)
            {
                SnapToSim();
                return;
            }
            if (err > DivergeErr)
            {
                if (ConsecutiveOutOfToleranceSamples < int.MaxValue) ConsecutiveOutOfToleranceSamples++;
            }
            else
            {
                ConsecutiveOutOfToleranceSamples = 0;
            }
            // Move the model to the server and keep the drawn position where it was by moving the offset the same way; the
            // offset then fades with tau (the sample is not a teleport, so it is not shown as one).
            _modelX = _simX;
            _modelY = _simY;
            _corrX += ex;
            _corrY += ey;
            AdvanceConsumedWaypoints();
        }

        /// <summary>A sample past <see cref="SnapDistance"/>: show the server's position now and plan the remaining walk from it.</summary>
        void SnapToSim()
        {
            _modelX = _simX;
            _modelY = _simY;
            _corrX = 0;
            _corrY = 0;
            ConsecutiveOutOfToleranceSamples = 0;
            if (Snaps < int.MaxValue) Snaps++;
            if (_pathIndex < _path.Length) PlanFrom(_simX, _simY);
            else
            {
                // The walk was already finished (or was never planned): there is nothing left to replan.
                ClearPath();
                _goalHeld = false;
            }
        }

        /// <summary>
        /// After the model is rebased onto the server, skip waypoints the corrected position has already passed, so the next
        /// step cannot walk backwards to a waypoint behind it. Only forward progress is inferred; a correction that moves the
        /// model backwards keeps the current leg and the next step simply rejoins it.
        /// </summary>
        void AdvanceConsumedWaypoints()
        {
            while (_pathIndex < _path.Length)
            {
                PathPoint wp = _path[_pathIndex];
                double ax = _pathIndex == 0 ? _walkFromX : _path[_pathIndex - 1].X;
                double ay = _pathIndex == 0 ? _walkFromY : _path[_pathIndex - 1].Y;
                double dx = wp.X - ax;
                double dy = wp.Y - ay;
                double px = _modelX - wp.X;
                double py = _modelY - wp.Y;
                if (dx * dx + dy * dy > ZeroSegmentSq && px * dx + py * dy < 0) return;
                _pathIndex++;
            }
        }

        void ExpireOrders(double nowMs)
        {
            if (!_pending) return;
            if (nowMs - _orderAtMs < OrderExpireMs) return;
            // Forgotten: the pending gate clears so the next sample reconciles; the walk itself keeps its path (stopping it
            // here would freeze the player if the server did apply the order and only the echo was lost).
            _pending = false;
            if (ExpiredOrders < int.MaxValue) ExpiredOrders++;
        }

        void MarkStepClock(double nowMs)
        {
            if (!_stepClock || nowMs > _lastStepMs)
            {
                _lastStepMs = nowMs;
                _stepClock = true;
            }
        }
    }
}
