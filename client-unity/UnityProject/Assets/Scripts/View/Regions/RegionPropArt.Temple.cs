// Props for the generated Holy temple and the coliseum, painted in code like the other region props (no imported art, so no ledger entry).
// Mosque and cathedral architecture only (minaret towers, colonnade columns, portal jambs, a mihrab niche, lamps, screens); no religious symbols.
// No domes, roofs or finials: nothing is drawn over the floor between the piers (the vaulting is light and shade on the floor).
using System.Collections.Generic;
using UnityEngine;
using static Roguehalla.Client.RegionCanvas;

namespace Roguehalla.Client
{
    public static partial class RegionPropArt
    {
        static void AddTemple(List<Def> l)
        {
            Color key = P(5, RegionPaletteGenerated.Key), green = TempleStyle.Tile;
            Color stoneL = TempleStyle.StoneLight, stoneM = TempleStyle.Stone, stoneD = TempleStyle.StoneDark;
            Color gilt = TempleStyle.Gilt, giltD = TempleStyle.GiltDark, giltL = Mix(gilt, Color.white, .45f);
            Color shadow = TempleStyle.Shadow;
            Color glass = TempleStyle.Glass;
            // Minaret tower: slender fluted shaft, two balconies, a lantern gallery and a gilded cap with a ball finial (a tall corner landmark; fades near actors).
            Add(l, "temple.minaret", 96, 380, 10, (c, gy) =>
            {
                float cx = 48; c.SoftShadow(cx + 8, gy + 1, 30f, 7f, .38f, Alpha(shadow, 1f));
                var plinth = Box(cx, gy + 9, 24, 9, 2); c.Fill(plinth, Toon(plinth, stoneD, stoneM, stoneL, 6f, .08f, 3), Ink, 1.3f);
                var shaft = Poly(new Vector2(cx - 15, gy + 18), new Vector2(cx - 11, gy + 235), new Vector2(cx + 11, gy + 235), new Vector2(cx + 15, gy + 18));
                c.Fill(shaft, Split(cx - 2, stoneL, Mix(stoneD, stoneM, .35f), 22f), Ink, 1.5f);
                for (int k = -2; k <= 2; k++) c.Fill(Intersect(shaft, Capsule(new Vector2(cx + k * 5.5f, gy + 24), new Vector2(cx + k * 4.6f, gy + 230), .6f, .6f)), Flat(Alpha(stoneD, .4f)));
                foreach (float by in new[] { 82f, 150f })      // arched window bands
                {
                    var win = Union(Box(cx, gy + by, 4.2f, 9), Circle(cx, gy + by + 9, 4.2f)); c.Fill(win, Flat(Alpha(Shade(glass, .55f), .95f)), Alpha(gilt, .9f), 1f);
                }
                foreach (float by in new[] { 112f, 196f })      // balconies
                {
                    var bal = Box(cx, gy + by, 21, 4.5f, 1.5f); c.Fill(bal, Toon(bal, giltD, gilt, giltL, 4f), Ink, 1.2f);
                    for (int k = -3; k <= 3; k++) c.Fill(Capsule(new Vector2(cx + k * 5.6f, gy + by + 4), new Vector2(cx + k * 5.6f, gy + by + 13), .8f, .8f), Flat(Alpha(giltD, .9f)));
                    c.Fill(Box(cx, gy + by + 14, 21, 1.4f), Flat(giltD));
                }
                var gallery = Box(cx, gy + 250, 17, 15, 2); c.Fill(gallery, Toon(gallery, stoneD, stoneM, stoneL, 6f, .08f, 4), Ink, 1.3f);
                c.Fill(Union(Box(cx - 8, gy + 250, 3.2f, 8), Box(cx + 8, gy + 250, 3.2f, 8), Box(cx, gy + 250, 3.2f, 8)), Flat(Alpha(Shade(glass, .5f), .95f)));
                var cap = Poly(new Vector2(cx - 18, gy + 264), new Vector2(cx - 12, gy + 296), new Vector2(cx, gy + 338), new Vector2(cx + 12, gy + 296), new Vector2(cx + 18, gy + 264));
                c.Fill(cap, Toon(cap, giltD, gilt, giltL, 16f, .06f, 5), Ink, 1.4f);
                c.Fill(Circle(cx, gy + 344, 5), Toon(Circle(cx, gy + 344, 5), giltD, gilt, giltL, 5f), Ink, 1f);
                c.Fill(Capsule(new Vector2(cx, gy + 346), new Vector2(cx, gy + 362), 1.2f, .5f), Flat(gilt), Ink, .8f);
                c.Glow(cx, gy + 250, 22f, key, .2f);
            }, true);
            // Colonnade column: slim round shaft with a moulded base and a gilded capital, one every 3 tiles on the arcade line (open between them).
            Add(l, "temple.column", 48, 150, 8, (c, gy) =>
            {
                float cx = 24; c.SoftShadow(cx + 7, gy + 1, 20f, 5f, .34f, Alpha(shadow, 1f));
                var baseS = Box(cx, gy + 6, 14, 6, 1.5f); c.Fill(baseS, Toon(baseS, stoneD, stoneM, stoneL, 4f, .05f, 11), Ink, 1.1f);
                var shaft = Box(cx, gy + 62, 8.5f, 56, 3); c.Fill(shaft, Toon(shaft, stoneD, stoneM, stoneL, 8f, .05f, 12), Ink, 1.2f);
                for (int k = -1; k <= 1; k++) c.Fill(Intersect(shaft, Capsule(new Vector2(cx + k * 3.6f, gy + 14), new Vector2(cx + k * 3.6f, gy + 112), .5f, .5f)), Flat(Alpha(stoneD, .3f)));
                var neck = Box(cx, gy + 121, 11, 3); c.Fill(neck, Flat(giltD), Ink, .8f);
                var cap = Poly(new Vector2(cx - 18, gy + 144), new Vector2(cx - 11, gy + 124), new Vector2(cx + 11, gy + 124), new Vector2(cx + 18, gy + 144));
                c.Fill(cap, Toon(cap, giltD, gilt, giltL, 6f), Ink, 1.1f);
                c.Fill(Box(cx, gy + 145, 19, 2.5f), Flat(Mix(stoneM, giltD, .3f)), Ink, .8f);
            }, true);
            // Portal jamb: a heavy square pier on each side of a grand portal, with an arch springer stub on the portal side.
            Add(l, "temple.gate", 120, 236, 10, (c, gy) =>
            {
                float cx = 60; c.SoftShadow(cx + 10, gy + 1, 46f, 8f, .38f, Alpha(shadow, 1f));
                var plinth = Box(cx, gy + 8, 36, 8, 2); c.Fill(plinth, Toon(plinth, stoneD, stoneM, stoneL, 5f, .06f, 21), Ink, 1.2f);
                var shaft = Box(cx, gy + 98, 30, 84, 1.5f); c.Fill(shaft, Split(cx - 3, Mix(stoneL, stoneM, .35f), Mix(stoneD, stoneM, .4f), 26f), Ink, 1.4f);
                for (int k = 0; k < 7; k++) c.Fill(Box(cx, gy + 22 + k * 24, 30, .45f), Flat(Alpha(stoneD, .35f)));        // ashlar courses
                c.Fill(Box(cx - 22, gy + 98, 4, 80), Flat(Alpha(stoneD, .22f))); c.Fill(Box(cx + 22, gy + 98, 4, 80), Flat(Alpha(stoneD, .22f)));
                var cornice = Box(cx, gy + 188, 36, 6, 1.5f); c.Fill(cornice, Toon(cornice, giltD, gilt, giltL, 4f), Ink, 1.2f);
                var cap = Box(cx, gy + 202, 33, 8, 1.5f); c.Fill(cap, Toon(cap, stoneD, stoneM, stoneL, 5f, .06f, 22), Ink, 1.2f);
                var inner = Poly(new Vector2(cx - 33, gy + 194), new Vector2(cx - 33, gy + 212), new Vector2(cx - 18, gy + 224), new Vector2(cx - 18, gy + 194));
                c.Fill(inner, Toon(inner, stoneD, stoneM, stoneL, 6f), Ink, 1.1f);      // springer stub toward the portal (the span itself is only light and shade on the floor)
                c.Glow(cx, gy + 150, 30f, key, .10f);
            }, true);
            // Mihrab niche: a tall pointed-arch recess framed by two engaged columns, a dark inner field with a glowing gold inlay; the temple's focal landmark.
            Add(l, "temple.mihrab", 232, 262, 8, (c, gy) =>
            {
                float cx = 116; c.SoftShadow(cx + 12, gy + 1, 84f, 8f, .34f, Alpha(shadow, 1f));
                var plinth = Box(cx, gy + 7, 96, 7, 2); c.Fill(plinth, Toon(plinth, stoneD, stoneM, stoneL, 5f, .05f, 31), Ink, 1.2f);
                var wall = Box(cx, gy + 118, 90, 106, 2); c.Fill(wall, Toon(wall, stoneD, stoneM, stoneL, 10f, .05f, 32), Ink, 1.4f);
                for (int k = 1; k < 9; k++) c.Fill(Box(cx, gy + 14 + k * 24, 90, .5f), Flat(Alpha(stoneD, .28f)));
                // pointed arch recess: two arcs meeting at the apex
                Sdf arch = (x, y) => { float half = 40f; float a = Mathf.Abs(x - cx); float top = gy + 128 + (half - a) * 1.55f; float d = Mathf.Max(a - half, y - top); return Mathf.Max(d, gy + 12 - y); };
                Sdf frame = (x, y) => arch(x, y) - 7f;
                c.Fill(frame, Toon(frame, giltD, gilt, giltL, 5f), Ink, 1.2f);
                c.Fill(arch, (x, y, d) => Mix(Mix(Shade(green, .9f), giltD, .35f), Shade(green, .3f), Mathf.Clamp01((y - gy - 10) / 190f)), Alpha(Ink, .9f), 1.3f);
                // two nested pointed-arch outlines (tilework) and a glowing orb of light under the apex; no crossing lines
                c.Fill(Subtract(Grow(arch, -9f), Grow(arch, -10.8f)), Flat(Alpha(giltL, .6f)));
                c.Fill(Subtract(Grow(arch, -19f), Grow(arch, -20.2f)), Flat(Alpha(giltL, .4f)));
                c.Fill(Circle(cx, gy + 132, 11), Flat(Alpha(Mix(giltL, Color.white, .35f), .30f)), Alpha(giltL, .75f), 1f);
                c.Fill(Intersect(arch, Box(cx, gy + 30, 30, 5, 2)), Flat(Alpha(giltL, .25f)));
                foreach (int sg in new[] { -1, 1 })
                {
                    var col = Box(cx + sg * 62, gy + 108, 9, 92, 2); c.Fill(col, Toon(col, stoneD, stoneM, stoneL, 7f, .05f, 33 + sg), Ink, 1.2f);
                    c.Fill(Box(cx + sg * 62, gy + 204, 13, 4), Toon(Box(cx + sg * 62, gy + 204, 13, 4), giltD, gilt, giltL, 3f), Ink, 1f);
                    c.Fill(Box(cx + sg * 62, gy + 18, 13, 5), Flat(giltD), Ink, 1f);
                }
                c.Fill(Box(cx, gy + 232, 100, 5, 1.5f), Toon(Box(cx, gy + 232, 100, 5, 1.5f), giltD, gilt, giltL, 4f), Ink, 1.2f);
                c.Glow(cx, gy + 110, 70f, key, .16f);
            }, true);
            // Lamp stand: slim brass stand with a pierced lantern and a live flame; the warm pool on the floor comes from the pooled accent light.
            Add(l, "temple.lamp", 56, 110, 8, (c, gy) =>
            {
                float cx = 28; c.SoftShadow(cx + 4, gy + 1, 16f, 4f, .32f, Alpha(shadow, 1f));
                foreach (float dx in new[] { -9f, 9f }) c.Fill(Capsule(new Vector2(cx, gy + 22), new Vector2(cx + dx, gy + 1), 1.4f, 1.1f), Flat(giltD), Ink, .9f);
                c.Fill(Capsule(new Vector2(cx, gy + 4), new Vector2(cx, gy + 58), 2.2f, 1.6f), Toon(Capsule(new Vector2(cx, gy + 4), new Vector2(cx, gy + 58), 2.2f, 1.6f), giltD, gilt, giltL, 2f), Ink, .9f);
                var cage = Poly(new Vector2(cx - 9, gy + 62), new Vector2(cx - 6, gy + 84), new Vector2(cx + 6, gy + 84), new Vector2(cx + 9, gy + 62));
                c.Fill(cage, Toon(cage, giltD, gilt, giltL, 5f), Ink, 1f);
                Color fire = Mix(P(1, RegionPaletteGenerated.Accent), key, .45f);
                c.Glow(cx, gy + 74, 26f, fire, .5f);
                var win = Poly(new Vector2(cx - 5, gy + 65), new Vector2(cx - 3.5f, gy + 81), new Vector2(cx + 3.5f, gy + 81), new Vector2(cx + 5, gy + 65));
                c.Fill(win, (x, y, d) => Mix(Mix(fire, Color.white, .75f), fire, Mathf.Clamp01((y - gy - 65) / 16f)), Alpha(giltD, .8f), .7f);
                c.Fill(Circle(cx, gy + 88, 4), Flat(giltD), Ink, .8f);
            }, true);
            // Glazed urn: a big jar with gilt bands, a low floor prop.
            Add(l, "temple.urn", 56, 70, 6, (c, gy) =>
            {
                float cx = 28; c.SoftShadow(cx + 5, gy + 1, 18f, 4.5f, .32f, Alpha(shadow, 1f));
                var body = Union(Ellipse(cx, gy + 22, 17, 20), Box(cx, gy + 5, 10, 5, 2), Box(cx, gy + 42, 8, 4));
                Color glaze = Shade(green, .8f);
                c.Fill(body, Toon(body, Shade(glaze, .55f), glaze, Mix(glaze, Color.white, .4f), 11f, .04f, 41), Ink, 1.2f);
                c.Fill(Intersect(body, Box(cx, gy + 30, 20, 1.6f)), Flat(gilt)); c.Fill(Intersect(body, Box(cx, gy + 15, 20, 1.2f)), Flat(giltD));
                c.Fill(Box(cx, gy + 47, 11, 2.5f), Toon(Box(cx, gy + 47, 11, 2.5f), giltD, gilt, giltL, 2.5f), Ink, .9f);
            });
            // Low stone bench with a teal cushion.
            Add(l, "temple.bench", 104, 50, 6, (c, gy) =>
            {
                float cx = 52; c.SoftShadow(cx + 5, gy + 1, 40f, 5f, .3f, Alpha(shadow, 1f));
                var seat = Box(cx, gy + 13, 38, 7, 2); c.Fill(seat, Toon(seat, stoneD, stoneM, stoneL, 5f, .05f, 51), Ink, 1.1f);
                foreach (int sg in new[] { -1, 1 }) c.Fill(Box(cx + sg * 31, gy + 5, 5, 6), Toon(Box(cx + sg * 31, gy + 5, 5, 6), stoneD, stoneM, stoneL, 4f), Ink, 1f);
                var cushion = Box(cx, gy + 23, 33, 4, 3); c.Fill(cushion, Toon(cushion, Shade(green, .5f), Shade(green, .85f), Mix(green, Color.white, .3f), 4f), Ink, 1f);
            });
            // Pierced screen (mashrabiya): a stone frame with a geometric lattice you can see through, standing on a low base.
            Add(l, "temple.screen", 108, 112, 8, (c, gy) =>
            {
                float cx = 54; c.SoftShadow(cx + 6, gy + 1, 40f, 5f, .3f, Alpha(shadow, 1f));
                var baseS = Box(cx, gy + 6, 44, 6, 1.5f); c.Fill(baseS, Toon(baseS, stoneD, stoneM, stoneL, 4f, .05f, 61), Ink, 1.1f);
                var frame = Box(cx, gy + 52, 42, 40, 2); c.Fill(frame, Flat(Alpha(stoneM, .0f)), Alpha(stoneD, .95f), 1.3f);
                foreach (int sg in new[] { -1, 1 }) { var post = Box(cx + sg * 40, gy + 52, 4, 42, 1.5f); c.Fill(post, Toon(post, stoneD, stoneM, stoneL, 3f), Ink, 1.1f); }
                c.Fill(Box(cx, gy + 96, 44, 4, 1.5f), Toon(Box(cx, gy + 96, 44, 4, 1.5f), giltD, gilt, giltL, 3f), Ink, 1.1f);
                c.Fill(Box(cx, gy + 12, 40, 2.5f), Flat(stoneD));
                // lattice: rotated squares, drawn as thin gilt-stone bars so the gaps stay open
                for (int gx = -3; gx <= 3; gx++) for (int gyi = 0; gyi < 4; gyi++)
                {
                    float px = cx + gx * 11f, py = gy + 24 + gyi * 21f + ((gx & 1) == 0 ? 0f : 10f);
                    var dia = Poly(new Vector2(px - 5.5f, py), new Vector2(px, py + 7f), new Vector2(px + 5.5f, py), new Vector2(px, py - 7f));
                    c.Fill(Subtract(dia, Grow(dia, -1.8f)), Flat(Alpha(Mix(stoneL, gilt, .35f), .95f)));
                }
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
            }, true);
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
