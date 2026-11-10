using UnityEngine;
using UnityEngine.Rendering.Universal;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>
    /// The living backdrop behind the launch screen: the game's own region ground, walls and props (through the public
    /// <see cref="ArenaView"/> API) over a small synthetic five-region strip, with the camera drifting slowly over the region of the
    /// selected faction. It needs no server: the map is generated locally and holds only decorative terrain, so no player, rule or
    /// hidden state is involved. It is built once, one frame after the menu first appears, and costs a single ground quad, row-batched
    /// walls and a few hundred sprites sharing one atlas.
    ///
    /// Lighting: every ArenaView creates a global ambient light and URP rejects a second one (with a console error at registration). The
    /// backdrop's own light is therefore kept permanently off and the vista is lit by the global light of the client's own pre-match
    /// arena, which exists whenever the menu does (Bootstrap makes the first; this class re-makes it after a Leave). A joining client
    /// destroys that arena before it builds the match's, so exactly one global light is ever registered.
    ///
    /// Presets: Low keeps the vista still (no drift, no ambient particles). Reduced motion also holds it still and cuts straight to a
    /// new region instead of gliding. The camera and orthographic size are restored when the backdrop hides.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class LaunchBackdrop : MonoBehaviour
    {
        public const int RegionWidth = 64, RegionCount = 5, MapHeight = 44;
        const float Ortho = 10f, MatchOrtho = 9f, CentreY = 22f;
        const float DriftX = 7f, DriftY = 2.4f, DriftSpeed = .055f, GlideSeconds = 1.1f;
        const int BuildDelayFrames = 3;

        Camera _cam;
        ArenaView _arena;
        GameObject _root;
        MatchClient _client;
        bool _visible, _built;
        int _framesVisible, _focus = 3;
        Vector2 _pos, _vel;
        float _clock, _reveal;
        Light2D[] _ownAmbient;

        /// <summary>0 until the vista is built and fading in, 1 once fully shown (the launch screen fades its veil with it).</summary>
        public float Reveal { get { return _reveal; } }
        public bool Built { get { return _built; } }
        public int Focus { get { return _focus; } }
        public Vector2 CameraTile { get { return _pos; } }

        public void Initialize(Camera cam, MatchClient client)
        {
            _cam = cam; _client = client; _pos = FocusTile(_focus);
        }

        /// <summary>The synthetic strip: five equal region columns (Fire to Holy) with a few ruined walls and one terrain pool each. Pure, deterministic.</summary>
        public static MapBlob BuildMap()
        {
            int w = RegionWidth * RegionCount, h = MapHeight;
            var tiles = new byte[w * h]; var regions = new byte[w * h]; var terrain = new byte[w * h];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int i = y * w + x, r = x / RegionWidth;
                    regions[i] = (byte)(1 + r);
                    if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) tiles[i] = MapBlob.Wall;
                }
            for (int r = 0; r < RegionCount; r++)
            {
                int bx = r * RegionWidth;
                for (int x = 21; x <= 28; x++) tiles[16 * w + bx + x] = MapBlob.Wall;
                for (int x = 37; x <= 43; x++) tiles[29 * w + bx + x] = MapBlob.Wall;
                for (int y = 17; y <= 21; y++) tiles[y * w + bx + 44] = MapBlob.Wall;
                for (int x = 24; x <= 27; x++) tiles[26 * w + bx + x] = MapBlob.Low;
            }
            Pool(terrain, w, h, 0 * RegionWidth + 47, 21, 4f, TerrainKind.Lava);
            Pool(terrain, w, h, 2 * RegionWidth + 19, 21, 3.2f, TerrainKind.Bog);
            Pool(terrain, w, h, 3 * RegionWidth + 17, 27, 5f, TerrainKind.Ice);
            return new MapBlob((ushort)w, (ushort)h, tiles, terrain, regions, MapBlob.GroundTerrainMap);
        }

        static void Pool(byte[] terrain, int w, int h, int cx, int cy, float radius, TerrainKind kind)
        {
            for (int y = Mathf.Max(0, cy - 6); y <= Mathf.Min(h - 1, cy + 6); y++)
                for (int x = Mathf.Max(0, cx - 6); x <= Mathf.Min(w - 1, cx + 6); x++)
                {
                    float dx = (x - cx) / 1.25f, dy = y - cy;
                    if (dx * dx + dy * dy <= radius * radius) terrain[y * w + x] = (byte)kind;
                }
        }

        /// <summary>The tile the camera centres on for a faction (0 Fire .. 4 Holy): the middle of that faction's region column.</summary>
        public static Vector2 FocusTile(int faction)
        {
            int r = Mathf.Clamp(faction, 0, RegionCount - 1);
            return new Vector2(r * RegionWidth + RegionWidth * .5f, CentreY);
        }

        /// <summary>The camera tile at a moment: the focus plus a slow Lissajous drift (none when motion is off).</summary>
        public static Vector2 DriftTile(int faction, float seconds, bool drift)
        {
            var c = FocusTile(faction);
            if (!drift) return c;
            return new Vector2(c.x + Mathf.Sin(seconds * DriftSpeed * 2f * Mathf.PI) * DriftX, c.y + Mathf.Sin(seconds * DriftSpeed * 1.3f * 2f * Mathf.PI + 1.1f) * DriftY);
        }

        public void SetVisible(bool visible)
        {
            if (_visible == visible) return;
            _visible = visible;
            if (visible) { _framesVisible = 0; _clock = 0f; }
            else Hide();
        }

        public void FocusFaction(int faction)
        {
            int f = Mathf.Clamp(faction, 0, RegionCount - 1);
            if (f == _focus) return;
            _focus = f;
            if (!AllowGlide || !_built) { _pos = DriftTile(_focus, _clock, false); _vel = Vector2.zero; }
        }

        static bool ReducedMotion { get { return ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion; } }
        static bool AllowGlide { get { return !ReducedMotion && Quality.Preset != ShowcaseQuality.Low; } }

        void Hide()
        {
            if (_root != null) _root.SetActive(false);
            if (_cam != null) _cam.orthographicSize = MatchOrtho;
            _reveal = 0f;
        }

        void LateUpdate()
        {
            if (!_visible || _cam == null) return;
            _framesVisible++;
            EnsureHostArena();
            if (!_built)
            {
                if (_framesVisible < BuildDelayFrames) return;
                Build();
            }
            if (_root != null && !_root.activeSelf) _root.SetActive(true);
            float dt = Mathf.Min(Time.unscaledDeltaTime, .1f);
            _clock += dt;
            bool drift = AllowGlide;
            var target = DriftTile(_focus, _clock, drift);
            _pos = drift ? Vector2.SmoothDamp(_pos, target, ref _vel, GlideSeconds, 60f, dt) : target;
            _cam.orthographicSize = Ortho;
            _arena.Follow(_cam, _pos.x * 32f, _pos.y * 32f);
            _reveal = ReducedMotion ? 1f : Mathf.MoveTowards(_reveal, 1f, dt / .9f);
        }

        void Build()
        {
            // Registering the backdrop's light while the host's is on is the error to avoid: park the host's, create, switch the backdrop's off.
            var host = HostLights();
            foreach (var l in host) l.enabled = false;
            _root = new GameObject("Launch backdrop");
            _root.transform.SetParent(transform, false);
            _arena = _root.AddComponent<ArenaView>();
            _arena.Build(BuildMap());
            _ownAmbient = _root.GetComponentsInChildren<Light2D>(true);
            foreach (var l in _ownAmbient) if (l.lightType == Light2D.LightType.Global) l.enabled = false;
            foreach (var l in host) if (l != null) l.enabled = true;
            _built = true;
        }

        /// <summary>The client's pre-match arena must exist while the menu shows, because it carries the scene's one global light.</summary>
        void EnsureHostArena()
        {
            if (_client == null || _client.Arena != null) return;
            _client.Arena = new GameObject("Arena").AddComponent<ArenaView>();
        }

        Light2D[] HostLights()
        {
            var host = _client != null ? _client.Arena : null;
            if (host == null || host == _arena) return new Light2D[0];
            var all = host.GetComponentsInChildren<Light2D>(true);
            var globals = new System.Collections.Generic.List<Light2D>();
            foreach (var l in all) if (l.lightType == Light2D.LightType.Global && l.enabled) globals.Add(l);
            return globals.ToArray();
        }

        void OnDestroy()
        {
            if (_root != null) Destroy(_root);
        }
    }
}
