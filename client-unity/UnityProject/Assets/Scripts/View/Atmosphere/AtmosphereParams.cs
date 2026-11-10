using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Every continuously blended atmosphere value in one blittable struct (copy-by-value, so blending never allocates).
    /// Colours are gamma-space like the rest of the 2D pipeline.
    /// </summary>
    public struct AtmosphereParams
    {
        // Global light (multiply blend; HDR emulation scale means intensity ~0.25 is neutral, quality base is applied outside).
        public Color LightColor; public float LightScale;
        // Sun (shader globals): colour, strength 0..1 (shadow length/opacity follow it) and ambient floor.
        public Color SunColor; public float SunStrength, ShadowLength; public Color AmbientColor;
        /// <summary>Per-channel minimum of the passive (ambient + sun) light multiplier in every lit shader: no zone is ever lit by its emitters alone.</summary>
        public Color PassiveFloor;
        // Volume: colour adjustments
        public float PostExposure, Contrast, Saturation; public Color ColorFilter;
        // Volume: split toning
        public Color SplitShadows, SplitHighlights; public float SplitBalance;
        // Volume: bloom and vignette
        public float BloomThreshold, BloomIntensity, BloomScatter; public Color BloomTint;
        public float VignetteIntensity, VignetteSmoothness; public Color VignetteColor;
        // Haze overlay (alpha = strength) and the region shadow colour (contact shadows, sun shadows)
        public Color Haze, ShadowTint;

        public static AtmosphereParams Lerp(in AtmosphereParams a, in AtmosphereParams b, float t)
        {
            t = Mathf.Clamp01(t);
            AtmosphereParams o;
            o.LightColor = Color.Lerp(a.LightColor, b.LightColor, t); o.LightScale = Mathf.Lerp(a.LightScale, b.LightScale, t);
            o.SunColor = Color.Lerp(a.SunColor, b.SunColor, t); o.SunStrength = Mathf.Lerp(a.SunStrength, b.SunStrength, t); o.ShadowLength = Mathf.Lerp(a.ShadowLength, b.ShadowLength, t);
            o.AmbientColor = Color.Lerp(a.AmbientColor, b.AmbientColor, t); o.PassiveFloor = Color.Lerp(a.PassiveFloor, b.PassiveFloor, t);
            o.PostExposure = Mathf.Lerp(a.PostExposure, b.PostExposure, t); o.Contrast = Mathf.Lerp(a.Contrast, b.Contrast, t);
            o.Saturation = Mathf.Lerp(a.Saturation, b.Saturation, t); o.ColorFilter = Color.Lerp(a.ColorFilter, b.ColorFilter, t);
            o.SplitShadows = Color.Lerp(a.SplitShadows, b.SplitShadows, t); o.SplitHighlights = Color.Lerp(a.SplitHighlights, b.SplitHighlights, t);
            o.SplitBalance = Mathf.Lerp(a.SplitBalance, b.SplitBalance, t);
            o.BloomThreshold = Mathf.Lerp(a.BloomThreshold, b.BloomThreshold, t); o.BloomIntensity = Mathf.Lerp(a.BloomIntensity, b.BloomIntensity, t);
            o.BloomScatter = Mathf.Lerp(a.BloomScatter, b.BloomScatter, t); o.BloomTint = Color.Lerp(a.BloomTint, b.BloomTint, t);
            o.VignetteIntensity = Mathf.Lerp(a.VignetteIntensity, b.VignetteIntensity, t);
            o.VignetteSmoothness = Mathf.Lerp(a.VignetteSmoothness, b.VignetteSmoothness, t);
            o.VignetteColor = Color.Lerp(a.VignetteColor, b.VignetteColor, t);
            o.Haze = Color.Lerp(a.Haze, b.Haze, t); o.ShadowTint = Color.Lerp(a.ShadowTint, b.ShadowTint, t);
            return o;
        }
    }

    /// <summary>The passive-light maths the lit shaders mirror (RhSun.hlsl): ambient plus sun, never below the region's floor. Independent of every emitter and every effect toggle.</summary>
    public static class AtmosphereLighting
    {
        /// <summary>No region's passive floor may be lower than this (relative to a neutral 1.0 multiplier).</summary>
        public const float GlobalMinFloor = .34f;
        /// <summary>Single number for the passive (ambient + sun) light level on flat ground with no emitter: luminance of <see cref="Passive"/> at the flat-ground sun factor.</summary>
        public static float Level(in AtmosphereParams p)
        {
            var m = Passive(p, FlatNdl); return .2126f * m.r + .7152f * m.g + .0722f * m.b;
        }
        public const float FlatNdl = .65f;
        public static Color Passive(in AtmosphereParams p, float ndl)
        {
            var sun = p.SunColor * (p.SunStrength * Mathf.Clamp01(ndl));
            return new Color(Mathf.Max(p.AmbientColor.r + sun.r, p.PassiveFloor.r), Mathf.Max(p.AmbientColor.g + sun.g, p.PassiveFloor.g), Mathf.Max(p.AmbientColor.b + sun.b, p.PassiveFloor.b), 1f);
        }
    }

    /// <summary>Smooth transition between two <see cref="AtmosphereParams"/>. Interrupting a blend restarts from the current value.</summary>
    public sealed class AtmosphereBlender
    {
        public const float DefaultSeconds = 1.5f;
        AtmosphereParams _from, _to, _cur; float _t = 1f, _dur = DefaultSeconds;
        public AtmosphereParams Current { get { return _cur; } }
        public bool Blending { get { return _t < 1f; } }
        public float Progress { get { return _t; } }
        public void Snap(in AtmosphereParams p) { _from = _to = _cur = p; _t = 1f; }
        public void BlendTo(in AtmosphereParams p, float seconds = DefaultSeconds)
        {
            _from = _cur; _to = p; _t = 0f; _dur = Mathf.Max(.0001f, seconds);
        }
        /// <summary>Advance by dt seconds; true when <see cref="Current"/> changed.</summary>
        public bool Tick(float dt)
        {
            if (_t >= 1f) return false;
            _t = Mathf.Min(1f, _t + Mathf.Max(0f, dt) / _dur);
            _cur = AtmosphereParams.Lerp(_from, _to, Ease(_t));
            return true;
        }
        /// <summary>Smootherstep: zero slope at both ends so a border crossing never lurches.</summary>
        public static float Ease(float t) { t = Mathf.Clamp01(t); return t * t * t * (t * (t * 6f - 15f) + 10f); }
    }
}
