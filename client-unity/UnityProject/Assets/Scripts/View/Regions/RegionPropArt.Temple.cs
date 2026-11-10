// Props for the generated Holy temple and the coliseum, painted in code like the other region props (no imported art, so no ledger entry).
// Mosque and cathedral architecture only (domes, minaret towers, arches, braziers); no religious symbols.
using System.Collections.Generic;
using UnityEngine;
using static Roguehalla.Client.RegionCanvas;

namespace Roguehalla.Client
{
    public static partial class RegionPropArt
    {
        static void AddTemple(List<Def> l)
        {
            Color sand = P(5, RegionPaletteGenerated.Base), gold = P(5, RegionPaletteGenerated.Accent), key = P(5, RegionPaletteGenerated.Key), green = P(5, RegionPaletteGenerated.Secondary);
            Color stoneL = Mix(sand, key, .62f), stoneM = Mix(sand, key, .35f), stoneD = Shade(Mix(sand, key, .15f), .62f);
            Color gilt = Mix(gold, key, .55f), giltD = Shade(gold, .85f), giltL = Mix(gilt, Color.white, .45f);
            Color shadow = P(5, RegionPaletteGenerated.Shadow);
            // Minaret tower: slender fluted shaft, two balconies, a lantern gallery and a gilded cap with a ball finial.
            Add(l, "temple.minaret", 96, 380, 10, (c, gy) =>
            {
                float cx = 48; c.SoftShadow(cx + 8, gy + 1, 30f, 7f, .38f, Alpha(shadow, 1f));
                var plinth = Box(cx, gy + 9, 24, 9, 2); c.Fill(plinth, Toon(plinth, stoneD, stoneM, stoneL, 6f, .08f, 3), Ink, 1.3f);
                var shaft = Poly(new Vector2(cx - 15, gy + 18), new Vector2(cx - 11, gy + 235), new Vector2(cx + 11, gy + 235), new Vector2(cx + 15, gy + 18));
                c.Fill(shaft, Split(cx - 2, stoneL, Mix(stoneD, stoneM, .35f), 22f), Ink, 1.5f);
                for (int k = -2; k <= 2; k++) c.Fill(Intersect(shaft, Capsule(new Vector2(cx + k * 5.5f, gy + 24), new Vector2(cx + k * 4.6f, gy + 230), .6f, .6f)), Flat(Alpha(stoneD, .4f)));
                foreach (float by in new[] { 82f, 150f })      // arched window bands
                {
                    var win = Union(Box(cx, gy + by, 4.2f, 9), Circle(cx, gy + by + 9, 4.2f)); c.Fill(win, Flat(Alpha(Shade(green, .55f), .95f)), Alpha(gilt, .9f), 1f);
                }
                foreach (float by in new[] { 112f, 196f })      // balconies
                {
                    var bal = Box(cx, gy + by, 21, 4.5f, 1.5f); c.Fill(bal, Toon(bal, giltD, gilt, giltL, 4f), Ink, 1.2f);
                    for (int k = -3; k <= 3; k++) c.Fill(Capsule(new Vector2(cx + k * 5.6f, gy + by + 4), new Vector2(cx + k * 5.6f, gy + by + 13), .8f, .8f), Flat(Alpha(giltD, .9f)));
                    c.Fill(Box(cx, gy + by + 14, 21, 1.4f), Flat(giltD));
                }
                var gallery = Box(cx, gy + 250, 17, 15, 2); c.Fill(gallery, Toon(gallery, stoneD, stoneM, stoneL, 6f, .08f, 4), Ink, 1.3f);
                c.Fill(Union(Box(cx - 8, gy + 250, 3.2f, 8), Box(cx + 8, gy + 250, 3.2f, 8), Box(cx, gy + 250, 3.2f, 8)), Flat(Alpha(Shade(green, .5f), .95f)));
                var cap = Poly(new Vector2(cx - 18, gy + 264), new Vector2(cx - 12, gy + 296), new Vector2(cx, gy + 338), new Vector2(cx + 12, gy + 296), new Vector2(cx + 18, gy + 264));
                c.Fill(cap, Toon(cap, giltD, gilt, giltL, 16f, .06f, 5), Ink, 1.4f);
                c.Fill(Circle(cx, gy + 344, 5), Toon(Circle(cx, gy + 344, 5), giltD, gilt, giltL, 5f), Ink, 1f);
                c.Fill(Capsule(new Vector2(cx, gy + 346), new Vector2(cx, gy + 362), 1.2f, .5f), Flat(gilt), Ink, .8f);
                c.Glow(cx, gy + 250, 22f, key, .2f);
            }, true);
            // Dome: a gilded onion dome on a pierced drum. Sits on a pillar block's cap.
            Add(l, "temple.dome", 192, 150, 6, (c, gy) =>
            {
                float cx = 96;
                var drum = Box(cx, gy + 14, 56, 14, 2); c.Fill(drum, Toon(drum, stoneD, stoneM, stoneL, 7f, .08f, 6), Ink, 1.3f);
                for (int k = -3; k <= 3; k++) c.Fill(Union(Box(cx + k * 15, gy + 12, 3.2f, 6), Circle(cx + k * 15, gy + 18, 3.2f)), Flat(Alpha(Shade(green, .5f), .95f)));
                var dome = Union(Ellipse(cx, gy + 50, 50, 38), Box(cx, gy + 34, 50, 10));
                var clip = Box(cx, gy + 80, 80, 54);
                var d2 = Intersect(dome, Offset(clip, 0, 0));
                c.Fill(d2, Toon(d2, giltD, gilt, giltL, 40f, .05f, 7, 0f, .3f), Ink, 1.6f);
                for (int k = -2; k <= 2; k++) c.Fill(Intersect(d2, Capsule(new Vector2(cx + k * 15, gy + 30), new Vector2(cx + k * 3.5f, gy + 86), .6f, .5f)), Flat(Alpha(giltD, .55f)));
                c.Fill(Capsule(new Vector2(cx, gy + 86), new Vector2(cx, gy + 116), 3f, 1f), Flat(gilt), Ink, 1f);
                c.Fill(Circle(cx, gy + 118, 4.5f), Toon(Circle(cx, gy + 118, 4.5f), giltD, gilt, giltL, 4f), Ink, 1f);
            }, true);
            // Brazier: bronze bowl on a tripod with a live flame; the warm pool on the floor comes from the ground shader.
            Add(l, "temple.brazier", 64, 96, 8, (c, gy) =>
            {
                float cx = 32; c.SoftShadow(cx + 4, gy + 1, 18f, 4f, .35f, Alpha(shadow, 1f));
                foreach (float dx in new[] { -10f, 0f, 10f }) c.Fill(Capsule(new Vector2(cx + dx * .3f, gy + 24), new Vector2(cx + dx, gy + 1), 1.6f, 1.2f), Flat(giltD), Ink, 1f);
                var bowl = Poly(new Vector2(cx - 15, gy + 36), new Vector2(cx - 9, gy + 22), new Vector2(cx + 9, gy + 22), new Vector2(cx + 15, gy + 36));
                c.Fill(bowl, Toon(bowl, giltD, gilt, giltL, 8f), Ink, 1.2f);
                Color fire = Mix(P(1, RegionPaletteGenerated.Accent), key, .35f);
                c.Glow(cx, gy + 50, 26f, fire, .5f);
                var flame = Poly(new Vector2(cx - 9, gy + 36), new Vector2(cx - 5, gy + 52), new Vector2(cx, gy + 66), new Vector2(cx + 4, gy + 52), new Vector2(cx + 9, gy + 36));
                c.Fill(flame, (x, y, d) => Mix(Mix(fire, Color.white, .6f), fire, Mathf.Clamp01((y - gy - 36) / 28f)), Alpha(Shade(fire, .5f), .7f), .8f);
            });
        }

