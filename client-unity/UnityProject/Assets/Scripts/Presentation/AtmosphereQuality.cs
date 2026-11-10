using System;
using UnityEngine;
using Roguehalla.Net;

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
    /// <c>?fx.haze=0</c>, <c>?fx.audio=0</c>, <c>?fx.sun=0</c>, <c>?fx.shadows=0</c>, <c>?fx.ice=0</c>, <c>?fx.shimmer=0</c>, <c>?fx.brightness=0.9</c>, <c>?fx.rays=0</c>, <c>?fx.quality=high</c>, and the render-pass switches <c>?fx.locallights</c>, <c>relief</c>, <c>lshadows</c>, <c>cookies</c>, <c>gloss</c>, <c>wind</c>,
    /// <c>clouds</c>, <c>water</c>, <c>fireflies</c>, <c>emberlight</c>, <c>fxlights</c>, <c>sparks</c> (0|1) and <c>?fx.maxlights=N</c>. Presentation only: nothing here reads or changes game state.
    /// </summary>
    public static class AtmosphereQuality
    {
        /// <summary>Hard ceiling for any density multiplier, so a query string cannot ask for unbounded particles.</summary>
        public const float MaxParticleDensity = 1.5f;
        /// <summary>Hard ceiling for simultaneously active accent point lights, whatever a preset asks for.</summary>
        public const int HardMaxLights = 6;
        /// <summary>Hard ceiling for the analytic local lights the region shaders evaluate (LocalLightField.Max).</summary>
        public const int HardMaxLocalLights = LocalLightField.Max;

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
        /// <summary>Single world-brightness scalar (1 = as authored): multiplies the global light, so ground, walls, props and actors move together. Clamped 0.4 to 1.6; <c>?fx.brightness=0.9</c>, <c>?fx.rays=0</c>, <c>?fx.quality=high</c>.</summary>
        public static float WorldBrightness = .9f;   // the browser build renders a little brighter than the editor: tuned against web screenshots
        public const float MinBrightness = .4f, MaxBrightness = 1.6f;

        // ---- render-pass switches (each one an independent, measurable effect; see docs/rework/RENDER_PLAN.md) -----------------------------
        /// <summary>Master: the region shaders light ground, walls and props from the analytic local-light field (off: the old flat Light2D look).</summary>
        public static bool LocalLights = true;
        /// <summary>Normal-mapped relief: lights shape surfaces instead of tinting them flat.</summary>
        public static bool Relief = true;
        /// <summary>Soft shadows from the wall grid for local lights (ground, walls and props only; never actors).</summary>
        public static bool LocalShadows = true;
        /// <summary>Procedural light cookies: grated lanterns, leaf dapple, stained glass.</summary>
        public static bool Cookies = true;
        /// <summary>Specular response on ice, water, polished stone.</summary>
        public static bool Gloss = true;
        /// <summary>Wind sway on trees, grass, reeds, cloth, and grass parting around presented actors.</summary>
        public static bool Wind = true;
        /// <summary>Drifting cloud shadows in the sunny zones.</summary>
        public static bool Clouds = true;
        /// <summary>Moving refraction, caustics and ripple glints in water, ice depth parallax.</summary>
        public static bool Water = true;
        /// <summary>Small wandering lights (Plague fireflies).</summary>
        public static bool Fireflies = true;
        /// <summary>Embers that light their surroundings.</summary>
        public static bool EmberLight = true;
        /// <summary>Wish and combat flashes that light the scene.</summary>
        public static bool FxLights = true;
        /// <summary>Projectile trails and impact sparks.</summary>
        public static bool Sparks = true;
        /// <summary>Characters are lit by the analytic lights too (soft diffuse and a rim on the lit edge), and the Light2D twins are no longer needed.</summary>
        public static bool ActorLights = true;
        /// <summary>Painterly grade: lifted tinted blacks and warm or cool highlights on top of the zone grade. Held OFF in every preset: measured in the browser it lifted mean luma by about 30% in Fire and cost bar and marker contrast (docs/rework/evidence/render/README.md); <c>?fx.painterly=1</c> opts in while the lift values are re-tuned.</summary>
        public static bool Painterly = false;
        /// <summary>Soft neutral tonemap on top of the painterly grade. Held OFF in every preset: the contrast gate measured it lowering marker and body contrast in the bright zones (docs/rework/evidence/render/README.md).</summary>
        public static bool Tonemap = false;
        /// <summary>Characters take their light from the analytic field (and the accent Light2D twins stay off).</summary>
        public static bool ActorsAnalytic { get { return AnalyticLights && ActorLights; } }
        /// <summary>Cap on analytic local lights in view.</summary>
        public static int MaxLocalLights = 16;
        /// <summary>The number of analytic local lights allowed this frame (0 when the master switch is off).</summary>
        public static int EffectiveLocalLights { get { return LocalLights ? Mathf.Clamp(MaxLocalLights, 0, HardMaxLocalLights) : 0; } }
        /// <summary>Accent lights draw as analytic lights (and their Light2D twin only lights actors).</summary>
        public static bool AnalyticLights { get { return LocalLights && EffectiveLocalLights > 0; } }
        /// <summary>Raised after any change made through this class, so effects re-read the switchboard (not per frame).</summary>
        public static event Action Changed;

        // render-pass overrides, indexed like the Pass enum below
        enum Pass { LocalLights, Relief, LShadows, Cookies, Gloss, Wind, Clouds, Water, Fireflies, EmberLight, FxLights, Sparks, ActorLights, Painterly, Tonemap, Count }
        static readonly bool?[] _ovPass = new bool?[(int)Pass.Count]; static int? _ovMaxLocal;

        /// <summary>Per-preset defaults of the render-pass switches (Ultra: everything).</summary>
        public static void ApplyPasses(ShowcaseQuality q)
        {
            bool low = q == ShowcaseQuality.Low, med = q == ShowcaseQuality.Medium, high = q == ShowcaseQuality.High, ultra = q == ShowcaseQuality.Ultra;
            LocalLights = !low; Relief = !low; LocalShadows = ultra || high; Cookies = high || ultra; Gloss = high || ultra;
            ActorLights = !low; Painterly = false; Tonemap = false; Wind = !low; Clouds = !low; Water = high || ultra; Fireflies = ultra; EmberLight = ultra || high; FxLights = !low; Sparks = !low;
            MaxLocalLights = low ? 0 : med ? 6 : high ? 12 : 20;
            for (int i = 0; i < _ovPass.Length; i++) if (_ovPass[i].HasValue) SetPass((Pass)i, _ovPass[i].Value);
            if (_ovMaxLocal.HasValue) MaxLocalLights = Mathf.Clamp(_ovMaxLocal.Value, 0, HardMaxLocalLights);
        }
        /// <summary>Reduced motion: no sway, no drifting cloud shadows, no wandering lights (overrides from the URL still win afterwards through ApplyPasses only when set).</summary>
        static void CalmMotion() { Wind = false; Clouds = false; Fireflies = false; }
        static void SetPass(Pass p, bool v)
        {
            switch (p)
            {
                case Pass.LocalLights: LocalLights = v; break; case Pass.Relief: Relief = v; break; case Pass.LShadows: LocalShadows = v; break; case Pass.Cookies: Cookies = v; break;
                case Pass.Gloss: Gloss = v; break; case Pass.Wind: Wind = v; break; case Pass.Clouds: Clouds = v; break; case Pass.Water: Water = v; break;
                case Pass.ActorLights: ActorLights = v; break; case Pass.Painterly: Painterly = v; break; case Pass.Tonemap: Tonemap = v; break; case Pass.Fireflies: Fireflies = v; break; case Pass.EmberLight: EmberLight = v; break; case Pass.FxLights: FxLights = v; break; case Pass.Sparks: Sparks = v; break;
            }
        }

        // Surface effects (SurfaceFx): lingering prints, water/bog ripples and wakes, surface footsteps. ?fx.tracks=0, ?fx.ripples=0, ?fx.footsteps=0, ?fx.glisten=0.
        /// <summary>Print pool capacity (0 = no prints).</summary>
        public static int SurfaceTrackCap = SurfaceFxQuality.MaxTracks;
        public static int SurfaceFluidCap = SurfaceFxQuality.MaxFluids;
        public static bool SurfaceRipples = true, SurfaceFootsteps = true, SurfaceGlisten = true;

        static float? _ovParticles; static int? _ovLights; static ShowcaseQuality? _ovQuality; static float? _ovBrightness; static bool? _ovRays; static bool? _ovTracks, _ovRipples, _ovFootsteps, _ovGlisten; static bool? _ovPost, _ovBloom, _ovGrading, _ovVignette, _ovHaze, _ovAudio, _ovSun, _ovShadows, _ovIce, _ovShimmer;

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
            SetSurfaceFx((int)quality, reducedMotion);
            switch (quality)
            {
                case ShowcaseQuality.Low:
                    Apply(0f, false, 0, false, false, false, false, haze: false, audio: true, ice: false, shimmer: false); break;
                case ShowcaseQuality.Medium:
                    Apply(reducedMotion ? 0f : .55f, true, 2, true, true, true, false, ice: true, shimmer: false); break;
                default:
                    Apply(reducedMotion ? 0f : 1f, true, 4, true, true, true, true); break;
            }
            ApplyPasses(quality); if (reducedMotion) CalmMotion(); Raise();
        }

        /// <summary>Re-derive the defaults from <see cref="ShowcaseSettings.Current"/> (High when there is none).</summary>
        public static void RefreshFromSettings()
        {
            var s = ShowcaseSettings.Current;
            bool reduced = s != null && s.ReducedMotion;
            if (_ovQuality.HasValue) { ApplyPreset(_ovQuality.Value, reduced); return; }
            // The Quality row (QualityModel: Low / Medium / High / Ultra plus ?fx.* per-effect overrides) is the source of truth.
            var preset = Quality.Preset;
            SetSurfaceFx((int)preset, reduced);
            bool low = preset == ShowcaseQuality.Low, medium = preset == ShowcaseQuality.Medium;
            Apply(reduced ? 0f : Quality.Particles, Quality.DynamicLights > 0, Quality.DynamicLights,
                Quality.AnyPostProcessing, Quality.Bloom, Quality.ColorGrading, Quality.Vignette,
                haze: !low, audio: true, sun: true, shadows: Quality.Shadows, ice: !low, shimmer: !low && !medium, rays: !low);
            ApplyPasses(preset); if (reduced) CalmMotion(); Raise();
        }

        static void SetSurfaceFx(int preset, bool reducedMotion)
        {
            var sw = SurfaceFxQuality.Decide(preset, reducedMotion);
            SurfaceTrackCap = sw.TrackCap; SurfaceFluidCap = sw.FluidCap; SurfaceRipples = sw.Ripples; SurfaceFootsteps = sw.Footsteps; SurfaceGlisten = sw.Glisten;
        }

        /// <summary>The quality the world is currently drawn at (a <c>?fx.quality=</c> override wins).</summary>
        public static ShowcaseQuality EffectiveQuality()
        {
            var s = ShowcaseSettings.Current; return _ovQuality ?? (s != null ? s.EffectiveQuality : ShowcaseQuality.High);
        }

        /// <summary>Parse <c>fx.*</c> query overrides from a page URL (empty or null clears them) and re-apply.</summary>
        public static void SetUrl(string url)
        {
            for (int i = 0; i < _ovPass.Length; i++) _ovPass[i] = null; _ovMaxLocal = null;
            _ovParticles = null; _ovLights = null; _ovBrightness = null; _ovRays = null; _ovQuality = null; _ovTracks = _ovRipples = _ovFootsteps = _ovGlisten = null; _ovPost = _ovBloom = _ovGrading = _ovVignette = _ovHaze = _ovAudio = _ovSun = _ovShadows = _ovIce = _ovShimmer = null;
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
                    case "fx.quality":     // force a preset regardless of the adaptive setting (evidence and A/B runs): low, medium or high
                        if (value == "low") _ovQuality = ShowcaseQuality.Low; else if (value == "medium") _ovQuality = ShowcaseQuality.Medium; else if (value == "high") _ovQuality = ShowcaseQuality.High; else if (value == "ultra") _ovQuality = ShowcaseQuality.Ultra;
                        break;
                    case "fx.tracks": _ovTracks = flag; break;
                    case "fx.ripples": _ovRipples = flag; break;
                    case "fx.footsteps": _ovFootsteps = flag; break;
                    case "fx.glisten": _ovGlisten = flag; break;
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
                    case "fx.locallights": _ovPass[(int)Pass.LocalLights] = flag; break;
                    case "fx.relief": _ovPass[(int)Pass.Relief] = flag; break;
                    case "fx.lshadows": _ovPass[(int)Pass.LShadows] = flag; break;
                    case "fx.cookies": _ovPass[(int)Pass.Cookies] = flag; break;
                    case "fx.gloss": _ovPass[(int)Pass.Gloss] = flag; break;
                    case "fx.wind": _ovPass[(int)Pass.Wind] = flag; break;
                    case "fx.clouds": _ovPass[(int)Pass.Clouds] = flag; break;
                    case "fx.water": _ovPass[(int)Pass.Water] = flag; break;
                    case "fx.fireflies": _ovPass[(int)Pass.Fireflies] = flag; break;
                    case "fx.emberlight": _ovPass[(int)Pass.EmberLight] = flag; break;
                    case "fx.fxlights": _ovPass[(int)Pass.FxLights] = flag; break;
                    case "fx.sparks": _ovPass[(int)Pass.Sparks] = flag; break;
                    case "fx.actorlights": _ovPass[(int)Pass.ActorLights] = flag; break;
                    case "fx.tonemap": _ovPass[(int)Pass.Tonemap] = flag; break;
                    case "fx.painterly": _ovPass[(int)Pass.Painterly] = flag; break;
                    case "fx.maxlights": if (int.TryParse(value, out int ml)) _ovMaxLocal = Mathf.Clamp(ml, 0, HardMaxLocalLights); break;
                }
            }
        }

        static void ApplyOverrides()
        {
            if (_ovParticles.HasValue) ParticleDensity = _ovParticles.Value;
            if (_ovRays.HasValue) Rays = _ovRays.Value;
            if (_ovBrightness.HasValue) WorldBrightness = _ovBrightness.Value;
            if (_ovLights.HasValue) { MaxDynamicLights = _ovLights.Value; DynamicLights = _ovLights.Value > 0; }
            if (_ovTracks.HasValue) SurfaceTrackCap = _ovTracks.Value ? Math.Max(SurfaceTrackCap, SurfaceFxQuality.MaxTracks) : 0;
            if (_ovRipples.HasValue) { SurfaceRipples = _ovRipples.Value; if (SurfaceRipples) SurfaceFluidCap = Math.Max(SurfaceFluidCap, SurfaceFxQuality.MaxFluids); }
            if (_ovFootsteps.HasValue) SurfaceFootsteps = _ovFootsteps.Value;
            if (_ovGlisten.HasValue) SurfaceGlisten = _ovGlisten.Value;
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
