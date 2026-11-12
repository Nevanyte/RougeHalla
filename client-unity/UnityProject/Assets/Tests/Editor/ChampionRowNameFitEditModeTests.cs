using System.Reflection;
using NUnit.Framework;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-HUD-VISUAL-FIX-2 review note: the champion row NAME label (72 wide, bold) holds the longest legacy names at its smallest size, after the text-scale re-apply.</summary>
    public sealed class ChampionRowNameFitEditModeTests
    {
        GameObject _canvas, _owner; MatchHud _hud; UiTheme _saved;

        [SetUp]
        public void SetUp()
        {
            _saved = UiTheme.Current; UiTheme.Current = UiTheme.Placeholder();
            _canvas = new GameObject("row name canvas", typeof(RectTransform), typeof(Canvas));
            _owner = new GameObject("row name owner"); _hud = _owner.AddComponent<MatchHud>();
            Set("_root", _canvas.GetComponent<RectTransform>());
            Call("EnsureStage"); Call("CreateTopAndToastPills"); Call("CreateLegacyChrome"); Call("CreateCombatHud");
            Call("ApplyTextScale");
        }

        [TearDown]
        public void TearDown()
        {
            if (_canvas != null) Object.DestroyImmediate(_canvas);
            if (_owner != null) Object.DestroyImmediate(_owner);
            UiTheme.Current = _saved;
        }

        [TestCase("Dragonslayer")] [TestCase("Sentence")] [TestCase("Rat King")] [TestCase("Ice wall")] [TestCase("Radiant")]
        [TestCase("Sword hit")] [TestCase("Shield hit")] [TestCase("Fists hit")] [TestCase("Weapon hit")]
        public void TheLongestRowNameFitsItsBoxAtTheSmallestSize(string text)
        {
            var labels = (TMP_Text[])typeof(MatchHud).GetField("_championLabel", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_hud);
            foreach (var label in labels)
            {
                Assert.That(label.overflowMode, Is.Not.EqualTo(TextOverflowModes.Ellipsis));
                bool auto = label.enableAutoSizing; float size = auto ? label.fontSizeMin : label.fontSize;
                Assert.That(size, Is.GreaterThanOrEqualTo(8f));
                label.enableAutoSizing = false; label.fontSize = size; label.text = text; label.ForceMeshUpdate();
                float needed = label.GetPreferredValues(text, 0f, 0f).x;
                Assert.That(needed, Is.LessThanOrEqualTo(label.rectTransform.rect.width * .92f), text + " needs " + needed + " at " + size);
            }
        }

        void Set(string n, object v) { typeof(MatchHud).GetField(n, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(_hud, v); }
        void Call(string n) { typeof(MatchHud).GetMethod(n, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_hud, null); }
    }
}
