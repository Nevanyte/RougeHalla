using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using UnityEngine.TestTools;

namespace Roguehalla.Client.Tests
{
    public sealed class ShowcasePointLightEditModeTests
    {
        const string QualityModeKey = "roguehalla.showcase.qualityMode";
        const string ManualQualityKey = "roguehalla.showcase.manualQuality";
        const BindingFlags InstancePrivate = BindingFlags.Instance | BindingFlags.NonPublic;
        const BindingFlags StaticPrivate = BindingFlags.Static | BindingFlags.NonPublic;

        readonly List<GameObject> _objects = new List<GameObject>();
        bool _hadQualityMode, _hadManualQuality;
        int _previousQualityMode, _previousManualQuality;
        bool _previousReportedUnavailable;
        ShowcaseSettings _previousSettings;

        [SetUp]
        public void SetUp()
        {
            _hadQualityMode = PlayerPrefs.HasKey(QualityModeKey);
            _hadManualQuality = PlayerPrefs.HasKey(ManualQualityKey);
            _previousQualityMode = PlayerPrefs.GetInt(QualityModeKey);
            _previousManualQuality = PlayerPrefs.GetInt(ManualQualityKey);
            _previousSettings = ShowcaseSettings.Current;
            var diagnostic = typeof(ShowcasePointLight).GetField("_reportedUnavailable", StaticPrivate);
            _previousReportedUnavailable = (bool)diagnostic.GetValue(null);
            diagnostic.SetValue(null, false);
        }

        [TearDown]
        public void TearDown()
        {
            for (int i = _objects.Count - 1; i >= 0; i--)
                if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
            _objects.Clear();

            typeof(ShowcaseSettings).GetField("_current", StaticPrivate).SetValue(null, _previousSettings);
            typeof(ShowcasePointLight).GetField("_reportedUnavailable", StaticPrivate).SetValue(null, _previousReportedUnavailable);
            RestorePreference(QualityModeKey, _hadQualityMode, _previousQualityMode);
            RestorePreference(ManualQualityKey, _hadManualQuality, _previousManualQuality);
            PlayerPrefs.Save();
        }

        [Test]
        public void TorchResourcesAreValidDisabledPresetsWithExpectedNormalMapDistance()
        {
            GameObject disabled = Resources.Load<GameObject>("Showcase/Torch");
            GameObject accurate = Resources.Load<GameObject>("Showcase/TorchAccurate");

            Assert.That(disabled, Is.Not.Null);
            Assert.That(accurate, Is.Not.Null);
            Assert.That(ShowcasePointLight.ValidatePresets(disabled, accurate, out string reason), Is.True, reason);
            AssertPresetIsSafe(disabled);
            AssertPresetIsSafe(accurate);
            Assert.That(GetPresetLight(disabled.GetComponent<Light2D>()).normalMapQuality, Is.EqualTo(Light2D.NormalMapQuality.Disabled));
            Assert.That(GetPresetLight(accurate.GetComponent<Light2D>()).normalMapQuality, Is.EqualTo(Light2D.NormalMapQuality.Accurate));
        }

