// First prop pass for the coliseum (presentation only, deterministic): banners and weapon racks standing against the arena walls, torch
// stands beside the wall ends. Props sit only on floor tiles of the coliseum region that touch a wall, never in the open fighting
// floor, never within 3 tiles of the centre; tall ones fade when they would cover an actor (RegionProps). The sand rings are drawn by
// the ground shader.
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public static class ColiseumProps
    {
        public static void Add(MapBlob map, List<RegionProps.Placement> list, int seed)
        {
            if (map.Regions == null) return;
            int w = map.W, h = map.H; var tiles = map.Tiles; var regions = map.Regions;
            var b = RegionGround.ColiseumBounds(regions, w, h); if (b.w < .5f) return;
            bool Wall(int x, int y) { return x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] != MapBlob.Floor; }
            int last = -100;
            for (int y = 1; y < h - 1; y++) for (int x = 1; x < w - 1; x++)
            {
                int i = y * w + x;
                if (regions[i] != (byte)RegionId.Coliseum || tiles[i] != MapBlob.Floor) continue;
                if (Mathf.Abs(x + .5f - b.x) < 3f && Mathf.Abs(y + .5f - b.y) < 3f) continue;
                bool north = Wall(x, y - 1), side = Wall(x - 1, y) || Wall(x + 1, y);
                if (!north && !side) continue;
                float roll = RegionNoise.Hash01(x, y, seed + 77);
                if (i - last < 3 && last >= 0) continue;
                string art = null;
                if (north && roll < .16f) art = roll < .08f ? "col.banner" : "col.rack";
                else if (side && roll > .82f) art = "col.torch";
                if (art == null) continue;
                last = i;
                list.Add(new RegionProps.Placement { Art = art, X = x + .5f, Y = y + .62f, Scale = 1f, Flip = roll > .5f, Tx = x, Ty = y });
            }
        }
    }
}
