using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

namespace Roguehalla.Client
{
    /// <summary>
    /// Streams per-region music and ambience from StreamingAssets/Audio (separate files, never in the first-load data) and crossfades
    /// them with two <see cref="CrossfadeChannel"/>s. Started only once the local player has a region (match running); the current
    /// region's files load first, the others lazily in the background, with a small clip cache. Never blocks and never throws: a
    /// missing file or a blocked browser audio context simply leaves the existing beds playing. Volumes reuse the existing
    /// ShowcaseSettings music and ambience sliders.
    /// </summary>
    public sealed class AtmosphereAudio
    {
        public const string Folder = "Audio", Extension = ".mp3";
        const int CacheLimit = 4; const float PrefetchEvery = 10f;
        readonly MonoBehaviour _host;
        readonly CrossfadeChannel _music = new CrossfadeChannel { FadeSeconds = 2f }, _ambience = new CrossfadeChannel { FadeSeconds = 2f };
        readonly AudioSource[] _musicSources = new AudioSource[CrossfadeChannel.Decks], _ambienceSources = new AudioSource[CrossfadeChannel.Decks];
        readonly System.Collections.Generic.Dictionary<string, AudioClip> _clips = new System.Collections.Generic.Dictionary<string, AudioClip>();
        readonly System.Collections.Generic.Dictionary<string, float> _lastUsed = new System.Collections.Generic.Dictionary<string, float>();
        float _prefetchIn = PrefetchEvery; bool _warned;
        public CrossfadeChannel Music { get { return _music; } }
        public CrossfadeChannel Ambience { get { return _ambience; } }
        /// <summary>True once streamed music is audible (the legacy beds are muted then).</summary>
        public bool TookOverMusic { get; private set; }
        public bool TookOverAmbience { get; private set; }

        public AtmosphereAudio(MonoBehaviour host, Transform parent)
        {
            _host = host;
            _music.Fallback = _ambience.Fallback = id => id == "music_coliseum" ? null : id.StartsWith("music_") ? "music_coliseum" : null;
            for (int i = 0; i < CrossfadeChannel.Decks; i++) { _musicSources[i] = MakeSource(parent, "Atmosphere music " + i); _ambienceSources[i] = MakeSource(parent, "Atmosphere ambience " + i); }
        }

        static AudioSource MakeSource(Transform parent, string name)
        {
            var go = new GameObject(name); go.transform.SetParent(parent, false);
            var s = go.AddComponent<AudioSource>(); s.playOnAwake = false; s.loop = true; s.spatialBlend = 0f; s.volume = 0f; return s;
        }

        public static string UrlFor(string id)
        {
            string path = Application.streamingAssetsPath + "/" + Folder + "/" + id + Extension;
            return path.Contains("://") ? path : "file://" + path;
        }

        /// <summary>Request a region's beds; null (no match running, audio switched off) fades to silence and fetches nothing.</summary>
        public void SetRegion(RegionAtmosphereRow row)
        {
            _music.Request(AtmosphereQuality.Audio && row != null ? row.Music : null);
            _ambience.Request(AtmosphereQuality.Audio && row != null ? row.Ambience : null);
        }

        public void Tick(float dt, float now)
        {
            if (AtmosphereQuality.Audio) { Poll(_music); Poll(_ambience); Prefetch(dt); }
            _music.Tick(dt); _ambience.Tick(dt);
            var settings = ShowcaseSettings.Current;
            float mv = settings != null ? settings.MusicVolume : .72f, av = settings != null ? settings.AmbienceVolume : .62f;
            Mirror(_music, _musicSources, mv, now); Mirror(_ambience, _ambienceSources, av, now);
            if (!TookOverMusic && _music.AnyAudible) TookOverMusic = true;
            if (!TookOverAmbience && _ambience.AnyAudible) TookOverAmbience = true;
        }

        void Poll(CrossfadeChannel ch)
        {
            if (ch.TryTakeLoad(out string id)) _host.StartCoroutine(Load(ch, id));
        }

        void Prefetch(float dt)
        {
            if (!_music.AnyAudible || (_music.Target() != null && _music.StatusOf(_music.Target()) != CrossfadeChannel.Status.Ready)) return;
            _prefetchIn -= dt; if (_prefetchIn > 0f) return;
            _prefetchIn = PrefetchEvery;
            foreach (var id in RegionAtmosphereTable.AllAudioIds)
            {
                var ch = id.StartsWith("music_") ? _music : _ambience;
                if (CountReady(ch) >= CacheLimit) continue;
                if (ch.TryBeginPrefetch(id)) { _host.StartCoroutine(Load(ch, id)); return; }
            }
        }

        int CountReady(CrossfadeChannel ch)
        {
            int n = 0; foreach (var id in _clips.Keys) if ((id.StartsWith("music_") ? _music : _ambience) == ch) n++; return n;
        }

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
                    if (req.result == UnityWebRequest.Result.Success) { clip = DownloadHandlerAudioClip.GetContent(req); ok = clip != null && clip.length > .5f; }
                    else Warn(id, req.error);
                }
                catch (System.Exception e) { Warn(id, e.Message); }
                req.Dispose();
            }
            if (!ok) { ch.MarkFailed(id); yield break; }
            clip.name = id; _clips[id] = clip; ch.MarkReady(id);
        }

        void Warn(string id, string why)
        {
            if (_warned) return; _warned = true;   // one line, never spam
            Debug.LogWarning("Atmosphere audio: '" + id + "' unavailable (" + why + "); keeping existing audio.");
        }

        void Mirror(CrossfadeChannel ch, AudioSource[] sources, float userVolume, float now)
        {
            for (int i = 0; i < sources.Length; i++)
            {
                var s = sources[i]; if (s == null) continue;
                string id = ch.Track[i];
                if (id == null) { if (s.isPlaying) s.Stop(); s.clip = null; continue; }
                if (!_clips.TryGetValue(id, out var clip)) continue;
                _lastUsed[id] = now;
                if (s.clip != clip) { s.clip = clip; s.volume = 0f; try { s.Play(); } catch (System.Exception) { } }
                else if (!s.isPlaying && ch.Gain[i] > 0f) { try { s.Play(); } catch (System.Exception) { } }
                s.volume = CrossfadeChannel.Curve(ch.Gain[i]) * userVolume;
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
            foreach (var s in _musicSources) if (s != null) s.Stop();
            foreach (var s in _ambienceSources) if (s != null) s.Stop();
            foreach (var c in _clips.Values) if (c != null) Object.Destroy(c);
            _clips.Clear();
        }
    }
}
