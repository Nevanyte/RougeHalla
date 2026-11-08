using System;
using UnityEngine;

namespace Roguehalla.Client
{
    public enum ShowcaseQuality { Low, Medium, High }
    public enum ShowcaseQualityMode { Adaptive, Manual }

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
        const float DowngradeCpuMs = 8.5f;
        const float UpgradeCpuMs = 6.0f;
        const float DowngradeHoldSeconds = 2.0f;
        const float UpgradeHoldSeconds = 8.0f;

        static ShowcaseSettings _current;
        ShowcaseQualityMode _qualityMode;
        ShowcaseQuality _manualQuality, _effectiveQuality;
        bool _reducedMotion;
        float _textScale, _musicVolume, _ambienceVolume, _sfxVolume;
        float _overBudgetSeconds, _underBudgetSeconds;
        float _cpuEmaMs;
        bool _hasTiming;
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
            _manualQuality = (ShowcaseQuality)Mathf.Clamp(PlayerPrefs.GetInt(ManualQualityKey, (int)ShowcaseQuality.High), 0, 2);
            _effectiveQuality = _manualQuality;
            _reducedMotion = PlayerPrefs.GetInt(ReducedMotionKey, 0) != 0;
            _textScale = Mathf.Clamp(PlayerPrefs.GetFloat(TextScaleKey, 1f), .85f, 1.5f);
            _musicVolume = Mathf.Clamp01(PlayerPrefs.GetFloat(MusicKey, .72f));
            _ambienceVolume = Mathf.Clamp01(PlayerPrefs.GetFloat(AmbienceKey, .62f));
            _sfxVolume = Mathf.Clamp01(PlayerPrefs.GetFloat(SfxKey, .85f));
            PublishSettings();
        }

        void Update()
        {
            if (_prefsDirty)
            {
                _prefsSaveIn -= Time.unscaledDeltaTime;
                if (_prefsSaveIn <= 0f) SavePreferences();
            }
            if (_qualityMode != ShowcaseQualityMode.Adaptive) return;
            FrameTimingManager.CaptureFrameTimings();
            if (FrameTimingManager.GetLatestTimings(1, _frameTimings) == 0) return;

            // WebGL exposes CPU timings but not GPU timings. Use main-thread work only so
            // browser VSync/present waiting does not falsely force the user to Low quality.
            float cpuMs = (float)_frameTimings[0].cpuMainThreadFrameTime;
            if (cpuMs <= 0f || float.IsNaN(cpuMs) || float.IsInfinity(cpuMs)) return;
            _cpuEmaMs = _hasTiming ? Mathf.Lerp(_cpuEmaMs, cpuMs, .12f) : cpuMs;
            _hasTiming = true;
            float elapsed = Mathf.Max(Time.unscaledDeltaTime, 0f);
            if (_cpuEmaMs > DowngradeCpuMs)
            {
                _overBudgetSeconds += elapsed; _underBudgetSeconds = 0f;
                if (_overBudgetSeconds >= DowngradeHoldSeconds)
                {
                    SetEffective((ShowcaseQuality)Mathf.Max((int)_effectiveQuality - 1, (int)ShowcaseQuality.Low));
                    _overBudgetSeconds = 0f;
                }
            }
            else if (_cpuEmaMs < UpgradeCpuMs)
            {
                _underBudgetSeconds += elapsed; _overBudgetSeconds = 0f;
                if (_underBudgetSeconds >= UpgradeHoldSeconds)
                {
                    SetEffective((ShowcaseQuality)Mathf.Min((int)_effectiveQuality + 1, (int)ShowcaseQuality.High));
                    _underBudgetSeconds = 0f;
                }
            }
            else { _underBudgetSeconds = _overBudgetSeconds = 0f; }
        }

        void OnDestroy()
        {
            if (_current == this) _current = null;
        }

        public void CycleQuality()
        {
            if (_qualityMode == ShowcaseQualityMode.Adaptive)
            {
                _qualityMode = ShowcaseQualityMode.Manual;
                _manualQuality = ShowcaseQuality.High;
            }
            else if (_manualQuality == ShowcaseQuality.High) _manualQuality = ShowcaseQuality.Medium;
            else if (_manualQuality == ShowcaseQuality.Medium) _manualQuality = ShowcaseQuality.Low;
            else _qualityMode = ShowcaseQualityMode.Adaptive;
            PlayerPrefs.SetInt(QualityModeKey, (int)_qualityMode);
            PlayerPrefs.SetInt(ManualQualityKey, (int)_manualQuality);
            SavePreferences();
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

        void NotifyChanged() { PublishSettings(); if (Changed != null) Changed(); }

        void PublishSettings()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            RhShowcase_Settings((int)EffectiveQuality,(int)_qualityMode,_reducedMotion ? 1 : 0,_textScale,_musicVolume);
#endif
        }
    }
}
