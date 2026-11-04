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
                var w = new Writer();
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
        }

        public sealed class Ping : ClientMsg
        {
            public uint Nonce;
            public double ClientMs;
            public override byte[] Encode() { var w = new Writer(); w.U8(TPing); w.U32(Nonce); w.F64(ClientMs); return w.Finish(); }
        }

        public sealed class Leave : ClientMsg
        {
            public override byte[] Encode() { return new[] { TLeave }; }
        }
    }

    public sealed class WireSelf
    {
        public uint Id;
        public byte Faction;
        public float X, Y, Facing, Hp, MaxHp;
        public byte Status, Weapon;
        public ushort ReadyInMs, Kills, Bounty, Gv;
        public byte MoveSeq;
    }

    public sealed class WireActor
    {
        public uint Id;
        public byte Faction;
        public float X, Y, Facing;
        /// <summary>hp fraction in hundredths (0..100).</summary>
        public byte HpPct;
        public byte Status, Weapon;
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
        const byte TWelcome = 0x81, TReject = 0x82, TSnapshot = 0x83, TEvents = 0x84, TFx = 0x85, TPong = 0x86;

        public abstract byte[] Encode();

        public static ServerMsg Decode(byte[] frame) { return Decode(frame, frame.Length); }

        /// <summary>Decodes the first <paramref name="length"/> bytes (transports may hand over a reused buffer).</summary>
        public static ServerMsg Decode(byte[] frame, int length)
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
                        TickRate = r.U8(), Tick = r.U32(), ServerMs = r.F64(), Map = MapBlob.Read(r),
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
                {
                    var s = new Snapshot { Tick = r.U32(), ServerMs = r.F64(), Phase = r.U8(), AckInput = r.U32() };
                    if (r.Flag())
                        s.Me = new WireSelf
                        {
                            Id = r.U32(), Faction = r.U8(), X = r.F32(), Y = r.F32(), Facing = r.F32(), Hp = r.F32(), MaxHp = r.F32(),
                            Status = r.U8(), Weapon = r.U8(), ReadyInMs = r.U16(), Kills = r.U16(), Bounty = r.U16(), Gv = r.U16(), MoveSeq = r.U8(),
                        };
                    int n = r.U16();
                    if (n > Wire.MaxActors) throw new DecodeException(DecodeError.TooMany, n.ToString());
                    s.Actors = new WireActor[n];
                    for (int i = 0; i < n; i++)
                        s.Actors[i] = new WireActor
                        {
                            Id = r.U32(), Faction = r.U8(), X = r.F32(), Y = r.F32(), Facing = r.F32(), HpPct = r.U8(),
                            Status = r.U8(), Weapon = r.U8(), Bounty = r.U16(),
                        };
                    msg = s;
                    break;
                }
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
                var w = new Writer();
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
            public WireSelf Me;
            public WireActor[] Actors = new WireActor[0];

            public override byte[] Encode()
            {
                var w = new Writer();
                w.U8(TSnapshot); w.U32(Tick); w.F64(ServerMs); w.U8(Phase); w.U32(AckInput);
                if (Me != null)
                {
                    w.U8(1);
                    w.U32(Me.Id); w.U8(Me.Faction); w.F32(Me.X); w.F32(Me.Y); w.F32(Me.Facing); w.F32(Me.Hp); w.F32(Me.MaxHp);
                    w.U8(Me.Status); w.U8(Me.Weapon); w.U16(Me.ReadyInMs); w.U16(Me.Kills); w.U16(Me.Bounty); w.U16(Me.Gv); w.U8(Me.MoveSeq);
                }
                else w.U8(0);
                w.U16((ushort)Actors.Length);
                foreach (var a in Actors)
                {
                    w.U32(a.Id); w.U8(a.Faction); w.F32(a.X); w.F32(a.Y); w.F32(a.Facing); w.U8(a.HpPct); w.U8(a.Status); w.U8(a.Weapon); w.U16(a.Bounty);
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
                var w = new Writer();
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
            public override byte[] Encode() { var w = new Writer(); w.U8(TPong); w.U32(Nonce); w.F64(ClientMs); w.F64(ServerMs); return w.Finish(); }
        }
    }
}
