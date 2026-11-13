using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// P-UNITY-LANDMARK-1: which floor tiles of a landmark's footprint are INTERIOR (under its roof), found from the delivered
    /// collision tiles alone, so it is right in every orientation the generator places a blueprint in. Pure, engine-free.
    /// The rule is pinned in docs/backlog/packets/P-UNITY-LANDMARK-1.md section 3 (fact 4).
    /// </summary>
    public static class LandmarkInterior
    {
        /// <summary>The widest run of floor between two wall tiles (a doorway, a mouth, a gate) that still counts as closed.</summary>
        public const int MaxOpening = 5;

        /// <summary>Row-major flags over the footprint (index (y - footprint.Y) * footprint.W + (x - footprint.X)): true for an
        /// interior floor tile. <paramref name="tiles"/> is the map's collision plane (MapBlob.Floor / Wall / Low), w x h.</summary>
        public static bool[] Find(byte[] tiles, int w, int h, Protocol.MapRect footprint /* Net.Ui has a MapRect of its own (the map screen's): the footprint is the protocol's */, MapTile[] entrance)
        {
            int fx = footprint.X, fy = footprint.Y, fw = footprint.W, fh = footprint.H;
            var result = new bool[fw * fh];
            if (fw <= 0 || fh <= 0 || tiles == null) return result;
            var wall = new bool[fw * fh];
            for (int y = 0; y < fh; y++) for (int x = 0; x < fw; x++)
            {
                int mx = fx + x, my = fy + y;
                if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
                wall[y * fw + x] = tiles[my * w + mx] == Protocol.MapBlob.Wall;
            }
            // 8-connected wall groups, each with its bounding box.
            var group = new int[fw * fh]; var stack = new System.Collections.Generic.Stack<int>();
            int groups = 0;
            for (int start = 0; start < wall.Length; start++)
            {
                if (!wall[start] || group[start] != 0) continue;
                groups++; int x0 = fw, y0 = fh, x1 = -1, y1 = -1;
                group[start] = groups; stack.Push(start);
                while (stack.Count > 0)
                {
                    int i = stack.Pop(); int cx = i % fw, cy = i / fw;
                    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
                    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++)
                    {
                        int nx = cx + dx, ny = cy + dy;
                        if (nx < 0 || ny < 0 || nx >= fw || ny >= fh) continue;
                        int j = ny * fw + nx; if (!wall[j] || group[j] != 0) continue;
                        group[j] = groups; stack.Push(j);
                    }
                }
                MarkInterior(tiles, w, h, fx, fy, fw, wall, x0, y0, x1, y1, entrance, result, stack);
            }
            return result;
        }

        static void MarkInterior(byte[] tiles, int w, int h, int fx, int fy, int fw, bool[] wall, int x0, int y0, int x1, int y1, MapTile[] entrance, bool[] result, System.Collections.Generic.Stack<int> stack)
        {
            int bw = x1 - x0 + 1, bh = y1 - y0 + 1;
            var closed = new bool[bw * bh]; var reached = new bool[bw * bh];
            bool Wall(int x, int y) { return wall[y * fw + x]; }
            // A run of at most MaxOpening non-wall tiles between two wall tiles along a border line is a doorway.
            void Run(int sx, int sy, int dx, int dy, int len)
            {
                int i = 0;
                while (i < len)
                {
                    if (Wall(sx + dx * i, sy + dy * i)) { i++; continue; }
                    int j = i; while (j < len && !Wall(sx + dx * j, sy + dy * j)) j++;
                    if (i > 0 && j < len && j - i <= MaxOpening)
                        for (int k = i; k < j; k++) closed[(sy + dy * k - y0) * bw + (sx + dx * k - x0)] = true;
                    i = j;
                }
            }
            Run(x0, y0, 1, 0, bw); Run(x0, y1, 1, 0, bw); Run(x0, y0, 0, 1, bh); Run(x1, y0, 0, 1, bh);
            if (entrance != null)
                foreach (var t in entrance)
                {
                    int ex = t.X - fx, ey = t.Y - fy;
                    if (ex >= x0 && ex <= x1 && ey >= y0 && ey <= y1 && !Wall(ex, ey)) closed[(ey - y0) * bw + (ex - x0)] = true;
                }
            stack.Clear();
            void Seed(int x, int y)
            {
                int i = (y - y0) * bw + (x - x0);
                if (Wall(x, y) || closed[i] || reached[i]) return;
                reached[i] = true; stack.Push(i);
            }
            for (int x = x0; x <= x1; x++) { Seed(x, y0); Seed(x, y1); }
            for (int y = y0; y <= y1; y++) { Seed(x0, y); Seed(x1, y); }
            while (stack.Count > 0)
            {
                int i = stack.Pop(); int cx = x0 + i % bw, cy = y0 + i / bw;
                if (cx > x0) Seed(cx - 1, cy); if (cx < x1) Seed(cx + 1, cy);
                if (cy > y0) Seed(cx, cy - 1); if (cy < y1) Seed(cx, cy + 1);
            }
            for (int y = y0; y <= y1; y++) for (int x = x0; x <= x1; x++)
            {
                int i = (y - y0) * bw + (x - x0);
                if (Wall(x, y) || reached[i] || closed[i]) continue;
                if (tiles[(fy + y) * w + fx + x] != Protocol.MapBlob.Floor) continue;
                result[y * fw + x] = true;
            }
        }

        /// <summary>Number of true flags.</summary>
        public static int Count(bool[] interior)
        {
            int n = 0;
            foreach (bool b in interior) if (b) n++;
            return n;
        }
    }
}
