using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Wall shadows of the few nearest shadowing lights, baked once into a small atlas (R8, <see cref="Slots"/> squares of <see cref="Size"/> texels, each
    /// covering the light's radius). Lights and walls never move, so a slot is traced on the CPU when a light takes it (one slot per frame at most) and the
    /// region shaders only sample it: no per-pixel sphere trace. A slot that is not baked yet reads as unshadowed (the light is added without a slot until then).
    /// </summary>
    public sealed class LightShadowAtlas : System.IDisposable
    {
        public const int Slots = 5, Size = 96;
        public Texture2D Texture { get; private set; }
        readonly byte[] _px = new byte[Slots * Size * Size];
        readonly bool[] _baked = new bool[Slots], _wanted = new bool[Slots];
        readonly float[] _cx = new float[Slots], _cy = new float[Slots], _ext = new float[Slots];
        WallSdf _sdf; bool _dirty;
        static readonly int IdAtlas = Shader.PropertyToID("_RhShadowAtlas");
        public int BakedSlots { get { int n = 0; for (int i = 0; i < Slots; i++) if (_baked[i]) n++; return n; } }
        public bool IsBaked(int slot) { return slot >= 0 && slot < Slots && _baked[slot]; }

        public LightShadowAtlas()
        {
            Texture = new Texture2D(Slots * Size, Size, TextureFormat.R8, false, true) { name = "Light shadow atlas", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            for (int i = 0; i < _px.Length; i++) _px[i] = 255;
            Texture.SetPixelData(_px, 0); Texture.Apply(false, false);
            Shader.SetGlobalTexture(IdAtlas, Texture);
        }

        public void SetWalls(WallSdf sdf) { _sdf = sdf; for (int i = 0; i < Slots; i++) { _baked[i] = false; _wanted[i] = false; } }

        /// <summary>Ask for slot <paramref name="slot"/> to hold the shadow of a light at (tx, ty) with square half-extent <paramref name="extent"/> tiles. A repeat request for the same light is free.</summary>
        public void Request(int slot, float tx, float ty, float extent)
        {
            if (slot < 0 || slot >= Slots) return;
            if (_wanted[slot] && Mathf.Abs(_cx[slot] - tx) < .01f && Mathf.Abs(_cy[slot] - ty) < .01f && Mathf.Abs(_ext[slot] - extent) < .01f) return;
            _cx[slot] = tx; _cy[slot] = ty; _ext[slot] = extent; _wanted[slot] = true; _baked[slot] = false;
        }
        public void Release(int slot) { if (slot >= 0 && slot < Slots) { _wanted[slot] = false; _baked[slot] = false; } }

        /// <summary>Bake at most one pending slot (call once per frame).</summary>
        public void Tick()
        {
            if (_sdf != null)
                for (int s = 0; s < Slots; s++)
                {
                    if (!_wanted[s] || _baked[s]) continue;
                    Bake(s); _baked[s] = true; _dirty = true; break;
                }
            if (_dirty) { Texture.SetPixelData(_px, 0); Texture.Apply(false, false); _dirty = false; }
        }

        void Bake(int s)
        {
            float cx = _cx[s], cy = _cy[s], e = _ext[s];
            for (int v = 0; v < Size; v++)
                for (int u = 0; u < Size; u++)
                {
                    float px = cx + ((u + .5f) / Size * 2f - 1f) * e, py = cy + ((v + .5f) / Size * 2f - 1f) * e;
                    float vis = _sdf.Visibility(px, py, cx, cy);
                    _px[v * Slots * Size + s * Size + u] = (byte)Mathf.RoundToInt(Mathf.Clamp01(vis) * 255f);
                }
        }

        public void Dispose() { if (Texture != null) { if (Application.isPlaying) Object.Destroy(Texture); else Object.DestroyImmediate(Texture); Texture = null; } }
    }
}
