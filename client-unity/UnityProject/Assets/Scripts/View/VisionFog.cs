// Fog of war, presentation only. A separate layer: it reads the public map, the local player's own delivered position and the
// positions of actors the server delivered, and it can only dim. It never decides what exists, is never used by gameplay, and a
// delivered actor is always cleared (ArenaView hands its positions in). The maths lives in Roguehalla.Net (Vision.cs) and is proven
// against the Rust sight rule by protocol/fixtures/sight_v1.json. Lighting is a different layer and does not imitate this one.
using System;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed class VisionFog : IDisposable
    {
        /// <summary>Above world art, effects and health bars, below every HUD canvas.</summary>
        public const int SortingOrder = 31000;
        public const int MaxClearings = 96;
        /// <summary>Veil colour the minimap and Tab map tint with (the world shader owns the world look).</summary>
        public static readonly Color32 UiTint = new Color32(18, 24, 38, 255);

        static Material _uiMaterial;
        /// <summary>Material for the minimap and Tab map overlay (see RhVisionFogUi.shader); null when the shader is missing (the overlay then tints plainly).</summary>
        public static Material UiMaterial
        {
            get
            {
                if (_uiMaterial == null)
                {
                    var shader = Resources.Load<Shader>("Shaders/RhVisionFogUi");
                    if (shader != null) _uiMaterial = new Material(shader) { name = "Roguehalla / vision fog UI", hideFlags = HideFlags.HideAndDontSave };
                }
                return _uiMaterial;
            }
        }

        /// <summary>The fog currently owning the shared texture (the world layer); UI surfaces read it. Null outside a match view.</summary>
        public static VisionFog Current { get; private set; }

        readonly Transform _parent;
        VisionRule _rule;
        VisionField _field;
        FogMask _mask;
        Texture2D _tex;
        Color32[] _pix;
        Material _material;
        GameObject _root;
        MeshRenderer _renderer;
        Mesh _mesh;
        readonly FogClearing[] _clearings = new FogClearing[MaxClearings];
        int _clearCount;
        ulong _signature;
        bool _active, _textureDirty;
        long _mapKey = -1;
        int _softness = 2;

        // Diagnostics: how often the client's own sight rule agrees with the server about delivered actors.
        public int UpdatesDone { get; private set; }
        public int TextureUploads { get; private set; }
        /// <summary>Frames x delivered live actors sampled, and how many of those stood on a tile the client's own rule called fog.</summary>
        public long AuditSamples { get; private set; }
        public long AuditFogged { get; private set; }
        /// <summary>Departures (an actor stopped being delivered), and how many last stood on a tile the client's own rule called fog.</summary>
        public long AuditDepartures { get; private set; }
        public long AuditDeparturesFogged { get; private set; }
        /// <summary>Delivered live actors found under fog after the clearings were carved. Always 0 unless the fail-safe is broken.</summary>
        public long AuditCovered { get; private set; }
        public bool AuditLog { get; set; }
        /// <summary>
        /// Diagnostic only (url flag vision.debugRadius=N, in tiles): also fogs everything farther than N tiles from the player, so the fog
        /// pipeline can be seen on open ground where no wall hides anything. It only adds fog; delivered actors are still cleared. Off by default.
        /// </summary>
        public float DebugRadiusTiles { get; set; }
        float _debugX, _debugY, _meX, _meY;
        float _nextAuditLog;

        /// <summary>An actor stopped being delivered; was its last delivered tile one the client's rule also called seen?</summary>
        public void AuditDeparture(float tileX, float tileY)
        {
            if (_field == null || !_active) return;
            AuditDepartures++;
            bool fogged = _field.IsFogged((int)tileX, (int)tileY);
            if (fogged) AuditDeparturesFogged++;
            if (AuditLog) Debug.Log("[vision-depart] t=" + Time.unscaledTime.ToString("F3") + " tile=" + (int)tileX + "," + (int)tileY + " me=" + (int)_meX + "," + (int)_meY + " clientFog=" + (fogged ? 1 : 0));
        }

        public void AuditArrival(float tileX, float tileY)
        {
            if (AuditLog && _field != null && _active)
                Debug.Log("[vision-arrive] t=" + Time.unscaledTime.ToString("F3") + " tile=" + (int)tileX + "," + (int)tileY + " me=" + (int)_meX + "," + (int)_meY + " clientFog=" + (_field.IsFogged((int)tileX, (int)tileY) ? 1 : 0));
        }

        public VisionFog(Transform parent) { _parent = parent; }

        public Texture Texture { get { return _tex; } }
        /// <summary>True while a match is running and the local player is alive: the fog is drawn on the world, the minimap and the Tab map.</summary>
        public bool Active { get { return _active; } }
        public VisionField Field { get { return _field; } }
        public VisionRule Rule { get { return _rule; } }
        public int Width { get { return _rule != null ? _rule.Width : 0; } }
        public int Height { get { return _rule != null ? _rule.Height : 0; } }

        bool _warned;

        /// <summary>Builds the fog for <paramref name="map"/> from the server's delivered <paramref name="vision"/> (null: the mirrored
        /// defaults). Rules this client cannot mirror (unknown version, bad numbers) leave no fog at all, with one console warning.</summary>
        public void Configure(MapBlob map, WireVision vision = null)
        {
            if (map == null || map.W <= 0 || map.H <= 0) return;
            long key = ((long)map.W << 40) ^ ((long)map.H << 20) ^ map.LayerHash;
            if (key == _mapKey && _field != null) return;
            Dispose(false);
            _mapKey = key;
            _rule = new VisionRule(map, vision);
            if (!_rule.Usable)
            {
                if (!_warned) { _warned = true; Debug.LogWarning("[vision] the server's vision rules (version " + vision.Version + ") are not ones this client mirrors; fog of war is off."); }
                _rule = null;
                return;
            }
            _field = new VisionField(_rule);
            _mask = new FogMask(map.W, map.H);
            _pix = new Color32[map.W * map.H];
            _tex = new Texture2D(map.W, map.H, TextureFormat.RGBA32, false, true)
            { name = "Vision fog (alpha = amount)", filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp, hideFlags = HideFlags.HideAndDontSave };
            var shader = Resources.Load<Shader>("Shaders/RhVisionFog");
            if (shader != null) _material = new Material(shader) { name = "Roguehalla / vision fog", hideFlags = HideFlags.HideAndDontSave };
            _root = new GameObject("Vision fog (1 quad)");
            _root.transform.SetParent(_parent, false);
            _mesh = new Mesh { name = "Vision fog quad", hideFlags = HideFlags.HideAndDontSave };
            float x1 = map.W, y1 = -map.H * ArenaView.GroundSquash;
            _mesh.vertices = new[] { new Vector3(0, 0, 0), new Vector3(x1, 0, 0), new Vector3(x1, y1, 0), new Vector3(0, y1, 0) };
            _mesh.uv = new[] { Vector2.zero, Vector2.right, Vector2.one, Vector2.up };
            _mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            _mesh.bounds = new Bounds(new Vector3(x1 / 2, y1 / 2, 0), new Vector3(x1, -y1, 1));
            _root.AddComponent<MeshFilter>().sharedMesh = _mesh;
            _renderer = _root.AddComponent<MeshRenderer>();
            _renderer.sharedMaterial = _material;
            _renderer.sortingOrder = SortingOrder;
            _renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            _renderer.receiveShadows = false;
            _renderer.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
            _renderer.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
            if (_material != null) _material.SetTexture("_FogTex", _tex);
            _renderer.enabled = false;
            ApplyQuality();
            ClearTexture();
            Current = this;
        }

        /// <summary>Cheap blur only: the fog itself is information and is never disabled by a quality preset.</summary>
        public void ApplyQuality()
        {
            var q = ShowcaseSettings.Current != null ? ShowcaseSettings.Current.EffectiveQuality : ShowcaseQuality.High;
            int softness = q == ShowcaseQuality.Low ? 1 : 2;
            if (softness == _softness && _mask != null && _mask.Softness == softness) return;
            _softness = softness;
            if (_mask != null && _field != null) { _mask.Softness = softness; _mask.RebuildAll(_field); _textureDirty = true; _signature = 0; }
        }

        /// <summary>A new timeline (welcome, resume, clock cut): the old trail is void.</summary>
        public void Reset()
        {
            if (_field == null) return;
            _field.Reset();
            _mask.RebuildAll(_field);
            _field.TakeDirty(out _, out _, out _, out _);
            _signature = 0; _textureDirty = true;
        }

        /// <summary>
        /// One frame. <paramref name="visionOn"/> is true only while a match runs and the player is alive; otherwise the fog is off and
        /// forgotten. <paramref name="ox"/>/<paramref name="oy"/> are the local player's newest delivered position, <paramref name="serverMs"/>
        /// the newest snapshot's source time. Clearings (delivered actors, fading ghosts) are read from <paramref name="actors"/>.
        /// </summary>
        public void Tick(bool visionOn, double ox, double oy, double serverMs, SpriteActorPresenter actors)
        {
            if (_field == null) return;
            if (!visionOn)
            {
                if (_active) { _active = false; _renderer.enabled = false; _field.Reset(); _mask.RebuildAll(_field); _field.TakeDirty(out _, out _, out _, out _); ClearTexture(); }
                return;
            }
            bool wasActive = _active;
            _active = true;
            _field.Update(ox, oy, serverMs);
            _meX = (float)(ox / _rule.Tile); _meY = (float)(oy / _rule.Tile);
            if (DebugRadiusTiles > 0f) { float nx = (float)(ox / _rule.Tile), ny = (float)(oy / _rule.Tile); if (Mathf.Abs(nx - _debugX) > .25f || Mathf.Abs(ny - _debugY) > .25f) { _debugX = nx; _debugY = ny; _textureDirty = true; } }
            if (_field.TakeDirty(out int x0, out int y0, out int x1, out int y1)) { _mask.Rebuild(_field, x0, y0, x1, y1); _textureDirty = true; UpdatesDone++; }
            _clearCount = actors != null ? actors.CollectClearings(_clearings) : 0;
            ulong sig = 1469598103934665603UL;
            for (int i = 0; i < _clearCount; i++)
            {
                var c = _clearings[i];
                sig = (sig ^ (ulong)(int)(c.TileX * 8f)) * 1099511628211UL;
                sig = (sig ^ (ulong)(int)(c.TileY * 8f)) * 1099511628211UL;
                sig = (sig ^ (ulong)(int)(c.Strength * 32f)) * 1099511628211UL;
            }
            if (_textureDirty || sig != _signature || !wasActive)
            {
                _signature = sig;
                _mask.Compose(_clearings, _clearCount);
                Upload();
            }
            _renderer.enabled = true;
            for (int i = 0; i < _clearCount; i++)
            {
                var c = _clearings[i];
                if (c.Strength < 0.99f) continue;
                AuditSamples++;
                if (_field.IsFogged((int)c.TileX, (int)c.TileY)) AuditFogged++;
                if (c.Strength >= 0.999f && AuditAmount(c.TileX, c.TileY) > 0) AuditCovered++; // must stay 0: a delivered actor is never under fog
            }
            if (AuditLog && Time.unscaledTime >= _nextAuditLog)
            {
                _nextAuditLog = Time.unscaledTime + 5f;
                Debug.Log("[vision-audit] samples=" + AuditSamples + " clientFog=" + AuditFogged + " covered=" + AuditCovered + " departures=" + AuditDepartures + " departureFog=" + AuditDeparturesFogged
                    + " uploads=" + TextureUploads + " updates=" + UpdatesDone);
            }
        }

        void Upload()
        {
            byte[] a = _mask.Alpha;
            var t = UiTint;
            if (DebugRadiusTiles > 0f)
            {
                int w = _mask.Width; float r2 = DebugRadiusTiles * DebugRadiusTiles;
                for (int i = 0; i < a.Length; i++)
                {
                    float dx = i % w + .5f - _debugX, dy = i / w + .5f - _debugY;
                    // Carved clearings stay clear: only tiles the mask left fully fogged-by-nothing get the debug ring, so this never covers an actor.
                    t.a = dx * dx + dy * dy > r2 && a[i] == 0 && !NearClearing(i % w + .5f, i / w + .5f) ? (byte)255 : a[i];
                    _pix[i] = t;
                }
            }
            else
            for (int i = 0; i < a.Length; i++) { t.a = a[i]; _pix[i] = t; }
            _tex.SetPixelData(_pix, 0);
            _tex.Apply(false);
            _textureDirty = false;
            TextureUploads++;
        }

        bool NearClearing(float tx, float ty)
        {
            for (int k = 0; k < _clearCount; k++)
            {
                float dx = tx - _clearings[k].TileX, dy = ty - _clearings[k].TileY;
                if (dx * dx + dy * dy < FogMask.ClearOuterTiles * FogMask.ClearOuterTiles) return true;
            }
            return false;
        }

        void ClearTexture()
        {
            if (_tex == null) return;
            var t = UiTint; t.a = 0;
            for (int i = 0; i < _pix.Length; i++) _pix[i] = t;
            _tex.SetPixelData(_pix, 0); _tex.Apply(false);
        }

        int AuditAmount(float tileX, float tileY)
        {
            int tx = (int)tileX, ty = (int)tileY;
            if (tx < 0 || ty < 0 || tx >= _mask.Width || ty >= _mask.Height) return 0;
            return _mask.Alpha[ty * _mask.Width + tx];
        }

        /// <summary>The fog amount (0..255) at a world position in server units, for diagnostics. Includes the carved clearings.</summary>
        public int AmountAt(float serverX, float serverY)
        {
            if (_mask == null) return 0;
            int tx = (int)(serverX / 32f), ty = (int)(serverY / 32f);
            if (tx < 0 || ty < 0 || tx >= _mask.Width || ty >= _mask.Height) return 0;
            return _mask.Alpha[ty * _mask.Width + tx];
        }

        public void Dispose() { Dispose(true); }

        static void Kill(UnityEngine.Object o)
        {
            if (o == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(o); else UnityEngine.Object.DestroyImmediate(o);
        }

        void Dispose(bool final)
        {
            if (Current == this) Current = null;
            Kill(_root); Kill(_material); Kill(_tex); Kill(_mesh);
            _root = null; _material = null; _tex = null; _mesh = null; _field = null; _mask = null; _rule = null; _mapKey = -1;
            if (final) _active = false;
        }
    }
}
