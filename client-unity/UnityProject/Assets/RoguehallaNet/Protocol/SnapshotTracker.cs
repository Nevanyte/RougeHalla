using System;

namespace Roguehalla.Net.Protocol
{
    /// <summary>
    /// A snapshot delta that cannot be applied to the snapshot the client holds (protocol v3, masks of v4). The client REFUSES such a delta
    /// (it never repairs or clamps), keeps what it holds, and asks the server for a Full snapshot. <see cref="Code"/> is the
    /// stable name the golden vectors use (rh-protocol <c>DeltaError::code</c>).
    /// </summary>
    public sealed class DeltaException : Exception
    {
        public string Code { get; }
        public DeltaException(string code, string detail = null) : base(detail == null ? code : code + ": " + detail) { Code = code; }
    }

    /// <summary>
    /// A client's snapshot decoder (rh-protocol <c>SnapshotTracker</c>): it holds the last snapshot it applied, which is the base of
    /// the next delta. One per connection; a Welcome resets it, so the first snapshot after one must be Full. A refused delta
    /// leaves it exactly as it was. <see cref="Decode"/> hands out a <see cref="ServerMsg.Snapshot"/> for both kinds of snapshot
    /// frame, decoded INTO <c>reuse</c> when one is given, so steady play makes no garbage while the number of visible actors
    /// stays the same (<c>Snapshot.Actors</c> is an exact-length array: a reused snapshot whose count differs gets a new one, as
    /// in the Full decode).
    /// </summary>
    public sealed class SnapshotTracker
    {
        bool _has;
        uint _tick;
        byte _phase;
        readonly WireSelf _me = new WireSelf();
        bool _hasMe;
        /// <summary>Protocol 8: the held snapshot's public training fact (static per connection).</summary>
        bool _training;
        WireActor[] _actors = new WireActor[16];
        WireActor[] _next = new WireActor[16];
        int _count;
        readonly ServerMsg.SnapshotDelta _delta = new ServerMsg.SnapshotDelta();

        /// <summary>Whether a snapshot is held (a delta can be applied).</summary>
        public bool HasBase { get { return _has; } }
        /// <summary>The tick of the snapshot held.</summary>
        public uint HeldTick { get { return _tick; } }
        public int HeldActors { get { return _count; } }

        /// <summary>Forgets the held snapshot (a new connection or a Welcome).</summary>
        public void Reset() { _has = false; _hasMe = false; _count = 0; }

        /// <summary>
        /// Decodes the first <paramref name="length"/> bytes of a server frame. A Full snapshot is held and returned; a delta is
        /// applied and returned as the snapshot it resolves to; a Welcome resets the tracker; anything else is returned as
        /// <see cref="ServerMsg.Decode(byte[], int, ServerMsg.Snapshot)"/> would. Throws <see cref="DecodeException"/> for a
        /// malformed frame and <see cref="DeltaException"/> for a well-formed delta that does not apply; neither changes the held
        /// snapshot (<paramref name="reuse"/> may be left partly overwritten, as with a plain decode).
        /// </summary>
        public ServerMsg Decode(byte[] frame, int length, ServerMsg.Snapshot reuse)
        {
            if (length > 0 && frame[0] == 0x87)
            {
                if (length > Wire.MaxServerFrame) throw new DecodeException(DecodeError.TooLarge, length.ToString());
                var r = new Reader(frame, length);
                r.U8();
                ServerMsg.SnapshotDelta.Read(ref r, _delta);
                r.End();
                return Apply(_delta, reuse ?? new ServerMsg.Snapshot());
            }
            ServerMsg msg = ServerMsg.Decode(frame, length, reuse);
            var snap = msg as ServerMsg.Snapshot;
            if (snap != null) Hold(snap);
            else if (msg is ServerMsg.Welcome) Reset();
            return msg;
        }

