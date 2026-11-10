using System.Collections.Generic;
using System.Text;
using Unity.Profiling;
using UnityEngine;
using UnityEngine.LowLevel;
using UnityEngine.PlayerLoop;
using UnityEngine.Rendering.Universal;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace Roguehalla.Client
{
    /// <summary>
    /// Opt-in (<c>?perf=1</c>) frame-time recorder. The recording itself is browser-side (RhPerf.jslib): it logs every
    /// requestAnimationFrame timestamp into preallocated typed arrays, so it sees real presented-frame cadence rather than
    /// Unity's smoothed deltaTime and allocates nothing per frame. This component tells the page what Unity knows: the active
    /// quality row, how many actors are on screen, and (on request, <c>Snapshot</c>/<c>Census</c>) load-independent counts:
    /// CPU per engine phase and per owned system (<see cref="PerfMarks"/>), managed allocation, UI and text rebuilds, render
    /// counters where the player exposes them, and a census of live particle systems, lights, renderers and canvases.
    /// Off by default; nothing is created or hooked without the flag.
    /// </summary>
    public sealed class PerfRecorder : MonoBehaviour
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void RhPerf_Init(int capacity);
        [DllImport("__Internal")] static extern void RhPerf_SetContext(int actors, int preset);
        [DllImport("__Internal")] static extern void RhPerf_SetRow(string json);
        [DllImport("__Internal")] static extern void RhPerf_SetPlace(int region, int x, int y);
        [DllImport("__Internal")] static extern void RhPerf_SetUnity(string json);
        [DllImport("__Internal")] static extern void RhPerf_SetCensus(string json);
#endif
        const int DefaultCapacity = 200000;
        static PerfRecorder _instance;
        ArenaView _arena;
        int _lastActors = -1, _lastRegion = -2, _lastX, _lastY;
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
            _instance.Hook();
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
            // CONTRAST measurement switches (never a preset): the adaptive outline and the camera sorting layer grab it reads.
            SpriteOutline.Enabled = !(query ?? "").Contains("fx.outline=0"); SpriteOutline.SetGrabPass(!(query ?? "").Contains("fx.outlinegrab=0"));
            if (ShowcaseSettings.Current != null) ShowcaseSettings.Current.SetOverrides(overrides);
            // The render-pass switches (fx.relief, fx.wind, ...) live in AtmosphereQuality: page URL first, the harness flags after (later keys win).
            string page = ""; try { page = Application.absoluteURL ?? ""; } catch (System.Exception) { }
            string extra = string.IsNullOrEmpty(query) ? "" : (page.IndexOf('?') >= 0 ? "&" : "?") + query;
            AtmosphereQuality.SetUrl(page + extra); AtmosphereQuality.RefreshFromSettings();
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
            int region = _arena != null ? (int)_arena.LocalRegion : -1;
            int px = 0, py = 0;
            if (_arena != null && _arena.TryLocalPosition(out float lx, out float ly)) { px = Mathf.RoundToInt(lx); py = Mathf.RoundToInt(ly); }
            if (actors == _lastActors && region == _lastRegion && px == _lastX && py == _lastY) return;
            _lastActors = actors; _lastRegion = region; _lastX = px; _lastY = py;
#if UNITY_WEBGL && !UNITY_EDITOR
            RhPerf_SetContext(actors, (int)Quality.Preset);
            RhPerf_SetPlace(region, px, py);
#endif
        }

        // ------------------------------------------------------------------------------------------------ counters (opt-in)

        struct Counter { public string Name; public ProfilerRecorder Rec; public double Sum; public long Max; }
        static readonly string[] CounterNames =
        {
            "Draw Calls Count", "SetPass Calls Count", "Batches Count", "Triangles Count", "Vertices Count", "Shadow Casters Count",
            "Render Textures Count", "Render Textures Bytes", "Used Textures Count", "Used Textures Bytes", "GC Allocated In Frame",
            "GC Reserved Memory", "GC Used Memory", "System Used Memory", "Total Used Memory", "Main Thread", "Render Thread",
        };
        readonly List<Counter> _counters = new List<Counter>();
        PerfMarks.Mark _frameStart, _scriptsStart, _renderStart, _uiStart;
        long _lastHeap; double _gcBytes; int _gcFrames, _gcBase, _tmpChanges, _instanceIdBase;
        double _layoutQueue, _graphicQueue; int _layoutMax, _graphicMax;
        ICollection<UnityEngine.UI.ICanvasElement> _layoutQ, _graphicQ;
        float _windowStart;
        bool _hooked;

        void Hook()
        {
            if (_hooked) return;
            _hooked = true; PerfMarks.On = true;
            var loop = PlayerLoop.GetCurrentPlayerLoop();
            var subs = loop.subSystemList;
            for (int i = 0; i < subs.Length; i++)
            {
                var t = subs[i].type;
                if (t == typeof(UnityEngine.PlayerLoop.Initialization)) subs[i] = With(subs[i], OnFrameStart, true);
                else if (t == typeof(UnityEngine.PlayerLoop.Update)) subs[i] = With(subs[i], OnScriptsStart, true);
                else if (t == typeof(UnityEngine.PlayerLoop.PreLateUpdate)) subs[i] = With(subs[i], OnScriptsEnd, false);
                else if (t == typeof(UnityEngine.PlayerLoop.PostLateUpdate)) subs[i] = With(With(subs[i], OnRenderStart, true), OnFrameEnd, false);
            }
            loop.subSystemList = subs;
            PlayerLoop.SetPlayerLoop(loop);
            Canvas.preWillRenderCanvases += OnUiStart;
            Canvas.willRenderCanvases += OnUiEnd;   // subscribed after CanvasUpdateRegistry, so it runs after the rebuild
            TMPro.TMPro_EventManager.TEXT_CHANGED_EVENT.Add(OnTextChanged);
            try
            {
                var flags = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
                var reg = UnityEngine.UI.CanvasUpdateRegistry.instance; var type = typeof(UnityEngine.UI.CanvasUpdateRegistry);
                _layoutQ = type.GetField("m_LayoutRebuildQueue", flags)?.GetValue(reg) as ICollection<UnityEngine.UI.ICanvasElement>;
                _graphicQ = type.GetField("m_GraphicRebuildQueue", flags)?.GetValue(reg) as ICollection<UnityEngine.UI.ICanvasElement>;
            }
            catch (System.Exception) { _layoutQ = _graphicQ = null; }
            foreach (var name in CounterNames)
            {
                var cat = name.StartsWith("GC") || name.Contains("Memory") ? ProfilerCategory.Memory
                    : name.EndsWith("Thread") ? ProfilerCategory.Internal : ProfilerCategory.Render;
                var rec = ProfilerRecorder.StartNew(cat, name);
                _counters.Add(new Counter { Name = name, Rec = rec });
            }
            ResetCounters("");
        }

        static PlayerLoopSystem With(PlayerLoopSystem parent, PlayerLoopSystem.UpdateFunction fn, bool first)
        {
            var list = new List<PlayerLoopSystem>(parent.subSystemList ?? new PlayerLoopSystem[0]);
            var sys = new PlayerLoopSystem { type = typeof(PerfRecorder), updateDelegate = fn };
            if (first) list.Insert(0, sys); else list.Add(sys);
            parent.subSystemList = list.ToArray();
            return parent;
        }

        void OnFrameStart()
        {
            _frameStart = PerfMarks.Begin();
            long heap = System.GC.GetTotalMemory(false);
            if (heap > _lastHeap) _gcBytes += heap - _lastHeap;
            _lastHeap = heap; _gcFrames++;
        }
        void OnScriptsStart() { if (_frameStart.T != 0) PerfMarks.End(PerfMarks.Sec.PreUpdate, _frameStart); _scriptsStart = PerfMarks.Begin(); }
        void OnScriptsEnd() { PerfMarks.End(PerfMarks.Sec.Scripts, _scriptsStart); }
        void OnRenderStart() { _renderStart = PerfMarks.Begin(); }
        void OnUiStart()
        {
            _uiStart = PerfMarks.Begin();
            if (_layoutQ != null) { int n = _layoutQ.Count; _layoutQueue += n; if (n > _layoutMax) _layoutMax = n; }
            if (_graphicQ != null) { int n = _graphicQ.Count; _graphicQueue += n; if (n > _graphicMax) _graphicMax = n; }
        }
        void OnUiEnd() { PerfMarks.End(PerfMarks.Sec.UiRebuild, _uiStart); }
        void OnTextChanged(Object o) { _tmpChanges++; }
        void OnFrameEnd()
        {
            PerfMarks.End(PerfMarks.Sec.Render, _renderStart);
            PerfMarks.End(PerfMarks.Sec.Frame, _frameStart);
            PerfMarks.EndFrame();
            lastHeapAfterFrame = System.GC.GetTotalMemory(false);
            if (lastHeapAfterFrame > _lastHeap) _gcBytes += lastHeapAfterFrame - _lastHeap;
            _lastHeap = lastHeapAfterFrame;
            for (int i = 0; i < _counters.Count; i++)
            {
                var c = _counters[i]; if (!c.Rec.Valid) continue;
                long v = c.Rec.LastValue; c.Sum += v; if (v > c.Max) c.Max = v; _counters[i] = c;
            }
        }
        long lastHeapAfterFrame;

        static int NewInstanceId() { var m = new Mesh(); int id = m.GetInstanceID(); Destroy(m); return id; }

        /// <summary>Page: start a counting window (SendMessage("Frame-time recorder", "ResetCounters", "")).</summary>
        public void ResetCounters(string unused)
        {
            PerfMarks.Reset();
            _gcBytes = 0; _gcFrames = 0; _gcBase = System.GC.CollectionCount(0); _tmpChanges = 0; _lastHeap = System.GC.GetTotalMemory(false);
            _layoutQueue = _graphicQueue = 0; _layoutMax = _graphicMax = 0;
            for (int i = 0; i < _counters.Count; i++) { var c = _counters[i]; c.Sum = 0; c.Max = 0; _counters[i] = c; }
            _instanceIdBase = NewInstanceId();
            _windowStart = Time.realtimeSinceStartup;
        }

        /// <summary>Page: publish the window's counts as window.__rhPerf.unity (JSON, built only on request).</summary>
        public void Snapshot(string unused)
        {
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            int frames = Mathf.Max(1, PerfMarks.Frames);
            float seconds = Mathf.Max(.001f, Time.realtimeSinceStartup - _windowStart);
            var sb = new StringBuilder(2048);
            sb.Append("{\"frames\":").Append(PerfMarks.Frames).Append(",\"seconds\":").Append(seconds.ToString("0.###", inv));
            sb.Append(",\"cpu\":{");
            for (int i = 0; i < (int)PerfMarks.Sec.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('"').Append(PerfMarks.Names[i]).Append("\":{\"mean\":").Append(PerfMarks.MeanMs(i).ToString("0.####", inv))
                  .Append(",\"max\":").Append(PerfMarks.MaxMs(i).ToString("0.###", inv)).Append(",\"calls\":").Append(PerfMarks.Calls(i)).Append(",\"allocPerFrame\":").Append(PerfMarks.AllocPerFrame(i).ToString("0", inv)).Append('}');
            }
            sb.Append("},\"gcBytesPerFrame\":").Append((_gcBytes / Mathf.Max(1, _gcFrames)).ToString("0", inv))
              .Append(",\"gcCollections\":").Append(System.GC.CollectionCount(0) - _gcBase)
              .Append(",\"heapBytes\":").Append(System.GC.GetTotalMemory(false))
              .Append(",\"tmpRebuildsPerSecond\":").Append((_tmpChanges / seconds).ToString("0.#", inv))
              .Append(",\"uiLayoutQueueMean\":").Append(_layoutQ == null ? "null" : (_layoutQueue / frames).ToString("0.##", inv))
              .Append(",\"uiGraphicQueueMean\":").Append(_graphicQ == null ? "null" : (_graphicQueue / frames).ToString("0.##", inv))
              .Append(",\"uiLayoutQueueMax\":").Append(_layoutMax).Append(",\"uiGraphicQueueMax\":").Append(_graphicMax)
              .Append(",\"instanceIdDeltaPerSecond\":").Append((System.Math.Abs(NewInstanceId() - _instanceIdBase) / seconds).ToString("0.#", inv))
              .Append(",\"counters\":{");
            bool first = true;
            foreach (var c in _counters)
            {
                if (!first) sb.Append(','); first = false;
                sb.Append('"').Append(c.Name).Append("\":");
                if (!c.Rec.Valid) { sb.Append("null"); continue; }
                sb.Append("{\"mean\":").Append((c.Sum / frames).ToString("0.##", inv)).Append(",\"max\":").Append(c.Max).Append('}');
            }
            sb.Append("}}");
            string json = sb.ToString();
#if UNITY_WEBGL && !UNITY_EDITOR
            RhPerf_SetUnity(json);
#else
            Debug.Log("[perf] " + json);
#endif
        }

        /// <summary>Page: count what is alive right now (expensive scene scan, on request only, outside measured windows).</summary>
        public void Census(string unused)
        {
            var cam = Camera.main;
            var planes = cam != null ? GeometryUtility.CalculateFrustumPlanes(cam) : null;
            int psAll = 0, psPlaying = 0, psAlive = 0, psOffscreenPlaying = 0, particles = 0;
            foreach (var ps in FindObjectsByType<ParticleSystem>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                psAll++; if (!ps.isPlaying) continue; psPlaying++; int n = ps.particleCount; particles += n; if (n > 0) psAlive++;
                var r = ps.GetComponent<ParticleSystemRenderer>(); if (r != null && planes != null && !GeometryUtility.TestPlanesAABB(planes, r.bounds)) psOffscreenPlaying++;
            }
            int lights = 0, lightsOn = 0, lightsGlobal = 0, lightsShadow = 0;
            foreach (var l in FindObjectsByType<Light2D>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                lights++; if (!l.enabled) continue; lightsOn++; if (l.lightType == Light2D.LightType.Global) lightsGlobal++; if (l.shadowsEnabled) lightsShadow++;
            }
            int renderers = 0, renderersOn = 0, visible = 0, onscreen = 0, sprites = 0, meshes = 0, tmp = 0, offscreenOn = 0;
            foreach (var r in FindObjectsByType<Renderer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                renderers++; if (!r.enabled) continue; renderersOn++;
                if (r.isVisible) visible++;
                bool inView = planes == null || GeometryUtility.TestPlanesAABB(planes, r.bounds); if (inView) onscreen++; else offscreenOn++;
                if (r is SpriteRenderer) sprites++; else if (r is MeshRenderer) { meshes++; if (r.GetComponent<TMPro.TMP_Text>() != null) tmp++; }
            }
            int canvases = 0, canvasesOn = 0, graphics = 0, raycast = 0, uiText = 0;
            foreach (var c in FindObjectsByType<Canvas>(FindObjectsInactive.Exclude, FindObjectsSortMode.None)) { canvases++; if (c.enabled) canvasesOn++; }
            foreach (var g in FindObjectsByType<UnityEngine.UI.Graphic>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            { graphics++; if (g.raycastTarget) raycast++; if (g is TMPro.TMP_Text) uiText++; }
            int audio = 0, audioPlaying = 0;
            foreach (var a in FindObjectsByType<AudioSource>(FindObjectsInactive.Exclude, FindObjectsSortMode.None)) { audio++; if (a.isPlaying) audioPlaying++; }
            int animators = FindObjectsByType<Animator>(FindObjectsInactive.Exclude, FindObjectsSortMode.None).Length;
            int bodies = FindObjectsByType<Rigidbody2D>(FindObjectsInactive.Exclude, FindObjectsSortMode.None).Length;
            int colliders = FindObjectsByType<Collider2D>(FindObjectsInactive.Exclude, FindObjectsSortMode.None).Length;
            int cameras = 0; foreach (var c in FindObjectsByType<Camera>(FindObjectsInactive.Exclude, FindObjectsSortMode.None)) if (c.enabled) cameras++;
            int casters = FindObjectsByType<ShadowCaster2D>(FindObjectsInactive.Exclude, FindObjectsSortMode.None).Length;
            int objects = FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None).Length;
            int textures = 0; long texBytes = 0;
            foreach (var t in Resources.FindObjectsOfTypeAll<Texture>()) { textures++; texBytes += UnityEngine.Profiling.Profiler.GetRuntimeMemorySizeLong(t); }
            int materials = Resources.FindObjectsOfTypeAll<Material>().Length;
            var sb = new StringBuilder(1024);
            sb.Append("{\"particleSystems\":").Append(psAll).Append(",\"particleSystemsPlaying\":").Append(psPlaying).Append(",\"particleSystemsWithParticles\":").Append(psAlive)
              .Append(",\"particleSystemsPlayingOffscreen\":").Append(psOffscreenPlaying).Append(",\"particles\":").Append(particles)
              .Append(",\"light2d\":").Append(lights).Append(",\"light2dOn\":").Append(lightsOn).Append(",\"light2dGlobal\":").Append(lightsGlobal).Append(",\"light2dShadows\":").Append(lightsShadow)
              .Append(",\"shadowCasters2d\":").Append(casters)
              .Append(",\"renderers\":").Append(renderers).Append(",\"renderersEnabled\":").Append(renderersOn).Append(",\"renderersVisible\":").Append(visible)
              .Append(",\"renderersInFrustum\":").Append(onscreen).Append(",\"renderersEnabledOffscreen\":").Append(offscreenOn)
              .Append(",\"spriteRenderers\":").Append(sprites).Append(",\"meshRenderers\":").Append(meshes).Append(",\"worldText\":").Append(tmp)
              .Append(",\"canvases\":").Append(canvases).Append(",\"canvasesEnabled\":").Append(canvasesOn).Append(",\"uiGraphics\":").Append(graphics)
              .Append(",\"uiRaycastTargets\":").Append(raycast).Append(",\"uiText\":").Append(uiText)
              .Append(",\"audioSources\":").Append(audio).Append(",\"audioPlaying\":").Append(audioPlaying).Append(",\"animators\":").Append(animators)
              .Append(",\"rigidbodies2d\":").Append(bodies).Append(",\"colliders2d\":").Append(colliders).Append(",\"camerasEnabled\":").Append(cameras)
              .Append(",\"transforms\":").Append(objects).Append(",\"textures\":").Append(textures).Append(",\"textureBytes\":").Append(texBytes)
              .Append(",\"materials\":").Append(materials)
              .Append(",\"screen\":[").Append(Screen.width).Append(',').Append(Screen.height).Append("]}");
#if UNITY_WEBGL && !UNITY_EDITOR
            RhPerf_SetCensus(sb.ToString());
#else
            Debug.Log("[perf census] " + sb);
#endif
        }

        void OnDestroy()
        {
            if (_instance != this) return;
            Quality.Changed -= PublishRow; _instance = null; PerfMarks.On = false;
            if (_hooked)
            {
                Canvas.preWillRenderCanvases -= OnUiStart; Canvas.willRenderCanvases -= OnUiEnd;
                TMPro.TMPro_EventManager.TEXT_CHANGED_EVENT.Remove(OnTextChanged);
                foreach (var c in _counters) c.Rec.Dispose();
                _counters.Clear();
            }
        }
    }
}
