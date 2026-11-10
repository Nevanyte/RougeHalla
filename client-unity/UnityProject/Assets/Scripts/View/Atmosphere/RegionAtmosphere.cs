using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
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
        VolumeProfile _profile; ColorAdjustments _ca; SplitToning _split; Bloom _bloom; Vignette _vig;
        readonly RegionField _field = new RegionField();
        RegionShadowMap _shadows; readonly AccentLights _lights = new AccentLights(); readonly AtmosphereParticles _particles = new AtmosphereParticles();
        AtmosphereAudio _audio;
        readonly float[] _w = new float[RegionField.Regions];
        AtmosphereParams _cur; bool _hasCur; float _ambientBase = .36f;
        Camera _cam; float _time; int _rectKey = int.MinValue; bool _matchActive;
        static readonly Vector4[] SunCol = new Vector4[8], AmbCol = new Vector4[8], ShadowCol = new Vector4[8];
        public RegionField Field { get { return _field; } }
        public RegionShadowMap Shadows { get { return _shadows; } }
        public AccentLights Lights { get { return _lights; } }
        public AtmosphereParticles Particles { get { return _particles; } }
        public AtmosphereAudio Audio { get { return _audio; } }
        public AtmosphereParams Current { get { return _cur; } }
        /// <summary>True while screen particles replace ArenaView's old amber dust motes.</summary>
        public bool OwnsMotes { get { return AtmosphereQuality.ParticlesEnabled; } }

        public void Bind(ArenaView arena, Light2D ambient, Volume volume, System.Action<Color> haze)
        {
            _arena = arena; _ambient = ambient; _volume = volume; _haze = haze;
            EnsureOverrides();
            _particles.Initialize(transform); _lights.Initialize(transform);
            _audio = new AtmosphereAudio(this, transform);
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
            _vig.rounded.Override(false);
        }

        static void UploadSunTable()
        {
            for (int i = 0; i < 8; i++)
            {
                var p = RegionAtmosphereTable.Get(i).Params;
                var sun = p.SunColor * p.SunStrength; SunCol[i] = new Vector4(sun.r, sun.g, sun.b, p.SunStrength);
                AmbCol[i] = new Vector4(p.AmbientColor.r, p.AmbientColor.g, p.AmbientColor.b, p.SunStrength);
                var t = p.ShadowTint; float m = Mathf.Max(.001f, Mathf.Max(t.r, Mathf.Max(t.g, t.b)));
                // Inside a shadow the surface keeps about 55% of its light, leaning toward the region's palette shadow colour.
                ShadowCol[i] = new Vector4(Mathf.Lerp(.55f, .95f * t.r / m * .6f, .6f), Mathf.Lerp(.55f, .95f * t.g / m * .6f, .6f), Mathf.Lerp(.55f, .95f * t.b / m * .6f, .6f), 1f);
            }
            Shader.SetGlobalVectorArray("_RhSunCol", SunCol); Shader.SetGlobalVectorArray("_RhAmbCol", AmbCol); Shader.SetGlobalVectorArray("_RhShadowCol", ShadowCol);
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
            _audio.SetRegion(_matchActive ? RegionAtmosphereTable.Get(_arena.LocalRegion) : null);
            Apply();
        }

        public void SetAmbientBase(float value) { _ambientBase = value; Apply(); }

        public void OnMapBuilt(MapBlob map)
        {
            _field.Build(map.Regions, map.W, map.H);
            AtmosphereShadows.Field = _field;
            if (_shadows != null) _shadows.Dispose();
            _shadows = map.Regions != null ? new RegionShadowMap(map, _field) : null;
            Shader.SetGlobalTexture("_RhShadowMask", _shadows != null ? (Texture)_shadows.Mask : Texture2D.blackTexture);
            _lights.Load(map); _rectKey = int.MinValue;
        }

        void OnRegionChanged(RegionId previous, RegionId current)
        {
            var row = RegionAtmosphereTable.Get(current);
            _particles.SetPreset(row.Particles, previous == RegionId.None);
            if (_matchActive) _audio.SetRegion(row);
        }

        /// <summary>Music and ambience are fetched and played only while the match is running (not in the lobby or planning screens).</summary>
        public void SetMatchActive(bool active)
        {
            if (active == _matchActive) return;
            _matchActive = active;
            _audio.SetRegion(active && _arena.LocalRegion != RegionId.None ? RegionAtmosphereTable.Get(_arena.LocalRegion) : null);
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
            _lights.Tick(tx, ty, halfW, halfH, dt, _time);
            _particles.Tick(cam, dt);
        }

        void Update()
        {
            if (_audio == null) return;
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
            _split.active = grade; _split.shadows.Override(p.SplitShadows); _split.highlights.Override(p.SplitHighlights); _split.balance.Override(p.SplitBalance);
            _bloom.active = AtmosphereQuality.Bloom; _bloom.threshold.Override(p.BloomThreshold); _bloom.intensity.Override(p.BloomIntensity); _bloom.scatter.Override(p.BloomScatter); _bloom.tint.Override(p.BloomTint);
            _vig.active = AtmosphereQuality.Vignette; _vig.intensity.Override(p.VignetteIntensity); _vig.smoothness.Override(p.VignetteSmoothness); _vig.color.Override(p.VignetteColor);
        }

        void OnDestroy()
        {
            if (_arena != null) _arena.LocalRegionChanged -= OnRegionChanged;
            AtmosphereQuality.Changed -= OnQualityChanged;
            _particles.Dispose(); _lights.Dispose(); if (_audio != null) _audio.Dispose(); if (_shadows != null) _shadows.Dispose();
            if (AtmosphereShadows.Field == _field) AtmosphereShadows.Field = null;
            if (_profile != null && _volume != null && _volume.sharedProfile != _profile) { }
            Shader.SetGlobalVector("_RhSwitch", Vector4.zero);
        }
    }
}
