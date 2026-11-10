using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>Protocol 15 beyond the golden vectors: the stamped move send path, step-coded positions, remote windups and projectile tracks.</summary>
    public class NetcodeV15Tests
    {
        static T RoundTrip<T>(T msg) where T : ServerMsg { return (T)ServerMsg.Decode(msg.Encode()); }

        // ---- stamped orders ----

        [Test]
        public void MovesCarryTheIssueTimeOnlyWhenTheClockHasASample()
        {
            var plain = new InputSender();
            plain.Move(1, 2); plain.AttackMove(3, 4);
            var f = plain.Flush(0)[0].Commands;
            Assert.AreEqual(CommandKind.Move, f[0].Kind); Assert.AreEqual(CommandKind.AttackMove, f[1].Kind);

            double? clock = 12345.5;
            var stamped = new InputSender { OrderClock = () => clock };
            byte s1 = stamped.Move(1, 2); byte s2 = stamped.AttackMove(3, 4);
            clock = null; stamped.Move(5, 6);
            clock = double.NaN; stamped.Move(7, 8);
            var cmds = stamped.Flush(0)[0].Commands;
            Assert.AreEqual(CommandKind.MoveAt, cmds[0].Kind); Assert.AreEqual(s1, cmds[0].Seq); Assert.AreEqual(12345.5, cmds[0].T);
            Assert.AreEqual(CommandKind.AttackMoveAt, cmds[1].Kind); Assert.AreEqual(s2, cmds[1].Seq); Assert.AreEqual(12345.5, cmds[1].T);
            Assert.AreEqual(CommandKind.Move, cmds[2].Kind, "no clock sample: the plain order");
            Assert.AreEqual(CommandKind.Move, cmds[3].Kind, "a non-finite stamp is never sent");

            var back = (ClientMsg.Input)ClientMsg.Decode(new ClientMsg.Input { Seq = 1, Commands = { WireCommand.MoveAt(1, 2, 3, 99.5), WireCommand.AttackMoveAt(4, 5, null, 0) } }.Encode());
            Assert.AreEqual(99.5, back.Commands[0].T); Assert.AreEqual((byte)3, back.Commands[0].Seq);
            Assert.IsNull(back.Commands[1].Seq); Assert.AreEqual(0.0, back.Commands[1].T);
            Assert.Throws<ArgumentException>(() => new ClientMsg.Input { Commands = { WireCommand.MoveAt(1, 2, 1, double.PositiveInfinity) } }.Encode());
        }

        [Test]
        public void ASessionStampsTheClickWithServerTimeNotRenderTime()
        {
            double now = 1000;
            var s = new Session(new FakeTransport(), new SessionOptions { Now = () => now });
            s.OrderMove(1, 2);
            Assert.AreEqual(CommandKind.Move, s.Input.Flush(now)[0].Commands[0].Kind, "before the first Pong");
            s.Sync.OnPong(new ServerMsg.Pong { Nonce = 1, ClientMs = 900, ServerMs = 5000 }, now); // rtt 100 -> offset 4050
            now = 1200;
            s.OrderMove(3, 4);
            var c = s.Input.Flush(now)[0].Commands[0];
            Assert.AreEqual(CommandKind.MoveAt, c.Kind); Assert.AreEqual(1200 + 4050.0, c.T);
        }

        // ---- step positions and remote facing ----

        static ServerMsg.Snapshot Full(float x, float y)
        {
            return new ServerMsg.Snapshot { Tick = 10, Phase = Wire.DefaultPhase, Actors = new[] { new WireActor { Id = 5, X = x, Y = y, Status = Wire.DefaultStatus, HpPct = 100 } } };
        }

        [Test]
        public void AStepDeltaDecodesToTheAbsolutePositionAndTheEightBitFacing()
        {
            var tracker = new SnapshotTracker();
            var fb = Full(100.125f, 50f).Encode(); tracker.Decode(fb, fb.Length, null);
            var step = new ServerMsg.SnapshotDelta { Tick = 11, BaseTick = 10, ChangedCount = 1, Changed = new[] { new ActorDelta {
                Id = 5, Mask = ActorDelta.MX | ActorDelta.MY | ActorDelta.MStep | ActorDelta.MFacing, X = ActorDelta.FieldOfStep(-128), Y = ActorDelta.FieldOfStep(127), Facing = 64 << 8 } } };
            var bytes = step.Encode();
            var snap = (ServerMsg.Snapshot)tracker.Decode(bytes, bytes.Length, null);
            Assert.AreEqual(100.125f - 16f, snap.Actors[0].X); Assert.AreEqual(50f + 127 / 8f, snap.Actors[0].Y);
            Assert.AreEqual(Quant.DequantizeFacing(64 << 8), snap.Actors[0].Facing, "a quarter turn");
            // the same position as the absolute form
            var abs = new ServerMsg.SnapshotDelta { Tick = 11, BaseTick = 10, ChangedCount = 1, Changed = new[] { new ActorDelta { Id = 5, Mask = ActorDelta.MX | ActorDelta.MY, X = Quant.QuantizePos(100.125f - 16f), Y = Quant.QuantizePos(50f + 127 / 8f) } } };
            var t2 = new SnapshotTracker(); t2.Decode(fb, fb.Length, null); var ab = abs.Encode();
            var s2 = (ServerMsg.Snapshot)t2.Decode(ab, ab.Length, null);
            Assert.AreEqual(snap.Actors[0].X, s2.Actors[0].X); Assert.AreEqual(snap.Actors[0].Y, s2.Actors[0].Y);
            Assert.Less(bytes.Length, ab.Length + 3, "the step form is smaller");
        }

        [Test]
        public void AStepOffTheGridOrOnANewActorIsRefusedAndChangesNothing()
        {
            var tracker = new SnapshotTracker();
            var fb = Full(0.125f, 8191.875f).Encode(); tracker.Decode(fb, fb.Length, null);
            foreach (var d in new[] {
                new ActorDelta { Id = 5, Mask = ActorDelta.MX | ActorDelta.MStep, X = ActorDelta.FieldOfStep(-2) },
                new ActorDelta { Id = 5, Mask = ActorDelta.MY | ActorDelta.MStep, Y = ActorDelta.FieldOfStep(1) },
                new ActorDelta { Id = 9, Mask = ActorDelta.MNew | ActorDelta.MStep } })
            {
                var m = new ServerMsg.SnapshotDelta { Tick = 11, BaseTick = 10, ChangedCount = 1, Changed = new[] { d } }.Encode();
                Assert.AreEqual("position_step", Assert.Throws<DeltaException>(() => tracker.Decode(m, m.Length, null)).Code);
                Assert.AreEqual(10u, tracker.HeldTick);
            }
            // a step with no position axis is malformed, and a step does not fit a byte
            Assert.Throws<ArgumentException>(() => new ServerMsg.SnapshotDelta { Tick = 11, BaseTick = 10, ChangedCount = 1, Changed = new[] { new ActorDelta { Id = 5, Mask = ActorDelta.MStep | ActorDelta.MHp } } }.Encode());
            Assert.Throws<ArgumentOutOfRangeException>(() => ActorDelta.FieldOfStep(128));
            Assert.Throws<ArgumentException>(() => new ServerMsg.SnapshotDelta { Tick = 11, BaseTick = 10, ChangedCount = 1, Changed = new[] { new ActorDelta { Id = 5, Mask = ActorDelta.MFacing, Facing = 3 } } }.Encode());
        }

        [Test]
        public void ADeltaMaskBeyondBit14IsRefused()
        {
            Assert.AreEqual(0x21, RoundTrip<ServerMsg.SnapshotDelta>(new ServerMsg.SnapshotDelta { Tick = 11, BaseTick = 10, ChangedCount = 1, Changed = new[] { new ActorDelta { Id = 5, Mask = ActorDelta.MKit, Kit = 0x21 } } }).Changed[0].Kit);
            Assert.AreEqual(0x7fffu, ActorDelta.MAll);
            Assert.Throws<ArgumentException>(() => new ServerMsg.SnapshotDelta { Tick = 11, BaseTick = 10, ChangedCount = 1, Changed = new[] { new ActorDelta { Id = 5, Mask = 1u << 15 } } }.Encode());
        }

        // ---- windups ----

        [Test]
        public void AWindupReachesTheInterpolatedRemoteActorAndProgressIsClamped()
        {
            var w = new WireWindup { Kind = WireWindup.Cast, StartedAt = 1000, Duration = 400, Aim = 16384 };
            var snap = new ServerMsg.Snapshot { Tick = 40, Phase = Wire.DefaultPhase, Actors = new[] {
                new WireActor { Id = 2, Status = Wire.DefaultStatus, HpPct = 100, Windup = w }, new WireActor { Id = 3, Status = Wire.DefaultStatus, HpPct = 100 } } };
            var back = RoundTrip(snap);
            Assert.AreEqual(w, back.Actors[0].Windup); Assert.IsFalse(back.Actors[1].Windup.Active);
            var buf = new SnapshotBuffer(); buf.Add(back); var o = new List<InterpActor>(); Assert.IsTrue(buf.Sample(2000, o));
            Assert.AreEqual(w, o[0].Windup); Assert.IsFalse(o[1].Windup.Active);
            Assert.AreEqual(0f, w.Progress(900)); Assert.AreEqual(0.5f, w.Progress(1200)); Assert.AreEqual(1f, w.Progress(5000));
            Assert.AreEqual(1400.0, w.ReleaseAt); Assert.AreEqual(Quant.DequantizeFacing(16384), w.AimRadians);
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Actors = new[] { new WireActor { Id = 1, Windup = new WireWindup { Kind = WireWindup.Draw, Aim = 3, Duration = 5 } } } }.Encode());
        }

        [Test]
        public void ADeltaWindupSetsReplacesAndClearsThroughTheTracker()
        {
            var draw = new WireActor { Id = 5, Status = Wire.DefaultStatus, HpPct = 100, Windup = new WireWindup { Kind = WireWindup.Draw, StartedAt = 500, Duration = 550 } };
            var tracker = new SnapshotTracker();
            var fb = new ServerMsg.Snapshot { Tick = 10, Phase = Wire.DefaultPhase, Actors = new[] { draw } }.Encode(); tracker.Decode(fb, fb.Length, null);
            var pushed = new ServerMsg.SnapshotDelta { Tick = 11, BaseTick = 10, ChangedCount = 1, Changed = new[] { new ActorDelta { Id = 5, Mask = ActorDelta.MWindup, Windup = new WireWindup { Kind = WireWindup.Draw, StartedAt = 513, Duration = 550 } } } }.Encode();
            Assert.AreEqual(513u, ((ServerMsg.Snapshot)tracker.Decode(pushed, pushed.Length, null)).Actors[0].Windup.StartedAt);
            var ended = new ServerMsg.SnapshotDelta { Tick = 12, BaseTick = 11, ChangedCount = 1, Changed = new[] { new ActorDelta { Id = 5, Mask = ActorDelta.MWindup } } }.Encode();
            Assert.IsFalse(((ServerMsg.Snapshot)tracker.Decode(ended, ended.Length, null)).Actors[0].Windup.Active);
            var untouched = new ServerMsg.SnapshotDelta { Tick = 13, BaseTick = 12, ChangedCount = 1, Changed = new[] { new ActorDelta { Id = 5, Mask = ActorDelta.MHp, HpPct = 50 } } }.Encode();
            Assert.IsFalse(((ServerMsg.Snapshot)tracker.Decode(untouched, untouched.Length, null)).Actors[0].Windup.Active);
        }

        // ---- projectile tracks ----

        static ProjectilesState Rows(params WireProjectile[] rows) { return new ProjectilesState { Rows = rows }; }
        static WireProjectile Row(uint track, ushort x, ushort tick) { return new WireProjectile { Track = track, Kind = 0, X = x, Y = 800, Facing = 0, Speed = 320, Tick = tick }; }

        static void Send(Session s, FakeTransport t, uint tick, params WireProjectile[] rows)
        {
            t.Deliver(new ServerMsg.State { Tick = tick, Items = new StateItem[] { Rows(rows) } });
        }

        [Test]
        public void AFlightIsAnAnchorMovedByTheOneWireRuleAndNeverDrawnBeforeIt()
        {
            // anchor (100, 112.5) at tick 200, 40 u/s, heading +x. 0.5 s later (10 ticks) it is 20 u on.
            var v = new NetProjectileView { Track = 1, X = 100, Y = 112.5f, Facing = 0, Speed = 40, Tick = 200 };
            v.At(210, out float x, out float y);
            Assert.AreEqual(120f, x, 1e-4); Assert.AreEqual(112.5f, y, 1e-4);
            v.AtMs(210 * 50.0 + 25, out x, out y); Assert.AreEqual(121f, x, 1e-4, "fractional ticks");
            v.At(150, out x, out y); Assert.AreEqual(100f, x); Assert.AreEqual(112.5f, y, "clamped at the anchor");
            var up = new NetProjectileView { X = 0, Y = 0, Facing = (float)(Math.PI / 2), Speed = 20, Tick = 0 };
            up.At(20, out x, out y); Assert.AreEqual(0f, x, 1e-4); Assert.AreEqual(20f, y, 1e-4);
            // the Rust vector row: facing code 12345, speed 3040/8 u/s
            var rust = new NetProjectileView { X = 100, Y = 112.5f, Facing = Quant.DequantizeFacing(12345), Speed = 3040 / 8f, Tick = 200 };
            rust.At(220, out x, out y);
            double a = (short)12345 * (2 * Math.PI / 65536.0);
            Assert.AreEqual(100 + Math.Cos(a) * 380, x, 1e-3); Assert.AreEqual(112.5 + Math.Sin(a) * 380, y, 1e-3);
        }

        [Test]
        public void TrackAliasesTellPresentationWhatBeganRetargetedOrEnded()
        {
            var t = new FakeTransport(); double now = 0;
            var s = new Session(t, new SessionOptions { Url = "ws://x/ws", Profile = "p", Ticket = new byte[0], Now = () => now });
            s.Connect(); t.Open();
            t.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 3, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            Send(s, t, 10, Row(1, 800, 10), Row(4, 900, 10));
            var c = s.Collections;
            Assert.AreEqual(2, c.Projectiles.Count); Assert.IsTrue(c.Projectiles[0].IsNew && c.Projectiles[1].IsNew);
            Assert.AreEqual(100f, c.Projectiles[0].X); Assert.AreEqual(40f, c.Projectiles[0].Speed);
            // same lines: nothing new, nothing retargeted; alias 1 turned; alias 4 left sight; alias 5 entered
            Send(s, t, 11, Row(1, 800, 10), Row(4, 900, 10));
            Assert.IsFalse(c.Projectiles[0].IsNew || c.Projectiles[0].Retargeted || c.Projectiles[1].IsNew || c.Projectiles[1].Retargeted);
            Send(s, t, 12, Row(1, 820, 12), Row(5, 700, 12));
            Assert.IsTrue(c.Projectiles[0].Retargeted); Assert.IsFalse(c.Projectiles[0].IsNew);
            Assert.AreEqual(5u, c.Projectiles[1].Track); Assert.IsTrue(c.Projectiles[1].IsNew);
            Assert.IsFalse(c.TryGetProjectile(4, out _), "a missing alias is a flight that ended or left sight");
            Assert.IsTrue(c.TryGetProjectile(5, out var five)); Assert.AreEqual(87.5f, five.X);
            Assert.IsFalse(c.TryGetProjectile(2, out _)); Assert.IsFalse(c.TryGetProjectile(9, out _));
            Send(s, t, 13, Row(4, 900, 13)); // 4 is absent from the previous list, so it reads as new (the server never reuses an alias, so in practice this is a fresh flight)
            Assert.IsTrue(c.Projectiles[0].IsNew);
        }

        [Test]
        public void TrackRowsMustAscendAndHaveNonzeroAliases()
        {
            Assert.Throws<EncodeException>(() => new ServerMsg.State { Items = new StateItem[] { Rows(Row(2, 1, 1), Row(2, 1, 1)) } }.Encode());
            Assert.Throws<EncodeException>(() => new ServerMsg.State { Items = new StateItem[] { Rows(Row(3, 1, 1), Row(2, 1, 1)) } }.Encode());
            Assert.Throws<EncodeException>(() => new ServerMsg.State { Items = new StateItem[] { Rows(Row(0, 1, 1)) } }.Encode());
            var ok = new ServerMsg.State { Tick = 1, Items = new StateItem[] { Rows(Row(uint.MaxValue - 1, 1, 7), Row(uint.MaxValue, 2, 8)) } };
            var rows = ((ProjectilesState)RoundTrip(ok).Items[0]).Rows;
            Assert.AreEqual(uint.MaxValue, rows[1].Track); Assert.AreEqual(8u, rows[1].Tick);
        }
    }
}
