using System;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net;

namespace Roguehalla.Net.Tests
{
    public class SurfaceFxTests
    {
        static Observation Obs(uint id, float x, float y, float now, int frame, FxSurface s = FxSurface.Sand, bool mob = false, bool phase = false, float ph = 0)
            => new Observation { Id = id, Mob = mob, Alive = true, X = x, Y = y, Size = 1f, Surface = s, Now = now, Frame = frame, PhaseValid = phase, Phase = ph, WalkFrames = 8 };

        static int Count(FootTracker t, FootEventKind k) => t.Events.Take(t.EventCount).Count(e => e.Kind == k);

        [Test] public void TableCoversEveryKindAndDecidesTheDocumentedLooks()
        {
            foreach (FxSurface s in Enum.GetValues(typeof(FxSurface)))
            {
                var p = SurfaceFxTable.For(s);
                if (s != FxSurface.None) Assert.AreNotEqual(StepSound.None, p.Sound, s + " must have a footstep sound");
            }
            Assert.AreEqual(PrintStyle.Sand, SurfaceFxTable.For(FxSurface.Sand).Print);
            Assert.AreEqual(PrintStyle.Snow, SurfaceFxTable.For(FxSurface.Snow).Print);
            Assert.AreEqual(PrintStyle.None, SurfaceFxTable.For(FxSurface.ShallowWater).Print);
            Assert.AreEqual(WaterReaction.Shallow, SurfaceFxTable.For(FxSurface.ShallowWater).Water);
            Assert.AreEqual(WaterReaction.Bog, SurfaceFxTable.For(FxSurface.Bog).Water);
            Assert.AreNotEqual(SurfaceFxTable.For(FxSurface.Bog).Sound, SurfaceFxTable.For(FxSurface.ShallowWater).Sound);
            Assert.AreNotEqual(SurfaceFxTable.For(FxSurface.TempleFloor).Sound, SurfaceFxTable.For(FxSurface.Flagstone).Sound);
        }

        [Test] public void FadeCurveHoldsThenFadesToZeroAtTenSeconds()
        {
            Assert.AreEqual(1f, TrackLife.Alpha(5f, 10f, 2.5f), 1e-4);
            Assert.AreEqual(1f, TrackLife.Alpha(7.5f, 10f, 2.5f), 1e-4);
            Assert.That(TrackLife.Alpha(9f, 10f, 2.5f), Is.InRange(0.05f, 0.95f));
            Assert.AreEqual(0f, TrackLife.Alpha(10f, 10f, 2.5f));
            Assert.AreEqual(0f, TrackLife.Alpha(11f, 10f, 2.5f));
            Assert.That(TrackLife.Alpha(0.02f, 10f, 2.5f), Is.LessThan(0.5f));
            float prev = 1f; for (float a = 7.5f; a < 10f; a += .1f) { float v = TrackLife.Alpha(a, 10f, 2.5f); Assert.LessOrEqual(v, prev + 1e-5f); prev = v; }
        }

        [Test] public void FootfallsComeFromWalkPhaseTwicePerCycleForwardAndBackward()
        {
            Assert.AreEqual(0, Footfalls.Crossings(0.2f, 3.9f, 8));
            Assert.AreEqual(1, Footfalls.Crossings(3.9f, 4.1f, 8));
            Assert.AreEqual(2, Footfalls.Crossings(0.5f, 8.5f, 8) );
            int total = 0; float p = 0.1f; for (int i = 0; i < 80; i++) { total += Footfalls.Crossings(p, p + .1f, 8); p += .1f; }   // 8 frames of phase = 1 cycle
            Assert.AreEqual(2, total);
            Assert.AreEqual(1, Footfalls.Crossings(4.1f, 3.9f, 8), "backward walking steps too");
            Assert.AreEqual(1, Footfalls.Crossings(0.1f, -0.1f, 8));
        }

        [Test] public void EmitsAlternatingPrintsSpacedByStrideWithoutStableIds()
        {
            var t = new FootTracker(); float now = 0; int frame = 0; float x = 100;
            t.Observe(Obs(1, x, 100, now, frame));
            var feet = new System.Collections.Generic.List<int>(); var xs = new System.Collections.Generic.List<float>();
            for (int i = 0; i < 60; i++)
            {
                now += .05f; frame++; x += 8.5f;                      // 170 u/s at 20 Hz
                uint id = (uint)(1000 + i);                            // the handle is renewed on every observation
                t.Observe(Obs(id, x, 100, now, frame, mob: true)); if (i == 0) { /* first mob observation creates its walker */ }
            }
            // a mob walker was created on the first renewed handle and continued by position afterwards
            var prints = t.Events.Take(t.EventCount).Where(e => e.Kind == FootEventKind.Print).ToList();
            Assert.GreaterOrEqual(prints.Count, 8, "prints continue across renewed handles");
            for (int i = 1; i < prints.Count; i++) Assert.AreNotEqual(prints[i - 1].Foot, prints[i].Foot, "alternating feet");
            for (int i = 1; i < prints.Count; i++) Assert.AreEqual(FootTracker.StrideTiles * 32f, prints[i].X - prints[i - 1].X, 3f);
            Assert.LessOrEqual(t.WalkerCount, 3);
        }

