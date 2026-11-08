// Builds the scene from code so the project needs no authored scene content: it runs
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
            camGo.AddComponent<AudioListener>();
            cam.orthographic = true;
            cam.orthographicSize = 9f;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color32(0x14, 0x17, 0x1b, 255);
            cam.allowHDR = true;
            cam.transform.position = new Vector3(24, -14, -30);
            cam.gameObject.AddComponent<UnityEngine.Rendering.Universal.UniversalAdditionalCameraData>().renderPostProcessing = true;
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = -1;
            camGo.tag = "MainCamera";

            if (Query(s, "preview", "0") == "1")
            {
                new GameObject("Presentation study").AddComponent<ShowcasePreview>().Initialize(cam);
                return;
            }

            var go = new GameObject("Match");
            var arenaGo = new GameObject("Arena");
            var arena = arenaGo.AddComponent<ArenaView>();
            var mc = go.AddComponent<MatchClient>();
            mc.Arena = arena;
            mc.Cam = cam;
            go.AddComponent<ShowcaseSoundscape>().Initialize(mc);
            mc.Url = Query(s, "server", DefaultUrl);
            mc.Profile = Query(s, "profile", "web" + UnityEngine.Random.Range(1000, 9999));
            mc.Token = Query(s, "token", Guid.NewGuid().ToString("N"));
            ulong hash; if (ulong.TryParse(Query(s, "hash", BakedContent.Hash.ToString(System.Globalization.CultureInfo.InvariantCulture)), out hash)) mc.ContentHash = hash;
            int faction; if (int.TryParse(Query(s, "faction", "4"), out faction)) mc.Faction = faction;
            // Explicit profile keeps existing automated/browser links joining immediately. Ordinary visits show the menu.
            mc.AutoJoin = Query(s, "auto", Query(s, "profile", "") != "" ? "1" : "0") == "1";
        }
    }
}
