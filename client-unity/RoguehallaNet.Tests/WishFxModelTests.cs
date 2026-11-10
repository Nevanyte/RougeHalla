using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;

namespace Roguehalla.Net.Tests
{
    public class WishFxModelTests
    {
        static AreaView Row(AreaKind kind, AbilityId ability, float x, float y, float x2, float y2, float r, double start, double end, uint? owner = null)
        {
            return new AreaView { Kind = kind, Ability = ability, X = x, Y = y, X2 = x2, Y2 = y2, Radius = r, StartedAt = start, EndsAt = end, Owner = owner };
        }

        [Test]
        public void ExtentsAreCopiesOfTheDeliveredRow()
        {
            var zone = new WishAreaFacts(Row(AreaKind.Zone, AbilityId.Trial, 3600, 1040, 0, 0, 300, 57900, 62900, 3));
            Assert.That(zone.CircleRadius, Is.EqualTo(300f)); Assert.That(zone.TrailHalfWidth, Is.EqualTo(0f));
            Assert.That(zone.X, Is.EqualTo(3600f)); Assert.That(zone.Owner, Is.EqualTo(3u));
            var cloud = new WishAreaFacts(Row(AreaKind.Cloud, AbilityId.Swarm, 4208, 1360, 0, 0, 72, 57800, 65800));
            Assert.That(cloud.CircleRadius, Is.EqualTo(72f)); Assert.That(cloud.Owner, Is.EqualTo(0u));
            var trail = new WishAreaFacts(Row(AreaKind.Trail, AbilityId.Blaze, 4304, 2512, 4504, 2632, 20, 57600, 60100, 5));
            Assert.That(trail.TrailHalfWidth, Is.EqualTo(20f)); Assert.That(trail.CircleRadius, Is.EqualTo(0f));
            Assert.That(trail.TrailLength, Is.EqualTo(233.238f).Within(.01f));
        }

        [Test]
        public void AreaClockComesFromTheRowNotFromAConstant()
        {
            var zone = new WishAreaFacts(Row(AreaKind.Zone, AbilityId.Trial, 0, 0, 0, 0, 300, 1000, 6000));
            Assert.That(zone.Elapsed(1000), Is.EqualTo(0f)); Assert.That(zone.Elapsed(3500), Is.EqualTo(.5f).Within(1e-5));
            Assert.That(zone.Remaining(6000), Is.EqualTo(0f)); Assert.That(zone.Elapsed(9999), Is.EqualTo(1f));
            Assert.That(zone.Elapsed(0), Is.EqualTo(0f));
            var instant = new WishAreaFacts(Row(AreaKind.Zone, AbilityId.Trial, 0, 0, 0, 0, 300, 1000, 1000));
            Assert.That(instant.Elapsed(1000), Is.EqualTo(1f), "a row without duration is complete, never a divide by zero");
        }

        [Test]
        public void FactionColourFollowsTheAbility()
        {
            Assert.That(WishFxModel.FactionIndex(AbilityId.Freeze), Is.EqualTo(3));
            Assert.That(WishFxModel.FactionIndex(AbilityId.Swarm), Is.EqualTo(2));
            Assert.That(WishFxModel.FactionIndex(AbilityId.Trial), Is.EqualTo(1));
            Assert.That(WishFxModel.FactionIndex(AbilityId.Blaze), Is.EqualTo(0));
            Assert.That(WishFxModel.FactionIndex(AbilityId.LastStand), Is.EqualTo(4));
        }

