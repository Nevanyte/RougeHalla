using System;
using System.Collections.Generic;

namespace Roguehalla.Net.Protocol
{
    /// <summary>Wire format: append only.</summary>
    public enum RejectCode : ushort
    {
        ProtocolMismatch = 1, ContentMismatch = 2, BadCredentials = 3, ProfileInUse = 4, MatchFull = 5, RateLimited = 6,
        Malformed = 7, TooSlow = 8, ServerDraining = 9, NoSuchSession = 10, Kicked = 11,
    }

    public enum CommandKind : byte { Move = 1, Stop = 2, Aim = 3, Attack = 4, Release = 5 }

    /// <summary>A client command. Only the fields of its Kind are meaningful.</summary>
    public sealed class WireCommand
    {
        public CommandKind Kind;
        public float X, Y;
        /// <summary>Aim angle (Aim, Attack, Release).</summary>
        public float A;
        /// <summary>Order sequence echoed in Snapshot.me.move_seq (Move, Stop).</summary>
        public byte? Seq;
        /// <summary>Client render time in server ms (Attack, Release); lag compensation, clamped by the server.</summary>
        public double? T;

        public static WireCommand Move(float x, float y, byte? seq) { return new WireCommand { Kind = CommandKind.Move, X = x, Y = y, Seq = seq }; }
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
                    var h = new Hello { Protocol = r.U16(), ContentHash = r.U64(), Build = r.Str(), Profile = r.Str(), Token = r.Str() };
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
            public string Build = "", Profile = "", Token = "";
            public byte? Faction;
            public byte[] Resume;

