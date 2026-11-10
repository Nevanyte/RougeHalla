using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>
    /// Region atmosphere driver (presentation only). Per frame it samples the blurred region weights at the camera and eases the
    /// global light, volume grading, haze and the shader sun table toward that position's blend, so walking across a border changes
    /// the light continuously rather than as a timed switch. Discrete region changes drive the screen particles and the streamed
    /// audio. Accent lights and cast-shadow chunks are culled to the camera rectangle. Every effect reads <see cref="AtmosphereQuality"/>.
    /// It reuses ArenaView's single global Light2D and Volume (never adds a second global light).
    /// </summary>
    public sealed class RegionAtmosphere : MonoBehaviour
    {
        const float EaseSeconds = .35f, CullMarginTiles = 4f;
        ArenaView _arena; Light2D _ambient; Volume _volume; System.Action<Color> _haze;
        VolumeProfile _profile; ColorAdjustments _ca; SplitToning _split; Bloom _bloom; Vignette _vig; LiftGammaGain _lgg; Tonemapping _tone;
        readonly RegionField _field = new RegionField(); TempleLayout _temple;
        RegionShadowMap _shadows; readonly AccentLights _lights = new AccentLights(); readonly LifeLights _life = new LifeLights(); readonly AtmosphereParticles _particles = new AtmosphereParticles();
        AtmosphereAudio _audio; readonly Roguehalla.Net.RegionAudioGate _gate = new Roguehalla.Net.RegionAudioGate(); int _gateRegion;
        WallSdf _sdf; LightShadowAtlas _shadowAtlas; bool _wasAnalytic;
        /// <summary>How windy each region is (wire ids 1..6: fire, sentenced, plague, frost, holy, coliseum).</summary>
        static readonly float[] Windiness = { .30f, .30f, .55f, .85f, .75f, .50f };
        /// <summary>Cloud shadow amount per wire id 0..7 (sunny zones only: frost, holy, plague clearings, coliseum).</summary>
        static readonly Vector4[] CloudAmt = { Vector4.zero, Vector4.zero, Vector4.zero, new Vector4(.30f, 0, 0, 0), new Vector4(.62f, 0, 0, 0), new Vector4(.55f, 0, 0, 0), new Vector4(.35f, 0, 0, 0), Vector4.zero };
        static readonly int IdWind = Shader.PropertyToID("_RhWind"), IdCloud = Shader.PropertyToID("_RhCloud"), IdActorN = Shader.PropertyToID("_RhActorN"), IdFx = Shader.PropertyToID("_RhFx");
        readonly SurfaceFx.RippleInfo[] _ripples = new SurfaceFx.RippleInfo[16]; readonly Vector4[] _ripP = new Vector4[6], _ripB = new Vector4[6];
        static readonly int IdRip = Shader.PropertyToID("_RhRip"), IdRipB = Shader.PropertyToID("_RhRipB");
        public WallSdf WallSdf { get { return _sdf; } }
        readonly float[] _w = new float[RegionField.Regions];
        AtmosphereParams _cur; bool _hasCur; float _ambientBase = .36f;
        Camera _cam; float _time; int _rectKey = int.MinValue; bool _matchActive;
        static readonly Vector4[] SunCol = new Vector4[8], AmbCol = new Vector4[8], ShadowCol = new Vector4[8], FloorCol = new Vector4[8];
        public RegionField Field { get { return _field; } }
        public RegionShadowMap Shadows { get { return _shadows; } }
        public AccentLights Lights { get { return _lights; } }
        public LifeLights Life { get { return _life; } }
        public AtmosphereParticles Particles { get { return _particles; } }
        public AtmosphereAudio Audio { get { return _audio; } }
        public AtmosphereParams Current { get { return _cur; } }
        /// <summary>True while screen particles replace ArenaView's old amber dust motes.</summary>
        public bool OwnsMotes { get { return AtmosphereQuality.ParticlesEnabled; } }

        public void Bind(ArenaView arena, Light2D ambient, Volume volume, System.Action<Color> haze)
        {
            _arena = arena; _ambient = ambient; _volume = volume; _haze = haze;
            EnsureOverrides();
            _particles.Initialize(transform); _lights.Initialize(transform); _life.Initialize(transform);
            _audio = new AtmosphereAudio(this, transform); AudioDebugHooks.Create(this);
            UploadSunTable();
            _arena.LocalRegionChanged += OnRegionChanged;
            AtmosphereQuality.Changed += OnQualityChanged;
            var start = RegionAtmosphereTable.Get(RegionId.Coliseum); _cur = start.Params; _hasCur = true;
            Apply(); PushSwitches();
        }

        void EnsureOverrides()
        {
            if (_volume == null) return;
            _profile = _volume.profile;      // runtime instance of the shared profile; ours to change
            if (_profile == null) { _profile = ScriptableObject.CreateInstance<VolumeProfile>(); _volume.profile = _profile; }
            if (!_profile.TryGet(out _ca)) _ca = _profile.Add<ColorAdjustments>(true);
            if (!_profile.TryGet(out _bloom)) _bloom = _profile.Add<Bloom>(true);
            if (!_profile.TryGet(out _split)) _split = _profile.Add<SplitToning>(true);
            if (!_profile.TryGet(out _vig)) _vig = _profile.Add<Vignette>(true);
            if (!_profile.TryGet(out _lgg)) _lgg = _profile.Add<LiftGammaGain>(true);
            if (!_profile.TryGet(out _tone)) _tone = _profile.Add<Tonemapping>(true);
            _tone.mode.Override(TonemappingMode.Neutral);
            _vig.rounded.Override(false);
        }

        static void UploadSunTable()
        {
            for (int i = 0; i < 8; i++)
            {
                var p = (i == 7 ? RegionAtmosphereTable.HolyTempleInterior : RegionAtmosphereTable.Get(i)).Params;   // row 7 = the temple interior profile (RhSun.hlsl blends it by the baked interior weight)
                var sun = p.SunColor * p.SunStrength; SunCol[i] = new Vector4(sun.r, sun.g, sun.b, p.SunStrength);
                AmbCol[i] = new Vector4(p.AmbientColor.r, p.AmbientColor.g, p.AmbientColor.b, p.SunStrength);
                FloorCol[i] = new Vector4(Mathf.Max(p.PassiveFloor.r, AtmosphereLighting.GlobalMinFloor), Mathf.Max(p.PassiveFloor.g, AtmosphereLighting.GlobalMinFloor), Mathf.Max(p.PassiveFloor.b, AtmosphereLighting.GlobalMinFloor), 1f);
                var t = p.ShadowTint; float m = Mathf.Max(.001f, Mathf.Max(t.r, Mathf.Max(t.g, t.b)));
                // Inside a shadow the surface keeps about 55% of its light, leaning toward the region's palette shadow colour.
                ShadowCol[i] = new Vector4(Mathf.Lerp(.46f, .95f * t.r / m * .6f, .6f), Mathf.Lerp(.46f, .95f * t.g / m * .6f, .6f), Mathf.Lerp(.46f, .95f * t.b / m * .6f, .6f), 1f);
            }
            Shader.SetGlobalVectorArray("_RhSunCol", SunCol); Shader.SetGlobalVectorArray("_RhAmbCol", AmbCol); Shader.SetGlobalVectorArray("_RhShadowCol", ShadowCol); Shader.SetGlobalVectorArray("_RhFloorCol", FloorCol);
        }

        void PushSwitches()
        {
            Shader.SetGlobalVector("_RhSwitch", new Vector4(AtmosphereQuality.SunLighting ? 1f : 0f, AtmosphereQuality.Shadows ? 1f : 0f,
                AtmosphereQuality.IceTranslucency ? 1f : 0f, AtmosphereQuality.HeatShimmer ? 1f : 0f));
        }

        void OnQualityChanged()
        {
            if (this == null || _arena == null) { AtmosphereQuality.Changed -= OnQualityChanged; return; }
            PushSwitches(); _particles.RefreshQuality(); _lights.MarkDirty(); _rectKey = int.MinValue;
            if (_volume != null) _volume.enabled = AtmosphereQuality.PostProcessing;
            Apply();
        }

        public void SetAmbientBase(float value) { _ambientBase = value; Apply(); }

        public void OnMapBuilt(MapBlob map)
        {
            _field.Build(map.Regions, map.W, map.H);
            _temple = TempleLayout.For(map);
            AtmosphereShadows.Field = _field;
            if (_shadows != null) _shadows.Dispose();
            _shadows = map.Regions != null ? new RegionShadowMap(map, _field) : null;
            Shader.SetGlobalTexture("_RhShadowMask", _shadows != null ? (Texture)_shadows.Mask : Texture2D.blackTexture);
            _lights.Load(map); _rectKey = int.MinValue;
            if (_sdf != null) _sdf.Dispose();
            _sdf = map.Tiles != null ? new WallSdf(map.Tiles, map.W, map.H) : null;
            Shader.SetGlobalTexture("_RhWallSdf", _sdf != null ? (Texture)_sdf.Texture : Texture2D.whiteTexture);
            if (_shadowAtlas == null) _shadowAtlas = new LightShadowAtlas();
            _shadowAtlas.SetWalls(_sdf); _lights.ShadowAtlas = _sdf != null ? _shadowAtlas : null;
        }

        void OnRegionChanged(RegionId previous, RegionId current)
        {
            Debug.Log("[atmosphere] region " + current);   // one line per confirmed region change (the browser evidence script names shots from it)
            AudioDiag.Line("region-changed " + previous + "->" + current + " matchActive=" + _matchActive);
            var row = RegionAtmosphereTable.Get(current);
            _particles.SetPreset(row.Particles, previous == RegionId.None);
        }

        /// <summary>Music and ambience are fetched and played only while the match is running (not in the lobby or planning screens).</summary>
        public void SetMatchActive(bool active)
        {
            if (active == _matchActive) return;
            _matchActive = active; AudioDiag.Line("match-active " + active + " region=" + _arena.LocalRegion);
        }

        /// <summary>Called from ArenaView.Follow every frame with the live camera.</summary>
        public void OnFollow(Camera cam, float dt)
        {
            _cam = cam; if (cam == null) return;
            _time += dt;
            Vector3 c = cam.transform.position;
            float tx = c.x, ty = -c.y / ArenaView.GroundSquash;
            float halfW = cam.orthographic ? cam.orthographicSize * cam.aspect : 12f, halfH = (cam.orthographic ? cam.orthographicSize : 9f) / ArenaView.GroundSquash;
            // Position-driven light: sample the region weights under the camera and ease toward the blend.
            _field.Sample(tx, ty, _w);
            var target = RegionField.Blend(_w);
            if (_audio != null && (_temple == null || !_temple.Found)) _audio.SetInterior(0f);
            if (_temple != null && _temple.Found)      // inside the generated temple: the even, warm interior profile, eased in over about 4 tiles at the steps
            {
                float tw = _temple.WeightAt(tx, ty); _audio.SetInterior(tw);
                if (tw > .001f) target = AtmosphereParams.Lerp(target, RegionAtmosphereTable.HolyTempleInterior.Params, tw);
            }
            _cur = _hasCur ? AtmosphereParams.Lerp(_cur, target, 1f - Mathf.Exp(-dt / EaseSeconds)) : target; _hasCur = true;
            Apply();
            Shader.SetGlobalVector("_RhCam", new Vector4(tx, ty, 0, 0));
            // Cast shadows: bake chunks the camera rectangle (plus margin) touches, only when it enters a new chunk range.
            if (_shadows != null && AtmosphereQuality.Shadows)
            {
                int cs = RegionShadowMap.ChunkTiles;
                int key = ((Mathf.FloorToInt((tx - halfW - CullMarginTiles) / cs) + 64) << 24) ^ ((Mathf.FloorToInt((tx + halfW + CullMarginTiles) / cs) + 64) << 16)
                        ^ ((Mathf.FloorToInt((ty - halfH - CullMarginTiles) / cs) + 64) << 8) ^ (Mathf.FloorToInt((ty + halfH + CullMarginTiles) / cs) + 64);
                if (key != _rectKey) { _rectKey = key; _shadows.UpdateVisible(tx - halfW, ty - halfH, tx + halfW, ty + halfH, CullMarginTiles); }
            }
            PushSurfaceGlobals(tx, ty);
            bool analytic = AtmosphereQuality.AnalyticLights;
            if (analytic) { LocalLightField.Begin(AtmosphereQuality.EffectiveLocalLights); if (AtmosphereQuality.FxLights) LocalLightField.AddFlashes(dt); }
            _lights.Tick(tx, ty, halfW, halfH, dt, _time);
            if (_shadowAtlas != null) _shadowAtlas.Tick();
            _life.Tick(dt, _time, tx, ty, halfW, halfH, _w[2], _w[0], _lights.Planner);
            if (analytic) { LocalLightField.Push(AtmosphereQuality.Relief, AtmosphereQuality.LocalShadows && _sdf != null, AtmosphereQuality.Cookies, AtmosphereQuality.Gloss, AtmosphereQuality.ActorLights); _wasAnalytic = true; }
            else if (_wasAnalytic) { LocalLightField.Clear(); _wasAnalytic = false; }
            _particles.Tick(cam, dt);
        }

        /// <summary>Wind, cloud shadows and the presented actors, for the ground, wall and prop shaders (RhSun.hlsl). Fixed arrays, no allocation.</summary>
        void PushSurfaceGlobals(float tx, float ty)
        {
            float wind = 0; for (int k = 0; k < RegionField.Regions; k++) wind += _w[k] * Windiness[k];
            float ang = .45f + .35f * Mathf.Sin(_time * .05f);
            bool on = AtmosphereQuality.Wind && wind > .001f;
            Shader.SetGlobalVector(IdWind, new Vector4(Mathf.Cos(ang), Mathf.Sin(ang), on ? wind : 0f, 1.15f + .35f * Mathf.Sin(_time * .21f)));
            Shader.SetGlobalVectorArray(IdCloud, CloudAmt);
            int n = ActorField.Push(tx, ty);
            Shader.SetGlobalVector(IdActorN, new Vector4(n, AtmosphereQuality.Clouds ? 1f : 0f, 0, 0));
            int nr = 0;
            if (AtmosphereQuality.Water && SurfaceFx.Current != null)
            {
                int cnt = SurfaceFx.Current.CopyRipples(_ripples);
                for (int i = 0; i < cnt && nr < 6; i++)
                {
                    var r = _ripples[i]; if (r.Reaction != WaterReaction.Shallow) continue;
                    _ripP[nr] = new Vector4(r.World.x, -r.World.y / ArenaView.GroundSquash, r.Birth, r.Life); _ripB[nr] = new Vector4(r.Diameter, 0, 0, 0); nr++;
                }
                if (nr > 0) { Shader.SetGlobalVectorArray(IdRip, _ripP); Shader.SetGlobalVectorArray(IdRipB, _ripB); }
            }
            Shader.SetGlobalVector(IdFx, new Vector4(AtmosphereQuality.Water ? 1f : 0f, nr, 0, 0));
        }

        void Update()
        {
            if (_audio == null) return;
            // Region audio is requested only once the match runs and the local player's region has been known for a moment (RegionAudioGate):
            // never during launch, planning or results, and never from a placeholder first fix.
            int region = _gate.Update(_matchActive && _arena != null, _arena != null ? (int)_arena.LocalRegion : 0, Time.unscaledTime);
            if (region != _gateRegion) { _gateRegion = region; AudioDiag.Line("gate region=" + region); }
            _audio.SetRegion(region > 0 ? RegionAtmosphereTable.Get(region) : null);
            _audio.Tick(Time.unscaledDeltaTime, Time.unscaledTime);
            ShowcaseSoundscape.LegacyMusicMuted = _audio.TookOverMusic; ShowcaseSoundscape.LegacyAmbienceMuted = _audio.TookOverAmbience;
        }

        void Apply()
        {
            if (!_hasCur) return;
            var p = _cur;
            if (_ambient != null) { _ambient.color = p.LightColor; _ambient.intensity = _ambientBase * p.LightScale * AtmosphereQuality.WorldBrightness; }
            if (_haze != null) { var h = p.Haze; if (!AtmosphereQuality.Haze) h.a = 0f; _haze(h); }
            if (_volume == null || _ca == null) return;
            bool post = AtmosphereQuality.PostProcessing; _volume.enabled = post;
            if (!post) return;
            bool grade = AtmosphereQuality.Grading;
            _ca.active = grade; _ca.postExposure.Override(p.PostExposure); _ca.contrast.Override(p.Contrast); _ca.saturation.Override(p.Saturation); _ca.colorFilter.Override(p.ColorFilter);
            bool paint = grade && AtmosphereQuality.Painterly;
            if (_lgg != null) { _lgg.active = paint; _lgg.lift.Override(p.Lift); _lgg.gain.Override(p.Gain); }
            if (_tone != null) _tone.active = paint && AtmosphereQuality.Tonemap;
            _split.active = grade; _split.shadows.Override(p.SplitShadows); _split.highlights.Override(p.SplitHighlights); _split.balance.Override(p.SplitBalance);
            _bloom.active = AtmosphereQuality.Bloom; _bloom.threshold.Override(p.BloomThreshold); _bloom.intensity.Override(p.BloomIntensity); _bloom.scatter.Override(p.BloomScatter); _bloom.tint.Override(p.BloomTint);
            _vig.active = AtmosphereQuality.Vignette; _vig.intensity.Override(p.VignetteIntensity); _vig.smoothness.Override(p.VignetteSmoothness); _vig.color.Override(p.VignetteColor);
        }

        void OnDestroy()
        {
            if (_arena != null) _arena.LocalRegionChanged -= OnRegionChanged;
            AtmosphereQuality.Changed -= OnQualityChanged;
            LocalLightField.Clear(); if (_sdf != null) _sdf.Dispose(); if (_shadowAtlas != null) _shadowAtlas.Dispose();
            _particles.Dispose(); _lights.Dispose(); _life.Dispose(); if (_audio != null) _audio.Dispose(); if (_shadows != null) _shadows.Dispose();
            if (AtmosphereShadows.Field == _field) AtmosphereShadows.Field = null;
            if (_profile != null && _volume != null && _volume.sharedProfile != _profile) { }
            Shader.SetGlobalVector("_RhSwitch", Vector4.zero);
        }
    }
}
