using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>The baked ground shadow is gone from every actor sprite the game draws (owner decision 2026-11-10; docs/rework/CONTRAST_GATE.md, docs/art/LICENCE_LEDGER.md).</summary>
    public sealed class ActorShadowStripEditModeTests
    {
        static byte[] Pixels(string path, out int w, out int h)
        {
            var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
            Assert.IsTrue(tex.LoadImage(File.ReadAllBytes(path), false), path);
            w = tex.width; h = tex.height;
            var c = tex.GetPixels32(); var b = new byte[c.Length * 4];
            for (int i = 0; i < c.Length; i++) { b[i * 4] = c[i].r; b[i * 4 + 1] = c[i].g; b[i * 4 + 2] = c[i].b; b[i * 4 + 3] = c[i].a; }
            Object.DestroyImmediate(tex); return b;
        }

        static int Offenders(byte[] px, int w, int h)
        {
            int bad = 0;
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                int a = px[(y * w + x) * 4 + 3]; if (a == 0 || a >= ActorShadowStrip.OpaqueMin) continue;
                bool near = false;
                for (int dy = -1; dy <= 1 && !near; dy++) for (int dx = -1; dx <= 1; dx++)
                {
                    int xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                    if (px[(yy * w + xx) * 4 + 3] >= ActorShadowStrip.OpaqueMin) { near = true; break; }
                }
                if (!near) bad++;
            }
            return bad;
        }

        [Test] public void ARealSourceSheetLosesItsShadowAndKeepsEveryOpaquePixel()
        {
            foreach (string sheet in new[] { "knight", "hero" })
            {
                var px = Pixels("Assets/Art/Derived/Flare/" + sheet + ".png", out int w, out int h);
                int soft = 0, nonZero = 0; for (int i = 3; i < px.Length; i += 4) { if (px[i] > 0) nonZero++; if (px[i] > 0 && px[i] < ActorShadowStrip.OpaqueMin) soft++; }
                Assert.That(soft / (float)nonZero, Is.GreaterThan(.25f), sheet + ": the source carries a baked shadow");
                var before = (byte[])px.Clone();
                int cleared = ActorShadowStrip.Strip(px, w, h);
                Assert.That(cleared, Is.GreaterThan(soft / 2), sheet);
                Assert.That(Offenders(px, w, h), Is.EqualTo(0), sheet + ": no semi-transparent pixel farther than 1 px from an opaque one");
                for (int i = 0; i < px.Length; i += 4) if (before[i + 3] >= ActorShadowStrip.OpaqueMin) for (int c = 0; c < 4; c++) Assert.AreEqual(before[i + c], px[i + c], sheet + ": opaque pixels unchanged");
            }
        }

        [Test] public void EveryLiveActorAtlasIsFreeOfTheBakedShadow()
        {
            string[] dirs = Directory.GetDirectories("Assets/Art/Derived/ShowcaseLive/Atlases");
            int checkedAtlases = 0;
            foreach (var dir in dirs) foreach (var png in Directory.GetFiles(dir, "*.png"))
            {
                var px = Pixels(png, out int w, out int h);
                Assert.That(Offenders(px, w, h), Is.EqualTo(0), png);
                checkedAtlases++;
            }
            Assert.That(checkedAtlases, Is.EqualTo(12), "one atlas per live appearance, no stale ones");
        }
    }
}
