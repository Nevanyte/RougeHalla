using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Roguehalla.Client
{
    /// <summary>One optional light anchor with mutually exclusive, authored URP normal-quality variants.</summary>
    [DisallowMultipleComponent]
    public sealed class ShowcasePointLight : MonoBehaviour
    {
        Light2D _accurate, _disabled;
        ShowcaseSettings _settings;
        bool _visible, _highOnly, _configured;
        static bool _reportedUnavailable;

        public bool IsConfigured { get { return _configured; } }
        public bool RequestedVisible { get { return _visible; } }
        public Light2D AccurateVariant { get { return _accurate; } }
        public Light2D DisabledVariant { get { return _disabled; } }

        public static bool ValidatePresets(GameObject disabled, GameObject accurate, out string reason)
        {
            var low = disabled != null ? disabled.GetComponent<Light2D>() : null;
            var high = accurate != null ? accurate.GetComponent<Light2D>() : null;
            if (low == null || high == null) { reason = "both Torch and TorchAccurate point-light resources are required"; return false; }
            if (low.lightType != Light2D.LightType.Point || high.lightType != Light2D.LightType.Point ||
                low.normalMapQuality != Light2D.NormalMapQuality.Disabled || high.normalMapQuality != Light2D.NormalMapQuality.Accurate ||
                !Mathf.Approximately(low.normalMapDistance, .4f) || !Mathf.Approximately(high.normalMapDistance, .4f) ||
                low.enabled || high.enabled)
            { reason = "Torch presets must be disabled point components with Disabled/Accurate normals at distance .4"; return false; }
            reason = null; return true;
        }

        // The caller creates this owner inactive, so an authored component can never briefly light the scene.
        public void Initialize(GameObject disabled, GameObject accurate)
        {
            if (!ValidatePresets(disabled, accurate, out string reason))
            {
                if (!_reportedUnavailable) { _reportedUnavailable = true; Debug.LogWarning("Optional showcase point lighting unavailable: " + reason); }
                return;
            }
            _disabled = Instantiate(disabled, transform, false).GetComponent<Light2D>();
            _accurate = Instantiate(accurate, transform, false).GetComponent<Light2D>();
            _disabled.enabled = _accurate.enabled = false;
        }

        public void Configure(Color color, float intensity, float innerRadius, float outerRadius, float falloff, bool shadows, bool highOnly = false)
        {
            _highOnly = highOnly;
            if (_disabled == null || _accurate == null) return;
            ConfigureVariant(_disabled, color, intensity, innerRadius, outerRadius, falloff, shadows);
            ConfigureVariant(_accurate, color, intensity, innerRadius, outerRadius, falloff, shadows);
            _configured = true;
            ApplyQuality();
        }

        static void ConfigureVariant(Light2D light, Color color, float intensity, float inner, float outer, float falloff, bool shadows)
        {
            light.color = color; light.intensity = intensity;
            light.pointLightInnerRadius = inner; light.pointLightOuterRadius = outer;
            light.falloffIntensity = falloff; light.shadowsEnabled = shadows;
        }

        public void SetShadows(bool shadows)
        {
            if (_disabled != null) _disabled.shadowsEnabled = shadows;
            if (_accurate != null) _accurate.shadowsEnabled = shadows;
        }

        public void SetVisible(bool visible) { _visible = visible; ApplyQuality(); }

        public void ApplyQuality()
        {
            var quality = ShowcaseSettings.Current != null ? ShowcaseSettings.Current.EffectiveQuality : ShowcaseQuality.High;
            bool show = _configured && _visible && isActiveAndEnabled && (!_highOnly || quality >= ShowcaseQuality.High);
            bool high = show && quality >= ShowcaseQuality.High;
            // Disable the old variant before enabling the new one; never two active lights at one anchor.
            if (!high && _accurate != null) _accurate.enabled = false;
            if ((!show || high) && _disabled != null) _disabled.enabled = false;
            if (high && _accurate != null) _accurate.enabled = true;
            else if (show && _disabled != null) _disabled.enabled = true;
        }

        void OnEnable()
        {
            _settings = ShowcaseSettings.Current;
            if (_settings != null) _settings.Changed += ApplyQuality;
            ApplyQuality();
        }

        void OnDisable()
        {
            if (_settings != null) _settings.Changed -= ApplyQuality;
            _settings = null;
            if (_accurate != null) _accurate.enabled = false;
            if (_disabled != null) _disabled.enabled = false;
        }
    }
}
