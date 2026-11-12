using System.Reflection;
using NUnit.Framework;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>The top-centre phase pill stays clear of the 294 wide plate in narrow windows (P-UNITY-HUD-TEXTSCALE-1).</summary>
    public sealed class HudPhasePillNarrowEditModeTests
    {
        GameObject _canvas, _hudOwner;
        MatchHud _hud;
        UiTheme _savedTheme;

        [SetUp]
        public void SetUp()
        {
            _savedTheme = UiTheme.Current; UiTheme.Current = UiTheme.Placeholder();
            _canvas = new GameObject("pill canvas", typeof(RectTransform), typeof(Canvas));
            _hudOwner = new GameObject("pill hud owner");
            _hud = _hudOwner.AddComponent<MatchHud>();
            Set("_root", _canvas.GetComponent<RectTransform>());
            Invoke("EnsureStage"); Invoke("CreateTopAndToastPills"); Invoke("CreateLegacyChrome"); Invoke("CreateCombatHud");
        }

        [TearDown]
        public void TearDown()
        {
            if (_canvas != null) Object.DestroyImmediate(_canvas);
            if (_hudOwner != null) Object.DestroyImmediate(_hudOwner);
            UiTheme.Current = _savedTheme;
        }

        static readonly Vector2[] Windows = { new Vector2(720, 800), new Vector2(800, 600), new Vector2(1280, 800) };

        [TestCaseSource(nameof(Windows))]
        public void ThePhasePillWithTheLongestLineDoesNotOverlapThePlate(Vector2 window)
        {
            var stage = (RectTransform)Get("_stage");
            ((HudStage)Get("_stageScaler")).Apply(window.x, window.y, HudLayout.CanvasScalerFactor(window.x, window.y));
            Invoke("ApplyLegacyViewport", HudLayout.Viewport(window.x, window.y));
            _hud.ApplyPhaseStrip("Coliseum · sudden death", Roguehalla.Net.Ui.Indicators.ArenaLineTone.Danger);
            var pill = World(stage, (RectTransform)Get("_phasePill"));
            var plate = World(stage, (RectTransform)Get("_vitalsPanel"));
            Assert.That(pill.Overlaps(plate), Is.False, "pill " + pill + " plate " + plate);
            Assert.That(pill.xMin, Is.GreaterThanOrEqualTo(plate.xMax + 7.99f));
            Assert.That(pill.xMax, Is.LessThanOrEqualTo(stage.rect.width + .01f), "the pill stays on screen");
        }

        static Rect World(RectTransform stage, RectTransform r)
        {
            var c = new Vector3[4]; r.GetWorldCorners(c);
            Vector3 min = stage.InverseTransformPoint(c[0]), max = stage.InverseTransformPoint(c[2]);
            return Rect.MinMaxRect(min.x, min.y, max.x, max.y);
        }

        object Get(string name) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
        void Set(string name, object value) => typeof(MatchHud).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, value);
        void Invoke(string name, params object[] args) => typeof(MatchHud).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, args.Length == 0 ? null : args);
    }
}
