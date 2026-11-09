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
        internal event Action<WireCommand> CastQueued;
        internal WireCommand LastMovementOrder { get; private set; }

        /// <summary>Commands dropped because a value cannot be encoded (the server would refuse the whole frame).</summary>
        public int Dropped { get; private set; }

        /// <summary>Order sequence for Move/AttackMove/Stop/Cast: 1..255, never 0.</summary>
        byte NextOrderSeq() { _orderSeq = (byte)(_orderSeq == 255 ? 1 : _orderSeq + 1); return _orderSeq; }

        static bool Finite(float v) { return !(float.IsNaN(v) || float.IsInfinity(v)); }

        public byte Move(float x, float y)
        {
            if (!Finite(x) || !Finite(y)) { Dropped++; return 0; }
            byte s = NextOrderSeq();
            LastMovementOrder = WireCommand.Move(x, y, s);
            _queue.Add(LastMovementOrder);
            return s;
        }

        public void UseConsumable() { _queue.Add(WireCommand.UseConsumable()); }

        /// <summary>Queues a planning intent. The server decides whether the choice is available and whether Ready is accepted.</summary>
        public void Plan(byte? spawn = null, byte? boon = null, bool? ready = null)
        {
            _queue.Add(WireCommand.Plan(spawn, boon, ready));
        }

        public void Target(uint actorRef) { if(actorRef==0) { Dropped++; return; } _queue.Add(WireCommand.Target(actorRef)); }
        public byte AttackMove(float x,float y) { if(!Finite(x)||!Finite(y)) {Dropped++;return 0;} byte s=NextOrderSeq();LastMovementOrder=WireCommand.AttackMove(x,y,s);_queue.Add(LastMovementOrder);return s; }
        public byte Stop()
        {
            byte s = NextOrderSeq();
            LastMovementOrder = WireCommand.Stop(s);
            _queue.Add(LastMovementOrder);
            return s;
        }

        /// <summary>Queues a cast intent. Stocks, targeting, range and eligibility are server decisions.</summary>
        public byte Cast(byte slot, float x, float y, uint? actorRef = null, double? t = null)
        {
            if (slot > 2 || !Finite(x) || !Finite(y) || actorRef == 0 ||
                t.HasValue && (double.IsNaN(t.Value) || double.IsInfinity(t.Value)))
            { Dropped++; return 0; }
            byte seq = NextOrderSeq();
            var command = WireCommand.Cast(slot, x, y, actorRef, t, seq);
            _queue.Add(command);
            if (CastQueued != null) CastQueued(command);
            return seq;
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
        public void Pickup(PickupHandle handle)
        {
            if (!handle.IsValid) { Dropped++; return; }
            _queue.Add(WireCommand.Pickup(handle));
        }

        /// <summary>Chooses an issued reward option, or skips with -1. Eligibility remains authoritative.</summary>
        public void Choose(RewardChestHandle handle, sbyte pick)
        {
            if(!handle.IsValid || pick < -1 || pick > 2) {Dropped++;return;}
            _queue.Add(WireCommand.Choose(handle,pick));
        }

        /// <summary>Queues an owner-scoped quest acceptance reference; all eligibility stays server-authoritative.</summary>
        public void QuestAccept(QuestHandle handle)
        {
            if (!handle.IsValid) { Dropped++; return; }
            _queue.Add(WireCommand.QuestAccept(handle));
        }

        /// <summary>Queues a fixed merchant kind and choice index; availability and eligibility remain server decisions.</summary>
        public void Trade(TradeKind kind, byte pick)
        {
            if ((byte)kind > (byte)TradeKind.Stats || pick > 2) { Dropped++; return; }
            _queue.Add(WireCommand.Trade(kind, pick));
        }

        /// <summary>Cancels commands that belong to an earlier connection/observer epoch.</summary>
        internal void ClearPending() { _queue.Clear(); _aim=null; LastMovementOrder=null; }

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
