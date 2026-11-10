using System;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Roguehalla.Client
{
    /// <summary>Presentation-only options. Settings survive arena/session replacement and persist locally.</summary>
    public sealed class ShowcaseSettings : MonoBehaviour
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [System.Runtime.InteropServices.DllImport("__Internal")]
        static extern void RhShowcase_Settings(int quality, int mode, int reducedMotion, float textScale, float musicVolume);
#endif
        const string QualityModeKey = "roguehalla.showcase.qualityMode";
        const string ManualQualityKey = "roguehalla.showcase.manualQuality";
        const string ReducedMotionKey = "roguehalla.showcase.reducedMotion";
        const string TextScaleKey = "roguehalla.showcase.textScale";
        const string MusicKey = "roguehalla.showcase.music";
        const string AmbienceKey = "roguehalla.showcase.ambience";
        const string SfxKey = "roguehalla.showcase.sfx";

        static ShowcaseSettings _current;
        ShowcaseQualityMode _qualityMode;
        ShowcaseQuality _manualQuality, _effectiveQuality;
        bool _reducedMotion;
        float _textScale, _musicVolume, _ambienceVolume, _sfxVolume;
        // Adaptive mode: the controller (pure C#, unit-tested) owns the decision; URL flags may pin a preset or
        // override single effects for cost attribution (?quality=ultra&fx.bloom=0, see QualityFlags).
        AdaptiveQualityController _adaptive;
        QualityOverrides _overrides;
        float _originalRenderScale = -1f;
        bool _prefsDirty;
        float _prefsSaveIn;

        readonly FrameTiming[] _frameTimings = new FrameTiming[1];

        public static ShowcaseSettings Current { get { return _current; } }
        public event Action Changed;
        public event Action AudioChanged;

        public ShowcaseQualityMode QualityMode { get { return _qualityMode; } }
        public ShowcaseQuality ManualQuality { get { return _manualQuality; } }
        public ShowcaseQuality EffectiveQuality { get { return _qualityMode == ShowcaseQualityMode.Manual ? _manualQuality : _effectiveQuality; } }
        public bool ReducedMotion { get { return _reducedMotion; } }
        public float TextScale { get { return _textScale; } }
        public float MusicVolume { get { return _musicVolume; } }
        public float AmbienceVolume { get { return _ambienceVolume; } }
        public float SfxVolume { get { return _sfxVolume; } }

        void Awake()
        {
            if (_current != null && _current != this) { Destroy(this); return; }
            _current = this;
            _qualityMode = (ShowcaseQualityMode)Mathf.Clamp(PlayerPrefs.GetInt(QualityModeKey, (int)ShowcaseQualityMode.Adaptive), 0, 1);
            _manualQuality = QualityTable.Clamp(PlayerPrefs.GetInt(ManualQualityKey, (int)ShowcaseQuality.High));
            _effectiveQuality = _manualQuality;
            ShowcaseQuality? urlPreset; bool urlAdaptive;
            QualityFlags.Parse(PageSearch(), out urlPreset, out urlAdaptive, out _overrides);
            if (urlPreset.HasValue) { _qualityMode = ShowcaseQualityMode.Manual; _manualQuality = _effectiveQuality = urlPreset.Value; }
            else if (urlAdaptive) { _qualityMode = ShowcaseQualityMode.Adaptive; }
            if (_qualityMode == ShowcaseQualityMode.Adaptive) _adaptive = new AdaptiveQualityController(_effectiveQuality);
            _reducedMotion = PlayerPrefs.GetInt(ReducedMotionKey, 0) != 0;
            _textScale = Mathf.Clamp(PlayerPrefs.GetFloat(TextScaleKey, 1f), .85f, 1.5f);
            _musicVolume = Mathf.Clamp01(PlayerPrefs.GetFloat(MusicKey, .72f));
            _ambienceVolume = Mathf.Clamp01(PlayerPrefs.GetFloat(AmbienceKey, .62f));
            _sfxVolume = Mathf.Clamp01(PlayerPrefs.GetFloat(SfxKey, .85f));
            ApplyRow();
            PublishSettings();
            PerfRecorder.StartIfRequested(PageSearch());
        }

        /// <summary>
        /// Replaces the per-effect overrides at runtime (same fields as the ?fx.* URL flags). Used by the perf harness
        /// to toggle one effect inside a live match; an empty value restores the plain preset.
        /// </summary>
        public void SetOverrides(QualityOverrides overrides)
        {
            _overrides = overrides;
            NotifyChanged();
        }

        /// <summary>Query string of the hosting page (WebGL), or empty.</summary>
        static string PageSearch()
        {
            string url = Application.absoluteURL;
            if (string.IsNullOrEmpty(url)) return "";
            int q = url.IndexOf('?');
            return q < 0 ? "" : url.Substring(q);
        }

        /// <summary>Adaptive controller state as JSON, or null when a preset is pinned (perf recorder).</summary>
        public string AdaptiveDebug { get { return _adaptive != null ? _adaptive.DebugState() : "null"; } }

        void Update()
        {
            if (_prefsDirty)
            {
                _prefsSaveIn -= Time.unscaledDeltaTime;
                if (_prefsSaveIn <= 0f) SavePreferences();
            }
            if (_qualityMode != ShowcaseQualityMode.Adaptive || _adaptive == null) return;
            FrameTimingManager.CaptureFrameTimings();
            float cpuMs = 0f;
            // WebGL exposes CPU timings but not GPU timings. cpuMs is main-thread work only, so browser VSync/present
            // waiting does not falsely force the user down; the controller also watches missed refreshes.
            if (FrameTimingManager.GetLatestTimings(1, _frameTimings) != 0)
            {
                cpuMs = (float)_frameTimings[0].cpuMainThreadFrameTime;
                if (float.IsNaN(cpuMs) || float.IsInfinity(cpuMs)) cpuMs = 0f;
            }
            float dt = Mathf.Max(Time.unscaledDeltaTime, 0f);
            if (_adaptive.Update(dt, dt * 1000f, cpuMs)) SetEffective(_adaptive.Current);
        }

        void OnDestroy()
        {
            if (_current == this)
            {
                _current = null;
                Quality.Reset();
#if !UNITY_EDITOR
                RestoreRenderScale();
#endif
            }
        }

        /// <summary>Adaptive -> Ultra -> High -> Medium -> Low -> Adaptive.</summary>
        public void CycleQuality()
        {
            if (_qualityMode == ShowcaseQualityMode.Adaptive)
            {
                _qualityMode = ShowcaseQualityMode.Manual;
                _manualQuality = ShowcaseQuality.Ultra;
            }
            else if (_manualQuality == ShowcaseQuality.Ultra) _manualQuality = ShowcaseQuality.High;
            else if (_manualQuality == ShowcaseQuality.High) _manualQuality = ShowcaseQuality.Medium;
            else if (_manualQuality == ShowcaseQuality.Medium) _manualQuality = ShowcaseQuality.Low;
            else _qualityMode = ShowcaseQualityMode.Adaptive;
            PlayerPrefs.SetInt(QualityModeKey, (int)_qualityMode);
            PlayerPrefs.SetInt(ManualQualityKey, (int)_manualQuality);
            SavePreferences();
            _adaptive = _qualityMode == ShowcaseQualityMode.Adaptive ? new AdaptiveQualityController(_manualQuality) : null;
            if (_qualityMode == ShowcaseQualityMode.Adaptive) SetEffective(_manualQuality);
            else NotifyChanged();
        }

        public void ToggleReducedMotion()
        {
            _reducedMotion = !_reducedMotion;
            PlayerPrefs.SetInt(ReducedMotionKey, _reducedMotion ? 1 : 0); SavePreferences();
            NotifyChanged();
        }

        public void SetTextScale(float value)
        {
            value = Mathf.Clamp(value, .85f, 1.5f);
            if (Mathf.Abs(value - _textScale) < .005f) return;
            _textScale = value;
            PlayerPrefs.SetFloat(TextScaleKey, value); QueuePreferencesSave();
            NotifyChanged();
        }

        public void SetMusicVolume(float value) { SetVolume(ref _musicVolume, value, MusicKey); RaiseAudioChanged(); }
        public void SetAmbienceVolume(float value) { SetVolume(ref _ambienceVolume, value, AmbienceKey); RaiseAudioChanged(); }
        public void SetSfxVolume(float value) { SetVolume(ref _sfxVolume, value, SfxKey); RaiseAudioChanged(); }

        void SetVolume(ref float target, float value, string key)
        {
            value = Mathf.Clamp01(value);
            if (Mathf.Abs(value - target) < .005f) return;
            target = value; PlayerPrefs.SetFloat(key, value); QueuePreferencesSave();
        }

        void QueuePreferencesSave()
        {
            _prefsDirty = true;
            _prefsSaveIn = .5f;
        }

        void SavePreferences()
        {
            PlayerPrefs.Save();
            _prefsDirty = false;
            _prefsSaveIn = 0f;
        }

        void RaiseAudioChanged()
        {
            PublishSettings();
            if (AudioChanged != null) AudioChanged();
            if (Changed != null) Changed();
        }

        void SetEffective(ShowcaseQuality value)
        {
            if (_effectiveQuality == value) return;
            _effectiveQuality = value;
            NotifyChanged();
        }

        void NotifyChanged() { ApplyRow(); PublishSettings(); if (Changed != null) Changed(); }

        /// <summary>Publishes the effective preset (plus URL overrides) to <see cref="Quality"/> and applies render scale.</summary>
        void ApplyRow()
        {
            Quality.Set(EffectiveQuality, _overrides);
#if !UNITY_EDITOR
            // The pipeline asset is shared and persistent in the Editor, so only players change it.
            var pipeline = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
            if (pipeline != null)
            {
                if (_originalRenderScale < 0f) _originalRenderScale = pipeline.renderScale;
                pipeline.renderScale = Quality.RenderScale;
            }
#endif
        }

#if !UNITY_EDITOR
        void RestoreRenderScale()
        {
            var pipeline = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
            if (pipeline != null && _originalRenderScale > 0f) pipeline.renderScale = _originalRenderScale;
        }
#endif

        void PublishSettings()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            RhShowcase_Settings((int)EffectiveQuality,(int)_qualityMode,_reducedMotion ? 1 : 0,_textScale,_musicVolume);
#endif
        }
    }
}
