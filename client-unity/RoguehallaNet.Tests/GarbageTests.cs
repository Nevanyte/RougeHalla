using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// Heap garbage of the per-snapshot client paths, measured with GC.GetAllocatedBytesForCurrentThread (exact, per thread)
    /// over many iterations. Unity WebGL's GC is non-generational, so steady-state garbage is what makes frames hitch.
    /// Budget: decode at most 24 B per actor + 64 B per snapshot; Sample 0 B. (Before value-type actors: 200 + 48 B per actor
    /// with a self, 144 + 48 per actor without.)
    /// </summary>
    public class GarbageTests
    {
        const int Iterations = 20000;

        static WireSelf Self(uint i)
        {
            return new WireSelf { Id = 3, Faction = 4, X = 400 + i, Y = 320.5f, Facing = 1.5f, Hp = 1000, MaxHp = 1145, Status = 1, Weapon = 5, ReadyInMs = 250, Kills = 2, Gv = 20, MoveSeq = (byte)i };
        }

        static ServerMsg.Snapshot Snap(uint tick, int actors, bool me = true)
        {
            var a = new WireActor[actors];
            for (int k = 0; k < actors; k++)
                a[k] = new WireActor { Id = (uint)(2 * k + 1), Faction = (byte)(k % 5), X = 100 + tick + k, Y = 200 - k, Facing = 0.01f * (tick + k), HpPct = (byte)(k % 101), Weapon = (byte)(k % 7), Bounty = (ushort)k };
            return new ServerMsg.Snapshot { Tick = tick, ServerMs = tick * 50.0, Phase = 1, AckInput = tick, Me = me ? Self(tick) : null, Actors = a };
        }

        /// <summary>Overwrites a Snapshot frame's server_ms (bytes 5..12) in place, so one frame can be delivered as a stream.</summary>
        static void SetServerMs(byte[] frame, double ms)
        {
            long bits = BitConverter.DoubleToInt64Bits(ms);
            for (int k = 0; k < 8; k++) frame[5 + k] = (byte)(bits >> (8 * k));
        }

        /// <summary>Bytes allocated per call of <paramref name="body"/>, after a warm-up (JIT, first-use statics).</summary>
        static double PerCall(Action<int> body)
        {
            for (int i = 0; i < 200; i++) body(i);
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 200; i < 200 + Iterations; i++) body(i);
            return (GC.GetAllocatedBytesForCurrentThread() - before) / (double)Iterations;
        }

        static double DecodeGarbage(int actors, bool me)
        {
            var frame = Snap(7, actors, me).Encode();
            object sink = null;
            double b = PerCall(i => { sink = ServerMsg.Decode(frame, frame.Length); });
            GC.KeepAlive(sink);
            return b;
        }

        [TestCase(1)]
        [TestCase(14)]
        [TestCase(68)]
        public void PlainDecodeAllocatesOnlyTheSnapshotItsSelfAndOneActorArray(int actors)
        {
            double withMe = DecodeGarbage(actors, true), spectator = DecodeGarbage(actors, false);
            TestContext.Progress.WriteLine("plain decode, {0} actors: {1} B with a self, {2} B without", actors, withMe, spectator);
            // Snapshot object (56 B) + array header (24 B) + 24 B per actor; a self adds one 56 B object. No reader object.
            Assert.LessOrEqual(spectator, 24.0 * actors + 80);
            Assert.LessOrEqual(withMe, 24.0 * actors + 136);
        }

        /// <summary>Decode into the buffer's spare, as Session does. <paramref name="vary"/> alternates the actor count every
        /// snapshot (the worst case: the actor array cannot be reused).</summary>
        static double PooledGarbage(int actors, bool vary)
        {
            byte[] a = Snap(7, actors).Encode(), b = Snap(7, vary ? actors + 1 : actors).Encode();
            var buf = new SnapshotBuffer();
            int refused = 0;
            double perSnapshot = PerCall(i =>
            {
                var frame = (i & 1) == 0 ? a : b;
                SetServerMs(frame, i * 50.0);
                var spare = buf.TakeSpare();
                var msg = (ServerMsg.Snapshot)ServerMsg.Decode(frame, frame.Length, spare);
                if (!buf.Add(msg)) refused++;
            });
            Assert.AreEqual(0, refused);
            Assert.AreEqual(40, buf.Count);
            return perSnapshot;
        }

        [TestCase(1)]
        [TestCase(14)]
        [TestCase(68)]
        public void DecodeIntoTheSpareMeetsTheBudgetAndIsFreeInSteadyState(int actors)
        {
            double steady = PooledGarbage(actors, false), varying = PooledGarbage(actors, true);
            TestContext.Progress.WriteLine("decode into spare, {0} actors: {1} B steady, {2} B when the count changes every snapshot", actors, steady, varying);
            Assert.AreEqual(0.0, steady);
            Assert.LessOrEqual(varying, 24.0 * (actors + 1) + 64);
        }

        [TestCase(1)]
        [TestCase(14)]
        [TestCase(68)]
        public void ASessionReceivingSnapshotsMakesNoGarbage(int actors)
        {
            double now = 1000;
            var t = new FakeTransport();
            var s = new Session(t, new SessionOptions { Now = () => now });
            s.Connect(); t.Open();
            t.Deliver(new ServerMsg.Welcome { Protocol = 1, MatchId = new byte[16], Session = new byte[16], PlayerId = 3, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            Assert.AreEqual(SessionState.InMatch, s.State);
            var frame = Snap(7, actors).Encode();
            var o = new List<InterpActor>();
            double b = PerCall(i =>
            {
                now += 50;
                SetServerMs(frame, i * 50.0);
                t.DeliverRaw(frame);
                s.Snapshots.Sample(i * 50.0 - 100, o);
            });
            TestContext.Progress.WriteLine("session receive + sample, {0} actors: {1} B per snapshot", actors, b);
            Assert.AreEqual(0.0, b);
            Assert.AreEqual(Iterations + 200, s.SnapshotsReceived);
            Assert.AreEqual(actors, o.Count);
        }

        [TestCase(1)]
        [TestCase(14)]
        [TestCase(68)]
        public void SampleMakesNoGarbage(int actors)
        {
            var buf = new SnapshotBuffer();
            for (uint t = 0; t < 40; t++) buf.Add(Snap(t, actors));
            var o = new List<InterpActor>();
            buf.Sample(10, o);
            double b = PerCall(i => buf.Sample(0.1 * (i % 19500), o));
            TestContext.Progress.WriteLine("sample {0} actors: {1} B", actors, b);
            Assert.AreEqual(0.0, b);
            Assert.AreEqual(actors, o.Count);
        }
    }

    public class SnapshotReuseTests
    {
        static byte[] Frame(uint tick, WireSelf me, params WireActor[] actors)
        {
            return new ServerMsg.Snapshot { Tick = tick, ServerMs = tick * 50.0, Me = me, Actors = actors }.Encode();
        }

        [Test]
        public void MeIsNullForASpectatorFrameEvenWhenTheReusedSnapshotHadOne()
        {
            var first = (ServerMsg.Snapshot)ServerMsg.Decode(Frame(1, new WireSelf { Id = 3, Hp = 10 }, new WireActor { Id = 1 }));
            Assert.IsNotNull(first.Me);
            var f2 = Frame(2, null);
            var again = ServerMsg.Decode(f2, f2.Length, first);
            Assert.AreSame(first, again);
            Assert.IsNull(first.Me, "a frame without a self clears Me");
            Assert.AreEqual(0, first.Actors.Length);
            Assert.AreSame(Array.Empty<WireActor>(), first.Actors, "no array for nothing visible");
            var f3 = Frame(3, new WireSelf { Id = 5, X = 7 }, new WireActor { Id = 2, X = 9 });
            ServerMsg.Decode(f3, f3.Length, first);
            Assert.AreEqual(5u, first.Me.Id); Assert.AreEqual(7f, first.Me.X); Assert.AreEqual(2u, first.Actors[0].Id); Assert.AreEqual(9f, first.Actors[0].X);
        }

        [Test]
        public void DecodingIntoAReusedSnapshotGivesTheSameValuesAsAFreshDecode()
        {
            var reuse = new ServerMsg.Snapshot();
            var rnd = new Random(5);
            for (int round = 0; round < 200; round++)
            {
                int n = rnd.Next(0, 6);
                var actors = new WireActor[n];
                for (int k = 0; k < n; k++) actors[k] = new WireActor { Id = (uint)(k * 3 + 1), X = rnd.Next(1000), Y = rnd.Next(1000), Facing = (float)rnd.NextDouble(), HpPct = (byte)rnd.Next(101), Status = 1, Weapon = 2, Faction = 3, Bounty = (ushort)rnd.Next(100) };
                var me = rnd.Next(3) == 0 ? null : new WireSelf { Id = 3, X = rnd.Next(100), Hp = rnd.Next(100), MoveSeq = (byte)round };
                var bytes = Frame((uint)round, me, actors);
                var fresh = (ServerMsg.Snapshot)ServerMsg.Decode(bytes);
                Assert.AreSame(reuse, ServerMsg.Decode(bytes, bytes.Length, reuse));
                Assert.AreEqual(Util.ToHex(fresh.Encode()), Util.ToHex(reuse.Encode()), "round " + round);
                Assert.AreEqual(Util.ToHex(bytes), Util.ToHex(reuse.Encode()));
            }
        }

        [Test]
        public void OtherFramesIgnoreTheReusedSnapshot()
        {
            var reuse = new ServerMsg.Snapshot { Tick = 9 };
            var pong = new ServerMsg.Pong { Nonce = 1 }.Encode();
            Assert.IsInstanceOf<ServerMsg.Pong>(ServerMsg.Decode(pong, pong.Length, reuse));
            Assert.AreEqual(9u, reuse.Tick);
        }

        /// <summary>The Unity client's access pattern (MatchClient.Present, ArenaView.Present): Session.Latest may be null, its Me may be
        /// null; both are reference checks on WireSelf, which stays a class.</summary>
        [Test]
        public void LatestMeAccessPatternOfTheUnityScripts()
        {
            double now = 1000;
            var t = new FakeTransport();
            var s = new Session(t, new SessionOptions { Now = () => now });
            WireSelf me = s.Latest != null ? s.Latest.Me : null;
            Assert.IsNull(me);
            s.Connect(); t.Open();
            t.Deliver(new ServerMsg.Welcome { Protocol = 1, MatchId = new byte[16], Session = new byte[16], PlayerId = 3, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            t.Deliver(new ServerMsg.Snapshot { Tick = 1, ServerMs = 50, Me = new WireSelf { Id = 3, Hp = 10, MaxHp = 20 } });
            me = s.Latest != null ? s.Latest.Me : null;
            uint myId = me != null ? me.Id : 0;
            Assert.AreEqual(3u, myId);
            t.Deliver(new ServerMsg.Snapshot { Tick = 2, ServerMs = 100, Me = null, Actors = new[] { new WireActor { Id = 3 } } });
            me = s.Latest != null ? s.Latest.Me : null;
            Assert.IsNull(me, "spectating: no self");
            // Recycling keeps that true: run the buffer through many snapshots alternating self / no self.
            for (uint k = 3; k < 200; k++)
            {
                bool has = (k % 3) != 0;
                t.Deliver(new ServerMsg.Snapshot { Tick = k, ServerMs = k * 50, Me = has ? new WireSelf { Id = 3, X = k } : null });
                me = s.Latest != null ? s.Latest.Me : null;
                Assert.AreEqual(has, me != null, "tick " + k);
                if (has) Assert.AreEqual((float)k, me.X);
                Assert.AreEqual(k, s.Latest.Tick);
            }
            Assert.AreEqual(40, s.Snapshots.Count);
        }

        static List<InterpActor> ReferenceSample(ServerMsg.Snapshot a, ServerMsg.Snapshot b, float t)
        {
            // The previous implementation: a map of the older snapshot's actors (the last one wins on a repeated id).
            var prev = new Dictionary<uint, WireActor>();
            foreach (var p in a.Actors) prev[p.Id] = p;
            var o = new List<InterpActor>();
            foreach (var cur in b.Actors)
            {
                var x = new InterpActor { Id = cur.Id, Faction = cur.Faction, HpPct = cur.HpPct, Status = cur.Status, Weapon = cur.Weapon, Bounty = cur.Bounty, X = cur.X, Y = cur.Y, Facing = cur.Facing };
                WireActor p;
                if (prev.TryGetValue(cur.Id, out p))
                {
                    float dx = cur.X - p.X, dy = cur.Y - p.Y;
                    if (dx * dx + dy * dy <= SnapshotBuffer.TeleportDistance * SnapshotBuffer.TeleportDistance)
                    {
                        x.X = p.X + dx * t; x.Y = p.Y + dy * t; x.Facing = SnapshotBuffer.LerpAngle(p.Facing, cur.Facing, t);
                    }
                }
                o.Add(x);
            }
            return o;
        }

        [Test]
        public void MergeJoinMatchesTheDictionaryForSortedUnsortedAndRepeatedIds()
        {
            var rnd = new Random(11);
            for (int round = 0; round < 500; round++)
            {
                bool sorted = round % 4 != 0;
                WireActor[] Make()
                {
                    var ids = new List<uint>();
                    int n = rnd.Next(0, 12);
                    for (int k = 0; k < n; k++) ids.Add((uint)rnd.Next(1, sorted ? 40 : 8));
                    if (sorted) { ids.Sort(); ids = new List<uint>(new HashSet<uint>(ids)); ids.Sort(); }
                    var arr = new WireActor[ids.Count];
                    for (int k = 0; k < arr.Length; k++) arr[k] = new WireActor { Id = ids[k], X = rnd.Next(-300, 300), Y = rnd.Next(-300, 300), Facing = (float)(rnd.NextDouble() * 6 - 3), HpPct = (byte)rnd.Next(101) };
                    return arr;
                }
                var a = new ServerMsg.Snapshot { ServerMs = 1000, Actors = Make() };
                var b = new ServerMsg.Snapshot { ServerMs = 1050, Actors = Make() };
                var buf = new SnapshotBuffer();
                buf.Add(a); buf.Add(b);
                var got = new List<InterpActor>();
                buf.Sample(1020, got);
                var want = ReferenceSample(a, b, 0.4f);
                Assert.AreEqual(want.Count, got.Count);
                for (int k = 0; k < want.Count; k++)
                {
                    Assert.AreEqual(want[k].Id, got[k].Id);
                    Assert.AreEqual(want[k].X, got[k].X, "round " + round);
                    Assert.AreEqual(want[k].Y, got[k].Y);
                    Assert.AreEqual(want[k].Facing, got[k].Facing);
                }
            }
        }

        [Test]
        public void WireActorIsAPackedValueType()
        {
            Assert.IsTrue(typeof(WireActor).IsValueType);
            Assert.IsFalse(typeof(WireSelf).IsValueType, "WireSelf stays a class: Snapshot.Me is null for a spectator");
            Assert.AreEqual(24, System.Runtime.CompilerServices.Unsafe.SizeOf<WireActor>());
        }

        [Test]
        public void EncodeRefusesMoreThanMaxActorsInsteadOfTrimming()
        {
            var ok = new ServerMsg.Snapshot { Actors = new WireActor[Wire.MaxActors] };
            Assert.AreEqual(Wire.MaxActors, ((ServerMsg.Snapshot)ServerMsg.Decode(ok.Encode())).Actors.Length);
            Assert.AreEqual(ok.EncodedLength, ok.Encode().Length);
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Actors = new WireActor[Wire.MaxActors + 1] }.Encode());
        }
    }
}
