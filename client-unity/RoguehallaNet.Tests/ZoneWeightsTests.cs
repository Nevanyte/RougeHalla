using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    public class ZoneWeightsTests
    {
        // 20 x 20, left half Fire (1), right half Frost (4), a one-tile ring of region 0 around the edge.
        static byte[] TwoZones(out int w, out int h)
        {
            w = 20; h = 20; var r = new byte[w * h];
            for (int y = 1; y < h - 1; y++) for (int x = 1; x < w - 1; x++) r[y * w + x] = (byte)(x < 10 ? 1 : 4);
            return r;
        }

        [Test] public void Weights_sum_to_one_inside_and_deep_inside_a_zone_is_pure()
        {
            var regions = TwoZones(out int w, out int h); var p = ZoneWeights.Bake(regions, w, h);
            for (int y = 2; y < h - 2; y++) for (int x = 2; x < w - 2; x++)
            {
                double tx = x + .5, ty = y + .5; float sum = 0; for (int k = 1; k <= 6; k++) sum += ZoneWeights.Sample(p[k], w, h, tx, ty);
                Assert.AreEqual(1f, sum, .02f, "at " + x + "," + y);
            }
            Assert.Greater(ZoneWeights.Sample(p[1], w, h, 4.5, 10.5), .97f);
            Assert.Greater(ZoneWeights.Sample(p[4], w, h, 15.5, 10.5), .97f);
        }

        [Test] public void A_straight_border_is_a_wider_ramp_than_one_tile_and_monotonic()
        {
            var regions = TwoZones(out int w, out int h); var p = ZoneWeights.Bake(regions, w, h);
            float prev = 1f; int rampTexels = 0;
            for (int i = 0; i <= 80; i++)
            {
                double tx = 6 + i * .1; float v = ZoneWeights.Sample(p[1], w, h, tx, 10.5);
                Assert.LessOrEqual(v, prev + 1e-4f, "monotonic at " + tx); prev = v;
                if (v > .05f && v < .95f) rampTexels++;
            }
            Assert.Greater(rampTexels * .1f, 1.8f, "the ramp is wider than one tile (the old staircase)");
        }

        [Test] public void A_diagonal_border_has_no_one_tile_steps()
        {
            // A diagonal: Fire where x + y < 20. The old bilinear-of-tiles tint had a visible 1 tile staircase; here neighbouring samples
            // half a tile apart along the border normal differ by far less than a tile step would.
            int w = 20, h = 20; var r = new byte[w * h];
            for (int y = 1; y < h - 1; y++) for (int x = 1; x < w - 1; x++) r[y * w + x] = (byte)(x + y < 20 ? 1 : 4);
            var p = ZoneWeights.Bake(r, w, h); float maxJump = 0;
            for (int i = 0; i < 160; i++)
            {
                double t = 4 + i * .05; float a = ZoneWeights.Sample(p[1], w, h, t, 19.0 - t), b = ZoneWeights.Sample(p[1], w, h, t + .05, 19.0 - t - .05);
                maxJump = System.Math.Max(maxJump, System.Math.Abs(a - b));
            }
            Assert.Less(maxJump, .2f);
        }
    }
}