            public override byte[] Encode()
            {
                var w = new Writer();
                w.U8(THello); w.U16(Protocol); w.U64(ContentHash); w.Str(Build); w.Str(Profile); w.Str(Token);
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
                    case CommandKind.Move: return 9 + (c.Seq.HasValue ? 2 : 1);
                    case CommandKind.Stop: return 1 + (c.Seq.HasValue ? 2 : 1);
                    case CommandKind.Aim: return 5;
                    default: return 5 + (c.T.HasValue ? 9 : 1);
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
        public byte MoveSeq;

        internal void CopyFrom(WireSelf o)
        {
            Id = o.Id; Faction = o.Faction; X = o.X; Y = o.Y; Facing = o.Facing; Hp = o.Hp; MaxHp = o.MaxHp; Status = o.Status; Weapon = o.Weapon;
            ReadyInMs = o.ReadyInMs; Kills = o.Kills; Bounty = o.Bounty; Gv = o.Gv; MoveSeq = o.MoveSeq;
        }

        // Head word bits (rh-protocol lib.rs): the self's field bits 0..9, phase in bits 12..13, bit 15 = a self follows.
        internal const ushort HKit = 1 << 0, HHp = 1 << 1, HReady = 1 << 4, HKills = 1 << 5, HBounty = 1 << 6, HGv = 1 << 7,
            HMoveSeq = 1 << 8, HMaxHpF32 = 1 << 9, HPresent = 1 << 15;
        internal const int StatusShift = 2, PhaseShift = 12;
        internal const ushort SelfBits = 0x03ff | HPresent, Known = SelfBits | (3 << PhaseShift);

        static bool MaxHpIsVarint(float v)
        {
            if (!(v >= 0f && v <= 65535f)) return false;
            return BitConverter.SingleToInt32Bits(v) == BitConverter.SingleToInt32Bits((float)(ushort)v);
        }

        internal static byte Kit(byte faction, byte weapon) { return (byte)((faction & 0x0f) | (weapon << 4)); }

        internal ushort Head(byte phase)
        {
            int m = (phase & 3) << PhaseShift;
            m |= HPresent | ((Status & 3) << StatusShift);
            if (Kit(Faction, Weapon) != 0) m |= HKit;
            if (BitConverter.SingleToInt32Bits(Hp) != BitConverter.SingleToInt32Bits(MaxHp)) m |= HHp;
            if (ReadyInMs != 0) m |= HReady;
            if (Kills != 0) m |= HKills;
            if (Bounty != 0) m |= HBounty;
            if (Gv != 0) m |= HGv;
            if (MoveSeq != 0) m |= HMoveSeq;
            if (!MaxHpIsVarint(MaxHp)) m |= HMaxHpF32;
            return (ushort)m;
        }

        /// <summary>Bytes after the head word.</summary>
        internal int Length(ushort head)
        {
            int n = Writer.VarintLength(Id) + 12;
            n += (head & HMaxHpF32) != 0 ? 4 : Writer.VarintLength((uint)MaxHp);
            if ((head & HKit) != 0) n += 1;
            if ((head & HHp) != 0) n += 4;
            if ((head & HReady) != 0) n += 2;
            if ((head & HKills) != 0) n += Writer.VarintLength(Kills);
            if ((head & HBounty) != 0) n += Writer.VarintLength(Bounty);
            if ((head & HGv) != 0) n += Writer.VarintLength(Gv);
            if ((head & HMoveSeq) != 0) n += 1;
            return n;
        }

        /// <summary>Reads the self after its head word (<paramref name="head"/> has HPresent set).</summary>
        internal void Read(ref Reader r, ushort head)
        {
            Id = r.Varint(); X = r.F32(); Y = r.F32(); Facing = r.F32();
            MaxHp = (head & HMaxHpF32) != 0 ? r.F32() : r.VarintU16("max_hp");
            if ((head & HKit) != 0) { byte k = r.U8(); Faction = (byte)(k & 0x0f); Weapon = (byte)(k >> 4); } else { Faction = 0; Weapon = 0; }
            Hp = (head & HHp) != 0 ? r.F32() : MaxHp;
            ReadyInMs = (head & HReady) != 0 ? r.U16() : (ushort)0;
            Kills = (head & HKills) != 0 ? r.VarintU16("kills") : (ushort)0;
            Bounty = (head & HBounty) != 0 ? r.VarintU16("bounty") : (ushort)0;
            Gv = (head & HGv) != 0 ? r.VarintU16("gv") : (ushort)0;
            MoveSeq = (head & HMoveSeq) != 0 ? r.U8() : (byte)0;
            Status = (byte)((head >> StatusShift) & 3);
        }

        internal void Write(Writer w, ushort head)
        {
            w.Varint(Id); w.F32(X); w.F32(Y); w.F32(Facing);
            if ((head & HMaxHpF32) != 0) w.F32(MaxHp); else w.Varint((uint)MaxHp);
            if ((head & HKit) != 0) w.U8(Kit(Faction, Weapon));
            if ((head & HHp) != 0) w.F32(Hp);
            if ((head & HReady) != 0) w.U16(ReadyInMs);
            if ((head & HKills) != 0) w.Varint(Kills);
            if ((head & HBounty) != 0) w.Varint(Bounty);
            if ((head & HGv) != 0) w.Varint(Gv);
            if ((head & HMoveSeq) != 0) w.U8(MoveSeq);
        }
    }

    /// <summary>
    /// One visible actor. A value type: a snapshot's actors live inline in its array (no object per actor). The fields are
    /// declared widest first so the struct packs into 24 bytes; the wire order is fixed by <see cref="Read"/>/<see cref="Write"/>.
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

        // Actor mask bits: 0 kit, 1 hp, 2..3 status (inline), 4 bounty, 5..7 reserved.
        internal const byte MKit = 1 << 0, MHp = 1 << 1, MBounty = 1 << 4, MKnown = MKit | MHp | (3 << 2) | MBounty;
        internal const int StatusShift = 2;
        internal const byte DefaultHpPct = 100;

        internal byte Mask()
        {
            int m = (Status & 3) << StatusShift;
            if (WireSelf.Kit(Faction, Weapon) != 0) m |= MKit;
            if (HpPct != DefaultHpPct) m |= MHp;
            if (Bounty != 0) m |= MBounty;
            return (byte)m;
        }

        internal static uint IdField(uint id, bool first, uint prev) { return first ? id : unchecked(id - prev); }

