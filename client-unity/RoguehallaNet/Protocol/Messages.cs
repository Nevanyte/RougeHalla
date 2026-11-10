using System;
using System.Collections.Generic;

namespace Roguehalla.Net.Protocol
{
    /// <summary>Wire format: append only. A decoder accepts any code above 0: a value this enum does not name decodes as itself
    /// (<c>(RejectCode)n</c>, so <c>Enum.IsDefined</c> is false) and ends the session as Rejected with the reason text.</summary>
    public enum RejectCode : ushort
    {
        ProtocolMismatch = 1, ContentMismatch = 2, BadCredentials = 3, ProfileInUse = 4, MatchFull = 5, RateLimited = 6,
        Malformed = 7, TooSlow = 8, ServerDraining = 9, NoSuchSession = 10, Kicked = 11,
    }

    public enum CommandKind : byte { Move = 1, Stop = 2, Aim = 3, Attack = 4, Release = 5, Swap = 6, Pickup = 7, Choose = 8, UseConsumable = 9, Target = 10, AttackMove = 11, HuntTarget = 12, ConsumeCorpse = 13, Plan = 14, Train = 15, Cast = 16, QuestAccept = 17, Trade = 18, MoveAt = 19, AttackMoveAt = 20 }

    /// <summary>A client command. Only the fields of its Kind are meaningful.</summary>
    public sealed class WireCommand
    {
        public CommandKind Kind;
        public float X, Y;
        /// <summary>Aim angle (Aim, Attack, Release).</summary>
        public float A;
        /// <summary>Order sequence echoed in Snapshot.me.move_seq (Move, AttackMove, Stop).</summary>
        public byte? Seq;
        public byte? Slot;
        public PickupHandle PickupRef;
        public RewardChestHandle RewardRef;
        public QuestHandle QuestRef;
        public sbyte Pick;
        public TradeKind TradeKind;
        public uint ActorRef;
        /// <summary>Client time in server ms: render time for Attack/Release/Cast, or for MoveAt/AttackMoveAt (required) the estimate of server time when the order was issued (no render delay subtracted).</summary>
        public double? T;
        /// <summary>Planning option indexes (Plan): 0 or 1, indexes into this player's own private plan.</summary>
        public byte? Spawn, Boon;
        /// <summary>Plan ready latch (true freezes the picks).</summary>
        public bool? Ready;
        /// <summary>The practice console command byte (Train): 1 card, 2 stat, 3 camp, 4 chest, 5 clear.</summary>
        public byte TrainCommand;
        /// <summary>A card or mob-type catalog position (Train).</summary>
        public uint TrainId;
        /// <summary>The requested copy/stack count (Train); the server clamps it.</summary>
        public ulong TrainCount;
        /// <summary>The chest's chosen card positions (Train, chest only; at most three).</summary>
        public byte[] TrainOptions = Array.Empty<byte>();

        /// <summary>A user-initiated cast request. Slot is a client command slot; server-owned ability and outcome are never sent.</summary>
        public static WireCommand Cast(byte slot, float x, float y, uint? actor = null, double? t = null, byte? seq = null)
        {
            if (slot > 2) throw new ArgumentOutOfRangeException(nameof(slot));
            if (actor == 0) throw new ArgumentOutOfRangeException(nameof(actor));
            return new WireCommand { Kind = CommandKind.Cast, Slot = slot, X = x, Y = y, ActorRef = actor ?? 0, T = t, Seq = seq };
        }

        public static WireCommand Train(byte command, uint id, ulong count, byte[] options = null)
        {
            return new WireCommand { Kind = CommandKind.Train, TrainCommand = command, TrainId = id, TrainCount = count, TrainOptions = options ?? Array.Empty<byte>() };
        }

        public static WireCommand Swap(byte? slot = null) { return new WireCommand { Kind = CommandKind.Swap, Slot = slot }; }
        public static WireCommand Pickup(PickupHandle handle) { return new WireCommand { Kind = CommandKind.Pickup, PickupRef = handle }; }
        public static WireCommand Choose(RewardChestHandle handle, sbyte pick) { return new WireCommand { Kind = CommandKind.Choose, RewardRef = handle, Pick = pick }; }
        public static WireCommand QuestAccept(QuestHandle handle) { return new WireCommand { Kind = CommandKind.QuestAccept, QuestRef = handle }; }
        public static WireCommand Trade(TradeKind kind, byte pick)
        {
            if ((byte)kind > (byte)TradeKind.Stats) throw new ArgumentOutOfRangeException(nameof(kind));
            if (pick > 2) throw new ArgumentOutOfRangeException(nameof(pick));
            return new WireCommand { Kind = CommandKind.Trade, TradeKind = kind, Pick = (sbyte)pick };
        }
        public static WireCommand Move(float x, float y, byte? seq) { return new WireCommand { Kind = CommandKind.Move, X = x, Y = y, Seq = seq }; }
        /// <summary>Protocol 15: a Move that carries the issue-time estimate of server sim ms (<paramref name="t"/>, finite). The server clamps it and may credit up to one tick of walk; the client never predicts that credit.</summary>
        public static WireCommand MoveAt(float x, float y, byte? seq, double t) { return new WireCommand { Kind = CommandKind.MoveAt, X = x, Y = y, Seq = seq, T = t }; }
        public static WireCommand AttackMoveAt(float x, float y, byte? seq, double t) { return new WireCommand { Kind = CommandKind.AttackMoveAt, X = x, Y = y, Seq = seq, T = t }; }
        public static WireCommand UseConsumable() { return new WireCommand { Kind = CommandKind.UseConsumable }; }
        public static WireCommand Target(uint actorRef) { if (actorRef == 0) throw new ArgumentException("actor reference"); return new WireCommand { Kind = CommandKind.Target, ActorRef = actorRef }; }
        public static WireCommand HuntTarget(uint actorRef) { if (actorRef == 0) throw new ArgumentException("hunt target"); return new WireCommand { Kind = CommandKind.HuntTarget, ActorRef = actorRef }; }
        public static WireCommand ConsumeCorpse(PickupHandle handle) { if (!handle.IsValid) throw new ArgumentException("corpse handle"); return new WireCommand { Kind = CommandKind.ConsumeCorpse, PickupRef = handle }; }
        public static WireCommand AttackMove(float x, float y, byte? seq) { return new WireCommand { Kind = CommandKind.AttackMove, X = x, Y = y, Seq = seq }; }
        public static WireCommand Stop(byte? seq) { return new WireCommand { Kind = CommandKind.Stop, Seq = seq }; }
        public static WireCommand Aim(float a) { return new WireCommand { Kind = CommandKind.Aim, A = a }; }
        public static WireCommand Attack(float a, double? t) { return new WireCommand { Kind = CommandKind.Attack, A = a, T = t }; }
        public static WireCommand Release(float a, double? t) { return new WireCommand { Kind = CommandKind.Release, A = a, T = t }; }
        public static WireCommand Plan(byte? spawn = null, byte? boon = null, bool? ready = null) { return new WireCommand { Kind = CommandKind.Plan, Spawn = spawn, Boon = boon, Ready = ready }; }
    }

    public abstract class ClientMsg
    {
        const byte THello = 0x01, TInput = 0x02, TPing = 0x03, TLeave = 0x04, TResync = 0x05;

        public abstract byte[] Encode();

        /// <summary>Decodes an untrusted client frame (size limit, finite floats, list bounds, no trailing bytes).</summary>
        public static ClientMsg Decode(byte[] frame)
        {
            if (frame.Length > Wire.MaxClientFrame) throw new DecodeException(DecodeError.TooLarge, frame.Length.ToString());
            var r = new Reader(frame) { FiniteOnly = true };
            ClientMsg msg;
            switch (r.U8())
            {
                case THello:
                {
                    var h = new Hello { Protocol = r.U16(), ContentHash = r.U64(), Build = r.Str(), Profile = r.Str(), Ticket = r.Blob(Wire.MaxTicket) };
                    if (r.Flag()) h.Faction = r.U8();
                    if (r.Flag()) h.Resume = r.Array16();
                    msg = h;
                    break;
                }
                case TInput:
                {
                    var inp = new Input { Seq = r.U32() };
                    int n = r.U16();
                    if (n > Wire.MaxCommandsPerInput) throw new DecodeException(DecodeError.TooMany, n.ToString());
                    for (int i = 0; i < n; i++)
                    {
                        byte tag = r.U8();
                        switch (tag)
                        {
                            case 6: { byte? slot = r.Flag() ? r.U8() : (byte?)null; if (slot > 1) throw new DecodeException(DecodeError.BadField, "slot"); inp.Commands.Add(WireCommand.Swap(slot)); break; }
                            case 7: { uint id = r.U32(); if (id == 0) throw new DecodeException(DecodeError.BadField, "container"); inp.Commands.Add(WireCommand.Pickup(new PickupHandle(id))); break; }
                            case 8: { uint id=r.U32(); sbyte pick=unchecked((sbyte)r.U8()); if(id==0 || pick < -1 || pick > 2) throw new DecodeException(DecodeError.BadField,"reward choice"); inp.Commands.Add(WireCommand.Choose(new RewardChestHandle(id),pick)); break; }
                            case 9: inp.Commands.Add(WireCommand.UseConsumable()); break;
                            case 10: { uint id=r.U32(); if(id==0) throw new DecodeException(DecodeError.BadField,"actor reference"); inp.Commands.Add(WireCommand.Target(id)); break; }
                            case 11: { float x=r.F32(),y=r.F32(); inp.Commands.Add(WireCommand.AttackMove(x,y,r.Flag()?r.U8():(byte?)null)); break; }
                            case 19: { float x=r.F32(),y=r.F32(); byte? seq=r.Flag()?r.U8():(byte?)null; inp.Commands.Add(WireCommand.MoveAt(x,y,seq,r.F64())); break; }
                            case 20: { float x=r.F32(),y=r.F32(); byte? seq=r.Flag()?r.U8():(byte?)null; inp.Commands.Add(WireCommand.AttackMoveAt(x,y,seq,r.F64())); break; }
                            case 12: { uint id=r.U32(); if(id==0) throw new DecodeException(DecodeError.BadField,"hunt target"); inp.Commands.Add(WireCommand.HuntTarget(id)); break; }
                            case 13: { uint id=r.U32(); if(id==0) throw new DecodeException(DecodeError.BadField,"corpse handle"); inp.Commands.Add(WireCommand.ConsumeCorpse(new PickupHandle(id))); break; }
                            case 14:
                            {
                                byte flags = r.U8();
                                if ((flags & 0xf8) != 0) throw new DecodeException(DecodeError.BadField, "plan flags");
                                byte? spawn = null, boon = null; bool? ready = null;
                                if ((flags & 1) != 0) { spawn = r.U8(); if (spawn > 1) throw new DecodeException(DecodeError.BadField, "plan spawn"); }
                                if ((flags & 2) != 0) { boon = r.U8(); if (boon > 1) throw new DecodeException(DecodeError.BadField, "plan boon"); }
                                if ((flags & 4) != 0) ready = r.U8() != 0;
                                inp.Commands.Add(WireCommand.Plan(spawn, boon, ready));
                                break;
                            }
                            case 15:
                            {
                                byte cmd = r.U8();
                                if (cmd < 1 || cmd > 5) throw new DecodeException(DecodeError.BadField, "train command");
                                uint id = r.Varint();
                                ulong count = r.U64();
                                int on = r.U8();
                                if (on > 3) throw new DecodeException(DecodeError.TooMany, on.ToString());
                                var opts = on == 0 ? Array.Empty<byte>() : new byte[on];
                                for (int k = 0; k < on; k++) opts[k] = r.U8();
                                inp.Commands.Add(WireCommand.Train(cmd, id, count, opts));
                                break;
                            }
                            case 16:
                            {
                                byte slot = r.U8(); if (slot > 2) throw new DecodeException(DecodeError.BadField, "cast slot");
                                float x = r.F32(), y = r.F32();
                                uint? actor = null; if (r.Flag()) { uint id = r.U32(); if (id == 0) throw new DecodeException(DecodeError.BadField, "cast actor reference"); actor = id; }
                                double? t = r.Flag() ? r.F64() : (double?)null;
                                byte? seq = r.Flag() ? r.U8() : (byte?)null;
                                inp.Commands.Add(WireCommand.Cast(slot, x, y, actor, t, seq));
                                break;
                            }
                            case 17: inp.Commands.Add(WireCommand.QuestAccept(StateItem.ReadQuestHandle(ref r))); break;
                            case 18:
                            {
                                byte kind = r.U8();
                                if (kind > (byte)TradeKind.Stats) throw new DecodeException(DecodeError.BadField, "trade kind");
                                byte pick = r.U8();
                                if (pick > 2) throw new DecodeException(DecodeError.BadField, "trade pick");
                                inp.Commands.Add(WireCommand.Trade((TradeKind)kind, pick));
                                break;
                            }
                            case 1: { float x = r.F32(), y = r.F32(); inp.Commands.Add(WireCommand.Move(x, y, r.Flag() ? r.U8() : (byte?)null)); break; }
                            case 2: inp.Commands.Add(WireCommand.Stop(r.Flag() ? r.U8() : (byte?)null)); break;
                            case 3: inp.Commands.Add(WireCommand.Aim(r.F32())); break;
                            case 4: { float a = r.F32(); inp.Commands.Add(WireCommand.Attack(a, r.Flag() ? r.F64() : (double?)null)); break; }
                            case 5: { float a = r.F32(); inp.Commands.Add(WireCommand.Release(a, r.Flag() ? r.F64() : (double?)null)); break; }
                            default: throw new DecodeException(DecodeError.BadTag, tag.ToString());
                        }
                    }
                    msg = inp;
                    break;
                }
                case TPing: msg = new Ping { Nonce = r.U32(), ClientMs = r.F64() }; break;
                case TLeave: msg = new Leave(); break;
                case TResync: msg = new Resync(); break;
                default: throw new DecodeException(DecodeError.BadTag);
            }
            r.End();
            return msg;
        }

