using System;
using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class SurfaceFxEditModeTests
    {
        readonly List<GameObject> _objects = new List<GameObject>();
        float _t; int _frame; SurfaceKind _surface;
        readonly List<string> _log = new List<string>();

        [SetUp] public void SetUp() { _t = 1f; _frame = 1; _surface = SurfaceKind.Sand; _log.Clear(); SurfaceFx.LogSink = s => _log.Add(s); AtmosphereQuality.SetUrl(""); AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, false); }
        [TearDown]
        public void TearDown()
        {
            SurfaceFx.LogSink = null; SurfaceFx.Current = null;
            foreach (var o in _objects) if (o != null) UnityEngine.Object.DestroyImmediate(o);
            _objects.Clear(); AtmosphereQuality.SetUrl(""); AtmosphereQuality.RefreshFromSettings();
        }

        SurfaceFx Make()
        {
            var go = new GameObject("surfacefx test"); _objects.Add(go);
            var fx = new SurfaceFx(go.transform, (x, y) => _surface) { Clock = () => _t, FrameStamp = () => _frame };
            return fx;
        }
        void Walk(SurfaceFx fx, uint id, ref float x, int steps, ActorKind kind = ActorKind.Player, bool local = false, bool renew = false)
        {
            for (int i = 0; i < steps; i++)
            {
                _t += .05f; _frame++; x += 8.5f;
                fx.Note(renew ? id + (uint)i : id, x, 300, kind, local, false, 1.6f, false, 0, 0);
                fx.Tick(.05f);
            }
        }

        [Test] public void EverySurfaceKindMapsToTheSameNamedPureSurfaceAndHasAnEffectProfile()
        {
            foreach (SurfaceKind k in Enum.GetValues(typeof(SurfaceKind)))
            {
                var f = (FxSurface)(byte)k;
                Assert.AreEqual(k.ToString(), f.ToString(), "enum mirror drifted for " + k);
                if (k != SurfaceKind.None) Assert.AreNotEqual(StepSound.None, SurfaceFxTable.For(f).Sound, k + " must make a sound");
            }
            Assert.AreEqual(Enum.GetValues(typeof(SurfaceKind)).Length, Enum.GetValues(typeof(FxSurface)).Length);
        }

        [Test] public void NothingIsEmittedForActorsThatWereNeverDelivered()
        {
            var fx = Make(); float x = 100;
            for (int i = 0; i < 40; i++) { _t += .05f; _frame++; fx.Tick(.05f); }
            Assert.AreEqual(0, fx.PrintsEmitted); Assert.AreEqual(0, fx.Tracks.Live(_t)); Assert.AreEqual(0, fx.Tracker.WalkerCount); Assert.AreEqual(0, _log.Count);
            // an actor that the arena does not deliver is never presented, so SurfaceFx.NoteActor is never called for it
            Assert.AreEqual(0, fx.Tracker.EventCount); Assert.AreEqual(100, x);
        }

        [Test] public void ArenaDoesNotFeedUndeliveredActors()
        {
            var go = new GameObject("arena"); _objects.Add(go); var arena = go.AddComponent<ArenaView>();
            arena.GetType().GetMethod("Awake", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(arena, null);
            var fx = SurfaceFx.Current; Assert.NotNull(fx);
            var a = new InterpActor { Id = 55, X = 120, Y = 240, Facing = .4f, HpPct = 82, Faction = FactionId.Plague, Status = ActorStatus.Alive, Weapon = WeaponId.Sword, Kind = ActorKind.Player };
            arena.RetainObservedActors(new List<InterpActor>(), null);   // latest delivery: nobody
            arena.Present(new List<InterpActor> { a }, null, null, 0);
            Assert.AreEqual(0, fx.Tracker.WalkerCount, "an actor missing from the latest delivery is not tracked");
            arena.RetainObservedActors(new List<InterpActor> { a }, null);
            arena.Present(new List<InterpActor> { a }, null, null, 0);
            Assert.AreEqual(1, fx.Tracker.WalkerCount, "a delivered actor is");
        }

        [Test] public void WalkingLeavesPrintsThatPersistAfterTheMakerLeavesAndAreGoneAfterTenSeconds()
        {
            var fx = Make(); float x = 100; fx.Note(1, x, 300, ActorKind.Player, false, false, 1.6f, false, 0, 0);
            Walk(fx, 1, ref x, 40);
            int born = fx.PrintsEmitted; Assert.Greater(born, 6, "a trail forms");
            Assert.AreEqual(born, fx.Tracks.Live(_t));
            // the maker is no longer delivered: no more Note calls. The prints stay for their whole life.
            float left = _t;
            _t = left + 5f; fx.Tick(.05f); Assert.AreEqual(born, fx.Tracks.Live(_t), "still there 5 s after");
            _t = left + 9f; fx.Tick(.05f); Assert.Greater(fx.Tracks.Live(_t), 0, "oldest may be gone, newest remain at 9 s");
            _t = left + 12.5f; fx.Tick(.05f); Assert.AreEqual(0, fx.Tracks.Live(_t), "all gone after 10 s");
            Assert.AreEqual(born, fx.PrintsEmitted, "nothing was invented for the departed actor");
        }

        [Test] public void MobWithRenewedHandlesStillLeavesAnEvenTrail()
        {
            var fx = Make(); float x = 100; fx.Note(500, x, 300, ActorKind.RegionalMob, false, false, 1.6f, false, 0, 0);
            Walk(fx, 500, ref x, 60, ActorKind.RegionalMob, renew: true);
            Assert.Greater(fx.PrintsEmitted, 8); Assert.LessOrEqual(fx.Tracker.WalkerCount, 3);
        }

        [Test] public void CapRecyclesOldestAndPoolNeverGrows()
        {
            var fx = Make(); fx.Tracks.SetCap(16); float x = 100;
            fx.Note(1, x, 300, ActorKind.Player, false, false, 1.6f, false, 0, 0);
            Walk(fx, 1, ref x, 200);
            Assert.AreEqual(16, fx.Tracks.Capacity); Assert.Greater(fx.Tracks.Recycled, 0);
            Assert.LessOrEqual(fx.Tracks.Live(_t), 16);
            fx.Tracks.SetCap(0); float before = fx.PrintsEmitted; Walk(fx, 1, ref x, 20); Assert.AreEqual(0, fx.Tracks.Live(_t));
        }

        [Test] public void WaterAndBogProduceRipplesNotPrintsAndStonePrintsNothing()
        {
            var fx = Make(); float x = 100; _surface = SurfaceKind.ShallowWater;
            fx.Note(1, x, 300, ActorKind.Player, false, false, 1.6f, false, 0, 0); Walk(fx, 1, ref x, 40);
            Assert.AreEqual(0, fx.PrintsEmitted); Assert.Greater(fx.RipplesEmitted, 4); Assert.Greater(fx.Fluids.Live(_t), 0);
            var buf = new SurfaceFx.RippleInfo[SurfaceFx.MaxRipples]; int n = fx.CopyRipples(buf); Assert.Greater(n, 0); Assert.AreEqual(WaterReaction.Shallow, buf[0].Reaction);
            _surface = SurfaceKind.Bog; int ripplesBefore = fx.RipplesEmitted; Walk(fx, 1, ref x, 40);
            Assert.Greater(fx.RipplesEmitted, ripplesBefore); n = fx.CopyRipples(buf); bool bog = false; for (int i = 0; i < n; i++) bog |= buf[i].Reaction == WaterReaction.Bog; Assert.IsTrue(bog);
            _surface = SurfaceKind.TempleFloor; int p = fx.PrintsEmitted; Walk(fx, 1, ref x, 100);
            Assert.AreEqual(FootTracker.WetPrints, fx.PrintsEmitted - p, "only the wet prints that follow the bog");
        }

        [Test] public void FootstepsFollowTheSurfaceAndThePhaseAndEmitNothingWhenSwitchedOff()
        {
            var fx = Make(); float x = 100, ph = 0; _surface = SurfaceKind.Snow;
            fx.Note(1, x, 300, ActorKind.Player, true, false, 1.6f, true, ph, 8);
            for (int i = 0; i < 40; i++) { _t += .05f; _frame++; x += 8; ph += .5f; fx.Note(1, x, 300, ActorKind.Player, true, false, 1.6f, true, ph, 8); }
            int steps = _log.FindAll(l => l.StartsWith("step surface=Snow sound=Snow actor=Local")).Count;
            Assert.That(steps, Is.InRange(4, 7), "20 frames of phase on an 8-frame clip is 2.5 cycles = 5 contacts");
            _log.Clear(); AtmosphereQuality.SetUrl("?fx.footsteps=0");
            for (int i = 0; i < 40; i++) { _t += .05f; _frame++; x += 8; ph += .5f; fx.Note(1, x, 300, ActorKind.Player, true, false, 1.6f, true, ph, 8); }
            Assert.AreEqual(0, _log.FindAll(l => l.StartsWith("step")).Count);
        }

        [Test] public void QualityAndReducedMotionSwitchTheEffects()
        {
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.Low, false);
            Assert.AreEqual(384, AtmosphereQuality.SurfaceTrackCap); Assert.IsFalse(AtmosphereQuality.SurfaceRipples);
            AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, true);
            Assert.Greater(AtmosphereQuality.SurfaceTrackCap, 0); Assert.IsFalse(AtmosphereQuality.SurfaceRipples); Assert.IsFalse(AtmosphereQuality.SurfaceGlisten);
            AtmosphereQuality.SetUrl("?fx.tracks=0&fx.ripples=0&fx.footsteps=0");
            Assert.AreEqual(0, AtmosphereQuality.SurfaceTrackCap); Assert.IsFalse(AtmosphereQuality.SurfaceFootsteps);
            var fx = Make(); Assert.AreEqual(0, fx.Tracks.Capacity);
            float x = 100; fx.Note(1, x, 300, ActorKind.Player, false, false, 1.6f, false, 0, 0); Walk(fx, 1, ref x, 40); Assert.AreEqual(0, fx.Tracks.Live(_t));
        }

        [Test] public void AtlasHasShapesInEveryCell()
        {
            for (int cell = 0; cell <= SurfaceFxAtlas.GrassTrail; cell++)
            {
                float best = 0; for (int y = 0; y < 32; y++) for (int xx = 0; xx < 32; xx++) { SurfaceFxAtlas.Sample(cell, (xx + .5f) / 32f, (y + .5f) / 32f, out _, out float a); best = Mathf.Max(best, a); }
                Assert.Greater(best, .4f, "cell " + cell);
            }
        }
    }
}
