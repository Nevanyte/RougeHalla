// NOT COMPILED in Stage 1 (no Unity). Top-down 2.5D arena from the server's MapBlob, plus actor discs. No art assets.
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed class ArenaView : MonoBehaviour
    {
        /// <summary>World units per server unit: one 32 u tile is one Unity unit.</summary>
        public const float Scale = 1f / 32f;
        const float WallHeight = 1f, LowHeight = 0.35f;

        // Legacy palette (packages/client/src/render/MapView.ts): outdoor floor, wall top/front, low ground top/front.
        static readonly Color32 Floor = new Color32(0x2a, 0x30, 0x38, 255), WallTop = new Color32(0x8a, 0x90, 0x99, 255), WallSide = new Color32(0x55, 0x5b, 0x63, 255),
            LowTop = new Color32(0x5a, 0x60, 0x6a, 255), LowSide = new Color32(0x3a, 0x3f, 0x46, 255);

        Material _mat;
        readonly Dictionary<uint, ActorView> _actors = new Dictionary<uint, ActorView>();
        readonly HashSet<uint> _seen = new HashSet<uint>();
        readonly List<uint> _stale = new List<uint>();
        ActorView _local;
        public bool HasMap { get; private set; }

        Material Mat()
        {
            if (_mat == null) _mat = new Material(Shader.Find("Roguehalla/VertexColor")); // lives in Resources/Shaders so a build keeps it
            return _mat;
        }

        public void Build(MapBlob map)
        {
            var b = new MeshBuilder();
            float w = map.W, h = map.H;
            b.Quad(new Vector3(0, 0, -h), new Vector3(w, 0, -h), new Vector3(w, 0, 0), new Vector3(0, 0, 0), Floor);
            for (int ty = 0; ty < map.H; ty++)
                for (int tx = 0; tx < map.W; tx++)
                {
                    byte t = map.At(tx, ty);
                    if (t == MapBlob.Floor) continue;
                    float top = Height(t);
                    float x0 = tx, x1 = tx + 1, z0 = -ty - 1, z1 = -ty; // tile spans z in [-ty-1, -ty]
                    b.Quad(new Vector3(x0, top, z0), new Vector3(x1, top, z0), new Vector3(x1, top, z1), new Vector3(x0, top, z1), t == MapBlob.Wall ? WallTop : LowTop);
                    Color32 side = t == MapBlob.Wall ? WallSide : LowSide;
                    // A side face only where the neighbour is lower; the map edge needs none.
                    Side(b, map, tx - 1, ty, top, side, new Vector3(x0, 0, z0), new Vector3(x0, 0, z1));
                    Side(b, map, tx + 1, ty, top, side, new Vector3(x1, 0, z1), new Vector3(x1, 0, z0));
                    Side(b, map, tx, ty - 1, top, side, new Vector3(x1, 0, z1), new Vector3(x0, 0, z1)); // north (smaller y)
                    Side(b, map, tx, ty + 1, top, side, new Vector3(x0, 0, z0), new Vector3(x1, 0, z0)); // south: the face the camera sees
                }
            var go = new GameObject("Map");
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = b.ToMesh("map");
            go.AddComponent<MeshRenderer>().sharedMaterial = Mat();
            HasMap = true;
        }

        static float Height(byte t) { return t == MapBlob.Wall ? WallHeight : t == MapBlob.Low ? LowHeight : 0f; }

        static void Side(MeshBuilder b, MapBlob map, int nx, int ny, float top, Color32 col, Vector3 a, Vector3 c)
        {
            float nh = nx < 0 || ny < 0 || nx >= map.W || ny >= map.H ? top : Height(map.At(nx, ny));
            if (nh >= top) return;
            b.Quad(new Vector3(a.x, nh, a.z), new Vector3(c.x, nh, c.z), new Vector3(c.x, top, c.z), new Vector3(a.x, top, a.z), col);
        }

        /// <summary>Updates remote actors from interpolation and the local actor from confirmed server state.</summary>
        public void Present(List<InterpActor> remote, SelfView me, LocalMotion motion, float aimAngle)
        {
            _seen.Clear();
            uint myId = me != null ? me.Id : 0;
            foreach (var a in remote)
            {
                if (a.Id == myId) continue; // self is presented separately from the confirmed self snapshot
                ActorView v;
                if (!_actors.TryGetValue(a.Id, out v)) { v = ActorView.Create(transform, Mat(), a.Faction, false); _actors[a.Id] = v; }
                v.Place(a.X, a.Y, a.Facing, a.HpPct);
                _seen.Add(a.Id);
            }
            _stale.Clear();
            foreach (var kv in _actors) if (!_seen.Contains(kv.Key)) _stale.Add(kv.Key);
            foreach (var id in _stale) { Destroy(_actors[id].gameObject); _actors.Remove(id); }

            if (me != null && motion != null && motion.Initialized)
            {
                if (_local == null) _local = ActorView.Create(transform, Mat(), me.Faction, true);
                _local.Place(motion.DrawnX, motion.DrawnY, aimAngle, me.HpPct);
            }
            else if (_local != null)
            {
                Destroy(_local.gameObject);
                _local = null;
            }
        }

        public void Follow(Camera cam, float serverX, float serverY)
        {
            // Pitched orthographic camera: up on screen is -server y (+z), tilted so wall faces show.
            var focus = new Vector3(serverX * Scale, 0, -serverY * Scale);
            cam.transform.rotation = Quaternion.Euler(55f, 0, 0);
            cam.transform.position = focus - cam.transform.forward * 30f;
        }

        /// <summary>Cursor to server coordinates, on the ground plane. False when the ray misses it.</summary>
        public bool ScreenToServer(Camera cam, Vector2 screen, out float sx, out float sy)
        {
            sx = sy = 0;
            var ray = cam.ScreenPointToRay(new Vector3(screen.x, screen.y, 0));
            float d;
            if (!new Plane(Vector3.up, Vector3.zero).Raycast(ray, out d)) return false;
            var p = ray.GetPoint(d);
            sx = p.x / Scale; sy = -p.z / Scale;
            return true;
        }
    }
}
