// NOT COMPILED in Stage 1 (no Unity). A coloured disc per actor with a facing nose and an hp bar. Colored shapes only, as the legacy game.
using UnityEngine;
using Roguehalla.Net;

namespace Roguehalla.Client
{
    public sealed class ActorView : MonoBehaviour
    {
        public const float Scale = ArenaView.Scale;
        const float Radius = 12f * Scale;
        Transform _nose, _bar;
        readonly System.Collections.Generic.List<Mesh> _ownedMeshes = new System.Collections.Generic.List<Mesh>(5);
        void OnDestroy() { foreach (var mesh in _ownedMeshes) if (mesh != null) { if (Application.isPlaying) Destroy(mesh); else DestroyImmediate(mesh); } }

        /// <summary>Legacy palette (packages/shared/src/factions.ts): fire, sentenced, plague, frost, holy.</summary>
        static readonly Color32[] FactionColors =
        {
            new Color32(0xff, 0x70, 0x43, 255), new Color32(0x95, 0x75, 0xcd, 255), new Color32(0x9c, 0xcc, 0x65, 255),
            new Color32(0x4f, 0xc3, 0xf7, 255), new Color32(0xff, 0xf1, 0x76, 255),
        };
        public static Color32 FactionColor(FactionId f) { int i = (int)f; return i < FactionColors.Length ? FactionColors[i] : new Color32(0xb0, 0xb0, 0xb0, 255); }

        public static ActorView Create(Transform parent, Material mat, FactionId faction, bool local)
        {
            var go = new GameObject("Actor");
            go.transform.SetParent(parent, false);
            var v = go.AddComponent<ActorView>();
            v.Part("Body", MeshBuilder.Disc(Radius, 24, FactionColor(faction)), mat, 0f, Vector3.one);
            if (local) v.Part("Ring", MeshBuilder.Disc(Radius * 1.25f, 24, new Color32(255, 255, 255, 255)), mat, -0.01f, Vector3.one);
            v._nose = v.Part("Nose", MeshBuilder.Nose(new Color32(255, 255, 255, 255)), mat, 0.02f, Vector3.one * (Radius * 4f)).transform;
            v.Part("BarBack", MeshBuilder.Bar(new Color32(30, 30, 30, 255)), mat, 0.03f, new Vector3(Radius * 2f, 1, 0.14f), new Vector3(-Radius, 0, -Radius * 1.6f));
            v._bar = v.Part("BarFill", MeshBuilder.Bar(new Color32(90, 220, 90, 255)), mat, 0.04f, new Vector3(Radius * 2f, 1, 0.1f), new Vector3(-Radius, 0, -Radius * 1.6f)).transform;
            return v;
        }

        GameObject Part(string name, Mesh mesh, Material mat, float y, Vector3 scale, Vector3? offset = null)
        {
            _ownedMeshes.Add(mesh);
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = (offset ?? Vector3.zero) + new Vector3(0, y, 0);
            go.transform.localScale = scale;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = mat;
            return go;
        }

        /// <summary>Server coordinates in, world out: x -> x, y -> -z, so server +y is down the screen under a camera whose up is +z.</summary>
        public void Place(float x, float y, float facing, int hpPct)
        {
            transform.position = new Vector3(x * Scale, 0.05f, -y * Scale);
            _nose.localRotation = Quaternion.Euler(0, Mathf.Atan2(Mathf.Cos(facing), -Mathf.Sin(facing)) * Mathf.Rad2Deg, 0);
            var s = _bar.localScale; s.x = Radius * 2f * Mathf.Clamp01(hpPct / 100f); _bar.localScale = s;
        }
    }
}
