using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>Vision presentation: exit and entry fades, the fail-safe clearings and the fog texture. Presentation only.</summary>
    public sealed class VisionPresentationEditModeTests
    {
        readonly List<GameObject> _objects = new List<GameObject>();
        SpriteActorPresenter _presenter;
        Transform _parent;
        float _now;

        [SetUp]
        public void SetUp()
        {
            var root = new GameObject("vision presenter test"); _objects.Add(root); _parent = root.transform;
            _presenter = new SpriteActorPresenter(_parent, null);
            _now = 100f; SpriteActorPresenter.FadeClock = () => _now;
            _presenter.ExitFadesAllowed = true; _presenter.Delivered = new HashSet<uint>();
        }

        [TearDown]
        public void TearDown()
        {
            SpriteActorPresenter.FadeClock = null;
            for (int i = _objects.Count - 1; i >= 0; i--) if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
        }

        void Present(uint id, float x = 640, float y = 640, ActorStatus status = ActorStatus.Alive, bool local = false)
        {
            _presenter.Begin();
            _presenter.Present(id, x, y, 0, 80, FactionId.Frost, status, WeaponId.Fists, ActorKind.Player, null, 0, 0, local);
            _presenter.End();
            _presenter.StepFades();
        }

        void PresentTwo(uint a, float ax, uint b, float bx, float y = 640)
        {
            _presenter.Begin();
            _presenter.Present(a, ax, y, 0, 80, FactionId.Frost, ActorStatus.Alive, WeaponId.Fists, ActorKind.Player, null, 0, 0, false);
            _presenter.Present(b, bx, y, 0, 80, FactionId.Frost, ActorStatus.Alive, WeaponId.Fists, ActorKind.Player, null, 0, 0, false);
            _presenter.End(); _presenter.StepFades();
        }

        void Settled(uint id) { Present(id); _now += 1f; Present(id); }

        void Leave(params uint[] stay)
        {
            var set = new HashSet<uint>(stay);
            _presenter.Delivered = set;
            _presenter.Retain(set);
            _presenter.StepFades();
        }

        SpriteRenderer Find(string name)
        {
            foreach (var r in _parent.GetComponentsInChildren<SpriteRenderer>(true)) if (r.name == name) return r;
            return null;
        }

        [Test]
        public void An_alive_actor_that_leaves_sight_fades_in_place_instead_of_popping()
        {
            Present(7); _now += 1f; Present(7);
            var body = Find("Authored character"); var hp = Find("Confirmed health");
            Leave();
            Assert.IsFalse(_presenter.Contains(7), "gone for every query and cue");
            Assert.AreEqual(1, _presenter.GhostCount);
            Assert.IsTrue(body.gameObject.activeInHierarchy);
            var at = body.transform.position;
            _now += VisionFade.ExitSeconds * 0.5f; _presenter.StepFades();
            Assert.That(body.color.a, Is.InRange(0.05f, 0.95f), "half way through");
            Assert.That(hp.color.a, Is.LessThan(1f), "the health bar fades with it");
            Assert.AreEqual(at, body.transform.position, "no movement while fading");
            _now += VisionFade.ExitSeconds; _presenter.StepFades();
            Assert.AreEqual(0, _presenter.GhostCount);
            Assert.IsFalse(body.gameObject.activeInHierarchy, "pooled when done");
        }

        [Test]
        public void A_dead_actor_a_death_event_and_a_stopped_match_do_not_fade()
        {
            Settled(1); Present(1, status: ActorStatus.Dead); Leave();
            Assert.AreEqual(0, _presenter.GhostCount, "last delivered status was dead");

            Settled(2); _presenter.NoteDeath(2); Leave();
            Assert.AreEqual(0, _presenter.GhostCount, "a Death event named it");

            _presenter.ExitFadesAllowed = false;
            Settled(3); Leave();
            Assert.AreEqual(0, _presenter.GhostCount, "match not running (left the match, lobby, ended)");
        }

        [Test]
        public void A_death_event_that_arrives_during_the_fade_ends_it()
        {
            Settled(4); Leave();
            Assert.AreEqual(1, _presenter.GhostCount);
            _presenter.NoteDeath(4);
            Assert.AreEqual(0, _presenter.GhostCount);
        }

        [Test]
        public void The_local_fighter_and_an_actor_still_delivered_never_fade()
        {
            Present(5, local: true); Leave();
            Assert.AreEqual(0, _presenter.GhostCount);
            Settled(6);
            _presenter.Delivered = new HashSet<uint> { 6 };
            _presenter.Begin(); _presenter.End(); // not presented this frame, but still in the observation: an interpolation gap
            Assert.AreEqual(0, _presenter.GhostCount);
        }

        [Test]
        public void A_timeline_cut_clears_fades_at_once()
        {
            Settled(8); Leave();
            Assert.AreEqual(1, _presenter.GhostCount);
            _presenter.CancelFades();
            Assert.AreEqual(0, _presenter.GhostCount);
        }

        [Test]
        public void A_new_actor_fades_in_quickly_and_a_pooled_art_comes_back_opaque()
        {
            Present(9);
            var shadow = Find("Contact shadow");
            Assert.That(shadow.color.a, Is.LessThan(0.1f), "just appeared");
            _now += VisionFade.EnterSeconds * 0.5f; Present(9);
            Assert.That(shadow.color.a, Is.InRange(0.1f, 0.95f));
            _now += VisionFade.EnterSeconds; Present(9);
            // Fully faded in means the shadow's own base alpha, which the sun-driven actor shadow sets between 0.85 and 1
            // (AtmosphereShadows), not necessarily 1: the fade only ever multiplies the base.
            float full = shadow.color.a;
            Assert.That(full, Is.InRange(0.84f, 1.0f), "no fade attenuation left");
            Leave(); _now += 1f; _presenter.StepFades();       // fade out, release to the pool
            Present(10); _now += 1f; Present(10);              // the pool hands the same art to a new actor
            Assert.That(Find("Contact shadow").color.a, Is.EqualTo(full).Within(0.01f), "colours restored when pooled");
        }

        [Test]
        public void Clearings_cover_every_delivered_actor_and_a_fading_one_fades_its_clearing()
        {
            PresentTwo(11, 640, 12, 960);
            _now += 1f; PresentTwo(11, 640, 12, 960);
            var list = new FogClearing[8];
            int n = _presenter.CollectClearings(list);
            Assert.AreEqual(2, n);
            Assert.That(list[0].Strength, Is.EqualTo(1f).Within(0.01f));
            Assert.That(Mathf.Abs(list[0].TileX - 20f) < 1f || Mathf.Abs(list[1].TileX - 20f) < 1f);
            Leave(11);
            _now += VisionFade.ExitSeconds * 0.5f; _presenter.StepFades();
            n = _presenter.CollectClearings(list);
            Assert.AreEqual(2, n, "the live actor and the ghost");
            float lo = Mathf.Min(list[0].Strength, list[1].Strength);
            Assert.That(lo, Is.InRange(0.02f, 0.98f));
        }

        // ---- fog texture ----

        [Test]
        public void The_fog_layer_clears_around_a_delivered_actor_even_when_its_own_sight_says_fog()
        {
            const int W = 40, H = 30;
            var tiles = new byte[W * H];
            for (int y = 0; y < H; y++) tiles[y * W + 20] = MapBlob.Wall; // a wall across the room
            var map = new MapBlob(W, H, tiles);
            var fog = new VisionFog(_parent);
            fog.Configure(map);
            Present(20, 30.5f * 32, 15.5f * 32);          // behind the wall
            _now += 1f; Present(20, 30.5f * 32, 15.5f * 32);
            fog.Tick(true, 10.5 * 32, 15.5 * 32, 0, _presenter);
            Assert.IsTrue(fog.Active);
            Assert.AreEqual(0, fog.AmountAt(30.5f * 32, 15.5f * 32), "never fog over a delivered actor");
            Assert.AreEqual(0, fog.AmountAt(10.5f * 32, 15.5f * 32), "the player sees its own surroundings");
            Assert.Greater(fog.AmountAt(36.5f * 32, 3.5f * 32), 200, "far, unseen ground stays fogged");
            int uploads = fog.TextureUploads;
            fog.Tick(true, 10.5 * 32, 15.5 * 32, 0, _presenter);
            Assert.AreEqual(uploads, fog.TextureUploads, "nothing moved: no new upload");
            PresentTwo(20, 30.5f * 32, 21, 5.5f * 32, 15.5f * 32);   // a second actor appears
            fog.Tick(true, 10.5 * 32, 15.5 * 32, 50, _presenter);
            Assert.Greater(fog.TextureUploads, uploads, "a changed clearing updates the texture");
            fog.Tick(false, 0, 0, 0, _presenter);
            Assert.IsFalse(fog.Active, "off outside a running match");
            fog.Dispose();
        }
    }
}
