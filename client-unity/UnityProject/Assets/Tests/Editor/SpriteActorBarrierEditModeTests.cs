using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class SpriteActorBarrierEditModeTests
    {
        readonly List<GameObject> _objects = new List<GameObject>();
        SpriteActorPresenter _presenter;
        Transform _parent;

        [SetUp]
        public void SetUp()
        {
            var root = new GameObject("barrier presenter test");
            _objects.Add(root);
            _parent = root.transform;
            _presenter = new SpriteActorPresenter(_parent, null);
        }

        [TearDown]
        public void TearDown()
        {
            for (int i = _objects.Count - 1; i >= 0; i--)
                if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
        }

        [Test]
        public void IndependentHealthAndBarrierSharesPreserve105PercentAndRingSteps()
        {
            Present(1, 55, 50, 0);
            var health = Find("Confirmed health");
            var barrier = Find("Confirmed barrier");
            Assert.That(health.enabled, Is.True);
            Assert.That(barrier.enabled, Is.True);
            Assert.That(health.transform.localScale.x, Is.EqualTo(.4675f).Within(.0001f));
            Assert.That(barrier.transform.localScale.x, Is.EqualTo(.425f).Within(.0001f));
            Assert.That(barrier.transform.localPosition.x + barrier.transform.localScale.x / 2,
                Is.EqualTo(-.49f + .85f * 1.05f).Within(.0001f), "track deliberately accommodates independently quantized 105% total");

            Present(1, 100, 0, 0);
            AssertRing(0);
            Present(1, 100, 1, 1);
            AssertRing(1);
            Present(1, 100, 100, 8);
            AssertRing(8);
            Assert.That(Find("Barrier ring step 1").sharedMaterial, Is.SameAs(ShowcaseSprites.Unlit));
        }

        [Test]
        public void DeathMiaNpcEvictionAndPoolReuseClearBarrierVisuals()
        {
            Present(8, 70, 80, 8);
            var actorRoot = _parent.Find("Observed actor");
            Assert.That(Find("Confirmed barrier").enabled, Is.True);
            _presenter.Begin();
            _presenter.Present(8, 120, 120, 0, 70, FactionId.Fire, ActorStatus.Dead, WeaponId.Sword,
                ActorKind.Player, null, 0, 0, false, 80, 8);
            _presenter.End();
            AssertAllBarrierHidden();

            Present(8, 70, 80, 8, ActorStatus.Alive, ActorKind.RegionalMob);
            AssertAllBarrierHidden();
            _presenter.Retain(new HashSet<uint>());
            Assert.That(actorRoot.gameObject.activeSelf, Is.False);
            Present(9, 70, 0, 0);
            Assert.That(_parent.Find("Observed actor"), Is.SameAs(actorRoot));
            AssertAllBarrierHidden();

            Present(9, 70, 80, 8);
            Assert.That(Find("Confirmed barrier").enabled, Is.True);
            Present(9, 70, 80, 8, ActorStatus.Mia);
            AssertAllBarrierHidden();
        }

        [Test]
        public void TimerResetClearsLocalPhasesWithoutChangingDeadStateMembershipOrBarrier()
        {
            Present(3, 50, 50, 5);
            _presenter.ConfirmedCue(3, FxKind.Hit);
            var root = _parent.Find("Observed actor");
            object art = ActiveArt(3);
            Set(art, "MovingUntil", 123f); Set(art, "AttackUntil", 124f);
            Set(art, "HitUntil", 125f); Set(art, "BlockUntil", 126f);
            Set(art, "AttackAt", 1f); Set(art, "HitAt", 2f); Set(art, "BlockAt", 3f); Set(art, "DeadAt", 4f);

            _presenter.ResetTransientTimers();

            Assert.That(_presenter.Contains(3), Is.True);
            Assert.That(root.gameObject.activeSelf, Is.True);
            Assert.That(Find("Confirmed barrier").enabled, Is.True);
            Assert.That(Find("Confirmed barrier").transform.localScale.x, Is.EqualTo(.425f).Within(.0001f));
            Assert.That(Get<bool>(art, "Dead"), Is.False);
            foreach (string field in new[] { "MovingUntil", "AttackUntil", "HitUntil", "BlockUntil", "AttackAt", "HitAt", "BlockAt", "DeadAt" })
                Assert.That(Get<float>(art, field), Is.Zero, field);

            Present(3, 0, 0, 0, ActorStatus.Dead);
            art = ActiveArt(3);
            Set(art, "DeadAt", 44f);
            _presenter.ResetTransientTimers();
            Assert.That(Get<bool>(art, "Dead"), Is.True, "reset preserves canonical dead status");
            Present(3, 0, 0, 0, ActorStatus.Dead);
            Assert.That(Get<float>(art, "DeadAt"), Is.Zero, "a clock cut does not restart the death animation");
        }

        [Test]
        public void ResetDeathFrameUsesRealCatalogTerminalSpriteEvenAtLowEditorUptime()
        {
            var catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            Assert.That(catalog, Is.Not.Null);
            var parent = new GameObject("catalog death hold test");
            _objects.Add(parent);
            var presenter = new SpriteActorPresenter(parent.transform, catalog);
            presenter.Begin();
            presenter.Present(77, 120, 120, 0, 0, FactionId.Fire, ActorStatus.Dead, WeaponId.Sword,
                ActorKind.Player, null, 0, 0, false);
            presenter.End();

            presenter.ResetTransientTimers();
            presenter.Begin();
            presenter.Present(77, 120, 120, 0, 0, FactionId.Fire, ActorStatus.Dead, WeaponId.Sword,
                ActorKind.Player, null, 0, 0, false);
            presenter.End();

            var appearance = catalog.Find("hero");
            Assert.That(appearance.Death, Is.Not.Null.And.Not.Empty);
            int count = appearance.Death.Length / 8;
            int direction = ((Mathf.RoundToInt(0 / (Mathf.PI / 4)) + 5) % 8 + 8) % 8;
            var body = parent.transform.Find("Observed actor/Authored character").GetComponent<SpriteRenderer>();
            Assert.That(body.sprite, Is.SameAs(appearance.Death[direction * count + count - 1]),
                "timeline reset holds the real authored terminal death frame regardless of Editor uptime");
        }

        void Present(uint id, int health, float barrier, byte ring, ActorStatus status = ActorStatus.Alive, ActorKind kind = ActorKind.Player)
        {
            _presenter.Begin();
            _presenter.Present(id, 120, 120, 0, health, FactionId.Fire, status, WeaponId.Sword,
                kind, kind == ActorKind.RegionalMob ? (MobTypeId?)MobTypeId.FrostWisp : null, 0, 0, false, barrier, ring);
            _presenter.End();
        }

        void AssertRing(int count)
        {
            for (int i = 0; i < 8; i++) Assert.That(Find("Barrier ring step " + (i + 1)).enabled, Is.EqualTo(i < count));
        }

        void AssertAllBarrierHidden()
        {
            Assert.That(Find("Confirmed barrier").enabled, Is.False);
            AssertRing(0);
        }

        SpriteRenderer Find(string name)
        {
            var child = _parent.Find("Observed actor/" + name);
            Assert.That(child, Is.Not.Null, "missing presenter marker: " + name);
            return child.GetComponent<SpriteRenderer>();
        }

        object ActiveArt(uint id)
        {
            var active = typeof(SpriteActorPresenter).GetField("_active", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_presenter);
            return active.GetType().GetProperty("Item").GetValue(active, new object[] { id });
        }

        static void Set(object target, string field, object value) => target.GetType().GetField(field, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic).SetValue(target, value);
        static T Get<T>(object target, string field) => (T)target.GetType().GetField(field, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic).GetValue(target);
    }
}