        [Test]
        public void AreaTrackerReportsNewRowsOnceAndEndedRowsWithTheirNaturalness()
        {
            var t = new WishAreaTracker(); var ended = new List<WishAreaEnded>();
            var a = new WishAreaFacts(Row(AreaKind.Zone, AbilityId.Trial, 10, 20, 0, 0, 300, 1000, 6000));
            var b = new WishAreaFacts(Row(AreaKind.Trail, AbilityId.Blaze, 1, 2, 3, 4, 20, 1000, 3500));
            t.BeginFrame(); Assert.That(t.Observe(a, 1000), Is.True); Assert.That(t.Observe(b, 1000), Is.True); t.EndFrame(ended);
            Assert.That(ended, Is.Empty); Assert.That(t.LiveCount, Is.EqualTo(2));
            t.BeginFrame(); Assert.That(t.Observe(a, 1050), Is.False, "the same row is not new again"); Assert.That(t.Observe(b, 1050), Is.False); t.EndFrame(ended);
            // the trail expires on schedule, the zone vanishes early (its subject left the ring)
            t.BeginFrame(); t.Observe(a, 1100); t.EndFrame(ended);
            Assert.That(ended.Count, Is.EqualTo(1)); Assert.That(ended[0].Natural, Is.False);
            ended.Clear();
            t.BeginFrame(); t.Observe(new WishAreaFacts(Row(AreaKind.Zone, AbilityId.Trial, 10, 20, 0, 0, 300, 1000, 6000)), 5990); t.EndFrame(ended);
            t.BeginFrame(); t.EndFrame(ended);
            Assert.That(ended.Count, Is.EqualTo(1)); Assert.That(ended[0].Natural, Is.True); Assert.That(ended[0].Facts.CircleRadius, Is.EqualTo(300f));
            Assert.That(t.LiveCount, Is.EqualTo(0));
        }

        [Test]
        public void AreaTrackerIsBounded()
        {
            var t = new WishAreaTracker(); t.BeginFrame(); int fresh = 0;
            for (int i = 0; i < WishAreaTracker.Capacity + 10; i++)
                if (t.Observe(new WishAreaFacts(Row(AreaKind.Cloud, AbilityId.Swarm, i, 0, 0, 0, 72, 0, 1000)), 0)) fresh++;
            Assert.That(fresh, Is.EqualTo(WishAreaTracker.Capacity)); Assert.That(t.LiveCount, Is.EqualTo(WishAreaTracker.Capacity));
        }

        [Test]
        public void StatusEdgesFireOnlyOnChangeAndNeverForAFirstSightingOrADeadActor()
        {
            var t = new WishStatusTracker(); WishStatusEdge e;
            t.BeginFrame(); Assert.That(t.Note(7, WishEffectBits.Stunned, true, out e), Is.False, "already running when first seen"); t.EndFrame();
            t.BeginFrame(); Assert.That(t.Note(7, WishEffectBits.Stunned, true, out e), Is.False); t.EndFrame();
            t.BeginFrame(); Assert.That(t.Note(7, 0, true, out e), Is.True);
            Assert.That(e.Ended, Is.EqualTo(WishEffectBits.Stunned)); Assert.That(e.Started, Is.EqualTo(0)); t.EndFrame();
            t.BeginFrame(); Assert.That(t.Note(7, (ushort)(WishEffectBits.LastStand | WishEffectBits.Haste), true, out e), Is.True);
            Assert.That(e.Started, Is.EqualTo((ushort)(WishEffectBits.LastStand | WishEffectBits.Haste))); t.EndFrame();
            t.BeginFrame(); Assert.That(t.Note(7, 0, false, out e), Is.False, "a death is not a status end"); t.EndFrame();
            t.BeginFrame(); Assert.That(t.Note(0, 1, true, out e), Is.False, "id 0 is never tracked"); t.EndFrame();
        }

        [Test]
        public void StatusTrackerForgetsActorsThatLeftObservation()
        {
            var t = new WishStatusTracker(); WishStatusEdge e;
            t.BeginFrame(); t.Note(9, WishEffectBits.LastStand, true, out e); t.EndFrame();
            t.BeginFrame(); t.EndFrame(); // 9 left view
            t.BeginFrame(); Assert.That(t.Note(9, 0, true, out e), Is.False, "a returning actor is a first sighting, not an end edge"); t.EndFrame();
        }

        [Test]
        public void BudgetFollowsQualityAndReducedMotion()
        {
            Assert.That(WishFxModel.Budget(20, 0f, false, 100), Is.EqualTo(0), "Low quality draws no optional particles");
            Assert.That(WishFxModel.Budget(20, 1f, true, 100), Is.EqualTo(0), "reduced motion drops particles");
            Assert.That(WishFxModel.Budget(20, 1f, false, 100), Is.EqualTo(20));
            Assert.That(WishFxModel.Budget(20, .35f, false, 100), Is.EqualTo(7));
            Assert.That(WishFxModel.Budget(20, 1.5f, false, 25), Is.EqualTo(25), "the cap wins over the multiplier");
            Assert.That(WishFxModel.Budget(20, 99f, false, 100), Is.EqualTo(30), "the multiplier itself is bounded");
        }

