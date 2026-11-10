using System;
using System.Collections.Generic;

namespace Roguehalla.Net
{
    /// <summary>
    /// Measures input-to-motion delay for the dev flag <c>?inputlat=1</c>: from a movement key-down to the first frame the local
    /// (predicted) position changes and to the first change of the server-confirmed position. Pure; the caller supplies times in
    /// milliseconds on one clock and the positions. Diagnostic only; it never affects play.
    /// </summary>
    public sealed class InputLatencyTracker
    {
        public const double MoveEpsilon = 0.01, TimeoutMs = 2000;
        readonly List<double> _local = new List<double>(), _server = new List<double>();
        bool _active, _haveLocal, _haveServer;
        double _keyMs, _frameMs, _localMs, _serverMs, _lx, _ly, _sx, _sy;
        int _count;

        public int Samples { get { return _count; } }

        /// <summary>A movement key went down while no movement key was held. <paramref name="keyMs"/> is the input event time.</summary>
        public void KeyDown(double keyMs, double frameMs, double localX, double localY, double serverX, double serverY)
        {
            _active = true; _haveLocal = _haveServer = false;
            _keyMs = keyMs; _frameMs = frameMs; _lx = localX; _ly = localY; _sx = serverX; _sy = serverY;
        }

        /// <summary>Call once per frame. Returns a log line when the sample completes or times out, else null.</summary>
        public string Update(double nowMs, double localX, double localY, double serverX, double serverY)
        {
            if (!_active) return null;
            if (!_haveLocal && Moved(localX - _lx, localY - _ly)) { _haveLocal = true; _localMs = nowMs; }
            if (!_haveServer && Moved(serverX - _sx, serverY - _sy)) { _haveServer = true; _serverMs = nowMs; }
            bool timeout = nowMs - _keyMs > TimeoutMs;
            if (!(_haveLocal && _haveServer) && !timeout) return null;
            _active = false; _count++;
            if (_haveLocal) _local.Add(_localMs - _keyMs);
            if (_haveServer) _server.Add(_serverMs - _keyMs);
            return "[inputlat] #" + _count + " key->frame " + F(_frameMs - _keyMs) + " ms, key->local " + (_haveLocal ? F(_localMs - _keyMs) : "none") +
                   " ms, key->server " + (_haveServer ? F(_serverMs - _keyMs) : "none") + " ms";
        }

        /// <summary>Median and 95th percentile of the completed samples.</summary>
        public string Summary()
        {
            return "[inputlat] n=" + _count + " local p50 " + F(Percentile(_local, .5)) + " p95 " + F(Percentile(_local, .95)) +
                   " ms; server p50 " + F(Percentile(_server, .5)) + " p95 " + F(Percentile(_server, .95)) + " ms";
        }

        public static double Percentile(List<double> values, double p)
        {
            if (values.Count == 0) return double.NaN;
            var sorted = values.ToArray(); Array.Sort(sorted);
            int i = (int)Math.Ceiling(p * sorted.Length) - 1;
            return sorted[Math.Max(0, Math.Min(sorted.Length - 1, i))];
        }

        static bool Moved(double dx, double dy) { return dx * dx + dy * dy > MoveEpsilon * MoveEpsilon; }
        static string F(double v) { return double.IsNaN(v) ? "n/a" : v.ToString("F1", System.Globalization.CultureInfo.InvariantCulture); }
    }
}
