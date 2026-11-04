using System;

namespace Roguehalla.Net
{
    /// <summary>
    /// Maps the local clock to the server time that remote actors are drawn at ("render time"), a delay behind the newest data.
    /// The delay follows snapshot arrival jitter between 70 and 150 ms. Render time never runs backwards: when more delay is
    /// needed it slows to 80% speed; when less, it catches up at 1%; it only jumps forward (after a 250 ms gap).
    /// </summary>
    public sealed class RenderClock
    {
        public const double MinDelayMs = 70, MaxDelayMs = 150, StartDelayMs = 100, SnapMs = 250;
        const int Window = 80; // about 4 s of snapshots at 20 Hz
        const double SlowShare = 0.2, CatchUpShare = 0.01;

        readonly double[] _d = new double[Window];
        readonly double[] _sorted = new double[Window];
        int _n, _head;
        double _minD, _targetDelay = StartDelayMs, _lastLocal, _render;
        bool _init;

        /// <summary>Server tick interval; the delay must cover one interval plus the arrival jitter to have a complete segment to draw.</summary>
        public double TickMs = 50;

        public bool Ready { get { return _init; } }
        public double TargetDelayMs { get { return _targetDelay; } }
        /// <summary>The delay actually in force right now (lags TargetDelayMs while it slews).</summary>
        public double DelayMs { get { return _init ? (_lastLocal - _minD) - _render : StartDelayMs; } }
        public double RenderMs { get { return _render; } }

        public void Reset() { _n = 0; _head = 0; _init = false; _targetDelay = StartDelayMs; }

        public void OnSnapshot(double localMs, double serverMs)
        {
            _d[_head] = localMs - serverMs;
            _head = (_head + 1) % Window;
            if (_n < Window) _n++;
            Array.Copy(_d, _sorted, _n);
            Array.Sort(_sorted, 0, _n);
            _minD = _sorted[0];
            // 98th percentile of how much later than the fastest arrival a snapshot came.
            double excess = _sorted[Math.Min(_n - 1, (int)Math.Ceiling(_n * 0.98) - 1)] - _minD;
            _targetDelay = Math.Min(MaxDelayMs, Math.Max(MinDelayMs, TickMs + excess));
            if (!_init)
            {
                _init = true;
                _lastLocal = localMs;
                _render = serverMs - StartDelayMs;
            }
        }

        /// <summary>Advances render time to local time <paramref name="localMs"/> (call once per frame) and returns it in server ms.</summary>
        public double Update(double localMs)
        {
            if (!_init) return 0;
            double dt = Math.Max(0, localMs - _lastLocal);
            _lastLocal = localMs;
            double wanted = localMs - _minD - _targetDelay;
            double diff = wanted - (_render + dt);
            double adv;
            if (diff < 0) adv = dt + Math.Max(diff, -SlowShare * dt);
            else if (diff >= SnapMs) adv = dt + diff;
            else adv = dt + Math.Min(diff, CatchUpShare * dt);
            _render += adv;
            return _render;
        }
    }
}
