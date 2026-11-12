using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>The GAINED strip and the mob-bonus row draw BuildHudText's output from the owner's summary, and stay hidden
    /// (never zeros) until the first summary arrives (P-UNITY-HUD-BUILD-1).</summary>
    public sealed class BuildHudCellsEditModeTests
    {
        GameObject _canvas, _hudOwner;
        MatchHud _hud;
        UiTheme _savedTheme;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current;
            UiTheme.Current = UiTheme.Placeholder();
            _canvas = new GameObject("HUD cells canvas", typeof(RectTransform), typeof(Canvas));
            _hudOwner = new GameObject("HUD owner");
            _hud = _hudOwner.AddComponent<MatchHud>();
            Set("_root", _canvas.GetComponent<RectTransform>());
            Invoke("EnsureStage");
            Invoke("CreateTopAndToastPills");
            Invoke("CreateLegacyChrome");
            Invoke("CreateCombatHud");
            // The strip belongs to the active plate; the summary decides whether it shows.
            typeof(MatchHud).GetMethod("SetPlateMode", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, new object[] { true });
        }

        [TearDown]
        public void TearDown()
        {
            if (_canvas != null) Object.DestroyImmediate(_canvas);
            if (_hudOwner != null) Object.DestroyImmediate(_hudOwner);
            UiTheme.Current = _savedTheme;
        }

        [Test]
        public void TheStripAndMobRowDrawTheFormattersTextAndStayHiddenBeforeTheFirstSummary()
        {
            var view = new CollectionsView();
            Refresh(view);
            Assert.That(_hud.GainedStripVisible, Is.False, "no summary yet: strip hidden, not zeros");

            var summary = new WireBuildSummary();
            int[] gains = { 240000, 0, 1900, 1250, 325, 1500000, -25000, 15000, 500 };
            for (int i = 0; i < 9; i++) summary.Gains[i] = gains[i];
            summary.MobRows = new[] { new WireMobBonusRow { MobType = (byte)MobTypeId.EmberImp, Stat = 2, Stacks = 15, Total = 1500 } };
            typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(view, new object[] { new ServerMsg.State { Items = new StateItem[] { new BuildSummaryState { Value = summary } } } });
            Refresh(view);

            Assert.That(_hud.GainedStripVisible, Is.True);
            var cells = BuildHudText.Cells(summary);
            for (int i = 0; i < 9; i++) Assert.That(_hud.GainedCellText(i), Is.EqualTo(cells[i].Value), cells[i].Label);
            var mob = (TMP_Text)Get("_mobText");
            Assert.That(mob.text, Is.EqualTo("Ember Imp ×15 +15% damage"));
        }

        void Refresh(CollectionsView view) =>
            typeof(MatchHud).GetMethod("RefreshBuildIcons", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, new object[] { view });
        object Get(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void Set(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, null);
    }
}