        /// <summary>Applies an already decoded delta (see <see cref="Decode"/>); the result is a new snapshot unless <paramref name="reuse"/> is given.</summary>
        public ServerMsg.Snapshot Apply(ServerMsg.SnapshotDelta d, ServerMsg.Snapshot reuse)
        {
            var s = reuse ?? new ServerMsg.Snapshot();
            if (!_has) throw new DeltaException("no_base");
            if (_tick != d.BaseTick) throw new DeltaException("base_mismatch", "have " + _tick + ", want " + d.BaseTick);
            if (d.HasSelf && !_hasMe) throw new DeltaException("self_without_base");
            int need = _count + d.ChangedCount;
            if (_next.Length < need) _next = new WireActor[Math.Max(need, _next.Length * 2)];

            int o = 0, bi = 0, di = 0;
            for (int ci = 0; ci < d.ChangedCount; ci++)
            {
                ActorDelta ch = d.Changed[ci];
                Flush(d, ch.Id, true, ref bi, ref di, ref o);
                if (bi < _count && _actors[bi].Id == ch.Id)
                {
                    if (di < d.DepartedCount && d.Departed[di] == ch.Id) throw new DeltaException("departed_and_changed", ch.Id.ToString());
                    _next[o++] = Updated(_actors[bi], ch);
                    bi++;
                }
                else
                {
                    // A new actor starts from the default one: the fields it does not carry are at their defaults.
                    if ((ch.Mask & ActorDelta.MNew) != ActorDelta.MNew) throw new DeltaException("incomplete_new_actor", ch.Id.ToString());
                    var fresh = default(WireActor);
                    fresh.HpPct = WireActor.DefaultHpPct;
                    fresh.Status = Wire.DefaultStatus;
                    _next[o++] = Updated(fresh, ch);
                }
            }
            Flush(d, 0, false, ref bi, ref di, ref o);
            if (di < d.DepartedCount) throw new DeltaException("unknown_departed", d.Departed[di].ToString());
            if (o > Wire.MaxActors) throw new DeltaException("too_many_actors", o.ToString());
            for (int i = 0; i < o; i++)
                if (!_next[i].HasValidGiverIdentity)
                    throw new DeltaException("giver_actor", _next[i].Id.ToString());

            // Everything checked: commit.
            var swap = _actors; _actors = _next; _next = swap; _count = o;
            _tick = d.Tick;
            if (d.HasPhase) _phase = d.Phase;
            s.Tick = d.Tick; s.Phase = _phase; s.AckInput = d.AckInput; s.Training = d.Training; _training = d.Training;
            // Source time is per-frame: an absent override means this delta's tick clock, never the base snapshot's value.
            s.ServerTimeOverrideMs = d.ServerTimeOverrideMs;
            if (d.HasSelf)
            {
                var me = s.Me ?? new WireSelf();
                me.CopyFrom(_me);
                d.Me.ApplyTo(me);
                if (d.HasWish)
                {
                    if (d.Wish == null) me.Wish = null;
                    else { if (me.Wish == null) me.Wish = new WireWishOwner(); me.Wish.CopyFrom(d.Wish); }
                }
                if (d.HasBarrier) { me.Barrier = d.Barrier; me.BarrierRingStep = d.BarrierRingStep; }
                _me.CopyFrom(me);
                s.Me = me;
            }
            else { _hasMe = false; s.Me = null; }
            CopyActorsTo(s);
            return s;
        }

        /// <summary>Copies (or retires, when departed) the base actors below <paramref name="limit"/> (all of them when there is no limit).</summary>
        void Flush(ServerMsg.SnapshotDelta d, uint limit, bool hasLimit, ref int bi, ref int di, ref int o)
        {
            while (bi < _count && (!hasLimit || _actors[bi].Id < limit))
            {
                uint id = _actors[bi].Id;
                if (di < d.DepartedCount && d.Departed[di] < id) throw new DeltaException("unknown_departed", d.Departed[di].ToString());
                if (di < d.DepartedCount && d.Departed[di] == id) di++;
                else _next[o++] = _actors[bi];
                bi++;
            }
        }

        static WireActor Updated(WireActor a, ActorDelta ch)
        {
            a.Id = ch.Id;
            if ((ch.Mask & ActorDelta.MX) != 0) a.X = Quant.DequantizePos(ch.X);
            if ((ch.Mask & ActorDelta.MY) != 0) a.Y = Quant.DequantizePos(ch.Y);
            if ((ch.Mask & ActorDelta.MFacing) != 0) a.Facing = Quant.DequantizeFacing(ch.Facing);
            if ((ch.Mask & ActorDelta.MKit) != 0) { a.Faction = (byte)(ch.Kit & 0x0f); a.Weapon = (byte)(ch.Kit >> 4); }
            if ((ch.Mask & ActorDelta.MHp) != 0) a.HpPct = ch.HpPct;
            if ((ch.Mask & ActorDelta.MBounty) != 0) a.Bounty = ch.Bounty;
            if ((ch.Mask & ActorDelta.MStatus) != 0) a.Status = ch.Status;
            if ((ch.Mask & ActorDelta.MKind) != 0) a.Kind = ch.Kind;
            if ((ch.Mask & ActorDelta.MEffects) != 0) a.Effects = ch.Effects;
            if ((ch.Mask & ActorDelta.MDisplace) != 0) a.DisplaceSeq = ch.DisplaceSeq;
            if ((ch.Mask & ActorDelta.MMobType) != 0) a.MobTypeCode = ch.MobTypeCode;
            if ((ch.Mask & ActorDelta.MSig) != 0) a.Sig = ch.Sig;
            if ((ch.Mask & ActorDelta.MBarrier) != 0) { a.BarrierPct = ch.BarrierPct; a.BarrierRingStep = ch.BarrierRingStep; }
            return a;
        }

        void Hold(ServerMsg.Snapshot s)
        {
            _has = true;
            _tick = s.Tick;
            _phase = s.Phase;
            _training = s.Training;
            _hasMe = s.Me != null;
            if (_hasMe) _me.CopyFrom(s.Me);
            int n = s.Actors.Length;
            if (_actors.Length < n) _actors = new WireActor[Math.Max(n, _actors.Length * 2)];
            Array.Copy(s.Actors, 0, _actors, 0, n);
            _count = n;
        }

        void CopyActorsTo(ServerMsg.Snapshot s)
        {
            var arr = s.Actors;
            if (arr == null || arr.Length != _count) arr = _count == 0 ? Array.Empty<WireActor>() : new WireActor[_count];
            Array.Copy(_actors, 0, arr, 0, _count);
            s.Actors = arr;
        }
    }
}
