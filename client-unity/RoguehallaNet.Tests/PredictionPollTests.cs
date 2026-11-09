using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public class PredictionPollTests
    {
        sealed class QueuedTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public readonly List<byte[]> Sent = new List<byte[]>();
            readonly Queue<byte[]> incoming = new Queue<byte[]>();
            public void Connect(string url) { }
            public void Send(byte[] frame) { Sent.Add(frame); }
            public void Close() { Closed?.Invoke("closed"); }
            public void Poll() { while (incoming.Count != 0) Received(incoming.Dequeue()); }
            public void Open() { Opened(); }
            public void Enqueue(ServerMsg msg) { incoming.Enqueue(msg.Encode()); }
        }

        static WireSelf Self(double x, double y, byte seq = 0, byte cut = 0, byte status = 1)
        {
            return new WireSelf { Id = 3, X = (float)x, Y = (float)y, Hp = 10, MaxHp = 10, Status = status, MoveSeq = seq, DisplaceSeq = cut };
        }
        static ServerMsg.Snapshot Snapshot(uint tick, WireSelf self, uint ack = 0) { return new ServerMsg.Snapshot { Tick = tick, Phase = 1, Me = self, AckInput = ack }; }
        static Session Start(QueuedTransport t, MapBlob map, Func<double> now, WireSelf self)
        {
            var s = new Session(t, new SessionOptions { Url = "ws://x/ws", Profile = "p", Now = now });
            s.Connect(); t.Open();
            t.Enqueue(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], PlayerId = 3, Session = new byte[16], TickRate = 20, Tick = 1, ServerMs = 50, Map = map });
            t.Enqueue(Snapshot(1, self));
            s.Poll();
            return s;
        }
        static int Inputs(QueuedTransport t)
        {
            int n = 0;
            foreach (var frame in t.Sent) if (ClientMsg.Decode(frame) is ClientMsg.Input) n++;
            return n;
        }

        [Test]
        public void RealPollArrivalOrderMatchesEveryRustCornerVectorWithoutDoubleWalking()
        {
            using var paths = JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol/fixtures/pathfinding_v1.json")));
            using var walk = JsonDocument.Parse(File.ReadAllText(Path.Combine(Util.RepoRoot(), "protocol/fixtures/server_walk_v1.json")));
            foreach (var one in walk.RootElement.GetProperty("cases").EnumerateArray())
            {
                var reader = new Reader(Util.FromHex(paths.RootElement.GetProperty("mapBlob").GetProperty("hex").GetString()));
                var map = MapBlob.ReadCollisionFixture(ref reader); reader.End();
                double now = 0;
                var t = new QueuedTransport();
                var ticks = one.GetProperty("ticks");
                var s = Start(t, map, () => now, Self(ticks[0].GetProperty("x").GetDouble(), ticks[0].GetProperty("y").GetDouble()));
                s.OrderMove((float)one.GetProperty("goal")[0].GetDouble(), (float)one.GetProperty("goal")[1].GetDouble());
                s.FlushInput();
                for (int k = 1; k < ticks.GetArrayLength(); k++)
                {
                    now = k * 50.0;
                    var tick = ticks[k];
                    double x = tick.GetProperty("x").GetDouble(), y = tick.GetProperty("y").GetDouble();
                    t.Enqueue(Snapshot((uint)(k + 1), Self(x, y, 1), 1));
                    s.Poll(); // incoming snapshot callback, then frame Step -- the real caller order
                    s.FlushInput();
                    double dx = s.Motion.DrawnX - x, dy = s.Motion.DrawnY - y;
                    Assert.LessOrEqual(Math.Sqrt(dx * dx + dy * dy), 0.01, one.GetProperty("name").GetString() + "/tick" + k);
                }
                Assert.AreEqual(1, Inputs(t), "prediction never adds commands");
            }
        }

        [Test]
        public void PollHonorsDisplacementAndDeadStateEvenBeforeTheMoveEcho()
        {
            double now = 0; var t = new QueuedTransport();
            var s = Start(t, new MapBlob(32, 32, new byte[1024]), () => now, Self(100, 100));
            s.OrderMove(600, 100); s.FlushInput();
            now = 50; t.Enqueue(Snapshot(2, Self(500, 500, 0, 1))); s.Poll();
            Assert.AreEqual(500, s.Motion.DrawnX); Assert.AreEqual(500, s.Motion.DrawnY); Assert.IsFalse(s.Motion.OrderPending);
            s.OrderMove(600, 500); s.FlushInput();
            now = 100; t.Enqueue(Snapshot(3, Self(500, 500, 0, 1, 2))); s.Update();
            now = 150; s.Update();
            Assert.AreEqual(500, s.Motion.DrawnX, "the accepted dead actor remains stationary");
        }

        [Test]
        public void LockedGatesSuspendOnlyPredictionUntilOpenMapIsAuthoritativeAgain()
        {
            double now = 0; var t = new QueuedTransport();
            var s = Start(t, new MapBlob(32, 32, new byte[1024]), () => now, Self(100, 100));
            s.OrderMove(600, 100); s.FlushInput();
            now = 50;
            t.Enqueue(new ServerMsg.State { Tick = 2, Items = new StateItem[] { new ArenaState { Value = new WireArena { GatesLocked = true } } } });
            s.Poll();
            Assert.AreEqual(100, s.Motion.DrawnX, "a map without closed-gate geometry cannot predict through gates");
            s.OrderMove(600, 100); s.FlushInput();
            now = 100; t.Enqueue(Snapshot(3, Self(150, 100, 2))); s.Poll();
            Assert.AreEqual(150, s.Motion.DrawnX, "server positions and ordinary inputs continue while prediction is suspended");
            now = 150;
            t.Enqueue(new ServerMsg.State { Tick = 4, Items = new StateItem[] { new ArenaState { Value = new WireArena { GatesLocked = false } } } });
            s.Poll(); s.OrderMove(600, 100); s.FlushInput();
            now = 200; s.Poll();
            Assert.AreEqual(158.5, s.Motion.DrawnX, 0.001, "fresh orders can use the open collision map again");
            Assert.AreEqual(3, Inputs(t), "only the three user orders were transmitted");
        }

        [Test]
        public void PollChecksTheExactBoundaryEchoBeforeExpiryAndForgetsAnUnmatchedOrder()
        {
            double now = 0; var t = new QueuedTransport();
            var s = Start(t, new MapBlob(32, 32, new byte[1024]), () => now, Self(100, 100));
            s.OrderMove(600, 100); s.FlushInput();
            now = 1000; t.Enqueue(Snapshot(2, Self(117, 100, 1), 1)); s.Poll();
            Assert.AreEqual(0, s.Motion.ExpiredOrders); Assert.IsFalse(s.Motion.OrderPending);
            s.OrderMove(600, 100); s.FlushInput();
            now = 2000; t.Enqueue(Snapshot(3, Self(117, 100, 1))); s.Poll();
            Assert.AreEqual(1, s.Motion.ExpiredOrders); Assert.IsFalse(s.Motion.OrderPending);
        }
    }
}