        [Test]
        public void MissingOrDuplicatedPresetFailsValidationWithoutEnablingAnyResourceLight()
        {
            GameObject disabled = Resources.Load<GameObject>("Showcase/Torch");
            GameObject accurate = Resources.Load<GameObject>("Showcase/TorchAccurate");

            Assert.That(ShowcasePointLight.ValidatePresets(null, accurate, out string missingReason), Is.False);
            Assert.That(missingReason, Is.Not.Empty);
            Assert.That(ShowcasePointLight.ValidatePresets(accurate, accurate, out string duplicatedReason), Is.False,
                "the disabled preset cannot accidentally point at the accurate asset");
            Assert.That(duplicatedReason, Is.Not.Empty);
            AssertPresetIsSafe(disabled);
            AssertPresetIsSafe(accurate);

            var root = CreateObject("invalid preset owner");
            var helper = root.AddComponent<ShowcasePointLight>();
            LogAssert.Expect(LogType.Warning, "Optional showcase point lighting unavailable: both Torch and TorchAccurate point-light resources are required");
            helper.Initialize(null, accurate);
            helper.Configure(Color.white, 2.3f, .3f, 4.8f, .6f, true);
            helper.SetVisible(true);
            Assert.That(helper.IsConfigured, Is.False);
            Assert.That(helper.AccurateVariant, Is.Null);
            Assert.That(helper.DisabledVariant, Is.Null);
            Assert.That(CountEnabledLights(helper), Is.Zero, "a missing preset must not produce an enabled light");

            var duplicatedRoot = CreateObject("duplicated preset owner");
            var duplicatedHelper = duplicatedRoot.AddComponent<ShowcasePointLight>();
            duplicatedHelper.Initialize(accurate, accurate);
            duplicatedHelper.Configure(Color.white, 2.3f, .3f, 4.8f, .6f, true);
            duplicatedHelper.SetVisible(true);
            Assert.That(duplicatedHelper.IsConfigured, Is.False);
            Assert.That(CountEnabledLights(duplicatedHelper), Is.Zero,
                "using the accurate preset for both branches must not leave an enabled light");
        }

        [Test]
        public void ConfiguredVariantsShareRequestedLightSettingsAndOnlyOneIsVisible()
        {
            var root = CreateObject("preset owner");
            var helper = root.AddComponent<ShowcasePointLight>();
            helper.Initialize(Resources.Load<GameObject>("Showcase/Torch"), Resources.Load<GameObject>("Showcase/TorchAccurate"));
            Color tint = new Color(.31f, .72f, .88f, 1f);
            helper.Configure(tint, 2.3f, .3f, 4.8f, .6f, true);
            helper.SetShadows(true);

            Assert.That(helper.IsConfigured, Is.True);
            Assert.That(helper.RequestedVisible, Is.False);
            Assert.That(helper.DisabledVariant, Is.Not.Null);
            Assert.That(helper.AccurateVariant, Is.Not.Null);
            AssertLightsMatch(helper.DisabledVariant, tint, 2.3f, .3f, 4.8f, .6f, true);
            AssertLightsMatch(helper.AccurateVariant, tint, 2.3f, .3f, 4.8f, .6f, true);

            helper.SetVisible(true);
            Assert.That(helper.RequestedVisible, Is.True);
            Assert.That(helper.DisabledVariant.enabled ^ helper.AccurateVariant.enabled, Is.True,
                "the low cost and accurate light components must not both be enabled");
            Assert.That(CountEnabledLights(helper), Is.EqualTo(1));

            helper.SetVisible(false);
            Assert.That(helper.DisabledVariant.enabled, Is.False);
            Assert.That(helper.AccurateVariant.enabled, Is.False);
            Assert.That(CountEnabledLights(helper), Is.Zero);
        }

