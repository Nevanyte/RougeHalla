using System;

// Pure C# (no UnityEngine): this file is also compiled by RoguehallaNet.Tests, which unit-tests the preset
// table, the URL flag parser and the adaptive controller.
namespace Roguehalla.Client
{
    public enum ShowcaseQuality { Low = 0, Medium = 1, High = 2, Ultra = 3 }
    public enum ShowcaseQualityMode { Adaptive, Manual }

    /// <summary>One preset: every presentation cost the player can trade for frame time, as plain data.</summary>
    public readonly struct QualityRow
    {
        public readonly string Name;
        /// <summary>URP render scale (1 = native). Applied to the pipeline asset in players only.</summary>
        public readonly float RenderScale;
        /// <summary>Particle density multiplier (0 = no optional particles). Ambient screen particles are separate.</summary>
        public readonly float Particles;
        /// <summary>Maximum simultaneously enabled dynamic 2D lights (0 = none).</summary>
        public readonly int DynamicLights;
        public readonly bool Shadows;
        public readonly bool Bloom, ColorGrading, Vignette;
        /// <summary>Screen-space ambient particles such as snow, dust motes and haze.</summary>
        public readonly bool AmbientParticles;
        /// <summary>Prop density multiplier for decorative props (1 = authored density).</summary>
        public readonly float PropDensity;

        public QualityRow(string name, float renderScale, float particles, int dynamicLights, bool shadows,
            bool bloom, bool colorGrading, bool vignette, bool ambientParticles, float propDensity)
        {
            Name = name; RenderScale = renderScale; Particles = particles; DynamicLights = dynamicLights; Shadows = shadows;
            Bloom = bloom; ColorGrading = colorGrading; Vignette = vignette; AmbientParticles = ambientParticles; PropDensity = propDensity;
        }
    }

    /// <summary>Optional per-field overrides applied on top of a preset row (URL flags, for cost attribution).</summary>
    public struct QualityOverrides
    {
        public float? RenderScale, Particles, PropDensity;
        public int? DynamicLights;
        public bool? Shadows, Bloom, ColorGrading, Vignette, AmbientParticles;

        public bool IsEmpty
        {
            get
            {
                return !RenderScale.HasValue && !Particles.HasValue && !PropDensity.HasValue && !DynamicLights.HasValue &&
                    !Shadows.HasValue && !Bloom.HasValue && !ColorGrading.HasValue && !Vignette.HasValue && !AmbientParticles.HasValue;
            }
        }

        public QualityRow ApplyTo(QualityRow row)
        {
            return new QualityRow(row.Name,
                RenderScale ?? row.RenderScale, Particles ?? row.Particles, DynamicLights ?? row.DynamicLights, Shadows ?? row.Shadows,
                Bloom ?? row.Bloom, ColorGrading ?? row.ColorGrading, Vignette ?? row.Vignette,
                AmbientParticles ?? row.AmbientParticles, PropDensity ?? row.PropDensity);
        }
    }

    public static class QualityTable
    {
        //                                                           name      scale  parts lights shadow bloom  grade  vign   ambient props
        static readonly QualityRow Low    = new QualityRow("Low",    .75f,  0f,    0,  false, false, false, false, false, .5f);
        static readonly QualityRow Medium = new QualityRow("Medium", .9f,   .35f,  3,  false, true,  true,  false, true,  .75f);
        static readonly QualityRow High   = new QualityRow("High",   1f,    1f,    6,  true,  true,  true,  true,  true,  1f);
        static readonly QualityRow Ultra  = new QualityRow("Ultra",  1f,    1.5f,  12, true,  true,  true,  true,  true,  1f);

        public static QualityRow For(ShowcaseQuality quality)
        {
            switch (quality)
            {
                case ShowcaseQuality.Low: return Low;
                case ShowcaseQuality.Medium: return Medium;
                case ShowcaseQuality.Ultra: return Ultra;
                default: return High;
            }
        }

        public static ShowcaseQuality Clamp(int value)
        {
            return (ShowcaseQuality)Math.Max((int)ShowcaseQuality.Low, Math.Min((int)ShowcaseQuality.Ultra, value));
        }
    }

