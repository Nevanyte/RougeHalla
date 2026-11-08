using System;
using System.Collections.Generic;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Original, procedural art-only sprites for asset gaps. It never assigns props or defines gameplay.</summary>
    public static class ShowcaseOriginalPropArt
    {
        public readonly struct ArtInfo
        {
            public readonly string Key;
            public readonly string DisplayName;
            public readonly Vector2 MaxArtBounds;
            public readonly Vector2 PivotNormalized;

            internal ArtInfo(string key, string displayName, Vector2 maxArtBounds, Vector2 pivotNormalized)
            {
                Key = key;
                DisplayName = displayName;
                MaxArtBounds = maxArtBounds;
                PivotNormalized = pivotNormalized;
            }
        }

        const int CellSize = 256;
        const int AtlasColumns = 3;
        const int AtlasRows = 3;
        const int AtlasSize = CellSize * AtlasColumns;
        const int PixelsPerUnit = 128;
        const int GroundAnchorY = 16;

        static readonly string[] KeyData =
        {
            "gap.gallows", "gap.stocks", "gap.mushroom-cluster",
            "gap.toxic-bubble-vent", "gap.rusted-pipe", "gap.snow-drift",
            "gap.ice-crack", "gap.stained-glass-fragment", "gap.crater-rim"
        };
        static readonly string[] NameData =
        {
            "Gallows frame", "Stocks", "Mushroom cluster",
            "Toxic bubble vent", "Rusted pipe", "Snow drift",
            "Ice crack", "Stained glass fragment", "Crater rim"
        };
        static readonly Vector2[] BoundsData =
        {
            new Vector2(1.36f, 1.68f), new Vector2(1.26f, 1.34f), new Vector2(1.58f, 1.40f),
            new Vector2(1.66f, .88f), new Vector2(1.72f, 1.12f), new Vector2(1.70f, .86f),
            new Vector2(1.62f, .80f), new Vector2(1.36f, 1.72f), new Vector2(1.72f, .94f)
        };

        static readonly IReadOnlyList<string> KeyView = Array.AsReadOnly(KeyData);
        static readonly Sprite[] CachedSprites = new Sprite[KeyData.Length];
        static Texture2D _atlas;
        static readonly Vector2 GroundPivot = new Vector2(.5f, GroundAnchorY / (float)CellSize);

        public static IReadOnlyList<string> Keys { get { return KeyView; } }
        public static Texture2D SharedAtlas { get { EnsureBuilt(); return _atlas; } }

        public static Sprite Get(string key)
        {
            return TryGet(key, out Sprite sprite) ? sprite : null;
        }

        public static bool TryGet(string key, out Sprite sprite)
        {
            int index = IndexOf(key);
            if (index >= 0)
            {
                EnsureBuilt();
                sprite = CachedSprites[index];
                return sprite != null;
            }
            sprite = null;
            return false;
        }

        public static bool TryGetInfo(string key, out ArtInfo info)
        {
            int index = IndexOf(key);
            if (index >= 0)
            {
                EnsureBuilt();
                info = new ArtInfo(KeyData[index], NameData[index], BoundsData[index], GroundPivot);
                return true;
            }
            info = default;
            return false;
        }

        static int IndexOf(string key)
        {
            if (string.IsNullOrEmpty(key)) return -1;
            for (int i = 0; i < KeyData.Length; i++)
                if (string.Equals(KeyData[i], key, StringComparison.Ordinal)) return i;
            return -1;
        }

        static void EnsureBuilt()
        {
            if (_atlas != null) return;
            var atlasPixels = new Color32[AtlasSize * AtlasSize];
            for (int index = 0; index < KeyData.Length; index++)
            {
                var canvas = new CellPainter(CellSize, index + 117);
                Paint(index, canvas);
                int minX=CellSize,minY=CellSize,maxX=-1,maxY=-1;
                for(int py=0;py<CellSize;py++) for(int px=0;px<CellSize;px++)
                {
                    if(canvas.Pixels[py*CellSize+px].a==0)continue;
                    if(px<2||px>=CellSize-2||py<2||py>=CellSize-2)
                        throw new InvalidOperationException("Original prop reaches filter gutter: "+KeyData[index]);
                    minX=Math.Min(minX,px);minY=Math.Min(minY,py);maxX=Math.Max(maxX,px);maxY=Math.Max(maxY,py);
                }
                BoundsData[index]=new Vector2((maxX-minX+1)/(float)PixelsPerUnit,(maxY-minY+1)/(float)PixelsPerUnit);
                int cellX = (index % AtlasColumns) * CellSize;
                int cellY = (index / AtlasColumns) * CellSize;
                for (int y = 0; y < CellSize; y++)
                    Array.Copy(canvas.Pixels, y * CellSize, atlasPixels, (cellY + y) * AtlasSize + cellX, CellSize);
            }

            _atlas = new Texture2D(AtlasSize, AtlasSize, TextureFormat.RGBA32, false, false)
            {
                name = "Showcase original gap prop atlas",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
                anisoLevel = 1,
                hideFlags = HideFlags.HideAndDontSave
            };
            _atlas.SetPixels32(atlasPixels);
            _atlas.Apply(false, true);

            for (int index = 0; index < CachedSprites.Length; index++)
            {
                int x = (index % AtlasColumns) * CellSize;
                int y = (index / AtlasColumns) * CellSize;
                var sprite = Sprite.Create(_atlas, new Rect(x, y, CellSize, CellSize), GroundPivot,
                    PixelsPerUnit, 0, SpriteMeshType.FullRect, Vector4.zero, false, null);
                sprite.name = KeyData[index];
                sprite.hideFlags = HideFlags.HideAndDontSave;
                CachedSprites[index] = sprite;
            }
        }

        /// <summary>Call only after all sprite users are torn down (Editor/application teardown).</summary>
        public static void ReleaseCachedAssets()
        {
            for(int i=0;i<CachedSprites.Length;i++)
            {
                if(CachedSprites[i]!=null)
                {
                    if(Application.isPlaying) UnityEngine.Object.Destroy(CachedSprites[i]);
                    else UnityEngine.Object.DestroyImmediate(CachedSprites[i]);
                }
                CachedSprites[i]=null;
            }
            if(_atlas!=null)
            {
                if(Application.isPlaying) UnityEngine.Object.Destroy(_atlas);
                else UnityEngine.Object.DestroyImmediate(_atlas);
            }
            _atlas=null;
        }

        static void Paint(int index, CellPainter p)
        {
            switch (index)
            {
                case 0: PaintGallows(p); break;
                case 1: PaintStocks(p); break;
                case 2: PaintMushrooms(p); break;
                case 3: PaintToxicVent(p); break;
                case 4: PaintPipe(p); break;
                case 5: PaintSnow(p); break;
                case 6: PaintIceCrack(p); break;
                case 7: PaintStainedGlass(p); break;
                case 8: PaintCrater(p); break;
            }
        }

        static void PaintGallows(CellPainter p)
        {
            p.Ellipse(128, 19, 94, 16, new Color32(5, 8, 14, 115), 4);
            p.Poly(new[] { V(65, 23), V(88, 34), V(100, 190), V(78, 196) }, new Color32(74, 46, 32, 255), 5);
            p.Poly(new[] { V(88, 34), V(102, 40), V(112, 193), V(100, 190) }, new Color32(46, 31, 27, 255), 6);
            p.Poly(new[] { V(89, 181), V(101, 179), V(169, 208), V(164, 218) }, new Color32(114, 74, 45, 255), 8);
            p.Poly(new[] { V(165, 211), V(181, 215), V(182, 231), V(165, 229) }, new Color32(65, 42, 31, 255), 9);
            p.Poly(new[] { V(91, 184), V(184, 205), V(181, 220), V(94, 199) }, new Color32(121, 79, 47, 255), 12);
            p.Poly(new[] { V(94, 199), V(181, 220), V(181, 229), V(96, 210) }, new Color32(57, 39, 30, 255), 13);
            p.Line(101, 188, 172, 207, 3, new Color32(186, 132, 75, 255));
            p.Line(95, 207, 175, 226, 2, new Color32(29, 25, 23, 255));
            p.Line(84, 56, 91, 172, 2, new Color32(42, 31, 25, 190));
            p.Line(100, 205, 106, 213, 3, new Color32(181, 147, 94, 255));
            p.Line(145, 215, 152, 223, 3, new Color32(181, 147, 94, 255));
            // Rope falls below the beam; a hollow noose remains legible at match scale.
            p.Line(153, 211, 153, 157, 3, new Color32(151,113,73,255));
            p.Ellipse(153, 144, 9, 15, new Color32(151,113,73,255), 15);
            p.Ellipse(153, 144, 5, 11, new Color32(17,20,24,255), 16);
            p.Line(166, 208, 168, 196, 4, new Color32(108, 76, 47, 255));
            p.Line(171, 211, 173, 200, 4, new Color32(108, 76, 47, 255));
            p.Line(76, 72, 89, 67, 2, new Color32(148, 104, 63, 255));
        }

        static void PaintStocks(CellPainter p)
        {
            p.Ellipse(128, 19, 83, 17, new Color32(6, 9, 13, 125), 22);
            p.Poly(new[] { V(63, 34), V(84, 29), V(88, 221), V(68, 219) }, new Color32(78, 50, 33, 255), 24);
            p.Poly(new[] { V(84, 29), V(98, 36), V(101, 222), V(88, 221) }, new Color32(47, 34, 28, 255), 25);
            p.Poly(new[] { V(162, 32), V(185, 38), V(182, 226), V(164, 223) }, new Color32(65, 43, 30, 255), 26);
            p.Poly(new[] { V(74, 47), V(178, 61), V(177, 102), V(72, 87) }, new Color32(132, 84, 47, 255), 30);
            p.Poly(new[] { V(72, 87), V(177, 102), V(173, 120), V(75, 106) }, new Color32(66, 44, 31, 255), 31);
            p.Poly(new[] { V(75, 115), V(174, 131), V(177, 169), V(77, 151) }, new Color32(120, 76, 43, 255), 32);
            p.Poly(new[] { V(77, 151), V(177, 169), V(174, 185), V(79, 168) }, new Color32(62, 42, 31, 255), 33);
            p.Ellipse(124, 91, 13, 12, new Color32(22, 19, 18, 255), 34);
            p.Ellipse(125, 91, 7, 6, new Color32(7, 10, 14, 255), 35);
            p.Ellipse(132, 136, 12, 12, new Color32(22, 19, 18, 255), 36);
            p.Ellipse(132, 136, 6, 6, new Color32(7, 10, 14, 255), 37);
            p.Line(82, 55, 170, 68, 3, new Color32(195, 143, 82, 255));
            p.Line(84, 119, 168, 134, 2, new Color32(187, 132, 75, 255));
            p.Line(84, 31, 89, 146, 2, new Color32(178, 127, 73, 220));
            p.Dot(81, 75, 3, new Color32(208, 174, 111, 255));
            p.Dot(170, 91, 3, new Color32(208, 174, 111, 255));
        }

        static void PaintMushrooms(CellPainter p)
        {
            p.Ellipse(125, 20, 93, 16, new Color32(5, 8, 13, 105), 43);
            // Rear caps and stems establish a small clustered, grounded silhouette.
            Mushroom(p, 81, 70, .74f, new Color32(152, 71, 95, 255), new Color32(224, 145, 157, 255), 47);
            Mushroom(p, 174, 79, .78f, new Color32(174, 117, 57, 255), new Color32(233, 193, 104, 255), 53);
            Mushroom(p, 126, 116, 1.04f, new Color32(122, 46, 74, 255), new Color32(209, 103, 121, 255), 59);
            p.Ellipse(128, 30, 95, 24, new Color32(56, 77, 42, 255), 64);
            p.Ellipse(128, 35, 78, 15, new Color32(83, 105, 51, 255), 65);
            p.Line(44, 31, 211, 38, 2, new Color32(133, 154, 80, 255));
            p.Dot(78, 41, 4, new Color32(158, 177, 91, 255));
            p.Dot(181, 38, 3, new Color32(161, 180, 93, 255));
            p.Dot(110, 50, 2, new Color32(176, 190, 107, 255));
            p.Dot(146, 46, 2, new Color32(176, 190, 107, 255));
        }

        static void Mushroom(CellPainter p, float cx, float baseY, float scale, Color32 cap, Color32 capLight, int seed)
        {
            float stemH = 47f * scale;
            p.Poly(new[] { V(cx - 12 * scale, 35), V(cx + 16 * scale, 35), V(cx + 10 * scale, baseY + stemH), V(cx - 7 * scale, baseY + stemH + 3) },
                new Color32(186, 177, 139, 255), seed);
            p.Poly(new[] { V(cx + 5 * scale, 35), V(cx + 16 * scale, 35), V(cx + 10 * scale, baseY + stemH), V(cx + 4 * scale, baseY + stemH) },
                new Color32(120, 117, 99, 255), seed + 1);
            p.Ellipse(cx, baseY + stemH + 15 * scale, 39 * scale, 23 * scale, cap, seed + 2);
            p.Ellipse(cx - 7 * scale, baseY + stemH + 22 * scale, 26 * scale, 10 * scale, capLight, seed + 3);
            p.Line(cx - 27 * scale, baseY + stemH + 12 * scale, cx + 26 * scale, baseY + stemH + 13 * scale, 2, new Color32(248, 221, 177, 180));
            p.Dot(cx - 14 * scale, baseY + stemH + 24 * scale, 3 * scale, new Color32(252, 221, 176, 255));
            p.Dot(cx + 10 * scale, baseY + stemH + 28 * scale, 2.4f * scale, new Color32(255, 233, 190, 255));
            p.Dot(cx + 23 * scale, baseY + stemH + 15 * scale, 2 * scale, new Color32(248, 218, 169, 255));
        }

        static void PaintToxicVent(CellPainter p)
        {
            p.Ellipse(128, 23, 104, 20, new Color32(5, 8, 11, 120), 71);
            p.Ellipse(128, 39, 102, 36, new Color32(52, 65, 37, 255), 75);
            p.Ellipse(128, 48, 88, 27, new Color32(86, 105, 45, 255), 76);
            p.Ellipse(128, 52, 58, 15, new Color32(28, 35, 28, 255), 78);
            p.Poly(new[] { V(52, 36), V(70, 59), V(82, 42), V(94, 68), V(107, 43), V(126, 64), V(145, 39), V(158, 62), V(177, 38), V(190, 55), V(209, 32), V(199, 21), V(59, 21) }, new Color32(73, 82, 49, 255), 80);
            p.Line(71, 45, 88, 51, 3, new Color32(152, 159, 77, 255));
            p.Line(166, 46, 186, 42, 3, new Color32(153, 163, 73, 255));
            p.Ellipse(106, 76, 13, 20, new Color32(98, 189, 79, 215), 84);
            p.Ellipse(152, 97, 9, 14, new Color32(119, 218, 96, 210), 86);
            p.Ellipse(183, 69, 6, 10, new Color32(156, 231, 112, 205), 89);
            p.Line(101, 80, 108, 71, 2, new Color32(212, 252, 148, 235));
            p.Line(148, 100, 153, 94, 2, new Color32(216, 255, 160, 235));
            p.Dot(84, 86, 3, new Color32(190, 229, 99, 180));
            p.Dot(194, 97, 2, new Color32(203, 241, 116, 190));
            p.Dot(132, 112, 2, new Color32(189, 227, 107, 180));
        }

        static void PaintPipe(CellPainter p)
        {
            p.Ellipse(128, 20, 105, 18, new Color32(5, 8, 13, 115), 93);
            // Dark support brackets connect the raised pipe to its grounded base.
            p.Poly(new[]{V(70,19),V(84,22),V(84,68),V(73,64)},new Color32(45,47,44,255),94);
            p.Poly(new[]{V(155,20),V(169,23),V(169,49),V(156,49)},new Color32(52,50,43,255),95);
            p.Poly(new[] { V(37, 59), V(58, 72), V(153, 72), V(169, 60), V(169, 94), V(151, 107), V(58, 102), V(37, 90) }, new Color32(89, 67, 46, 255), 96);
            p.Poly(new[] { V(42, 62), V(59, 74), V(150, 75), V(164, 64), V(164, 82), V(150, 94), V(58, 91), V(42, 82) }, new Color32(105, 115, 112, 255), 97);
            p.Poly(new[] { V(45, 62), V(58, 73), V(58, 91), V(45, 82) }, new Color32(51, 58, 59, 255), 98);
            p.Ellipse(49, 72, 12, 11, new Color32(34, 40, 43, 255), 99);
            p.Ellipse(51, 72, 7, 6, new Color32(6, 10, 14, 255), 100);
            p.Poly(new[] { V(145, 72), V(155, 72), V(155, 43), V(177, 43), V(190, 54), V(190, 80), V(172, 94), V(155, 94), V(155, 84), V(176, 84), V(180, 77), V(180, 57), V(169, 55), V(166, 81), V(145, 82) }, new Color32(96, 107, 106, 255), 104);
            p.Poly(new[] { V(155, 43), V(177, 43), V(190, 54), V(184, 61), V(171, 54), V(155, 55) }, new Color32(137, 133, 112, 255), 105);
            p.Line(68, 73, 137, 74, 3, new Color32(166, 169, 149, 255));
            p.Line(68, 90, 143, 91, 2, new Color32(59, 74, 77, 255));
            p.Poly(new[] { V(73, 64), V(82, 66), V(82, 100), V(73, 98) }, new Color32(55, 62, 60, 255), 109);
            p.Line(77, 67, 77, 96, 2, new Color32(179, 145, 85, 255));
            p.Dot(107, 85, 5, new Color32(156, 80, 42, 240));
            p.Dot(112, 83, 2, new Color32(205, 124, 59, 255));
            p.Poly(new[] { V(126, 77), V(137, 78), V(136, 87), V(126, 87) }, new Color32(124, 73, 44, 255), 114);
            p.Dot(129, 81, 2, new Color32(214, 151, 75, 255));
        }

        static void PaintSnow(CellPainter p)
        {
            p.Ellipse(128, 22, 107, 19, new Color32(6, 10, 18, 110), 120);
            p.Ellipse(91, 59, 72, 45, new Color32(82, 116, 149, 255), 123);
            p.Ellipse(96, 70, 63, 37, new Color32(192, 219, 232, 255), 124);
            p.Ellipse(161, 49, 67, 37, new Color32(95, 133, 163, 255), 127);
            p.Ellipse(156, 60, 58, 31, new Color32(203, 227, 239, 255), 128);
            p.Poly(new[] { V(28, 29), V(57, 51), V(95, 39), V(126, 48), V(154, 34), V(197, 43), V(224, 29), V(215, 17), V(38, 17) }, new Color32(169, 198, 216, 255), 131);
            p.Line(49, 86, 80, 93, 3, new Color32(232, 246, 252, 255));
            p.Line(120, 74, 145, 82, 2, new Color32(240, 251, 255, 255));
            p.Line(169, 73, 192, 69, 2, new Color32(234, 247, 252, 255));
            p.Dot(68, 59, 3, new Color32(246, 252, 255, 255));
            p.Dot(177, 52, 2, new Color32(245, 251, 255, 255));
            p.Dot(111, 42, 2, new Color32(232, 244, 250, 255));
            p.Dot(206, 54, 2, new Color32(230, 243, 250, 255));
        }

        static void PaintIceCrack(CellPainter p)
        {
            p.Ellipse(128, 24, 105, 21, new Color32(5, 10, 18, 110), 141);
            p.Poly(new[] { V(28, 33), V(61, 57), V(104, 75), V(146, 69), V(185, 51), V(224, 30), V(214, 17), V(40, 17) }, new Color32(50, 105, 136, 245), 145);
            p.Poly(new[] { V(39, 36), V(72, 57), V(108, 68), V(146, 63), V(181, 48), V(212, 31), V(205, 23), V(45, 23) }, new Color32(149, 206, 224, 245), 147);
            p.Poly(new[] { V(49, 38), V(80, 55), V(112, 63), V(145, 58), V(173, 46), V(201, 31), V(190, 28), V(143, 48), V(111, 54), V(82, 47) }, new Color32(197, 236, 246, 230), 149);
            p.Line(48, 41, 89, 59, 5, new Color32(27, 66, 91, 255));
            p.Line(89, 59, 117, 45, 4, new Color32(27, 66, 91, 255));
            p.Line(117, 45, 143, 61, 4, new Color32(27, 66, 91, 255));
            p.Line(143, 61, 169, 43, 4, new Color32(27, 66, 91, 255));
            p.Line(169, 43, 201, 31, 4, new Color32(27, 66, 91, 255));
            p.Line(89, 59, 78, 36, 3, new Color32(35, 83, 110, 255));
            p.Line(117, 45, 123, 28, 3, new Color32(35, 83, 110, 255));
            p.Line(143, 61, 152, 76, 3, new Color32(35, 83, 110, 255));
            p.Line(169, 43, 184, 61, 3, new Color32(35, 83, 110, 255));
            p.Line(54, 38, 89, 53, 1, new Color32(222, 250, 255, 255));
            p.Line(121, 45, 144, 56, 1, new Color32(224, 249, 255, 255));
            p.Dot(113, 47, 5, new Color32(92, 202, 245, 255));
            p.Dot(89, 59, 3, new Color32(106, 218, 250, 255));
            p.Dot(169, 43, 3, new Color32(111, 219, 248, 255));
        }

        static void PaintStainedGlass(CellPainter p)
        {
            p.Ellipse(128, 20, 88, 18, new Color32(5, 8, 13, 115), 157);
            p.Poly(new[] { V(62, 28), V(62, 153), V(70, 189), V(92, 216), V(128, 231), V(164, 216), V(186, 189), V(194, 153), V(194, 28), V(179, 34), V(179, 151), V(173, 183), V(154, 204), V(128, 216), V(102, 204), V(83, 183), V(77, 151), V(77, 34) }, new Color32(75, 57, 42, 255), 160);
            p.Poly(new[] { V(78, 37), V(125, 42), V(126, 114), V(85, 105) }, new Color32(54, 136, 157, 255), 163);
            p.Poly(new[] { V(131, 42), V(178, 37), V(171, 105), V(132, 114) }, new Color32(164, 76, 77, 255), 164);
            p.Poly(new[] { V(86, 111), V(126, 120), V(126, 194), V(100, 181), V(87, 153) }, new Color32(149, 119, 56, 255), 166);
            p.Poly(new[] { V(132, 120), V(170, 111), V(169, 153), V(156, 181), V(132, 194) }, new Color32(80, 93, 155, 255), 168);
            p.Poly(new[] { V(92, 51), V(119, 53), V(119, 105), V(91, 99) }, new Color32(75, 176, 185, 255), 169);
            p.Poly(new[] { V(138, 53), V(165, 51), V(163, 99), V(138, 105) }, new Color32(208, 112, 100, 255), 171);
            p.Line(127, 38, 128, 205, 6, new Color32(37, 31, 31, 255));
            p.Line(79, 108, 177, 108, 6, new Color32(37, 31, 31, 255));
            p.Line(96, 43, 96, 98, 2, new Color32(235, 199, 125, 245));
            p.Line(145, 48, 145, 99, 2, new Color32(255, 198, 136, 245));
            p.Line(96, 121, 96, 151, 2, new Color32(255, 221, 142, 230));
            p.Line(146, 124, 146, 151, 2, new Color32(153, 212, 243, 240));
            p.Ellipse(128, 143, 13, 15, new Color32(244, 201, 106, 240), 174);
            p.Ellipse(128, 143, 6, 7, new Color32(255, 239, 181, 255), 175);
            p.Poly(new[] { V(63, 75), V(77, 68), V(76, 121), V(65, 116) }, new Color32(64, 45, 35, 255), 177);
            p.Poly(new[] { V(179, 132), V(193, 124), V(192, 163), V(178, 171) }, new Color32(61, 46, 39, 255), 178);
            p.Line(67, 184, 87, 179, 3, new Color32(149, 104, 66, 255));
            p.Line(169, 190, 187, 182, 3, new Color32(149, 104, 66, 255));
            p.Dot(83, 209, 3, new Color32(192, 154, 89, 255));
            p.Dot(177, 200, 3, new Color32(192, 154, 89, 255));
        }

        static void PaintCrater(CellPainter p)
        {
            p.Ellipse(128, 22, 108, 19, new Color32(5, 8, 12, 125), 187);
            p.Poly(new[] { V(22, 33), V(42, 69), V(78, 88), V(125, 95), V(173, 82), V(211, 59), V(232, 31), V(220, 18), V(34, 18) }, new Color32(74, 44, 36, 255), 190);
            p.Ellipse(128, 55, 105, 39, new Color32(106, 58, 40, 255), 191);
            p.Ellipse(128, 57, 84, 28, new Color32(37, 29, 30, 255), 193);
            p.Ellipse(128, 55, 58, 17, new Color32(21, 22, 26, 255), 195);
            p.Ellipse(128, 48, 35, 7, new Color32(122, 44, 29, 255), 197);
            p.Ellipse(128, 47, 19, 4, new Color32(244, 91, 38, 255), 198);
            p.Poly(new[] { V(29, 32), V(45, 66), V(81, 84), V(126, 92), V(175, 77), V(211, 54), V(226, 29), V(218, 23), V(204, 49), V(171, 68), V(127, 80), V(83, 74), V(52, 56), V(39, 27) }, new Color32(158, 72, 43, 255), 200);
            p.Line(44, 42, 76, 62, 4, new Color32(218, 106, 55, 255));
            p.Line(76, 62, 111, 70, 3, new Color32(239, 133, 63, 255));
            p.Line(182, 58, 210, 37, 4, new Color32(219, 106, 52, 255));
            p.Line(75, 48, 88, 35, 3, new Color32(96, 50, 39, 255));
            p.Line(171, 46, 163, 32, 3, new Color32(99, 51, 40, 255));
            p.Dot(60, 84, 4, new Color32(246, 126, 53, 255));
            p.Dot(199, 79, 3, new Color32(249, 135, 57, 255));
            p.Dot(126, 94, 3, new Color32(255, 168, 75, 255));
        }

        static Vector2 V(float x, float y) { return new Vector2(x, y); }

        sealed class CellPainter
        {
            readonly int _size;
            readonly int _seed;
            public readonly Color32[] Pixels;

            public CellPainter(int size, int seed)
            {
                _size = size;
                _seed = seed;
                Pixels = new Color32[size * size];
            }

            public void Dot(float x, float y, float radius, Color32 color) { Ellipse(x, y, radius, radius, color, _seed + 31); }

            public void Ellipse(float cx, float cy, float rx, float ry, Color32 color, int seed)
            {
                int minX = Mathf.Max(0, Mathf.FloorToInt(cx - rx - 1));
                int maxX = Mathf.Min(_size - 1, Mathf.CeilToInt(cx + rx + 1));
                int minY = Mathf.Max(0, Mathf.FloorToInt(cy - ry - 1));
                int maxY = Mathf.Min(_size - 1, Mathf.CeilToInt(cy + ry + 1));
                float invX = 1f / Mathf.Max(rx, .001f), invY = 1f / Mathf.Max(ry, .001f);
                for (int y = minY; y <= maxY; y++) for (int x = minX; x <= maxX; x++)
                {
                    float dx = (x + .5f - cx) * invX, dy = (y + .5f - cy) * invY;
                    float d = dx * dx + dy * dy;
                    if (d > 1f) continue;
                    float light = Mathf.Clamp(.78f + .17f * (-dx * .55f + dy * .84f) + (1f - d) * .17f + Grain(x, y, seed) * .075f, .48f, 1.25f);
                    Plot(x, y, Shade(color, light));
                }
            }

            public void Poly(Vector2[] points, Color32 color, int seed)
            {
                if (points == null || points.Length < 3) return;
                float left = points[0].x, right = left, bottom = points[0].y, top = bottom;
                for (int i = 1; i < points.Length; i++)
                {
                    left = Mathf.Min(left, points[i].x); right = Mathf.Max(right, points[i].x);
                    bottom = Mathf.Min(bottom, points[i].y); top = Mathf.Max(top, points[i].y);
                }
                int minX = Mathf.Clamp(Mathf.FloorToInt(left), 0, _size - 1);
                int maxX = Mathf.Clamp(Mathf.CeilToInt(right), 0, _size - 1);
                int minY = Mathf.Clamp(Mathf.FloorToInt(bottom), 0, _size - 1);
                int maxY = Mathf.Clamp(Mathf.CeilToInt(top), 0, _size - 1);
                float height = Mathf.Max(1f, top - bottom);
                for (int y = minY; y <= maxY; y++) for (int x = minX; x <= maxX; x++)
                {
                    if (!Inside(points, x + .5f, y + .5f)) continue;
                    float verticalLight = (y + .5f - bottom) / height;
                    float horizontal = (x + .5f - (left + right) * .5f) / Mathf.Max(1f, right - left);
                    float light = Mathf.Clamp(.77f + verticalLight * .24f - horizontal * .10f + Grain(x, y, seed) * .08f, .43f, 1.2f);
                    Plot(x, y, Shade(color, light));
                }
            }

            public void Line(float x0, float y0, float x1, float y1, float width, Color32 color)
            {
                float minXf = Mathf.Min(x0, x1) - width - 1, maxXf = Mathf.Max(x0, x1) + width + 1;
                float minYf = Mathf.Min(y0, y1) - width - 1, maxYf = Mathf.Max(y0, y1) + width + 1;
                int minX = Mathf.Clamp(Mathf.FloorToInt(minXf), 0, _size - 1);
                int maxX = Mathf.Clamp(Mathf.CeilToInt(maxXf), 0, _size - 1);
                int minY = Mathf.Clamp(Mathf.FloorToInt(minYf), 0, _size - 1);
                int maxY = Mathf.Clamp(Mathf.CeilToInt(maxYf), 0, _size - 1);
                float dx = x1 - x0, dy = y1 - y0, lenSq = dx * dx + dy * dy;
                float radius = width * .5f;
                for (int y = minY; y <= maxY; y++) for (int x = minX; x <= maxX; x++)
                {
                    float px = x + .5f - x0, py = y + .5f - y0;
                    float t = lenSq <= .001f ? 0f : Mathf.Clamp01((px * dx + py * dy) / lenSq);
                    float qx = x0 + t * dx, qy = y0 + t * dy;
                    float ex = x + .5f - qx, ey = y + .5f - qy;
                    if (ex * ex + ey * ey <= radius * radius) Plot(x, y, color);
                }
            }

            void Plot(int x, int y, Color32 source)
            {
                if ((uint)x >= (uint)_size || (uint)y >= (uint)_size || source.a == 0) return;
                int index = y * _size + x;
                Color32 dest = Pixels[index];
                float sa = source.a / 255f, da = dest.a / 255f;
                float outA = sa + da * (1f - sa);
                if (outA <= 0f) return;
                float destWeight = da * (1f - sa);
                Pixels[index] = new Color32(
                    (byte)Mathf.Clamp(Mathf.RoundToInt((source.r * sa + dest.r * destWeight) / outA), 0, 255),
                    (byte)Mathf.Clamp(Mathf.RoundToInt((source.g * sa + dest.g * destWeight) / outA), 0, 255),
                    (byte)Mathf.Clamp(Mathf.RoundToInt((source.b * sa + dest.b * destWeight) / outA), 0, 255),
                    (byte)Mathf.Clamp(Mathf.RoundToInt(outA * 255f), 0, 255));
            }

            float Grain(int x, int y, int seed)
            {
                unchecked
                {
                    uint n = (uint)(x * 374761393 + y * 668265263 + (seed + _seed) * 1442695041);
                    n = (n ^ (n >> 13)) * 1274126177;
                    return ((n & 65535) / 65535f) - .5f;
                }
            }

            static bool Inside(Vector2[] polygon, float x, float y)
            {
                bool inside = false;
                for (int i = 0, j = polygon.Length - 1; i < polygon.Length; j = i++)
                {
                    Vector2 a = polygon[i], b = polygon[j];
                    if ((a.y > y) != (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)
                        inside = !inside;
                }
                return inside;
            }

            static Color32 Shade(Color32 color, float light)
            {
                return new Color32(
                    (byte)Mathf.Clamp(Mathf.RoundToInt(color.r * light), 0, 255),
                    (byte)Mathf.Clamp(Mathf.RoundToInt(color.g * light), 0, 255),
                    (byte)Mathf.Clamp(Mathf.RoundToInt(color.b * light), 0, 255), color.a);
            }
        }
    }
}
