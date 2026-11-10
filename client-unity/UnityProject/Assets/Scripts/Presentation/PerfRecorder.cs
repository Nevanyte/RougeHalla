using System.Text;
using UnityEngine;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace Roguehalla.Client
{
    /// <summary>
    /// Opt-in (<c>?perf=1</c>) frame-time recorder. The recording itself is browser-side (RhPerf.jslib): it logs every
    /// requestAnimationFrame timestamp into preallocated typed arrays, so it sees real presented-frame cadence rather than
    /// Unity's smoothed deltaTime and allocates nothing per frame. This component only tells the page what Unity knows:
    /// the active quality row and how many actors are on screen. Off by default; nothing is created without the flag.
    /// </summary>
    public sealed class PerfRecorder : MonoBehaviour
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void RhPerf_Init(int capacity);
        [DllImport("__Internal")] static extern void RhPerf_SetContext(int actors, int preset);
        [DllImport("__Internal")] static extern void RhPerf_SetRow(string json);
#endif
        const int DefaultCapacity = 200000;
        static PerfRecorder _instance;
        ArenaView _arena;
        int _lastActors = -1;
        float _nextPoll;

        public static bool Active { get { return _instance != null; } }

        public static void StartIfRequested(string search)
        {
            if (_instance != null || Bootstrap.Query(search, "perf", "0") != "1") return;
            int capacity;
            if (!int.TryParse(Bootstrap.Query(search, "perfFrames", ""), out capacity) || capacity < 1024) capacity = DefaultCapacity;
            var go = new GameObject("Frame-time recorder");
            DontDestroyOnLoad(go);
            _instance = go.AddComponent<PerfRecorder>();
#if UNITY_WEBGL && !UNITY_EDITOR
            RhPerf_Init(capacity);
#endif
            Quality.Changed += _instance.PublishRow;
            _instance.PublishRow();
        }

        /// <summary>The quality row as JSON for the report (small, built only when the row changes).</summary>
        public static string RowJson()
        {
            var r = Quality.Row;
            var sb = new StringBuilder(220);
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            sb.Append("{\"preset\":\"").Append(Quality.Preset).Append("\",\"overrides\":").Append(Quality.HasOverrides ? "true" : "false")
              .Append(",\"renderScale\":").Append(r.RenderScale.ToString("0.###", inv))
              .Append(",\"particles\":").Append(r.Particles.ToString("0.###", inv))
              .Append(",\"dynamicLights\":").Append(r.DynamicLights.ToString(inv))
              .Append(",\"shadows\":").Append(r.Shadows ? "true" : "false")
              .Append(",\"bloom\":").Append(r.Bloom ? "true" : "false")
              .Append(",\"colorGrading\":").Append(r.ColorGrading ? "true" : "false")
              .Append(",\"vignette\":").Append(r.Vignette ? "true" : "false")
              .Append(",\"ambientParticles\":").Append(r.AmbientParticles ? "true" : "false")
              .Append(",\"propDensity\":").Append(r.PropDensity.ToString("0.###", inv)).Append('}');
            return sb.ToString();
        }

        /// <summary>
        /// Called from the page (unityInstance.SendMessage("Frame-time recorder", "SetFlags", "fx.bloom=0")) so the harness can
        /// toggle effects inside one live match and compare interleaved windows. Empty string clears all overrides.
        /// </summary>
        public void SetFlags(string query)
        {
            ShowcaseQuality? preset; bool adaptive; QualityOverrides overrides;
            QualityFlags.Parse(query ?? "", out preset, out adaptive, out overrides);
            if (ShowcaseSettings.Current != null) ShowcaseSettings.Current.SetOverrides(overrides);
        }

        void PublishRow()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            RhPerf_SetRow(RowJson());
#endif
        }

        void Update()
        {
            if (Time.unscaledTime < _nextPoll) return;
            _nextPoll = Time.unscaledTime + .25f;
            if (_arena == null) _arena = FindFirstObjectByType<ArenaView>();
            int actors = _arena != null ? _arena.ObservedActorCount : 0;
            if (actors == _lastActors) return;
            _lastActors = actors;
#if UNITY_WEBGL && !UNITY_EDITOR
            RhPerf_SetContext(actors, (int)Quality.Preset);
#endif
        }

        void OnDestroy()
        {
            if (_instance == this) { Quality.Changed -= PublishRow; _instance = null; }
        }
    }
}
