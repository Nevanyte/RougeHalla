using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>Server clock estimate from Ping/Pong: of the last N samples the one with the smallest RTT has the least queueing error.</summary>
    public sealed class ClockSync
    {
        const int N = 8;
        readonly double[] _rtt = new double[N], _off = new double[N];
        int _count, _head;
        uint _nonce;
        uint _epochNonce;
        bool _epochGuard;

        public bool HasSample { get { return _count > 0; } }
        public double LastRttMs { get; private set; }
        /// <summary>Server time minus local time, from the minimum-RTT sample.</summary>
        public double OffsetMs { get; private set; }
        public double RttMs { get; private set; }

        public ClientMsg.Ping MakePing(double nowMs) { return new ClientMsg.Ping { Nonce = ++_nonce, ClientMs = nowMs }; }

        /// <summary>Forgets offsets from an older source-clock/connection epoch, including its delayed Pongs.</summary>
        public void Reset()
        {
            _count = _head = 0;
            LastRttMs = RttMs = OffsetMs = 0;
            _epochNonce = _nonce;
            _epochGuard = true;
        }

        public void OnPong(ServerMsg.Pong p, double nowMs)
        {
            if (_epochGuard && unchecked((int)(p.Nonce - _epochNonce)) <= 0) return;
            double rtt = nowMs - p.ClientMs;
            if (rtt < 0 || double.IsNaN(rtt)) return; // a pong for a ping we did not send
            LastRttMs = rtt;
            _rtt[_head] = rtt;
            _off[_head] = p.ServerMs + rtt / 2 - nowMs;
            _head = (_head + 1) % N;
            if (_count < N) _count++;
            int best = 0;
            for (int i = 1; i < _count; i++) if (_rtt[i] < _rtt[best]) best = i;
            RttMs = _rtt[best];
            OffsetMs = _off[best];
        }

        public double ServerNowMs(double localMs) { return localMs + OffsetMs; }
    }
}
