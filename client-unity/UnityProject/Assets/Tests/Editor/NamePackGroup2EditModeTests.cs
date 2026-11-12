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
    /// P-UNITY-NAME-GROUP-2 through the presenter and the camp labels: a pack shows exactly one name, also when engaged; the name sits over the
    /// pack (centre of its extent, above the highest member) unless a member is hovered or locked (hover wins); it is drawn readable on every
    /// zone's floor; overlapping fighter names are stacked; the camp respawn and ward labels have a backing plate and never sit on a fighter's name.
    /// Positions are legacy pixels as Present takes them (world = px / 32, y squashed by .78). World TextMeshPro labels are not touched by
    /// MatchHud.ApplyTextScale (it only reaches the HUD canvases, MatchHud.cs:121-131), so every size here is measured from the drawn mesh.
    /// This replaces three P-UNITY-NAME-GROUP-1 cases (see the packet): NamePackEditModeTests.AnEngagedMobShowsItsOwnNameEvenWithTheHighestId and
    /// ALockedMobShowsItsOwnNameEvenWithTheHighestId, and NamePackHoverEditModeTests.AHoveredPackMemberShowsItsNameAndLosesItWhenTheHoverLeaves.
    /// </summary>
    public sealed class NamePackGroup2EditModeTests
    {
        GameObject _arena; SpriteActorPresenter _presenter; UiTheme _savedTheme;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current; UiTheme.Current = UiTheme.Placeholder();
            ShowcaseSprites.Initialize();
            _arena = new GameObject("name pack group 2 arena");
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
            public uint Id; public float X, Y; public bool Engaged, Locked, Hovered; public MobTypeId Type;
            public static M At(uint id, float x, float y) => new M { Id = id, X = x, Y = y, Type = MobTypeId.MagmaBrute };
        }

        void Frame(params M[] mobs)
        {
            _presenter.Begin();
            foreach (var m in mobs)
            {
                _presenter.Present(m.Id, m.X, m.Y, 0, 100, null, ActorStatus.Alive, null, ActorKind.RegionalMob, m.Type, 0, 0, false, 0, 0, "grunt");
                if (m.Engaged) _presenter.PresentMarks(m.Id, new OverheadIndicators.Marks { Engaged = true });
                _presenter.PresentIndicators(m.Id, 0, false, WeaponId.Fists, m.Locked, -1, m.Hovered);
            }
            _presenter.End();
        }

        // The staggered line of the screenshots: ends 300 px apart, 100 px between neighbours (one chained pack). Higher on screen = smaller y.
        static M[] Pack() => new[] { M.At(4, 640f, 640f), M.At(2, 740f, 700f), M.At(3, 840f, 640f), M.At(1, 940f, 700f) };
        static M[] Mark(M[] pack, uint id, System.Action<M[], int> set) { set(pack, System.Array.FindIndex(pack, m => m.Id == id)); return pack; }

        List<TextMeshPro> ActiveNames()
        {
            var list = new List<TextMeshPro>();
            foreach (var t in _arena.GetComponentsInChildren<TextMeshPro>(true)) if (t.name == "Name" && t.gameObject.activeInHierarchy) list.Add(t);
            return list;
        }

        TextMeshPro OnlyName()
        {
            var names = ActiveNames();
            Assert.That(names.Count, Is.EqualTo(1), "a pack shows exactly one name");
            return names[0];
        }

        // Where a mob's own name sits when it stands alone at (x, y): the reference the pack anchors are compared with.
        Vector3 OwnNameAt(float x, float y)
        {
            Frame(M.At(1, x, y));
            return OnlyName().transform.position;
        }

        static void Near(Vector3 actual, float x, float y, string what)
        {
            Assert.That(actual.x, Is.EqualTo(x).Within(.02f), what + " x"); Assert.That(actual.y, Is.EqualTo(y).Within(.02f), what + " y");
        }

        // ---- one name per pack, where it sits ----

        [Test]
        public void AnIdlePackShowsOneNameCentredOverThePackAndAboveItsHighestMember()
        {
            var highest = OwnNameAt(640f, 640f);   // id 4 and id 3 stand highest (y 640)
            Frame(Pack());
            var name = OnlyName();
            Near(name.transform.position, (640f + 940f) / 2f * ArenaView.Scale, highest.y, "the pack name");
        }

        [Test]
        public void AnEngagedPackStillShowsOneNameAtTheSameSpot()
        {
            Frame(Pack()); var idle = OnlyName().transform.position;
            var engaged = Pack(); for (int i = 0; i < engaged.Length; i++) engaged[i].Engaged = true;
            Frame(engaged);
            Near(OnlyName().transform.position, idle.x, idle.y, "engaged pack name");
        }

        [Test]
        public void OneEngagedMemberDoesNotMakeItShowItsOwnName()
        {
            Frame(Mark(Pack(), 4, (p, i) => p[i].Engaged = true));
            OnlyName();
            Assert.That(_presenter.NameShown(1), Is.True, "the lowest id carries an unsingled pack's name");
        }

        [Test]
        public void AHoveredMemberCarriesThePacksNameOverItself()
        {
            var own = OwnNameAt(840f, 640f);
            Frame(Mark(Pack(), 3, (p, i) => p[i].Hovered = true));
            OnlyName();
            Assert.That(_presenter.NameShown(3), Is.True);
            Near(ActiveNames()[0].transform.position, own.x, own.y, "hovered member's name");
        }

        [Test]
        public void ALockedMemberCarriesThePacksNameOverItself()
        {
            var own = OwnNameAt(640f, 640f);
            Frame(Mark(Pack(), 4, (p, i) => p[i].Locked = true));
            OnlyName();
            Assert.That(_presenter.NameShown(4), Is.True);
            Near(ActiveNames()[0].transform.position, own.x, own.y, "locked member's name");
        }

        [Test]
        public void HoverWinsOverLock()
        {
            var pack = Mark(Mark(Pack(), 4, (p, i) => p[i].Locked = true), 3, (p, i) => p[i].Hovered = true);
            Frame(pack);
            OnlyName();
            Assert.That(_presenter.NameShown(3), Is.True, "hovered");
            Assert.That(_presenter.NameShown(4), Is.False, "locked but not hovered");
        }

        [Test]
        public void WhenTheHoverLeavesTheNameGoesBackOverThePack()
        {
            Frame(Pack()); var centred = OnlyName().transform.position;
            Frame(Mark(Pack(), 3, (p, i) => p[i].Hovered = true));
            Frame(Pack());
            Near(OnlyName().transform.position, centred.x, centred.y, "back over the pack");
        }

        [Test]
        public void AnEliteKeepsItsOwnNameNextToAPackThatShowsOne()
        {
            var all = new List<M>(Pack()) { new M { Id = 6, X = 790f, Y = 670f, Type = MobTypeId.Wyrmling } };
            Frame(all.ToArray());
            Assert.That(ActiveNames().Count, Is.EqualTo(2), "the pack's one name and the elite's own");
            Assert.That(_presenter.NameShown(6), Is.True);
        }

        // ---- readable on every floor ----

        const float Readable = 3f;
        static double Lin(double v) { return v <= .04045 ? v / 12.92 : System.Math.Pow((v + .055) / 1.055, 2.4); }
        static double Luminance(Color c) { return .2126 * Lin(c.r) + .7152 * Lin(c.g) + .0722 * Lin(c.b); }
        static double Ratio(Color a, Color b) { double x = Luminance(a), y = Luminance(b); return (System.Math.Max(x, y) + .05) / (System.Math.Min(x, y) + .05); }

        static readonly RegionId[] Zones = { RegionId.Fire, RegionId.Sentenced, RegionId.Plague, RegionId.Frost, RegionId.Holy };

        [Test]
        public void ThePackNameIsDrawnOutlinedAndAtLeastEightyFivePercentOpaque()
        {
            Frame(Pack());
            var name = OnlyName();
            Assert.That(name.fontSharedMaterial.IsKeywordEnabled("OUTLINE_ON"), Is.True, "outlined label style");
            Assert.That(name.fontSharedMaterial.GetFloat(ShaderUtilities.ID_OutlineWidth), Is.GreaterThan(0f));
            Assert.That(name.color.a, Is.GreaterThanOrEqualTo(.85f), "an idle pack's name was drawn at .5 (OverheadIndicators.cs, IDLE_LABEL_ALPHA)");
        }

        [Test]
        public void ThePackNameReadsOnEveryZonesFloor()
        {
            // Rule (the oracle's reading of "name colour and outline at least 3:1 against the floor"): a light face and a dark outline cannot both
            // contrast with every floor, so the face as drawn (composited at its alpha over the floor) must contrast with its own outline at
            // least 3:1, and the face or the outline must contrast with the floor at least 3:1.
            Frame(Pack());
            var name = OnlyName();
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

        // ---- fighter names stack ----

        void PlayersFrame(params (uint id, float x, string name)[] fighters)
        {
            _presenter.Begin();
            foreach (var f in fighters)
            {
                bool local = f.id == 1;
                _presenter.Present(f.id, f.x, 640f, 0, 100, FactionId.Holy, ActorStatus.Alive, WeaponId.Fists, ActorKind.Player, null, 0, 0, local);
                _presenter.PresentMarks(f.id, new OverheadIndicators.Marks { Name = f.name });
                _presenter.PresentIndicators(f.id, 0, false, WeaponId.Fists, false);
            }
            _presenter.End();
        }

        TextMeshPro NameLabel(string text)
        {
            foreach (var t in ActiveNames()) if (t.text == text) { t.ForceMeshUpdate(); return t; }
            Assert.Fail("no active name \"" + text + "\""); return null;
        }

        [Test]
        public void FightersStandingTogetherHaveTheirNamesStackedNearestToTheLocalFighterLowest()
        {
            // Six pixels apart: every pair of these four names overlaps when unstacked (a drawn name is about 22 px wide),
            // so each farther one must climb. Names that do not overlap are not stacked (coordinator amendment 2026-11-12:
            // at 20 px apart only neighbours overlapped, and the strict order could be met only by a 45 px blanket margin).
            PlayersFrame((1, 640f, "aaa1"), (2, 646f, "bbb2"), (3, 652f, "ccc3"), (4, 658f, "ddd4"), (5, 3000f, "eee5"));
            var n = new[] { NameLabel("aaa1"), NameLabel("bbb2"), NameLabel("ccc3"), NameLabel("ddd4") };
            for (int i = 0; i < 4; i++)
                for (int j = i + 1; j < 4; j++)
                    Assert.That(n[i].GetComponent<MeshRenderer>().bounds.Intersects(n[j].GetComponent<MeshRenderer>().bounds), Is.False, n[i].text + " and " + n[j].text + " overlap");
            for (int i = 1; i < 4; i++) Assert.That(n[i].transform.position.y, Is.GreaterThan(n[i - 1].transform.position.y), "farther from the local fighter is higher: " + n[i].text);
            Assert.That(NameLabel("eee5").transform.position.y, Is.EqualTo(n[0].transform.position.y).Within(1e-4f), "a name with nothing near it stays on its line");
            Assert.That(ActiveNames().Count, Is.EqualTo(5), "stacked, never merged");
        }

        // ---- camp respawn and ward labels ----

        sealed class Labels
        {
            public GameObject Root; public CampRespawnLabels Camp;
            public TextMeshPro Respawn { get { return Find("Camp respawn label"); } }
            public TextMeshPro Ward { get { return Find("Camp ward label"); } }
            TextMeshPro Find(string name)
            {
                foreach (var t in Root.GetComponentsInChildren<TextMeshPro>(true)) if (t.name == name && t.gameObject.activeInHierarchy) { t.ForceMeshUpdate(); return t; }
                Assert.Fail("no active " + name); return null;
            }
        }

        const float CampX = 640f, CampY = 640f;

        Labels Draw(params Rect[] avoid)
        {
            var l = new Labels { Root = new GameObject("camp labels") };
            l.Root.transform.SetParent(_arena.transform, false);
            l.Camp = new CampRespawnLabels(l.Root.transform);
            if (avoid.Length > 0) l.Camp.NameRectSource = into => { into.AddRange(avoid); };
            l.Camp.Draw(
                new List<CampWorldLabel> { new CampWorldLabel { Index = 0, WorldX = CampX, WorldY = CampY, Text = "RESPAWN 167s" } },
                new List<CampWardRow> { new CampWardRow { Index = 0, WorldX = CampX, WorldY = CampY, BeaconRgb = 0x66ccff, TextRgb = 0x66ccff, WorldText = "YOUR WARD 107s", Countdown = "107s" } });
            return l;
        }

        static Bounds TextBounds(TextMeshPro t) { return t.GetComponent<MeshRenderer>().bounds; }

        static Rect XY(Bounds b) { return new Rect(b.min.x, b.min.y, b.size.x, b.size.y); }

        static Rect Union(TextMeshPro t)
        {
            var b = TextBounds(t); var rect = XY(b);
            foreach (var r in t.GetComponentsInChildren<SpriteRenderer>(false)) { var rb = XY(r.bounds); rect = Rect.MinMaxRect(Mathf.Min(rect.xMin, rb.xMin), Mathf.Min(rect.yMin, rb.yMin), Mathf.Max(rect.xMax, rb.xMax), Mathf.Max(rect.yMax, rb.yMax)); }
            return rect;
        }

        [TestCase("Camp respawn label")]
        [TestCase("Camp ward label")]
        public void ACampWorldLabelHasADarkPlateBehindItThatReadsOnAnyGround(string which)
        {
            var l = Draw();
            var label = which == "Camp respawn label" ? l.Respawn : l.Ward;
            // Contract: the plate is an active SpriteRenderer child of the label's own object (it moves with the label), covering all of the text.
            var plate = label.GetComponentInChildren<SpriteRenderer>(false);
            Assert.That(plate, Is.Not.Null, which + " has no plate child: the outline alone reads as white or cyan on snow (round 4 shot 12)");
            var text = XY(TextBounds(label)); var rect = XY(plate.bounds);
            Assert.That(rect.Contains(new Vector2(text.xMin, text.yMin)) && rect.Contains(new Vector2(text.xMax, text.yMax)), Is.True, "plate " + rect + " covers the text " + text);
            var face = label.color; var back = plate.color;
            Assert.That(back.a, Is.GreaterThanOrEqualTo(.6f), "plate opacity");
            Assert.That(Ratio(new Color(face.r, face.g, face.b), new Color(back.r, back.g, back.b)), Is.GreaterThanOrEqualTo(4.5f), "label text against its plate");
        }

        [Test]
        public void WithNoFighterNearTheLabelsStayWhereTheyAre()
        {
            var l = Draw(new Rect(500f, 500f, 2f, 1f));   // a name far away
            var respawn = ArenaView.WorldPoint(CampX, CampY + 32f); var ward = ArenaView.WorldPoint(CampX, CampY - 48f);
            Assert.That(l.Respawn.transform.position.x, Is.EqualTo(respawn.x).Within(1e-3f)); Assert.That(l.Respawn.transform.position.y, Is.EqualTo(respawn.y).Within(1e-3f));
            Assert.That(l.Ward.transform.position.x, Is.EqualTo(ward.x).Within(1e-3f)); Assert.That(l.Ward.transform.position.y, Is.EqualTo(ward.y).Within(1e-3f));
        }

        [TestCase("Camp respawn label")]
        [TestCase("Camp ward label")]
        public void ACampLabelNeverIntersectsAFighterNameThatSharesItsPosition(string which)
        {
            var at = ArenaView.WorldPoint(CampX, CampY + (which == "Camp respawn label" ? 32f : -48f));
            var name = new Rect(at.x - 1.2f, at.y - .25f, 2.4f, .5f);   // the local fighter's name, centred where the label would be drawn
            var l = Draw(name);
            var label = which == "Camp respawn label" ? l.Respawn : l.Ward;
            var rect = Union(label);
            Assert.That(rect.Overlaps(name), Is.False, which + " " + rect + " intersects the fighter name " + name);
            Assert.That(Vector2.Distance(rect.center, new Vector2(at.x, at.y)), Is.LessThan(3f), "it shifts up by a line or so, it does not leave the camp");
        }
    }
}
