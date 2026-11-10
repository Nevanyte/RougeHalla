using System.Runtime.InteropServices;
using Roguehalla.Net;
using UnityEngine;
using UnityEngine.Rendering;

namespace Roguehalla.Client
{
    /// <summary>
    /// One pooled, batched mesh of ground quads with one material. Capacity is fixed at construction (a logical cap below it can be set
    /// at run time); at the cap the oldest mark is recycled. Vertices are written only when a mark is born (the shader animates age, fade
    /// and growth); each frame the index buffer is rebuilt from the marks that are alive and inside the camera rectangle. No allocations
    /// after construction, no GameObject per mark.
    /// </summary>
    public sealed class SurfaceFxMesh
    {
        [StructLayout(LayoutKind.Sequential)]
        struct V { public Vector3 P; public Color32 C; public Vector2 Uv; public Vector4 A; public Vector4 B; public Vector2 Sun; }   // Unity's fixed attribute order: position, colour, then texcoords

        static readonly Bounds Big = new Bounds(Vector3.zero, new Vector3(100000f, 100000f, 10f));   // marks are culled on the CPU; the renderer must never cull the batch
        readonly Mesh _mesh;
        readonly MeshRenderer _renderer;
        readonly V[] _quad = new V[4];
        readonly ushort[] _indices;
        readonly float[] _cx, _cy, _rad;
        MarkPool _pool;
        readonly int _allocated;
        public int Capacity { get { return _pool.Capacity; } }
        public int Recycled { get { return _pool.Recycled; } }
        public int LastDrawn { get; private set; }
        public int Added { get; private set; }

        public SurfaceFxMesh(Transform parent, string name, int capacity, Material material, int sortingOrder)
        {
            _allocated = capacity; _pool = new MarkPool(capacity);
            _cx = new float[capacity]; _cy = new float[capacity]; _rad = new float[capacity];
            _indices = new ushort[capacity * 6];
            var go = new GameObject(name); go.transform.SetParent(parent, false);
            var mf = go.AddComponent<MeshFilter>(); _renderer = go.AddComponent<MeshRenderer>();
            _renderer.sharedMaterial = material; _renderer.sortingOrder = sortingOrder;
            _renderer.shadowCastingMode = ShadowCastingMode.Off; _renderer.receiveShadows = false; _renderer.enabled = false;
            _mesh = new Mesh { name = name }; _mesh.MarkDynamic();
            _mesh.SetVertexBufferParams(capacity * 4,
                new VertexAttributeDescriptor(VertexAttribute.Position, VertexAttributeFormat.Float32, 3),
                new VertexAttributeDescriptor(VertexAttribute.Color, VertexAttributeFormat.UNorm8, 4),
                new VertexAttributeDescriptor(VertexAttribute.TexCoord0, VertexAttributeFormat.Float32, 2),
                new VertexAttributeDescriptor(VertexAttribute.TexCoord1, VertexAttributeFormat.Float32, 4),
                new VertexAttributeDescriptor(VertexAttribute.TexCoord2, VertexAttributeFormat.Float32, 4),
                new VertexAttributeDescriptor(VertexAttribute.TexCoord3, VertexAttributeFormat.Float32, 2));
            _mesh.SetIndexBufferParams(capacity * 6, IndexFormat.UInt16);
            _mesh.subMeshCount = 1;
            _mesh.bounds = new Bounds(Vector3.zero, new Vector3(100000f, 100000f, 10f));
            mf.sharedMesh = _mesh;
        }

        /// <summary>Limits the live marks to <paramref name="cap"/> (0 switches the batch off). Changing the cap clears the batch.</summary>
        public void SetCap(int cap)
        {
            cap = Mathf.Clamp(cap, 0, _allocated);
            if (cap == _pool.Capacity) return;
            _pool = new MarkPool(cap); LastDrawn = 0; _renderer.enabled = false;
        }

        public void Clear() { _pool = new MarkPool(_pool.Capacity); LastDrawn = 0; _renderer.enabled = false; }
        public int Live(float now) { return _pool.LiveCount(now); }

