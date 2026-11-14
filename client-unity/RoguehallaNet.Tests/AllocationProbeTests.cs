using System;
using System.Threading;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-TEST-HARDEN-1: the shared probe measures the calling work's thread only, and the decode's allocation is
    /// pinned with no slack. The decode itself was already measured per thread (<c>GarbageTests.PerCall</c>), so the red
    /// tests here are the ones that run other threads' allocations beside the measurement.</summary>
    public class AllocationProbeTests
    {
        /// <summary>Threads that allocate continuously until disposed.</summary>
        sealed class Noise : IDisposable
        {
            volatile bool stop;
            readonly Thread[] threads = new Thread[3];
            public Noise()
            {
                for (int i = 0; i < threads.Length; i++)
                {
                    threads[i] = new Thread(() => { object keep = null; while (!stop) keep = new byte[64]; GC.KeepAlive(keep); });
                    threads[i].Start();
                }
                Thread.Sleep(50);
            }
            public void Dispose() { stop = true; foreach (var t in threads) t.Join(); }
        }

        static WireActor[] Actors(int n)
        {
            var a = new WireActor[n];
            for (int k = 0; k < n; k++)
                a[k] = new WireActor { Id = (uint)(2 * k + 1), Faction = (byte)(k % 5), X = 100 + k, Y = 200 - k, Facing = 0.01f * k, HpPct = (byte)(k % 101), Weapon = (byte)(k % 7), Bounty = (ushort)k };
            return a;
        }

        const uint BaseTick = 20000;

        [Test]
        public void AnEmptyBodyMeasuresZeroWhileOtherThreadsAllocate()
        {
            using (new Noise())
                Assert.AreEqual(0.0, AllocationProbe.PerCall(i => { }));
        }

        [Test]
        public void ABodyThatAllocatesOneObjectPerCallMeasuresExactlyItsOwnBytesWhileOtherThreadsAllocate()
        {
            object sink = null;
            double bytes, empty;
            using (new Noise())
            {
                empty = AllocationProbe.PerCall(i => { });
                bytes = AllocationProbe.PerCall(i => sink = new byte[100]);
            }
            GC.KeepAlive(sink);
            Assert.AreEqual(0.0, empty);
            Assert.AreEqual(128.0, bytes, "a byte[100] is 24 B of object header and length plus 100 B, rounded up to 8");
        }

        [Test]
        public void PerCallMinIsNoGreaterThanASingleRunAndStillCountsARealAllocation()
        {
            using (new Noise())
            {
                Assert.AreEqual(0.0, AllocationProbe.PerCallMin(i => { }, runs: 3, iterations: 2000));
                object sink = null;
                double bytes = AllocationProbe.PerCallMin(i => sink = new object(), runs: 3, iterations: 2000);
                GC.KeepAlive(sink);
                Assert.GreaterOrEqual(bytes, 24.0, "a real allocation on every call is never the minimum's noise");
            }
        }

        /// <summary>The decode of the Q10 test, with no margin, 50 times, with other threads allocating beside it. A snapshot is a
        /// 64 B object and a 24 B array header plus 40 B per actor; a self adds an 88 B object (GarbageTests.cs).</summary>
        [TestCase(1)]
        [TestCase(68)]
        public void PlainDecodeAllocatesExactlyTheSnapshotItsSelfAndOneActorArrayInEveryRun(int actors)
        {
            byte[] spectatorFrame = new ServerMsg.Snapshot { Tick = BaseTick, Phase = 1, AckInput = BaseTick, Actors = Actors(actors) }.Encode();
            byte[] selfFrame = new ServerMsg.Snapshot
            {
                Tick = BaseTick, Phase = 1, AckInput = BaseTick, Actors = Actors(actors),
                Me = new WireSelf { Id = 3, Faction = 4, X = 400, Y = 320.5f, Facing = 1.5f, Hp = 1000, MaxHp = 1145, Status = 1, Weapon = 5, ReadyInMs = 250, Kills = 2, Gv = 20 }
            }.Encode();
            using (new Noise())
            {
                for (int run = 0; run < 50; run++)
                {
                    object sink = null;
                    double spectator = AllocationProbe.PerCall(i => sink = ServerMsg.Decode(spectatorFrame, spectatorFrame.Length), 2000);
                    double withMe = AllocationProbe.PerCall(i => sink = ServerMsg.Decode(selfFrame, selfFrame.Length), 2000);
                    GC.KeepAlive(sink);
                    Assert.AreEqual(88.0 + 40 * actors, spectator, "run " + run + ", no self");
                    Assert.AreEqual(176.0 + 40 * actors, withMe, "run " + run + ", with a self");
                }
            }
        }
    }
}
