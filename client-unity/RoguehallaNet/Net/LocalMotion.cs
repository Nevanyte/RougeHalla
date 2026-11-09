using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// Presentation-only prediction of the local player's walk (P-NET-1 Phase 2; ADR 0008's one narrow prediction exception).
    /// <para>
    /// An order plans the same A* path the server will plan (the Phase 1 <see cref="Pathfinder"/>, built from the client's decoded
    /// <see cref="MapBlob"/>) and <see cref="Step"/> walks that path at the server's <c>PLAYER_SPEED</c> times the owner's published
    /// move-speed mirror (<c>speed_milli / 1000</c>, rh-sim's <c>buffs.moveSpeedMult</c>, floored like rh-sim). The walk is presented
    /// as <c>drawn = sim + visual</c>: <see cref="SimX"/>/<see cref="SimY"/> are the last accepted authoritative self position (updated
    /// on every snapshot, even while an order is pending), and <see cref="VisualX"/>/<see cref="VisualY"/> are the offset from the
    /// model plus the smoothing correction. Nothing here is ever sent: <see cref="Session"/> queues orders, this type only presents
    /// them; it has no reference to <see cref="InputSender"/> and never increases the order rate.
    /// </para>
    /// <para>
    /// Reconciliation is delay-aligned (the legacy client's rebase): a sample is compared with where the model was when the server
    /// was at that point of the walk, not with where it is now. The first sample that echoes a timing order (a start, a stop or a
    /// turn of more than 12 degrees; a same-direction repeat of a held key is not one) measures that order's delay
    /// <c>D = sample time - TICK_MS - order time</c>, and every sample at source time T is then compared with the model's pose at
    /// T - D. Sample times follow the source clock's spacing, anchored to the earliest arrival, so arrival jitter is not error.
    /// A model or composed visual error above 96 u snaps the model to the server; a smaller one shifts the model (and its pose
    /// history) by the error and the visual offset the other way, and the offset decays with a 100 ms time constant but never
    /// faster than 70 to 120 u/s while walking (a correction can slow or hurry the walk, never turn it round) or 255 u/s at rest.
    /// While the pose at T - D already follows an order the server has not applied, the sample is only a bound: it snaps when the
    /// error exceeds 96 u plus the walk since that order. Comparison does not wait for <see cref="OrderPending"/> to clear, so a held
    /// key whose repeats outrun the echo is still reconciled.
    /// </para>
    /// <para>
    /// <see cref="OrderPending"/> clears only when the self block's <c>move_seq</c> echoes the newest order's sequence (sequences
    /// are 1..255; 0 means "no order yet"). An order the server has not echoed within one second is forgotten (the pending gate
    /// clears; the predicted walk itself continues along its path and the samples keep reconciling it).
    /// </para>
    /// <para>
    /// Authoritative displacement, death and revival immediately discard the predicted path, even with an order pending.
    /// Only the local walk is predicted. Attacks, HP, deaths, other actors and mobs are never predicted; hidden speed modifiers
    /// (windup, roots, slows, terrain) are deliberately not guessed, so a server correction owns them (see <see cref="SpeedModifier"/>).
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

        /// <summary>The measured order delay is clamped to this range, in milliseconds (legacy <c>DELAY_MIN_MS</c>/<c>DELAY_MAX_MS</c>).</summary>
        public const double DelayMinMs = -TickMs;
        public const double DelayMaxMs = 400.0;
        /// <summary>While walking, the correction offset runs down at most this fast: 70 u/s, plus 2 per unit past 20, at most 120.</summary>
        public const double CorrectSpeedMoving = 70.0;
        public const double CorrectSpeedMovingMax = 120.0;
        /// <summary>At rest the offset runs down at most this fast (legacy <c>CORRECT_SPEED_REST_MAX</c>, 1.5 x PLAYER_SPEED).</summary>
        public const double CorrectSpeedRestMax = 1.5 * PlayerSpeed;
        /// <summary>rh-sim <c>MOVE_MULT_FLOOR</c>: a walk multiplier above 0 is never below this.</summary>
        public const double MoveMultFloor = 0.35;

        /// <summary>A stalled frame walks at most this much (legacy <c>MAX_FRAME_MS</c>); it can never tunnel through a wall.</summary>
        const double MaxStepMs = 100.0;
        /// <summary>A new order whose first leg is within 12 degrees of the current one does not change WHEN the fighter moves.</summary>
        static readonly double SameDirectionCos = Math.Cos(12.0 * Math.PI / 180.0);
        /// <summary>Model poses kept for delay alignment (a frame each while walking; covers DelayMaxMs plus a sample at 120+ Hz).</summary>
        const int HistorySize = 256;
        /// <summary>Unapplied orders kept for delay alignment; more than one second of a 100 ms key repeat.</summary>
        const int OrderRingSize = 32;
        const double ZeroSegmentSq = 1e-18;

        static readonly PathPoint[] NoPath = new PathPoint[0];

        MapBlob _map;
        bool _predictionSuspended;
        bool _alive;
        byte _displaceSeq;
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
        // One fixed byte-domain set for casts issued AFTER the current movement. A new move/stop resets the set;
        // an older cast must never acknowledge a newer walk, even across the 255 -> 1 sequence wrap.
        readonly WireCommand[] _nonMovementAcks = new WireCommand[256];
        readonly bool[] _sentNonMovementAcks = new bool[256];
        readonly uint[] _nonMovementFrames = new uint[256];
        byte _observedSeq;
        WireCommand _movementOrder;
        bool _movementSent;
        uint _movementFrame;
        double _orderAtMs;
        double _goalX, _goalY;
        bool _goalHeld;
        PathPoint[] _path = NoPath;
        int _pathIndex;
        double _walkFromX, _walkFromY;
        // The owner's published move-speed mirror (speed_milli / 1000, floored), 1.0 without an owner block.
        double _speedMult = 1.0;

        // Model pose history (local ms, x, y), oldest first in a fixed ring: where the model was, for delay alignment.
        readonly double[] _histT = new double[HistorySize], _histX = new double[HistorySize], _histY = new double[HistorySize];
        int _histStart, _histCount;
        // Orders the server has not applied yet, in issue order (fixed ring), and whether each changes when the fighter moves.
        readonly byte[] _ordSeq = new byte[OrderRingSize];
        readonly double[] _ordAt = new double[OrderRingSize];
        readonly bool[] _ordTiming = new bool[OrderRingSize];
        int _ordStart, _ordCount;
        // The measured delay of the last timing order: a sample at time T is compared with the model at T - _align.
        double _align;
        // Sample time base: the source clock's spacing, anchored to the earliest local arrival.
        bool _hasStamp;
        double _stampMs, _stampServerMs;
        const double MaxStampLagMs = 150;

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
        public LocalMotion(MapBlob map) { _map = map; _predictionSuspended = map == null; }

        /// <summary>
        /// Stops prediction when the server changes collision geometry that this client cannot represent (for example locked
        /// gates without public gate geometry). Authoritative snapshots keep displaying immediately. The session adapter must
        /// call this before another predicted frame when that condition becomes known.
        /// </summary>
        public void SuspendPrediction()
        {
            _predictionSuspended = true;
            _pending = false;
            ClearNonMovementAcks();
            _goalHeld = false;
            ClearPath();
            _modelX = _simX;
            _modelY = _simY;
            _corrX = _corrY = 0;
            ConsecutiveOutOfToleranceSamples = 0;
            _histCount = 0;
            _ordCount = 0;
        }

        /// <summary>
        /// Supplies the actual current public collision map and resumes prediction. Call after replacing or mutating map
        /// tiles; supplying the same object explicitly invalidates its navigation cache. It never reconstructs gate geometry.
        /// </summary>
        public void SetCollisionMap(MapBlob map)
        {
            SuspendPrediction();
            _map = map;
            _pathfinder.InvalidateMap();
            _predictionSuspended = map == null;
        }

        /// <summary>
        /// Records a move order and starts predicting the walk from the local model position (which is the accepted authoritative
        /// position whenever the walk is settled, so the plan root is where the server will apply the order). <paramref name="seq"/>
        /// 0 means the input was dropped and is ignored.
        /// </summary>
        public void Order(float x, float y, byte seq, double nowMs) { Order(x, y, seq, nowMs, null); }

        internal void Order(float x, float y, byte seq, double nowMs, WireCommand order)
        {
            if (seq == 0 || _predictionSuspended || Initialized && !_alive) return;
            ExpireOrders(nowMs);
            ClearNonMovementAcks();
            _movementOrder = order;
            _movementSent = false;
            _lastSeq = seq;
            _pending = true;
            _orderAtMs = nowMs;
            _goalX = x;
            _goalY = y;
            _goalHeld = true;
            MarkStepClock(nowMs);
            bool timing = true;
            if (Initialized)
            {
                // Same-direction re-sends (a held key) keep the walk's timing: only a start, a stop or a turn re-measures it.
                bool walking = _pathIndex < _path.Length;
                double ox = walking ? _path[_pathIndex].X - _modelX : 0, oy = walking ? _path[_pathIndex].Y - _modelY : 0;
                PlanFrom(_modelX, _modelY);
                if (walking && _path.Length > 0)
                {
                    double nx = _path[0].X - _modelX, ny = _path[0].Y - _modelY;
                    double norm = Math.Sqrt(ox * ox + oy * oy) * Math.Sqrt(nx * nx + ny * ny);
                    timing = !(norm > ZeroSegmentSq) || (ox * nx + oy * ny) / norm < SameDirectionCos;
                }
                RecordPose();
            }
            else ClearPath();
            NoteOrder(seq, nowMs, timing);
        }

        /// <summary>Records a stop order: the predicted walk ends now and waits for the stop's echo. Sequence 0 is ignored.</summary>
        public void StopOrder(byte seq, double nowMs) { StopOrder(seq, nowMs, null); }

        internal void StopOrder(byte seq, double nowMs, WireCommand order)
        {
            if (seq == 0 || _predictionSuspended || Initialized && !_alive) return;
            ExpireOrders(nowMs);
            ClearNonMovementAcks();
            _movementOrder = order;
            _movementSent = false;
            _lastSeq = seq;
            _pending = true;
            _orderAtMs = nowMs;
            _goalHeld = false;
            ClearPath();
            MarkStepClock(nowMs);
            if (Initialized) RecordPose();
            NoteOrder(seq, nowMs, true);
        }

        /// <summary>
        /// Remembers a nonmovement order after the outstanding move/stop. Cast echoes do not change the walk's goal,
        /// path, pending age or step clock. Membership, rather than numeric byte ordering, handles wrap and coalescing.
        /// </summary>
        internal void NoteNonMovementOrder(WireCommand command, double nowMs)
        {
            ExpireOrders(nowMs);
            byte seq = command.Seq.GetValueOrDefault();
            // A reused byte equal to the currently held echo cannot prove a new cast was applied. In that ambiguous
            // case keep waiting for the movement echo/normal expiry instead of guessing from a repeated snapshot.
            if (_pending && seq != 0 && seq != _observedSeq)
            {
                _nonMovementAcks[seq] = command;
                _sentNonMovementAcks[seq] = false;
            }
        }

        internal void NonMovementOrderSent(WireCommand command, uint frame)
        {
            byte seq = command.Seq.GetValueOrDefault();
            if (!ReferenceEquals(_nonMovementAcks[seq], command)) return;
            _sentNonMovementAcks[seq] = true;
            _nonMovementFrames[seq] = frame;
        }

        internal void MovementOrderSent(WireCommand command, uint frame)
        {
            if (!ReferenceEquals(_movementOrder, command)) return;
            _movementSent = true;
            _movementFrame = frame;
        }

        void ClearNonMovementAcks()
        {
            Array.Clear(_nonMovementAcks, 0, _nonMovementAcks.Length);
            Array.Clear(_sentNonMovementAcks, 0, _sentNonMovementAcks.Length);
            _movementOrder = null;
            _movementSent = false;
        }

        /// <summary>
        /// Rebases presentation integration at an authoritative source-clock cut. Orders and their expiry are measured
        /// on the injected local clock, so their goal/path/ack bookkeeping survives without a resend or a fresh lifetime.
        /// </summary>
        internal void RebasePresentationClock(double nowMs)
        {
            _lastStepMs = nowMs;
            _stepClock = true;
            _hasStamp = false; // the source clock was cut: the next sample re-anchors the sample time base
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
            if (Initialized && _alive && !_predictionSuspended && _pathIndex < _path.Length)
            {
                Walk(Math.Min(dt, MaxStepMs) / 1000.0, nowMs); // a stall must not walk the model through a wall
                RecordPose();
            }
            Decay(dt); // the correction fades with the real elapsed time, not the capped walk time
        }

        /// <summary>
        /// Applies an accepted authoritative self sample. <see cref="SimX"/>/<see cref="SimY"/> always move to it (so the server's
        /// position stays visible while an order is pending) and the sample is reconciled against the model's pose one order delay
        /// earlier (see the type). The echo is checked before the one-second expiry, so a sample at the boundary acknowledges the
        /// order instead of counting it as forgotten. <paramref name="serverMs"/> is the sample's source time (its spacing times
        /// the samples; without it the arrival time is used) and <paramref name="speedMilli"/> the owner block's
        /// <c>speed_milli</c> (null: no owner block, base speed).
        /// </summary>
        public void OnSnapshot(WireSelf me, double nowMs, uint? ackInput = null, double? serverMs = null, double? speedMilli = null)
        {
            if (me == null) { Clear(); return; }
            double stamp = SampleStamp(nowMs, serverMs);
            NoteEcho(me.MoveSeq, stamp);
            bool alive = me.Status == 1;
            bool hardCut = Initialized && (me.DisplaceSeq != _displaceSeq || !alive || !_alive);
            // Echo before advancing the clock: an acknowledgement at the expiry boundary is not a lost order.
            bool castAck = ackInput.HasValue && _nonMovementAcks[me.MoveSeq] != null && _sentNonMovementAcks[me.MoveSeq] &&
                unchecked((int)(ackInput.Value - _nonMovementFrames[me.MoveSeq])) >= 0;
            bool moveAck = me.MoveSeq == _lastSeq && (!ackInput.HasValue ||
                _movementSent && unchecked((int)(ackInput.Value - _movementFrame)) >= 0);
            if (_pending && (moveAck || castAck))
            {
                _pending = false;
                ClearNonMovementAcks();
                _ordCount = 0; // the newest order is handled, so every earlier one is too
            }
            if (!Initialized && _pending) ExpireOrders(nowMs);
            // Real Session.Poll delivers snapshots before its frame Step. Spend elapsed walk time against the old model
            // first; the frame's later Step(same now) then spends zero. Direct callers that already stepped also spend zero.
            if (Initialized && !hardCut && !_predictionSuspended) Step(nowMs);
            // The walk already spent used the speed known until now; this sample's mirror drives the walk from here on.
            _speedMult = WalkMultiplier(speedMilli);
            bool first = !Initialized;
            _simX = me.X;
            _simY = me.Y;
            _alive = alive;
            _displaceSeq = me.DisplaceSeq;
            _observedSeq = me.MoveSeq;
            if (first || hardCut || _predictionSuspended)
            {
                Initialized = true;
                _modelX = _simX;
                _modelY = _simY;
                _corrX = _corrY = 0;
                ConsecutiveOutOfToleranceSamples = 0;
                MarkStepClock(nowMs);
                _histCount = 0;
                if (hardCut || !alive || _predictionSuspended)
                {
                    _pending = false;
                    ClearNonMovementAcks();
                    _ordCount = 0;
                    _goalHeld = false;
                    ClearPath();
                }
                else if (_pending && _goalHeld) PlanFrom(_simX, _simY);
                return;
            }
            Reconcile(stamp, nowMs);
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
            _alive = false;
            _displaceSeq = 0;
            _pending = false;
            ClearNonMovementAcks();
            _lastSeq = 0;
            _observedSeq = 0;
            _movementOrder = null;
            _movementSent = false;
            _orderAtMs = 0;
            _goalX = _goalY = 0;
            _goalHeld = false;
            ClearPath();
            _speedMult = 1.0;
            _histCount = 0;
            _ordCount = 0;
            _align = 0;
            _hasStamp = false;
            Snaps = 0;
            ExpiredOrders = 0;
            ConsecutiveOutOfToleranceSamples = 0;
        }

        /// <summary>
        /// The walk-speed multiplier for what the client cannot see (1.0), applied on top of the published owner move-speed mirror
        /// (<c>speed_milli / 1000</c>): hidden weapon windup, roots, slows and terrain are not guessed, because guessing them
        /// would show a walk the server is not doing (ADR 0008). The server corrects the difference. P-NET-2 may extend the body;
        /// callers should go through <see cref="Step"/>.
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
            double budget = PlayerSpeed * _speedMult * SpeedModifier(nowMs) * seconds;
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
            double mag = Math.Sqrt(_corrX * _corrX + _corrY * _corrY);
            if (mag > 0)
            {
                // Exponential, but never faster than the correction speed cap (legacy decay): a walking fighter is slowed or
                // hurried by a correction, never turned round.
                double cap = Initialized && _alive && !_predictionSuspended && _pathIndex < _path.Length
                    ? Math.Min(CorrectSpeedMovingMax, CorrectSpeedMoving + 2.0 * Math.Max(0.0, mag - 20.0))
                    : CorrectSpeedRestMax;
                double dec = Math.Min(mag * (1.0 - Math.Exp(-dtMs / VisualTauMs)), cap * dtMs / 1000.0);
                double k = (mag - dec) / mag;
                _corrX *= k;
                _corrY *= k;
            }
            if (Math.Abs(_corrX) < 1e-9) _corrX = 0;
            if (Math.Abs(_corrY) < 1e-9) _corrY = 0;
        }

        static double WalkMultiplier(double? speedMilli)
        {
            // rh-sim decodes a missing or nonfinite mirror as 1.0 and floors a positive tick multiplier at MOVE_MULT_FLOOR.
            if (!speedMilli.HasValue || double.IsNaN(speedMilli.Value) || double.IsInfinity(speedMilli.Value) || speedMilli.Value < 0)
                return 1.0;
            double m = speedMilli.Value / 1000.0;
            return m > 0 && m < MoveMultFloor ? MoveMultFloor : m;
        }

        // ----------------------------------------------------------------------------------------------------------------
        // Delay alignment

        /// <summary>
        /// The local time a sample stands for: the previous sample's time plus the source clock's advance, never later than its
        /// arrival. Arrival jitter therefore does not read as walk error; without a source time (or after a cut) it is the arrival.
        /// </summary>
        double SampleStamp(double nowMs, double? serverMs)
        {
            double stamp = nowMs;
            bool usable = serverMs.HasValue && !double.IsNaN(serverMs.Value) && !double.IsInfinity(serverMs.Value);
            // A replacement snapshot of the same tick stands for the same instant: keep the anchor.
            if (usable && _hasStamp && serverMs.Value == _stampServerMs) return _stampMs;
            if (usable && _hasStamp && serverMs.Value > _stampServerMs)
            {
                double projected = _stampMs + (serverMs.Value - _stampServerMs);
                // The anchor only ever moves earlier, so a server that fell behind wall time (dropped steps) would leave
                // every later stamp early. Bound how far a stamp may trail its arrival; past that, re-anchor.
                if (projected < nowMs && nowMs - projected <= MaxStampLagMs) stamp = projected;
            }
            _hasStamp = usable;
            _stampMs = stamp;
            _stampServerMs = usable ? serverMs.Value : 0;
            return stamp;
        }

        void NoteOrder(byte seq, double nowMs, bool timing)
        {
            if (_ordCount == OrderRingSize) { _ordStart = (_ordStart + 1) % OrderRingSize; _ordCount--; }
            int i = (_ordStart + _ordCount) % OrderRingSize;
            _ordSeq[i] = seq;
            _ordAt[i] = nowMs;
            _ordTiming[i] = timing;
            _ordCount++;
        }

        /// <summary>
        /// An echo of order <paramref name="seq"/> covers it and every earlier order (the server applies them in order). The first
        /// echo of a timing order measures the delay samples are aligned with.
        /// </summary>
        void NoteEcho(byte seq, double stamp)
        {
            if (seq == 0) return;
            for (int n = _ordCount - 1; n >= 0; n--)
            {
                int i = (_ordStart + n) % OrderRingSize;
                if (_ordSeq[i] != seq) continue;
                if (_ordTiming[i])
                    _align = Math.Max(DelayMinMs, Math.Min(DelayMaxMs, stamp - TickMs - _ordAt[i]));
                _ordStart = (i + 1) % OrderRingSize;
                _ordCount -= n + 1;
                return;
            }
        }

        void RecordPose()
        {
            int i;
            if (_histCount == HistorySize) { i = _histStart; _histStart = (_histStart + 1) % HistorySize; }
            else i = (_histStart + _histCount++) % HistorySize;
            _histT[i] = _lastStepMs;
            _histX[i] = _modelX;
            _histY[i] = _modelY;
        }

        /// <summary>Where the model was at local time <paramref name="t"/>: from the pose history, or carried on along the path.</summary>
        void ModelAt(double t, out double x, out double y)
        {
            x = _modelX;
            y = _modelY;
            if (t >= _lastStepMs)
            {
                // A negative delay (a click just before a tick on a fast link) asks slightly ahead of the model.
                if (_alive && !_predictionSuspended) WalkAhead(Math.Min(t - _lastStepMs, MaxStepMs) / 1000.0, ref x, ref y);
                return;
            }
            double bt = _lastStepMs, bx = _modelX, by = _modelY;
            for (int n = _histCount - 1; n >= 0; n--)
            {
                int i = (_histStart + n) % HistorySize;
                if (_histT[i] <= t)
                {
                    double k = bt > _histT[i] ? (t - _histT[i]) / (bt - _histT[i]) : 1.0;
                    x = _histX[i] + (bx - _histX[i]) * k;
                    y = _histY[i] + (by - _histY[i]) * k;
                    return;
                }
                bt = _histT[i]; bx = _histX[i]; by = _histY[i];
            }
            x = bx; // older than the history: its oldest pose
            y = by;
        }

        /// <summary>The <see cref="Walk"/> arithmetic on copies: how far the path carries the model in <paramref name="seconds"/>.</summary>
        void WalkAhead(double seconds, ref double x, ref double y)
        {
            double budget = PlayerSpeed * _speedMult * SpeedModifier(_lastStepMs) * seconds;
            for (int i = _pathIndex; budget > 0.0 && i < _path.Length; i++)
            {
                double dx = _path[i].X - x, dy = _path[i].Y - y;
                double dist = Math.Sqrt(dx * dx + dy * dy);
                if (dist <= budget) { x = _path[i].X; y = _path[i].Y; budget -= dist; }
                else { x += dx / dist * budget; y += dy / dist * budget; budget = 0.0; }
            }
        }

        void ShiftHistory(double dx, double dy)
        {
            for (int n = 0; n < _histCount; n++)
            {
                int i = (_histStart + n) % HistorySize;
                _histX[i] += dx;
                _histY[i] += dy;
            }
        }

        void ExpireUnappliedOrders(double nowMs)
        {
            while (_ordCount > 0 && nowMs - _ordAt[_ordStart] >= OrderExpireMs)
            {
                _ordStart = (_ordStart + 1) % OrderRingSize;
                _ordCount--;
            }
        }

        // ----------------------------------------------------------------------------------------------------------------
        // Reconciliation

        void Reconcile(double stamp, double nowMs)
        {
            ExpireUnappliedOrders(nowMs);
            double at = stamp - _align;
            double refX, refY;
            ModelAt(at, out refX, out refY);
            // ex/ey: how far the model was from the server at the aligned time (model - server).
            double ex = refX - _simX;
            double ey = refY - _simY;
            double err = Math.Sqrt(ex * ex + ey * ey);
            if (_ordCount > 0 && at >= _ordAt[_ordStart])
            {
                // The model at `at` already follows an order the server has not applied: the sample only bounds the lead.
                double lead = PlayerSpeed * _speedMult * SpeedModifier(nowMs) * (at - _ordAt[_ordStart]) / 1000.0;
                if (err > SnapDistance + lead) SnapToSim();
                return;
            }
            double drawEx = ex + _corrX;
            double drawEy = ey + _corrY;
            // Multiple accepted samples can arrive in one Poll with no intervening decay. Bound the composed correction,
            // not just each sample's model error, so smoothing cannot conceal an arbitrarily large divergence.
            if (err > SnapDistance || Math.Sqrt(drawEx * drawEx + drawEy * drawEy) > SnapDistance)
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
            // Move the model (and the poses it is compared from) by the aligned error and keep the drawn position where it was
            // by moving the offset the other way; the offset then fades (the sample is not a teleport, so it is not shown as one).
            _modelX -= ex;
            _modelY -= ey;
            ShiftHistory(-ex, -ey);
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
            _histCount = 0;
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
            ClearNonMovementAcks();
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
