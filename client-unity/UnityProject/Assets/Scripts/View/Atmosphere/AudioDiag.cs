using System;
using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Audio debugging switches read once from the page URL. <c>?audiolog=1</c> logs every region request, load, play and fade decision with
    /// a "[audio]" prefix (the browser probe reads them); <c>?audiodiag=a,b</c> turns individual audio behaviours off so a console defect
    /// can be bisected in a real browser. Unknown flags are ignored. Presentation only.
    /// </summary>
    public static class AudioDiag
    {
        static HashSet<string> _flags; static bool _log, _read;
        /// <summary>Test hook: receives each log line instead of (as well as) the console.</summary>
        public static Action<string> Sink;

        static void Read()
        {
            if (_read) return; _read = true; _flags = new HashSet<string>();
            string url = ""; try { url = Application.absoluteURL ?? ""; } catch (Exception) { }
            int q = url.IndexOf('?'); if (q < 0) return;
            foreach (var pair in url.Substring(q + 1).Split('&'))
            {
                int eq = pair.IndexOf('='); string k = eq < 0 ? pair : pair.Substring(0, eq), v = eq < 0 ? "" : pair.Substring(eq + 1);
                if (string.Equals(k, "audiolog", StringComparison.OrdinalIgnoreCase)) _log = v == "1";
                else if (string.Equals(k, "audiodiag", StringComparison.OrdinalIgnoreCase)) foreach (var f in v.Split(',')) if (f.Length > 0) _flags.Add(f.ToLowerInvariant());
            }
        }
        /// <summary>A flag of the form name123 gives 123 (e.g. audiodiag=delay600); fallback when absent.</summary>
        public static int Number(string name, int fallback)
        {
            Read(); foreach (var f in _flags) if (f.StartsWith(name) && int.TryParse(f.Substring(name.Length), out int v)) return v;
            return fallback;
        }
        /// <summary>
        /// The mixer group to route a source to. The Web audio backend has no FMOD channel-group routing: every Play on a source with an
        /// output mixer group logged FMOD errors 78 (getSystemObject) and 36 (getSoftwareFormat). The mixer only holds plain 0 dB attenuation
        /// groups, so on the Web player sources are left unrouted (audiodiag=usegroup restores it for comparison).
        /// </summary>
        public static UnityEngine.Audio.AudioMixerGroup RouteGroup(UnityEngine.Audio.AudioMixerGroup group)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            return Has("usegroup") ? group : null;
#else
            return group;
#endif
        }
        /// <summary>Probe only: while true, game cue sounds and other actors' footsteps are not played (step auditions stay audible).</summary>
        public static bool Isolate;
        public static bool Has(string flag) { Read(); return _flags.Contains(flag); }
        public static bool Logging { get { Read(); return _log || Sink != null; } }
        public static void Line(string s)
        {
            if (!Logging) return;
            string line = "t=" + Time.unscaledTime.ToString("0.00") + " " + s;
            if (_log) Debug.Log("[audio] " + line);
            var sink = Sink; if (sink != null) sink(line);
        }
    }
}
