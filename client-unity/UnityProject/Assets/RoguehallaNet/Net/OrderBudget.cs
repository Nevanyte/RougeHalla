using System;

namespace Roguehalla.Net
{
    /// <summary>
    /// Client-side pacing for repeatable orders so they stay under the server's per-seat order budget (15 orders/s, burst 30;
    /// aim is exempt). Optional repeats (a held right-click) ask <see cref="TryTake"/>; essential orders (a press, Stop) call
    /// <see cref="Spend"/>, which always succeeds and may drive the balance negative, so repeats back off after a burst.
    /// Pure arithmetic; the server stays the authority.
    /// </summary>
    public sealed class OrderBudget
    {
        readonly double _perMs, _burst;
        double _tokens, _last;
        bool _started;

        public OrderBudget(double perSecond = 12.0, double burst = 6.0)
        {
            _perMs = perSecond / 1000.0; _burst = burst; _tokens = burst;
        }

        public double Tokens { get { return _tokens; } }

        void Refill(double nowMs)
        {
            if (!_started || nowMs < _last) { _started = true; _last = nowMs; return; }
            _tokens = Math.Min(_burst, _tokens + (nowMs - _last) * _perMs);
            _last = nowMs;
        }

        /// <summary>Takes one token if the balance allows a whole one.</summary>
        public bool TryTake(double nowMs)
        {
            Refill(nowMs);
            if (_tokens < 1.0) return false;
            _tokens -= 1.0; return true;
        }

        /// <summary>Records an order that must go out regardless.</summary>
        public void Spend(double nowMs)
        {
            Refill(nowMs);
            _tokens = Math.Max(-_burst, _tokens - 1.0);
        }
    }

    /// <summary>
    /// Resends a Stop that the server may have dropped (an over-budget order is ignored silently). Stop is idempotent, so after
    /// <see cref="RetryMs"/> without the move echo it is sent again, at most <see cref="MaxRetries"/> times.
    /// </summary>
    public struct StopRetry
    {
        public const double RetryMs = 150.0;
        public const int MaxRetries = 2;
        bool _armed;
        double _at;
        int _retries;

        public bool Armed { get { return _armed; } }
        public void Sent(double nowMs, bool fresh) { _armed = true; _at = nowMs; if (fresh) _retries = 0; }
        public void Cancel() { _armed = false; _retries = 0; }

        /// <summary>True when a Stop should be sent again now. <paramref name="echoPending"/> is the motion's OrderPending.</summary>
        public bool Due(double nowMs, bool echoPending)
        {
            if (!_armed) return false;
            if (!echoPending) { _armed = false; return false; }
            if (nowMs - _at < RetryMs) return false;
            if (_retries >= MaxRetries) { _armed = false; return false; }
            _retries++;
            return true;
        }
    }
}