        [Test] public void NothingIsEmittedForAnActorThatIsNotObserved()
        {
            var t = new FootTracker(); float now = 0; int frame = 0; float x = 0;
            t.Observe(Obs(7, x, 0, now, frame));
            for (int i = 0; i < 20; i++) { now += .05f; frame++; x += 8; t.Observe(Obs(7, x, 0, now, frame)); }
            int before = t.EventCount; Assert.Greater(before, 0);
            // the actor leaves delivery: no more observations, so the tracker is silent however long we wait
            Assert.AreEqual(before, t.EventCount);
            // and when it reappears far away (a teleport or a long gap) the gap is not bridged with prints
            t.ClearEvents(); t.Observe(Obs(7, x + 5000, 0, now + 5f, frame + 100));
            Assert.AreEqual(0, t.EventCount);
        }

        [Test] public void FootstepFromPhaseIsTwicePerCycleAndFallsBackToDistanceForMobsWithoutPhase()
        {
            var t = new FootTracker(); float now = 0; int frame = 0; float x = 0, phase = 0;
            t.Observe(Obs(1, x, 0, now, frame, phase: true, ph: phase));
            for (int i = 0; i < 40; i++) { now += .05f; frame++; x += 8; phase += .5f; t.Observe(Obs(1, x, 0, now, frame, phase: true, ph: phase)); }
            Assert.AreEqual(5, Count(t, FootEventKind.Step), 3, "20 frames of phase over an 8-frame clip: 5 contacts (+/- the first)");
            var m = new FootTracker(); now = 0; frame = 0; x = 0;
            m.Observe(Obs(9, x, 0, now, frame, mob: true));
            for (int i = 0; i < 40; i++) { now += .05f; frame++; x += 8; m.Observe(Obs(9, x, 0, now, frame, mob: true)); }
            Assert.GreaterOrEqual(Count(m, FootEventKind.Step), 4);
        }

        [Test] public void DuplicateObservationInOneFrameIsIgnored()
        {
            var t = new FootTracker(); t.Observe(Obs(3, 0, 0, 0, 0, mob: true));
            t.Observe(Obs(3, 20, 0, .05f, 1, mob: true)); int n = t.EventCount;
            t.Observe(Obs(4, 20, 0, .05f, 1, mob: true));   // renewed handle, same frame, same spot
            Assert.AreEqual(n, t.EventCount); Assert.AreEqual(1, t.WalkerCount);
        }

        [Test] public void WaterGivesRingsWakeAndIdleRingsAndWetPrintsOnTheNextSurface()
        {
            var t = new FootTracker(); float now = 0; int frame = 0; float x = 0;
            t.Observe(Obs(1, x, 0, now, frame, FxSurface.ShallowWater));
            for (int i = 0; i < 40; i++) { now += .05f; frame++; x += 8; t.Observe(Obs(1, x, 0, now, frame, FxSurface.ShallowWater)); }
            Assert.Greater(Count(t, FootEventKind.Wake), 5); Assert.Greater(Count(t, FootEventKind.Print), 3);
            Assert.AreEqual(0, t.Events.Take(t.EventCount).Count(e => e.Kind == FootEventKind.Print && e.Style != PrintStyle.None), "no dry prints in water");
            t.ClearEvents();
            for (int i = 0; i < 60; i++) { now += .05f; frame++; t.Observe(Obs(1, x, 0, now, frame, FxSurface.ShallowWater)); }
            Assert.GreaterOrEqual(Count(t, FootEventKind.Idle), 2, "idle rings when standing still");
            t.ClearEvents();
            for (int i = 0; i < 80; i++) { now += .05f; frame++; x += 8; t.Observe(Obs(1, x, 0, now, frame, FxSurface.Flagstone)); }
            var wet = t.Events.Take(t.EventCount).Where(e => e.Kind == FootEventKind.Print).ToList();
            Assert.AreEqual(FootTracker.WetPrints, wet.Count, "a few wet prints on a surface that would leave none");
            Assert.IsTrue(wet.All(e => e.Style == PrintStyle.Wet)); Assert.Less(wet.Last().Wetness, wet.First().Wetness);
        }

