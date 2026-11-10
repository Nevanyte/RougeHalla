using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// The InputSender's order governor: commands the seat's order budget would drop wait on the client instead.
    /// </summary>
    public class OrderGovernorTests
    {
        static List<WireCommand> Sent(List<ClientMsg.Input> frames)
        {
            return frames.SelectMany(f => f.Commands).ToList();
        }

        /// <summary>Spends <paramref name="n"/> tokens as if that many commands had just left (governed or not).</summary>
        static void Drain(InputSender s, int n, double now)
        {
            for (int i = 0; i < n; i++) s.Budget.Spend(now);
        }

        static double RustConstant(string name)
        {
            string text = File.ReadAllText(Path.Combine(Util.RepoRoot(), "crates", "rh-sim", "src", "constants.rs"));
            var m = Regex.Match(text, @"\b" + name + @":\s*f64\s*=\s*([0-9_.]+)");
            Assert.IsTrue(m.Success, name + " not found in constants.rs");
            return double.Parse(m.Groups[1].Value.Replace("_", ""), System.Globalization.CultureInfo.InvariantCulture);
        }

        [Test]
        public void TheModelMirrorsTheSimOrderBudgetConstants()
        {
            Assert.AreEqual(RustConstant("ORDER_BURST"), OrderBudgetModel.Burst);
            Assert.AreEqual(RustConstant("ORDER_PER_SECOND"), OrderBudgetModel.PerSecond);
            Assert.IsFalse(OrderBudgetModel.Costs(WireCommand.Aim(1f)));
            Assert.IsTrue(OrderBudgetModel.Costs(WireCommand.Release(1f, null)));
        }

        [Test]
        public void TheModelRefillsAtTheSimRateUpToTheBurst()
        {
            var b = new OrderBudgetModel();
            Assert.AreEqual(30.0, b.Tokens(0));
            for (int i = 0; i < 30; i++) b.Spend(0);
            Assert.AreEqual(0.0, b.Tokens(0), 1e-9);
            Assert.AreEqual(1.5, b.Tokens(100), 1e-9);
            Assert.AreEqual(1.5, b.Tokens(50), 1e-9, "an earlier time refills nothing");
            Assert.AreEqual(30.0, b.Tokens(10_000), 1e-9);
            Assert.IsTrue(b.CanSpend(10_000, 0));
        }

        [Test]
        public void WithRoomEveryCommandLeavesInTheSameFlushAsUngoverned()
        {
            var a = new InputSender();
            var b = new InputSender { Governed = false };
            foreach (var s in new[] { a, b })
            {
                s.Attack(0.5f, 10);
                s.Move(10, 20);
                s.Release(0.5f, 12);
                s.Swap(1);
                s.Aim(0.25f);
            }
            var ga = Sent(a.Flush(0));
            var gb = Sent(b.Flush(0));
            Assert.AreEqual(gb.Select(c => c.Kind), ga.Select(c => c.Kind));
            Assert.AreEqual(0, a.Pending);
            Assert.AreEqual(0, a.Held);
            Assert.AreEqual(26.0, a.Budget.Tokens(0), 1e-9, "four costed commands, Aim free");
        }

        [Test]
        public void AnExhaustedBudgetHoldsAReleaseUntilATokenIsBack()
        {
            var s = new InputSender();
            s.Attack(0f, null);
            s.Flush(0);
            Assert.IsTrue(s.TriggerHeld);
            Drain(s, 27, 0);
            Assert.AreEqual(2.0, s.Budget.Tokens(0), 1e-9);
            s.Release(0f, null);
            Assert.AreEqual(0, Sent(s.Flush(0)).Count, "2 tokens is inside the safety margin: held, not sent into a drop");
            Assert.AreEqual(1, s.Pending);
            Assert.AreEqual(1, s.Held);
            Assert.IsTrue(s.TriggerHeld);
            Assert.AreEqual(0, Sent(s.Flush(16)).Count);
            var later = Sent(s.Flush(34));
            Assert.AreEqual(1, later.Count, "2 + 0.51 tokens at 34 ms");
            Assert.AreEqual(CommandKind.Release, later[0].Kind);
            Assert.IsFalse(s.TriggerHeld);
            Assert.AreEqual(0, s.Pending);
            Assert.AreEqual(1, s.Held, "counted once however many flushes it waited");
        }

        [Test]
        public void AHeldCommandKeepsEveryLaterOneBehindItButAimStillLeaves()
        {
            var s = new InputSender();
            Drain(s, 29, 0);
            s.Pickup(new PickupHandle(3));
            s.Swap(1);
            s.Aim(1.25f);
            var now = Sent(s.Flush(0));
            Assert.AreEqual(new[] { CommandKind.Aim }, now.Select(c => c.Kind).ToArray());
            Assert.AreEqual(2, s.Pending);
            var later = Sent(s.Flush(100));
            Assert.AreEqual(new[] { CommandKind.Pickup }, later.Select(c => c.Kind).ToArray(), "2.5 tokens: one leaves, order kept");
            Assert.AreEqual(new[] { CommandKind.Swap }, Sent(s.Flush(167)).Select(c => c.Kind).ToArray());
        }

        [Test]
        public void HeldMovementOrdersCollapseToTheNewest()
        {
            var s = new InputSender();
            Drain(s, 29, 0);
            byte first = s.Move(10, 10);
            Assert.AreEqual(0, Sent(s.Flush(0)).Count);
            s.Stop();
            byte last = s.Move(30, 40);
            Assert.AreEqual(2, s.Coalesced);
            Assert.AreEqual(1, s.Pending);
            var later = Sent(s.Flush(200));
            Assert.AreEqual(1, later.Count);
            Assert.AreEqual(CommandKind.Move, later[0].Kind);
            Assert.AreEqual(last, later[0].Seq);
            Assert.AreNotEqual(first, last);
        }

        [Test]
        public void AMovementOrderAfterAHeldPressIsNotMovedAheadOfIt()
        {
            var s = new InputSender();
            Drain(s, 29, 0);
            s.Attack(0f, null);
            s.Move(5, 5);
            Assert.AreEqual(0, Sent(s.Flush(0)).Count);
            var a = Sent(s.Flush(100));
            Assert.AreEqual(new[] { CommandKind.Attack }, a.Select(c => c.Kind).ToArray());
            var b = Sent(s.Flush(167));
            Assert.AreEqual(new[] { CommandKind.Move }, b.Select(c => c.Kind).ToArray());
        }

        [Test]
        public void AStalePressIsWithdrawnWithItsQueuedRelease()
        {
            var s = new InputSender();
            Drain(s, 30, 0);
            s.Attack(0f, null);
            s.Release(0f, null);
            s.Flush(0);
            Assert.AreEqual(2, s.Pending);
            Assert.AreEqual(0, Sent(s.Flush(PressHold() + 1)).Count, "withdrawn before the refill could send it");
            Assert.AreEqual(0, s.Pending);
            Assert.AreEqual(2, s.Withdrawn);
            Assert.IsFalse(s.TriggerHeld);
        }

        [Test]
        public void AStalePressWhoseButtonIsStillDownSwallowsItsLaterRelease()
        {
            var s = new InputSender();
            Drain(s, 30, 0);
            s.Attack(0f, null);
            s.Flush(0);
            s.Flush(PressHold() + 1);
            Assert.AreEqual(0, s.Pending);
            s.Release(0f, null);
            Assert.AreEqual(0, s.Pending, "the release of a withdrawn press is not queued");
            Assert.AreEqual(2, s.Withdrawn);
            // The next press is an ordinary one again.
            s.Attack(0f, null);
            s.Release(0f, null);
            Assert.AreEqual(2, s.Pending);
        }

        [Test]
        public void AReleaseIsNeverWithdrawnWhileAnEarlierPressIsHeldOnTheServer()
        {
            var s = new InputSender();
            s.Attack(0f, null);
            s.Flush(0);
            Drain(s, 29, 0);
            s.Attack(0f, null);
            s.Release(0f, null);
            Assert.AreEqual(0, Sent(s.Flush(0)).Count);
            var later = Sent(s.Flush(PressHold() + 1));
            Assert.AreEqual(1, s.Withdrawn, "the stale second press only");
            Assert.AreEqual(new[] { CommandKind.Release }, later.Select(c => c.Kind).ToArray(), "the held trigger still gets its release");
            Assert.IsFalse(s.TriggerHeld);
        }

        [Test]
        public void UngovernedSendsEverythingAtOnceAsBefore()
        {
            var s = new InputSender { Governed = false };
            Drain(s, 30, 0);
            s.Release(0f, null);
            Assert.AreEqual(1, Sent(s.Flush(0)).Count);
            Assert.AreEqual(0, s.Pending);
        }

        [Test]
        public void SteeringRepeatsSlowDownOnALowBudgetButNeverLetTheWalkArrive()
        {
            Assert.AreEqual(SteerPacing.RepeatMs, SteerPacing.RepeatIntervalMs(true, 1.0));
            foreach (double mult in new[] { 0.25, 0.5, 1.0, 1.2, 1.5, 2.0, 3.0, 5.0 })
            {
                double ms = SteerPacing.RepeatIntervalMs(false, mult);
                double reach = SteerPacing.AheadU / (LocalMotion.PlayerSpeed * mult) * 1000.0;
                Assert.GreaterOrEqual(ms, SteerPacing.RepeatMs, "mult " + mult);
                Assert.LessOrEqual(ms, SteerPacing.LowRepeatMs, "mult " + mult);
                Assert.IsTrue(ms <= Math.Max(SteerPacing.RepeatMs, 0.6 * reach) + 1e-9, "mult " + mult);
            }
            Assert.AreEqual(SteerPacing.LowRepeatMs, SteerPacing.RepeatIntervalMs(false, 1.0));
            Assert.AreEqual(SteerPacing.LowRepeatMs, SteerPacing.RepeatIntervalMs(false, double.NaN));

            var s = new InputSender();
            Assert.IsTrue(s.SteerRepeatHasRoom(0));
            Drain(s, 22, 0);
            Assert.IsFalse(s.SteerRepeatHasRoom(0), "8 tokens: below 1 + 1.5 safety + 6 reserve");
            Assert.IsTrue(s.SteerRepeatHasRoom(40));
        }

        static double PressHold() { return InputSender.PressHoldMs; }

        // ---- a sustained fight against the server's bucket ----

        /// <summary>The server side, as rh-sim applies it: the seat's bucket refilled on SIM time when a frame is applied at a tick.</summary>
        sealed class ServerSeat
        {
            double _tokens = OrderBudgetModel.Burst, _at;
            public int Dropped, DroppedReleases, DroppedPresses;
            public bool Trigger;
            public double TriggerHeldMs;
            double _triggerSince;
            public void Apply(double simMs, WireCommand c)
            {
                if (c.Kind == CommandKind.Aim) return;
                if (simMs > _at) { _tokens = Math.Min(OrderBudgetModel.Burst, _tokens + (simMs - _at) / 1000.0 * OrderBudgetModel.PerSecond); _at = simMs; }
                if (_tokens < 1.0)
                {
                    Dropped++;
                    if (c.Kind == CommandKind.Release) DroppedReleases++;
                    if (c.Kind == CommandKind.Attack) DroppedPresses++;
                    return;
                }
                _tokens -= 1.0;
                if (c.Kind == CommandKind.Attack && !Trigger) { Trigger = true; _triggerSince = simMs; }
                if (c.Kind == CommandKind.Release && Trigger) { Trigger = false; TriggerHeldMs = Math.Max(TriggerHeldMs, simMs - _triggerSince); }
            }
        }

        struct FightResult
        {
            public int Dropped, DroppedReleases, DroppedPresses, Presses, Releases, Withdrawn, Held;
            public double LongestTrigger;
            public bool EndsHeld;
        }

        /// <summary>
        /// Twenty seconds of a strafing archer at 60 frames/s: the direction changes every 150 to 350 ms, the button is clicked every
        /// 140 to 260 ms and held 50 to 110 ms, and frames reach the server 30 to 90 ms later in order (one TCP stream) and are applied
        /// at the next 50 ms tick. Ungoverned, the held key repeats every 100 ms, as before the governor existed.
        /// </summary>
        static FightResult Fight(bool governed, int seed, bool frantic = false)
        {
            var rng = new Random(seed);
            var s = new InputSender { Governed = governed };
            var server = new ServerSeat();
            var inFlight = new List<(double at, List<ClientMsg.Input> frames)>();
            double lastArrival = 0;
            double nextTurn = 0, nextClick = 100, releaseAt = double.PositiveInfinity, lastSteer = double.NegativeInfinity;
            int dir = 0;
            bool held = false;
            var r = new FightResult();
            const double Frame = 1000.0 / 60.0;
            for (double now = 0; now < 20_000; now += Frame)
            {
                if (now >= nextTurn) { dir = (dir + 1 + rng.Next(3)) % 4; nextTurn = now + (frantic ? 90 + rng.NextDouble() * 80 : 150 + rng.NextDouble() * 200); lastSteer = double.NegativeInfinity; }
                if (!held && now >= nextClick) { s.Attack(0f, now); r.Presses++; held = true; releaseAt = now + (frantic ? 20 + rng.NextDouble() * 30 : 50 + rng.NextDouble() * 60); }
                if (held && now >= releaseAt) { s.Release(0f, now); r.Releases++; held = false; nextClick = now + (frantic ? 60 + rng.NextDouble() * 60 : 140 + rng.NextDouble() * 120); }
                double repeat = governed ? SteerPacing.RepeatIntervalMs(s.SteerRepeatHasRoom(now), 1.0) : SteerPacing.RepeatMs;
                if (now - lastSteer >= repeat) { s.Move(dir, 64); lastSteer = now; }
                s.Aim((float)(now / 1000.0));
                var frames = s.Flush(now);
                if (frames.Count > 0)
                {
                    double arrival = Math.Max(lastArrival, now + 30 + rng.NextDouble() * 60);
                    lastArrival = arrival;
                    inFlight.Add((arrival, frames));
                }
                for (int i = 0; i < inFlight.Count; i++)
                {
                    if (inFlight[i].at > now) break;
                    double sim = Math.Floor(inFlight[i].at / 50.0) * 50.0;
                    foreach (var f in inFlight[i].frames) foreach (var c in f.Commands) server.Apply(sim, c);
                    inFlight.RemoveAt(i); i--;
                }
            }
            // The button comes up, then everything still queued or in flight lands (no new input for a second).
            if (held) { s.Release(0f, 20_000); r.Releases++; }
            for (double now = 20_000; now < 21_000; now += Frame)
            {
                var frames = s.Flush(now);
                if (frames.Count > 0) inFlight.Add((Math.Max(lastArrival, now + 60), frames));
            }
            foreach (var (at, frames) in inFlight)
                foreach (var f in frames) foreach (var c in f.Commands) server.Apply(Math.Floor(at / 50.0) * 50.0, c);
            r.Dropped = server.Dropped;
            r.DroppedReleases = server.DroppedReleases;
            r.DroppedPresses = server.DroppedPresses;
            r.LongestTrigger = server.TriggerHeldMs;
            r.EndsHeld = server.Trigger;
            r.Withdrawn = s.Withdrawn;
            r.Held = s.Held;
            return r;
        }

        /// <summary>
        /// Past what the budget can carry (a turn every 90 to 170 ms, a click every 80 to 170 ms): the server still drops nothing,
        /// the client holds commands and withdraws stale presses instead, and no trigger stays down.
        /// </summary>
        [Test]
        public void AFranticFightOverTheBudgetIsHeldAndThinnedOnTheClientNotDroppedOnTheServer()
        {
            for (int seed = 1; seed <= 8; seed++)
            {
                var before = Fight(false, seed, frantic: true);
                var after = Fight(true, seed, frantic: true);
                TestContext.WriteLine($"frantic seed {seed}: ungoverned dropped {before.Dropped} (presses {before.DroppedPresses}, releases {before.DroppedReleases}), " +
                    $"longest trigger {before.LongestTrigger:F0} ms; governed dropped {after.Dropped}, held {after.Held}, withdrawn {after.Withdrawn} of " +
                    $"{after.Presses} presses, longest trigger {after.LongestTrigger:F0} ms");
                Assert.Greater(before.DroppedReleases, 0, "seed " + seed + ": ungoverned loses releases");
                Assert.Greater(after.Held, 0, "seed " + seed + ": the backstop is exercised");
                Assert.AreEqual(0, after.Dropped, "seed " + seed);
                Assert.IsFalse(after.EndsHeld, "seed " + seed);
                Assert.Less(after.LongestTrigger, 500, "seed " + seed);
            }
        }

        [Test]
        public void ASustainedStrafingFightLosesNoReleaseAndNoPressToTheBudget()
        {
            for (int seed = 1; seed <= 8; seed++)
            {
                var before = Fight(false, seed);
                var after = Fight(true, seed);
                TestContext.WriteLine($"seed {seed}: ungoverned dropped {before.Dropped} (presses {before.DroppedPresses}, releases {before.DroppedReleases}), " +
                    $"longest trigger {before.LongestTrigger:F0} ms, ends held {before.EndsHeld}; governed dropped {after.Dropped}, held {after.Held}, " +
                    $"withdrawn {after.Withdrawn}, longest trigger {after.LongestTrigger:F0} ms");
                Assert.Greater(before.Dropped, 0, "seed " + seed + ": the scenario must exhaust the ungoverned budget");
                Assert.Greater(before.DroppedPresses + before.DroppedReleases, 0, "seed " + seed + ": ungoverned loses clicks");
                Assert.AreEqual(0, after.Dropped, "seed " + seed + ": governed, the server drops nothing");
                Assert.IsFalse(after.EndsHeld, "seed " + seed + ": the trigger is released at the end");
                Assert.Less(after.LongestTrigger, 500, "seed " + seed + ": no press is held far past its release");
            }
        }
    }
}