        internal int Length(bool first, uint prev)
        {
            byte m = Mask();
            return Writer.VarintLength(IdField(Id, first, prev)) + 7 + ((m & MKit) != 0 ? 1 : 0) + ((m & MHp) != 0 ? 1 : 0)
                + ((m & MBounty) != 0 ? Writer.VarintLength(Bounty) : 0);
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
            byte mask = r.U8();
            if ((mask & ~MKnown) != 0) throw new DecodeException(DecodeError.BadField, "actor mask");
            a.X = Quant.DequantizePos(r.U16()); a.Y = Quant.DequantizePos(r.U16()); a.Facing = Quant.DequantizeFacing(r.U16());
            if ((mask & MKit) != 0) { byte k = r.U8(); a.Faction = (byte)(k & 0x0f); a.Weapon = (byte)(k >> 4); } else { a.Faction = 0; a.Weapon = 0; }
            a.HpPct = (mask & MHp) != 0 ? r.U8() : DefaultHpPct;
            if (a.HpPct > 100) throw new DecodeException(DecodeError.BadField, "hp_pct");
            a.Bounty = (mask & MBounty) != 0 ? r.VarintU16("bounty") : (ushort)0;
            a.Status = (byte)((mask >> StatusShift) & 3);
            return a;
        }

        internal void Write(Writer w, bool first, uint prev)
        {
            byte m = Mask();
            w.Varint(IdField(Id, first, prev)); w.U8(m);
            w.U16(Quant.QuantizePos(X)); w.U16(Quant.QuantizePos(Y)); w.U16(Quant.QuantizeFacing(Facing));
            if ((m & MKit) != 0) w.U8(WireSelf.Kit(Faction, Weapon));
            if ((m & MHp) != 0) w.U8(HpPct);
            if ((m & MBounty) != 0) w.Varint(Bounty);
        }
    }

    /// <summary>
    /// The changed self fields of a snapshot delta: <see cref="Mask"/> has the head's field bits (0..11); only the fields whose
    /// bit is set mean anything. The self's id is the base's.
    /// </summary>
    public struct SelfDelta
    {
        public const ushort FX = 1 << 0, FY = 1 << 1, FFacing = 1 << 2, FHp = 1 << 3, FMaxHp = 1 << 4, FKit = 1 << 5, FReady = 1 << 6,
            FKills = 1 << 7, FBounty = 1 << 8, FGv = 1 << 9, FMoveSeq = 1 << 10, FStatus = 1 << 11;
        public ushort Mask;
        public float X, Y, Facing, Hp, MaxHp;
        public byte Kit;
        public ushort ReadyInMs, Kills, Bounty, Gv;
        public byte MoveSeq;
        /// <summary>The new status (0..3) when <see cref="FStatus"/> is set in <see cref="Mask"/>.</summary>
        public byte StatusValue;

        internal static SelfDelta Read(ref Reader r, ushort mask)
        {
            var s = new SelfDelta { Mask = mask };
            if ((mask & FX) != 0) s.X = r.F32();
            if ((mask & FY) != 0) s.Y = r.F32();
            if ((mask & FFacing) != 0) s.Facing = r.F32();
            if ((mask & FHp) != 0) s.Hp = r.F32();
            if ((mask & FMaxHp) != 0) s.MaxHp = r.F32();
            if ((mask & FKit) != 0) s.Kit = r.U8();
            if ((mask & FReady) != 0) s.ReadyInMs = r.U16();
            if ((mask & FKills) != 0) s.Kills = r.VarintU16("kills");
            if ((mask & FBounty) != 0) s.Bounty = r.VarintU16("bounty");
            if ((mask & FGv) != 0) s.Gv = r.VarintU16("gv");
            if ((mask & FMoveSeq) != 0) s.MoveSeq = r.U8();
            if ((mask & FStatus) != 0)
            {
                s.StatusValue = r.U8();
                if (s.StatusValue > Wire.MaxStatusCode) throw new DecodeException(DecodeError.BadField, "status");
            }
            return s;
        }

        internal void Write(Writer w)
        {
            if ((Mask & FX) != 0) w.F32(X);
            if ((Mask & FY) != 0) w.F32(Y);
            if ((Mask & FFacing) != 0) w.F32(Facing);
            if ((Mask & FHp) != 0) w.F32(Hp);
            if ((Mask & FMaxHp) != 0) w.F32(MaxHp);
            if ((Mask & FKit) != 0) w.U8(Kit);
            if ((Mask & FReady) != 0) w.U16(ReadyInMs);
            if ((Mask & FKills) != 0) w.Varint(Kills);
            if ((Mask & FBounty) != 0) w.Varint(Bounty);
            if ((Mask & FGv) != 0) w.Varint(Gv);
            if ((Mask & FMoveSeq) != 0) w.U8(MoveSeq);
            if ((Mask & FStatus) != 0) w.U8(StatusValue);
        }

