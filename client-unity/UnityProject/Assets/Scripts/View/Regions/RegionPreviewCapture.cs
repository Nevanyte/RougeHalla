// Batch-mode screenshot harness for the region art (editor only): builds ArenaView from raw map planes and renders chosen spots to
// PNG with the real URP 2D pipeline, so ground, walls and props can be reviewed in about a minute without a WebGL build.
//   Unity -batchmode -projectPath <p> -executeMethod Roguehalla.Client.RegionPreviewCapture.Run -regionData <dir> -regionOut <dir> [-regionSpots name:tx:ty,...]
// <dir> holds seed1.tiles.bin, seed1.terrain.bin, seed1.regions.bin (row-major bytes, 160 x 160).
#if UNITY_EDITOR
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public static class RegionPreviewCapture
    {
        static string Arg(string name, string fallback)
        {
            var a = Environment.GetCommandLineArgs();
            for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
            return fallback;
        }

        public static void Run()
        {
            try { RunInner(); }
            catch (Exception e) { UnityEngine.Debug.LogError("RegionPreviewCapture failed: " + e); EditorApplication.Exit(1); return; }
            EditorApplication.Exit(0);
        }

        static void RunInner()
        {
            string data = Arg("-regionData", ""), outDir = Arg("-regionOut", "/tmp/region-out");
            Directory.CreateDirectory(outDir);
            var map = new MapBlob(160, 160, File.ReadAllBytes(Path.Combine(data, "seed1.tiles.bin")),
                File.ReadAllBytes(Path.Combine(data, "seed1.terrain.bin")), File.ReadAllBytes(Path.Combine(data, "seed1.regions.bin")), MapBlob.GroundTerrainOff);
            var camGo = new GameObject("Camera"); var cam = camGo.AddComponent<Camera>();
            cam.orthographic = true; cam.orthographicSize = float.Parse(Arg("-regionOrtho", "9")); cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = new Color32(0x14, 0x17, 0x1b, 255);
            cam.allowHDR = true; camGo.AddComponent<UniversalAdditionalCameraData>().renderPostProcessing = true;
            var arenaGo = new GameObject("Arena"); var arena = arenaGo.AddComponent<ArenaView>();
            typeof(ArenaView).GetMethod("Awake", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(arena, null);
            var sw = Stopwatch.StartNew();
            File.WriteAllBytes(Path.Combine(outDir, "_atlas_walls.png"), RegionWallAtlas.Atlas.EncodeToPNG());
            File.WriteAllBytes(Path.Combine(outDir, "_atlas_props.png"), RegionPropArt.Atlas.EncodeToPNG());
            UnityEngine.Debug.Log("RegionPreviewCapture: atlases took " + sw.ElapsedMilliseconds + " ms");
            sw.Restart();
            string dbg = Arg("-regionDebug", "0");
            arena.Build(map);
            if (dbg == "1") foreach (var mr in arenaGo.GetComponentsInChildren<MeshRenderer>()) if (mr.sharedMaterial != null && mr.sharedMaterial.HasProperty("_Debug")) mr.sharedMaterial.SetFloat("_Debug", 1f);
            UnityEngine.Debug.Log("RegionPreviewCapture: Build took " + sw.ElapsedMilliseconds + " ms");
            string spots = Arg("-regionSpots", "frost_lake:107:100,frost_spawn:103:126,frost_plain:120:118,fire_lava:12:75,plague:45:112,holy:87:30,sentenced:125:50,coliseum:80:80,border_frost_plague:72:125");
            int width = int.Parse(Arg("-regionW", "1920")), height = int.Parse(Arg("-regionH", "1080"));
            var rt = new RenderTexture(width, height, 24, RenderTextureFormat.ARGBHalf) { name = "capture" };
            foreach (var spot in spots.Split(','))
            {
                var p = spot.Split(':'); if (p.Length < 3) continue;
                float tx = float.Parse(p[1]), ty = float.Parse(p[2]);
                arena.Follow(cam, tx * 32f, ty * 32f);
                cam.targetTexture = rt;
                for (int k = 0; k < 2; k++) cam.Render();
                RenderTexture.active = rt;
                var tex = new Texture2D(width, height, TextureFormat.RGBA32, false);
                tex.ReadPixels(new Rect(0, 0, width, height), 0, 0); tex.Apply();
                File.WriteAllBytes(Path.Combine(outDir, p[0] + ".png"), tex.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(tex);
                RenderTexture.active = null; cam.targetTexture = null;
                UnityEngine.Debug.Log("RegionPreviewCapture: wrote " + p[0] + " region=" + arena.RegionAt(new Vector3(tx, -ty * ArenaView.GroundSquash, 0)));
            }
        }
    }
}
#endif
