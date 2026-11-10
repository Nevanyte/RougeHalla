using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// Heap garbage of the per-snapshot client paths, measured with GC.GetAllocatedBytesForCurrentThread (exact, per thread)
    /// over many iterations. Unity WebGL's GC is non-generational, so steady-state garbage is what makes frames hitch.
    /// Budget: decode at most 32 B per actor + 88 B per snapshot; Sample 0 B. (Before value-type actors: 200 + 48 B per actor
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
                a[k] = new WireActor { Id = (uint)(2 * k + 1), Faction = (byte)(k % 5), X = 100 + (tick % 1000) + k, Y = 200 - k, Facing = 0.01f * ((tick % 1000) + k), HpPct = (byte)(k % 101), Weapon = (byte)(k % 7), Bounty = (ushort)k };
            return new ServerMsg.Snapshot { Tick = tick, Phase = 1, AckInput = tick, Me = me ? Self(tick) : null, Actors = a };
        }

        static ServerMsg.Snapshot WishSnap(uint tick)
        {
            return new ServerMsg.Snapshot
            {
                Tick = tick, AckInput = tick,
                Me = new WireSelf
                {
                    Id = 3,
                    Wish = new WireWishOwner
                    {
                        Ability = 3, ReadyAt = 1200, FullAt = 2000, MaxCharges = 2, RechargeMs = 800, Charges = 1, NextChargeAt = 1600,
                        Cast = new WireWishCast { Ability = 3, StartedAt = 1100, LandsAt = 1250 }
                    }
                }
            };
        }

        /// <summary>First tick whose varint is three bytes: a frame encoded at <see cref="BaseTick"/> can be re-stamped in place.</summary>
        const uint BaseTick = 20000;

        /// <summary>Overwrites a Snapshot frame's tick (the three-byte varint at bytes 1..3) in place, so one frame can be delivered
        /// as a stream. The frame must have been encoded with a tick of 16384 to 2097151.</summary>
        static void SetTick(byte[] frame, uint tick)
        {
            if (tick < 16384u || tick > 2097151u) throw new ArgumentOutOfRangeException(nameof(tick));
            frame[1] = (byte)((tick & 0x7f) | 0x80); frame[2] = (byte)(((tick >> 7) & 0x7f) | 0x80); frame[3] = (byte)(tick >> 14);
        }

        static void SetDeltaTick(byte[] frame, uint tick)
        {
            if (tick < 16384u || tick > 2097151u) throw new ArgumentOutOfRangeException(nameof(tick));
            frame[1] = (byte)((tick & 0x7f) | 0x80); frame[2] = (byte)(((tick >> 7) & 0x7f) | 0x80); frame[3] = (byte)(tick >> 14);
        }

        /// <summary>Bytes allocated per call of <paramref name="body"/>, after a warm-up (JIT, first-use statics).</summary>
        static double PerCall(Action<int> body)
        {
            double result = 0;
            System.Runtime.ExceptionServices.ExceptionDispatchInfo failure = null;
            var worker = new System.Threading.Thread(() =>
            {
                try
                {
                    // Counter first-use and caller/NUnit execution context are outside the measured work.
                    GC.GetAllocatedBytesForCurrentThread();
                    for (int i = 0; i < 200; i++) body(i);
                    long before = GC.GetAllocatedBytesForCurrentThread();
                    for (int i = 200; i < 200 + Iterations; i++) body(i);
                    result = (GC.GetAllocatedBytesForCurrentThread() - before) / (double)Iterations;
                }
                catch (Exception error)
                {
                    failure = System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error);
                }
            });
            if (System.Threading.ExecutionContext.IsFlowSuppressed()) worker.Start();
            else
            {
                using (System.Threading.ExecutionContext.SuppressFlow()) worker.Start();
            }
            worker.Join();
            failure?.Throw();
            return result;
        }

        static double DecodeGarbage(int actors, bool me)
        {
            var frame = Snap(BaseTick, actors, me).Encode();
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
            // Snapshot object (64 B) + array header (24 B) + 40 B per actor (v15 flat windup fields); a self adds one 88 B object (wish and barrier owner facts). No reader object.
            Assert.LessOrEqual(spectator, 40.0 * actors + 88);
            Assert.LessOrEqual(withMe, 40.0 * actors + 176);
        }

        /// <summary>Decode into the buffer's spare, as Session does. <paramref name="vary"/> alternates the actor count every
        /// snapshot (the worst case: the actor array cannot be reused).</summary>
        static double PooledGarbage(int actors, bool vary)
        {
            byte[] a = Snap(BaseTick, actors).Encode(), b = Snap(BaseTick, vary ? actors + 1 : actors).Encode();
            var buf = new SnapshotBuffer();
            int refused = 0;
            double perSnapshot = PerCall(i =>
            {
                var frame = (i & 1) == 0 ? a : b;
                SetTick(frame, BaseTick + (uint)i);
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
            Assert.LessOrEqual(varying, 40.0 * (actors + 1) + 64);
        }

        [Test]
        public void DecodeIntoTheSpareReusesPresentWishOwnerAndCastWithoutSteadyAllocations()
        {
            byte[] frame = WishSnap(BaseTick).Encode();
            var buf = new SnapshotBuffer(); int refused = 0;
            double allocated = PerCall(i =>
            {
                SetTick(frame, BaseTick + (uint)i);
                var spare = buf.TakeSpare();
                var msg = (ServerMsg.Snapshot)ServerMsg.Decode(frame, frame.Length, spare);
                if (!buf.Add(msg)) refused++;
            });
            Assert.AreEqual(0, refused); Assert.AreEqual(40, buf.Count); Assert.AreEqual(0.0, allocated);
        }

        [Test]
        public void SnapshotTrackerCopiesUnchangedWishOwnerAndCastWithoutSteadyAllocations()
        {
            var tracker = new SnapshotTracker();
            byte[] full = WishSnap(BaseTick).Encode();
            tracker.Decode(full, full.Length, new ServerMsg.Snapshot());
            var delta = new ServerMsg.SnapshotDelta { Tick = BaseTick + 1, BaseTick = BaseTick, AckInput = 0, HasSelf = true };
            byte[] frame = delta.Encode(); var reuse = new ServerMsg.Snapshot(); object sink = null;
            double allocated = PerCall(i =>
            {
                SetDeltaTick(frame, BaseTick + 1u + (uint)i);
                sink = tracker.Decode(frame, frame.Length, reuse);
            });
            GC.KeepAlive(sink);
            Assert.AreSame(reuse, sink); Assert.IsNotNull(reuse.Me.Wish); Assert.IsNotNull(reuse.Me.Wish.Cast); Assert.AreEqual(0.0, allocated);
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
            t.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 3, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            Assert.AreEqual(SessionState.InMatch, s.State);
            var frame = Snap(BaseTick, actors).Encode();
            var o = new List<InterpActor>();
            double b = PerCall(i =>
            {
                now += 50;
                SetTick(frame, BaseTick + (uint)i);
                t.DeliverRaw(frame);
                s.Snapshots.Sample((BaseTick + i) * 50.0 - 100, o);
            });
            TestContext.Progress.WriteLine("session receive + sample, {0} actors: {1} B per snapshot", actors, b);
            Assert.AreEqual(0.0, b);
            Assert.AreEqual(Iterations + 200, s.SnapshotsReceived);
            Assert.AreEqual(actors, o.Count);
        }

        /// <summary>The steady stream of protocol v3: a Full snapshot, then a delta every tick (moving every actor and the self). Applying
        /// deltas, resolving each into the buffer's spare and sampling make no garbage either.</summary>
        [TestCase(1)]
        [TestCase(14)]
        [TestCase(68)]
        public void ASessionReceivingDeltasMakesNoGarbage(int actors)
        {
            double now = 1000;
            var t = new FakeTransport();
            var s = new Session(t, new SessionOptions { Now = () => now });
            s.Connect(); t.Open();
            t.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 3, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            t.Deliver(Snap(BaseTick - 1, actors));
            var d = new ServerMsg.SnapshotDelta { Tick = BaseTick, BaseTick = BaseTick - 1, Phase = 1, HasSelf = true, ChangedCount = actors, Changed = new ActorDelta[actors] };
            d.Me = new SelfDelta { Mask = SelfDelta.FX | SelfDelta.FMoveSeq, X = 401, MoveSeq = 1 };
            for (int k = 0; k < actors; k++) d.Changed[k] = new ActorDelta { Id = (uint)(2 * k + 1), Mask = ActorDelta.MX | ActorDelta.MFacing, X = (ushort)(800 + k), Facing = 5 << 8, Status = 1 };
            var frame = d.Encode();
            Assert.AreEqual(0x87, frame[0]);
            Assert.AreEqual(1, frame[4], "the age is the byte after the three-byte tick");
            var o = new List<InterpActor>();
            double b = PerCall(i =>
            {
                now += 50;
                SetTick(frame, BaseTick + (uint)i);
                t.DeliverRaw(frame);
                s.Snapshots.Sample((BaseTick + i) * 50.0 - 100, o);
            });
            TestContext.Progress.WriteLine("session delta receive + sample, {0} actors: {1} B per snapshot", actors, b);
            Assert.AreEqual(0, s.DeltasRefused, s.Error);
            Assert.AreEqual(0.0, b);
            Assert.AreEqual(Iterations + 200, s.SnapshotsReceived - 1);
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

        [Test]
        public void SessionMeMakesNoGarbageOnTheSteadyPath()
        {
            double now = 1000;
            var t = new FakeTransport();
            var s = new Session(t, new SessionOptions { Now = () => now });
            s.Connect(); t.Open();
            t.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 3, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            var frames = new byte[64][];
            for (int i = 0; i < frames.Length; i++) frames[i] = Snap(BaseTick, 8).Encode();
            uint tick = BaseTick;
            // Warm up past the buffer so decodes recycle, then measure the receive path including the Me copy.
            for (int i = 0; i < 200; i++) { SetTick(frames[i % 64], ++tick); t.DeliverRaw(frames[i % 64]); var m = s.Me; }
            long before = GC.GetAllocatedBytesForCurrentThread();
            float sum = 0;
            for (int i = 0; i < 2000; i++) { SetTick(frames[i % 64], ++tick); t.DeliverRaw(frames[i % 64]); sum += s.Me.X; }
            long after = GC.GetAllocatedBytesForCurrentThread();
            Assert.Greater(sum, 0f);
            Assert.AreEqual(0, after - before, "Session.Me allocates nothing per snapshot");
        }
    }

    public class SnapshotReuseTests
    {
        static byte[] Frame(uint tick, WireSelf me, params WireActor[] actors)
        {
            return new ServerMsg.Snapshot { Tick = tick, Me = me, Actors = actors }.Encode();
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
            t.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16], PlayerId = 3, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
            t.Deliver(new ServerMsg.Snapshot { Tick = 1, Me = new WireSelf { Id = 3, Hp = 10, MaxHp = 20 } });
            me = s.Latest != null ? s.Latest.Me : null;
            uint myId = me != null ? me.Id : 0;
            Assert.AreEqual(3u, myId);
            t.Deliver(new ServerMsg.Snapshot { Tick = 2, Me = null, Actors = new[] { new WireActor { Id = 3 } } });
            me = s.Latest != null ? s.Latest.Me : null;
            Assert.IsNull(me, "spectating: no self");
            // Recycling keeps that true: run the buffer through many snapshots alternating self / no self.
            for (uint k = 3; k < 200; k++)
            {
                bool has = (k % 3) != 0;
                t.Deliver(new ServerMsg.Snapshot { Tick = k, Me = has ? new WireSelf { Id = 3, X = k } : null });
                me = s.Latest != null ? s.Latest.Me : null;
                Assert.AreEqual(has, me != null, "tick " + k);
                if (has) Assert.AreEqual((float)k, me.X);
                Assert.AreEqual(k, s.Latest.Tick);
                // The owned view the scripts use instead: same answers, never a recycled snapshot's object.
                Assert.AreEqual(has, s.Me != null, "view tick " + k);
                if (has) Assert.AreEqual((float)k, s.Me.X);
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
                var x = new InterpActor { Id = cur.Id, Faction = (FactionId)cur.Faction, HpPct = cur.HpPct, Status = (ActorStatus)cur.Status, Weapon = (WeaponId)cur.Weapon, Bounty = cur.Bounty, X = cur.X, Y = cur.Y, Facing = cur.Facing };
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
                var a = new ServerMsg.Snapshot { Tick = 20, Actors = Make() };
                var b = new ServerMsg.Snapshot { Tick = 21, Actors = Make() };
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
            Assert.AreEqual(40, System.Runtime.CompilerServices.Unsafe.SizeOf<WireActor>());
            Assert.AreEqual(48, System.Runtime.CompilerServices.Unsafe.SizeOf<InterpActor>(),
                "nullable remote faction/weapon add two data bytes and alignment; the raw wire actor is 40 bytes with the flat v15 windup");
        }

        [Test]
        public void EncodeRefusesMoreThanMaxActorsInsteadOfTrimming()
        {
            WireActor[] Many(int n) { var a = new WireActor[n]; for (int i = 0; i < n; i++) a[i].Id = (uint)i + 1; return a; }
            var ok = new ServerMsg.Snapshot { Actors = Many(Wire.MaxActors) };
            Assert.AreEqual(Wire.MaxActors, ((ServerMsg.Snapshot)ServerMsg.Decode(ok.Encode())).Actors.Length);
            Assert.AreEqual(ok.EncodedLength, ok.Encode().Length);
            Assert.Throws<ArgumentException>(() => new ServerMsg.Snapshot { Actors = Many(Wire.MaxActors + 1) }.Encode());
        }
    }
}