        [Test]
        public void NearbyArenaTorchesRespectHighMediumLowAndHighBudgetsAndLocalAccentIsHighOnly()
        {
            var settings = CreateSettings(ShowcaseQuality.High);
            var arena = CreateArena();
            arena.Build(CreateArena16x16BoundaryMap());
            var cameraObject = CreateObject("torch budget camera");
            var camera = cameraObject.AddComponent<Camera>();
            var torches = FindStaticTorches(arena.transform);

            Assert.That(torches.Count, Is.GreaterThanOrEqualTo(6), "the authored boundary map exposes enough static torch anchors for the budget");
            arena.Follow(camera, 256, 256);
            Assert.That(CountEnabledLights(torches), Is.EqualTo(6), "high quality activates six nearby torch anchors");
            Assert.That(CountEnabledAccurateLights(torches), Is.EqualTo(6));
            Assert.That(CountEnabledDisabledLights(torches), Is.Zero);
            AssertVariantShadows(torches, true);

            settings.CycleQuality(); // manual High -> Medium
            arena.Follow(camera, 256, 256);
            Assert.That(settings.EffectiveQuality, Is.EqualTo(ShowcaseQuality.Medium));
            Assert.That(CountEnabledLights(torches), Is.EqualTo(3));
            Assert.That(CountEnabledAccurateLights(torches), Is.Zero);
            Assert.That(CountEnabledDisabledLights(torches), Is.EqualTo(3));
            AssertVariantShadows(torches, false);

            settings.CycleQuality(); // Medium -> Low
            arena.Follow(camera, 256, 256);
            Assert.That(settings.EffectiveQuality, Is.EqualTo(ShowcaseQuality.Low));
            Assert.That(CountEnabledLights(torches), Is.Zero);
            AssertVariantShadows(torches, false);

            settings.CycleQuality(); // Low -> Adaptive, still at the last effective tier.
            settings.CycleQuality(); // Adaptive -> manual Ultra
            Assert.That(settings.EffectiveQuality, Is.EqualTo(ShowcaseQuality.Ultra));
            settings.CycleQuality(); // Ultra -> manual High
            arena.Follow(camera, 256, 256);
            Assert.That(settings.EffectiveQuality, Is.EqualTo(ShowcaseQuality.High));
            Assert.That(CountEnabledLights(torches), Is.EqualTo(6));
            Assert.That(CountEnabledAccurateLights(torches), Is.EqualTo(6));
            Assert.That(CountEnabledDisabledLights(torches), Is.Zero);
            AssertVariantShadows(torches, true);

            var me = new SelfView { Id = 903, X = 256, Y = 256, Hp = 100, MaxHp = 100, Status = ActorStatus.Alive };
            arena.Present(new List<InterpActor>(), me, null, 0);
            Transform actorRoot = FindDirectChild(arena.transform, "Observed actor");
            Assert.That(actorRoot, Is.Not.Null);
            var accent = actorRoot.GetComponentInChildren<ShowcasePointLight>(true);
            Assert.That(accent, Is.Not.Null);
            Assert.That(accent.RequestedVisible, Is.True);
            Assert.That(CountEnabledLights(accent), Is.EqualTo(1), "the local accent is enabled at high quality");

            settings.CycleQuality(); // manual High -> Medium
            arena.Present(new List<InterpActor>(), me, null, 0);
            Assert.That(accent.RequestedVisible, Is.True, "quality changes do not discard the local visibility request");
            Assert.That(CountEnabledLights(accent), Is.Zero, "the local accent is reserved for high quality");

            settings.CycleQuality(); // Medium -> Low
            arena.Present(new List<InterpActor>(), me, null, 0);
            Assert.That(CountEnabledLights(accent), Is.Zero);

            arena.Present(new List<InterpActor>(), null, null, 0);
            Assert.That(actorRoot.gameObject.activeSelf, Is.False);
            Assert.That(accent.RequestedVisible, Is.False);
            Assert.That(CountEnabledLights(accent), Is.Zero, "a pooled actor must not leave either light variant enabled");
        }

        ShowcaseSettings CreateSettings(ShowcaseQuality quality)
        {
            typeof(ShowcaseSettings).GetField("_current", StaticPrivate).SetValue(null, null);
            PlayerPrefs.SetInt(QualityModeKey, (int)ShowcaseQualityMode.Manual);
            PlayerPrefs.SetInt(ManualQualityKey, (int)quality);
            var settingsObject = CreateObject("test showcase settings");
            var settings = settingsObject.AddComponent<ShowcaseSettings>();
            InvokeAwake(settings);
            return settings;
        }

        ArenaView CreateArena()
        {
            var arenaObject = CreateObject("test torch arena");
            var arena = arenaObject.AddComponent<ArenaView>();
            InvokeAwake(arena);
            return arena;
        }

        GameObject CreateObject(string name)
        {
            var value = new GameObject(name);
            _objects.Add(value);
            return value;
        }

