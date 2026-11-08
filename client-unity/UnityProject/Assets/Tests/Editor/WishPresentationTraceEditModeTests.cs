using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class WishPresentationTraceEditModeTests
    {
        readonly List<GameObject> _objects = new List<GameObject>();
        Transform _parent;
        SpriteActorPresenter _actors;
        ConfirmedWishPresenter _presenter;

        [SetUp]
        public void SetUp()
        {
            LatencyTrace.BeginEditor(); // clear any retained records from the preceding opt-in test
            LatencyTrace.EndEditor();
            var root = new GameObject("wish trace presenter test");
            _objects.Add(root);
            _parent = root.transform;
            _actors = new SpriteActorPresenter(_parent, null);
            _presenter = new ConfirmedWishPresenter(_parent, _actors);
            PresentActor(1);
        }

        [TearDown]
        public void TearDown()
        {
            try
            {
                if (_presenter != null) _presenter.Reset();
                for (int i = _objects.Count - 1; i >= 0; i--)
                    if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
                _objects.Clear();
            }
            finally { LatencyTrace.EndEditor(); }
        }

        [Test]
        public void NormalPlayRecordsNothingAndEnabledStartedRecordsOnceAfterFirstDraw()
        {
            var ordinary = Start(0, 10, 100, 1);
            _presenter.Accept(ordinary);
            _presenter.Tick(20);
            Assert.That(LatencyTrace.ReadEditor().Length, Is.Zero, "ordinary play has no trace recording");

            LatencyTrace.BeginEditor();
            var source = Start(2, 123.5, 500, 1);
            _presenter.Accept(source);
            _presenter.Tick(100);
            Assert.That(LatencyTrace.ReadEditor().Length, Is.Zero, "a queued visual has no presentation marker before its event time");
            _presenter.Tick(130);
            _presenter.Tick(140);

            var records = LatencyTrace.ReadEditor();
            Assert.That(records.Length, Is.EqualTo(1));
            AssertWishRecord(records[0], "presentWishStarted", 1, 2, 123.5);
        }

        [Test]
        public void EndedAndMetadataLandingMarkOnlyAfterTheirTerminalStateIsApplied()
        {
            LatencyTrace.BeginEditor();
            _presenter.Accept(Start(2, 10, 500, 1));
            _presenter.Tick(10);
            Assert.That(LatencyTrace.ReadEditor().Length, Is.EqualTo(1), "the start is marked when drawn");

            _presenter.Accept(End(2, 11.25, 1));
            Assert.That(_presenter.ActiveCount, Is.Zero);
            var records = LatencyTrace.ReadEditor();
            Assert.That(records.Length, Is.EqualTo(2));
            AssertWishRecord(records[1], "presentWishEnded", 1, 2, 11.25);

            _presenter.Accept(Start(2, 20, 500, 1));
            _presenter.Accept(Landed(2, 21.5, 1)); // visible-caster metadata, no permitted point
            Assert.That(_presenter.ActiveCount, Is.Zero);
            records = LatencyTrace.ReadEditor();
            Assert.That(records.Length, Is.EqualTo(3));
            AssertWishRecord(records[2], "presentWishLanded", 1, 2, 21.5);
            Assert.That(ActiveRoots().Count, Is.Zero, "terminal metadata does not create visual geometry");
        }

        [Test]
        public void RepeatedBlazeLandingsAndAnonymousLandingKeepEachOccurrenceAndCaster()
        {
            LatencyTrace.BeginEditor();
            var first = Blaze(100, 1, 2, 3, 8, 9);
            var second = Blaze(100, 1, 4, 5, 9, 12);
            _presenter.Accept(first); _presenter.Accept(second);
            Assert.That(LatencyTrace.ReadEditor().Length, Is.Zero, "landings are traced only after Draw");
            _presenter.Tick(100);
            var anonymous = Blaze(101, null, 10, 11, 13, 16);
            _presenter.Accept(anonymous);
            _presenter.Tick(101);

            var records = LatencyTrace.ReadEditor();
            Assert.That(records.Length, Is.EqualTo(3), "same-time identical-caster occurrences are not collapsed");
            AssertWishRecord(records[0], "presentWishLanded", 1, 3, 100);
            AssertWishRecord(records[1], "presentWishLanded", 1, 3, 100);
            AssertWishRecord(records[2], "presentWishLanded", 0, 3, 101);
        }

        [Test]
        public void FutureAndExpiredCuesDoNotTraceAndResetPoolReuseGetsANewMarker()
        {
            LatencyTrace.BeginEditor();
            _presenter.Accept(Start(0, 100, 20, 1));
            _presenter.Tick(50);
            _presenter.Accept(Start(1, 10, 5, 1));
            _presenter.Tick(50);
            Assert.That(LatencyTrace.ReadEditor().Length, Is.Zero, "future and already-expired events are not presented");
            _presenter.Reset();

            _presenter.Accept(Start(0, 60, 100, 1));
            _presenter.Tick(60);
            var first = LatencyTrace.ReadEditor();
            Assert.That(first.Length, Is.EqualTo(1));
            AssertWishRecord(first[0], "presentWishStarted", 1, 0, 60);
            var artwork = ActiveRoots()[0];

            _presenter.Reset();
            _presenter.Accept(Start(4, 70, 100, 1));
            _presenter.Tick(70);
            var roots = ActiveRoots();
            Assert.That(roots.Count, Is.EqualTo(1));
            Assert.That(roots[0], Is.SameAs(artwork), "reset returns artwork to the pool for reuse");
            var records = LatencyTrace.ReadEditor();
            Assert.That(records.Length, Is.EqualTo(2));
            AssertWishRecord(records[1], "presentWishStarted", 1, 4, 70);
        }

        void PresentActor(uint id)
        {
            _actors.Begin();
            _actors.Present(id, 10, 10, 0, 80, FactionId.Fire, ActorStatus.Alive, WeaponId.Sword,
                ActorKind.Player, null, 0, 0, false);
            _actors.End();
        }

        List<Transform> ActiveRoots()
        {
            var roots = new List<Transform>();
            for (int i = 0; i < _parent.childCount; i++)
            {
                var child = _parent.GetChild(i);
                if (child.name == "Confirmed Wish artwork" && child.gameObject.activeSelf) roots.Add(child);
            }
            return roots;
        }

        static WireFx Start(byte ability, double time, double duration, uint caster) =>
            new WireFx { Kind = FxKind.WishStarted, Ability = ability, EventTime = time, Duration = duration, Caster = caster };

        static WireFx End(byte ability, double time, uint caster) =>
            new WireFx { Kind = FxKind.WishEnded, Ability = ability, EventTime = time, Caster = caster };

        static WireFx Landed(byte ability, double time, uint caster) =>
            new WireFx { Kind = FxKind.WishLanded, Ability = ability, EventTime = time, Caster = caster };

        static WireFx Blaze(double time, uint? caster, float x, float y, float x2, float y2) =>
            new WireFx { Kind = FxKind.WishLanded, Ability = 3, EventTime = time, Caster = caster,
                HasAnchor = true, HasDestination = true, AnchorX = x, AnchorY = y, DestinationX = x2, DestinationY = y2 };

        static void AssertWishRecord(LatencyTrace.EditorRecord record, string kind, uint caster, int ability, double sourceTime)
        {
            Assert.That(record.kind, Is.EqualTo(kind));
            Assert.That(record.player, Is.EqualTo(caster));
            Assert.That(record.ability, Is.EqualTo(ability));
            Assert.That(record.hasSourceTime, Is.True);
            Assert.That(record.sourceTime, Is.EqualTo(sourceTime));
        }
    }
}
