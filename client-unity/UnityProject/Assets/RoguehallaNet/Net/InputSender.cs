using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// Collects commands and builds Input frames. Aim is rate limited (latest wins, at most 40/s); every other command leaves with
    /// the next Flush. A frame carries at most 16 commands; the frame counter increments per frame.
    /// </summary>
    public sealed class InputSender
    {
        public const double AimMinIntervalMs = 25;
        readonly List<WireCommand> _queue = new List<WireCommand>();
        WireCommand _aim;
        double _lastAimMs = double.NegativeInfinity;
        uint _frameSeq;
        byte _orderSeq;

        /// <summary>Commands dropped because a value cannot be encoded (the server would refuse the whole frame).</summary>
        public int Dropped { get; private set; }

        /// <summary>Order sequence for Move/Stop: 1..255, never 0 (0 is what Snapshot.me.move_seq holds before any order).</summary>
        byte NextOrderSeq() { _orderSeq = (byte)(_orderSeq == 255 ? 1 : _orderSeq + 1); return _orderSeq; }

        static bool Finite(float v) { return !(float.IsNaN(v) || float.IsInfinity(v)); }

        public byte Move(float x, float y)
        {
            if (!Finite(x) || !Finite(y)) { Dropped++; return 0; }
            byte s = NextOrderSeq();
            _queue.Add(WireCommand.Move(x, y, s));
            return s;
        }

        public byte Stop()
        {
            byte s = NextOrderSeq();
            _queue.Add(WireCommand.Stop(s));
            return s;
        }

        public void Aim(float a)
        {
            if (!Finite(a)) { Dropped++; return; }
            _aim = WireCommand.Aim(a);
        }

        /// <summary>Queues a weapon selection intent; absent slot toggles. The server decides whether it can execute.</summary>
        public void Swap(byte? slot = null)
        {
            if (slot > 1) { Dropped++; return; }
            _queue.Add(WireCommand.Swap(slot));
        }

        /// <summary>Queues a pickup intent in order with other actions; inventory and range remain server decisions.</summary>
        public void Pickup(uint containerId)
        {
            if (containerId == 0) { Dropped++; return; }
            _queue.Add(WireCommand.Pickup(containerId));
        }

        public void Attack(float a, double? t) { if (!Finite(a)) { Dropped++; return; } _queue.Add(WireCommand.Attack(a, t)); }
        public void Release(float a, double? t) { if (!Finite(a)) { Dropped++; return; } _queue.Add(WireCommand.Release(a, t)); }

        public List<ClientMsg.Input> Flush(double nowMs)
        {
            var frames = new List<ClientMsg.Input>();
            if (_aim != null && nowMs - _lastAimMs >= AimMinIntervalMs)
            {
                _queue.Add(_aim);
                _aim = null;
                _lastAimMs = nowMs;
            }
            for (int i = 0; i < _queue.Count; i += Wire.MaxCommandsPerInput)
            {
                var f = new ClientMsg.Input { Seq = ++_frameSeq };
                int end = Math.Min(_queue.Count, i + Wire.MaxCommandsPerInput);
                for (int k = i; k < end; k++) f.Commands.Add(_queue[k]);
                frames.Add(f);
            }
            _queue.Clear();
            return frames;
        }
    }
}
