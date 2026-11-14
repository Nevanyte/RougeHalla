using NUnit.Framework;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-FROST-WALL-1 oracle: the Quick cast setting (legacy 78dd8bd4 settings.ts quickCast, off by default) is stored
    /// with the other display preferences (key rh.ui.quickCast) and reset by ResetDefaults. The player's own values of every
    /// key this test touches are restored afterwards.
    /// </summary>
    public sealed class QuickCastSettingEditModeTests
    {
        const string Key = "rh.ui.quickCast";
        static readonly string[] Touched = { Key, "rh.ui.map.toggle", "rh.ui.route.visible", "rh.ui.showFps", "rh.ui.showPing" };
        readonly int?[] _saved = new int?[5];
        float? _savedScale;

        [SetUp]
        public void Save()
        {
            for (int i = 0; i < Touched.Length; i++) _saved[i] = PlayerPrefs.HasKey(Touched[i]) ? PlayerPrefs.GetInt(Touched[i]) : (int?)null;
            _savedScale = PlayerPrefs.HasKey("rh.ui.minimapScale.v2") ? PlayerPrefs.GetFloat("rh.ui.minimapScale.v2") : (float?)null;
            PlayerPrefs.DeleteKey(Key);
        }

        [TearDown]
        public void Restore()
        {
            for (int i = 0; i < Touched.Length; i++)
            {
                if (_saved[i].HasValue) PlayerPrefs.SetInt(Touched[i], _saved[i].Value); else PlayerPrefs.DeleteKey(Touched[i]);
            }
            if (_savedScale.HasValue) PlayerPrefs.SetFloat("rh.ui.minimapScale.v2", _savedScale.Value); else PlayerPrefs.DeleteKey("rh.ui.minimapScale.v2");
            PlayerPrefs.Save();
        }

        [Test]
        public void QuickCastIsOffByDefaultStoredWhenSetAndResetToOff()
        {
            var prefs = new UiDisplayPreferences();
            Assert.IsFalse(prefs.QuickCast, "off by default: the key shows the preview");
            int changed = 0; prefs.Changed += () => changed++;
            prefs.SetQuickCast(true);
            Assert.IsTrue(prefs.QuickCast);
            Assert.AreEqual(1, changed);
            Assert.AreEqual(1, PlayerPrefs.GetInt(Key, 0), "stored");
            Assert.IsTrue(new UiDisplayPreferences().QuickCast, "read back by a new instance");
            prefs.SetQuickCast(true);
            Assert.AreEqual(1, changed, "no change, no event");
            prefs.ResetDefaults();
            Assert.IsFalse(prefs.QuickCast);
            Assert.IsFalse(new UiDisplayPreferences().QuickCast);
        }
    }
}