        /// <summary>First frame of every connection. Resume is the 16-byte session token of a dropped connection.</summary>
        public sealed class Hello : ClientMsg
        {
            public ushort Protocol = Wire.ProtocolVersion;
            public ulong ContentHash;
            public string Build = "", Profile = "";
            /// <summary>Opaque admission credential (at most <see cref="Wire.MaxTicket"/> bytes); P-HOST-1 defines its contents.</summary>
            public byte[] Ticket = new byte[0];
            public byte? Faction;
            public byte[] Resume;

            public override byte[] Encode()
            {
                var w = new Writer();
                if (Ticket != null && Ticket.Length > Wire.MaxTicket) throw new EncodeException("ticket of " + Ticket.Length + " bytes does not fit the wire (max " + Wire.MaxTicket + ")");
                w.U8(THello); w.U16(Protocol); w.U64(ContentHash); w.Str(Build); w.Str(Profile); w.Blob(Ticket);
                if (Faction.HasValue) { w.U8(1); w.U8(Faction.Value); } else w.U8(0);
                if (Resume != null)
                {
                    if (Resume.Length != 16) throw new ArgumentException("resume token must be 16 bytes");
                    w.U8(1); w.Bytes(Resume);
                }
                else w.U8(0);
                return w.Finish();
            }
        }

        public sealed class Input : ClientMsg
        {
            public uint Seq;
            public List<WireCommand> Commands = new List<WireCommand>();

            public override byte[] Encode()
            {
                if (Commands.Count > Wire.MaxCommandsPerInput) throw new ArgumentException("too many commands");
                int len = 7;
                foreach (var c in Commands) len += CommandLength(c);
                var w = new Writer(len);
                w.U8(TInput); w.U32(Seq); w.U16((ushort)Commands.Count);
                foreach (var c in Commands)
                {
                    w.U8((byte)c.Kind);
                    switch (c.Kind)
                    {
                        case CommandKind.Swap: if (c.Slot > 1) throw new ArgumentException("slot"); Opt(w, c.Slot); break;
                        case CommandKind.Pickup: if (!c.PickupRef.IsValid) throw new ArgumentException("pickup handle"); w.U32(c.PickupRef.Value); break;
                        case CommandKind.Choose: if(!c.RewardRef.IsValid || c.Pick < -1 || c.Pick > 2) throw new ArgumentException("reward choice"); w.U32(c.RewardRef.Value);w.U8(unchecked((byte)c.Pick));break;
                        case CommandKind.UseConsumable: break;
                        case CommandKind.Plan:
                            if (c.Spawn > 1 || c.Boon > 1) throw new ArgumentException("plan option");
                            w.U8((byte)((c.Spawn.HasValue ? 1 : 0) | (c.Boon.HasValue ? 2 : 0) | (c.Ready.HasValue ? 4 : 0)));
                            if (c.Spawn.HasValue) w.U8(c.Spawn.Value);
                            if (c.Boon.HasValue) w.U8(c.Boon.Value);
                            if (c.Ready.HasValue) w.U8((byte)(c.Ready.Value ? 1 : 0));
                            break;
                        case CommandKind.Target: if(c.ActorRef==0) throw new ArgumentException("actor reference"); w.U32(c.ActorRef); break;
                        case CommandKind.HuntTarget: if(c.ActorRef==0) throw new ArgumentException("hunt target"); w.U32(c.ActorRef); break;
                        case CommandKind.ConsumeCorpse: if(!c.PickupRef.IsValid) throw new ArgumentException("corpse handle"); w.U32(c.PickupRef.Value); break;
                        case CommandKind.AttackMove:
                        case CommandKind.Move: w.F32(c.X); w.F32(c.Y); Opt(w, c.Seq); break;
                        case CommandKind.MoveAt:
                        case CommandKind.AttackMoveAt:
                            if (!c.T.HasValue || double.IsNaN(c.T.Value) || double.IsInfinity(c.T.Value) || float.IsNaN(c.X) || float.IsInfinity(c.X) || float.IsNaN(c.Y) || float.IsInfinity(c.Y)) throw new ArgumentException("stamped move values must be finite");
                            w.F32(c.X); w.F32(c.Y); Opt(w, c.Seq); w.F64(c.T.Value); break;
                        case CommandKind.Stop: Opt(w, c.Seq); break;
                        case CommandKind.Aim: w.F32(c.A); break;
                        case CommandKind.Attack:
                        case CommandKind.Release:
                            w.F32(c.A);
                            if (c.T.HasValue) { w.U8(1); w.F64(c.T.Value); } else w.U8(0);
                            break;
                        case CommandKind.Train:
                            if (c.TrainCommand < 1 || c.TrainCommand > 5) throw new ArgumentException("train command");
                            if (c.TrainOptions.Length > 3) throw new ArgumentException("train options");
                            w.U8(c.TrainCommand); w.Varint(c.TrainId); w.U64(c.TrainCount); w.U8((byte)c.TrainOptions.Length);
                            foreach (byte o in c.TrainOptions) w.U8(o);
                            break;
                        case CommandKind.Cast:
                            if (!c.Slot.HasValue || c.Slot.Value > 2) throw new ArgumentException("cast slot");
                            if (float.IsNaN(c.X) || float.IsInfinity(c.X) || float.IsNaN(c.Y) || float.IsInfinity(c.Y) || (c.T.HasValue && (double.IsNaN(c.T.Value) || double.IsInfinity(c.T.Value)))) throw new ArgumentException("cast values must be finite");
                            w.U8(c.Slot ?? 0); w.F32(c.X); w.F32(c.Y);
                            w.U8(c.ActorRef != 0 ? (byte)1 : (byte)0); if (c.ActorRef != 0) w.U32(c.ActorRef);
                            if (c.T.HasValue) { w.U8(1); w.F64(c.T.Value); } else w.U8(0);
                            Opt(w, c.Seq);
                            break;
                        case CommandKind.QuestAccept:
                            if (!c.QuestRef.IsValid) throw new ArgumentException("quest handle");
                            w.Varint(c.QuestRef.Value);
                            break;
                        case CommandKind.Trade:
                            if ((byte)c.TradeKind > (byte)TradeKind.Stats || c.Pick < 0 || c.Pick > 2) throw new ArgumentException("trade choice");
                            w.U8((byte)c.TradeKind); w.U8((byte)c.Pick);
                            break;
                    }
                }
                return w.Finish();
            }

            static void Opt(Writer w, byte? v) { if (v.HasValue) { w.U8(1); w.U8(v.Value); } else w.U8(0); }

            static int CommandLength(WireCommand c)
            {
                switch (c.Kind)
                {
                    case CommandKind.Swap: return c.Slot.HasValue ? 3 : 2;
                    case CommandKind.Pickup: return 5;
                    case CommandKind.Choose: return 6;
                    case CommandKind.Plan: return 2 + (c.Spawn.HasValue ? 1 : 0) + (c.Boon.HasValue ? 1 : 0) + (c.Ready.HasValue ? 1 : 0);
                    case CommandKind.UseConsumable: return 1;
                    case CommandKind.Target: return 5;
                    case CommandKind.HuntTarget: return 5;
                    case CommandKind.ConsumeCorpse: return 5;
                    case CommandKind.AttackMove:
                    case CommandKind.Move: return 9 + (c.Seq.HasValue ? 2 : 1);
                    case CommandKind.MoveAt:
                    case CommandKind.AttackMoveAt: return 9 + (c.Seq.HasValue ? 2 : 1) + 8;
                    case CommandKind.Stop: return 1 + (c.Seq.HasValue ? 2 : 1);
                    case CommandKind.Aim: return 5;
                    case CommandKind.Attack:
                    case CommandKind.Release: return 5 + (c.T.HasValue ? 9 : 1);
                    case CommandKind.Train: return 3 + Writer.VarintLength(c.TrainId) + 8 + c.TrainOptions.Length;
                    case CommandKind.Cast: return 13 + (c.ActorRef != 0 ? 4 : 0) + (c.T.HasValue ? 8 : 0) + (c.Seq.HasValue ? 1 : 0);
                    case CommandKind.QuestAccept: return 1 + Writer.VarintLength(c.QuestRef.Value);
                    case CommandKind.Trade: return 3;
                    default: throw new ArgumentException("command kind");
                }
            }
        }

        public sealed class Ping : ClientMsg
        {
            public uint Nonce;
            public double ClientMs;
            public override byte[] Encode() { var w = new Writer(13); w.U8(TPing); w.U32(Nonce); w.F64(ClientMs); return w.Finish(); }
        }

        public sealed class Leave : ClientMsg
        {
            public override byte[] Encode() { return new[] { TLeave }; }
        }

        /// <summary>"Send me a full snapshot": the client refused a delta it could not apply (v3). The server honours one per second.</summary>
        public sealed class Resync : ClientMsg
        {
            public override byte[] Encode() { return new[] { TResync }; }
        }
    }

    /// <summary>The receiving player's own state. A class on purpose: <c>Snapshot.Me</c> is null for a spectator.</summary>
    public sealed class WireSelf
    {
        public uint Id;
        public byte Faction;
        public float X, Y, Facing, Hp, MaxHp;
        public byte Status, Weapon;
        public ushort ReadyInMs, Kills, Bounty, Gv;
        public byte MoveSeq, DisplaceSeq, Sig;
        public ushort Effects;
        public uint? HuntTarget;
        public ushort HuntStacks;
        /// <summary>Optional authoritative Wish owner record. Null means no owner publication is present.</summary>
        public WireWishOwner Wish;
        /// <summary>Authoritative owner barrier amount.</summary>
        public float Barrier;
        /// <summary>Authoritative owner barrier ring step (0..8).</summary>
        public byte BarrierRingStep;

        internal void CopyFrom(WireSelf o)
        {
            Id = o.Id; Faction = o.Faction; X = o.X; Y = o.Y; Facing = o.Facing; Hp = o.Hp; MaxHp = o.MaxHp; Status = o.Status; Weapon = o.Weapon;
            ReadyInMs = o.ReadyInMs; Kills = o.Kills; Bounty = o.Bounty; Gv = o.Gv; MoveSeq = o.MoveSeq; Effects = o.Effects; DisplaceSeq = o.DisplaceSeq; Sig = o.Sig;
            HuntTarget = o.HuntTarget; HuntStacks = o.HuntStacks;
            if (o.Wish == null) Wish = null;
            else { if (Wish == null) Wish = new WireWishOwner(); Wish.CopyFrom(o.Wish); }
            Barrier = o.Barrier; BarrierRingStep = o.BarrierRingStep;
        }

        // Head bits (rh-protocol lib.rs, append only): a varint, so bits below 7 take one byte.
        internal const uint HPresent = 1 << 0, HKit = 1 << 1, HHp = 1 << 2, HReady = 1 << 3, HKills = 1 << 4, HBounty = 1 << 5,
            HMoveSeq = 1 << 6, HGv = 1 << 7, HMaxHpF32 = 1 << 8, HStatus = 1 << 9, HPhase = 1 << 10, HEffects = 1 << 11, HDisplace = 1 << 12, HSig = 1 << 13,
            HHuntTarget = 1 << 14, HHuntStacks = 1 << 15, HTraining = 1 << 16, HWish = 1 << 17, HBarrier = 1 << 18, HServerTime = 1 << 19, HOwnerCombat = 1 << 20;
        internal const uint SelfBits = 0x03ff | HEffects | HDisplace | HSig | HHuntTarget | HHuntStacks, Known = SelfBits | HPhase | HTraining | HWish | HBarrier | HServerTime | HOwnerCombat;

        static bool MaxHpIsVarint(float v)
        {
            if (!(v >= 0f && v <= 65535f)) return false;
            return BitConverter.SingleToInt32Bits(v) == BitConverter.SingleToInt32Bits((float)(ushort)v);
        }

        internal static byte Kit(byte faction, byte weapon) { return (byte)((faction & 0x0f) | (weapon << 4)); }

        /// <summary>The head of a Snapshot: the present bit and every field that differs from its default (this is the self), and the phase bit when the phase is not the default.</summary>
        internal uint Head(byte phase)
        {
            uint m = HPresent;
            if (phase != Wire.DefaultPhase) m |= HPhase;
            if (Kit(Faction, Weapon) != 0) m |= HKit;
            if (BitConverter.SingleToInt32Bits(Hp) != BitConverter.SingleToInt32Bits(MaxHp)) m |= HHp;
            if (ReadyInMs != 0) m |= HReady;
            if (Kills != 0) m |= HKills;
            if (Bounty != 0) m |= HBounty;
            if (Gv != 0) m |= HGv;
            if (MoveSeq != 0) m |= HMoveSeq;
            if (!MaxHpIsVarint(MaxHp)) m |= HMaxHpF32;
            if (Status != Wire.DefaultStatus) m |= HStatus;
            if (Effects != 0) m |= HEffects;
            if (DisplaceSeq != 0) m |= HDisplace;
            if (Sig != 0) m |= HSig;
            if (HuntTarget.HasValue) m |= HHuntTarget;
            if (HuntStacks != 0) m |= HHuntStacks;
            if (Wish != null) m |= HWish;
            if (BitConverter.SingleToInt32Bits(Barrier) != BitConverter.SingleToInt32Bits(0f) || BarrierRingStep != 0) m |= HBarrier;
            return m;
        }