    /// <summary>
    /// URL query flags. <c>?quality=ultra</c> pins a preset for the session (<c>adaptive</c> forces adaptive mode);
    /// <c>fx.*</c> flags override one field of whichever preset is active: <c>fx.bloom</c>, <c>fx.grading</c>,
    /// <c>fx.vignette</c>, <c>fx.post</c> (all three), <c>fx.shadows</c>, <c>fx.ambient</c> (0/1), <c>fx.lights</c> (cap),
    /// <c>fx.particles</c>, <c>fx.props</c>, <c>fx.scale</c> (numbers). Unparseable values are ignored.
    /// </summary>
    public static class QualityFlags
    {
        public static void Parse(string search, out ShowcaseQuality? preset, out bool adaptive, out QualityOverrides overrides)
        {
            preset = null; adaptive = false; overrides = default(QualityOverrides);
            if (string.IsNullOrEmpty(search)) return;
            string s = search;
            int hash = s.IndexOf('#'); if (hash >= 0) s = s.Substring(0, hash);
            int qm = s.IndexOf('?'); if (qm >= 0) s = s.Substring(qm + 1);
            foreach (var pair in s.Split('&'))
            {
                int eq = pair.IndexOf('=');
                if (eq <= 0) continue;
                string key = pair.Substring(0, eq);
                string value = Uri.UnescapeDataString(pair.Substring(eq + 1).Replace('+', ' ')).Trim().ToLowerInvariant();
                switch (key)
                {
                    case "quality":
                        if (value == "adaptive" || value == "auto") adaptive = true;
                        else if (value == "low") preset = ShowcaseQuality.Low;
                        else if (value == "medium") preset = ShowcaseQuality.Medium;
                        else if (value == "high") preset = ShowcaseQuality.High;
                        else if (value == "ultra") preset = ShowcaseQuality.Ultra;
                        break;
                    case "fx.bloom": overrides.Bloom = Bool(value) ?? overrides.Bloom; break;
                    case "fx.grading": overrides.ColorGrading = Bool(value) ?? overrides.ColorGrading; break;
                    case "fx.vignette": overrides.Vignette = Bool(value) ?? overrides.Vignette; break;
                    case "fx.post":
                        var post = Bool(value);
                        if (post.HasValue) { overrides.Bloom = post; overrides.ColorGrading = post; overrides.Vignette = post; }
                        break;
                    case "fx.shadows": overrides.Shadows = Bool(value) ?? overrides.Shadows; break;
                    case "fx.ambient": overrides.AmbientParticles = Bool(value) ?? overrides.AmbientParticles; break;
                    case "fx.lights":
                        int lights; if (int.TryParse(value, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out lights))
                            overrides.DynamicLights = Math.Max(0, Math.Min(64, lights));
                        break;
                    case "fx.particles": overrides.Particles = Number(value, 0f, 4f) ?? overrides.Particles; break;
                    case "fx.props": overrides.PropDensity = Number(value, 0f, 2f) ?? overrides.PropDensity; break;
                    case "fx.scale": overrides.RenderScale = Number(value, .25f, 2f) ?? overrides.RenderScale; break;
                }
            }
        }

        static bool? Bool(string v)
        {
            if (v == "1" || v == "true" || v == "on" || v == "yes") return true;
            if (v == "0" || v == "false" || v == "off" || v == "no") return false;
            return null;
        }

