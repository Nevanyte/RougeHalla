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
        const byte THello = 0x01, TInput = 0x02, TPing = 0x03, TLeave = 0x04;

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

        internal const int WireSize = 36;

        internal void Read(ref Reader r)
        {
            Id = r.U32(); Faction = r.U8(); X = r.F32(); Y = r.F32(); Facing = r.F32(); Hp = r.F32(); MaxHp = r.F32();
            Status = r.U8(); Weapon = r.U8(); ReadyInMs = r.U16(); Kills = r.U16(); Bounty = r.U16(); Gv = r.U16(); MoveSeq = r.U8();
        }

        internal void Write(Writer w)
        {
            w.U32(Id); w.U8(Faction); w.F32(X); w.F32(Y); w.F32(Facing); w.F32(Hp); w.F32(MaxHp);
            w.U8(Status); w.U8(Weapon); w.U16(ReadyInMs); w.U16(Kills); w.U16(Bounty); w.U16(Gv); w.U8(MoveSeq);
        }
    }

    /// <summary>
    /// One visible actor. A value type: a snapshot's actors live inline in its array (no object per actor). The fields are
    /// declared widest first so the struct packs into 24 bytes; the wire order is fixed by <see cref="Read"/>/<see cref="Write"/>.
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

        internal const int WireSize = 22;

        internal static WireActor Read(ref Reader r)
        {
            WireActor a;
            a.Id = r.U32(); a.Faction = r.U8(); a.X = r.F32(); a.Y = r.F32(); a.Facing = r.F32(); a.HpPct = r.U8();
            a.Status = r.U8(); a.Weapon = r.U8(); a.Bounty = r.U16();
            return a;
        }

        internal void Write(Writer w)
        {
            w.U32(Id); w.U8(Faction); w.F32(X); w.F32(Y); w.F32(Facing); w.U8(HpPct); w.U8(Status); w.U8(Weapon); w.U16(Bounty);
        }
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
        const byte TWelcome = 0x81, TReject = 0x82, TSnapshot = 0x83, TEvents = 0x84, TFx = 0x85, TPong = 0x86;

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
                    var f = new Fx { Tick = r.U32() };
                    int n = r.U16();
                    for (int i = 0; i < n; i++)
                    {
                        byte tag = r.U8();
                        switch (tag)
                        {
                            case 1: f.List.Add(new WireFx { Kind = FxKind.Swing, By = r.U32(), Weapon = r.U8(), X = r.F32(), Y = r.F32(), A = r.F32() }); break;
                            case 2: f.List.Add(new WireFx { Kind = FxKind.Hit, Victim = r.U32(), By = r.U32(), Amount = r.F32() }); break;
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
            public double ServerMs;
            public byte Phase;
            public uint AckInput;
            /// <summary>Null for a spectator (or a dead player's view without a self).</summary>
            public WireSelf Me;
            /// <summary>Sorted by id (C-OBS). Never null; shared empty array when nothing is visible.</summary>
            public WireActor[] Actors = Array.Empty<WireActor>();

            /// <summary>Exact size of <see cref="Encode"/>'s frame.</summary>
            public int EncodedLength { get { return 18 + (Me != null ? 1 + WireSelf.WireSize : 1) + 2 + WireActor.WireSize * Actors.Length; } }

            public override byte[] Encode()
            {
                // The encoder never writes a frame every decoder rejects (and never trims one to fit): rh-protocol does the same.
                if (Actors.Length > Wire.MaxActors) throw new ArgumentException("more than " + Wire.MaxActors + " actors");
                var w = new Writer(EncodedLength);
                w.U8(TSnapshot); w.U32(Tick); w.F64(ServerMs); w.U8(Phase); w.U32(AckInput);
                if (Me != null) { w.U8(1); Me.Write(w); }
                else w.U8(0);
                w.U16((ushort)Actors.Length);
                for (int i = 0; i < Actors.Length; i++) Actors[i].Write(w);
                return w.Finish();
            }

            /// <summary>Reads the body of a Snapshot frame into <paramref name="s"/>, reusing its Me object and actor array.</summary>
            internal static Snapshot Read(ref Reader r, Snapshot s)
            {
                s.Tick = r.U32(); s.ServerMs = r.F64(); s.Phase = r.U8(); s.AckInput = r.U32();
                if (r.Flag())
                {
                    var me = s.Me ?? new WireSelf();
                    me.Read(ref r);
                    s.Me = me;
                }
                else s.Me = null;
                int n = r.U16();
                if (n > Wire.MaxActors) throw new DecodeException(DecodeError.TooMany, n.ToString());
                var actors = s.Actors;
                if (actors == null || actors.Length != n) actors = n == 0 ? Array.Empty<WireActor>() : new WireActor[n];
                for (int i = 0; i < n; i++) actors[i] = WireActor.Read(ref r);
                s.Actors = actors;
                return s;
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
                int len = 7;
                foreach (var f in List) len += f.Kind == FxKind.Swing ? 18 : 13;
                var w = new Writer(len);
                w.U8(TFx); w.U32(Tick); w.U16((ushort)List.Count);
                foreach (var f in List)
                {
                    w.U8((byte)f.Kind);
                    if (f.Kind == FxKind.Swing) { w.U32(f.By); w.U8(f.Weapon); w.F32(f.X); w.F32(f.Y); w.F32(f.A); }
                    else { w.U32(f.Victim); w.U32(f.By); w.F32(f.Amount); }
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