        /// <summary>Bytes of the head itself, with the phase byte that follows the self when the head has the phase bit.</summary>
        internal static int HeadLength(uint head) { return Writer.VarintLength(head) + ((head & HPhase) != 0 ? 1 : 0); }

        /// <summary>Bytes of the self record after the head.</summary>
        internal int Length(uint head)
        {
            int n = Writer.VarintLength(Id) + 12;
            n += (head & HMaxHpF32) != 0 ? 4 : Writer.VarintLength((uint)MaxHp);
            if ((head & HKit) != 0) n += 1;
            if ((head & HHp) != 0) n += 4;
            if ((head & HReady) != 0) n += 2;
            if ((head & HKills) != 0) n += Writer.VarintLength(Kills);
            if ((head & HBounty) != 0) n += Writer.VarintLength(Bounty);
            if ((head & HMoveSeq) != 0) n += 1;
            if ((head & HGv) != 0) n += Writer.VarintLength(Gv);
            if ((head & HStatus) != 0) n += 1;
            if ((head & HEffects) != 0) n += 2;
            if ((head & HDisplace) != 0) n += 1;
            if ((head & HSig) != 0) n += 1;
            if (HuntTarget.HasValue) n += Writer.VarintLength(HuntTarget.Value);
            if ((head & HHuntStacks) != 0) n += Writer.VarintLength(HuntStacks);
            if ((head & HWish) != 0) n += WireWishOwnerLength(Wish);
            if ((head & HBarrier) != 0) n += 5;
            return n;
        }

        static int WireWishOwnerLength(WireWishOwner v)
        {
            WishWire.ValidateOwner(v);
            return 1 + 8 + (v.FullAt.HasValue ? 9 : 1) + 1 + 8 + 1 + (v.NextChargeAt.HasValue ? 9 : 1) + 1 + (v.Cast == null ? 0 : 17);
        }

        /// <summary>Reads the self after its head (<paramref name="head"/> has HPresent set); the phase, if the head has one, is the caller's.</summary>
        internal void Read(ref Reader r, uint head)
        {
            Id = r.Varint(); X = r.F32(); Y = r.F32(); Facing = r.F32();
            MaxHp = (head & HMaxHpF32) != 0 ? r.F32() : r.VarintU16("max_hp");
            if ((head & HKit) != 0) { byte k = r.U8(); Faction = (byte)(k & 0x0f); Weapon = (byte)(k >> 4); } else { Faction = 0; Weapon = 0; }
            Hp = (head & HHp) != 0 ? r.F32() : MaxHp;
            ReadyInMs = (head & HReady) != 0 ? r.U16() : (ushort)0;
            Kills = (head & HKills) != 0 ? r.VarintU16("kills") : (ushort)0;
            Bounty = (head & HBounty) != 0 ? r.VarintU16("bounty") : (ushort)0;
            MoveSeq = (head & HMoveSeq) != 0 ? r.U8() : (byte)0;
            Gv = (head & HGv) != 0 ? r.VarintU16("gv") : (ushort)0;
            Status = (head & HStatus) != 0 ? r.Code(Wire.MaxStatusCode, "status") : Wire.DefaultStatus;
            Effects = (head & HEffects) != 0 ? r.U16() : (ushort)0;
            DisplaceSeq = (head & HDisplace) != 0 ? r.U8() : (byte)0;
            Sig = (head & HSig) != 0 ? r.U8() : (byte)0;
            if ((head & HHuntTarget) != 0) { uint t = r.Varint(); if (t == 0) throw new DecodeException(DecodeError.BadField, "hunt target"); HuntTarget = t; } else HuntTarget = null;
            HuntStacks = (head & HHuntStacks) != 0 ? r.VarintU16("hunt_stacks") : (ushort)0;
            Wish = (head & HWish) != 0 ? WishWire.ReadOwner(ref r, Wish) : null;
            if ((head & HBarrier) != 0) { Barrier = r.F32(); BarrierRingStep = r.U8(); }
            else { Barrier = 0f; BarrierRingStep = 0; }
            if (Barrier < 0 || float.IsNaN(Barrier) || float.IsInfinity(Barrier) || BarrierRingStep > 8)
                throw new DecodeException(DecodeError.BadField, "barrier");
        }

        internal void Write(Writer w, uint head)
        {
            w.Varint(Id); w.F32(X); w.F32(Y); w.F32(Facing);
            if ((head & HMaxHpF32) != 0) w.F32(MaxHp); else w.Varint((uint)MaxHp);
            if ((head & HKit) != 0) w.U8(Kit(Faction, Weapon));
            if ((head & HHp) != 0) w.F32(Hp);
            if ((head & HReady) != 0) w.U16(ReadyInMs);
            if ((head & HKills) != 0) w.Varint(Kills);
            if ((head & HBounty) != 0) w.Varint(Bounty);
            if ((head & HMoveSeq) != 0) w.U8(MoveSeq);
            if ((head & HGv) != 0) w.Varint(Gv);
            if ((head & HStatus) != 0) w.U8(Status);
            if ((head & HEffects) != 0) w.U16(Effects);
            if ((head & HDisplace) != 0) w.U8(DisplaceSeq);
            if ((head & HSig) != 0) w.U8(Sig);
            if (HuntTarget.HasValue) w.Varint(HuntTarget.Value);
            if ((head & HHuntStacks) != 0) w.Varint(HuntStacks);
            if ((head & HWish) != 0) WishWire.WriteOwner(w, Wish);
            if ((head & HBarrier) != 0) { WishWire.ValidateBarrier(Barrier, BarrierRingStep); w.F32(Barrier); w.U8(BarrierRingStep); }
        }
    }

    /// <summary>Server-published stock and timing facts for the receiving player's Wish.</summary>
    public sealed class WireWishOwner
    {
        public byte Ability;
        public double ReadyAt, RechargeMs;
        public double? FullAt, NextChargeAt;
        public byte MaxCharges, Charges;
        public WireWishCast Cast;

        internal void CopyFrom(WireWishOwner o)
        {
            Ability = o.Ability; ReadyAt = o.ReadyAt; FullAt = o.FullAt; MaxCharges = o.MaxCharges;
            RechargeMs = o.RechargeMs; Charges = o.Charges; NextChargeAt = o.NextChargeAt;
            if (o.Cast == null) Cast = null;
            else { if (Cast == null) Cast = new WireWishCast(); Cast.CopyFrom(o.Cast); }
        }
    }

    /// <summary>Public authoritative identity and deadlines of the currently active Wish cast.</summary>
    public sealed class WireWishCast
    {
        public byte Ability;
        public double StartedAt, LandsAt;

        internal void CopyFrom(WireWishCast o) { Ability = o.Ability; StartedAt = o.StartedAt; LandsAt = o.LandsAt; }
    }

    /// <summary>Field validation and shared wire primitives for protocol-12 Wish and barrier facts.</summary>
    internal static class WishWire
    {
        internal const byte MaxAbility = 4, BlazeAbility = 3;

        static bool Clock(double v) { return v >= 0 && !double.IsNaN(v) && !double.IsInfinity(v); }
        static bool Amount(float v) { return v >= 0 && !float.IsNaN(v) && !float.IsInfinity(v); }
        internal static void ValidateOwner(WireWishOwner v)
        {
            if (v == null || v.Ability > MaxAbility || !Clock(v.ReadyAt) || (v.FullAt.HasValue && !Clock(v.FullAt.Value)) ||
                v.MaxCharges < 1 || v.MaxCharges > 2 || !Clock(v.RechargeMs) || v.Charges > v.MaxCharges ||
                (v.NextChargeAt.HasValue && !Clock(v.NextChargeAt.Value))) throw new ArgumentException("wish owner fields");
            if (v.Cast != null && (v.Cast.Ability > MaxAbility || !Clock(v.Cast.StartedAt) || !Clock(v.Cast.LandsAt) || v.Cast.StartedAt > v.Cast.LandsAt))
                throw new ArgumentException("wish cast fields");
        }
        internal static void ValidateBarrier(float barrier, byte ring)
        {
            if (!Amount(barrier) || ring > 8) throw new ArgumentException("barrier");
        }
        internal static void ValidateClock(double time, string what)
        {
            if (!Clock(time)) throw new ArgumentException(what);
        }
        internal static void WriteOwner(Writer w, WireWishOwner v)
        {
            ValidateOwner(v);
            w.U8(v.Ability); w.F64(v.ReadyAt); OptF64(w, v.FullAt); w.U8(v.MaxCharges); w.F64(v.RechargeMs); w.U8(v.Charges);
            OptF64(w, v.NextChargeAt);
            w.U8(v.Cast == null ? (byte)0 : (byte)1);
            if (v.Cast != null) { w.U8(v.Cast.Ability); w.F64(v.Cast.StartedAt); w.F64(v.Cast.LandsAt); }
        }
        internal static WireWishOwner ReadOwner(ref Reader r, WireWishOwner reuse = null)
        {
            var v = reuse ?? new WireWishOwner();
            v.Ability = r.Code(MaxAbility, "wish ability"); v.ReadyAt = r.F64();
            v.FullAt = r.Flag() ? r.F64() : (double?)null;
            v.MaxCharges = r.U8(); v.RechargeMs = r.F64(); v.Charges = r.U8();
            v.NextChargeAt = r.Flag() ? r.F64() : (double?)null;
            if (r.Flag())
            {
                if (v.Cast == null) v.Cast = new WireWishCast();
                v.Cast.Ability = r.Code(MaxAbility, "wish cast ability"); v.Cast.StartedAt = r.F64(); v.Cast.LandsAt = r.F64();
            }
            else v.Cast = null;
            if (!Clock(v.ReadyAt) || (v.FullAt.HasValue && !Clock(v.FullAt.Value)) || v.MaxCharges < 1 || v.MaxCharges > 2 ||
                !Clock(v.RechargeMs) || v.Charges > v.MaxCharges || (v.NextChargeAt.HasValue && !Clock(v.NextChargeAt.Value)) ||
                (v.Cast != null && (!Clock(v.Cast.StartedAt) || !Clock(v.Cast.LandsAt) || v.Cast.StartedAt > v.Cast.LandsAt)))
                throw new DecodeException(DecodeError.BadField, "wish owner");
            return v;
        }
        internal static void WritePoint(Writer w, float x, float y)
        {
            if (!Quant.PosInRange(x) || !Quant.PosInRange(y)) throw new ArgumentException("position");
            w.U16(Quant.QuantizePos(x)); w.U16(Quant.QuantizePos(y));
        }
        internal static void ReadPoint(ref Reader r, out float x, out float y)
        {
            x = Quant.DequantizePos(r.U16()); y = Quant.DequantizePos(r.U16());
        }
        internal static void OptF64(Writer w, double? v) { if (v.HasValue) { w.U8(1); w.F64(v.Value); } else w.U8(0); }
    }

    /// <summary>Authoritative owner lock. Held targets are public actor references, never raw native IDs.</summary>
    public enum WireOwnerLockKind : byte { Clear = 0, Held = 1 }

    public struct WireOwnerLock
    {
        public WireOwnerLockKind Kind;
        public uint? Target;
    }

    /// <summary>Exact server-published owner combat facts; no readiness or weapon timing is derived client-side.</summary>
    public sealed class WireOwnerCombat
    {
        public WireOwnerLock Lock;
        public uint DrawStartedAt, ReadyAt;
        public double AsMilli, WindupMilli, SpeedMilli;

        internal void CopyFrom(WireOwnerCombat o)
        {
            Lock = o.Lock; DrawStartedAt = o.DrawStartedAt; ReadyAt = o.ReadyAt;
            AsMilli = o.AsMilli; WindupMilli = o.WindupMilli; SpeedMilli = o.SpeedMilli;
        }

    }

    internal static class OwnerCombatWire
    {
        static bool ValidMultiplier(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value) && value >= 50d && Math.Truncate(value) == value;
        }

        internal static void Validate(WireOwnerCombat value)
        {
            if (value == null || (byte)value.Lock.Kind > (byte)WireOwnerLockKind.Held ||
                (value.Lock.Kind == WireOwnerLockKind.Clear && value.Lock.Target.HasValue) ||
                (value.Lock.Target.HasValue && value.Lock.Target.Value == 0) ||
                !ValidMultiplier(value.AsMilli) || !ValidMultiplier(value.WindupMilli) || !ValidMultiplier(value.SpeedMilli))
                throw new ArgumentException("owner combat");
        }

        internal static int Length(WireOwnerCombat value)
        {
            Validate(value);
            return 1 + (value.Lock.Kind == WireOwnerLockKind.Held && value.Lock.Target.HasValue ? Writer.VarintLength(value.Lock.Target.Value) : 0) + 8 * 3 + 4 * 2;
        }

        internal static void Write(Writer w, WireOwnerCombat value)
        {
            Validate(value);
            byte lockTag = value.Lock.Kind == WireOwnerLockKind.Clear ? (byte)0 : value.Lock.Target.HasValue ? (byte)2 : (byte)1;
            w.U8(lockTag);
            if (lockTag == 2) w.Varint(value.Lock.Target.Value);
            w.U32(value.DrawStartedAt); w.U32(value.ReadyAt);
            w.F64(value.AsMilli); w.F64(value.WindupMilli); w.F64(value.SpeedMilli);
        }