        static float? Number(string v, float min, float max)
        {
            float f;
            if (!float.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out f)) return null;
            if (float.IsNaN(f) || float.IsInfinity(f)) return null;
            return Math.Max(min, Math.Min(max, f));
        }
    }

    /// <summary>
    /// Read-only view of the active quality row for every presentation system (region lighting, particles, props, ...).
    /// ShowcaseSettings owns the writes. With no ShowcaseSettings alive the default is the High row, as before.
    /// </summary>
    public static class Quality
    {
        static ShowcaseQuality _preset = ShowcaseQuality.High;
        static QualityOverrides _overrides;
        static QualityRow _row = QualityTable.For(ShowcaseQuality.High);

        /// <summary>Raised after the row changes (preset change or override change).</summary>
        public static event Action Changed;

        public static ShowcaseQuality Preset { get { return _preset; } }
        public static QualityRow Row { get { return _row; } }
        public static bool HasOverrides { get { return !_overrides.IsEmpty; } }

        public static float RenderScale { get { return _row.RenderScale; } }
        /// <summary>Particle density multiplier; scale emission rates and counts by it.</summary>
        public static float Particles { get { return _row.Particles; } }
        /// <summary>Maximum enabled dynamic 2D lights.</summary>
        public static int DynamicLights { get { return _row.DynamicLights; } }
        public static bool Shadows { get { return _row.Shadows; } }
        public static bool Bloom { get { return _row.Bloom; } }
        public static bool ColorGrading { get { return _row.ColorGrading; } }
        public static bool Vignette { get { return _row.Vignette; } }
        public static bool AnyPostProcessing { get { return _row.Bloom || _row.ColorGrading || _row.Vignette; } }
        /// <summary>Screen-space ambient particles (snow, dust motes, haze).</summary>
        public static bool AmbientParticles { get { return _row.AmbientParticles; } }
        /// <summary>Decorative prop density multiplier; place round(authored * PropDensity) props.</summary>
        public static float PropDensity { get { return _row.PropDensity; } }

        public static void Set(ShowcaseQuality preset, QualityOverrides overrides)
        {
            var row = overrides.ApplyTo(QualityTable.For(preset));
            bool same = preset == _preset && row.Equals(_row);
            _preset = preset; _overrides = overrides; _row = row;
            if (!same && Changed != null) Changed();
        }

        /// <summary>Back to the default High row with no overrides (tests, ShowcaseSettings teardown).</summary>
        public static void Reset() { Set(ShowcaseQuality.High, default(QualityOverrides)); }
    }

    /// <summary>
    /// Chooses and adjusts the preset from measured frame time. During a short probe at the start it picks the starting
    /// preset; afterwards it steps down quickly and up slowly (hysteresis), and refuses to retry an upgrade that
    /// just failed. Load is expressed relative to the display refresh interval, which is estimated from a slow-rising minimum of
    /// the observed frame times (WebGL is vsync-paced, so a healthy frame equals the refresh interval).
    /// </summary>
    public sealed class AdaptiveQualityController
    {
        public const float SkipSeconds = 1f;          // ignore load hitches
        public const float ProbeSeconds = 3f;         // measuring window that picks the starting preset
        public const float DownHoldSeconds = 2f;
        public const float UpHoldSeconds = 8f;
        public const float SettleSeconds = 1.5f;      // after any change, measure the new row before judging it
        public const float FailedUpgradeWindow = 15f; // a downgrade this soon after an upgrade bans that upgrade...
        public const float UpgradeBanSeconds = 60f;   // ...for this long
        public const float DownFrameRatio = 1.25f;    // frame time above refresh * this = missing vsync
        public const float UpFrameRatio = 1.10f;
        public const float DownCpuRatio = .55f;       // main-thread CPU as a fraction of the refresh interval
        public const float UpCpuRatio = .36f;
        public const float MinRefreshMs = 3f, MaxRefreshMs = 1000f / 60f;
        const float MaxSampleMs = 250f;               // hidden tab / debugger pauses are not load

        readonly ShowcaseQuality _max;
        float _smoothFrame, _refreshFloor = MaxRefreshMs; // slow-rising minimum of the frame time: the display cadence
        float _clock, _probeFrame, _probeCpu, _emaFrame, _emaCpu, _hold, _settle, _banUntil, _lastUpgradeAt = -1000f;
        int _probeFrames, _probeCpuFrames;
        bool _emaValid;
        ShowcaseQuality _current;
        ShowcaseQuality _banCeiling;

        public AdaptiveQualityController(ShowcaseQuality start = ShowcaseQuality.High, ShowcaseQuality max = ShowcaseQuality.Ultra)
        {
            _current = start; _max = max; _banCeiling = max; Probing = true;
        }

        public ShowcaseQuality Current { get { return _current; } }
        public bool Probing { get; private set; }
        public float RefreshMs { get { return EstimateRefreshMs(); } }
        /// <summary>Controller state for the perf recorder (JSON): what it believes the refresh is and how loaded it thinks the frame is.</summary>
        public string DebugState()
        {
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            return "{\"current\":\"" + _current + "\",\"probing\":" + (Probing ? "true" : "false") + ",\"refreshMs\":" + EstimateRefreshMs().ToString("0.##", inv)
                + ",\"emaFrame\":" + _emaFrame.ToString("0.###", inv) + ",\"emaCpu\":" + _emaCpu.ToString("0.###", inv) + ",\"holdS\":" + _hold.ToString("0.#", inv)
                + ",\"settleS\":" + Math.Max(0f, _settle).ToString("0.#", inv) + ",\"banned\":" + (_clock < _banUntil ? "true" : "false") + "}";
        }

        /// <summary>Feeds one frame. <paramref name="cpuMs"/> is main-thread CPU time or &lt;= 0 when unknown. Returns true when <see cref="Current"/> changed.</summary>
        public bool Update(float dtSeconds, float frameMs, float cpuMs)
        {
            if (!(frameMs > 0f) || frameMs > MaxSampleMs || dtSeconds < 0f) return false;
            _clock += dtSeconds;
            // Follow fast frames down quickly but drift up very slowly, so a machine that is merely slow does not look
            // like a slower display (a 128-frame window adapts within a second and would hide sustained overload).
            // The floor follows a 16-frame average, not single frames: rAF timestamps jitter by about +-1 ms around a 6.94 ms cadence, and
            // tracking the raw minimum put the floor near 6.0 ms, so a perfectly smooth 144 Hz looked like 1.15x the refresh and never
            // satisfied the step-up test (measured in the browser, docs/rework/PERF_REPORT.md section 7).
            _smoothFrame = _smoothFrame <= 0f ? frameMs : _smoothFrame + (frameMs - _smoothFrame) * .0625f;
            _refreshFloor += (_smoothFrame - _refreshFloor) * (_smoothFrame < _refreshFloor ? .05f : .0004f);
            if (_clock < SkipSeconds) return false;

            if (Probing)
            {
                _probeFrame += frameMs; _probeFrames++;
                if (cpuMs > 0f) { _probeCpu += cpuMs; _probeCpuFrames++; }
                if (_clock < SkipSeconds + ProbeSeconds || _probeFrames < 30) return false;
                Probing = false;
                var chosen = ChooseStart(_probeFrame / _probeFrames, _probeCpuFrames > 0 ? _probeCpu / _probeCpuFrames : 0f);
                _hold = 0f; _settle = SettleSeconds; _emaValid = false;
                if (chosen == _current) return false;
                _current = chosen; return true;
            }

            if (_settle > 0f) { _settle -= dtSeconds; return false; }
            float refresh = EstimateRefreshMs();
            float f = frameMs / refresh, c = cpuMs > 0f ? cpuMs / refresh : 0f;
            if (!_emaValid) { _emaFrame = f; _emaCpu = c; _emaValid = true; }
            else { _emaFrame += (f - _emaFrame) * .12f; _emaCpu += (c - _emaCpu) * .12f; }

            bool cpuKnown = cpuMs > 0f;
            bool over = _emaFrame > DownFrameRatio || (cpuKnown && _emaCpu > DownCpuRatio);
            bool under = _emaFrame < UpFrameRatio && (!cpuKnown || _emaCpu < UpCpuRatio);
            if (over && _current > ShowcaseQuality.Low)
            {
                _hold += dtSeconds;
                if (_hold >= DownHoldSeconds)
                {
                    if (_clock - _lastUpgradeAt < FailedUpgradeWindow)
                    {   // the upgrade we just made did not hold: stay at the lower row for a while
                        _banCeiling = (ShowcaseQuality)((int)_current - 1); _banUntil = _clock + UpgradeBanSeconds;
                    }
                    _current = (ShowcaseQuality)((int)_current - 1);
                    Reset(); return true;
                }
            }
            else if (under && _current < Ceiling())
            {
                _hold += dtSeconds;
                if (_hold >= UpHoldSeconds)
                {
                    _current = (ShowcaseQuality)((int)_current + 1); _lastUpgradeAt = _clock;
                    Reset(); return true;
                }
            }
            else _hold = 0f;
            return false;
        }

        ShowcaseQuality Ceiling()
        {
            return _clock < _banUntil && _banCeiling < _max ? _banCeiling : _max;
        }

        void Reset() { _hold = 0f; _settle = SettleSeconds; _emaValid = false; }

        ShowcaseQuality ChooseStart(float meanFrameMs, float meanCpuMs)
        {
            float refresh = EstimateRefreshMs();
            float frameRatio = meanFrameMs / refresh, cpuRatio = meanCpuMs / refresh;
            ShowcaseQuality pick;
            if (frameRatio > 2.2f) pick = ShowcaseQuality.Low;
            else if (frameRatio > 1.6f) pick = ShowcaseQuality.Medium;
            else if (frameRatio > DownFrameRatio) pick = ShowcaseQuality.High;
            else if (meanCpuMs <= 0f || cpuRatio <= UpCpuRatio) pick = ShowcaseQuality.Ultra;
            else if (cpuRatio <= DownCpuRatio) pick = ShowcaseQuality.High;
            else if (cpuRatio <= .8f) pick = ShowcaseQuality.Medium;
            else pick = ShowcaseQuality.Low;
            return pick > _max ? _max : pick;
        }

        float EstimateRefreshMs()
        {
            return Math.Max(MinRefreshMs, Math.Min(MaxRefreshMs, _refreshFloor));
        }
    }
}
