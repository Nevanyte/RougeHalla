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
    /// P-UNITY-HUD-VISUAL-FIX-4, world-label half (items 1 to 3 and the presenter's half of the Tab map rule), through the actor presenter:
    /// every mob name reads on every zone's floor (a lone idle mob too), a camp's mobs of one name are one pack however far they spread (camp
    /// inferred by <see cref="NameMerge.CampOfMob"/> from <see cref="SpriteActorPresenter.SetCamps"/>), a pack's name steps clear of the local
    /// fighter's name, and no name is drawn while <see cref="WorldLabelVisibility.Hidden"/> is set. Positions are legacy pixels as Present takes
    /// them. World TextMeshPro text is not reached by MatchHud.ApplyTextScale, so sizes are measured from the drawn mesh.
    /// Replaces nothing: P-UNITY-NAME-GROUP-2's cases stay green (their packs have no camp rows, so they keep the 128 px chain).
    /// </summary>
    public sealed class NamePackFix4EditModeTests
    {
        GameObject _arena; SpriteActorPresenter _presenter; UiTheme _savedTheme;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current; UiTheme.Current = UiTheme.Placeholder();
            ShowcaseSprites.Initialize();
            WorldLabelVisibility.Hidden = false;
            _arena = new GameObject("name pack fix 4 arena");
            _presenter = new SpriteActorPresenter(_arena.transform, null);
            _presenter.Delivered = new HashSet<uint>();
        }

        [TearDown]
        public void TearDown()
        {
            WorldLabelVisibility.Hidden = false;
            if (_arena != null) Object.DestroyImmediate(_arena);
            UiTheme.Current = _savedTheme;
        }

        struct M
        {
            public uint Id; public float X, Y, Hp; public bool Engaged, Hovered; public MobTypeId Type;
            public static M At(uint id, float x, float y) => new M { Id = id, X = x, Y = y, Hp = 100, Type = MobTypeId.MagmaBrute };
        }

        void Frame(params M[] mobs) { Mixed(null, 0f, mobs); }

        // One frame: optionally the local fighter "sh5f" at (fighterX, 640), then the mobs.
        void Mixed(uint? fighter, float fighterX, params M[] mobs)
        {
            _presenter.Begin();
            if (fighter.HasValue)
            {
                _presenter.Present(fighter.Value, fighterX, 640f, 0, 100, FactionId.Holy, ActorStatus.Alive, WeaponId.Fists, ActorKind.Player, null, 0, 0, true);
                _presenter.PresentMarks(fighter.Value, new OverheadIndicators.Marks { Name = "sh5f" });
                _presenter.PresentIndicators(fighter.Value, 0, false, WeaponId.Fists, false);
            }
            foreach (var m in mobs)
            {
                _presenter.Present(m.Id, m.X, m.Y, 0, m.Hp, null, ActorStatus.Alive, null, ActorKind.RegionalMob, m.Type, 0, 0, false, 0, 0, "grunt");
                if (m.Engaged) _presenter.PresentMarks(m.Id, new OverheadIndicators.Marks { Engaged = true });
                _presenter.PresentIndicators(m.Id, 0, false, WeaponId.Fists, false, -1, m.Hovered);
            }
            _presenter.End();
        }

        List<TextMeshPro> ActiveNames()
        {
            var list = new List<TextMeshPro>();
            foreach (var t in _arena.GetComponentsInChildren<TextMeshPro>(true)) if (t.name == "Name" && t.gameObject.activeInHierarchy) { t.ForceMeshUpdate(); list.Add(t); }
            return list;
        }

        TextMeshPro OnlyName(string what)
        {
            var names = ActiveNames();
            Assert.That(names.Count, Is.EqualTo(1), what);
            return names[0];
        }

        List<TextMeshPro> MobNames()
        {
            var list = ActiveNames(); list.RemoveAll(t => t.text == "sh5f"); return list;
        }

        // ---- item 1: every mob name is legible ----

        const float Readable = 3f;
        static double Lin(double v) { return v <= .04045 ? v / 12.92 : System.Math.Pow((v + .055) / 1.055, 2.4); }
        static double Luminance(Color c) { return .2126 * Lin(c.r) + .7152 * Lin(c.g) + .0722 * Lin(c.b); }
        static double Ratio(Color a, Color b) { double x = Luminance(a), y = Luminance(b); return (System.Math.Max(x, y) + .05) / (System.Math.Min(x, y) + .05); }
        static readonly RegionId[] Zones = { RegionId.Fire, RegionId.Sentenced, RegionId.Plague, RegionId.Frost, RegionId.Holy };

        // A lone idle full-health mob drew its name at the legacy .5 (OverheadIndicators.cs, IDLE_LABEL_ALPHA) on a pale face (round 5 shots 16, 23, 24).
        [TestCase("idle")]
        [TestCase("engaged")]
        [TestCase("hurt")]
        public void ALoneMobsNameIsOutlinedAtLeastEightyFivePercentOpaqueAndReadsOnEveryZonesFloor(string state)
        {
            var mob = M.At(1, 640f, 640f);
            if (state == "engaged") mob.Engaged = true;
            if (state == "hurt") mob.Hp = 60f;
            Frame(mob);
            var name = OnlyName("a lone mob shows its own name");
            Assert.That(name.fontSharedMaterial.IsKeywordEnabled("OUTLINE_ON"), Is.True, "outlined label style");
            Assert.That(name.color.a, Is.GreaterThanOrEqualTo(.85f), state + " lone mob name alpha");
            var outline = name.fontSharedMaterial.GetColor(ShaderUtilities.ID_OutlineColor);
            foreach (var zone in Zones)
            {
                Color floor = RegionThemes.Get(zone).BaseSrgb;
                var face = name.color; var drawn = Color.Lerp(floor, new Color(face.r, face.g, face.b), face.a);
                double faceVsOutline = Ratio(drawn, outline), faceVsFloor = Ratio(drawn, floor), outlineVsFloor = Ratio(outline, floor);
                Assert.That(faceVsOutline, Is.GreaterThanOrEqualTo(Readable), zone + ": face (alpha " + face.a.ToString("F2") + ") against its outline");
                Assert.That(System.Math.Max(faceVsFloor, outlineVsFloor), Is.GreaterThanOrEqualTo(Readable), zone + ": face " + faceVsFloor.ToString("F2") + ", outline " + outlineVsFloor.ToString("F2") + " against the floor");
            }
        }

        // ---- item 2: one name per camp pack ----

        // A pack of three Magma Brutes of one camp: 330 px between neighbours (the 128 px chain gives three names).
        static M[] Spread() => new[] { M.At(3, 640f, 640f), M.At(1, 970f, 700f), M.At(2, 1300f, 640f) };

        static CampView Row(MobTypeId type) => new CampView { MobType = type };

        [Test]
        public void ACampsMobsOfOneNameShowOneNameHoweverFarTheySpread()
        {
            _presenter.SetCamps(new[] { new MapCamp(900, 640, 96, 1) }, new List<CampView> { Row(MobTypeId.MagmaBrute) });
            Frame(Spread());
            OnlyName("one name for the camp's pack");
            Assert.That(_presenter.NameShown(1), Is.True, "the lowest id carries it");
            Assert.That(ActiveNames()[0].transform.position.x, Is.EqualTo((640f + 1300f) / 2f * ArenaView.Scale).Within(.02f), "centred over the pack's extent");
        }

        [Test]
        public void AHoveredMemberOfASpreadCampPackCarriesTheOneName()
        {
            _presenter.SetCamps(new[] { new MapCamp(900, 640, 96, 1) }, new List<CampView> { Row(MobTypeId.MagmaBrute) });
            var pack = Spread(); pack[0].Hovered = true;   // id 3, the leftmost
            Frame(pack);
            OnlyName("one name for the camp's pack");
            Assert.That(_presenter.NameShown(3), Is.True, "hover wins");
        }

        [Test]
        public void TwoCampsOfTheSameMobStandingTogetherKeepTwoNames()
        {
            _presenter.SetCamps(new[] { new MapCamp(640, 640, 96, 1), new MapCamp(700, 640, 96, 1) },
                new List<CampView> { Row(MobTypeId.MagmaBrute), Row(MobTypeId.MagmaBrute) });
            Frame(M.At(1, 640f, 640f), M.At(2, 700f, 640f));   // 60 px apart: the chain alone would merge them
            Assert.That(ActiveNames().Count, Is.EqualTo(2), "one name per camp pack");
            Assert.That(_presenter.NameShown(1) && _presenter.NameShown(2), Is.True);
        }

        // A mob no delivered camp contains keeps the 128 px chain (guards: they pass on the current code).
        [Test]
        public void MobsOfNoKnownCampKeepTheDistanceChain()
        {
            _presenter.SetCamps(new[] { new MapCamp(9000, 9000, 96, 1) }, new List<CampView> { Row(MobTypeId.MagmaBrute) });   // too far from every mob
            Frame(M.At(1, 640f, 640f), M.At(2, 740f, 640f), M.At(3, 1400f, 640f));
            Assert.That(ActiveNames().Count, Is.EqualTo(2), "100 px apart is one pack, 660 px away is another");
            Assert.That(_presenter.NameShown(1) && !_presenter.NameShown(2) && _presenter.NameShown(3), Is.True);
        }

        [Test]
        public void WithNoCampsDeliveredTheChainStillApplies()
        {
            _presenter.SetCamps(null, null);
            Frame(M.At(1, 640f, 640f), M.At(2, 740f, 640f));
            OnlyName("100 px apart with no camp rows is one pack");
        }

        // ---- item 3: the pack's name steps above the local fighter's name ----

        static Rect Box(TextMeshPro t) { var b = t.GetComponent<MeshRenderer>().bounds; return new Rect(b.min.x, b.min.y, b.size.x, b.size.y); }

        TextMeshPro Named(string text)
        {
            foreach (var t in ActiveNames()) if (t.text == text) return t;
            Assert.Fail("no active name \"" + text + "\""); return null;
        }

        [Test]
        public void APackNameThatWouldLandOnTheLocalFightersNameIsLiftedClearAndTheFightersNameStays()
        {
            M[] Pack(float dx, float dy) => new[] { M.At(11, 640f + dx, 640f + dy), M.At(12, 700f + dx, 640f + dy), M.At(13, 760f + dx, 640f + dy) };   // 60 px apart: one pack by the chain

            Mixed(1, 700f, new M[0]);
            var fighter = Box(Named("sh5f"));
            Frame(Pack(0f, 0f));
            var alone = Box(OnlyName("the pack's one name"));
            // Slide the pack so that its name is exactly where the fighter's name is (world y runs the other way: y = -py * Scale * GroundSquash).
            float dx = (fighter.center.x - alone.center.x) / ArenaView.Scale;
            float dy = (fighter.center.y - alone.center.y) / (-ArenaView.Scale * ArenaView.GroundSquash);
            Frame(Pack(dx, dy));
            Assert.That(Box(OnlyName("the pack's one name")).Overlaps(fighter), Is.True, "set-up: unstacked, the pack's name is on the fighter's name");

            Mixed(1, 700f, Pack(dx, dy));
            var fighterNow = Box(Named("sh5f"));
            var pack = Box(MobNames()[0]);
            Assert.That(MobNames().Count, Is.EqualTo(1), "still one pack name");
            Assert.That(fighterNow.center.x, Is.EqualTo(fighter.center.x).Within(.02f), "the fighter's own name keeps its place (x)");
            Assert.That(fighterNow.center.y, Is.EqualTo(fighter.center.y).Within(.02f), "the fighter's own name keeps its place (y)");
            Assert.That(pack.Overlaps(fighterNow), Is.False, "pack name " + pack + " intersects the fighter's name " + fighterNow);
            Assert.That(pack.center.y, Is.GreaterThan(fighterNow.center.y), "the pack name steps above");
            Assert.That(pack.center.y - fighterNow.center.y, Is.LessThan(2f), "by a line or so, not across the screen");
        }

        // ---- item 6 (the presenter's half): no world name while the Tab map is open ----

        [Test]
        public void NoNameIsDrawnWhileWorldLabelsAreHiddenAndTheyReturnWhenShownAgain()
        {
            Mixed(1, 700f, M.At(5, 640f, 700f), M.At(6, 2000f, 700f));
            Assert.That(ActiveNames().Count, Is.GreaterThanOrEqualTo(3), "set-up: the fighter and two mobs have names");
            WorldLabelVisibility.Hidden = true;
            Mixed(1, 700f, M.At(5, 640f, 700f), M.At(6, 2000f, 700f));
            Assert.That(ActiveNames().Count, Is.EqualTo(0), "the Tab map is open: names show through behind its panels (round 5 shot 27)");
            WorldLabelVisibility.Hidden = false;
            Mixed(1, 700f, M.At(5, 640f, 700f), M.At(6, 2000f, 700f));
            Assert.That(ActiveNames().Count, Is.GreaterThanOrEqualTo(3), "names are back once the map closes");
        }
    }
}