        static MapBlob CreateArena16x16BoundaryMap()
        {
            const ushort width = 16, height = 16;
            var tiles = new byte[width * height];
            // A closed arena boundary around an open interior gives the presentation more
            // nearby anchors than the per-tier budget, without inventing a test-only scene.
            for (int x = 0; x < width; x++)
            {
                tiles[x] = MapBlob.Wall;
                tiles[(height - 1) * width + x] = MapBlob.Wall;
            }
            for (int y = 0; y < height; y++)
            {
                tiles[y * width] = MapBlob.Wall;
                tiles[y * width + width - 1] = MapBlob.Wall;
            }
            return new MapBlob(width, height, tiles);
        }

        static List<ShowcasePointLight> FindStaticTorches(Transform root)
        {
            var result = new List<ShowcasePointLight>();
            foreach (var helper in root.GetComponentsInChildren<ShowcasePointLight>(true))
                if (helper.gameObject.name == "Static torch light") result.Add(helper);
            return result;
        }

        static int CountEnabledLights(ShowcasePointLight helper)
        {
            int count = 0;
            if (helper == null) return count;
            foreach (var light in helper.GetComponentsInChildren<Light2D>(true))
                if (light.enabled && light.gameObject.activeInHierarchy) count++;
            return count;
        }

        static int CountEnabledLights(List<ShowcasePointLight> helpers)
        {
            int count = 0;
            foreach (var helper in helpers) count += CountEnabledLights(helper);
            return count;
        }

        static int CountEnabledAccurateLights(List<ShowcasePointLight> helpers)
        {
            int count = 0;
            foreach (var helper in helpers)
                if (helper.AccurateVariant.enabled && helper.AccurateVariant.gameObject.activeInHierarchy) count++;
            return count;
        }

        static int CountEnabledDisabledLights(List<ShowcasePointLight> helpers)
        {
            int count = 0;
            foreach (var helper in helpers)
                if (helper.DisabledVariant.enabled && helper.DisabledVariant.gameObject.activeInHierarchy) count++;
            return count;
        }

        static void AssertVariantShadows(List<ShowcasePointLight> helpers, bool expected)
        {
            foreach (var helper in helpers)
            {
                Assert.That(helper.AccurateVariant.shadowsEnabled, Is.EqualTo(expected));
                Assert.That(helper.DisabledVariant.shadowsEnabled, Is.EqualTo(expected));
            }
        }

        static void AssertPresetIsSafe(GameObject preset)
        {
            Assert.That(preset, Is.Not.Null);
            var lights = preset.GetComponentsInChildren<Light2D>(true);
            Assert.That(lights, Is.Not.Empty);
            foreach (var light in lights)
            {
                Assert.That(light.enabled, Is.False, preset.name + " must not enable a light in its authored prefab");
                Assert.That(light.normalMapDistance, Is.EqualTo(.4f).Within(.001f));
            }
        }

        static Light2D GetPresetLight(Light2D variant)
        {
            Assert.That(variant, Is.Not.Null);
            return variant;
        }

        static void AssertLightsMatch(Light2D variant, Color color, float intensity, float inner, float outer, float falloff, bool shadows)
        {
            Light2D light = GetPresetLight(variant);
            Assert.That(light.color, Is.EqualTo(color));
            Assert.That(light.intensity, Is.EqualTo(intensity).Within(.001f));
            Assert.That(light.pointLightInnerRadius, Is.EqualTo(inner).Within(.001f));
            Assert.That(light.pointLightOuterRadius, Is.EqualTo(outer).Within(.001f));
            Assert.That(light.falloffIntensity, Is.EqualTo(falloff).Within(.001f));
            Assert.That(light.shadowsEnabled, Is.EqualTo(shadows));
        }

        static void InvokeAwake(MonoBehaviour component)
        {
            component.GetType().GetMethod("Awake", InstancePrivate).Invoke(component, null);
        }

        static void RestorePreference(string key, bool hadKey, int value)
        {
            if (hadKey) PlayerPrefs.SetInt(key, value);
            else PlayerPrefs.DeleteKey(key);
        }

        static Transform FindDirectChild(Transform parent, string name)
        {
            if (parent == null) return null;
            for (int i = 0; i < parent.childCount; i++)
                if (parent.GetChild(i).name == name) return parent.GetChild(i);
            return null;
        }
    }
}
