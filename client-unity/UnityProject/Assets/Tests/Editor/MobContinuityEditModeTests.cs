using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>Creature art follows a renewed observer handle; a creature that really stops being delivered fades out where it was.</summary>
    public sealed class MobContinuityEditModeTests
    {
        GameObject _root; SpriteActorPresenter _presenter; float _now;

        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("mob continuity test");
            _presenter = new SpriteActorPresenter(_root.transform, null);
            _now = 50f; SpriteActorPresenter.FadeClock = () => _now;
            SpriteActorPresenter.ContinuityEnabled = true;
            _presenter.ExitFadesAllowed = true; _presenter.Delivered = new HashSet<uint>();
            SpriteActorPresenter.MobArt.Reset();
        }

        [TearDown]
        public void TearDown() { SpriteActorPresenter.FadeClock = null; Object.DestroyImmediate(_root); }

        void Show(uint id, float x, float y, ActorStatus status = ActorStatus.Alive, ActorKind kind = ActorKind.RegionalMob, string key = "grunt")
        {
            _presenter.Begin();
            _presenter.Present(id, x, y, 0, 80, null, status, null, kind, null, 0, 0, false, 0, 0, key);
            _presenter.End(); _presenter.StepFades();
        }

        void Deliver(params uint[] ids) { var set = new HashSet<uint>(ids); _presenter.Delivered = set; _presenter.Retain(set); }

        [Test]
        public void A_renewed_handle_takes_over_the_art_without_a_create_or_a_ghost()
        {
            Show(1, 640, 640); Assert.AreEqual(1, SpriteActorPresenter.MobArt.Created);
            Deliver(2);
            Show(2, 648, 640);
            Assert.IsTrue(_presenter.Contains(2)); Assert.IsFalse(_presenter.Contains(1));
            Assert.AreEqual(0, _presenter.GhostCount);
            Assert.AreEqual(1, SpriteActorPresenter.MobArt.Created, "no second create");
            Assert.AreEqual(1, SpriteActorPresenter.MobArt.Continued);
            Assert.AreEqual(0, SpriteActorPresenter.MobArt.Destroyed);
        }

        [Test]
        public void A_creature_that_stops_being_delivered_fades_out_in_place_then_is_released()
        {
            Show(1, 640, 640); _now += 1f; Show(1, 640, 640);
            Deliver(99);
            Assert.IsFalse(_presenter.Contains(1)); Assert.AreEqual(1, _presenter.GhostCount);
            _presenter.TryPosition(1, out _); // no longer a live actor: nothing to query
            _now += .13f; _presenter.StepFades();
            Assert.AreEqual(1, _presenter.GhostCount, "mid fade");
            _now += .2f; _presenter.StepFades();
            Assert.AreEqual(0, _presenter.GhostCount);
            Assert.AreEqual(1, SpriteActorPresenter.MobArt.Destroyed);
        }

        [Test]
        public void A_far_or_different_creature_is_a_real_arrival()
        {
            Show(1, 640, 640);
            Deliver(2);
            Show(2, 640 + 200, 640);
            Assert.AreEqual(2, SpriteActorPresenter.MobArt.Created, "two tiles is the limit");
            Assert.AreEqual(0, SpriteActorPresenter.MobArt.Continued);
        }

        [Test]
        public void A_different_look_nearby_does_not_take_over()
        {
            Show(1, 640, 640, key: "grunt");
            Deliver(2);
            Show(2, 642, 640, key: "brute");
            Assert.AreEqual(2, SpriteActorPresenter.MobArt.Created);
        }

        [Test]
        public void A_dead_creature_keeps_the_plain_release_and_is_never_ghosted()
        {
            Show(1, 640, 640, ActorStatus.Dead);
            Deliver(99);
            Assert.AreEqual(0, _presenter.GhostCount);
            Assert.IsFalse(_presenter.Contains(1));
            Assert.AreEqual(1, SpriteActorPresenter.MobArt.Destroyed);
        }

        [Test]
        public void A_late_renewal_inside_the_stale_window_restores_a_partly_faded_creature()
        {
            Show(1, 640, 640); _now += 1f; Show(1, 640, 640); Deliver(99);
            _now += .1f; _presenter.StepFades();
            Show(2, 650, 640);
            Assert.IsTrue(_presenter.Contains(2)); Assert.AreEqual(0, _presenter.GhostCount);
            Assert.AreEqual(1, SpriteActorPresenter.MobArt.Continued);
        }

        [Test]
        public void With_continuity_off_creatures_keep_the_old_pop()
        {
            SpriteActorPresenter.ContinuityEnabled = false;
            Show(1, 640, 640); Deliver(2);
            Assert.AreEqual(0, _presenter.GhostCount); Assert.IsFalse(_presenter.Contains(1));
            Show(2, 642, 640);
            Assert.AreEqual(2, SpriteActorPresenter.MobArt.Created);
            Assert.AreEqual(1, SpriteActorPresenter.MobArt.Destroyed);
            SpriteActorPresenter.ContinuityEnabled = true;
        }
    }
}
