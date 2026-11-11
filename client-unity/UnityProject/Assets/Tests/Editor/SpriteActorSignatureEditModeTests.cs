using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    public sealed class SpriteActorSignatureEditModeTests
    {
        const string QualityModeKey = "roguehalla.showcase.qualityMode";
        const string ManualQualityKey = "roguehalla.showcase.manualQuality";
        const string ReducedMotionKey = "roguehalla.showcase.reducedMotion";
        readonly List<GameObject> _objects = new List<GameObject>();
        bool _hadQualityMode, _hadManualQuality, _hadReducedMotion;
        int _previousQualityMode, _previousManualQuality, _previousReducedMotion;
        ShowcaseSettings _previousSettings;
        ShowcaseQualityMode _previousSettingsMode;
        ShowcaseQuality _previousSettingsQuality;
        bool _previousSettingsReducedMotion;
        SpriteActorPresenter _presenter;
        Transform _parent;

        [SetUp]
        public void SetUp()
        {
            _hadQualityMode = PlayerPrefs.HasKey(QualityModeKey);
            _hadManualQuality = PlayerPrefs.HasKey(ManualQualityKey);
            _hadReducedMotion = PlayerPrefs.HasKey(ReducedMotionKey);
            _previousQualityMode = PlayerPrefs.GetInt(QualityModeKey);
            _previousManualQuality = PlayerPrefs.GetInt(ManualQualityKey);
            _previousReducedMotion = PlayerPrefs.GetInt(ReducedMotionKey);
            _previousSettings = ShowcaseSettings.Current;
            if (_previousSettings != null)
            {
                _previousSettingsMode = _previousSettings.QualityMode;
                _previousSettingsQuality = _previousSettings.ManualQuality;
                _previousSettingsReducedMotion = _previousSettings.ReducedMotion;
            }
            var parent = new GameObject("signature presenter test");
            _objects.Add(parent);
            _parent = parent.transform;
            _presenter = new SpriteActorPresenter(_parent, null);
        }

        [TearDown]
        public void TearDown()
        {
            if (_previousSettings != null)
            {
                SetPrivateField(_previousSettings, "_qualityMode", _previousSettingsMode);
                SetPrivateField(_previousSettings, "_manualQuality", _previousSettingsQuality);
                SetPrivateField(_previousSettings, "_reducedMotion", _previousSettingsReducedMotion);
            }
            for (int i = _objects.Count - 1; i >= 0; i--)
                if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
            RestorePreference(QualityModeKey, _hadQualityMode, _previousQualityMode);
            RestorePreference(ManualQualityKey, _hadManualQuality, _previousManualQuality);
            RestorePreference(ReducedMotionKey, _hadReducedMotion, _previousReducedMotion);
            PlayerPrefs.Save();
        }

        static readonly string[] RemovedSignatureNames =
        {
            "Signature chilled (1)", "Signature burning (2)", "Signature diseased (4)", "Signature execute (8)", "Signature execute-blocked (64)", "Unknown signature",
        };

        [Test]
        public void NoSignatureIconRowIsBuiltForAnyMask()
        {
            // Legacy draws no signature icon row; taxed and suppressed are text cues (OverheadExtras), and effects are per-status glyphs.
            foreach (byte mask in new byte[] { 0, 1, 2, 4, 8, 64, 128, (byte)(1 | 2 | 4 | 8 | 64 | 128) })
            {
                Present(1, mask);
                AssertNoSignatureIcons();
            }
            Present(1, (byte)(128 | 2), (ushort)1);
            AssertNoSignatureIcons();
            Assert.That(FindRoot().Find("Public status cue").GetComponent<SpriteRenderer>().enabled, Is.False, "the generic status cue is replaced by per-status glyphs");
            Assert.That(FindRoot().Find("Public status bit 0").GetComponent<SpriteRenderer>().enabled, Is.False, "the generic effect bit icon is replaced by per-status glyphs");
            Assert.That(FindRoot().Find("Confirmed health").localPosition.y, Is.EqualTo(1.8f).Within(.0001f), "the hp bar keeps its place");
        }

        [Test]
        public void NoSignatureIconAtLowQualityWithReducedMotion()
        {
            PlayerPrefs.SetInt(QualityModeKey, 1);
            PlayerPrefs.SetInt(ManualQualityKey, (int)ShowcaseQuality.Low);
            PlayerPrefs.SetInt(ReducedMotionKey, 1);
            ShowcaseSettings settings = _previousSettings;
            if (settings == null)
            {
                var settingsObject = new GameObject("signature settings");
                _objects.Add(settingsObject);
                settings = settingsObject.AddComponent<ShowcaseSettings>();
                InvokeAwake(settings);
            }
            else
            {
                SetPrivateField(settings, "_qualityMode", ShowcaseQualityMode.Manual);
                SetPrivateField(settings, "_manualQuality", ShowcaseQuality.Low);
                SetPrivateField(settings, "_reducedMotion", true);
            }
            Assert.That(settings.EffectiveQuality, Is.EqualTo(ShowcaseQuality.Low));
            Assert.That(settings.ReducedMotion, Is.True);

            Present(1, (byte)(1 | 8 | 64));
            AssertNoSignatureIcons();
        }

        [Test]
        public void EvictionAndPoolReuseStillWorkWithoutSignatureIcons()
        {
            Present(41, (byte)(2 | 128));
            Transform pooledRoot = FindRoot();
            AssertNoSignatureIcons();

            _presenter.Retain(new HashSet<uint>());
            Assert.That(pooledRoot.gameObject.activeSelf, Is.False);

            Present(52, 4);
            Assert.That(FindRoot(), Is.SameAs(pooledRoot));
            Assert.That(pooledRoot.gameObject.activeSelf, Is.True);
            AssertNoSignatureIcons();
        }

        void Present(uint id, byte signature, ushort effects = 0, ActorStatus status = ActorStatus.Alive)
        {
            _presenter.Begin();
            _presenter.Present(id, 120, 120, 0, 80, FactionId.Fire, status, WeaponId.Sword,
                ActorKind.Player, null, effects, signature, false);
            _presenter.End();
        }

        Transform FindRoot()
        {
            var child = _parent.Find("Observed actor");
            Assert.That(child, Is.Not.Null);
            return child;
        }

        void AssertNoSignatureIcons()
        {
            var actor = FindRoot();
            foreach (var name in RemovedSignatureNames)
            {
                Assert.That(actor.Find(name), Is.Null, name + " is not built");
                Assert.That(actor.Find(name + " backer"), Is.Null, name + " backer is not built");
            }
        }

        static void InvokeAwake(MonoBehaviour component)
        {
            component.GetType().GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(component, null);
        }

        static void SetPrivateField(object target, string fieldName, object value)
        {
            target.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(target, value);
        }

        static void RestorePreference(string key, bool hadKey, int value)
        {
            if (hadKey) PlayerPrefs.SetInt(key, value);
            else PlayerPrefs.DeleteKey(key);
        }
    }
}