        internal void ApplyTo(WireSelf s)
        {
            if ((Mask & FX) != 0) s.X = X;
            if ((Mask & FY) != 0) s.Y = Y;
            if ((Mask & FFacing) != 0) s.Facing = Facing;
            if ((Mask & FHp) != 0) s.Hp = Hp;
            if ((Mask & FMaxHp) != 0) s.MaxHp = MaxHp;
            if ((Mask & FKit) != 0) { s.Faction = (byte)(Kit & 0x0f); s.Weapon = (byte)(Kit >> 4); }
            if ((Mask & FReady) != 0) s.ReadyInMs = ReadyInMs;
            if ((Mask & FKills) != 0) s.Kills = Kills;
            if ((Mask & FBounty) != 0) s.Bounty = Bounty;
            if ((Mask & FGv) != 0) s.Gv = Gv;
            if ((Mask & FMoveSeq) != 0) s.MoveSeq = MoveSeq;
            if ((Mask & FStatus) != 0) s.Status = StatusValue;
        }
    }

    /// <summary>
    /// One changed remote actor of a snapshot delta: <see cref="Mask"/> (bits <see cref="X"/>..<see cref="Bounty"/>) says which
    /// quantized fields are carried; the status always is. A new actor carries every field (<see cref="All"/>).
    /// </summary>
    public struct ActorDelta
    {
        public const byte MX = 1 << 0, MY = 1 << 1, MFacing = 1 << 2, MKit = 1 << 3, MHp = 1 << 4, MBounty = 1 << 5, MAll = 0x3f;
        public const int StatusShift = 6;
        public uint Id;
        public byte Mask;
        public ushort X, Y, Facing;
        public byte Kit, HpPct, Status;
        public ushort Bounty;
    }