        [Test] public void StoneLeavesNothing()
        {
            var t = new FootTracker(); float now = 0; int frame = 0; float x = 0;
            t.Observe(Obs(1, x, 0, now, frame, FxSurface.TempleFloor));
            for (int i = 0; i < 40; i++) { now += .05f; frame++; x += 8; t.Observe(Obs(1, x, 0, now, frame, FxSurface.TempleFloor)); }
            Assert.AreEqual(0, Count(t, FootEventKind.Print)); Assert.Greater(Count(t, FootEventKind.Step), 0);
        }

        [Test] public void PoolCapsAndRecyclesOldest()
        {
            var p = new MarkPool(4);
            for (int i = 0; i < 4; i++) p.Add(i, 10);
            Assert.AreEqual(4, p.LiveCount(3.5f));
            int slot = p.Add(4, 10);
            Assert.AreEqual(0, slot, "the oldest slot is reused"); Assert.AreEqual(1, p.Recycled); Assert.AreEqual(4, p.Used);
            Assert.AreEqual(0, p.LiveCount(20f), "everything is gone after its life");
            var off = new MarkPool(0); Assert.AreEqual(-1, off.Add(0, 1));
        }

        [Test] public void TrackPersistsAfterItsMakerDepartsAndIsGoneAfterTenSeconds()
        {
            var p = new MarkPool(16); int slot = p.Add(1f, TrackLife.Lifetime);
            // the maker is never observed again: the mark is just data with a birth time
            Assert.IsTrue(p.IsLive(slot, 1f + 5f)); Assert.IsTrue(p.IsLive(slot, 1f + 9.9f));
            Assert.IsFalse(p.IsLive(slot, 1f + 10.01f));
        }

        [Test] public void VoicingAttenuatesPansAndPrioritisesNearest()
        {
            Assert.IsTrue(FootstepVoicing.Plan(true, false, 0, 0, out float g, out _)); Assert.AreEqual(1f, g);
            Assert.IsTrue(FootstepVoicing.Plan(false, false, 3, 0.9f, out float gp, out float pan)); Assert.Greater(pan, 0.5f);
            Assert.IsTrue(FootstepVoicing.Plan(false, true, 3, 0, out float gm, out _)); Assert.Less(gm, gp, "mobs are quieter");
            Assert.IsFalse(FootstepVoicing.Plan(false, false, 20, 0, out _, out _), "out of radius");
            Assert.IsTrue(FootstepVoicing.Plan(false, false, 2, 0, out float near, out _)); Assert.IsTrue(FootstepVoicing.Plan(false, false, 10, 0, out float far, out _)); Assert.Greater(near, far);
            var v = new VoicePicker(2);
            Assert.AreEqual(0, v.Acquire(0, 8, 1)); Assert.AreEqual(1, v.Acquire(0, 5, 1));
            Assert.AreEqual(-1, v.Acquire(0, 9, 1), "farther than all playing voices is dropped");
            Assert.AreEqual(0, v.Acquire(0, 2, 1), "nearer steals the farthest voice");
            Assert.AreEqual(2, v.Active(0.5f)); Assert.AreEqual(0, v.Active(2f));
        }

        [Test] public void SynthProducesDistinctBoundedClipsForEverySound()
        {
            foreach (StepSound s in Enum.GetValues(typeof(StepSound)))
            {
                if (s == StepSound.None) continue;
                var a = FootstepSynth.Render(s, 0); var b = FootstepSynth.Render(s, 1);
                Assert.Greater(a.Length, 1500, s.ToString()); Assert.Less(a.Length, 12000, s.ToString());
                Assert.IsTrue(a.All(f => !float.IsNaN(f) && Math.Abs(f) <= 1f), s.ToString());
                Assert.IsFalse(a.SequenceEqual(b), s + " variants differ");
                Assert.AreEqual(a.Length, FootstepSynth.Render(s, 0).Length);
                CollectionAssert.AreEqual(a, FootstepSynth.Render(s, 0), "deterministic");
            }
        }

        [Test] public void QualityAndReducedMotionSwitches()
        {
            Assert.AreEqual(SurfaceFxQuality.MaxTracks, SurfaceFxQuality.Decide(2, false).TrackCap);
            Assert.IsFalse(SurfaceFxQuality.Decide(0, false).Ripples); Assert.IsTrue(SurfaceFxQuality.Decide(1, false).Ripples);
            var r = SurfaceFxQuality.Decide(3, true);
            Assert.IsFalse(r.Ripples); Assert.IsFalse(r.Glisten); Assert.Greater(r.TrackCap, 0); Assert.IsTrue(r.Footsteps);
        }
    }

}
