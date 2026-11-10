using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Networking;

namespace Roguehalla.Client
{
    /// <summary>
    /// Browser-side playback of the streamed beds (Assets/Plugins/WebGL/RhBeds.jslib). The Unity Web audio path cannot be used for them:
    /// a clip made by UnityWebRequestMultimedia is not decoded when it is handed over, so the engine logs "Trying to get length of sound
    /// which is not loaded yet" on every load and FMOD errors 78 and 36 on every call made too early. The browser decodes and plays them
    /// instead; outside the Web player (Editor, standalone) the AudioSource path below is used.
    /// </summary>
    static class WebBeds
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern int RhBeds_Available();
        [DllImport("__Internal")] static extern void RhBeds_Load(string id, string url, float startSeconds, float endSeconds);
        [DllImport("__Internal")] static extern int RhBeds_State(string id);
        [DllImport("__Internal")] static extern float RhBeds_Duration(string id);
        [DllImport("__Internal")] static extern void RhBeds_Start(int deck, string id, float offset);
        [DllImport("__Internal")] static extern void RhBeds_SetGain(int deck, float gain);
        [DllImport("__Internal")] static extern void RhBeds_Stop(int deck);
        [DllImport("__Internal")] static extern void RhBeds_Evict(string id);
        public static bool Available { get { try { return RhBeds_Available() == 1; } catch (System.Exception) { return false; } } }
        public static void Load(string id, string url, float startSeconds, float endSeconds) { RhBeds_Load(id, url, startSeconds, endSeconds); }
        /// <summary>-1 unknown, 0 loading, 1 ready, 2 failed.</summary>
        public static int State(string id) { return RhBeds_State(id); }
        public static float Duration(string id) { return RhBeds_Duration(id); }
        public static void Start(int deck, string id, float offset) { RhBeds_Start(deck, id, offset); }
        public static void SetGain(int deck, float gain) { RhBeds_SetGain(deck, gain); }
        public static void Stop(int deck) { RhBeds_Stop(deck); }
        public static void Evict(string id) { RhBeds_Evict(id); }
#else
        public static bool Available { get { return false; } }
        public static void Load(string id, string url, float startSeconds, float endSeconds) { }
        public static int State(string id) { return -1; }
        public static float Duration(string id) { return 0f; }
        public static void Start(int deck, string id, float offset) { }
        public static void SetGain(int deck, float gain) { }
        public static void Stop(int deck) { }
        public static void Evict(string id) { }
#endif
    }

    /// <summary>
    /// Streams per-region music and ambience from StreamingAssets/Audio (separate files, never in the first-load data) and crossfades
    /// them with two <see cref="CrossfadeChannel"/>s. Started only once the local player's region is known and settled (RegionAudioGate):
    /// nothing is requested during launch, planning or results. Only the current region's files are fetched (a small cache keeps visited
    /// regions). Never blocks and never throws: a missing file logs one warning and leaves the existing beds playing, with no retry.
    /// Volumes reuse the ShowcaseSettings music and ambience sliders; per-file trims (AudioTrims) even out the loudness.
    /// </summary>
    public sealed class AtmosphereAudio
    {
        public const string Folder = "Audio", Extension = ".mp3";
        const int CacheLimit = 4; const float LoadTimeout = 20f, RetryPlayEvery = 2f;
        readonly MonoBehaviour _host;
        readonly CrossfadeChannel _music = new CrossfadeChannel { FadeSeconds = 2f }, _ambience = new CrossfadeChannel { FadeSeconds = 2f };
        readonly AudioSource[] _musicSources = new AudioSource[CrossfadeChannel.Decks], _ambienceSources = new AudioSource[CrossfadeChannel.Decks];
        readonly Dictionary<string, AudioClip> _clips = new Dictionary<string, AudioClip>();
        readonly HashSet<string> _webReady = new HashSet<string>();
        readonly string[] _webStarted = new string[CrossfadeChannel.Decks * 2];
        readonly Dictionary<string, float> _lastUsed = new Dictionary<string, float>();
        readonly float[] _nextRetry = new float[CrossfadeChannel.Decks * 2];
        readonly bool _web;
        bool _warned, _forced; RegionAtmosphereRow _row;
        float _interiorTarget, _interior;
        public CrossfadeChannel Music { get { return _music; } }
        public CrossfadeChannel Ambience { get { return _ambience; } }
        /// <summary>True when the browser plays the beds (Web player) rather than AudioSources.</summary>
        public bool UsesWebBeds { get { return _web; } }
        /// <summary>True once streamed music is audible (the legacy beds are muted then).</summary>
        public bool TookOverMusic { get; private set; }
        public bool TookOverAmbience { get; private set; }
        public const float InteriorAmbienceGain = .55f;

        public AtmosphereAudio(MonoBehaviour host, Transform parent)
        {
            _host = host;
            _web = WebBeds.Available && !AudioDiag.Has("unitybeds");
            _music.Fallback = _ambience.Fallback = id => id == "music_coliseum" ? null : id.StartsWith("music_") ? "music_coliseum" : null;
            if (!_web) for (int i = 0; i < CrossfadeChannel.Decks; i++) { _musicSources[i] = MakeSource(parent, "Atmosphere music " + i); _ambienceSources[i] = MakeSource(parent, "Atmosphere ambience " + i); }
            AudioDiag.Line("beds backend=" + (_web ? "browser" : "unity"));
        }

        static AudioSource MakeSource(Transform parent, string name)
        {
            var go = new GameObject(name); go.transform.SetParent(parent, false);
            var s = go.AddComponent<AudioSource>(); s.playOnAwake = false; s.loop = true; s.spatialBlend = 0f; s.volume = 0f; return s;
        }

        public static string UrlFor(string id)
        {
            string path = Application.streamingAssetsPath + "/" + Folder + "/" + id + Extension;
            return path.Contains("://") || _webPath ? path : "file://" + path;
        }
        static bool _webPath { get { return Application.platform == RuntimePlatform.WebGLPlayer; } }

        /// <summary>Request a region's beds; null (no match running, region unknown, audio switched off) fades to silence and fetches nothing.</summary>
        public void SetRegion(RegionAtmosphereRow row)
        {
            if (_forced) return;
            if (row != _row) { _row = row; AudioDiag.Line("set-region " + (row != null ? row.Name : "none") + " music=" + (row != null ? row.Music : null)); }
            _music.Request(AtmosphereQuality.Audio && row != null ? row.Music : null);
            _ambience.Request(AtmosphereQuality.Audio && row != null ? row.Ambience : null);
        }

        /// <summary>0..1 how far the local player is inside the Holy temple: the outside ambience is softened there (a gain, not a per-source filter: effects are unreliable on the Web audio backend).</summary>
        public void SetInterior(float weight) { _interiorTarget = Mathf.Clamp01(weight); }

        /// <summary>Debug/probe only (?audiolog=1): play exactly these ids (null = none) regardless of the region.</summary>
        public void Force(string music, string ambience)
        {
            _forced = true; _music.Request(music); _ambience.Request(ambience);
            AudioDiag.Line("force music=" + music + " ambience=" + ambience);
        }
        public void ReleaseForced() { _forced = false; }

        /// <summary>Debug/probe only: jump every playing bed to this many seconds before its end, to measure the loop seam.</summary>
        public void SeekEnd(float secondsBeforeEnd)
        {
            if (_web)
            {
                for (int slot = 0; slot < _webStarted.Length; slot++)
                {
                    var id = _webStarted[slot]; if (id == null) continue;
                    float len = WebBeds.Duration(id), to = Mathf.Max(0f, len - secondsBeforeEnd);
                    WebBeds.Start(slot, id, to); AudioDiag.Line("seek " + id + " to=" + to.ToString("0.00") + " length=" + len.ToString("0.00"));
                }
                return;
            }
            foreach (var set in new[] { _musicSources, _ambienceSources })
                foreach (var s in set)
                    if (s != null && s.clip != null && s.isPlaying && s.clip.loadState == AudioDataLoadState.Loaded)
                    { float to = Mathf.Max(0f, s.clip.length - secondsBeforeEnd); s.time = to; AudioDiag.Line("seek " + s.clip.name + " to=" + to.ToString("0.00") + " length=" + s.clip.length.ToString("0.00")); }
        }

        public void Tick(float dt, float now)
        {
            if (AtmosphereQuality.Audio) { Poll(_music); Poll(_ambience); }
            _music.Tick(dt); _ambience.Tick(dt);
            var settings = ShowcaseSettings.Current;
            float mv = settings != null ? settings.MusicVolume : .72f, av = settings != null ? settings.AmbienceVolume : .62f;
            _interior += ((_forced ? 0f : _interiorTarget) - _interior) * (1f - Mathf.Exp(-dt / .8f)); av *= Mathf.Lerp(1f, InteriorAmbienceGain, _interior);
            if (_web) { MirrorWeb(_music, 0, mv, now); MirrorWeb(_ambience, CrossfadeChannel.Decks, av, now); }
            else { Mirror(_music, _musicSources, mv, now); Mirror(_ambience, _ambienceSources, av, now); }
            if (!TookOverMusic && _music.AnyAudible) TookOverMusic = true;
            if (!TookOverAmbience && _ambience.AnyAudible) TookOverAmbience = true;
        }

        void Poll(CrossfadeChannel ch)
        {
            if (ch.TryTakeLoad(out string id)) _host.StartCoroutine(_web ? LoadWeb(ch, id) : Load(ch, id));
        }

        // ---- browser backend ----
        IEnumerator LoadWeb(CrossfadeChannel ch, string id)
        {
            AudioDiag.Line("load " + id);
            float loopStart, loopEnd; Roguehalla.Net.AudioLoops.For(id, out loopStart, out loopEnd);
            WebBeds.Load(id, UrlFor(id), loopStart, loopEnd);
            float waited = 0f; int state = 0;
            while (waited < LoadTimeout) { state = WebBeds.State(id); if (state != 0) break; waited += Time.unscaledDeltaTime; yield return null; }
            bool ok = state == 1;
            AudioDiag.Line("loaded " + id + " ok=" + ok + " state=" + state);
            if (!ok) { Warn(id, state == 2 ? "download or decode failed" : "timed out"); ch.MarkFailed(id); yield break; }
            _webReady.Add(id); ch.MarkReady(id);
        }

        void MirrorWeb(CrossfadeChannel ch, int slotBase, float userVolume, float now)
        {
            for (int i = 0; i < CrossfadeChannel.Decks; i++)
            {
                int slot = slotBase + i; string id = ch.Track[i];
                if (id == null) { if (_webStarted[slot] != null) { WebBeds.Stop(slot); _webStarted[slot] = null; } continue; }
                if (!_webReady.Contains(id)) continue;
                _lastUsed[id] = now;
                if (_webStarted[slot] != id) { _webStarted[slot] = id; WebBeds.Start(slot, id, 0f); AudioDiag.Line("play " + id + " deck=" + slot); }
                WebBeds.SetGain(slot, CrossfadeChannel.Curve(ch.Gain[i]) * userVolume * Roguehalla.Net.AudioTrims.Gain(id));
            }
            if (_webReady.Count > CacheLimit * 2)
            {
                string oldest = null; float t = float.MaxValue;
                foreach (var key in _webReady) { var c2 = key.StartsWith("music_") ? _music : _ambience; if (c2.InUse(key)) continue; float u; _lastUsed.TryGetValue(key, out u); if (u < t) { t = u; oldest = key; } }
                if (oldest != null) { var c3 = oldest.StartsWith("music_") ? _music : _ambience; if (c3.Evict(oldest)) { WebBeds.Evict(oldest); _webReady.Remove(oldest); _lastUsed.Remove(oldest); } }
            }
        }

        // ---- Unity AudioSource backend (Editor, standalone) ----
        IEnumerator Load(CrossfadeChannel ch, string id)
        {
            UnityWebRequest req = null; AudioClip clip = null; bool ok = false;
            // MP3, not Ogg: the Unity WebGL player rejects Ogg ("Streaming of 'ogg' on this platform is not supported") and decodes MP3 through the browser.
            const AudioType type = AudioType.MPEG;
            try { req = UnityWebRequestMultimedia.GetAudioClip(UrlFor(id), type); }
            catch (System.Exception e) { Warn(id, e.Message); }
            if (req != null)
            {
                var op = req.SendWebRequest();
                while (!op.isDone) yield return null;
                try
                {
                    if (req.result == UnityWebRequest.Result.Success) clip = DownloadHandlerAudioClip.GetContent(req);
                    else Warn(id, req.error);
                }
                catch (System.Exception e) { Warn(id, e.Message); }
                req.Dispose();
            }
            if (clip != null)
            {
                if (clip.loadState == AudioDataLoadState.Unloaded) clip.LoadAudioData();
                float waited = 0f;
                while (clip != null && (clip.loadState == AudioDataLoadState.Loading || (clip.loadState == AudioDataLoadState.Unloaded && waited < .5f)) && waited < LoadTimeout) { waited += Time.unscaledDeltaTime; yield return null; }
                ok = clip != null && clip.loadState == AudioDataLoadState.Loaded;
                if (!ok) Warn(id, "decode " + (clip != null ? clip.loadState.ToString() : "lost"));
            }
            AudioDiag.Line("loaded " + id + " ok=" + ok);
            if (!ok) { ch.MarkFailed(id); yield break; }
            clip.name = id; _clips[id] = clip; ch.MarkReady(id);
        }

        void Warn(string id, string why)
        {
            if (_warned) return; _warned = true;   // one line, never spam
            Debug.LogWarning("Atmosphere audio: '" + id + "' unavailable (" + why + "); keeping existing audio.");
        }

        int RetrySlot(CrossfadeChannel ch, int deck) { return deck + (ch == _ambience ? CrossfadeChannel.Decks : 0); }

        void Mirror(CrossfadeChannel ch, AudioSource[] sources, float userVolume, float now)
        {
            for (int i = 0; i < sources.Length; i++)
            {
                var s = sources[i]; if (s == null) continue;
                string id = ch.Track[i];
                if (id == null) { if (s.clip != null) { s.Stop(); s.clip = null; } continue; }
                if (!_clips.TryGetValue(id, out var clip)) continue;
                _lastUsed[id] = now;
                if (s.clip != clip) { s.clip = clip; s.volume = 0f; AudioDiag.Line("play " + id + " deck=" + i); try { s.Play(); } catch (System.Exception) { } }
                else if (ch.Gain[i] > 0f && now >= _nextRetry[RetrySlot(ch, i)]) { _nextRetry[RetrySlot(ch, i)] = now + RetryPlayEvery; if (!s.isPlaying) { try { s.Play(); } catch (System.Exception) { } } }
                s.volume = CrossfadeChannel.Curve(ch.Gain[i]) * userVolume * Roguehalla.Net.AudioTrims.Gain(id);
            }
            // Evict the least recently used clip nobody plays once over the cache limit.
            if (_clips.Count > CacheLimit * 2)
            {
                string oldest = null; float t = float.MaxValue;
                foreach (var kv in _clips) { var c2 = kv.Key.StartsWith("music_") ? _music : _ambience; if (c2.InUse(kv.Key)) continue; float u; _lastUsed.TryGetValue(kv.Key, out u); if (u < t) { t = u; oldest = kv.Key; } }
                if (oldest != null) { var c3 = oldest.StartsWith("music_") ? _music : _ambience; if (c3.Evict(oldest)) { Object.Destroy(_clips[oldest]); _clips.Remove(oldest); _lastUsed.Remove(oldest); } }
            }
        }

        public void Dispose()
        {
            for (int slot = 0; slot < _webStarted.Length; slot++) if (_webStarted[slot] != null) { WebBeds.Stop(slot); _webStarted[slot] = null; }
            foreach (var s in _musicSources) if (s != null) s.Stop();
            foreach (var s in _ambienceSources) if (s != null) s.Stop();
            foreach (var c in _clips.Values) if (c != null) Object.Destroy(c);
            _clips.Clear(); _webReady.Clear();
        }
    }
}