        [Test]
        public void PulseIsSteadyUnderReducedMotion()
        {
            for (double s = 0; s < 3; s += .37) Assert.That(WishFxModel.Pulse(s, .9f, true), Is.EqualTo(1f));
            Assert.That(WishFxModel.Pulse(.225, .9f, false), Is.EqualTo(1f).Within(1e-4));
            Assert.That(WishFxModel.Pulse(.675, .9f, false), Is.EqualTo(0f).Within(1e-4));
        }

        [Test]
        public void HashIsDeterministicAndSpread()
        {
            Assert.That(WishFxModel.Hash01(5), Is.EqualTo(WishFxModel.Hash01(5)));
            var seen = new HashSet<float>(); for (uint i = 0; i < 64; i++) { float h = WishFxModel.Hash01(i); Assert.That(h, Is.InRange(0f, 1f)); seen.Add(h); }
            Assert.That(seen.Count, Is.GreaterThan(55));
        }

        static WishView Wish(double readyAt, byte charges, byte max = 1, bool cast = false, AbilityId ability = AbilityId.Freeze)
        {
            return new WishView { Ability = ability, ReadyAt = readyAt, Charges = charges, MaxCharges = max, RechargeMs = 45000,
                Cast = cast ? new WishCastView { Ability = ability, StartedAt = 1000, LandsAt = 1250 } : (WishCastView?)null };
        }

        [Test]
        public void TileFlashesOnAcceptedCastAndPulsesWhenReadyAgain()
        {
            var m = new WishTileMotion();
            m.Observe(Wish(50000, 1), 60000, 10f);
            Assert.That(m.Flash(10f), Is.EqualTo(0f)); Assert.That(m.ReadyPulse(10f + WishTileMotion.ReadyPulseSeconds / 2), Is.EqualTo(0f), "a first-seen ready state is not an event");
            m.Observe(Wish(50000, 1), 60000, 10.1f);
            m.Observe(Wish(105000, 0), 60100, 11f);
            Assert.That(m.Flash(11f), Is.EqualTo(1f), "stock dropped and ready time jumped: the cast was accepted");
            Assert.That(m.Flash(11f + WishTileMotion.FlashSeconds), Is.EqualTo(0f));
            m.Observe(Wish(105000, 0), 104000, 12f);
            m.Observe(Wish(105000, 1), 105000, 13f);
            Assert.That(m.ReadyPulse(13f + WishTileMotion.ReadyPulseSeconds / 2), Is.EqualTo(1f).Within(1e-4));
        }

        [Test]
        public void TileFlashesOnTheDeliveredCastWindowAndIgnoresAChangedAbility()
        {
            var m = new WishTileMotion();
            m.Observe(Wish(50000, 1), 60000, 1f);
            m.Observe(Wish(50000, 1, 1, true), 60010, 2f);
            Assert.That(m.Flash(2f), Is.EqualTo(1f), "a cast record appeared");
            m.Observe(Wish(100000, 1, 1, false, AbilityId.Blaze), 60100, 3f);
            Assert.That(m.Flash(3f), Is.EqualTo(0f), "another ability appearing (respawn, new run) is not a cast");
            m.Observe(null, 60200, 4f); m.Observe(Wish(1, 1), 60300, 5f);
            Assert.That(m.Flash(5f) + m.ReadyPulse(5.5f), Is.EqualTo(0f), "losing the record resets the state");
        }

        [Test]
        public void TileTreatsBlazeStockSpendAsACast()
        {
            var m = new WishTileMotion();
            m.Observe(Wish(1000, 2, 2, false, AbilityId.Blaze), 5000, 1f);
            m.Observe(Wish(5050, 1, 2, false, AbilityId.Blaze), 5050, 2f);
            Assert.That(m.Flash(2f), Is.EqualTo(1f));
        }
    }
}
