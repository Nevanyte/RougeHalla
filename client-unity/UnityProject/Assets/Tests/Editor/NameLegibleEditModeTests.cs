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
    /// P-UNITY-NAME-LEGIBLE-1, world half, through the actor presenter and the camp labels. Three earlier packets (NAME-GROUP-1, NAME-GROUP-2,
    /// HUD-VISUAL-FIX-4) fixed a name's alpha, anchor and pack, passed their tests and left names unreadable on snow: their contrast checks used a flat
    /// theme colour as the floor and accepted "face OR outline contrasts". Here:
    ///  * the floor is sampled from what the client draws (<see cref="NameLegibleFloors"/>: the baked ground texels through the ground shader's formula,
    ///    ice and healing light from the terrain table, the temple slabs) and the FACE colour itself must contrast with it at least 4.5:1 against the
    ///    average and against the extreme decile on the face's side, the OUTLINE at least 3:1 against the face;
    ///  * the ground under a name is found through <see cref="SpriteActorPresenter.Surfaces"/> (a <see cref="SurfaceMap"/>), as the owning ArenaView sets it;
    ///  * names sort above every mob health bar and an elite's name is clear of its camp badge and of the bars of the pack beside it.
    /// World TextMeshPro labels are not reached by MatchHud.ApplyTextScale: every size and rectangle here is measured from the drawn mesh or sprite bounds.
    /// </summary>
    public sealed class NameLegibleEditModeTests
    {
        GameObject _arena, _labelsRoot; SpriteActorPresenter _presenter; UiTheme _savedTheme;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current; UiTheme.Current = UiTheme.Skin();
            ShowcaseSprites.Initialize();
            WorldLabelVisibility.Hidden = false;
            _arena = new GameObject("name legible arena");
            _presenter = new SpriteActorPresenter(_arena.transform, null);
            _presenter.Delivered = new HashSet<uint>();
        }

        [TearDown]
        public void TearDown()
        {
            if (_labelsRoot != null) Object.DestroyImmediate(_labelsRoot);
            if (_arena != null) Object.DestroyImmediate(_arena);
            UiTheme.Current = _savedTheme;
            WorldLabelVisibility.Hidden = false;
        }

        // ---- a map whose ground is one chosen surface (or two halves) ----

        sealed class WholeTemple : ISurfaceLayer
        {
            public bool TryGet(int tx, int ty, RegionId region, out SurfaceKind kind) { kind = SurfaceKind.TempleFloor; return region == RegionId.Holy; }
        }

        static SurfaceMap MapOf(SurfaceKind kind, SurfaceKind rightHalf = SurfaceKind.None)
        {
            const int w = 40, h = 40;
            var tiles = new byte[w * h]; var regions = new byte[w * h]; var terrain = new byte[w * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                bool border = x == 0 || y == 0 || x == w - 1 || y == h - 1;
                tiles[y * w + x] = border ? MapBlob.Wall : MapBlob.Floor;
                var which = rightHalf != SurfaceKind.None && x >= 20 ? rightHalf : kind;
                regions[y * w + x] = (byte)(border ? 0 : RegionOf(which));
                terrain[y * w + x] = (byte)(border ? TerrainKind.None : TerrainOf(which));
            }
            var rm = new RegionMap(); rm.Load(new MapBlob(w, h, tiles, terrain, regions, MapBlob.GroundTerrainAll));
            var sm = new SurfaceMap(rm);
            if (kind == SurfaceKind.TempleFloor) sm.AddLayer(new WholeTemple());
            return sm;
        }

        static RegionId RegionOf(SurfaceKind k)
        {
            switch (k)
            {
                case SurfaceKind.Basalt: return RegionId.Fire;
                case SurfaceKind.Flagstone: return RegionId.Sentenced;
                case SurfaceKind.Mud: return RegionId.Plague;
                case SurfaceKind.Snow: case SurfaceKind.Ice: return RegionId.Frost;
                case SurfaceKind.Limestone: return RegionId.Coliseum;
                default: return RegionId.Holy;   // sand, healing light, temple paving
            }
        }

        static TerrainKind TerrainOf(SurfaceKind k) { return k == SurfaceKind.Ice ? TerrainKind.Ice : k == SurfaceKind.HolyLight ? TerrainKind.Light : TerrainKind.None; }

        // ---- frames (legacy pixels as Present takes them) ----

        struct M
        {
            public uint Id; public float X, Y, Hp; public MobTypeId Type;
            public static M At(uint id, float x, float y) => new M { Id = id, X = x, Y = y, Hp = 100f, Type = MobTypeId.MagmaBrute };
            public static M Elite(uint id, float x, float y) => new M { Id = id, X = x, Y = y, Hp = 100f, Type = MobTypeId.Wyrmling };
            /// <summary>A mob that has been hit: only a hurt mob draws its health bar (the bars of the screenshots).</summary>
            public M Hurt() { var m = this; m.Hp = 60f; return m; }
        }

        void Frame(M[] mobs, params (uint id, float x, float y, string name, bool local)[] fighters)
        {
            _presenter.Begin();
            foreach (var m in mobs)
            {
                _presenter.Present(m.Id, m.X, m.Y, 0, m.Hp, null, ActorStatus.Alive, null, ActorKind.RegionalMob, m.Type, 0, 0, false, 0, 0, "grunt");
                _presenter.PresentIndicators(m.Id, 0, false, WeaponId.Fists, false, -1, false);
            }
            foreach (var f in fighters)
            {
                _presenter.Present(f.id, f.x, f.y, 0, 100, FactionId.Holy, ActorStatus.Alive, WeaponId.Fists, ActorKind.Player, null, 0, 0, f.local);
                _presenter.PresentMarks(f.id, new OverheadIndicators.Marks { Name = f.name });
                _presenter.PresentIndicators(f.id, 0, false, WeaponId.Fists, false);
            }
            _presenter.End();
        }

        List<TextMeshPro> ActiveNames()
        {
            var list = new List<TextMeshPro>();
            foreach (var t in _arena.GetComponentsInChildren<TextMeshPro>(true)) if (t.name == "Name" && t.gameObject.activeInHierarchy) { t.ForceMeshUpdate(); list.Add(t); }
            return list;
        }

        TextMeshPro OnlyName()
        {
            var names = ActiveNames();
            Assert.That(names.Count, Is.EqualTo(1), "set-up: exactly one name is drawn");
            return names[0];
        }

        TextMeshPro NameOf(string text)
        {
            foreach (var t in ActiveNames()) if (t.text == text) return t;
            Assert.Fail("no active name \"" + text + "\""); return null;
        }

        TextMeshPro Show(NameKind kind)
        {
            switch (kind)
            {
                case NameKind.Mob: Frame(new[] { M.At(1, 640f, 640f) }); break;
                case NameKind.Elite: Frame(new[] { M.Elite(1, 640f, 640f) }); break;
                case NameKind.Fighter: Frame(new M[0], (2u, 640f, 640f, "Rowan", false)); break;
                default: Frame(new M[0], (1u, 640f, 640f, "sh6b", true)); break;
            }
            return OnlyName();
        }

        // ---- what is drawn: the face the glyphs carry (vertex colour times the material's face colour) and the outline of the material ----

        static Color FaceOf(TextMeshPro t)
        {
            var m = t.fontSharedMaterial; var f = m.HasProperty(ShaderUtilities.ID_FaceColor) ? m.GetColor(ShaderUtilities.ID_FaceColor) : Color.white;
            return new Color(t.color.r * f.r, t.color.g * f.g, t.color.b * f.b, t.color.a * f.a);
        }

        static Color OutlineOf(TextMeshPro t) { var c = t.fontSharedMaterial.GetColor(ShaderUtilities.ID_OutlineColor); c.a = 1f; return c; }

        static Color Over(Color face, Color floor) { return Color.Lerp(floor, new Color(face.r, face.g, face.b, 1f), face.a); }

        static string Hex(Color c) { return "#" + ColorUtility.ToHtmlStringRGB(c); }

        // The rule: the face as drawn (composited at its alpha over the floor) against the AVERAGE floor at least 4.5:1, and against the extreme
        // decile on the face's own side (a light face: the brightest decile, which is what it is lost in; a dark face: the darkest decile, where
        // grout and shade are a mid-tone no colour can hold 4.5:1 on every floor, so 2:1) and the outline against the face at least 3:1.
        static void AssertReadable(TextMeshPro name, FloorSample floor, string what)
        {
            var face = FaceOf(name); var outline = OutlineOf(name);
            string at = what + " over " + floor.Name + " (avg " + Hex(floor.Avg) + ", dark " + Hex(floor.Dark) + ", bright " + Hex(floor.Bright) + "): face " + Hex(face) + " alpha " + face.a.ToString("F2") + ", outline " + Hex(outline);
            Assert.That(face.a, Is.GreaterThanOrEqualTo(.85f), at + ": drawn alpha");
            var faceRgb = new Color(face.r, face.g, face.b, 1f);
            bool light = NameLegibleFloors.Luminance(faceRgb) >= NameLegibleFloors.Luminance(floor.Avg);
            double vsAvg = NameLegibleFloors.Ratio(Over(face, floor.Avg), floor.Avg);
            double vsExtreme = light ? NameLegibleFloors.Ratio(Over(face, floor.Bright), floor.Bright) : NameLegibleFloors.Ratio(Over(face, floor.Dark), floor.Dark);
            Assert.That(vsAvg, Is.GreaterThanOrEqualTo(4.5), at + ": face against the average floor");
            Assert.That(vsExtreme, Is.GreaterThanOrEqualTo(light ? 4.5 : 2.0), at + ": face against the " + (light ? "brightest" : "darkest") + " decile");
            Assert.That(NameLegibleFloors.Ratio(faceRgb, outline), Is.GreaterThanOrEqualTo(3.0), at + ": outline against the face");
        }

        static IEnumerable<TestCaseData> KindsOnFloors()
        {
            foreach (NameKind kind in new[] { NameKind.Mob, NameKind.Elite, NameKind.Fighter, NameKind.Local })
                foreach (var floor in NameLegibleFloors.Kinds)
                    yield return new TestCaseData(kind, floor).SetName("A_" + kind + "_name_reads_on_" + floor);
        }

        // ---- 1. a name's face follows the floor under it ----

        [TestCaseSource(nameof(KindsOnFloors))]
        public void ANameReadsOnTheGroundUnderIt(NameKind kind, SurfaceKind floor)
        {
            _presenter.Surfaces = MapOf(floor);
            var name = Show(kind);
            AssertReadable(name, NameLegibleFloors.Of(floor), kind.ToString());
        }

        [Test]
        public void TheLoneIdleMobsNameOfTheScreenshotsIsReadableOnSnow()
        {
            // Screenshot round 6 shots 05 and 06: a lone idle "Frost Wisp" on snow, the face a pale grey. Same rule, stated for the case the brief names.
            _presenter.Surfaces = MapOf(SurfaceKind.Snow);
            Frame(new[] { M.At(1, 640f, 640f) });
            var face = FaceOf(OnlyName());
            Assert.That(NameLegibleFloors.Ratio(Over(face, NameLegibleFloors.Of(SurfaceKind.Snow).Avg), NameLegibleFloors.Of(SurfaceKind.Snow).Avg), Is.GreaterThanOrEqualTo(4.5), "face " + Hex(face) + " over snow");
        }

        [TestCase(SurfaceKind.Basalt)]
        [TestCase(SurfaceKind.Flagstone)]
        [TestCase(SurfaceKind.Mud)]
        public void AnEliteNameKeepsItsGoldOnDarkGround(SurfaceKind floor)
        {
            _presenter.Surfaces = MapOf(floor);
            var face = FaceOf(Show(NameKind.Elite));
            var gold = (Color)new Color32(0xF4, 0xD5, 0x76, 255);
            Assert.That(face.r, Is.EqualTo(gold.r).Within(.02f)); Assert.That(face.g, Is.EqualTo(gold.g).Within(.02f)); Assert.That(face.b, Is.EqualTo(gold.b).Within(.02f));
        }

        [TestCase(SurfaceKind.Snow)]
        [TestCase(SurfaceKind.Limestone)]
        [TestCase(SurfaceKind.TempleFloor)]
        public void AnEliteNameOnPaleGroundIsADarkGoldBrownWithALightOutline(SurfaceKind floor)
        {
            _presenter.Surfaces = MapOf(floor);
            var name = Show(NameKind.Elite);
            var face = FaceOf(name); var outline = OutlineOf(name);
            Assert.That(NameLegibleFloors.Luminance(face), Is.LessThan(.25), "dark face " + Hex(face));
            Assert.That(NameLegibleFloors.Luminance(outline), Is.GreaterThan(.6), "light outline " + Hex(outline));
            Assert.That(face.r, Is.GreaterThan(face.b), "still warm (gold-brown), not grey: " + Hex(face));
        }

        [Test]
        public void TheLocalFightersNameStaysGreenOnPaleAndDarkGround()
        {
            foreach (var floor in new[] { SurfaceKind.Basalt, SurfaceKind.Snow, SurfaceKind.Sand })
            {
                TearDown(); SetUp();
                _presenter.Surfaces = MapOf(floor);
                var face = FaceOf(Show(NameKind.Local));
                Assert.That(face.g, Is.GreaterThan(face.r).And.GreaterThan(face.b), "the own-name green over " + floor + ": " + Hex(face));
            }
        }

        [Test]
        public void WithoutASurfaceMapANameKeepsTheLightFaceAndDarkOutlineOfToday()
        {
            // Guard: no map (tests, a room that has not delivered one) is the dark-ground palette, so every earlier name test keeps its numbers.
            var name = Show(NameKind.Mob);
            var face = FaceOf(name); var outline = OutlineOf(name);
            Assert.That(NameLegibleFloors.Luminance(face), Is.GreaterThan(NameLegibleFloors.Luminance(outline)), "light face " + Hex(face) + " dark outline " + Hex(outline));
            Assert.That(NameLegibleFloors.Ratio(face, outline), Is.GreaterThanOrEqualTo(3.0));
            Assert.That(NameLegibleFloors.Luminance(face), Is.GreaterThan(.3), "a light face: " + Hex(face));
        }

        [Test]
        public void TheNameColoursFollowAMobAcrossAZoneEdge()
        {
            // Frost snow on the left half of the map, Fire basalt on the right: the same mob (same id) walks across.
            _presenter.Surfaces = MapOf(SurfaceKind.Snow, SurfaceKind.Basalt);
            Frame(new[] { M.At(1, 480f, 640f) });   // tile 15
            var onSnow = FaceOf(OnlyName());
            Frame(new[] { M.At(1, 800f, 640f) });   // tile 25
            var onBasalt = FaceOf(OnlyName());
            Frame(new[] { M.At(1, 480f, 640f) });
            var backOnSnow = FaceOf(OnlyName());
            Assert.That(NameLegibleFloors.Luminance(onSnow), Is.LessThan(NameLegibleFloors.Luminance(onBasalt)), "dark on snow " + Hex(onSnow) + ", light on basalt " + Hex(onBasalt));
            Assert.That(NameLegibleFloors.Luminance(backOnSnow), Is.EqualTo(NameLegibleFloors.Luminance(onSnow)).Within(.01), "and dark again on snow");
            Assert.That(NameLegibleFloors.Ratio(Over(onSnow, NameLegibleFloors.Of(SurfaceKind.Snow).Avg), NameLegibleFloors.Of(SurfaceKind.Snow).Avg), Is.GreaterThanOrEqualTo(4.5));
            Assert.That(NameLegibleFloors.Ratio(Over(onBasalt, NameLegibleFloors.Of(SurfaceKind.Basalt).Avg), NameLegibleFloors.Of(SurfaceKind.Basalt).Avg), Is.GreaterThanOrEqualTo(4.5));
        }

        // ---- 2. strength is set in one place: OverheadIndicators.Update (replaces the .5-alpha case of HudVisualFixEditModeTests) ----

        static OverheadIndicators.Facts MobFacts(string name, bool elite = false) =>
            new OverheadIndicators.Facts { Order = 2000, HeadY = 1.68f, BarY = 1.8f, HpPct = 100f, Mob = true, Elite = elite, Name = name };

        [Test]
        public void EveryMobNameIsFullStrengthStraightFromUpdateAndTheVisionFadeStillMultipliesIt()
        {
            // Replaces HudVisualFixEditModeTests.AnIdleFullHealthMobKeepsItsNameFaintAndAHurtOrEngagedOneReadsFull: that case pinned the legacy
            // IDLE_LABEL_ALPHA .5 inside Update while the presenter raised every drawn mob name to 1 afterwards (DEV-024), so the strength was set
            // in two places and the lower one was never seen. The strength is full in Update itself; the presenter's raise stays harmless.
            var go = new GameObject("mob");
            try
            {
                var ind = new OverheadIndicators(go.transform);
                var name = go.transform.Find("Name").GetComponent<TextMeshPro>();
                var f = MobFacts("Bloatfly"); ind.Update(f);
                Assert.That(name.color.a, Is.EqualTo(1f).Within(.01f), "a calm full-health mob");
                f.HpPct = 60f; ind.Update(f);
                Assert.That(name.color.a, Is.EqualTo(1f).Within(.01f), "hurt");
                f = MobFacts("Bloatfly"); f.M.Engaged = true; ind.Update(f);
                Assert.That(name.color.a, Is.EqualTo(1f).Within(.01f), "fighting");
                f = MobFacts("Wyrmling", true); ind.Update(f);
                Assert.That(name.color.a, Is.EqualTo(1f).Within(.01f), "an elite");
                f = MobFacts("Training dummy"); f.Dummy = true; ind.Update(f);
                Assert.That(name.color.a, Is.EqualTo(1f).Within(.01f), "the dummy");
                f = MobFacts("Bloatfly"); ind.Update(f); ind.ApplyOpacity(.5f);
                Assert.That(name.color.a, Is.EqualTo(.5f).Within(.01f), "vision fade still multiplies");
            }
            finally { Object.DestroyImmediate(go); }
        }

        // ---- 3. names sort above every health bar ----

        static bool IsBar(SpriteRenderer r)
        {
            string n = r.name; return n.StartsWith("Health and barrier track") || n.StartsWith("Confirmed health") || n.StartsWith("Confirmed barrier");
        }

        // The actor's root object: the child of the arena that holds it (bars, their outline sprites and the name are all below it).
        Transform ActorRoot(Transform t) { while (t.parent != null && t.parent != _arena.transform) t = t.parent; return t; }

        List<SpriteRenderer> Bars(Transform exceptActor = null)
        {
            var list = new List<SpriteRenderer>();
            foreach (var r in _arena.GetComponentsInChildren<SpriteRenderer>(false))
                if (r.enabled && r.gameObject.activeInHierarchy && IsBar(r) && (exceptActor == null || ActorRoot(r.transform) != exceptActor)) list.Add(r);
            return list;
        }

        [Test]
        public void EveryNameSortsAboveEveryMobHealthBarEvenWhenThePackStandsInFrontOfIt()
        {
            // Shot 06: the local fighter's green name under two mob bars. A bar sorts at the actor's order + 5 and a name at its own actor's order + 12,
            // and an actor lower on the screen has the higher order, so mobs 20 px in front of the fighter put their bars over its name.
            Frame(new[] { M.At(2, 600f, 660f).Hurt(), M.At(3, 640f, 664f).Hurt(), M.At(4, 680f, 660f).Hurt() }, (1u, 640f, 640f, "sh6b", true));
            var bars = Bars(); Assert.That(bars.Count, Is.GreaterThanOrEqualTo(6), "set-up: the three hurt mobs' bars and the fighter's are drawn");
            int highestBar = int.MinValue; foreach (var b in bars) highestBar = Mathf.Max(highestBar, b.sortingOrder);
            var names = ActiveNames(); Assert.That(names.Count, Is.GreaterThanOrEqualTo(2), "set-up: the pack's name and the fighter's");
            foreach (var name in names)
                Assert.That(name.GetComponent<MeshRenderer>().sortingOrder, Is.GreaterThan(highestBar), "name \"" + name.text + "\" sorts at " + name.GetComponent<MeshRenderer>().sortingOrder + ", a bar at " + highestBar);
        }

        // ---- 4. an elite's name clears its camp badge and the pack's bars ----

        static Rect XY(Bounds b) { return new Rect(b.min.x, b.min.y, b.size.x, b.size.y); }

        static Rect Union(IEnumerable<Rect> rects)
        {
            bool any = false; Rect u = default;
            foreach (var r in rects) { if (!any) { u = r; any = true; } else u = Rect.MinMaxRect(Mathf.Min(u.xMin, r.xMin), Mathf.Min(u.yMin, r.yMin), Mathf.Max(u.xMax, r.xMax), Mathf.Max(u.yMax, r.yMax)); }
            return u;
        }

        [Test]
        public void AnEliteNameDoesNotIntersectItsCampBadgeOrThePackMembersBars()
        {
            // Pass 1: where the elite's name sits when it stands alone; where a member's bar sits when the member stands at (640, 560).
            _presenter.Surfaces = MapOf(SurfaceKind.Snow);
            Frame(new[] { M.Elite(6, 640f, 640f), M.At(7, 640f, 560f).Hurt() });
            var eliteName = NameOf("Wyrmling"); var nameBox = XY(eliteName.GetComponent<MeshRenderer>().bounds);
            var eliteRoot = ActorRoot(eliteName.transform);
            var memberBar = Bars(eliteRoot); Assert.That(memberBar.Count, Is.GreaterThan(0), "set-up: the member's bar is drawn");
            var barBox = Union(memberBar.ConvertAll(r => XY(r.bounds)));
            // Pass 2: the member moves so its bar is centred on the name's line, and the camp so its badge is centred on the name.
            float dyPx = -(nameBox.center.y - barBox.center.y) / (ArenaView.Scale * ArenaView.GroundSquash);
            Frame(new[] { M.Elite(6, 640f, 640f), M.At(7, 640f, 560f + dyPx).Hurt() });
            eliteName = NameOf("Wyrmling"); nameBox = XY(eliteName.GetComponent<MeshRenderer>().bounds); eliteRoot = ActorRoot(eliteName.transform);
            double campX = nameBox.center.x / ArenaView.Scale, campY = -nameBox.center.y / (ArenaView.Scale * ArenaView.GroundSquash) + 44.0;   // the badge sits 44 px above the camp
            Assert.That(Union(Bars(eliteRoot).ConvertAll(r => XY(r.bounds))).Overlaps(nameBox), Is.True, "set-up: today the member's bar is on the elite's name (shot 09)");

            _labelsRoot = new GameObject("camp labels"); _labelsRoot.transform.SetParent(_arena.transform, false);
            var camp = new CampRespawnLabels(_labelsRoot.transform);
            camp.NameRectSource = into => _presenter.FighterNameRects(into);   // the wiring ArenaView does
            camp.Draw(new List<CampWorldLabel>(), new List<CampWardRow>(),
                new List<CampBadgeRow> { new CampBadgeRow { Index = 0, WorldX = campX, WorldY = campY, IconKey = "ad", IconRgb = 0xff8a3d, EliteIconKey = "ap", EliteIconRgb = 0xb39ddb } });

            var badgeRects = new List<Rect>();
            foreach (var r in _labelsRoot.GetComponentsInChildren<SpriteRenderer>(false))
                if (r.gameObject.activeInHierarchy && (r.name == "Camp reward plaque" || r.name == "Camp reward badge")) badgeRects.Add(XY(r.bounds));
            Assert.That(badgeRects.Count, Is.GreaterThanOrEqualTo(2), "set-up: the badge (plaque and icons) is drawn");
            var badge = Union(badgeRects);
            eliteName = NameOf("Wyrmling"); var finalName = XY(eliteName.GetComponent<MeshRenderer>().bounds);
            Assert.That(finalName.Overlaps(badge), Is.False, "the elite's name " + finalName + " intersects its camp's badge " + badge + " (shot 09, 10)");
            foreach (var bar in Bars(ActorRoot(eliteName.transform)))
                Assert.That(finalName.Overlaps(XY(bar.bounds)), Is.False, "the elite's name " + finalName + " intersects the bar \"" + bar.name + "\" " + XY(bar.bounds) + " of another mob");
            // Whichever side steps, it steps a line or two, it does not fly off.
            var own = nameBox.center; Assert.That(Vector2.Distance(finalName.center, own), Is.LessThan(3f), "the name stays near the elite");
            var home = ArenaView.WorldPoint((float)campX, (float)campY - 44f); Assert.That(Vector2.Distance(badge.center, new Vector2(home.x, home.y)), Is.LessThan(3f), "the badge stays near its camp");
        }

        // ---- the unit tests' floors are this measurement ----

        [Test]
        public void FloorTableMatchesTheMeasurement()
        {
            // RoguehallaNet.Tests/NameLegibleTests.cs carries the floors as constants (the dotnet tests cannot reach Unity's textures). If the baked ground, the
            // palette or the shader formula in NameLegibleFloors move, those constants no longer describe the ground and this fails (per channel, of 255).
            Assert.That(NameLegibleFloors.Published.Length, Is.EqualTo(NameLegibleFloors.Kinds.Length));
            foreach (var row in NameLegibleFloors.Published)
            {
                var m = NameLegibleFloors.Of(row.Kind);
                foreach (var pair in new[] { (m.Avg, row.Avg, "average"), (m.Dark, row.Dark, "darkest decile"), (m.Bright, row.Bright, "brightest decile") })
                {
                    var want = (Color)new Color32((byte)(pair.Item2 >> 16), (byte)(pair.Item2 >> 8), (byte)pair.Item2, 255);
                    string at = row.Kind + " " + pair.Item3 + ": measured " + Hex(pair.Item1) + ", published " + Hex(want);
                    Assert.That(pair.Item1.r * 255f, Is.EqualTo(want.r * 255f).Within(6f), at + " (red)");
                    Assert.That(pair.Item1.g * 255f, Is.EqualTo(want.g * 255f).Within(6f), at + " (green)");
                    Assert.That(pair.Item1.b * 255f, Is.EqualTo(want.b * 255f).Within(6f), at + " (blue)");
                }
            }
        }
    }
}
