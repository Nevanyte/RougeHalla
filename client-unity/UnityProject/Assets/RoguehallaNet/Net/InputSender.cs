using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// Collects commands and builds Input frames. Aim is rate limited (latest wins, at most 40/s) and sent only when its value changed (the server latches it), with a
    /// slow repeat in case the server dropped it (stun, target lock, respawn). Every other command leaves with the next Flush that
    /// the seat's order budget allows (<see cref="Governed"/>, <see cref="OrderBudgetModel"/>): a command the server would drop for
    /// want of a token waits here instead, in order, so a press or a release is late by at most a few ticks rather than lost (a
    /// lost release left the trigger held). A frame carries at most 16 commands; the frame counter increments per frame.
    /// </summary>
    public sealed class InputSender
    {
        public const double AimMinIntervalMs = 25, AimRepeatMs = 100;
        static readonly List<ClientMsg.Input> NoFrames = new List<ClientMsg.Input>();
        readonly List<WireCommand> _queue = new List<WireCommand>();
        float _aim, _lastSentAim;
        bool _hasAim, _sentAim;
        double _lastAimMs = double.NegativeInfinity;
        uint _frameSeq;
        byte _orderSeq;
        internal event Action<WireCommand> CastQueued;
        internal WireCommand LastMovementOrder { get; private set; }
        /// <summary>
        /// Protocol 15: the estimate of server sim ms at this instant (the Session supplies it from the ping clock). When it returns a
        /// finite value, Move and AttackMove leave as MoveAt/AttackMoveAt carrying it; null (no clock sample yet) sends the plain orders.
        /// The client never predicts the server's resulting walk credit.
        /// </summary>
        public Func<double?> OrderClock;
        double? Stamp() { double? t = OrderClock == null ? null : OrderClock(); return t.HasValue && !double.IsNaN(t.Value) && !double.IsInfinity(t.Value) ? t : null; }

        /// <summary>Commands dropped because a value cannot be encoded (the server would refuse the whole frame).</summary>
        public int Dropped { get; private set; }

        /// <summary>Order sequence for Move/AttackMove/Stop/Cast: 1..255, never 0.</summary>
        byte NextOrderSeq() { _orderSeq = (byte)(_orderSeq == 255 ? 1 : _orderSeq + 1); return _orderSeq; }

        static bool Finite(float v) { return !(float.IsNaN(v) || float.IsInfinity(v)); }

        public byte Move(float x, float y)
        {
            if (!Finite(x) || !Finite(y)) { Dropped++; return 0; }
            byte s = NextOrderSeq();
            double? at = Stamp();
            LastMovementOrder = at.HasValue ? WireCommand.MoveAt(x, y, s, at.Value) : WireCommand.Move(x, y, s);
            Enqueue(LastMovementOrder);
            return s;
        }

        public void UseConsumable() { Enqueue(WireCommand.UseConsumable()); }

        /// <summary>Queues a planning intent. The server decides whether the choice is available and whether Ready is accepted.</summary>
        public void Plan(byte? spawn = null, byte? boon = null, bool? ready = null)
        {
            Enqueue(WireCommand.Plan(spawn, boon, ready));
        }

        /// <summary>
        /// Queues a training-console wire intent. This checks only the fixed wire shape; catalog validity, counts,
        /// option uniqueness and whether training is currently accepted remain server decisions.
        /// </summary>
        public void Train(byte command, uint id, ulong count, byte[] options = null)
        {
            if (command < 1 || command > 5 || (options != null && options.Length > 3))
            {
                Dropped++;
                return;
            }

            byte[] ownedOptions = options == null || options.Length == 0
                ? Array.Empty<byte>()
                : (byte[])options.Clone();
            Enqueue(WireCommand.Train(command, id, count, ownedOptions));
        }

        public void Target(uint actorRef) { if(actorRef==0) { Dropped++; return; } Enqueue(WireCommand.Target(actorRef)); }
        public byte AttackMove(float x,float y) { if(!Finite(x)||!Finite(y)) {Dropped++;return 0;} byte s=NextOrderSeq();double? at=Stamp();LastMovementOrder=at.HasValue?WireCommand.AttackMoveAt(x,y,s,at.Value):WireCommand.AttackMove(x,y,s);Enqueue(LastMovementOrder);return s; }
        public byte Stop()
        {
            byte s = NextOrderSeq();
            LastMovementOrder = WireCommand.Stop(s);
            Enqueue(LastMovementOrder);
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
            Enqueue(command);
            if (CastQueued != null) CastQueued(command);
            return seq;
        }

        public void Aim(float a)
        {
            if (!Finite(a)) { Dropped++; return; }
            _aim = a; _hasAim = true;
        }

        /// <summary>Queues a weapon selection intent; absent slot toggles. The server decides whether it can execute.</summary>
        public void Swap(byte? slot = null)
        {
            if (slot > 1) { Dropped++; return; }
            Enqueue(WireCommand.Swap(slot));
        }

        /// <summary>Queues a pickup intent in order with other actions; inventory and range remain server decisions.</summary>
        public void Pickup(PickupHandle handle)
        {
            if (!handle.IsValid) { Dropped++; return; }
            Enqueue(WireCommand.Pickup(handle));
        }

        /// <summary>Chooses an issued reward option, or skips with -1. Eligibility remains authoritative.</summary>
        public void Choose(RewardChestHandle handle, sbyte pick)
        {
            if(!handle.IsValid || pick < -1 || pick > 2) {Dropped++;return;}
            Enqueue(WireCommand.Choose(handle,pick));
        }

        /// <summary>Queues an owner-scoped quest acceptance reference; all eligibility stays server-authoritative.</summary>
        public void QuestAccept(QuestHandle handle)
        {
            if (!handle.IsValid) { Dropped++; return; }
            Enqueue(WireCommand.QuestAccept(handle));
        }

        /// <summary>Queues a fixed merchant kind and choice index; availability and eligibility remain server decisions.</summary>
        public void Trade(TradeKind kind, byte pick)
        {
            if ((byte)kind > (byte)TradeKind.Stats || pick > 2) { Dropped++; return; }
            Enqueue(WireCommand.Trade(kind, pick));
        }

        /// <summary>Cancels commands that belong to an earlier connection/observer epoch. The budget model is kept: the seat's bucket outlives a connection.</summary>
        internal void ClearPending() { _queue.Clear(); _heldSince.Clear(); _hasAim=false; _sentAim=false; LastMovementOrder=null; _swallowRelease=false; }

        public void Attack(float a, double? t) { if (!Finite(a)) { Dropped++; return; } Enqueue(WireCommand.Attack(a, t)); }
        public void Release(float a, double? t) { if (!Finite(a)) { Dropped++; return; } Enqueue(WireCommand.Release(a, t)); }

        /// <summary>
        /// Shape traffic to the server's order budget (on by default; see <see cref="OrderBudgetModel"/>). Off, every queued command
        /// leaves with the next Flush, as before the governor existed.
        /// </summary>
        public bool Governed = true;
        /// <summary>A press held back longer than this is withdrawn, together with its release when no earlier press is held on the server.</summary>
        public const double PressHoldMs = 200.0;
        /// <summary>The client's model of the seat's order budget.</summary>
        public readonly OrderBudgetModel Budget = new OrderBudgetModel();
        /// <summary>Commands that waited at least one Flush for a token (each counted once).</summary>
        public int Held { get; private set; }
        /// <summary>Movement orders replaced by a newer one before they left (the server keeps only the newest per tick anyway).</summary>
        public int Coalesced { get; private set; }
        /// <summary>Presses (and their releases) withdrawn after waiting longer than <see cref="PressHoldMs"/>.</summary>
        public int Withdrawn { get; private set; }
        /// <summary>Whether the last Attack or Release sent was an Attack: the server holds the trigger.</summary>
        public bool TriggerHeld { get { return _triggerHeld; } }
        /// <summary>Commands queued and not sent yet (held for a token, or collected since the last Flush).</summary>
        public int Pending { get { return _queue.Count; } }

        /// <summary>
        /// Whether a held movement key may re-send its steering order at the full rate: the budget keeps
        /// <see cref="SteerPacing.RepeatReserve"/> tokens (one more while the trigger is held, for its release). Always true ungoverned.
        /// </summary>
        public bool SteerRepeatHasRoom(double nowMs)
        {
            return !Governed || Budget.CanSpend(nowMs, SteerPacing.RepeatReserve + (_triggerHeld ? 1 : 0));
        }

        readonly List<double> _heldSince = new List<double>();
        readonly List<WireCommand> _send = new List<WireCommand>();
        bool _triggerHeld, _swallowRelease;

        static bool IsMovement(CommandKind k)
        {
            return k == CommandKind.Move || k == CommandKind.MoveAt || k == CommandKind.Stop ||
                   k == CommandKind.AttackMove || k == CommandKind.AttackMoveAt;
        }

        void Enqueue(WireCommand c)
        {
            if (Governed)
            {
                if (IsMovement(c.Kind))
                {
                    // Only the newest movement order per tick reaches the walk on the server; one still queued here is superseded.
                    for (int i = _queue.Count - 1; i >= 0; i--)
                        if (IsMovement(_queue[i].Kind)) { _queue.RemoveAt(i); _heldSince.RemoveAt(i); Coalesced++; }
                }
                else if (c.Kind == CommandKind.Attack) _swallowRelease = false;
                else if (c.Kind == CommandKind.Release && _swallowRelease)
                {
                    // The press this release ends was withdrawn unsent and no earlier press is held: nothing to release.
                    _swallowRelease = false;
                    Withdrawn++;
                    return;
                }
            }
            _queue.Add(c);
            _heldSince.Add(double.NaN);
        }

        void NoteSent(WireCommand c)
        {
            if (c.Kind == CommandKind.Attack) _triggerHeld = true;
            else if (c.Kind == CommandKind.Release) _triggerHeld = false;
        }

        /// <summary>
        /// Builds this frame's Input frames. Governed, commands leave in queue order while the budget model has a token beyond its
        /// safety margin; the first that does not fit waits, with every command after it (order is kept), for a later Flush. Aim is
        /// free and always leaves. A press that waited longer than <see cref="PressHoldMs"/> is withdrawn with its release.
        /// </summary>
        public List<ClientMsg.Input> Flush(double nowMs)
        {
            _send.Clear();
            if (Governed) WithdrawStalePresses(nowMs);
            bool blocked = false;
            int kept = 0;
            for (int i = 0; i < _queue.Count; i++)
            {
                var c = _queue[i];
                bool costs = OrderBudgetModel.Costs(c);
                if (!Governed || !costs || !blocked && Budget.CanSpend(nowMs, 0))
                {
                    if (costs) Budget.Spend(nowMs);
                    NoteSent(c);
                    _send.Add(c);
                    continue;
                }
                blocked = true;
                if (double.IsNaN(_heldSince[i])) { _heldSince[i] = nowMs; Held++; }
                _queue[kept] = c;
                _heldSince[kept] = _heldSince[i];
                kept++;
            }
            _queue.RemoveRange(kept, _queue.Count - kept);
            _heldSince.RemoveRange(kept, _heldSince.Count - kept);

            if (_hasAim && nowMs - _lastAimMs >= AimMinIntervalMs)
            {
                _hasAim = false;
                if (!_sentAim || _aim != _lastSentAim || nowMs - _lastAimMs >= AimRepeatMs)
                {
                    _send.Add(WireCommand.Aim(_aim));
                    _lastSentAim = _aim; _sentAim = true;
                    _lastAimMs = nowMs;
                }
            }
            if (_send.Count == 0) return NoFrames;
            var frames = new List<ClientMsg.Input>();
            for (int i = 0; i < _send.Count; i += Wire.MaxCommandsPerInput)
            {
                var f = new ClientMsg.Input { Seq = ++_frameSeq };
                int end = Math.Min(_send.Count, i + Wire.MaxCommandsPerInput);
                for (int k = i; k < end; k++) f.Commands.Add(_send[k]);
                frames.Add(f);
            }
            _send.Clear();
            return frames;
        }

        void WithdrawStalePresses(double nowMs)
        {
            for (int i = 0; i < _queue.Count; i++)
            {
                if (_queue[i].Kind != CommandKind.Attack || double.IsNaN(_heldSince[i]) || nowMs - _heldSince[i] < PressHoldMs) continue;
                _queue.RemoveAt(i); _heldSince.RemoveAt(i);
                Withdrawn++;
                // Its release ends nothing unless an earlier press is still held on the server (or an earlier queued one leaves first).
                bool earlierPress = _triggerHeld;
                for (int k = 0; k < i; k++) if (_queue[k].Kind == CommandKind.Attack) earlierPress = true;
                if (earlierPress) { i--; continue; }
                int r = i;
                while (r < _queue.Count && _queue[r].Kind != CommandKind.Release && _queue[r].Kind != CommandKind.Attack) r++;
                if (r < _queue.Count && _queue[r].Kind == CommandKind.Release) { _queue.RemoveAt(r); _heldSince.RemoveAt(r); Withdrawn++; }
                else if (r == _queue.Count) _swallowRelease = true;
                i--;
            }
        }
    }
}
