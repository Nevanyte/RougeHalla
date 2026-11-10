using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Pure selection and crossfade state machine for one audio channel (music or ambience). It owns no Unity audio: the runtime asks
    /// <see cref="TryTakeLoad"/> what to fetch, reports <see cref="MarkReady"/> / <see cref="MarkFailed"/>, calls <see cref="Tick"/> and
    /// mirrors <see cref="Track"/> and <see cref="Gain"/> onto AudioSources. Three decks, so a request that arrives mid-crossfade never
    /// has to steal a deck that is still audible in the common case. The old track keeps playing until the new one is ready
    /// (a slow or failed download never causes silence). Nothing allocates after construction except the first sight of an id.
    /// </summary>
    public sealed class CrossfadeChannel
    {
        public const int Decks = 3;
        public enum Status : byte { Unknown, Loading, Ready, Failed }
        public readonly string[] Track = new string[Decks];
        public readonly float[] Gain = new float[Decks];
        public float FadeSeconds = 2f;
        public System.Func<string, string> Fallback;   // id -> fallback id (or null) when a file fails
        readonly Dictionary<string, Status> _status = new Dictionary<string, Status>();
        string _wanted; int _incoming = -1;

        public string Wanted { get { return _wanted; } }
        /// <summary>Deck currently fading in / holding the full-volume track, or -1 when the channel is fading to silence.</summary>
        public int IncomingDeck { get { return _incoming; } }
        public Status StatusOf(string id) { return id != null && _status.TryGetValue(id, out var s) ? s : Status.Unknown; }

        /// <summary>Equal-power curve: gains cross at about 0.707 each, so a crossfade has no loudness dip.</summary>
        public static float Curve(float g) { return Mathf.Sin(Mathf.Clamp01(g) * Mathf.PI * .5f); }

        public void Request(string id) { _wanted = string.IsNullOrEmpty(id) ? null : id; }

        /// <summary>The id that should currently be playing: the wanted id, or its fallback when the wanted file failed.</summary>
        public string Target()
        {
            string t = _wanted; int guard = 0;
            while (t != null && StatusOf(t) == Status.Failed && guard++ < 4) t = Fallback != null ? Fallback(t) : null;
            return t;
        }

        /// <summary>If the target has not been requested yet, mark it Loading and return its id so the caller starts the download.</summary>
        public bool TryTakeLoad(out string id)
        {
            id = Target();
            if (id == null || StatusOf(id) != Status.Unknown) { id = null; return false; }
            _status[id] = Status.Loading; return true;
        }
        /// <summary>Mark an extra id (a prefetch) as loading; false if it was already known.</summary>
        public bool TryBeginPrefetch(string id)
        {
            if (id == null || StatusOf(id) != Status.Unknown) return false;
            _status[id] = Status.Loading; return true;
        }
        public void MarkReady(string id) { if (id != null) _status[id] = Status.Ready; }
        public void MarkFailed(string id) { if (id != null) _status[id] = Status.Failed; }
        /// <summary>Forget a loaded id (cache eviction) so it can be fetched again. Ignored while a deck holds it.</summary>
        public bool Evict(string id)
        {
            if (InUse(id) || StatusOf(id) != Status.Ready) return false;
            _status.Remove(id); return true;
        }
        public bool InUse(string id) { for (int i = 0; i < Decks; i++) if (Track[i] == id && id != null) return true; return false; }
        public bool AnyAudible { get { for (int i = 0; i < Decks; i++) if (Track[i] != null && Gain[i] > .001f) return true; return false; } }

        public void Tick(float dt)
        {
            dt = Mathf.Max(0f, dt); float step = dt / Mathf.Max(.01f, FadeSeconds);
            string target = Target();
            if (target == null)
            {
                _incoming = -1;   // nothing wanted (or all failed with no fallback): fade out whatever plays
            }
            else if (StatusOf(target) == Status.Ready && (_incoming < 0 || Track[_incoming] != target))
            {
                int deck = -1;
                for (int i = 0; i < Decks; i++) if (Track[i] == target) { deck = i; break; }   // coming back to a track still fading out
                if (deck < 0)
                {
                    for (int i = 0; i < Decks && deck < 0; i++) if (Track[i] == null) deck = i;
                    if (deck < 0) { float low = float.MaxValue; for (int i = 0; i < Decks; i++) if (i != _incoming && Gain[i] < low) { low = Gain[i]; deck = i; } }
                    Track[deck] = target; Gain[deck] = 0f;
                }
                _incoming = deck;
            }
            for (int i = 0; i < Decks; i++)
            {
                if (Track[i] == null) continue;
                if (i == _incoming) Gain[i] = Mathf.Min(1f, Gain[i] + step);
                else { Gain[i] = Mathf.Max(0f, Gain[i] - step); if (Gain[i] <= 0f) { Track[i] = null; } }
            }
        }
    }
}
