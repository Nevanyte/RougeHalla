// Batch-mode screenshot harness for the region atmosphere (editor only): builds the real ArenaView from the seed-1 map planes, drops a few
// actors in view and renders chosen spots with the URP 2D pipeline (global light, volume, sun shaders, shadows, accent lights, particles).
//   Unity -batchmode -projectPath <p> -executeMethod Roguehalla.Client.AtmospherePreviewCapture.Run -atmData <dir> -atmOut <dir>
//       [-atmSpots name:tx:ty,...] [-atmUrl "?fx.shadows=0"] [-atmW 1920 -atmH 1080]
// <dir> holds seed1.tiles.bin, seed1.terrain.bin, seed1.regions.bin (row-major bytes, 160 x 160).
#if UNITY_EDITOR
using System;using System.Collections.Generic;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public static class AtmospherePreviewCapture
    {
        [Serializable] class MapJson { public int w, h; public int[] tiles, terrain, regionGrid; }
        [Serializable] class MapFile { public MapJson map; }
        static string Arg(string name, string fallback)
        {
            var a = Environment.GetCommandLineArgs();
            for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
            return fallback;
        }

        public static void Run()
        {
            try { RunInner(); }
            catch (Exception e) { Debug.LogError("AtmospherePreviewCapture failed: " + e); EditorApplication.Exit(1); return; }
            EditorApplication.Exit(0);
        }

        static void RunInner()
        {
            if (Arg("-atmPropPad", "1") == "0") RegionPropArt.DebugNoPadding = true;      // evidence only: paint props in their nominal cells like before the clipping fix
            string data = Arg("-atmData", ""), outDir = Arg("-atmOut", "/tmp/atm-out"); Directory.CreateDirectory(outDir);
            MapBlob map;
            string json = Arg("-atmMap", "");      // a rh-map/2 fixture (seed1.map.json or seed2.map.json); terrain effects on (mode All) unless -atmMode 0
            byte mode = Arg("-atmMode", "2") == "0" ? MapBlob.GroundTerrainOff : MapBlob.GroundTerrainAll;
            if (json.Length > 0)
            {
                var m = JsonUtility.FromJson<MapFile>(File.ReadAllText(json)).map;
                byte[] B(int[] a) { var o = new byte[a.Length]; for (int i = 0; i < a.Length; i++) o[i] = (byte)a[i]; return o; }
                map = new MapBlob((ushort)m.w, (ushort)m.h, B(m.tiles), B(m.terrain), B(m.regionGrid), mode);
            }
            else map = new MapBlob(160, 160, File.ReadAllBytes(Path.Combine(data, "seed1.tiles.bin")), File.ReadAllBytes(Path.Combine(data, "seed1.terrain.bin")),
                File.ReadAllBytes(Path.Combine(data, "seed1.regions.bin")), mode);
            var camGo = new GameObject("Camera"); var cam = camGo.AddComponent<Camera>();
            cam.orthographic = true; cam.orthographicSize = float.Parse(Arg("-atmOrtho", "9")); cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = new Color32(0x14, 0x17, 0x1b, 255);
            cam.allowHDR = true; camGo.AddComponent<UniversalAdditionalCameraData>().renderPostProcessing = true;
            var arenaGo = new GameObject("Arena"); var arena = arenaGo.AddComponent<ArenaView>();
            typeof(ArenaView).GetMethod("Awake", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(arena, null);
            AtmosphereQuality.SetUrl(Arg("-atmUrl", "")); AtmosphereQuality.ApplyPreset(ShowcaseQuality.High, false);
            arena.Build(map);
            if (Arg("-atmParticles", "1") == "0") { AtmosphereQuality.ParticleDensity = 0f; arena.Atmosphere.Particles.RefreshQuality(); }     // judge the ground without the haze
            int width = int.Parse(Arg("-atmW", "1920")), height = int.Parse(Arg("-atmH", "1080"));
            string spots = Arg("-atmSpots", "frost:108:127,fire:20:70,plague:42:116,holy:86:31,sentenced:132:62,coliseum:79:79");
            var rt = new RenderTexture(width, height, 24, RenderTextureFormat.ARGBHalf) { name = "capture" };
            foreach (var spot in spots.Split(','))
            {
                var p = spot.Split(':'); if (p.Length < 2) continue;
                float tx, ty;
                if (p[1].StartsWith("@"))      // @art: the first prop placement of that art (e.g. @plague.tree), nearest the map centre
                {
                    var best = default(RegionProps.Placement); float bd = float.MaxValue; bool any = false;
                    foreach (var pl in RegionProps.Scatter(map)) if (pl.Art == p[1].Substring(1)) { float d = Mathf.Abs(pl.X - map.W * .5f) + Mathf.Abs(pl.Y - map.H * .5f); if (d < bd) { bd = d; best = pl; any = true; } }
                    if (!any) continue; tx = best.X; ty = best.Y + (p.Length > 2 ? float.Parse(p[2]) : 2.5f);
                    Debug.Log("AtmospherePreviewCapture: " + p[1] + " at " + best.X + "," + best.Y);
                }
                else { if (p.Length < 3) continue; tx = float.Parse(p[1]); ty = float.Parse(p[2]); }
                arena.Regions.SnapLocal(tx * 32f, ty * 32f);
                var remote = new List<InterpActor>();
                var faction = (FactionId)Mathf.Clamp(arena.Regions.LocalRegion == RegionId.Frost ? 3 : (int)arena.Regions.LocalRegion - 1, 0, 4);
                for (int i = 0; i < 3; i++)
                    remote.Add(new InterpActor { Id = (uint)(10 + i), Faction = (FactionId)((i + 1) % 5), Status = ActorStatus.Alive, Weapon = WeaponId.Sword, HpPct = (byte)(90 - i * 25),
                        X = (tx + 3.5f - i * 2.6f) * 32f, Y = (ty + 2.2f + i * .8f) * 32f, Facing = i * 1.2f, Kind = ActorKind.Player });
                var me = new SelfView { Id = 1, Faction = faction, X = tx * 32f, Y = ty * 32f, Hp = 900, MaxHp = 985, Weapon = WeaponId.Sword, Status = ActorStatus.Alive };
                arena.Present(remote, me, null, 0.4f);
                arena.Follow(cam, tx * 32f, ty * 32f);
                for (int k = 0; k < 4; k++) arena.Atmosphere.OnFollow(cam, 1f);     // converge the eased light/fades (no frames run in batch mode)
                cam.targetTexture = rt;
                for (int k = 0; k < 2; k++) cam.Render();
                RenderTexture.active = rt;
                var tex = new Texture2D(width, height, TextureFormat.RGBA32, false);
                tex.ReadPixels(new Rect(0, 0, width, height), 0, 0); tex.Apply();
                File.WriteAllBytes(Path.Combine(outDir, p[0] + ".png"), tex.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(tex); RenderTexture.active = null; cam.targetTexture = null;
                var at = arena.Atmosphere;
                Debug.Log("AtmospherePreviewCapture: " + p[0] + " region=" + arena.LocalRegion + " lights=" + at.Lights.ActiveCount + " clusters=" + at.Lights.Planner.Count +
                    " shadowChunksVisible=" + at.Shadows.VisibleChunks + " baked=" + at.Shadows.BakedChunks + " particles=" + at.Particles.ParticleCount + " playing=" + at.Particles.Playing + " layers=" + at.Particles.Describe());
            }
        }
    }
}
#endif
