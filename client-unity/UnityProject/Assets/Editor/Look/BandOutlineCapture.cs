// Editor-only render for the band outline check (P-UNITY-GROUND-BANDS-1; NOT in the gate, needs graphics). Builds ONE 60 x 60 Plague map with a 6 x 4 bog pool and the server's marsh bands
// round it (water 7 at Chebyshev distance 1, mud 8 at 2..3: the rules in crates/rh-mapdress/rules/zones.json, laid on Floor tiles only), and renders the ground only, three times, through
// LookCapture.RenderMap: band-with.png (the bands), band-without.png (the same map with an empty variant plane), band-without2.png (a second render of that, the noise of one tree).
//   Unity -batchmode -projectPath <p> -executeMethod Roguehalla.Editor.BandOutlineCapture.Run -bandOut <dir> -logFile <log>
// Run it through client-unity/UnityProject/Tools/band-outline-check.sh, which then measures the PNGs with band-outline-measure.py.
using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using Roguehalla.Client;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Editor
{
    public static class BandOutlineCapture
    {
        public const int N = 60;
        /// <summary>The bog pool, tiles [PoolX0, PoolX1] x [PoolY0, PoolY1] inclusive; the camera centres on its middle, 60 px per tile across and 46.8 down on 1920 x 1080.</summary>
        public const int PoolX0 = 27, PoolX1 = 32, PoolY0 = 28, PoolY1 = 31;

        public static MapBlob PoolMap(bool withBands)
        {
            var tiles = new byte[N * N]; var terrain = new byte[N * N]; var regions = new byte[N * N]; var plane = new byte[N * N];
            for (int i = 0; i < regions.Length; i++) regions[i] = 3;
            for (int y = PoolY0; y <= PoolY1; y++) for (int x = PoolX0; x <= PoolX1; x++) terrain[y * N + x] = (byte)TerrainKind.Bog;
            if (withBands)
                for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
                {
                    if (terrain[y * N + x] != 0) continue;
                    int d = Math.Max(Math.Max(PoolX0 - x, x - PoolX1), Math.Max(PoolY0 - y, y - PoolY1));
                    plane[y * N + x] = (byte)(d == 1 ? 7 : d >= 2 && d <= 3 ? 8 : 0);
                }
            var map = new MapBlob(N, N, tiles, terrain, regions, MapBlob.GroundTerrainAll);
            return map.WithPublic(null, null, null, new[] { new MapProp(1, 64, 64, 0, 0) }, plane);   // one prop: a non-empty prop list is what makes the client treat the map as dressed
        }

        static string Arg(string name)
        {
            var a = Environment.GetCommandLineArgs();
            for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
            return "";
        }

        static IEnumerable<object> RunInner()
        {
            string dir = Arg("-bandOut"); if (dir.Length == 0) throw new ArgumentException("-bandOut <dir> is required");
            Directory.CreateDirectory(dir);
            float cx = (PoolX0 + PoolX1 + 1) / 2f, cy = (PoolY0 + PoolY1 + 1) / 2f;
            LookCapture.RenderMap(PoolMap(true), Path.Combine(dir, "band-with.png"), cx, cy, 9f, true); yield return null;
            LookCapture.RenderMap(PoolMap(false), Path.Combine(dir, "band-without.png"), cx, cy, 9f, true); yield return null;
            LookCapture.RenderMap(PoolMap(false), Path.Combine(dir, "band-without2.png"), cx, cy, 9f, true); yield return null;
        }

        public static void Run()
        {
            var it = RunInner().GetEnumerator(); int idle = 0;
            UnityEditor.EditorApplication.CallbackFunction step = null;
            step = () =>
            {
                if (++idle < 3) return;
                try { if (it.MoveNext()) { UnityEditor.EditorApplication.QueuePlayerLoopUpdate(); return; } }
                catch (Exception e) { Debug.LogError("BandOutlineCapture failed: " + e); UnityEditor.EditorApplication.update -= step; UnityEditor.EditorApplication.Exit(1); return; }
                UnityEditor.EditorApplication.update -= step; UnityEditor.EditorApplication.Exit(0);
            };
            UnityEditor.EditorApplication.update += step;
        }
    }
}
