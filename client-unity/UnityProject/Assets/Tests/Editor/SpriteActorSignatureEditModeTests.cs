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

        [Test]
        public void DeliveredMasksUseCorrectBitsAndKeepUnknownCueSeparateFromEffects()
        {
            Present(1, 2);
            AssertSignatureBit(2, true); // burning
            AssertSignatureBit(1, false); // chilled
            AssertUnknown(false);

            Present(1, 4);
            AssertSignatureBit(2, false);
            AssertSignatureBit(4, true); // diseased
            Vector3 diseasePosition = FindRenderer(SignatureName(4)).transform.localPosition;

            Present(1, 6);
            AssertSignatureBit(2, true);
            AssertSignatureBit(4, true);
            Assert.That(FindRenderer(SignatureName(4)).transform.localPosition, Is.EqualTo(diseasePosition),
                "each signature keeps its fixed row slot as the mask changes");

            Present(1, 0);
            AssertAllSignatureCuesDisabled();

            Present(1, 16);
            AssertUnknown(true);
            AssertSignatureBit(2, false);
            Present(1, (byte)(32 | 2));
            AssertUnknown(true);
            AssertSignatureBit(2, true);
            Assert.That(FindRenderer("Unknown signature").color, Is.EqualTo((Color)ShowcasePalette.MutedText));

            Present(1, (byte)(16 | 2), (ushort)1);
            AssertSignatureBit(2, true);
            AssertUnknown(true);
            // Effects are drawn by the per-status glyphs of OverheadIndicators now (OverheadIndicatorsEditModeTests); the generic cue is off
            // and an effect bit never feeds the signature icons.
            Assert.That(FindRenderer("Public status cue").enabled, Is.False, "the generic status cue is replaced by per-status glyphs");
            Assert.That(FindRenderer("Public status bit 0").enabled, Is.False, "the generic effect bit icon is replaced by per-status glyphs");
            Assert.That(FindRenderer("Unknown signature backer").enabled, Is.True);
            Assert.That(FindRenderer(SignatureName(2)).transform.localPosition.y, Is.EqualTo(2.4f));
            Assert.That(FindRenderer("Confirmed health").transform.localPosition.y, Is.EqualTo(1.8f));
        }

        [Test]
        public void EveryKnownBitUsesItsExplicitExistingGlyphAndFixedBackedUnlitSlot()
        {
            byte[] bits = { 1, 2, 4, 8, 64 };
            string[] sprites = { "sigil3", "spark", "sigil2", "weapon0", "sigil4" };
            var seenSprites = new HashSet<Sprite>();
            for (int slot = 0; slot < bits.Length; slot++)
            {
                byte bit = bits[slot];
                Present(1, bit);
                var icon = FindRenderer(SignatureName(bit));
                var backing = FindRenderer(SignatureName(bit) + " backer");
                Assert.That(icon.enabled, Is.True, "signature bit " + bit);
                Assert.That(icon.sprite, Is.SameAs(ShowcaseSprites.Get(sprites[slot])), "explicit glyph for bit " + bit);
                Assert.That(seenSprites.Add(icon.sprite), Is.True, "known signature glyphs remain distinct");
                Assert.That(icon.sharedMaterial, Is.SameAs(ShowcaseSprites.Unlit));
                Assert.That(backing.enabled, Is.True);
                Assert.That(backing.sprite, Is.SameAs(ShowcaseSprites.Get("bar")));
                Assert.That(backing.sharedMaterial, Is.SameAs(ShowcaseSprites.Unlit));
                Assert.That(backing.color, Is.EqualTo((Color)ShowcasePalette.Panel));
                Assert.That(icon.transform.localScale, Is.EqualTo(new Vector3(.3f, .3f, 1)));
                Assert.That(backing.transform.localScale, Is.EqualTo(new Vector3(.34f, .34f, 1)));
                Assert.That(icon.transform.localPosition, Is.EqualTo(new Vector3(-.9f + slot * .36f, 2.4f, 0)));
                Assert.That(backing.transform.localPosition, Is.EqualTo(icon.transform.localPosition));
            }

            Present(1, 16);
            Assert.That(FindRenderer("Unknown signature").sprite, Is.SameAs(ShowcaseSprites.Get("rune")));
            Assert.That(FindRenderer("Unknown signature backer").enabled, Is.True);
            Assert.That(FindRenderer("Unknown signature").transform.localScale, Is.EqualTo(new Vector3(.3f, .3f, 1)));
            Assert.That(FindRenderer("Unknown signature backer").transform.localScale, Is.EqualTo(new Vector3(.34f, .34f, 1)));
            Assert.That(Vector3.Distance(FindRenderer("Unknown signature").transform.localPosition, new Vector3(.9f, 2.4f, 0)),
                Is.LessThan(.001f), "unknown slot uses the sixth fixed row position");
        }

        [Test]
        public void SignatureCuesRemainEssentialAtLowQualityAndWithReducedMotion()
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
            foreach (byte bit in new byte[] { 1, 8, 64 })
            {
                var icon = FindRenderer(SignatureName(bit));
                Assert.That(icon.enabled, Is.True, "essential signature remains visible");
                Assert.That(FindRenderer(SignatureName(bit) + " backer").enabled, Is.True);
                Assert.That(icon.sharedMaterial, Is.SameAs(ShowcaseSprites.Unlit));
            }
        }

        [Test]
        public void EvictionDeadAndPoolReuseDisableAndRefreshAllSignatureCues()
        {
            Present(41, (byte)(2 | 16));
            Transform pooledRoot = FindRoot();
            AssertSignatureBit(2, true);
            AssertUnknown(true);

            _presenter.Retain(new HashSet<uint>());
            Assert.That(pooledRoot.gameObject.activeSelf, Is.False);
            AssertAllSignatureCuesDisabled();

            Present(52, 4);
            Assert.That(FindRoot(), Is.SameAs(pooledRoot));
            Assert.That(pooledRoot.gameObject.activeSelf, Is.True);
            AssertSignatureBit(2, false);
            AssertSignatureBit(4, true);
            AssertUnknown(false);

            Present(52, (byte)(1 | 2 | 4 | 8 | 64 | 16), (ushort)0, ActorStatus.Mia);
            AssertAllSignatureCuesDisabled();
        }

        void Present(uint id, byte signature, ushort effects = 0, ActorStatus status = ActorStatus.Alive)
        {
            _presenter.Begin();
            _presenter.Present(id, 120, 120, 0, 80, FactionId.Fire, status, WeaponId.Sword,
                ActorKind.Player, null, effects, signature, false);
            _presenter.End();
        }

        SpriteRenderer FindRenderer(string name)
        {
            var actor = FindRoot();
            var child = actor.Find(name);
            Assert.That(child, Is.Not.Null, "missing presenter marker: " + name);
            return child.GetComponent<SpriteRenderer>();
        }

        Transform FindRoot()
        {
            var child = _parent.Find("Observed actor");
            Assert.That(child, Is.Not.Null);
            return child;
        }

        void AssertSignatureBit(byte bit, bool enabled)
        {
            Assert.That(FindRenderer(SignatureName(bit)).enabled, Is.EqualTo(enabled), "signature bit " + bit);
            Assert.That(FindRenderer(SignatureName(bit) + " backer").enabled, Is.EqualTo(enabled), "signature backer bit " + bit);
        }

        void AssertUnknown(bool enabled)
        {
            Assert.That(FindRenderer("Unknown signature").enabled, Is.EqualTo(enabled), "unknown-bit cue");
            Assert.That(FindRenderer("Unknown signature backer").enabled, Is.EqualTo(enabled), "unknown-bit backer");
        }

        void AssertAllSignatureCuesDisabled()
        {
            foreach (byte bit in new byte[] { 1, 2, 4, 8, 64 }) AssertSignatureBit(bit, false);
            AssertUnknown(false);
        }

        static string SignatureName(byte bit)
        {
            switch (bit)
            {
                case 1: return "Signature chilled (1)";
                case 2: return "Signature burning (2)";
                case 4: return "Signature diseased (4)";
                case 8: return "Signature execute (8)";
                case 64: return "Signature execute-blocked (64)";
                default: return "Unknown signature";
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
