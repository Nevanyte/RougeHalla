using System;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Small static switchboard for every region-atmosphere effect (lighting accents, post-processing, haze, screen particles,
    /// streamed audio). Plain fields so a quality preset (Low/Medium/High today, an Ultra preset later) can toggle each effect.
    ///
    /// Defaults follow the current <see cref="ShowcaseSettings"/> preset through its public members only
    /// (<c>EffectiveQuality</c>, <c>ReducedMotion</c>); <see cref="Apply"/> is the entry point a future Quality API calls.
    /// URL query overrides always win over a preset: <c>?fx.particles=0</c> (density multiplier, 0 off), <c>?fx.lights=0</c>
    /// (accent light cap, 0 off), <c>?fx.post=0</c>, <c>?fx.bloom=0</c>, <c>?fx.grading=0</c>, <c>?fx.vignette=0</c>,
    /// <c>?fx.haze=0</c>, <c>?fx.audio=0</c>, <c>?fx.sun=0</c>, <c>?fx.shadows=0</c>, <c>?fx.ice=0</c>, <c>?fx.shimmer=0</c>, <c>?fx.brightness=0.9</c>, <c>?fx.rays=0</c>. Presentation only: nothing here reads or changes game state.
    /// </summary>
    public static class AtmosphereQuality
    {
        /// <summary>Hard ceiling for any density multiplier, so a query string cannot ask for unbounded particles.</summary>
        public const float MaxParticleDensity = 1.5f;
        /// <summary>Hard ceiling for simultaneously active accent point lights, whatever a preset asks for.</summary>
        public const int HardMaxLights = 6;

        /// <summary>Multiplier on every screen-particle layer's emission rate and particle cap. 0 disables screen particles.</summary>
        public static float ParticleDensity = 1f;
        /// <summary>Region accent point lights (lava glow, ice glints) may be active at all.</summary>
        public static bool DynamicLights = true;
        /// <summary>Cap on simultaneously active accent lights (the static torch lamps keep their own budget in ArenaView).</summary>
        public static int MaxDynamicLights = 4;
        /// <summary>Master switch for the global volume (grading, bloom and vignette all live on it).</summary>
        public static bool PostProcessing = true;
        public static bool Bloom = true;
        /// <summary>Colour adjustments and split toning from the region table.</summary>
        public static bool Grading = true;
        public static bool Vignette = true;
        /// <summary>The soft full-screen haze sprites.</summary>
        public static bool Haze = true;
        /// <summary>Streamed per-region music and ambience.</summary>
        public static bool Audio = true;
        /// <summary>The one-sun term in the ground, wall and prop shaders (per-pixel regional sun colour and strength).</summary>
        public static bool SunLighting = true;
        /// <summary>Baked wall/prop cast shadows on the ground and the sun-directed actor shadows.</summary>
        public static bool Shadows = true;
        /// <summary>Lake-ice translucency (darker layer beneath, sheen, glints) in the ground shader.</summary>
        public static bool IceTranslucency = true;
        /// <summary>Heat shimmer over lava in the ground shader.</summary>
        public static bool HeatShimmer = true;
        /// <summary>Light shafts (god rays) in Holy and Plague: cheap pre-baked soft quads aligned with the one sun direction. Off for reduced motion with the other particles.</summary>
        public static bool Rays = true;
        /// <summary>Single world-brightness scalar (1 = as authored): multiplies the global light, so ground, walls, props and actors move together. Clamped 0.4 to 1.6; <c>?fx.brightness=0.9</c>, <c>?fx.rays=0</c>.</summary>
        public static float WorldBrightness = 1f;
        public const float MinBrightness = .4f, MaxBrightness = 1.6f;

        /// <summary>Raised after any change made through this class, so effects re-read the switchboard (not per frame).</summary>
        public static event Action Changed;

        static float? _ovParticles; static int? _ovLights; static float? _ovBrightness; static bool? _ovRays; static bool? _ovPost, _ovBloom, _ovGrading, _ovVignette, _ovHaze, _ovAudio, _ovSun, _ovShadows, _ovIce, _ovShimmer;

        public static int EffectiveMaxLights { get { return DynamicLights ? Mathf.Clamp(MaxDynamicLights, 0, HardMaxLights) : 0; } }
        public static bool ParticlesEnabled { get { return ParticleDensity > .001f; } }

        /// <summary>Replace every field at once, then re-apply query overrides and notify. The future Quality API calls this.</summary>
        public static void Apply(float particleDensity, bool dynamicLights, int maxLights, bool post, bool bloom, bool grading, bool vignette, bool haze = true, bool audio = true,
            bool sun = true, bool shadows = true, bool ice = true, bool shimmer = true, bool rays = true)
        {
            ParticleDensity = Mathf.Clamp(particleDensity, 0f, MaxParticleDensity);
            DynamicLights = dynamicLights; MaxDynamicLights = Mathf.Clamp(maxLights, 0, HardMaxLights);
            PostProcessing = post; Bloom = bloom; Grading = grading; Vignette = vignette; Haze = haze; Audio = audio;
            SunLighting = sun; Shadows = shadows; IceTranslucency = ice; HeatShimmer = shimmer; Rays = rays;
            ApplyOverrides();
            Raise();
        }

        /// <summary>Preset values for the three existing quality levels. Reduced motion switches screen particles off.</summary>
        public static void ApplyPreset(ShowcaseQuality quality, bool reducedMotion)
        {
            switch (quality)
            {
                case ShowcaseQuality.Low:
                    Apply(0f, false, 0, false, false, false, false, haze: false, audio: true, ice: false, shimmer: false); break;
                case ShowcaseQuality.Medium:
                    Apply(reducedMotion ? 0f : .55f, true, 2, true, true, true, false, ice: true, shimmer: false); break;
                default:
                    Apply(reducedMotion ? 0f : 1f, true, 4, true, true, true, true); break;
            }
        }

        /// <summary>Re-derive the defaults from <see cref="ShowcaseSettings.Current"/> (High when there is none).</summary>
        public static void RefreshFromSettings()
        {
            var s = ShowcaseSettings.Current;
            ApplyPreset(s != null ? s.EffectiveQuality : ShowcaseQuality.High, s != null && s.ReducedMotion);
        }

        /// <summary>Parse <c>fx.*</c> query overrides from a page URL (empty or null clears them) and re-apply.</summary>
        public static void SetUrl(string url)
        {
            _ovParticles = null; _ovLights = null; _ovBrightness = null; _ovRays = null; _ovPost = _ovBloom = _ovGrading = _ovVignette = _ovHaze = _ovAudio = _ovSun = _ovShadows = _ovIce = _ovShimmer = null;
            ParseOverrides(url);
            ApplyOverrides();
            Raise();
        }

        /// <summary>Pure query parser: fills the override slots. Unknown keys and unparsable values are ignored.</summary>
        public static void ParseOverrides(string url)
        {
            if (string.IsNullOrEmpty(url)) return;
            int q = url.IndexOf('?'); if (q < 0) return;
            int hash = url.IndexOf('#', q); string query = hash > 0 ? url.Substring(q + 1, hash - q - 1) : url.Substring(q + 1);
            foreach (var pair in query.Split('&'))
            {
                int eq = pair.IndexOf('='); if (eq <= 0) continue;
                string key = pair.Substring(0, eq).ToLowerInvariant(), value = pair.Substring(eq + 1);
                if (!key.StartsWith("fx.", StringComparison.Ordinal)) continue;
                bool flag = !(value == "0" || value == "false" || value == "off");
                switch (key)
                {
                    case "fx.particles":
                        if (float.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float d))
                            _ovParticles = Mathf.Clamp(d, 0f, MaxParticleDensity);
                        break;
                    case "fx.brightness":
                        if (float.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float br))
                            _ovBrightness = Mathf.Clamp(br, MinBrightness, MaxBrightness);
                        break;
                    case "fx.lights":
                        if (int.TryParse(value, out int n)) _ovLights = Mathf.Clamp(n, 0, HardMaxLights);
                        else _ovLights = flag ? (int?)null : 0;
                        break;
                    case "fx.post": _ovPost = flag; break;
                    case "fx.rays": _ovRays = flag; break;
                    case "fx.bloom": _ovBloom = flag; break;
                    case "fx.grading": _ovGrading = flag; break;
                    case "fx.vignette": _ovVignette = flag; break;
                    case "fx.haze": _ovHaze = flag; break;
                    case "fx.audio": _ovAudio = flag; break;
                    case "fx.sun": _ovSun = flag; break;
                    case "fx.shadows": _ovShadows = flag; break;
                    case "fx.ice": _ovIce = flag; break;
                    case "fx.shimmer": _ovShimmer = flag; break;
                }
            }
        }

        static void ApplyOverrides()
        {
            if (_ovParticles.HasValue) ParticleDensity = _ovParticles.Value;
            if (_ovRays.HasValue) Rays = _ovRays.Value;
            if (_ovBrightness.HasValue) WorldBrightness = _ovBrightness.Value;
            if (_ovLights.HasValue) { MaxDynamicLights = _ovLights.Value; DynamicLights = _ovLights.Value > 0; }
            if (_ovPost.HasValue) PostProcessing = _ovPost.Value;
            if (_ovBloom.HasValue) Bloom = _ovBloom.Value;
            if (_ovGrading.HasValue) Grading = _ovGrading.Value;
            if (_ovVignette.HasValue) Vignette = _ovVignette.Value;
            if (_ovHaze.HasValue) Haze = _ovHaze.Value;
            if (_ovAudio.HasValue) Audio = _ovAudio.Value;
            if (_ovSun.HasValue) SunLighting = _ovSun.Value;
            if (_ovShadows.HasValue) Shadows = _ovShadows.Value;
            if (_ovIce.HasValue) IceTranslucency = _ovIce.Value;
            if (_ovShimmer.HasValue) HeatShimmer = _ovShimmer.Value;
        }

        static void Raise()
        {
            var h = Changed; if (h == null) return;
            // A listener owned by a destroyed object must never break the others (edit-mode tests recreate arenas without OnDestroy).
            foreach (var d in h.GetInvocationList()) { try { ((Action)d)(); } catch (Exception e) { Changed -= (Action)d; Debug.LogWarning("Atmosphere listener removed: " + e.Message); } }
        }

        /// <summary>Call once at start-up (ArenaView does): reads the page URL, then the current preset.</summary>
        public static void Initialize()
        {
            string url = ""; try { url = Application.absoluteURL; } catch (Exception) { }
            SetUrl(url);
            RefreshFromSettings();
        }
    }
}