        static void AddColiseum(List<Def> l)
        {
            Color stone = P(6, RegionPaletteGenerated.Base), stoneD = Shade(stone, .55f), stoneL = Mix(stone, Color.white, .25f), wood = P(6, RegionPaletteGenerated.Secondary);
            Color cloth = P(6, RegionPaletteGenerated.Accent), clothL = Mix(cloth, Color.white, .3f), clothD = Shade(cloth, .6f);
            Color iron = new Color(.16f, .17f, .2f), ironL = Mix(iron, Color.white, .3f), shadow = P(6, RegionPaletteGenerated.Shadow);
            Color flame = Mix(P(1, RegionPaletteGenerated.Accent), P(5, RegionPaletteGenerated.Key), .35f);
            // Banner on a pole: burgundy cloth with a gold band and a swallow-tail, standing against the arena wall.
            Add(l, "col.banner", 72, 150, 6, (c, gy) =>
            {
                float cx = 36; c.SoftShadow(cx + 3, gy + 1, 12f, 3.5f, .3f, Alpha(shadow, 1f));
                c.Fill(Capsule(new Vector2(cx, gy + 2), new Vector2(cx, gy + 128), 1.8f, 1.5f), Flat(wood), Ink, 1f);
                c.Fill(Capsule(new Vector2(cx - 18, gy + 124), new Vector2(cx + 18, gy + 124), 1.6f, 1.6f), Flat(Shade(wood, 1.2f)), Ink, 1f);
                var cl = Poly(new Vector2(cx - 17, gy + 122), new Vector2(cx + 17, gy + 122), new Vector2(cx + 17, gy + 60), new Vector2(cx, gy + 74), new Vector2(cx - 17, gy + 60));
                c.Fill(cl, Split(cx - 4, clothL, clothD, 18f), Ink, 1.3f);
                c.Fill(Intersect(cl, Box(cx, gy + 108, 18, 3)), Flat(Mix(P(5, RegionPaletteGenerated.Accent), P(5, RegionPaletteGenerated.Key), .6f)));
                c.Fill(Circle(cx, gy + 92, 6), Flat(Alpha(Mix(P(5, RegionPaletteGenerated.Accent), P(5, RegionPaletteGenerated.Key), .6f), .95f)), Ink, .8f);
            }, true);
            // Torch stand: iron tripod with a bowl of fire.
            Add(l, "col.torch", 56, 110, 6, (c, gy) =>
            {
                float cx = 28; c.SoftShadow(cx + 3, gy + 1, 12f, 3.5f, .32f, Alpha(shadow, 1f));
                c.Fill(Capsule(new Vector2(cx, gy + 2), new Vector2(cx, gy + 62), 2.2f, 1.6f), Flat(iron), Ink, 1f);
                foreach (float dx in new[] { -9f, 9f }) c.Fill(Capsule(new Vector2(cx, gy + 34), new Vector2(cx + dx, gy + 3), 1.4f, 1.2f), Flat(iron), Ink, .9f);
                var bowl = Poly(new Vector2(cx - 11, gy + 70), new Vector2(cx - 6, gy + 58), new Vector2(cx + 6, gy + 58), new Vector2(cx + 11, gy + 70));
                c.Fill(bowl, Toon(bowl, Shade(iron, .6f), iron, ironL, 6f), Ink, 1.1f);
                c.Glow(cx, gy + 82, 22f, flame, .5f);
                var fl = Poly(new Vector2(cx - 7, gy + 70), new Vector2(cx - 3, gy + 82), new Vector2(cx, gy + 96), new Vector2(cx + 3, gy + 82), new Vector2(cx + 7, gy + 70));
                c.Fill(fl, (x, y, d) => Mix(Mix(flame, Color.white, .6f), flame, Mathf.Clamp01((y - gy - 70) / 26f)), Alpha(Shade(flame, .5f), .7f), .8f);
            });
            // Weapon rack: timber frame holding spears and swords.
            Add(l, "col.rack", 104, 84, 6, (c, gy) =>
            {
                float cx = 52; c.SoftShadow(cx + 4, gy + 1, 32f, 4f, .3f, Alpha(shadow, 1f));
                c.Fill(Box(cx - 38, gy + 28, 3, 28), Flat(wood), Ink, 1f); c.Fill(Box(cx + 38, gy + 28, 3, 28), Flat(wood), Ink, 1f);
                c.Fill(Box(cx, gy + 52, 41, 3), Flat(Shade(wood, 1.15f)), Ink, 1f); c.Fill(Box(cx, gy + 22, 41, 2.5f), Flat(Shade(wood, 1.15f)), Ink, 1f);
                for (int k = 0; k < 6; k++)
                {
                    float x = cx - 30 + k * 12; float top = gy + 70 + (k % 2) * 6;
                    c.Fill(Capsule(new Vector2(x, gy + 8), new Vector2(x + (k - 2.5f) * .8f, top), 1.1f, 1.1f), Flat(Shade(wood, 1.3f)), Ink, .8f);
                    var tip = Poly(new Vector2(x - 2.5f + (k - 2.5f) * .8f, top), new Vector2(x + 2.5f + (k - 2.5f) * .8f, top), new Vector2(x + (k - 2.5f) * .8f, top + 9));
                    c.Fill(tip, Toon(tip, Shade(ironL, .6f), ironL, Color.white, 3f), Ink, .8f);
                }
            });
        }
    }
}