        internal static WireOwnerCombat Read(ref Reader r, WireOwnerCombat reuse = null)
        {
            var value = reuse ?? new WireOwnerCombat();
            byte tag = r.U8();
            if (tag > 2) throw new DecodeException(DecodeError.BadField, "owner combat lock");
            value.Lock.Kind = tag == 0 ? WireOwnerLockKind.Clear : WireOwnerLockKind.Held;
            value.Lock.Target = tag == 2 ? (uint?)r.Varint() : (uint?)null;
            value.DrawStartedAt = r.U32(); value.ReadyAt = r.U32();
            value.AsMilli = r.F64(); value.WindupMilli = r.F64(); value.SpeedMilli = r.F64();
            if ((tag == 2 && value.Lock.Target == 0) || !ValidMultiplier(value.AsMilli) || !ValidMultiplier(value.WindupMilli) || !ValidMultiplier(value.SpeedMilli))
                throw new DecodeException(DecodeError.BadField, "owner combat");
            return value;
        }
    }

    /// <summary>
    /// Protocol 15: a visible remote actor's bow draw or wand cast in progress (presentation only; melee is never published).
    /// <see cref="Kind"/> 0 = none. All times are server sim milliseconds on the same timeline as tick * 50. A draw has no aim
    /// on the wire (<see cref="Aim"/> = 0); a cast carries the full 16-bit signed-turn code of its start aim.
    /// </summary>
    public struct WireWindup
    {
        public const byte None = 0, Draw = 1, Cast = 2;
        public byte Kind;
        public ushort Duration, Aim;
        /// <summary>Server ms the windup began (floored).</summary>
        public uint StartedAt;
        public bool Active { get { return Kind != None; } }
        /// <summary>Server ms of the release (StartedAt + Duration; a long double cannot overflow).</summary>
        public double ReleaseAt { get { return (double)StartedAt + Duration; } }
        /// <summary>The cast's start aim in radians (0 for a draw).</summary>
        public float AimRadians { get { return Quant.DequantizeFacing(Aim); } }
        /// <summary>Fraction of the windup elapsed at <paramref name="serverMs"/>, clamped to 0..1 (0 when none or zero length).</summary>
        public float Progress(double serverMs)
        {
            if (Kind == None || Duration == 0) return 0f;
            double f = (serverMs - StartedAt) / Duration;
            return f <= 0 ? 0f : f >= 1 ? 1f : (float)f;
        }

        internal static WireWindup Read(ref Reader r, bool allowNone)
        {
            byte kind = r.U8();
            var w = default(WireWindup);
            if (kind == None && allowNone) return w;
            if (kind != Draw && kind != Cast) throw new DecodeException(DecodeError.BadField, "windup");
            w.Kind = kind; w.StartedAt = r.Varint();
            uint duration = r.Varint();
            if (duration > ushort.MaxValue) throw new DecodeException(DecodeError.BadField, "windup");
            w.Duration = (ushort)duration;
            if (kind == Cast) w.Aim = r.U16();
            return w;
        }

        internal int Length(bool allowNone)
        {
            if (Kind == None) return allowNone ? 1 : 0;
            return 1 + Writer.VarintLength(StartedAt) + Writer.VarintLength(Duration) + (Kind == Cast ? 2 : 0);
        }

        internal void Write(Writer w, bool allowNone)
        {
            if (Kind > Cast || (Kind == None && !allowNone) || (Kind == Draw && Aim != 0)) throw new ArgumentException("windup");
            w.U8(Kind);
            if (Kind == None) return;
            w.Varint(StartedAt); w.Varint(Duration);
            if (Kind == Cast) w.U16(Aim);
        }
    }

    /// <summary>
    /// One visible actor. A value type: a snapshot's actors live inline in its array (no object per actor). The fields are
    /// declared widest first so the struct packs into 28 bytes (including v6 effects/displacement; v7 hunt fields); the wire order is fixed by <see cref="Read"/>/<see cref="Write"/>.
    /// X, Y and Facing are what the wire carries (quantized to 1/8 u and 2 pi / 65536).
    /// </summary>
    public struct WireActor
    {
        public uint Id;
        public float X, Y, Facing;
        /// <summary>Windup start (server ms); the rest of the windup is <see cref="WindupDuration"/>, <see cref="WindupAim"/>, <see cref="WindupKind"/>. Flat so the actor stays a small value.</summary>
        public uint WindupStartedAt;
        public ushort Bounty;
        public ushort WindupDuration, WindupAim;
        public byte Faction;
        /// <summary>hp fraction in hundredths (0..100).</summary>
        public byte HpPct;
        public byte Status, Weapon;
        /// <summary>What the entity is: 0 = player (the default; costs no byte). The id namespace is shared by every kind.</summary>
        public byte Kind, DisplaceSeq, MobTypeCode, Sig;
        public ushort Effects;
        /// <summary>Authoritative per-observer barrier share.</summary>
        public byte BarrierPct, BarrierRingStep;
        /// <summary>Protocol 15: 0 none, 1 bow draw, 2 wand cast (see <see cref="Windup"/>).</summary>
        public byte WindupKind;
        /// <summary>Protocol 15: the bow draw or wand cast in progress, if any (Kind 0 = none).</summary>
        public WireWindup Windup
        {
            get { return new WireWindup { Kind = WindupKind, StartedAt = WindupStartedAt, Duration = WindupDuration, Aim = WindupAim }; }
            set { WindupKind = value.Kind; WindupStartedAt = value.StartedAt; WindupDuration = value.Duration; WindupAim = value.Aim; }
        }

        // Full actor mask bits (append only): 0 kit, 1 hp, 2 status, 3 bounty, 4 kind, ... 9 barrier, 10 windup (v15). A varint.
        internal const uint MKit = 1 << 0, MHp = 1 << 1, MStatus = 1 << 2, MBounty = 1 << 3, MKind = 1 << 4, MEffects = 1 << 5, MDisplace = 1 << 6, MMobType = 1 << 7, MSig = 1 << 8, MBarrier = 1 << 9, MWindup = 1 << 10, MKnown = MKit | MHp | MStatus | MBounty | MKind | MEffects | MDisplace | MMobType | MSig | MBarrier | MWindup;
        internal const byte DefaultHpPct = 100;

        /// <summary>Only native quest givers use the reserved absent-identity kit and carry no regional type.</summary>
        internal bool HasValidGiverIdentity
        {
            get { return Kind != 4 || (Faction == 15 && Weapon == 15 && MobTypeCode == 0); }
        }

        internal uint Mask()
        {
            uint m = 0;
            if (WireSelf.Kit(Faction, Weapon) != 0) m |= MKit;
            if (HpPct != DefaultHpPct) m |= MHp;
            if (Status != Wire.DefaultStatus) m |= MStatus;
            if (Bounty != 0) m |= MBounty;
            if (Kind != 0) m |= MKind;
            if (Effects != 0) m |= MEffects;
            if (DisplaceSeq != 0) m |= MDisplace;
            if (MobTypeCode > 30) throw new ArgumentException("mob type");
            if (MobTypeCode != 0) m |= MMobType;
            if (Sig != 0) m |= MSig;
            if (BarrierPct != 0 || BarrierRingStep != 0) m |= MBarrier;
            if (WindupKind != 0) m |= MWindup;
            return m;
        }

        internal static uint IdField(uint id, bool first, uint prev) { return first ? id : unchecked(id - prev); }

        internal int Length(bool first, uint prev)
        {
            uint m = Mask();
            return Writer.VarintLength(IdField(Id, first, prev)) + Writer.VarintLength(m) + 6 + ((m & MKit) != 0 ? 1 : 0) + ((m & MHp) != 0 ? 1 : 0)
                + ((m & MStatus) != 0 ? 1 : 0) + ((m & MBounty) != 0 ? Writer.VarintLength(Bounty) : 0) + ((m & MKind) != 0 ? 1 : 0) + ((m & MEffects) != 0 ? 2 : 0) + ((m & MDisplace) != 0 ? 1 : 0) + ((m & MMobType) != 0 ? 1 : 0) + ((m & MSig) != 0 ? 1 : 0) + ((m & MBarrier) != 0 ? 2 : 0) + ((m & MWindup) != 0 ? Windup.Length(false) : 0);
        }

        /// <summary>Reads one actor; the first has an absolute id, each later one the (non-zero) gap from <paramref name="prev"/>.</summary>
        internal static WireActor Read(ref Reader r, bool first, uint prev)
        {
            WireActor a = default(WireActor);
            uint field = r.Varint();
            if (first) a.Id = field;
            else
            {
                ulong id = (ulong)prev + field;
                if (field == 0 || id > uint.MaxValue) throw new DecodeException(DecodeError.BadField, "actor order");
                a.Id = (uint)id;
            }
            uint mask = r.Varint();
            if ((mask & ~MKnown) != 0) throw new DecodeException(DecodeError.BadField, "actor mask");
            a.X = Quant.DequantizePos(r.U16()); a.Y = Quant.DequantizePos(r.U16()); a.Facing = Quant.DequantizeFacing(r.U16());
            if ((mask & MKit) != 0) { byte k = r.U8(); a.Faction = (byte)(k & 0x0f); a.Weapon = (byte)(k >> 4); } else { a.Faction = 0; a.Weapon = 0; }
            a.HpPct = (mask & MHp) != 0 ? r.U8() : DefaultHpPct;
            if (a.HpPct > 100) throw new DecodeException(DecodeError.BadField, "hp_pct");
            a.Status = (mask & MStatus) != 0 ? r.Code(Wire.MaxStatusCode, "status") : Wire.DefaultStatus;
            a.Bounty = (mask & MBounty) != 0 ? r.VarintU16("bounty") : (ushort)0;
            a.Kind = (mask & MKind) != 0 ? r.U8() : (byte)0;
            a.Effects = (mask & MEffects) != 0 ? r.U16() : (ushort)0;
            a.DisplaceSeq = (mask & MDisplace) != 0 ? r.U8() : (byte)0;
            a.MobTypeCode = (mask & MMobType) != 0 ? r.Code(30,"mob type") : (byte)0;
            a.Sig = (mask & MSig) != 0 ? r.U8() : (byte)0;
            if ((mask & MBarrier) != 0) { a.BarrierPct = r.U8(); a.BarrierRingStep = r.U8(); }
            if (a.BarrierPct > 100 || a.BarrierRingStep > 8) throw new DecodeException(DecodeError.BadField, "barrier");
            if ((mask & MWindup) != 0) a.Windup = WireWindup.Read(ref r, false);
            if (!a.HasValidGiverIdentity) throw new DecodeException(DecodeError.BadField, "giver actor");
            return a;
        }

        internal void Write(Writer w, bool first, uint prev)
        {
            uint m = Mask();
            w.Varint(IdField(Id, first, prev)); w.Varint(m);
            w.U16(Quant.QuantizePos(X)); w.U16(Quant.QuantizePos(Y)); w.U16(Quant.QuantizeFacing(Facing));
            if ((m & MKit) != 0) w.U8(WireSelf.Kit(Faction, Weapon));
            if ((m & MHp) != 0) w.U8(HpPct);
            if ((m & MStatus) != 0) w.U8(Status);
            if ((m & MBounty) != 0) w.Varint(Bounty);
            if ((m & MKind) != 0) w.U8(Kind);
            if ((m & MEffects) != 0) w.U16(Effects);
            if ((m & MDisplace) != 0) w.U8(DisplaceSeq);
            if ((m & MMobType) != 0) w.U8(MobTypeCode);
            if ((m & MSig) != 0) w.U8(Sig);
            if ((m & MBarrier) != 0) { if (BarrierPct > 100 || BarrierRingStep > 8) throw new ArgumentException("barrier"); w.U8(BarrierPct); w.U8(BarrierRingStep); }
            if ((m & MWindup) != 0) Windup.Write(w, false);
        }
    }

    /// <summary>
    /// The changed self fields of a snapshot delta: <see cref="Mask"/> has the head's self field bits; only the fields whose bit is
    /// set mean anything. The self's id is the base's. Bit numbers are append only (rh-protocol delta.rs).
    /// </summary>
    public struct SelfDelta
    {
        public const uint FX = 1 << 1, FY = 1 << 2, FFacing = 1 << 3, FMoveSeq = 1 << 4, FHp = 1 << 5, FReady = 1 << 6,
            FMaxHp = 1 << 9, FKit = 1 << 10, FKills = 1 << 11, FBounty = 1 << 12, FGv = 1 << 13, FStatus = 1 << 14, FEffects = 1 << 15, FDisplace = 1 << 16, FSig = 1 << 17,
            FHuntTarget = 1 << 18, FHuntStacks = 1 << 19;
        /// <summary>The self field bits (never the present, departed or phase bits of the head).</summary>
        public const uint Fields = 0x7e7e | FEffects | FDisplace | FSig | FHuntTarget | FHuntStacks;
        public uint Mask;
        public float X, Y, Facing, Hp, MaxHp;
        public byte Kit;
        public ushort ReadyInMs, Kills, Bounty, Gv;
        public byte MoveSeq, DisplaceSeq, Sig;
        public ushort Effects;
        /// <summary>The new status (0..3) when <see cref="FStatus"/> is set in <see cref="Mask"/>.</summary>
        public byte StatusValue;
        public uint? HuntTarget;
        public ushort HuntStacks;

        internal static SelfDelta Read(ref Reader r, uint mask)
        {
            var s = new SelfDelta { Mask = mask };
            if ((mask & FX) != 0) s.X = r.F32();
            if ((mask & FY) != 0) s.Y = r.F32();
            if ((mask & FFacing) != 0) s.Facing = r.F32();
            if ((mask & FMoveSeq) != 0) s.MoveSeq = r.U8();
            if ((mask & FHp) != 0) s.Hp = r.F32();
            if ((mask & FReady) != 0) s.ReadyInMs = r.U16();
            if ((mask & FMaxHp) != 0) s.MaxHp = r.F32();
            if ((mask & FKit) != 0) s.Kit = r.U8();
            if ((mask & FKills) != 0) s.Kills = r.VarintU16("kills");
            if ((mask & FBounty) != 0) s.Bounty = r.VarintU16("bounty");
            if ((mask & FGv) != 0) s.Gv = r.VarintU16("gv");
            if ((mask & FStatus) != 0) s.StatusValue = r.Code(Wire.MaxStatusCode, "status");
            if ((mask & FEffects) != 0) s.Effects = r.U16();
            if ((mask & FDisplace) != 0) s.DisplaceSeq = r.U8();
            if ((mask & FSig) != 0) s.Sig = r.U8();
            if ((mask & FHuntTarget) != 0) { uint t = r.Varint(); s.HuntTarget = t == 0 ? (uint?)null : t; }
            if ((mask & FHuntStacks) != 0) s.HuntStacks = r.VarintU16("hunt_stacks");
            return s;
        }

        internal void Write(Writer w)
        {
            if ((Mask & FX) != 0) w.F32(X);
            if ((Mask & FY) != 0) w.F32(Y);
            if ((Mask & FFacing) != 0) w.F32(Facing);
            if ((Mask & FMoveSeq) != 0) w.U8(MoveSeq);
            if ((Mask & FHp) != 0) w.F32(Hp);
            if ((Mask & FReady) != 0) w.U16(ReadyInMs);
            if ((Mask & FMaxHp) != 0) w.F32(MaxHp);
            if ((Mask & FKit) != 0) w.U8(Kit);
            if ((Mask & FKills) != 0) w.Varint(Kills);
            if ((Mask & FBounty) != 0) w.Varint(Bounty);
            if ((Mask & FGv) != 0) w.Varint(Gv);
            if ((Mask & FStatus) != 0) w.U8(StatusValue);
            if ((Mask & FEffects) != 0) w.U16(Effects);
            if ((Mask & FDisplace) != 0) w.U8(DisplaceSeq);
            if ((Mask & FSig) != 0) w.U8(Sig);
            if ((Mask & FHuntTarget) != 0) { if (HuntTarget == 0) throw new ArgumentException("hunt target"); w.Varint(HuntTarget ?? 0); }
            if ((Mask & FHuntStacks) != 0) w.Varint(HuntStacks);
        }

        internal void ApplyTo(WireSelf s)
        {
            if ((Mask & FX) != 0) s.X = X;
            if ((Mask & FY) != 0) s.Y = Y;
            if ((Mask & FFacing) != 0) s.Facing = Facing;
            if ((Mask & FMoveSeq) != 0) s.MoveSeq = MoveSeq;
            if ((Mask & FHp) != 0) s.Hp = Hp;
            if ((Mask & FReady) != 0) s.ReadyInMs = ReadyInMs;
            if ((Mask & FMaxHp) != 0) s.MaxHp = MaxHp;
            if ((Mask & FKit) != 0) { s.Faction = (byte)(Kit & 0x0f); s.Weapon = (byte)(Kit >> 4); }
            if ((Mask & FKills) != 0) s.Kills = Kills;
            if ((Mask & FBounty) != 0) s.Bounty = Bounty;
            if ((Mask & FGv) != 0) s.Gv = Gv;
            if ((Mask & FStatus) != 0) s.Status = StatusValue;
            if ((Mask & FEffects) != 0) s.Effects = Effects;
            if ((Mask & FDisplace) != 0) s.DisplaceSeq = DisplaceSeq;
            if ((Mask & FSig) != 0) s.Sig = Sig;
            if ((Mask & FHuntTarget) != 0) s.HuntTarget = HuntTarget;
            if ((Mask & FHuntStacks) != 0) s.HuntStacks = HuntStacks;
        }
    }

    /// <summary>
    /// One changed remote actor of a snapshot delta (protocol 15 mask): <see cref="Mask"/> says which fields are carried; the
    /// others mean nothing. A NEW actor (not in the base) starts from the default actor and must carry its position
    /// (<see cref="MNew"/>) in absolute form. With <see cref="MStep"/> the carried X/Y are not positions: each holds one signed
    /// step in 1/8 u (an i8 widened to a 16-bit pattern, see <see cref="StepOf"/>) added to the base actor's grid code.
    /// <see cref="Facing"/> is a 16-bit code whose low byte is zero (the wire carries the high byte only).
    /// </summary>
    public struct ActorDelta
    {
        public const uint MX = 1 << 0, MY = 1 << 1, MFacing = 1 << 2, MStep = 1 << 3, MHp = 1 << 4, MBounty = 1 << 5, MStatus = 1 << 6,
            MKind = 1 << 7, MEffects = 1 << 8, MDisplace = 1 << 9, MMobType = 1 << 10, MSig = 1 << 11, MBarrier = 1 << 12, MWindup = 1 << 13, MKit = 1 << 14,
            MAll = 0x7fff, MNew = MX | MY | MFacing;
        public uint Id;
        public uint Mask;
        public ushort X, Y, Facing;
        public byte Kit, HpPct, Status, Kind, DisplaceSeq, MobTypeCode, Sig, BarrierPct, BarrierRingStep;
        public ushort Bounty, Effects;
        /// <summary>The windup after this delta; Kind 0 with <see cref="MWindup"/> set means it ended.</summary>
        public WireWindup Windup;

        /// <summary>The signed step an X/Y field holds under <see cref="MStep"/>.</summary>
        public static int StepOf(ushort field) { return unchecked((short)field); }
        internal static byte StepByte(ushort field) { int v = StepOf(field); if (v < -128 || v > 127) throw new ArgumentException("position step"); return unchecked((byte)(sbyte)v); }
        /// <summary>A step (-128..127) as the X/Y field value.</summary>
        public static ushort FieldOfStep(int step) { if (step < -128 || step > 127) throw new ArgumentOutOfRangeException(nameof(step)); return unchecked((ushort)(short)step); }
    }

    public enum EventKind : byte { Death = 1, Bounty = 2, MatchEnded = 3, Result = 4, PickupRefused = 5, ChestRefused = 6, PotionNotice = 7, WindEmblem = 8, CannonNotice = 9, Toast = 10 }

    /// <summary>Reliable, ordered events. Only the fields of its Kind are meaningful.</summary>
    public sealed class WireEvent
    {
        public EventKind Kind;
        public uint Id;
        public uint? By;
        public ushort Bounty;
        public uint? Winner;
        public bool Draw;
        public WireResult Result;
        public byte PickupReason, ChestReason, PotionNotice, CannonCode;
        public ushort? CannonSeconds;
        public string ToastText;
    }

    public sealed class WireResult
    {
        public byte Outcome, Place, Players;
        public ushort Kills;
        public string KilledBy;
        public uint GvTotal, GvWin, DurationSec;
        public bool WinBonusWithheld;
    }

    public enum FxKind : byte { Swing = 1, Hit = 2, Block = 3, Stagger = 4, Teleport = 5, WishStarted = 6, WishLanded = 7, WishEnded = 8 }

    public sealed class WireFx
    {
        public FxKind Kind;
        public uint By, Victim;
        public uint Id;
        public bool Passive;
        public byte Weapon;
        public float X, Y, A, Amount;
        public double EventTime, Duration;
        public byte Ability, Reason;
        public uint? Caster, Target;
        public bool HasAnchor, HasDestination;
        public float AnchorX, AnchorY, DestinationX, DestinationY;
    }

    public abstract class ServerMsg
    {
        const byte TWelcome = 0x81, TReject = 0x82, TSnapshot = 0x83, TEvents = 0x84, TFx = 0x85, TPong = 0x86, TSnapshotDelta = 0x87, TState = 0x88;

        public abstract byte[] Encode();

        public static ServerMsg Decode(byte[] frame) { return Decode(frame, frame.Length, null); }

        /// <summary>Decodes the first <paramref name="length"/> bytes (transports may hand over a reused buffer).</summary>
        public static ServerMsg Decode(byte[] frame, int length) { return Decode(frame, length, null); }

        /// <summary>
        /// As <see cref="Decode(byte[], int)"/>, but a Snapshot frame is decoded INTO <paramref name="reuse"/> (when given) and
        /// returns it: its Me object and its actor array are reused when they fit, so a steady stream of snapshots makes no
        /// garbage. Pass only a snapshot nothing else still reads (SnapshotBuffer.TakeSpare hands out such one). Other frames
        /// ignore <paramref name="reuse"/>. If decoding throws, <paramref name="reuse"/> is left partly overwritten.
        /// </summary>
        public static ServerMsg Decode(byte[] frame, int length, Snapshot reuse)
        {
            if (length > Wire.MaxServerFrame) throw new DecodeException(DecodeError.TooLarge, length.ToString());
            var r = new Reader(frame, length);
            ServerMsg msg;
            switch (r.U8())
            {
                case TWelcome:
                    msg = new Welcome
                    {
                        Protocol = r.U16(), ContentHash = r.U64(), MatchId = r.Array16(), PlayerId = r.U32(), Session = r.Array16(),
                        TickRate = r.U8(), Tick = r.U32(), ServerMs = r.F64(), Map = MapBlob.Read(ref r),
                    };
                    break;
                case TReject:
                {
                    ushort code = r.U16();
                    if (code < 1) throw new DecodeException(DecodeError.BadTag, "reject code " + code);
                    msg = new Reject { Code = (RejectCode)code, Reason = r.Str() };
                    break;
                }
                case TSnapshot:
                    msg = Snapshot.Read(ref r, reuse ?? new Snapshot());
                    break;
                case TSnapshotDelta:
                    msg = SnapshotDelta.Read(ref r, new SnapshotDelta());
                    break;
                case TEvents:
                {
                    var e = new Events { Tick = r.U32() };
                    int n = r.U16();
                    for (int i = 0; i < n; i++)
                    {
                        byte tag = r.U8();
                        var ev = new WireEvent { Kind = (EventKind)tag };
                        switch (tag)
                        {
                            case 8: break;
                            case 5: ev.PickupReason = r.U8(); if (ev.PickupReason < 1 || ev.PickupReason > 5) throw new DecodeException(DecodeError.BadField, "pickup reason"); break;
                            case 7: ev.PotionNotice=r.U8(); if(ev.PotionNotice<1 || ev.PotionNotice>10) throw new DecodeException(DecodeError.BadField,"potion notice"); break;
                            case 6: ev.ChestReason = r.U8(); if(ev.ChestReason < 1 || ev.ChestReason > 9) throw new DecodeException(DecodeError.BadField,"chest reason");break;
                            case 9:
                                ev.CannonCode = r.U8();
                                if (ev.CannonCode < 1 || ev.CannonCode > 4) throw new DecodeException(DecodeError.BadField, "cannon notice");
                                if (ev.CannonCode == 4) { ev.CannonSeconds = r.U16(); if (ev.CannonSeconds < 1 || ev.CannonSeconds > 75) throw new DecodeException(DecodeError.BadField, "cannon notice"); }
                                break;
                            case 1: ev.Id = r.U32(); if (r.Flag()) ev.By = r.U32(); break;
                            case 2: ev.Id = r.U32(); ev.Bounty = r.U16(); break;
                            case 3: if (r.Flag()) ev.Winner = r.U32(); ev.Draw = r.U8() != 0; break;
                            case 10: ev.ToastText = r.Str(); break;
                            case 4:
                            {
                                var res = new WireResult { Outcome = r.U8(), Place = r.U8(), Players = r.U8(), Kills = r.U16() };
                                if (r.Flag()) res.KilledBy = r.Str();
                                res.GvTotal = r.U32(); res.GvWin = r.U32(); res.DurationSec = r.U32();
                                res.WinBonusWithheld = r.U8() != 0;
                                ev.Result = res;
                                break;
                            }
                            default: throw new DecodeException(DecodeError.BadTag, tag.ToString());
                        }
                        e.List.Add(ev);
                    }
                    msg = e;
                    break;
                }
                case TFx:
                {
                    var f = new Fx { Tick = r.Varint() };
                    uint n = r.Varint();
                    if (n > ushort.MaxValue) throw new DecodeException(DecodeError.TooMany, n.ToString());
                    for (uint i = 0; i < n; i++)
                    {
                        byte tag = r.U8();
                        switch (tag)
                        {
                            case 1:
                            {
                                var sw = new WireFx { Kind = FxKind.Swing, By = r.Varint(), Weapon = r.U8() };
                                sw.X = Quant.DequantizePos(r.U16()); sw.Y = Quant.DequantizePos(r.U16()); sw.A = Quant.DequantizeFacing(r.U16());
                                f.List.Add(sw);
                                break;
                            }
                            case 3: f.List.Add(new WireFx { Kind = FxKind.Block, Id = r.Varint(), By = r.Varint(), Weapon = r.U8() }); break;
                            case 4: f.List.Add(new WireFx { Kind = FxKind.Stagger, Id = r.Varint() }); break;
                            case 5: f.List.Add(new WireFx { Kind = FxKind.Teleport }); break;
                            case 2: { uint victim = r.Varint(), by = r.Varint(); f.List.Add(new WireFx { Kind = FxKind.Hit, Victim = victim, By = by, Amount = r.F32(), Passive = r.Flag() }); break; }
                            case 6:
                            {
                                var fx = new WireFx { Kind = FxKind.WishStarted, EventTime = r.F64(), Caster = Fx.ReadRequiredRef(ref r), Ability = r.Code(WishWire.MaxAbility, "wish ability"), Duration = r.F64() };
                                fx.Target = Fx.ReadOptionalRef(ref r);
                                fx.HasAnchor = r.Flag(); if (fx.HasAnchor) WishWire.ReadPoint(ref r, out fx.AnchorX, out fx.AnchorY);
                                Fx.ValidateStarted(fx, false); f.List.Add(fx); break;
                            }
                            case 7:
                            {
                                var fx = new WireFx { Kind = FxKind.WishLanded, EventTime = r.F64(), Ability = r.Code(WishWire.MaxAbility, "wish ability") };
                                fx.Caster = Fx.ReadOptionalRef(ref r); fx.Target = Fx.ReadOptionalRef(ref r);
                                fx.HasAnchor = r.Flag(); if (fx.HasAnchor) WishWire.ReadPoint(ref r, out fx.AnchorX, out fx.AnchorY);
                                fx.HasDestination = r.Flag(); if (fx.HasDestination) WishWire.ReadPoint(ref r, out fx.DestinationX, out fx.DestinationY);
                                Fx.ValidateLanded(fx, false); f.List.Add(fx); break;
                            }
                            case 8:
                            {
                                var fx = new WireFx { Kind = FxKind.WishEnded, EventTime = r.F64(), Caster = Fx.ReadRequiredRef(ref r), Ability = r.Code(WishWire.MaxAbility, "wish ability"), Reason = r.U8() };
                                Fx.ValidateEnded(fx, false); f.List.Add(fx); break;
                            }
                            default: throw new DecodeException(DecodeError.BadTag, tag.ToString());
                        }
                    }
                    msg = f;
                    break;
                }
                case TPong: msg = new Pong { Nonce = r.U32(), ClientMs = r.F64(), ServerMs = r.F64() }; break;
                case TState:
                {
                    var st = new State { Tick = r.Varint() };
                    st.Items = StateItem.ReadAll(ref r);
                    msg = st;
                    break;
                }
                default: throw new DecodeException(DecodeError.BadTag);
            }
            r.End();
            return msg;
        }

        public sealed class Welcome : ServerMsg
        {
            public ushort Protocol;
            public ulong ContentHash;
            public byte[] MatchId, Session;
            public uint PlayerId;
            public byte TickRate;
            public uint Tick;
            public double ServerMs;
            public MapBlob Map;

            public override byte[] Encode()
            {
                var w = new Writer(60 + Map.EncodedLength);
                w.U8(TWelcome); w.U16(Protocol); w.U64(ContentHash); w.Bytes(MatchId); w.U32(PlayerId); w.Bytes(Session);
                w.U8(TickRate); w.U32(Tick); w.F64(ServerMs);
                Map.Write(w);
                return w.Finish();
            }
        }

        public sealed class Reject : ServerMsg
        {
            public RejectCode Code;
            public string Reason = "";
            public override byte[] Encode() { var w = new Writer(); w.U8(TReject); w.U16((ushort)Code); w.Str(Reason); return w.Finish(); }
        }

        public sealed class Snapshot : ServerMsg
        {
            static bool ContainsActor(WireActor[] actors, uint id)
            {
                int lo = 0, hi = actors == null ? 0 : actors.Length;
                while (lo < hi)
                {
                    int mid = lo + ((hi - lo) >> 1);
                    if (actors[mid].Id == id) return true;
                    if (actors[mid].Id < id) lo = mid + 1; else hi = mid;
                }
                return false;
            }

            public uint Tick;
            public byte Phase;
            public uint AckInput;
            /// <summary>Null for a spectator (or a dead player's view without a self).</summary>
            public WireSelf Me;
            /// <summary>Sorted by id, strictly ascending (C-OBS; the wire needs it). Never null; shared empty array when nothing is visible.</summary>
            public WireActor[] Actors = Array.Empty<WireActor>();
            /// <summary>Owner-combat publication; null means unavailable for this frame.</summary>
            public WireOwnerCombat OwnerCombat;
            /// <summary>Protocol 11: the source's public training fact (head bit 16). False for every ordinary match.</summary>
            public bool Training;

            // A nullable double occupies 16 bytes on this runtime. Pack its presence into a byte and keep the value separately
            // so the new optional owner-combat reference does not increase every pooled Snapshot object's size.
            bool _hasServerTimeOverride;
            double _serverTimeOverrideMs;

            /// <summary>Optional per-frame authoritative source time in ms. Null encodes the canonical Tick * 50 default.</summary>
            public double? ServerTimeOverrideMs
            {
                get { return _hasServerTimeOverride ? _serverTimeOverrideMs : (double?)null; }
                set { _hasServerTimeOverride = value.HasValue; if (value.HasValue) _serverTimeOverrideMs = value.Value; }
            }

            /// <summary>The accepted source time for this frame, using Tick * 50 only when the frame has no override.</summary>
            public double ServerMs { get { return _hasServerTimeOverride ? _serverTimeOverrideMs : Tick * (double)Wire.TickMs; } }

            bool HasNonDefaultTime
            {
                get { return _hasServerTimeOverride && BitConverter.DoubleToInt64Bits(_serverTimeOverrideMs) != BitConverter.DoubleToInt64Bits(Tick * (double)Wire.TickMs); }
            }

            /// <summary>Exact size of <see cref="Encode"/>'s frame.</summary>
            public int EncodedLength
            {
                get
                {
                    uint head = Me != null ? Me.Head(Phase) : (Phase != Wire.DefaultPhase ? WireSelf.HPhase : 0);
                    if (Training) head |= WireSelf.HTraining;
                    if (HasNonDefaultTime) head |= WireSelf.HServerTime;
                    if (OwnerCombat != null) head |= WireSelf.HOwnerCombat;
                    int n = 1 + Writer.VarintLength(Tick) + Writer.VarintLength(AckInput) + WireSelf.HeadLength(head);
                    if (Me != null) n += Me.Length(head);
                    if ((head & WireSelf.HServerTime) != 0) n += 8;
                    n += Writer.VarintLength((uint)Actors.Length);
                    uint prev = 0;
                    for (int i = 0; i < Actors.Length; i++) { n += Actors[i].Length(i == 0, prev); prev = Actors[i].Id; }
                    if ((head & WireSelf.HOwnerCombat) != 0) n += OwnerCombatWire.Length(OwnerCombat);
                    return n;
                }
            }

            public override byte[] Encode()
            {
                // The encoder never writes a frame every decoder rejects (and never trims one to fit): rh-protocol does the same.
                if (Actors.Length > Wire.MaxActors) throw new ArgumentException("more than " + Wire.MaxActors + " actors");
                if (Phase > Wire.MaxPhaseCode) throw new ArgumentException("phase");
                if (Me != null && (Me.Faction > Wire.MaxKitCode || Me.Weapon > Wire.MaxKitCode || Me.Status > Wire.MaxStatusCode)) throw new ArgumentException("self faction/weapon/status");
                if (Me != null && Me.HuntTarget == 0) throw new ArgumentException("hunt target");
                if (ServerTimeOverrideMs.HasValue) WishWire.ValidateClock(ServerTimeOverrideMs.Value, "server time");
                if (Me != null) WishWire.ValidateBarrier(Me.Barrier, Me.BarrierRingStep);
                if (OwnerCombat != null && Me == null) throw new ArgumentException("owner combat without self");
                for (int i = 0; i < Actors.Length; i++)
                {
                    var a = Actors[i];
                    if (a.Faction > Wire.MaxKitCode || a.Weapon > Wire.MaxKitCode || a.Status > Wire.MaxStatusCode) throw new ArgumentException("actor faction/weapon/status");
                    if (!a.HasValidGiverIdentity) throw new ArgumentException("giver actor");
                    if (a.HpPct > 100) throw new ArgumentException("hp_pct");
                    if (!Quant.PosInRange(a.X) || !Quant.PosInRange(a.Y)) throw new ArgumentException("position");
                    if (i > 0 && a.Id <= Actors[i - 1].Id) throw new ArgumentException("actor ids must strictly ascend");
                }
                if (OwnerCombat != null)
                {
                    OwnerCombatWire.Validate(OwnerCombat);
                    if (OwnerCombat.Lock.Target.HasValue && !ContainsActor(Actors, OwnerCombat.Lock.Target.Value))
                        throw new ArgumentException("owner combat target");
                }
                var w = new Writer(EncodedLength);
                w.U8(TSnapshot); w.Varint(Tick); w.Varint(AckInput);
                uint head = Me != null ? Me.Head(Phase) : (Phase != Wire.DefaultPhase ? WireSelf.HPhase : 0);
                if (Training) head |= WireSelf.HTraining;
                if (HasNonDefaultTime) head |= WireSelf.HServerTime;
                if (OwnerCombat != null) head |= WireSelf.HOwnerCombat;
                w.Varint(head);
                if (Me != null) Me.Write(w, head);
                if ((head & WireSelf.HPhase) != 0) w.U8(Phase);
                if ((head & WireSelf.HServerTime) != 0) w.F64(ServerTimeOverrideMs.Value);
                w.Varint((uint)Actors.Length);
                uint prev = 0;
                for (int i = 0; i < Actors.Length; i++) { Actors[i].Write(w, i == 0, prev); prev = Actors[i].Id; }
                if (OwnerCombat != null) OwnerCombatWire.Write(w, OwnerCombat);
                return w.Finish();
            }

            /// <summary>Reads the body of a Snapshot frame into <paramref name="s"/>, reusing its Me object and actor array.</summary>
            internal static Snapshot Read(ref Reader r, Snapshot s)
            {
                s.Tick = r.Varint(); s.AckInput = r.Varint();
                uint head = r.Varint();
                if ((head & ~WireSelf.Known) != 0 || ((head & WireSelf.HPresent) == 0 && (head & WireSelf.SelfBits) != 0) ||
                    ((head & (WireSelf.HWish | WireSelf.HBarrier | WireSelf.HOwnerCombat)) != 0 && (head & WireSelf.HPresent) == 0))
                    throw new DecodeException(DecodeError.BadField, "head");
                s.Training = (head & WireSelf.HTraining) != 0;
                if ((head & WireSelf.HPresent) != 0)
                {
                    var me = s.Me ?? new WireSelf();
                    me.Read(ref r, head);
                    s.Me = me;
                }
                else s.Me = null;
                s.Phase = (head & WireSelf.HPhase) != 0 ? r.Code(Wire.MaxPhaseCode, "phase") : Wire.DefaultPhase;
                s.ServerTimeOverrideMs = (head & WireSelf.HServerTime) != 0 ? r.F64() : (double?)null;
                if (s.ServerTimeOverrideMs.HasValue && (s.ServerTimeOverrideMs.Value < 0 || double.IsNaN(s.ServerTimeOverrideMs.Value) || double.IsInfinity(s.ServerTimeOverrideMs.Value)))
                    throw new DecodeException(DecodeError.BadField, "server time");
                uint count = r.Varint();
                if (count > (uint)Wire.MaxActors) throw new DecodeException(DecodeError.TooMany, count.ToString());
                int n = (int)count;
                var actors = s.Actors;
                if (actors == null || actors.Length != n) actors = n == 0 ? Array.Empty<WireActor>() : new WireActor[n];
                uint prev = 0;
                for (int i = 0; i < n; i++) { actors[i] = WireActor.Read(ref r, i == 0, prev); prev = actors[i].Id; }
                s.Actors = actors;
                s.OwnerCombat = (head & WireSelf.HOwnerCombat) != 0 ? OwnerCombatWire.Read(ref r, s.OwnerCombat) : null;
                if (s.OwnerCombat != null && s.OwnerCombat.Lock.Target.HasValue && !ContainsActor(s.Actors, s.OwnerCombat.Lock.Target.Value))
                    throw new DecodeException(DecodeError.BadField, "owner combat target");
                return s;
            }
        }

        /// <summary>
        /// A snapshot as a delta against the last one the connection received (v3, v4 masks; layout in crates/rh-protocol/src/lib.rs). A
        /// client does not use this directly: <see cref="SnapshotTracker"/> applies it and hands out the resolved
        /// <see cref="Snapshot"/>. The lists are arrays with counts so that a tracker's one instance decodes every frame without
        /// garbage.
        /// </summary>
        public sealed class SnapshotDelta : ServerMsg
        {
            public uint Tick, BaseTick, AckInput;
            /// <summary>The new phase when <see cref="HasPhase"/> (a delta carries a field only when it differs from the base).</summary>
            public byte Phase;
            public bool HasPhase;
            public bool HasSelf;
            public SelfDelta Me;
            public ActorDelta[] Changed = new ActorDelta[8];
            public int ChangedCount;
            public uint[] Departed = new uint[8];
            public int DepartedCount;
            /// <summary>Protocol 11: the source's public training fact (delta head bit 20). False for every ordinary match.</summary>
            public bool Training;

            /// <summary>Whether this delta carries the Wish owner group; Wish=null explicitly clears a prior record.</summary>
            public bool HasWish;
            public WireWishOwner Wish;
            /// <summary>Whether this delta carries an owner barrier/ring pair, including a zero clear.</summary>
            public bool HasBarrier;
            public float Barrier;
            public byte BarrierRingStep;
            /// <summary>Whether this delta carries owner-combat availability; null explicitly clears, omission retains.</summary>
            public bool HasOwnerCombat;
            public WireOwnerCombat OwnerCombat;
            /// <summary>Optional absolute per-frame source time; absent means Tick * 50, never the base's time.</summary>
            public double? ServerTimeOverrideMs;

            // Head bits (append only): 0 self fields, 7 departed, 8 phase, 20 training, 21 Wish, 22 barrier, 23 server time, 24 owner combat.
            const uint HPresent = 1 << 0, HDeparted = 1 << 7, HPhase = 1 << 8, HTraining = 1 << 20,
                HWish = 1 << 21, HBarrier = 1 << 22, HServerTime = 1 << 23, HOwnerCombat = 1 << 24,
                Known = HPresent | SelfDelta.Fields | HPhase | HDeparted | HTraining | HWish | HBarrier | HServerTime | HOwnerCombat;

            /// <summary>Reads the body of a delta frame (after the tag): syntax and ranges only; whether it applies is the tracker's question.</summary>
            internal static SnapshotDelta Read(ref Reader r, SnapshotDelta d)
            {
                d.Tick = r.Varint();
                uint age = r.Varint();
                if (age < 1 || age > Wire.MaxDeltaAge || age > d.Tick) throw new DecodeException(DecodeError.BadField, "base age");
                d.BaseTick = d.Tick - age;
                d.AckInput = r.Varint();
                uint head = r.Varint();
                if ((head & ~Known) != 0 || ((head & HPresent) == 0 && (head & SelfDelta.Fields) != 0)) throw new DecodeException(DecodeError.BadField, "head");
                d.Training = (head & HTraining) != 0;
                d.HasSelf = (head & HPresent) != 0;
                d.HasWish = (head & HWish) != 0;
                d.HasBarrier = (head & HBarrier) != 0;
                d.HasOwnerCombat = (head & HOwnerCombat) != 0;
                if ((d.HasWish || d.HasBarrier) && !d.HasSelf) throw new DecodeException(DecodeError.BadField, "owner group without self");
                d.Me = d.HasSelf ? SelfDelta.Read(ref r, head & SelfDelta.Fields) : default(SelfDelta);
                d.Wish = d.HasWish && r.Flag() ? WishWire.ReadOwner(ref r, d.Wish) : null;
                if (d.HasBarrier)
                {
                    d.Barrier = r.F32(); d.BarrierRingStep = r.U8();
                    if (d.Barrier < 0 || float.IsNaN(d.Barrier) || float.IsInfinity(d.Barrier) || d.BarrierRingStep > 8)
                        throw new DecodeException(DecodeError.BadField, "barrier");
                }
                d.HasPhase = (head & HPhase) != 0;
                d.Phase = d.HasPhase ? r.Code(Wire.MaxPhaseCode, "phase") : (byte)0;
                d.ServerTimeOverrideMs = (head & HServerTime) != 0 ? r.F64() : (double?)null;
                if (d.ServerTimeOverrideMs.HasValue && (d.ServerTimeOverrideMs.Value < 0 || double.IsNaN(d.ServerTimeOverrideMs.Value) || double.IsInfinity(d.ServerTimeOverrideMs.Value)))
                    throw new DecodeException(DecodeError.BadField, "server time");
                uint n = r.Varint();
                if (n > (uint)Wire.MaxActors) throw new DecodeException(DecodeError.TooMany, n.ToString());
                if (d.Changed.Length < n) d.Changed = new ActorDelta[Math.Max((int)n, d.Changed.Length * 2)];
                d.ChangedCount = (int)n;
                uint prev = 0;
                for (int i = 0; i < (int)n; i++)
                {
                    uint field = r.Varint();
                    ulong id = i == 0 ? field : (ulong)prev + field;
                    if (i > 0 && (field == 0 || id > uint.MaxValue)) throw new DecodeException(DecodeError.BadField, "actor order");
                    prev = (uint)id;
                    ActorDelta a = default(ActorDelta);
                    a.Id = prev;
                    a.Mask = r.Varint();
                    if ((a.Mask & ~ActorDelta.MAll) != 0) throw new DecodeException(DecodeError.BadField, "actor mask");
                    bool step = (a.Mask & ActorDelta.MStep) != 0;
                    if (step && (a.Mask & (ActorDelta.MX | ActorDelta.MY)) == 0) throw new DecodeException(DecodeError.BadField, "position step");
                    if ((a.Mask & ActorDelta.MX) != 0) a.X = step ? ActorDelta.FieldOfStep(unchecked((sbyte)r.U8())) : r.U16();
                    if ((a.Mask & ActorDelta.MY) != 0) a.Y = step ? ActorDelta.FieldOfStep(unchecked((sbyte)r.U8())) : r.U16();
                    if ((a.Mask & ActorDelta.MFacing) != 0) a.Facing = (ushort)(r.U8() << 8);
                    if ((a.Mask & ActorDelta.MHp) != 0) { a.HpPct = r.U8(); if (a.HpPct > 100) throw new DecodeException(DecodeError.BadField, "hp_pct"); }
                    if ((a.Mask & ActorDelta.MBounty) != 0) a.Bounty = r.VarintU16("bounty");
                    if ((a.Mask & ActorDelta.MStatus) != 0) a.Status = r.Code(Wire.MaxStatusCode, "status");
                    if ((a.Mask & ActorDelta.MKind) != 0) a.Kind = r.U8();
                    if ((a.Mask & ActorDelta.MEffects) != 0) a.Effects = r.U16();
                    if ((a.Mask & ActorDelta.MDisplace) != 0) a.DisplaceSeq = r.U8();
                    if ((a.Mask & ActorDelta.MMobType) != 0) a.MobTypeCode = r.Code(30,"mob type");
                    if ((a.Mask & ActorDelta.MSig) != 0) a.Sig = r.U8();
                    if ((a.Mask & ActorDelta.MBarrier) != 0) { a.BarrierPct = r.U8(); a.BarrierRingStep = r.U8(); if (a.BarrierPct > 100 || a.BarrierRingStep > 8) throw new DecodeException(DecodeError.BadField, "barrier"); }
                    if ((a.Mask & ActorDelta.MWindup) != 0) a.Windup = WireWindup.Read(ref r, true);
                    if ((a.Mask & ActorDelta.MKit) != 0) a.Kit = r.U8();
                    d.Changed[i] = a;
                }
                d.DepartedCount = 0;
                if ((head & HDeparted) != 0)
                {
                    uint k = r.Varint();
                    if (k == 0) throw new DecodeException(DecodeError.BadField, "departed");
                    if (k > (uint)Wire.MaxActors) throw new DecodeException(DecodeError.TooMany, k.ToString());
                    if (d.Departed.Length < k) d.Departed = new uint[Math.Max((int)k, d.Departed.Length * 2)];
                    d.DepartedCount = (int)k;
                    uint last = 0;
                    for (int i = 0; i < (int)k; i++)
                    {
                        uint field = r.Varint();
                        ulong id = i == 0 ? field : (ulong)last + field;
                        if (i > 0 && (field == 0 || id > uint.MaxValue)) throw new DecodeException(DecodeError.BadField, "departed order");
                        last = (uint)id;
                        d.Departed[i] = last;
                    }
                }
                d.OwnerCombat = null;
                if (d.HasOwnerCombat)
                {
                    byte available = r.U8();
                    if (available > 1) throw new DecodeException(DecodeError.BadField, "owner combat availability");
                    if (available != 0) d.OwnerCombat = OwnerCombatWire.Read(ref r, d.OwnerCombat);
                    if (d.OwnerCombat != null && !d.HasSelf) throw new DecodeException(DecodeError.BadField, "owner combat");
                }
                return d;
            }

            public override byte[] Encode()
            {
                if (Tick < BaseTick + 1 || Tick - BaseTick > Wire.MaxDeltaAge) throw new ArgumentException("base age");
                if (HasPhase && Phase > Wire.MaxPhaseCode) throw new ArgumentException("phase");
                if (ChangedCount > Wire.MaxActors || DepartedCount > Wire.MaxActors) throw new ArgumentException("too many actors");
                if (HasSelf && (Me.Mask & ~SelfDelta.Fields) != 0) throw new ArgumentException("head");
                if ((HasWish || HasBarrier) && !HasSelf) throw new ArgumentException("owner group without self");
                if (HasOwnerCombat && OwnerCombat != null && !HasSelf) throw new ArgumentException("owner combat without self");
                if (HasWish && Wish != null) WishWire.ValidateOwner(Wish);
                if (HasBarrier) WishWire.ValidateBarrier(Barrier, BarrierRingStep);
                if (HasOwnerCombat && OwnerCombat != null) OwnerCombatWire.Validate(OwnerCombat);
                if (ServerTimeOverrideMs.HasValue) WishWire.ValidateClock(ServerTimeOverrideMs.Value, "server time");
                if (HasSelf && (Me.Mask & SelfDelta.FStatus) != 0 && Me.StatusValue > Wire.MaxStatusCode) throw new ArgumentException("status");
                for (int i = 0; i < ChangedCount; i++)
                {
                    var a = Changed[i];
                    if ((a.Mask & ActorDelta.MStatus) != 0 && a.Status > Wire.MaxStatusCode) throw new ArgumentException("status");
                    if ((a.Mask & ~ActorDelta.MAll) != 0) throw new ArgumentException("actor mask");
                    if ((a.Mask & ActorDelta.MHp) != 0 && a.HpPct > 100) throw new ArgumentException("hp_pct");
                    if (i > 0 && a.Id <= Changed[i - 1].Id) throw new ArgumentException("actor ids must strictly ascend");
                }
                for (int i = 1; i < DepartedCount; i++) if (Departed[i] <= Departed[i - 1]) throw new ArgumentException("departed ids must strictly ascend");
                var w = new Writer();
                w.U8(TSnapshotDelta); w.Varint(Tick); w.Varint(Tick - BaseTick); w.Varint(AckInput);
                uint head = 0;
                if (Training) head |= HTraining;
                if (HasSelf) head |= HPresent | (Me.Mask & SelfDelta.Fields);
                if (HasWish) head |= HWish;
                if (HasBarrier) head |= HBarrier;
                if (HasOwnerCombat) head |= HOwnerCombat;
                bool hasTime = ServerTimeOverrideMs.HasValue && BitConverter.DoubleToInt64Bits(ServerTimeOverrideMs.Value) != BitConverter.DoubleToInt64Bits(Tick * (double)Wire.TickMs);
                if (hasTime) head |= HServerTime;
                if (HasPhase) head |= HPhase;
                if (DepartedCount > 0) head |= HDeparted;
                w.Varint(head);
                if (HasSelf) Me.Write(w);
                if (HasWish) { w.U8(Wish == null ? (byte)0 : (byte)1); if (Wish != null) WishWire.WriteOwner(w, Wish); }
                if (HasBarrier) { w.F32(Barrier); w.U8(BarrierRingStep); }
                if (HasPhase) w.U8(Phase);
                if (hasTime) w.F64(ServerTimeOverrideMs.Value);
                w.Varint((uint)ChangedCount);
                for (int i = 0; i < ChangedCount; i++)
                {
                    var a = Changed[i];
                    w.Varint(i == 0 ? a.Id : a.Id - Changed[i - 1].Id);
                    if ((a.Mask & ActorDelta.MMobType)!=0 && a.MobTypeCode>30) throw new ArgumentException("mob type");
                    w.Varint(a.Mask & ActorDelta.MAll);
                    bool step = (a.Mask & ActorDelta.MStep) != 0;
                    if (step && (a.Mask & (ActorDelta.MX | ActorDelta.MY)) == 0) throw new ArgumentException("position step");
                    if ((a.Mask & ActorDelta.MX) != 0) { if (step) w.U8(ActorDelta.StepByte(a.X)); else w.U16(a.X); }
                    if ((a.Mask & ActorDelta.MY) != 0) { if (step) w.U8(ActorDelta.StepByte(a.Y)); else w.U16(a.Y); }
                    if ((a.Mask & ActorDelta.MFacing) != 0) { if ((a.Facing & 0xff) != 0) throw new ArgumentException("remote facing"); w.U8((byte)(a.Facing >> 8)); }
                    if ((a.Mask & ActorDelta.MHp) != 0) w.U8(a.HpPct);
                    if ((a.Mask & ActorDelta.MBounty) != 0) w.Varint(a.Bounty);
                    if ((a.Mask & ActorDelta.MStatus) != 0) w.U8(a.Status);
                    if ((a.Mask & ActorDelta.MKind) != 0) w.U8(a.Kind);
                    if ((a.Mask & ActorDelta.MEffects) != 0) w.U16(a.Effects);
                    if ((a.Mask & ActorDelta.MDisplace) != 0) w.U8(a.DisplaceSeq);
                    if ((a.Mask & ActorDelta.MMobType) != 0) w.U8(a.MobTypeCode);
                    if ((a.Mask & ActorDelta.MSig) != 0) w.U8(a.Sig);
                    if ((a.Mask & ActorDelta.MBarrier) != 0) { if (a.BarrierPct > 100 || a.BarrierRingStep > 8) throw new ArgumentException("barrier"); w.U8(a.BarrierPct); w.U8(a.BarrierRingStep); }
                    if ((a.Mask & ActorDelta.MWindup) != 0) a.Windup.Write(w, true);
                    if ((a.Mask & ActorDelta.MKit) != 0) w.U8(a.Kit);
                }
                if (DepartedCount > 0)
                {
                    w.Varint((uint)DepartedCount);
                    for (int i = 0; i < DepartedCount; i++) w.Varint(i == 0 ? Departed[i] : Departed[i] - Departed[i - 1]);
                }
                if (HasOwnerCombat)
                {
                    w.U8(OwnerCombat == null ? (byte)0 : (byte)1);
                    if (OwnerCombat != null) OwnerCombatWire.Write(w, OwnerCombat);
                }
                return w.Finish();
            }
        }

        public sealed class Events : ServerMsg
        {
            public uint Tick;
            public List<WireEvent> List = new List<WireEvent>();

            public override byte[] Encode()
            {
                if (List.Count > ushort.MaxValue) throw new ArgumentException("too many events");
                int len = 7;
                foreach (var e in List)
                {
                    switch (e.Kind)
                    {
                        case EventKind.Death: len += 6 + (e.By.HasValue ? 4 : 0); break;
                        case EventKind.Bounty: len += 7; break;
                        case EventKind.MatchEnded: len += 3 + (e.Winner.HasValue ? 4 : 0); break;
                        case EventKind.PotionNotice: case EventKind.PickupRefused: case EventKind.ChestRefused: len += 2; break;
                        case EventKind.WindEmblem: len += 1; break;
                        case EventKind.CannonNotice:
                            if (e.CannonCode < 1 || e.CannonCode > 4 || (e.CannonCode == 4) != e.CannonSeconds.HasValue || (e.CannonSeconds.HasValue && (e.CannonSeconds.Value < 1 || e.CannonSeconds.Value > 75))) throw new ArgumentException("cannon notice");
                            len += 2 + (e.CannonSeconds.HasValue ? 2 : 0); break;
                        case EventKind.Result: len += 20 + (e.Result.KilledBy == null ? 0 : 1 + System.Text.Encoding.UTF8.GetByteCount(e.Result.KilledBy)); break;
                        case EventKind.Toast: len += 1 + (e.ToastText == null ? 0 : 1 + System.Text.Encoding.UTF8.GetByteCount(e.ToastText)); break;
                        default: throw new EncodeException("event kind");
                    }
                    if (len > Wire.MaxServerFrame) throw new ArgumentException("frame too large");
                }
                var w = new Writer(len);
                w.U8(TEvents); w.U32(Tick); w.U16((ushort)List.Count);
                foreach (var e in List)
                {
                    w.U8((byte)e.Kind);
                    switch (e.Kind)
                    {
                        case EventKind.WindEmblem: break;
                        case EventKind.PotionNotice: if(e.PotionNotice<1 || e.PotionNotice>10) throw new ArgumentException("potion notice");w.U8(e.PotionNotice);break;
                        case EventKind.ChestRefused: if(e.ChestReason < 1 || e.ChestReason > 9) throw new ArgumentException("chest reason");w.U8(e.ChestReason);break;
                        case EventKind.PickupRefused: if (e.PickupReason < 1 || e.PickupReason > 5) throw new ArgumentException("pickup reason"); w.U8(e.PickupReason); break;
                        case EventKind.CannonNotice:
                            if (e.CannonCode < 1 || e.CannonCode > 4 || (e.CannonCode == 4) != e.CannonSeconds.HasValue || (e.CannonSeconds.HasValue && (e.CannonSeconds.Value < 1 || e.CannonSeconds.Value > 75))) throw new ArgumentException("cannon notice");
                            w.U8(e.CannonCode); if (e.CannonSeconds.HasValue) w.U16(e.CannonSeconds.Value); break;
                        case EventKind.Death: w.U32(e.Id); if (e.By.HasValue) { w.U8(1); w.U32(e.By.Value); } else w.U8(0); break;
                        case EventKind.Bounty: w.U32(e.Id); w.U16(e.Bounty); break;
                        case EventKind.MatchEnded: if (e.Winner.HasValue) { w.U8(1); w.U32(e.Winner.Value); } else w.U8(0); w.U8((byte)(e.Draw ? 1 : 0)); break;
                        case EventKind.Toast:
                            if (e.ToastText == null) throw new ArgumentException("toast text");
                            w.Str(e.ToastText);
                            break;
                        case EventKind.Result:
                        {
                            var r = e.Result;
                            w.U8(r.Outcome); w.U8(r.Place); w.U8(r.Players); w.U16(r.Kills);
                            if (r.KilledBy != null) { w.U8(1); w.Str(r.KilledBy); } else w.U8(0);
                            w.U32(r.GvTotal); w.U32(r.GvWin); w.U32(r.DurationSec); w.U8((byte)(r.WinBonusWithheld ? 1 : 0));
                            break;
                        }
                    }
                }
                return w.Finish();
            }
        }

        public sealed class Fx : ServerMsg
        {
            public uint Tick;
            public List<WireFx> List = new List<WireFx>();

            internal static uint ReadRequiredRef(ref Reader r)
            {
                uint id = r.Varint(); if (id == 0) throw new DecodeException(DecodeError.BadField, "wish actor reference"); return id;
            }
            internal static uint? ReadOptionalRef(ref Reader r)
            {
                if (!r.Flag()) return null;
                uint id = r.Varint(); if (id == 0) throw new DecodeException(DecodeError.BadField, "wish actor reference"); return id;
            }
            internal static void ValidateStarted(WireFx f, bool encoding)
            {
                if (f.EventTime < 0 || double.IsNaN(f.EventTime) || double.IsInfinity(f.EventTime) || f.Duration < 0 || double.IsNaN(f.Duration) || double.IsInfinity(f.Duration) ||
                    !f.Caster.HasValue || f.Caster.Value == 0 || (f.Target.HasValue && f.Target.Value == 0) || f.Ability > WishWire.MaxAbility ||
                    (f.HasAnchor && (!Quant.PosInRange(f.AnchorX) || !Quant.PosInRange(f.AnchorY))))
                {
                    if (encoding) throw new ArgumentException("wish started fields");
                    throw new DecodeException(DecodeError.BadField, "wish started");
                }
            }
            internal static void ValidateLanded(WireFx f, bool encoding)
            {
                bool invalid = f.EventTime < 0 || double.IsNaN(f.EventTime) || double.IsInfinity(f.EventTime) || f.Ability > WishWire.MaxAbility ||
                    (f.Caster.HasValue && f.Caster.Value == 0) || (f.Target.HasValue && f.Target.Value == 0) ||
                    (f.HasAnchor && (!Quant.PosInRange(f.AnchorX) || !Quant.PosInRange(f.AnchorY))) ||
                    (f.HasDestination && (!Quant.PosInRange(f.DestinationX) || !Quant.PosInRange(f.DestinationY))) ||
                    (f.Ability == WishWire.BlazeAbility ? f.HasAnchor != f.HasDestination : f.HasDestination) ||
                    (!f.Caster.HasValue && !f.HasAnchor);
                if (invalid)
                {
                    if (encoding) throw new ArgumentException("wish landed fields");
                    throw new DecodeException(DecodeError.BadField, "wish landed");
                }
            }
            internal static void ValidateEnded(WireFx f, bool encoding)
            {
                if (f.EventTime < 0 || double.IsNaN(f.EventTime) || double.IsInfinity(f.EventTime) || !f.Caster.HasValue || f.Caster.Value == 0 ||
                    f.Ability > WishWire.MaxAbility || f.Reason > 2)
                {
                    if (encoding) throw new ArgumentException("wish ended fields");
                    throw new DecodeException(DecodeError.BadField, "wish ended");
                }
            }
            static int WishLength(WireFx f)
            {
                switch (f.Kind)
                {
                    case FxKind.WishStarted:
                        ValidateStarted(f, true);
                        return 1 + 8 + Writer.VarintLength(f.Caster.Value) + 1 + 8 + (f.Target.HasValue ? 1 + Writer.VarintLength(f.Target.Value) : 1) + (f.HasAnchor ? 5 : 1);
                    case FxKind.WishLanded:
                        ValidateLanded(f, true);
                        return 1 + 8 + 1 + (f.Caster.HasValue ? 1 + Writer.VarintLength(f.Caster.Value) : 1) +
                            (f.Target.HasValue ? 1 + Writer.VarintLength(f.Target.Value) : 1) + (f.HasAnchor ? 5 : 1) + (f.HasDestination ? 5 : 1);
                    case FxKind.WishEnded:
                        ValidateEnded(f, true);
                        return 1 + 8 + Writer.VarintLength(f.Caster.Value) + 1 + 1;
                    default: return 0;
                }
            }

            public override byte[] Encode()
            {
                if (List.Count > ushort.MaxValue) throw new ArgumentException("too many fx");
                // Like rh-protocol: a swing off the position grid is refused, never saturated.
                foreach (var f in List)
                {
                    if (f.Kind != FxKind.Swing && f.Kind != FxKind.Hit && f.Kind != FxKind.Block && f.Kind != FxKind.Stagger && f.Kind != FxKind.Teleport &&
                        f.Kind != FxKind.WishStarted && f.Kind != FxKind.WishLanded && f.Kind != FxKind.WishEnded)
                        throw new EncodeException("fx kind");
                    if (f.Kind == FxKind.Swing && (!Quant.PosInRange(f.X) || !Quant.PosInRange(f.Y))) throw new ArgumentException("position");
                }
                int len = 1 + Writer.VarintLength(Tick) + Writer.VarintLength((uint)List.Count);
                foreach (var f in List)
                    len += f.Kind == FxKind.WishStarted || f.Kind == FxKind.WishLanded || f.Kind == FxKind.WishEnded ? WishLength(f) :
                        f.Kind == FxKind.Teleport ? 1 : f.Kind == FxKind.Block ? 2 + Writer.VarintLength(f.Id) + Writer.VarintLength(f.By) : f.Kind == FxKind.Stagger ? 1 + Writer.VarintLength(f.Id) : f.Kind == FxKind.Swing ? 1 + Writer.VarintLength(f.By) + 1 + 6 : 1 + Writer.VarintLength(f.Victim) + Writer.VarintLength(f.By) + 5;
                if (len > Wire.MaxServerFrame) throw new ArgumentException("frame too large");
                var w = new Writer(len);
                w.U8(TFx); w.Varint(Tick); w.Varint((uint)List.Count);
                foreach (var f in List)
                {
                    w.U8((byte)f.Kind);
                    if (f.Kind == FxKind.Swing) { w.Varint(f.By); w.U8(f.Weapon); w.U16(Quant.QuantizePos(f.X)); w.U16(Quant.QuantizePos(f.Y)); w.U16(Quant.QuantizeFacing(f.A)); }
                    else if (f.Kind == FxKind.Block) { w.Varint(f.Id); w.Varint(f.By); w.U8(f.Weapon); }
                    else if (f.Kind == FxKind.Stagger) w.Varint(f.Id);
                    else if (f.Kind == FxKind.Teleport) { }
                    else if (f.Kind == FxKind.WishStarted)
                    {
                        w.F64(f.EventTime); w.Varint(f.Caster.Value); w.U8(f.Ability); w.F64(f.Duration); WriteOptRef(w, f.Target);
                        w.U8(f.HasAnchor ? (byte)1 : (byte)0); if (f.HasAnchor) WishWire.WritePoint(w, f.AnchorX, f.AnchorY);
                    }
                    else if (f.Kind == FxKind.WishLanded)
                    {
                        w.F64(f.EventTime); w.U8(f.Ability); WriteOptRef(w, f.Caster); WriteOptRef(w, f.Target);
                        WriteOptPoint(w, f.HasAnchor, f.AnchorX, f.AnchorY); WriteOptPoint(w, f.HasDestination, f.DestinationX, f.DestinationY);
                    }
                    else if (f.Kind == FxKind.WishEnded) { w.F64(f.EventTime); w.Varint(f.Caster.Value); w.U8(f.Ability); w.U8(f.Reason); }
                    else { w.Varint(f.Victim); w.Varint(f.By); w.F32(f.Amount); w.U8((byte)(f.Passive ? 1 : 0)); }
                }
                return w.Finish();
            }

            static void WriteOptRef(Writer w, uint? id)
            {
                if (id.HasValue) { if (id.Value == 0) throw new ArgumentException("wish actor reference"); w.U8(1); w.Varint(id.Value); }
                else w.U8(0);
            }
            static void WriteOptPoint(Writer w, bool has, float x, float y)
            {
                w.U8(has ? (byte)1 : (byte)0); if (has) WishWire.WritePoint(w, x, y);
            }
        }

        /// <summary>
        /// Keyed state, the latest value per key (reserved in v4: no key exists yet, so only the empty State decodes). Once keys
        /// exist a Welcome (join and resume) is followed by a full State.
        /// </summary>
        public sealed class State : ServerMsg
        {
            public uint Tick;
            public StateItem[] Items = Array.Empty<StateItem>();
            public override byte[] Encode() { var w = new Writer(); w.U8(TState); w.Varint(Tick); StateItem.WriteAll(w, Items); var frame = w.Finish(); if (frame.Length > Wire.MaxServerFrame) throw new EncodeException("state frame too large"); return frame; }
        }

        public sealed class Pong : ServerMsg
        {
            public uint Nonce;
            public double ClientMs, ServerMs;
            public override byte[] Encode() { var w = new Writer(21); w.U8(TPong); w.U32(Nonce); w.F64(ClientMs); w.F64(ServerMs); return w.Finish(); }
        }
    }
}
