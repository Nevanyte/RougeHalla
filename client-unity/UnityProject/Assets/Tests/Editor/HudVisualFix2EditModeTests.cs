using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-HUD-VISUAL-FIX-2: what the second screenshot round still showed. Causes and legacy citations are in the packet brief.
    /// The fit checks measure a label the way the running build lays it out: after <c>MatchHud.ApplyTextScale</c> has re-applied
    /// <see cref="MythicTextScale"/> to every HUD label (it runs on every ShowcaseSettings change), at the smallest size autosizing may settle on.
    /// </summary>
    public sealed class HudVisualFix2EditModeTests
    {
        static readonly Vector2[] Windows = { new Vector2(1280, 800), new Vector2(1920, 1080) };

        GameObject _canvas, _hudOwner;
        MatchHud _hud;
        UiTheme _savedTheme;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current;
            UiTheme.Current = UiTheme.Placeholder();
            _canvas = new GameObject("visual fix 2 canvas", typeof(RectTransform), typeof(Canvas));
            _hudOwner = new GameObject("visual fix 2 hud owner");
            _hud = _hudOwner.AddComponent<MatchHud>();
            SetField("_root", _canvas.GetComponent<RectTransform>());
            Invoke("EnsureStage");
            Invoke("CreateTopAndToastPills");
            Invoke("CreateLegacyChrome");
            Invoke("CreateCombatHud");
        }

        [TearDown]
        public void TearDown()
        {
            if (_canvas != null) Object.DestroyImmediate(_canvas);
            if (_hudOwner != null) Object.DestroyImmediate(_hudOwner);
            UiTheme.Current = _savedTheme;
        }

        // ---- fit measurement shared by items 1 and 2 ----

        /// <summary>The width the text needs at the smallest size the label can end up at (its autosize floor, else its fixed size).</summary>
        static float NeededAtSmallest(TMP_Text label, string text, out float size)
        {
            bool auto = label.enableAutoSizing; float keep = label.fontSize;
            size = auto ? label.fontSizeMin : label.fontSize;
            label.enableAutoSizing = false; label.fontSize = size;
            label.text = text; label.ForceMeshUpdate();
            float needed = label.GetPreferredValues(text, 0f, 0f).x;
            label.fontSize = keep; label.enableAutoSizing = auto;
            return needed;
        }

        void ShowStripAt(Vector2 window)
        {
            ((HudStage)GetField("_stageScaler")).Apply(window.x, window.y, HudLayout.CanvasScalerFactor(window.x, window.y));
            typeof(MatchHud).GetMethod("SetPlateMode", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, new object[] { true });
            // The running HUD re-applies MythicTextScale to every label it owns whenever ShowcaseSettings changes (MatchHud.cs:121-132). It overwrites
            // font size, max and min with BaseSize x scale, which is how a label built at 8 ends up at 10 shrinking to 8.5.
            Invoke("ApplyTextScale");
        }

        // ---- 1. GAINED labels fit by construction (MatchHud.Legacy.cs CreateBuildHud) ----

        [TestCaseSource(nameof(Windows))]
        public void EveryGainedNameLabelFitsWithTwelvePercentToSpareAfterTheTextScaleIsApplied(Vector2 window)
        {
            ShowStripAt(window);
            var cells = (RectTransform[])GetField("_buildCells");
            string[] names = { "Offense", "SO", "Damage gained", "Attack speed", "Life steal", "Health gained", "Defense", "Soul Defense", "Move speed" };
            var problems = new List<string>();
            for (int i = 0; i < 9; i++)
            {
                var label = cells[i].Find("Name/Label").GetComponent<TMP_Text>();
                Assert.That(label.text, Is.EqualTo(names[i]), "the wording stays");
                float needed = NeededAtSmallest(label, names[i], out float size);
                float box = label.rectTransform.rect.width;
                if (size < 7f) problems.Add(names[i] + " is down to " + size + ", too small to read");
                if (needed > box * .88f) problems.Add(names[i] + " needs " + needed + " of " + box + " at its smallest size " + size);
                if (label.overflowMode == TextOverflowModes.Ellipsis) problems.Add(names[i] + " would end in an ellipsis");
            }
            Assert.That(problems, Is.Empty, string.Join("; ", problems));
        }

        [TestCaseSource(nameof(Windows))]
        public void EveryGainedValueLabelFitsWithTwelvePercentToSpareAfterTheTextScaleIsApplied(Vector2 window)
        {
            ShowStripAt(window);
            var values = (TMP_Text[])GetField("_gainValues");
            foreach (string widest in new[] { "+125.5%", "+1234.5", "+0", "0%" })
                for (int i = 0; i < 9; i++)
                {
                    var label = values[i];
                    Assert.That(label.overflowMode, Is.Not.EqualTo(TextOverflowModes.Ellipsis), widest);
                    float needed = NeededAtSmallest(label, widest, out float size);
                    float box = label.rectTransform.rect.width;
                    Assert.That(size, Is.GreaterThanOrEqualTo(6f));
                    Assert.That(needed, Is.LessThanOrEqualTo(box * .88f), "cell " + i + " " + widest + " needs " + needed + " of " + box + " at " + size);
                }
        }

        [Test]
        public void TheNameAndValueBoxesOfACellNeitherOverlapNorLeaveTheCell()
        {
            var cells = (RectTransform[])GetField("_buildCells");
            for (int i = 0; i < 9; i++)
            {
                var name = (RectTransform)cells[i].Find("Name"); var value = (RectTransform)cells[i].Find("Value");
                float nameRight = name.anchoredPosition.x + name.sizeDelta.x, valueLeft = value.anchoredPosition.x, valueRight = valueLeft + value.sizeDelta.x;
                Assert.That(nameRight, Is.LessThanOrEqualTo(valueLeft + .01f), "cell " + i + ": the name box ends where the value box begins");
                Assert.That(valueRight, Is.LessThanOrEqualTo(cells[i].sizeDelta.x + .01f), "cell " + i + ": the value box stays inside the cell");
            }
        }

        // ---- 2. champion panel values show whole (MatchHud.Legacy.cs CreateDamageReadout; legacy championCombatHud.css:35,44) ----

        const byte HitPhysical = 0, HitMagic = 1, HitTrue = 2, Aps = 3, BurnDps = 4, MarkPulse = 10, DiseaseDps = 12, ChillSlow = 16, ChillMove = 17, HolySteal = 20;

        static WireBuildSummary Panel(FactionId faction, double a, double b = 0d)
        {
            var list = new List<WirePanelValue>
            {
                new WirePanelValue { Code = HitPhysical, Value = 18182 }, new WirePanelValue { Code = HitMagic, Value = 473697 },
                new WirePanelValue { Code = HitTrue, Value = 0 }, new WirePanelValue { Code = Aps, Value = 19800 },
            };
            int Q(double v) => (int)System.Math.Round(v / Hud.Quantum);
            switch (faction)
            {
                case FactionId.Fire: list.Add(new WirePanelValue { Code = BurnDps, Value = Q(a) }); break;
                case FactionId.Sentenced: list.Add(new WirePanelValue { Code = MarkPulse, Value = Q(a) }); break;
                case FactionId.Plague: list.Add(new WirePanelValue { Code = DiseaseDps, Value = Q(a) }); break;
                case FactionId.Frost: list.Add(new WirePanelValue { Code = ChillSlow, Value = Q(a) }); list.Add(new WirePanelValue { Code = ChillMove, Value = Q(b) }); break;
                default: list.Add(new WirePanelValue { Code = HolySteal, Value = Q(a) }); break;
            }
            return new WireBuildSummary { Panel = list.ToArray() };
        }

        // The longest value of each faction named in ChampionPanelTextTests.
        [TestCase(FactionId.Fire, 64.375, 0d, "64.38 magic/s")]
        [TestCase(FactionId.Sentenced, 0.0216, 0d, "2.16% target HP / hit")]
        [TestCase(FactionId.Plague, 62.4, 0d, "62.4 magic/s")]
        [TestCase(FactionId.Frost, 0.32, 0.30, "32% AS · 30% MS slow")]
        [TestCase(FactionId.Holy, 0.07, 0d, "7% life steal")]
        public void EachFactionsPassiveValueFitsItsColumnWithEightPercentToSpare(FactionId faction, double a, double b, string expected)
        {
            foreach (var window in Windows)
            {
                ((HudStage)GetField("_stageScaler")).Apply(window.x, window.y, HudLayout.CanvasScalerFactor(window.x, window.y));
                Invoke("ApplyTextScale");
                var me = new SelfView { Faction = faction, Weapon = WeaponId.Wand, Hp = 100, MaxHp = 100, Status = ActorStatus.Alive };
                SetField("_panelShownCount", -1);
                Invoke("ApplyChampionRows", Panel(faction, a, b), me);
                var value = ((TMP_Text[])GetField("_championValue"))[1];
                Assert.That(value.text, Is.EqualTo(expected), "the row text is the formatter's (its oracle pins it)");
                AssertValueFits(value, faction + " passive at " + window);
            }
        }

        [Test]
        public void TheLongestAutoRowFitsItsColumnWithEightPercentToSpare()
        {
            foreach (var window in Windows)
            {
                ((HudStage)GetField("_stageScaler")).Apply(window.x, window.y, HudLayout.CanvasScalerFactor(window.x, window.y));
                Invoke("ApplyTextScale");
                var me = new SelfView { Faction = FactionId.Fire, Weapon = WeaponId.Wand, Hp = 100, MaxHp = 100, Status = ActorStatus.Alive };
                SetField("_panelShownCount", -1);
                Invoke("ApplyChampionRows", Panel(FactionId.Fire, 64.375), me);
                var value = ((TMP_Text[])GetField("_championValue"))[0];
                Assert.That(value.text, Is.EqualTo("49.19 / hit · 1.98/s"));
                AssertValueFits(value, "auto row at " + window);
            }
        }

        static void AssertValueFits(TMP_Text value, string what)
        {
            string text = value.text;
            float needed = NeededAtSmallest(value, text, out float size);
            float box = value.rectTransform.rect.width;
            Assert.That(size, Is.GreaterThanOrEqualTo(9f), what + " stays legible");
            Assert.That(needed, Is.LessThanOrEqualTo(box * .92f), what + ": '" + text + "' needs " + needed + " of " + box + " at " + size + " (a truncated value ends in an ellipsis)");
        }

        [Test]
        public void TheChampionRowNameAndValueBoxesNeitherOverlapNorLeaveTheRow()
        {
            var rows = (RectTransform[])GetField("_championRow");
            for (int r = 0; r < 3; r++)
            {
                var name = (RectTransform)rows[r].Find("Name"); var value = (RectTransform)rows[r].Find("Value");
                Assert.That(name.anchoredPosition.x + name.sizeDelta.x, Is.LessThanOrEqualTo(value.anchoredPosition.x + .01f), "row " + r);
                Assert.That(value.anchoredPosition.x + value.sizeDelta.x, Is.LessThanOrEqualTo(rows[r].sizeDelta.x + .01f), "row " + r);
            }
        }

        // ---- 3. Tab map zone labels sit above everything the map mesh and the vision fog draw (TacticalMapSurface.cs:34-49, TacticalMapMarks.cs:181-203) ----

        static MapBlob RegionMap()
        {
            int w = 6, h = 6; var regions = new byte[w * h];
            for (int i = 0; i < regions.Length; i++) regions[i] = (byte)(i % 6 + 1);
            return new MapBlob((ushort)w, (ushort)h, new byte[w * h], null, regions);
        }

        TacticalMapSurface NewLargeSurface(out GameObject host)
        {
            host = new GameObject("tab map surface", typeof(RectTransform));
            host.transform.SetParent(_canvas.transform, false);
            ((RectTransform)host.transform).sizeDelta = new Vector2(400, 400);
            var surface = host.AddComponent<TacticalMapSurface>(); surface.Initialize();
            surface.Marks.Large = true; surface.SetMap(RegionMap());
            return surface;
        }

        [Test]
        public void ZoneLabelsDrawAfterTheMarksMeshAndTheVisionFogAsTheirOwnLaterSibling()
        {
            var surface = NewLargeSurface(out var host);
            var marks = surface.Marks.transform; var fog = surface.transform.Find("Vision fog");
            Assert.That(fog, Is.Not.Null);
            var labels = new List<Transform>();
            foreach (var t in surface.GetComponentsInChildren<TMP_Text>(true)) if (t.name.StartsWith("ZoneLabel")) labels.Add(t.transform);
            Assert.That(labels.Count, Is.EqualTo(6), "one name per zone on the Tab map");
            Assert.That(marks.GetSiblingIndex(), Is.GreaterThan(fog.GetSiblingIndex()), "the zone icons are in the marks mesh, above the fog (guard)");
            foreach (var label in labels)
            {
                // Direct child of the surface's container, not of the mesh graphic itself: nothing the mesh draws (self marker, ping, contacts) can reach it.
                Transform top = label; while (top.parent != null && top.parent != surface.transform) top = top.parent;
                Assert.That(top, Is.Not.SameAs(marks), label.name + " must not be a child of the marks mesh");
                Assert.That(top.parent, Is.SameAs(surface.transform));
                Assert.That(top.GetSiblingIndex(), Is.GreaterThan(marks.GetSiblingIndex()), label.name + " draws after the marks mesh");
                Assert.That(top.GetSiblingIndex(), Is.GreaterThan(fog.GetSiblingIndex()), label.name + " draws after the fog");
            }
        }

        [Test]
        public void ZoneLabelsCarryADarkOutlineSoTheyReadOverTheCreamSelfRing()
        {
            var surface = NewLargeSurface(out var host);
            int seen = 0;
            foreach (var t in surface.GetComponentsInChildren<TMP_Text>(true))
            {
                if (!t.name.StartsWith("ZoneLabel")) continue;
                seen++;
                var material = t.fontSharedMaterial;
                Assert.That(material.IsKeywordEnabled("OUTLINE_ON"), Is.True, t.name + ": outline on");
                Assert.That(material.GetFloat(ShaderUtilities.ID_OutlineWidth), Is.GreaterThanOrEqualTo(.1f), t.name);
                Color outline = material.GetColor(ShaderUtilities.ID_OutlineColor), ink = UiTheme.Current.OutlineDark;
                Assert.That(outline.r, Is.EqualTo(ink.r).Within(.01f)); Assert.That(outline.g, Is.EqualTo(ink.g).Within(.01f)); Assert.That(outline.b, Is.EqualTo(ink.b).Within(.01f));
            }
            Assert.That(seen, Is.EqualTo(6));
        }

        // ---- 4. a pack of same-named mobs reads as one name (SpriteActorPresenter.End; OverheadIndicators; NameMerge) ----

        GameObject _arena; SpriteActorPresenter _presenter;

        void StartArena()
        {
            ShowcaseSprites.Initialize();
            _arena = new GameObject("name merge arena");
            _presenter = new SpriteActorPresenter(_arena.transform, null);
            _presenter.Delivered = new HashSet<uint>();
        }

        void Frame(params (uint id, float x, float y, MobTypeId type)[] mobs)
        {
            _presenter.Begin();
            foreach (var m in mobs)
            {
                _presenter.Present(m.id, m.x, m.y, 0, 100, null, ActorStatus.Alive, null, ActorKind.RegionalMob, m.type, 0, 0, false, 0, 0, "grunt");
                _presenter.PresentIndicators(m.id, 0, false, WeaponId.Fists, false);
            }
            _presenter.End();
        }

        [Test]
        public void TwoAdjacentMobsOfOneTypeShowOneNameTheLowerIdsAndItIsStableAcrossFrames()
        {
            StartArena();
            try
            {
                for (int frame = 0; frame < 3; frame++)
                {
                    Frame((5, 640f, 640f, MobTypeId.MiasmaWitch), (2, 664f, 640f, MobTypeId.MiasmaWitch));
                    Assert.That(_presenter.NameShown(2), Is.True, "frame " + frame + ": the lowest id keeps the name");
                    Assert.That(_presenter.NameShown(5), Is.False, "frame " + frame + ": the other is merged away");
                }
            }
            finally { Object.DestroyImmediate(_arena); }
        }

        [Test]
        public void AFarPairAndAMixedPairShowBothNames()
        {
            StartArena();
            try
            {
                Frame((1, 640f, 640f, MobTypeId.MiasmaWitch), (2, 640f + 1600f, 640f, MobTypeId.MiasmaWitch));
                Assert.That(_presenter.NameShown(1), Is.True); Assert.That(_presenter.NameShown(2), Is.True, "far apart");
                Frame((1, 640f, 640f, MobTypeId.MiasmaWitch), (2, 664f, 640f, MobTypeId.PlagueRat));
                Assert.That(_presenter.NameShown(1), Is.True); Assert.That(_presenter.NameShown(2), Is.True, "different names");
                Frame((1, 640f, 640f, MobTypeId.MiasmaWitch), (2, 664f, 640f, MobTypeId.MiasmaWitch));
                Assert.That(_presenter.NameShown(2), Is.False, "close again: merged");
                Frame((1, 640f, 640f, MobTypeId.MiasmaWitch), (2, 640f + 1600f, 640f, MobTypeId.MiasmaWitch));
                Assert.That(_presenter.NameShown(2), Is.True, "and back when they part");
            }
            finally { Object.DestroyImmediate(_arena); }
        }

        [Test]
        public void TwoAdjacentEliteMobsShowBothNames()
        {
            StartArena();
            try
            {
                Frame((1, 640f, 640f, MobTypeId.Wyrmling), (2, 664f, 640f, MobTypeId.Wyrmling));
                Assert.That(_presenter.NameShown(1), Is.True); Assert.That(_presenter.NameShown(2), Is.True);
            }
            finally { Object.DestroyImmediate(_arena); }
        }

        // ---- helpers ----

        object GetField(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void SetField(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args.Length == 0 ? null : args);
    }
}