        /// <summary>
        /// Adds a quad centred at <paramref name="c"/> spanned by full-extent axes <paramref name="u"/> and <paramref name="v"/> (world units at
        /// scale 1). The shader scales it from <paramref name="g0"/> to <paramref name="g1"/> over its life. Returns the slot or -1 when off.
        /// </summary>
        public int Add(Vector2 c, Vector2 u, Vector2 v, Vector4 uvRect, Color32 col, float birth, float life, float fadeSeconds, float g0, float g1, float style, Vector2 sunWorld)
        {
            if (_pool.Capacity == 0) return -1;
            int slot = _pool.Add(birth, life);
            // sun direction in the quad's atlas uv space: solve u*x + v*y = sun, then scale to the atlas rectangle (mirrored rects flip sign)
            float det = u.x * v.y - u.y * v.x; Vector2 sun = new Vector2(0, 1);
            if (Mathf.Abs(det) > 1e-6f) sun = new Vector2((sunWorld.x * v.y - sunWorld.y * v.x) / det * (uvRect.z - uvRect.x), (u.x * sunWorld.y - u.y * sunWorld.x) / det * (uvRect.w - uvRect.y));
            for (int i = 0; i < 4; i++)
            {
                int su = i & 1, sv = i >> 1;
                Vector2 corner = (su - .5f) * u + (sv - .5f) * v;
                _quad[i] = new V { P = new Vector3(c.x, c.y, 0), Uv = new Vector2(su == 1 ? uvRect.z : uvRect.x, sv == 1 ? uvRect.w : uvRect.y), A = new Vector4(corner.x, corner.y, birth, life), B = new Vector4(g0, g1, style, fadeSeconds), Sun = sun, C = col };
            }
            _mesh.SetVertexBufferData(_quad, 0, slot * 4, 4, 0, MeshUpdateFlags.DontRecalculateBounds | MeshUpdateFlags.DontValidateIndices | MeshUpdateFlags.DontNotifyMeshUsers);
            _cx[slot] = c.x; _cy[slot] = c.y; _rad[slot] = (u.magnitude + v.magnitude) * .5f * Mathf.Max(g0, g1) + .05f;
            Added++;
            return slot;
        }

        /// <summary>Rebuilds the index buffer from live marks overlapping <paramref name="view"/> (x, y = min, z, w = max in world units; ignored when degenerate).</summary>
        public void Flush(float now, Vector4 view, bool cull)
        {
            int n = 0, used = _pool.Used;
            for (int i = 0; i < used; i++)
            {
                if (!_pool.IsLive(i, now)) continue;
                if (cull && (_cx[i] + _rad[i] < view.x || _cx[i] - _rad[i] > view.z || _cy[i] + _rad[i] < view.y || _cy[i] - _rad[i] > view.w)) continue;
                int b = i * 4, k = n * 6;
                _indices[k] = (ushort)b; _indices[k + 1] = (ushort)(b + 2); _indices[k + 2] = (ushort)(b + 1);
                _indices[k + 3] = (ushort)(b + 1); _indices[k + 4] = (ushort)(b + 2); _indices[k + 5] = (ushort)(b + 3);
                n++;
            }
            LastDrawn = n;
            _renderer.enabled = n > 0;
            if (n == 0) return;
            const MeshUpdateFlags f = MeshUpdateFlags.DontRecalculateBounds | MeshUpdateFlags.DontValidateIndices | MeshUpdateFlags.DontNotifyMeshUsers;
            _mesh.SetIndexBufferData(_indices, 0, 0, n * 6, f);
            _mesh.SetSubMesh(0, new SubMeshDescriptor(0, n * 6, MeshTopology.Triangles) { bounds = Big }, f);
            _mesh.bounds = Big;
        }

        public void Destroy() { if (_mesh != null) Object.Destroy(_mesh); if (_renderer != null) Object.Destroy(_renderer.gameObject); }
    }
}
