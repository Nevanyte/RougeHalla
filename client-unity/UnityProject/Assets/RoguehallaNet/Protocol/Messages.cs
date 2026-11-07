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

    public enum CommandKind : byte { Move = 1, Stop = 2, Aim = 3, Attack = 4, Release = 5, Swap = 6, Pickup = 7, Choose = 8, UseConsumable = 9, Target = 10, AttackMove = 11, HuntTarget = 12, ConsumeCorpse = 13 }

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
        public sbyte Pick;
        public uint ActorRef;
        /// <summary>Client render time in server ms (Attack, Release); lag compensation, clamped by the server.</summary>
        public double? T;

        public static WireCommand Swap(byte? slot = null) { return new WireCommand { Kind = CommandKind.Swap, Slot = slot }; }
        public static WireCommand Pickup(PickupHandle handle) { return new WireCommand { Kind = CommandKind.Pickup, PickupRef = handle }; }
        public static WireCommand Choose(RewardChestHandle handle, sbyte pick) { return new WireCommand { Kind = CommandKind.Choose, RewardRef = handle, Pick = pick }; }
        public static WireCommand Move(float x, float y, byte? seq) { return new WireCommand { Kind = CommandKind.Move, X = x, Y = y, Seq = seq }; }
        public static WireCommand UseConsumable() { return new WireCommand { Kind = CommandKind.UseConsumable }; }
        public static WireCommand Target(uint actorRef) { if (actorRef == 0) throw new ArgumentException("actor reference"); return new WireCommand { Kind = CommandKind.Target, ActorRef = actorRef }; }
        public static WireCommand HuntTarget(uint actorRef) { if (actorRef == 0) throw new ArgumentException("hunt target"); return new WireCommand { Kind = CommandKind.HuntTarget, ActorRef = actorRef }; }
        public static WireCommand ConsumeCorpse(PickupHandle handle) { if (!handle.IsValid) throw new ArgumentException("corpse handle"); return new WireCommand { Kind = CommandKind.ConsumeCorpse, PickupRef = handle }; }
        public static WireCommand AttackMove(float x, float y, byte? seq) { return new WireCommand { Kind = CommandKind.AttackMove, X = x, Y = y, Seq = seq }; }
        public static WireCommand Stop(byte? seq) { return new WireCommand { Kind = CommandKind.Stop, Seq = seq }; }
        public static WireCommand Aim(float a) { return new WireCommand { Kind = CommandKind.Aim, A = a }; }
        public static WireCommand Attack(float a, double? t) { return new WireCommand { Kind = CommandKind.Attack, A = a, T = t }; }
        public static WireCommand Release(float a, double? t) { return new WireCommand { Kind = CommandKind.Release, A = a, T = t }; }
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
                            case 12: { uint id=r.U32(); if(id==0) throw new DecodeException(DecodeError.BadField,"hunt target"); inp.Commands.Add(WireCommand.HuntTarget(id)); break; }
                            case 13: { uint id=r.U32(); if(id==0) throw new DecodeException(DecodeError.BadField,"corpse handle"); inp.Commands.Add(WireCommand.ConsumeCorpse(new PickupHandle(id))); break; }
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
                        case CommandKind.Target: if(c.ActorRef==0) throw new ArgumentException("actor reference"); w.U32(c.ActorRef); break;
                        case CommandKind.HuntTarget: if(c.ActorRef==0) throw new ArgumentException("hunt target"); w.U32(c.ActorRef); break;
                        case CommandKind.ConsumeCorpse: if(!c.PickupRef.IsValid) throw new ArgumentException("corpse handle"); w.U32(c.PickupRef.Value); break;
                        case CommandKind.AttackMove:
                        case CommandKind.Move: w.F32(c.X); w.F32(c.Y); Opt(w, c.Seq); break;
                        case CommandKind.Stop: Opt(w, c.Seq); break;
                        case CommandKind.Aim: w.F32(c.A); break;
                        case CommandKind.Attack:
                        case CommandKind.Release:
                            w.F32(c.A);
                            if (c.T.HasValue) { w.U8(1); w.F64(c.T.Value); } else w.U8(0);
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
                    case CommandKind.UseConsumable: return 1;
                    case CommandKind.Target: return 5;
                    case CommandKind.HuntTarget: return 5;
                    case CommandKind.ConsumeCorpse: return 5;
                    case CommandKind.AttackMove:
                    case CommandKind.Move: return 9 + (c.Seq.HasValue ? 2 : 1);
                    case CommandKind.Stop: return 1 + (c.Seq.HasValue ? 2 : 1);
                    case CommandKind.Aim: return 5;
                    case CommandKind.Attack:
                    case CommandKind.Release: return 5 + (c.T.HasValue ? 9 : 1);
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

        internal void CopyFrom(WireSelf o)
        {
            Id = o.Id; Faction = o.Faction; X = o.X; Y = o.Y; Facing = o.Facing; Hp = o.Hp; MaxHp = o.MaxHp; Status = o.Status; Weapon = o.Weapon;
            ReadyInMs = o.ReadyInMs; Kills = o.Kills; Bounty = o.Bounty; Gv = o.Gv; MoveSeq = o.MoveSeq; Effects = o.Effects; DisplaceSeq = o.DisplaceSeq; Sig = o.Sig;
            HuntTarget = o.HuntTarget; HuntStacks = o.HuntStacks;
        }

        // Head bits (rh-protocol lib.rs, append only): a varint, so bits below 7 take one byte.
        internal const uint HPresent = 1 << 0, HKit = 1 << 1, HHp = 1 << 2, HReady = 1 << 3, HKills = 1 << 4, HBounty = 1 << 5,
            HMoveSeq = 1 << 6, HGv = 1 << 7, HMaxHpF32 = 1 << 8, HStatus = 1 << 9, HPhase = 1 << 10, HEffects = 1 << 11, HDisplace = 1 << 12, HSig = 1 << 13,
            HHuntTarget = 1 << 14, HHuntStacks = 1 << 15;
        internal const uint SelfBits = 0x03ff | HEffects | HDisplace | HSig | HHuntTarget | HHuntStacks, Known = SelfBits | HPhase;

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
            return n;
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
        public ushort Bounty;
        public byte Faction;
        /// <summary>hp fraction in hundredths (0..100).</summary>
        public byte HpPct;
        public byte Status, Weapon;
        /// <summary>What the entity is: 0 = player (the default; costs no byte). The id namespace is shared by every kind.</summary>
        public byte Kind, DisplaceSeq, MobTypeCode, Sig;
        public ushort Effects;

        // Full actor mask bits (append only): 0 kit, 1 hp, 2 status, 3 bounty, 4 kind. A varint.
        internal const uint MKit = 1 << 0, MHp = 1 << 1, MStatus = 1 << 2, MBounty = 1 << 3, MKind = 1 << 4, MEffects = 1 << 5, MDisplace = 1 << 6, MMobType = 1 << 7, MSig = 1 << 8, MKnown = MKit | MHp | MStatus | MBounty | MKind | MEffects | MDisplace | MMobType | MSig;
        internal const byte DefaultHpPct = 100;

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
            return m;
        }

        internal static uint IdField(uint id, bool first, uint prev) { return first ? id : unchecked(id - prev); }

        internal int Length(bool first, uint prev)
        {
            uint m = Mask();
            return Writer.VarintLength(IdField(Id, first, prev)) + Writer.VarintLength(m) + 6 + ((m & MKit) != 0 ? 1 : 0) + ((m & MHp) != 0 ? 1 : 0)
                + ((m & MStatus) != 0 ? 1 : 0) + ((m & MBounty) != 0 ? Writer.VarintLength(Bounty) : 0) + ((m & MKind) != 0 ? 1 : 0) + ((m & MEffects) != 0 ? 2 : 0) + ((m & MDisplace) != 0 ? 1 : 0) + ((m & MMobType) != 0 ? 1 : 0) + ((m & MSig) != 0 ? 1 : 0);
        }

        /// <summary>Reads one actor; the first has an absolute id, each later one the (non-zero) gap from <paramref name="prev"/>.</summary>
        internal static WireActor Read(ref Reader r, bool first, uint prev)
        {
            WireActor a;
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
            if ((mask & FHuntTarget) != 0) { uint t = r.Varint(); if (t == 0) throw new DecodeException(DecodeError.BadField, "hunt target"); s.HuntTarget = t; }
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
            if ((Mask & FHuntTarget) != 0 && HuntTarget.HasValue) w.Varint(HuntTarget.Value);
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
    /// One changed remote actor of a snapshot delta: <see cref="Mask"/> (bits <see cref="MX"/>..<see cref="MKind"/>, append only)
    /// says which fields are carried; the others mean nothing. A NEW actor (not in the base) starts from the default actor and must
    /// carry its position (<see cref="MNew"/>).
    /// </summary>
    public struct ActorDelta
    {
        public const uint MX = 1 << 0, MY = 1 << 1, MFacing = 1 << 2, MKit = 1 << 3, MHp = 1 << 4, MBounty = 1 << 5, MStatus = 1 << 6,
            MKind = 1 << 7, MEffects = 1 << 8, MDisplace = 1 << 9, MMobType = 1 << 10, MSig = 1 << 11, MAll = 0xfff, MNew = MX | MY | MFacing;
        public uint Id;
        public uint Mask;
        public ushort X, Y, Facing;
        public byte Kit, HpPct, Status, Kind, DisplaceSeq, MobTypeCode, Sig;
        public ushort Bounty, Effects;
    }

    public enum EventKind : byte { Death = 1, Bounty = 2, MatchEnded = 3, Result = 4, PickupRefused = 5, ChestRefused = 6, PotionNotice = 7 }

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
        public byte PickupReason, ChestReason, PotionNotice;
    }

    public sealed class WireResult
    {
        public byte Outcome, Place, Players;
        public ushort Kills;
        public string KilledBy;
        public uint GvTotal, GvWin, DurationSec;
        public bool WinBonusWithheld;
    }

    public enum FxKind : byte { Swing = 1, Hit = 2, Block = 3, Stagger = 4 }

    public sealed class WireFx
    {
        public FxKind Kind;
        public uint By, Victim;
        public uint Id;
        public bool Passive;
        public byte Weapon;
        public float X, Y, A, Amount;
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
                            case 5: ev.PickupReason = r.U8(); if (ev.PickupReason < 1 || ev.PickupReason > 5) throw new DecodeException(DecodeError.BadField, "pickup reason"); break;
                            case 7: ev.PotionNotice=r.U8(); if(ev.PotionNotice<1 || ev.PotionNotice>10) throw new DecodeException(DecodeError.BadField,"potion notice"); break;
                            case 6: ev.ChestReason = r.U8(); if(ev.ChestReason < 1 || ev.ChestReason > 9) throw new DecodeException(DecodeError.BadField,"chest reason");break;
                            case 1: ev.Id = r.U32(); if (r.Flag()) ev.By = r.U32(); break;
                            case 2: ev.Id = r.U32(); ev.Bounty = r.U16(); break;
                            case 3: if (r.Flag()) ev.Winner = r.U32(); ev.Draw = r.U8() != 0; break;
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
                            case 2: { uint victim = r.Varint(), by = r.Varint(); f.List.Add(new WireFx { Kind = FxKind.Hit, Victim = victim, By = by, Amount = r.F32(), Passive = r.Flag() }); break; }
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
            public uint Tick;
            public byte Phase;
            public uint AckInput;
            /// <summary>Null for a spectator (or a dead player's view without a self).</summary>
            public WireSelf Me;
            /// <summary>Sorted by id, strictly ascending (C-OBS; the wire needs it). Never null; shared empty array when nothing is visible.</summary>
            public WireActor[] Actors = Array.Empty<WireActor>();

            /// <summary>The server time of this snapshot in ms. Not on the wire: the server's clock is always Tick * 50 ms.</summary>
            public double ServerMs { get { return Tick * (double)Wire.TickMs; } }

            /// <summary>Exact size of <see cref="Encode"/>'s frame.</summary>
            public int EncodedLength
            {
                get
                {
                    uint head = Me != null ? Me.Head(Phase) : (Phase != Wire.DefaultPhase ? WireSelf.HPhase : 0);
                    int n = 1 + Writer.VarintLength(Tick) + Writer.VarintLength(AckInput) + WireSelf.HeadLength(head);
                    if (Me != null) n += Me.Length(head);
                    n += Writer.VarintLength((uint)Actors.Length);
                    uint prev = 0;
                    for (int i = 0; i < Actors.Length; i++) { n += Actors[i].Length(i == 0, prev); prev = Actors[i].Id; }
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
                for (int i = 0; i < Actors.Length; i++)
                {
                    var a = Actors[i];
                    if (a.Faction > Wire.MaxKitCode || a.Weapon > Wire.MaxKitCode || a.Status > Wire.MaxStatusCode) throw new ArgumentException("actor faction/weapon/status");
                    if (a.HpPct > 100) throw new ArgumentException("hp_pct");
                    if (!Quant.PosInRange(a.X) || !Quant.PosInRange(a.Y)) throw new ArgumentException("position");
                    if (i > 0 && a.Id <= Actors[i - 1].Id) throw new ArgumentException("actor ids must strictly ascend");
                }
                var w = new Writer(EncodedLength);
                w.U8(TSnapshot); w.Varint(Tick); w.Varint(AckInput);
                uint head = Me != null ? Me.Head(Phase) : (Phase != Wire.DefaultPhase ? WireSelf.HPhase : 0);
                w.Varint(head);
                if (Me != null) Me.Write(w, head);
                if ((head & WireSelf.HPhase) != 0) w.U8(Phase);
                w.Varint((uint)Actors.Length);
                uint prev = 0;
                for (int i = 0; i < Actors.Length; i++) { Actors[i].Write(w, i == 0, prev); prev = Actors[i].Id; }
                return w.Finish();
            }

            /// <summary>Reads the body of a Snapshot frame into <paramref name="s"/>, reusing its Me object and actor array.</summary>
            internal static Snapshot Read(ref Reader r, Snapshot s)
            {
                s.Tick = r.Varint(); s.AckInput = r.Varint();
                uint head = r.Varint();
                if ((head & ~WireSelf.Known) != 0 || ((head & WireSelf.HPresent) == 0 && (head & WireSelf.SelfBits) != 0))
                    throw new DecodeException(DecodeError.BadField, "head");
                if ((head & WireSelf.HPresent) != 0)
                {
                    var me = s.Me ?? new WireSelf();
                    me.Read(ref r, head);
                    s.Me = me;
                }
                else s.Me = null;
                s.Phase = (head & WireSelf.HPhase) != 0 ? r.Code(Wire.MaxPhaseCode, "phase") : Wire.DefaultPhase;
                uint count = r.Varint();
                if (count > (uint)Wire.MaxActors) throw new DecodeException(DecodeError.TooMany, count.ToString());
                int n = (int)count;
                var actors = s.Actors;
                if (actors == null || actors.Length != n) actors = n == 0 ? Array.Empty<WireActor>() : new WireActor[n];
                uint prev = 0;
                for (int i = 0; i < n; i++) { actors[i] = WireActor.Read(ref r, i == 0, prev); prev = actors[i].Id; }
                s.Actors = actors;
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

            // Head bits (append only): 0 a self follows (its fields are SelfDelta.Fields), 7 a departed list follows, 8 the phase changed.
            const uint HPresent = 1 << 0, HDeparted = 1 << 7, HPhase = 1 << 8, Known = HPresent | SelfDelta.Fields | HPhase | HDeparted;

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
                d.HasSelf = (head & HPresent) != 0;
                d.Me = d.HasSelf ? SelfDelta.Read(ref r, head & SelfDelta.Fields) : default(SelfDelta);
                d.HasPhase = (head & HPhase) != 0;
                d.Phase = d.HasPhase ? r.Code(Wire.MaxPhaseCode, "phase") : (byte)0;
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
                    if ((a.Mask & ActorDelta.MX) != 0) a.X = r.U16();
                    if ((a.Mask & ActorDelta.MY) != 0) a.Y = r.U16();
                    if ((a.Mask & ActorDelta.MFacing) != 0) a.Facing = r.U16();
                    if ((a.Mask & ActorDelta.MKit) != 0) a.Kit = r.U8();
                    if ((a.Mask & ActorDelta.MHp) != 0) { a.HpPct = r.U8(); if (a.HpPct > 100) throw new DecodeException(DecodeError.BadField, "hp_pct"); }
                    if ((a.Mask & ActorDelta.MBounty) != 0) a.Bounty = r.VarintU16("bounty");
                    if ((a.Mask & ActorDelta.MStatus) != 0) a.Status = r.Code(Wire.MaxStatusCode, "status");
                    if ((a.Mask & ActorDelta.MKind) != 0) a.Kind = r.U8();
                    if ((a.Mask & ActorDelta.MEffects) != 0) a.Effects = r.U16();
                    if ((a.Mask & ActorDelta.MDisplace) != 0) a.DisplaceSeq = r.U8();
                    if ((a.Mask & ActorDelta.MMobType) != 0) a.MobTypeCode = r.Code(30,"mob type");
                    if ((a.Mask & ActorDelta.MSig) != 0) a.Sig = r.U8();
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
                return d;
            }

            public override byte[] Encode()
            {
                if (Tick < BaseTick + 1 || Tick - BaseTick > Wire.MaxDeltaAge) throw new ArgumentException("base age");
                if (HasPhase && Phase > Wire.MaxPhaseCode) throw new ArgumentException("phase");
                if (ChangedCount > Wire.MaxActors || DepartedCount > Wire.MaxActors) throw new ArgumentException("too many actors");
                if (HasSelf && (Me.Mask & ~SelfDelta.Fields) != 0) throw new ArgumentException("head");
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
                if (HasSelf) head |= HPresent | (Me.Mask & SelfDelta.Fields);
                if (HasPhase) head |= HPhase;
                if (DepartedCount > 0) head |= HDeparted;
                w.Varint(head);
                if (HasSelf) Me.Write(w);
                if (HasPhase) w.U8(Phase);
                w.Varint((uint)ChangedCount);
                for (int i = 0; i < ChangedCount; i++)
                {
                    var a = Changed[i];
                    w.Varint(i == 0 ? a.Id : a.Id - Changed[i - 1].Id);
                    if ((a.Mask & ActorDelta.MMobType)!=0 && a.MobTypeCode>30) throw new ArgumentException("mob type");
                    w.Varint(a.Mask & ActorDelta.MAll);
                    if ((a.Mask & ActorDelta.MX) != 0) w.U16(a.X);
                    if ((a.Mask & ActorDelta.MY) != 0) w.U16(a.Y);
                    if ((a.Mask & ActorDelta.MFacing) != 0) w.U16(a.Facing);
                    if ((a.Mask & ActorDelta.MKit) != 0) w.U8(a.Kit);
                    if ((a.Mask & ActorDelta.MHp) != 0) w.U8(a.HpPct);
                    if ((a.Mask & ActorDelta.MBounty) != 0) w.Varint(a.Bounty);
                    if ((a.Mask & ActorDelta.MStatus) != 0) w.U8(a.Status);
                    if ((a.Mask & ActorDelta.MKind) != 0) w.U8(a.Kind);
                    if ((a.Mask & ActorDelta.MEffects) != 0) w.U16(a.Effects);
                    if ((a.Mask & ActorDelta.MDisplace) != 0) w.U8(a.DisplaceSeq);
                    if ((a.Mask & ActorDelta.MMobType) != 0) w.U8(a.MobTypeCode);
                    if ((a.Mask & ActorDelta.MSig) != 0) w.U8(a.Sig);
                }
                if (DepartedCount > 0)
                {
                    w.Varint((uint)DepartedCount);
                    for (int i = 0; i < DepartedCount; i++) w.Varint(i == 0 ? Departed[i] : Departed[i] - Departed[i - 1]);
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
                        case EventKind.Result: len += 20 + (e.Result.KilledBy == null ? 0 : 1 + System.Text.Encoding.UTF8.GetByteCount(e.Result.KilledBy)); break;
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
                        case EventKind.PotionNotice: if(e.PotionNotice<1 || e.PotionNotice>10) throw new ArgumentException("potion notice");w.U8(e.PotionNotice);break;
                        case EventKind.ChestRefused: if(e.ChestReason < 1 || e.ChestReason > 9) throw new ArgumentException("chest reason");w.U8(e.ChestReason);break;
                        case EventKind.PickupRefused: if (e.PickupReason < 1 || e.PickupReason > 5) throw new ArgumentException("pickup reason"); w.U8(e.PickupReason); break;
                        case EventKind.Death: w.U32(e.Id); if (e.By.HasValue) { w.U8(1); w.U32(e.By.Value); } else w.U8(0); break;
                        case EventKind.Bounty: w.U32(e.Id); w.U16(e.Bounty); break;
                        case EventKind.MatchEnded: if (e.Winner.HasValue) { w.U8(1); w.U32(e.Winner.Value); } else w.U8(0); w.U8((byte)(e.Draw ? 1 : 0)); break;
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

            public override byte[] Encode()
            {
                if (List.Count > ushort.MaxValue) throw new ArgumentException("too many fx");
                // Like rh-protocol: a swing off the position grid is refused, never saturated.
                foreach (var f in List)
                {
                    if (f.Kind != FxKind.Swing && f.Kind != FxKind.Hit && f.Kind != FxKind.Block && f.Kind != FxKind.Stagger)
                        throw new EncodeException("fx kind");
                    if (f.Kind == FxKind.Swing && (!Quant.PosInRange(f.X) || !Quant.PosInRange(f.Y))) throw new ArgumentException("position");
                }
                int len = 1 + Writer.VarintLength(Tick) + Writer.VarintLength((uint)List.Count);
                foreach (var f in List)
                    len += f.Kind == FxKind.Block ? 2 + Writer.VarintLength(f.Id) + Writer.VarintLength(f.By) : f.Kind == FxKind.Stagger ? 1 + Writer.VarintLength(f.Id) : f.Kind == FxKind.Swing ? 1 + Writer.VarintLength(f.By) + 1 + 6 : 1 + Writer.VarintLength(f.Victim) + Writer.VarintLength(f.By) + 5;
                if (len > Wire.MaxServerFrame) throw new ArgumentException("frame too large");
                var w = new Writer(len);
                w.U8(TFx); w.Varint(Tick); w.Varint((uint)List.Count);
                foreach (var f in List)
                {
                    w.U8((byte)f.Kind);
                    if (f.Kind == FxKind.Swing) { w.Varint(f.By); w.U8(f.Weapon); w.U16(Quant.QuantizePos(f.X)); w.U16(Quant.QuantizePos(f.Y)); w.U16(Quant.QuantizeFacing(f.A)); }
                    else if (f.Kind == FxKind.Block) { w.Varint(f.Id); w.Varint(f.By); w.U8(f.Weapon); }
                    else if (f.Kind == FxKind.Stagger) w.Varint(f.Id);
                    else { w.Varint(f.Victim); w.Varint(f.By); w.F32(f.Amount); w.U8((byte)(f.Passive ? 1 : 0)); }
                }
                return w.Finish();
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
