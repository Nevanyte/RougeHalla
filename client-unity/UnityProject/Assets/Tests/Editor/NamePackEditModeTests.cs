using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-NAME-GROUP-1: a pack of same-named mobs shows one name through the presenter (SpriteActorPresenter.End -> MergeMobNames).
    /// Positions are legacy pixels as Present takes them; the pack distance is 128 px (4 tiles). Ids and types: 1..4 Magma Brutes, 5 a far Magma Brute,
    /// Wyrmling is the elite type (see HudVisualFix2EditModeTests for the overlap-rule cases, which stay).
    /// </summary>
    public sealed class NamePackEditModeTests
    {
        GameObject _arena; SpriteActorPresenter _presenter; UiTheme _savedTheme;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current; UiTheme.Current = UiTheme.Placeholder();
            ShowcaseSprites.Initialize();
            _arena = new GameObject("name pack arena");
            _presenter = new SpriteActorPresenter(_arena.transform, null);
            _presenter.Delivered = new HashSet<uint>();
        }

        [TearDown]
        public void TearDown()
        {
            if (_arena != null) Object.DestroyImmediate(_arena);
            UiTheme.Current = _savedTheme;
        }

        struct M
        {
            public uint Id; public float X, Y; public MobTypeId Type; public float Hp; public bool Engaged, Locked;
            public static M At(uint id, float x, float y, MobTypeId type = MobTypeId.MagmaBrute) => new M { Id = id, X = x, Y = y, Type = type, Hp = 100 };
        }

        void Frame(params M[] mobs)
        {
            _presenter.Begin();
            foreach (var m in mobs)
            {
                _presenter.Present(m.Id, m.X, m.Y, 0, m.Hp, null, ActorStatus.Alive, null, ActorKind.RegionalMob, m.Type, 0, 0, false, 0, 0, "grunt");
                if (m.Engaged) _presenter.PresentMarks(m.Id, new OverheadIndicators.Marks { Engaged = true });
                _presenter.PresentIndicators(m.Id, 0, false, WeaponId.Fists, m.Locked);
            }
            _presenter.End();
        }

        // Four brutes in a staggered line, about 100 px apart (ends 300 apart: one chained pack), the way the third screenshot shows them.
        static M[] Pack() => new[] { M.At(4, 640f, 640f), M.At(2, 740f, 700f), M.At(3, 840f, 640f), M.At(1, 940f, 700f) };

        static M[] With(M[] pack, params M[] more)
        {
            var all = new List<M>(pack); all.AddRange(more); return all.ToArray();
        }

        int ShownCount(params uint[] ids)
        {
            int n = 0; foreach (var id in ids) if (_presenter.NameShown(id)) n++; return n;
        }

        [Test]
        public void FourAdjacentMobsOfOneTypeShowOneNameTheLowestIdAndItIsStableAcrossFrames()
        {
            for (int frame = 0; frame < 3; frame++)
            {
                Frame(Pack());
                Assert.That(ShownCount(1, 2, 3, 4), Is.EqualTo(1), "frame " + frame);
                Assert.That(_presenter.NameShown(1), Is.True, "frame " + frame + ": id 1 keeps the name");
            }
        }

        [Test]
        public void AFifthMobFarAwayShowsItsOwnName()
        {
            Frame(With(Pack(), M.At(5, 640f + 1600f, 640f)));
            Assert.That(ShownCount(1, 2, 3, 4), Is.EqualTo(1));
            Assert.That(_presenter.NameShown(5), Is.True);
        }

        [Test]
        public void ANearMobJustBeyondThePackDistanceFromEveryoneIsAPackOfItsOwn()
        {
            Frame(M.At(1, 640f, 640f), M.At(2, 740f, 640f), M.At(3, 740f + 150f, 640f));
            Assert.That(_presenter.NameShown(1), Is.True); Assert.That(_presenter.NameShown(2), Is.False);
            Assert.That(_presenter.NameShown(3), Is.True, "150 px from its nearest neighbour is outside the 128 px pack distance");
        }

        [Test]
        public void AnEliteAmongThemShowsItsOwnNameAndThePackStillShowsOne()
        {
            Frame(With(Pack(), M.At(6, 790f, 670f, MobTypeId.Wyrmling)));
            Assert.That(_presenter.NameShown(6), Is.True, "the elite");
            Assert.That(ShownCount(1, 2, 3, 4), Is.EqualTo(1));
        }

        [Test]
        public void ADifferentTypeAmongThemKeepsItsOwnNameAndDoesNotCutThePackInTwo()
        {
            // The rat stands between the two brutes: 200 px apart, so only the chain through the rat could join them (it must not).
            Frame(M.At(1, 640f, 640f), M.At(2, 740f, 640f, MobTypeId.PlagueRat), M.At(3, 840f, 640f));
            Assert.That(_presenter.NameShown(2), Is.True);
            Assert.That(ShownCount(1, 3), Is.EqualTo(2), "200 px apart with only a rat between: two packs of one");
        }

        [Test]
        public void AnEngagedMobShowsItsOwnNameEvenWithTheHighestId()
        {
            var pack = Pack(); pack[0].Engaged = true;   // id 4 is the highest
            Frame(pack);
            Assert.That(_presenter.NameShown(4), Is.True, "engaged");
            Assert.That(ShownCount(1, 2, 3), Is.EqualTo(1), "the rest still show one name");
        }

        [Test]
        public void ALockedMobShowsItsOwnNameEvenWithTheHighestId()
        {
            var pack = Pack(); pack[0].Locked = true;
            Frame(pack);
            Assert.That(_presenter.NameShown(4), Is.True, "locked");
            Assert.That(ShownCount(1, 2, 3), Is.EqualTo(1));
        }

        [Test]
        public void AMobThatWalksAwayGetsItsNameBackAndOneThatJoinsLosesIt()
        {
            Frame(Pack());
            Assert.That(_presenter.NameShown(3), Is.False);
            var pack = Pack(); pack[2].X += 1600f;   // id 3 leaves
            Frame(pack);
            Assert.That(_presenter.NameShown(3), Is.True, "back");
            Assert.That(ShownCount(1, 2, 4), Is.EqualTo(1));
            Frame(Pack());
            Assert.That(_presenter.NameShown(3), Is.False, "rejoined");
        }

        [Test]
        public void TheSameFrameTwiceChangesNothing()
        {
            Frame(Pack()); var first = new[] { _presenter.NameShown(1), _presenter.NameShown(2), _presenter.NameShown(3), _presenter.NameShown(4) };
            Frame(Pack());
            Assert.That(new[] { _presenter.NameShown(1), _presenter.NameShown(2), _presenter.NameShown(3), _presenter.NameShown(4) }, Is.EqualTo(first));
        }

        // ---- names and hp bars (measured; see the packet) ----

        static Bounds NameBounds(Transform root)
        {
            foreach (var t in root.GetComponentsInChildren<TextMeshPro>(true))
                if (t.name == "Name" && t.gameObject.activeInHierarchy) { t.ForceMeshUpdate(); return t.GetComponent<MeshRenderer>().bounds; }
            Assert.Fail("no active Name label"); return default;
        }

        static Bounds BarBounds(Transform root)
        {
            foreach (var r in root.GetComponentsInChildren<SpriteRenderer>(true))
                if (r.name == "Health and barrier track" && r.enabled) return r.bounds;
            Assert.Fail("no hp bar drawn"); return default;
        }

        [Test]
        public void AHurtMobsNameSitsAboveItsOwnBarAndNeverOverlapsIt()
        {
            // One hurt brute alone: its bar shows and so does its name. The measured rects are in world units.
            Frame(new M { Id = 1, X = 640f, Y = 640f, Type = MobTypeId.MagmaBrute, Hp = 60 });
            var root = _arena.transform;
            var name = NameBounds(root); var bar = BarBounds(root);
            Assert.That(name.min.y, Is.GreaterThanOrEqualTo(bar.max.y), "measured: name y -13.05..-12.77, bar y -13.50..-13.38 (a .32 gap); name rect " + name + " bar rect " + bar);
        }
    }
}
