// NOT COMPILED in Stage 1 (no Unity). Builds the whole scene from code so the project needs no authored scene content: it runs
// in any (even empty) scene. Query string in WebGL: ?server=wss://host/ws&profile=name&token=secret&hash=<u64>&faction=<0-4>
using System;
using UnityEngine;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace Roguehalla.Client
{
    public static class Bootstrap
    {
        const string DefaultUrl = "ws://127.0.0.1:7777/ws";

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern string RhPage_GetSearch();
        static string Search() { return RhPage_GetSearch(); }
#else
        static string Search() { return ""; }
#endif

        public static string Query(string search, string key, string fallback)
        {
            if (string.IsNullOrEmpty(search)) return fallback;
            foreach (var pair in search.TrimStart('?').Split('&'))
            {
                int eq = pair.IndexOf('=');
                if (eq > 0 && pair.Substring(0, eq) == key) return Uri.UnescapeDataString(pair.Substring(eq + 1).Replace('+', ' '));
            }
            return fallback;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Start()
        {
            string s = Search();
            var camGo = new GameObject("Camera");
            var cam = camGo.AddComponent<Camera>();
            cam.orthographic = true;
            cam.orthographicSize = 9f;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color32(0x14, 0x17, 0x1b, 255);
            camGo.tag = "MainCamera";

            var go = new GameObject("Match");
            var arena = go.AddComponent<ArenaView>();
            var mc = go.AddComponent<MatchClient>();
            mc.Arena = arena;
            mc.Cam = cam;
            mc.Url = Query(s, "server", DefaultUrl);
            mc.Profile = Query(s, "profile", "web" + UnityEngine.Random.Range(1000, 9999));
            mc.Token = Query(s, "token", Guid.NewGuid().ToString("N"));
            ulong hash; if (ulong.TryParse(Query(s, "hash", "0"), out hash)) mc.ContentHash = hash;
            int faction; if (int.TryParse(Query(s, "faction", "-1"), out faction)) mc.Faction = faction;
        }
    }
}