    public enum EventKind : byte { Death = 1, Bounty = 2, MatchEnded = 3, Result = 4 }

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
    }

    public sealed class WireResult
    {
        public byte Outcome, Place, Players;
        public ushort Kills;
        public string KilledBy;
        public uint GvTotal, GvWin, DurationSec;
        public bool WinBonusWithheld;
    }

    public enum FxKind : byte { Swing = 1, Hit = 2 }

    public sealed class WireFx
    {
        public FxKind Kind;
        public uint By, Victim;
        public byte Weapon;
        public float X, Y, A, Amount;
    }

    public abstract class ServerMsg
    {
        const byte TWelcome = 0x81, TReject = 0x82, TSnapshot = 0x83, TEvents = 0x84, TFx = 0x85, TPong = 0x86, TSnapshotDelta = 0x87;

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
                    if (code < 1 || code > 11) throw new DecodeException(DecodeError.BadTag, "reject code " + code);
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
                            case 2: { uint victim = r.Varint(), by = r.Varint(); f.List.Add(new WireFx { Kind = FxKind.Hit, Victim = victim, By = by, Amount = r.F32() }); break; }
                            default: throw new DecodeException(DecodeError.BadTag, tag.ToString());
                        }
                    }
                    msg = f;
                    break;
                }
                case TPong: msg = new Pong { Nonce = r.U32(), ClientMs = r.F64(), ServerMs = r.F64() }; break;
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
                    int n = 1 + Writer.VarintLength(Tick) + Writer.VarintLength(AckInput) + 2;
                    if (Me != null) n += Me.Length(Me.Head(Phase));
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
                for (int i = 0; i < Actors.Length; i++)
                {
                    var a = Actors[i];
                    if (a.Faction > Wire.MaxKitCode || a.Weapon > Wire.MaxKitCode || a.Status > Wire.MaxStatusCode) throw new ArgumentException("actor faction/weapon/status");
                    if (a.HpPct > 100) throw new ArgumentException("hp_pct");
                    if (i > 0 && a.Id <= Actors[i - 1].Id) throw new ArgumentException("actor ids must strictly ascend");
                }
                var w = new Writer(EncodedLength);
                w.U8(TSnapshot); w.Varint(Tick); w.Varint(AckInput);
                if (Me != null) { ushort head = Me.Head(Phase); w.U16(head); Me.Write(w, head); }
                else w.U16((ushort)((Phase & 3) << WireSelf.PhaseShift));
                w.Varint((uint)Actors.Length);
                uint prev = 0;
                for (int i = 0; i < Actors.Length; i++) { Actors[i].Write(w, i == 0, prev); prev = Actors[i].Id; }
                return w.Finish();
            }

            /// <summary>Reads the body of a Snapshot frame into <paramref name="s"/>, reusing its Me object and actor array.</summary>
            internal static Snapshot Read(ref Reader r, Snapshot s)
            {
                s.Tick = r.Varint(); s.AckInput = r.Varint();
                ushort head = r.U16();
                if ((head & ~WireSelf.Known) != 0 || ((head & WireSelf.HPresent) == 0 && (head & WireSelf.SelfBits) != 0))
                    throw new DecodeException(DecodeError.BadField, "head");
                s.Phase = (byte)((head >> WireSelf.PhaseShift) & 3);
                if ((head & WireSelf.HPresent) != 0)
                {
                    var me = s.Me ?? new WireSelf();
                    me.Read(ref r, head);
                    s.Me = me;
                }
                else s.Me = null;
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
        /// A snapshot as a delta against the last one the connection received (v3; layout in crates/rh-protocol/src/lib.rs). A
        /// client does not use this directly: <see cref="SnapshotTracker"/> applies it and hands out the resolved
        /// <see cref="Snapshot"/>. The lists are arrays with counts so that a tracker's one instance decodes every frame without
        /// garbage.
        /// </summary>
        public sealed class SnapshotDelta : ServerMsg
        {
            public uint Tick, BaseTick, AckInput;
            public byte Phase;
            public bool HasSelf;
            public SelfDelta Me;
            public ActorDelta[] Changed = new ActorDelta[8];
            public int ChangedCount;
            public uint[] Departed = new uint[8];
            public int DepartedCount;

            // Head word: bit 15 a self follows, bit 14 a departed list follows, bits 12..13 phase, bits 0..11 the self fields.
            const ushort HDeparted = 1 << 14, HPresent = 1 << 15, Fields = 0x0fff;
            const int PhaseShift = 12;

            /// <summary>Reads the body of a delta frame (after the tag): syntax and ranges only; whether it applies is the tracker's question.</summary>
            internal static SnapshotDelta Read(ref Reader r, SnapshotDelta d)
            {
                d.Tick = r.Varint();
                uint age = r.Varint();
                if (age < 1 || age > Wire.MaxDeltaAge || age > d.Tick) throw new DecodeException(DecodeError.BadField, "base age");
                d.BaseTick = d.Tick - age;
                d.AckInput = r.Varint();
                ushort head = r.U16();
                if ((head & HPresent) == 0 && (head & Fields) != 0) throw new DecodeException(DecodeError.BadField, "head");
                d.Phase = (byte)((head >> PhaseShift) & 3);
                d.HasSelf = (head & HPresent) != 0;
                d.Me = d.HasSelf ? SelfDelta.Read(ref r, (ushort)(head & Fields)) : default(SelfDelta);
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
                    byte m = r.U8();
                    a.Mask = (byte)(m & ActorDelta.MAll);
                    a.Status = (byte)(m >> ActorDelta.StatusShift);
                    if ((a.Mask & ActorDelta.MX) != 0) a.X = r.U16();
                    if ((a.Mask & ActorDelta.MY) != 0) a.Y = r.U16();
                    if ((a.Mask & ActorDelta.MFacing) != 0) a.Facing = r.U16();
                    if ((a.Mask & ActorDelta.MKit) != 0) a.Kit = r.U8();
                    if ((a.Mask & ActorDelta.MHp) != 0) { a.HpPct = r.U8(); if (a.HpPct > 100) throw new DecodeException(DecodeError.BadField, "hp_pct"); }
                    if ((a.Mask & ActorDelta.MBounty) != 0) a.Bounty = r.VarintU16("bounty");
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
                if (Phase > Wire.MaxPhaseCode) throw new ArgumentException("phase");
                if (ChangedCount > Wire.MaxActors || DepartedCount > Wire.MaxActors) throw new ArgumentException("too many actors");
                if (HasSelf && (Me.Mask & ~Fields) != 0) throw new ArgumentException("head");
                if (HasSelf && (Me.Mask & SelfDelta.FStatus) != 0 && Me.StatusValue > Wire.MaxStatusCode) throw new ArgumentException("status");
                for (int i = 0; i < ChangedCount; i++)
                {
                    var a = Changed[i];
                    if (a.Status > Wire.MaxStatusCode || (a.Mask & ~ActorDelta.MAll) != 0) throw new ArgumentException("actor mask or status");
                    if ((a.Mask & ActorDelta.MHp) != 0 && a.HpPct > 100) throw new ArgumentException("hp_pct");
                    if (i > 0 && a.Id <= Changed[i - 1].Id) throw new ArgumentException("actor ids must strictly ascend");
                }
                for (int i = 1; i < DepartedCount; i++) if (Departed[i] <= Departed[i - 1]) throw new ArgumentException("departed ids must strictly ascend");
                var w = new Writer();
                w.U8(TSnapshotDelta); w.Varint(Tick); w.Varint(Tick - BaseTick); w.Varint(AckInput);
                ushort head = (ushort)((Phase & 3) << PhaseShift);
                if (HasSelf) head |= (ushort)(HPresent | (Me.Mask & Fields));
                if (DepartedCount > 0) head |= HDeparted;
                w.U16(head);
                if (HasSelf) Me.Write(w);
                w.Varint((uint)ChangedCount);
                for (int i = 0; i < ChangedCount; i++)
                {
                    var a = Changed[i];
                    w.Varint(i == 0 ? a.Id : a.Id - Changed[i - 1].Id);
                    w.U8((byte)((a.Mask & ActorDelta.MAll) | (a.Status << ActorDelta.StatusShift)));
                    if ((a.Mask & ActorDelta.MX) != 0) w.U16(a.X);
                    if ((a.Mask & ActorDelta.MY) != 0) w.U16(a.Y);
                    if ((a.Mask & ActorDelta.MFacing) != 0) w.U16(a.Facing);
                    if ((a.Mask & ActorDelta.MKit) != 0) w.U8(a.Kit);
                    if ((a.Mask & ActorDelta.MHp) != 0) w.U8(a.HpPct);
                    if ((a.Mask & ActorDelta.MBounty) != 0) w.Varint(a.Bounty);
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
                var w = new Writer();
                w.U8(TEvents); w.U32(Tick); w.U16((ushort)List.Count);
                foreach (var e in List)
                {
                    w.U8((byte)e.Kind);
                    switch (e.Kind)
                    {
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
                int len = 1 + Writer.VarintLength(Tick) + Writer.VarintLength((uint)List.Count);
                foreach (var f in List)
                    len += f.Kind == FxKind.Swing ? 1 + Writer.VarintLength(f.By) + 1 + 6 : 1 + Writer.VarintLength(f.Victim) + Writer.VarintLength(f.By) + 4;
                var w = new Writer(len);
                w.U8(TFx); w.Varint(Tick); w.Varint((uint)List.Count);
                foreach (var f in List)
                {
                    w.U8((byte)f.Kind);
                    if (f.Kind == FxKind.Swing) { w.Varint(f.By); w.U8(f.Weapon); w.U16(Quant.QuantizePos(f.X)); w.U16(Quant.QuantizePos(f.Y)); w.U16(Quant.QuantizeFacing(f.A)); }
                    else { w.Varint(f.Victim); w.Varint(f.By); w.F32(f.Amount); }
                }
                return w.Finish();
            }
        }

        public sealed class Pong : ServerMsg
        {
            public uint Nonce;
            public double ClientMs, ServerMs;
            public override byte[] Encode() { var w = new Writer(21); w.U8(TPong); w.U32(Nonce); w.F64(ClientMs); w.F64(ServerMs); return w.Finish(); }
        }
    }
}
