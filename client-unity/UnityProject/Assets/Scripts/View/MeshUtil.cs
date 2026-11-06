// Reusable procedural geometry; all positions and status decisions come from the caller.
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

        public void Clear() { V.Clear(); C.Clear(); T.Clear(); }

        /// <summary>Retains the mesh and managed buffer capacities across complete frame replacements.</summary>
        public void Apply(Mesh mesh)
        {
            mesh.Clear();
            mesh.indexFormat = V.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16;
            mesh.SetVertices(V); mesh.SetColors(C); mesh.SetTriangles(T, 0, false);
            mesh.RecalculateBounds();
        }

        public void Rect(Vector3 p, float width, float depth, Color32 color)
        {
            float x = width * .5f, z = depth * .5f;
            Quad(p + new Vector3(-x, 0, -z), p + new Vector3(x, 0, -z),
                p + new Vector3(x, 0, z), p + new Vector3(-x, 0, z), color);
        }

        public void Line(Vector3 a, Vector3 b, float width, Color32 color)
        {
            var d = b - a;
            float length = Mathf.Sqrt(d.x * d.x + d.z * d.z);
            if (length < .00001f) return;
            var side = new Vector3(-d.z, 0, d.x) * (width * .5f / length);
            Quad(a - side, b - side, b + side, a + side, color);
        }

        public void DiscAt(Vector3 p, float radius, int segments, Color32 color)
        {
            for (int i = 0; i < segments; i++)
            {
                float a = i * Mathf.PI * 2 / segments, c = (i + 1) * Mathf.PI * 2 / segments;
                Tri(p, p + new Vector3(Mathf.Cos(a) * radius, 0, Mathf.Sin(a) * radius),
                    p + new Vector3(Mathf.Cos(c) * radius, 0, Mathf.Sin(c) * radius), color);
            }
        }

        public void Ring(Vector3 p, float radius, float width, Color32 color)
        {
            const int segments = 24;
            for (int i = 0; i < segments; i++)
            {
                float a = i * Mathf.PI * 2 / segments, c = (i + 1) * Mathf.PI * 2 / segments;
                var u = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                var v = new Vector3(Mathf.Cos(c), 0, Mathf.Sin(c));
                Quad(p + u * radius, p + v * radius, p + v * (radius - width), p + u * (radius - width), color);
            }
        }

        /// <summary>Original schematic weapon glyphs; dimensions are artwork, never weapon reach.</summary>
        public void Weapon(Vector3 p, Roguehalla.Net.WeaponId weapon, float facing, float scale, Color32 color)
        {
            var d = new Vector3(Mathf.Cos(facing), 0, -Mathf.Sin(facing)) * scale;
            var n = new Vector3(-d.z, 0, d.x);
            switch (weapon)
            {
                case Roguehalla.Net.WeaponId.Sword:
                    Line(p - d * .3f, p + d * .4f, .08f * scale, color);
                    Line(p - d * .15f - n * .18f, p - d * .15f + n * .18f, .08f * scale, color);
                    break;
                case Roguehalla.Net.WeaponId.Bow:
                    Line(p - n * .35f, p + d * .22f, .07f * scale, color);
                    Line(p + d * .22f, p + n * .35f, .07f * scale, color);
                    Line(p - n * .35f, p + n * .35f, .025f * scale, color);
                    break;
                case Roguehalla.Net.WeaponId.Wand:
                    Line(p - d * .3f, p + d * .25f, .07f * scale, color);
                    DiscAt(p + d * .29f, .14f * scale, 4, color);
                    break;
                case Roguehalla.Net.WeaponId.Shield:
                    DiscAt(p, .3f * scale, 6, color);
                    Line(p - n * .2f + Vector3.up * .01f, p + n * .2f + Vector3.up * .01f, .045f * scale, new Color32(43, 54, 70, 255));
                    break;
                case Roguehalla.Net.WeaponId.Axe:
                    Line(p - d * .35f, p + d * .25f, .07f * scale, color);
                    Tri(p + d * .3f - n * .26f, p + d * .3f + n * .26f, p + d * .02f, color);
                    break;
                case Roguehalla.Net.WeaponId.Fists:
                    DiscAt(p - n * .13f, .12f * scale, 6, color);
                    DiscAt(p + n * .13f, .12f * scale, 6, color);
                    break;
            }
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
