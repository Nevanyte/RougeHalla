// NOT COMPILED in Stage 1 (no Unity). Tiny procedural meshes with vertex colours (no art assets).
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Roguehalla.Client
{
    public sealed class MeshBuilder
    {
        public readonly List<Vector3> V = new List<Vector3>();
        public readonly List<Color32> C = new List<Color32>();
        public readonly List<int> T = new List<int>();

        public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Color32 col)
        {
            int i = V.Count;
            V.Add(a); V.Add(b); V.Add(c); V.Add(d);
            for (int k = 0; k < 4; k++) C.Add(col);
            T.Add(i); T.Add(i + 1); T.Add(i + 2); T.Add(i); T.Add(i + 2); T.Add(i + 3);
        }

        public void Tri(Vector3 a, Vector3 b, Vector3 c, Color32 col)
        {
            int i = V.Count;
            V.Add(a); V.Add(b); V.Add(c);
            for (int k = 0; k < 3; k++) C.Add(col);
            T.Add(i); T.Add(i + 1); T.Add(i + 2);
        }

        public Mesh ToMesh(string name)
        {
            var m = new Mesh { name = name, indexFormat = V.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            m.SetVertices(V); m.SetColors(C); m.SetTriangles(T, 0);
            m.RecalculateBounds();
            return m;
        }

        public static Mesh Disc(float r, int seg, Color32 col)
        {
            var b = new MeshBuilder();
            for (int i = 0; i < seg; i++)
            {
                float a0 = i * Mathf.PI * 2 / seg, a1 = (i + 1) * Mathf.PI * 2 / seg;
                b.Tri(Vector3.zero, new Vector3(Mathf.Cos(a0) * r, 0, Mathf.Sin(a0) * r), new Vector3(Mathf.Cos(a1) * r, 0, Mathf.Sin(a1) * r), col);
            }
            return b.ToMesh("disc");
        }

        /// <summary>A flat bar on the XZ plane from x 0..1, z -0.5..0.5 (scale x to fill it).</summary>
        public static Mesh Bar(Color32 col)
        {
            var b = new MeshBuilder();
            b.Quad(new Vector3(0, 0, -0.5f), new Vector3(0, 0, 0.5f), new Vector3(1, 0, 0.5f), new Vector3(1, 0, -0.5f), col);
            return b.ToMesh("bar");
        }

        public static Mesh Nose(Color32 col)
        {
            var b = new MeshBuilder();
            b.Tri(new Vector3(-0.12f, 0, 0), new Vector3(0.12f, 0, 0), new Vector3(0, 0, 0.3f), col);
            return b.ToMesh("nose");
        }
    }
}
