// Top-down world presentation from MapBlob and currently supplied observation facts only.
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
        readonly MeshBuilder _actorGeometry = new MeshBuilder(), _collectionGeometry = new MeshBuilder();
        Mesh _actorMesh, _collectionMesh, _mapMesh;
        GameObject _mapObject;
        object _props, _fields, _rewards, _projectiles;
        public bool HasMap { get; private set; }

        Material Mat()
        {
            if (_mat == null) _mat = new Material(Shader.Find("Roguehalla/VertexColor")); // lives in Resources/Shaders so a build keeps it
            return _mat;
        }

        public void Build(MapBlob map)
        {
            if (_mapObject != null) Destroy(_mapObject);
            Release(_mapMesh);
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
            _mapObject = go;
            _mapMesh = b.ToMesh("map");
            go.AddComponent<MeshFilter>().sharedMesh = _mapMesh;
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

        /// <summary>One batch rebuilt from the current sampled actors. Renewing NPC refs cause no object churn.</summary>
        public void Present(List<InterpActor> remote, SelfView me, LocalMotion motion, float aimAngle)
        {
            EnsureBatch(ref _actorMesh, "Actors");
            _actorGeometry.Clear();
            uint myId = me != null ? me.Id : 0;
            for (int i = 0; i < remote.Count; i++)
            {
                var a = remote[i];
                if (a.Id == myId) continue;
                ActorView.Draw(_actorGeometry, a.X, a.Y, a.Facing, a.HpPct, a.Faction, a.Status,
                    a.Weapon, a.Kind, a.MobType, a.Effects, a.SourceSig, false);
            }
            if (me != null)
            {
                bool predicted = motion != null && motion.Initialized;
                ActorView.Draw(_actorGeometry, predicted ? motion.DrawnX : me.X, predicted ? motion.DrawnY : me.Y,
                    aimAngle, me.HpPct, me.Faction, me.Status, me.Weapon, ActorKind.Player, null, me.Effects, me.SelfSig, true);
            }
            _actorGeometry.Apply(_actorMesh);
        }

        /// <summary>Complete current collection replacements, with no flight, expiry or proximity simulation.</summary>
        public void PresentCollections(CollectionsView collections)
        {
            if (collections != null && ReferenceEquals(_props, collections.Props) && ReferenceEquals(_fields, collections.Fields)
                && ReferenceEquals(_rewards, collections.RewardChests) && ReferenceEquals(_projectiles, collections.Projectiles)) return;
            EnsureBatch(ref _collectionMesh, "Observed props and projectiles");
            _collectionGeometry.Clear();
            _props = collections != null ? collections.Props : null;
            _fields = collections != null ? collections.Fields : null;
            _rewards = collections != null ? collections.RewardChests : null;
            _projectiles = collections != null ? collections.Projectiles : null;
            if (collections != null)
            {
                var b = _collectionGeometry;
                for (int i = 0; i < collections.Fields.Count; i++)
                {
                    var f = collections.Fields[i];
                    var p = Point(f.X, f.Y, .025f);
                    Color32 color = FieldColor(f.Ability);
                    if (f.Radius > 0) b.Ring(p, f.Radius * Scale, .045f, color);
                    if (f.Kind == AreaKind.Trail)
                    {
                        var end = Point(f.X2, f.Y2, .025f);
                        b.Line(p, end, .055f, color);
                        if (f.Radius > 0) b.Ring(end, f.Radius * Scale, .045f, color);
                    }
                }
                for (int i = 0; i < collections.Props.Count; i++)
                {
                    var prop = collections.Props[i];
                    var p = Point(prop.X, prop.Y, .045f);
                    if (prop.Focused) b.Ring(p, .64f, .065f, new Color32(238, 250, 255, 255));
                    if (prop.Kind == PropAppearance.Ground)
                    {
                        b.DiscAt(p, .36f, 12, new Color32(65, 84, 101, 255));
                        if (prop.Weapon.HasValue) b.Weapon(p + Vector3.up * .015f, prop.Weapon.Value, Mathf.PI * .25f, 1.15f, new Color32(247, 231, 183, 255));
                    }
                    else if (prop.Kind == PropAppearance.Chest)
                        Chest(b, p, prop.Open, false);
                    else if (prop.Kind == PropAppearance.Body)
                    {
                        var body = new Color32(140, 146, 161, 255);
                        b.Rect(p, .28f, .7f, body);
                        b.DiscAt(p + new Vector3(0, .01f, .48f), .16f, 8, body);
                        b.Line(p + new Vector3(-.28f, .02f, -.35f), p + new Vector3(.28f, .02f, .2f), .06f, new Color32(224, 210, 206, 255));
                        if (prop.BodyHint.HasValue) b.Weapon(p + new Vector3(.5f, .03f, 0), prop.BodyHint.Value, 0, .8f, body);
                    }
                }
                for (int i = 0; i < collections.RewardChests.Count; i++)
                {
                    var chest = collections.RewardChests[i];
                    var p = Point(chest.X, chest.Y, .05f);
                    Chest(b, p, chest.Picked, true);
                    if (chest.CanChoose) b.Ring(p, .75f, .075f, new Color32(255, 240, 145, 255));
                    // Card silhouette makes reward chests distinct from equipment containers.
                    b.Rect(p + new Vector3(0, .40f, .05f), .24f, .32f, new Color32(255, 248, 210, 255));
                    b.Rect(p + new Vector3(0, .41f, .05f), .11f, .08f, new Color32(145, 91, 38, 255));
                }
                for (int i = 0; i < collections.Projectiles.Count; i++)
                {
                    // An ID-free complete array: render every row, including exact duplicates, at its current point.
                    var shot = collections.Projectiles[i];
                    var p = Point(shot.X, shot.Y, .22f);
                    var forward = new Vector3(Mathf.Cos(shot.Facing), 0, -Mathf.Sin(shot.Facing));
                    if (shot.Kind == ProjectileKind.Arrow)
                    {
                        var color = new Color32(255, 238, 184, 255);
                        b.Line(p - forward * .24f, p + forward * .24f, .045f, color);
                        var side = new Vector3(-forward.z, 0, forward.x);
                        b.Tri(p + forward * .32f, p + forward * .1f + side * .11f, p + forward * .1f - side * .11f, color);
                    }
                    else
                    {
                        b.DiscAt(p, .16f, 12, new Color32(207, 148, 255, 255));
                        b.Line(p + Vector3.up * .01f, p + forward * .25f + Vector3.up * .01f, .055f, new Color32(255, 245, 255, 255));
                    }
                }
            }
            _collectionGeometry.Apply(_collectionMesh);
        }

        static Vector3 Point(float x, float y, float height) { return new Vector3(x * Scale, height, -y * Scale); }

        static Color32 FieldColor(AbilityId ability)
        {
            switch (ability)
            {
                case AbilityId.Freeze: return new Color32(100, 211, 255, 255);
                case AbilityId.Swarm: return new Color32(162, 207, 85, 255);
                case AbilityId.Blaze: return new Color32(255, 136, 77, 255);
                case AbilityId.Trial: return new Color32(185, 142, 240, 255);
                default: return new Color32(255, 225, 143, 255);
            }
        }

        static void Chest(MeshBuilder b, Vector3 p, bool open, bool reward)
        {
            Color32 top = reward ? new Color32(225, 180, 76, 255) : new Color32(165, 117, 71, 255);
            Color32 side = reward ? new Color32(151, 104, 47, 255) : new Color32(104, 72, 51, 255);
            var a = p + new Vector3(-.38f, 0, -.27f);
            var c = p + new Vector3(.38f, 0, .27f);
            float h = .22f;
            b.Quad(a, new Vector3(c.x, a.y, a.z), new Vector3(c.x, a.y + h, a.z), a + Vector3.up * h, side);
            b.Quad(new Vector3(c.x, a.y, a.z), c, c + Vector3.up * h, new Vector3(c.x, a.y + h, a.z), side);
            b.Rect(p + Vector3.up * h, .76f, .54f, open ? new Color32(39, 35, 34, 255) : top);
            if (open) b.Rect(p + new Vector3(0, h + .08f, .39f), .76f, .22f, top);
            else b.Rect(p + new Vector3(0, h + .01f, 0), .1f, .55f, new Color32(242, 215, 132, 255));
        }

        void EnsureBatch(ref Mesh mesh, string name)
        {
            if (mesh != null) return;
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            mesh = new Mesh { name = name };
            mesh.MarkDynamic();
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = Mat();
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        static void Release(Object obj)
        {
            if (obj == null) return;
            if (Application.isPlaying) Destroy(obj); else DestroyImmediate(obj);
        }

        void OnDestroy()
        {
            Release(_actorMesh); Release(_collectionMesh); Release(_mapMesh); Release(_mat);
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
