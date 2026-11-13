using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-HUD-VISUAL-FIX-1: the defects seen in the first real screenshots. Causes and legacy citations are in the packet brief.</summary>
    public sealed class HudVisualFixEditModeTests
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
            _canvas = new GameObject("visual fix canvas", typeof(RectTransform), typeof(Canvas));
            _hudOwner = new GameObject("visual fix hud owner");
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

        // ---- 1. the timer: colour through the label, never tags in its text (MatchHud.Features.cs ApplyPhaseStrip; HudUi.Label sets richText = false) ----

        [TestCase(Indicators.ArenaLineTone.Warn, 0xff, 0xcc, 0x80)]    // legacy --warn, style.css:44
        [TestCase(Indicators.ArenaLineTone.Danger, 0xff, 0x8a, 0x80)]  // legacy .hud-arena.sudden, style.css:320
        public void TheTimerShowsPlainTextInTheTonesColour(Indicators.ArenaLineTone tone, int r, int g, int b)
        {
            var strip = (TMP_Text)GetField("_phaseStrip");
            _hud.ApplyPhaseStrip("Coliseum 9:49", tone);
            Assert.That(strip.text, Is.EqualTo("Coliseum 9:49"), "no colour tags in the text of a label that does not parse them");
            Assert.That(strip.text, Does.Not.Contain("<"));
            Assert.That(strip.richText, Is.False, "names are untrusted text: the label stays plain");
            Color expected = new Color32((byte)r, (byte)g, (byte)b, 255);
            Assert.That(strip.color.r, Is.EqualTo(expected.r).Within(.01f));
            Assert.That(strip.color.g, Is.EqualTo(expected.g).Within(.01f));
            Assert.That(strip.color.b, Is.EqualTo(expected.b).Within(.01f));
        }

        [Test]
        public void ANormalLineTakesBackThePrimaryColourAfterAToneLine()
        {
            var strip = (TMP_Text)GetField("_phaseStrip");
            _hud.ApplyPhaseStrip("Coliseum 9:49", Indicators.ArenaLineTone.Danger);
            _hud.ApplyPhaseStrip("Planning 0:37", Indicators.ArenaLineTone.Normal);
            Color want = UiTheme.Current.TextPrimary;
            Assert.That(strip.text, Is.EqualTo("Planning 0:37"));
            Assert.That(strip.color.r, Is.EqualTo(want.r).Within(.01f));
            Assert.That(strip.color.g, Is.EqualTo(want.g).Within(.01f));
            Assert.That(strip.color.b, Is.EqualTo(want.b).Within(.01f));
        }

        [TestCase("Coliseum 9:49", Indicators.ArenaLineTone.Warn)]
        [TestCase("Coliseum · sudden death", Indicators.ArenaLineTone.Danger)]
        [TestCase("Planning 0:37", Indicators.ArenaLineTone.Normal)]
        [TestCase("Waiting for players 8/12 — run starts in 59:59", Indicators.ArenaLineTone.Normal)]
        [TestCase("Run over — [BOT] Quill is victorious", Indicators.ArenaLineTone.Normal)]
        public void TheTimerPillIsWideEnoughForItsLine(string line, Indicators.ArenaLineTone tone)
        {
            var strip = (TMP_Text)GetField("_phaseStrip");
            var pill = (RectTransform)GetField("_phasePill");
            _hud.ApplyPhaseStrip(line, tone);
            strip.ForceMeshUpdate();
            float width = strip.GetPreferredValues(strip.text).x;
            Assert.That(width, Is.GreaterThan(10f), "the label measured something");
            Assert.That(width, Is.LessThanOrEqualTo(pill.rect.width), "legacy's top-centre line is as wide as its text (hud.ts updateArena), never ellipsised");
            Assert.That(strip.isTextTruncated, Is.False);
        }

        // Guard (passes today): _hpValue is the one label created through HudUi.Label that turns rich text back on, so its bounty tag renders.
        [Test]
        public void TheBountyTagRendersWhereItIsWritten()
        {
            var me = new SelfView { Hp = 70, MaxHp = 100, Bounty = 40, Status = ActorStatus.Alive };
            Invoke("RefreshLegacyHud", me, 1000d);
            var value = (TMP_Text)GetField("_hpValue");
            StringAssert.Contains("Bounty 40", value.text);
            Assert.That(value.richText || !value.text.Contains("<"), Is.True, "tags only in a label that parses them");
        }

        // ---- 4. GAINED cell labels fit (MatchHud.Legacy.cs CreateBuildHud: 58 wide name box, autosize floor 8.5) ----

        [TestCaseSource(nameof(Windows))]
        public void EveryGainedCellLabelIsShownWholeAtBothWindowSizes(Vector2 window)
        {
            float factor = HudLayout.CanvasScalerFactor(window.x, window.y);
            ((HudStage)GetField("_stageScaler")).Apply(window.x, window.y, factor);
            typeof(MatchHud).GetMethod("SetPlateMode", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, new object[] { true });
            var cells = (RectTransform[])GetField("_buildCells");
            Assert.That(cells.Length, Is.EqualTo(9));
            string[] names = { "Offense", "SO", "Damage gained", "Attack speed", "Life steal", "Health gained", "Defense", "Soul Defense", "Move speed" };
            for (int i = 0; i < 9; i++)
            {
                var label = cells[i].Find("Name/Label").GetComponent<TMP_Text>();
                Assert.That(label.text, Is.EqualTo(names[i]), "the text stays (P-UNITY-HUD-BUILD-1)");
                // The width the text needs at the size the label is built to (autosizing off: GetPreferredValues would otherwise read the max anyway).
                float nominal = label.fontSizeMax > label.fontSize ? label.fontSizeMax : label.fontSize;
                label.enableAutoSizing = false; label.fontSize = nominal;
                float needed = label.GetPreferredValues(label.text, 0f, 0f).x;
                Assert.That(nominal, Is.GreaterThanOrEqualTo(8f), names[i] + " stays legible");
                Assert.That(needed, Is.LessThanOrEqualTo(label.rectTransform.rect.width + .01f), names[i] + " needs " + needed + " of " + label.rectTransform.rect.width);
            }
        }

        // ---- 3. mob labels (legacy MobView.ts:26-27,108-110,183-186,247) ----

        static OverheadIndicators.Facts MobFacts(string name, bool elite = false) =>
            new OverheadIndicators.Facts { Order = 2000, HeadY = 1.68f, BarY = 1.8f, HpPct = 100f, Mob = true, Elite = elite, Name = name };

        [Test]
        public void AnEliteNameIsTwelveOverElevenTheSizeOfAPlainMobName()
        {
            ShowcaseSprites.Initialize();
            var go = new GameObject("mob");
            try
            {
                var ind = new OverheadIndicators(go.transform);
                var name = go.transform.Find("Name").GetComponent<TextMeshPro>();
                ind.Update(MobFacts("Bloatfly")); float plain = name.fontSize;
                ind.Update(MobFacts("Wyrmling", true)); float elite = name.fontSize;
                Assert.That(elite / plain, Is.EqualTo(12f / 11f).Within(.02f), "MobView.ts:247 setFontSize(elite ? 12 : 11)");
            }
            finally { Object.DestroyImmediate(go); }
        }

        // ---- 5(a) guard: the boxed two-dot icon is the legacy secondary-weapon mark (PlayerView.ts:452-468, `?? FISTS`) ----

        [Test]
        public void TheBoxedFistsIconIsTheLegacySecondaryWeaponMarkLeftOfCentre()
        {
            ShowcaseSprites.Initialize();
            var go = new GameObject("player");
            try
            {
                var ind = new OverheadIndicators(go.transform);
                var f = new OverheadIndicators.Facts { Order = 2000, HeadY = 1.68f, BarY = 1.8f, HpPct = 100f, HasSecondary = true, Secondary = WeaponId.Fists };
                ind.Update(f);
                var icon = go.transform.Find("Secondary weapon icon").GetComponent<SpriteRenderer>();
                Assert.That(icon.enabled, Is.True);
                Assert.That(icon.sprite, Is.SameAs(ShowcaseSprites.Get("weapon" + (int)WeaponId.Fists)), "fists art, not a placeholder");
                Assert.That(go.transform.Find("Secondary weapon backer").GetComponent<SpriteRenderer>().enabled, Is.True);
                Assert.That(icon.transform.localPosition.x, Is.EqualTo(-18f * OverheadStack.UnitsPerPx).Within(.001f));
            }
            finally { Object.DestroyImmediate(go); }
        }

        // ---- helpers ----

        object GetField(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void SetField(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args.Length == 0 ? null : args);
    }
}
