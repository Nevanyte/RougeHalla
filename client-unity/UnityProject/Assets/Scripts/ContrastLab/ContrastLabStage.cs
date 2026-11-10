// Contrast lab stage (?contrastlab=1): a serverless test stage that draws synthetic actors through the SAME presentation path a match uses
// (ArenaView.Present -> SpriteActorPresenter.Present, so the outline, light rim, contact shadow, hp bar and faction marks are exactly the
// game's), over the game's own region ground, walls and props for ONE zone at a time. No MatchClient, no Net, no HUD: nothing here talks to a
// server. Reachable only through Bootstrap's `contrastlab=1` query flag.
//
// It is only a stage and a set of render modes. The measurement lives in Tools/contrast-gate.cjs, which reads window.__rhContrastLab
// (RhContrastLab.jslib) for the cell rectangles and switches the render mode between screenshots:
//   normal     the frame as the player sees it.
//   no-actors  the same frame with the actors culled (ground, props, lights, haze only).
//   mask       only the actors, each drawn renderer in a flat colour on black: silhouette (sprite + dark outline + mantle + weapon cue)
//              red, light rim cyan (the tool counts rim as silhouette too, and also measures the red core alone), hp bar green, faction footprint blue, faction insignia/badges yellow, any other indicator magenta. The contact shadow
//              is hidden in this mode (it is a soft darkening, not part of the silhouette).
//
// Freezing: after the camera has settled, walking cells are driven toward their cell for a fixed time (so the real gait walks and lands on
// a mid-stride frame), then ArenaView.Present is no longer called. Actors therefore keep exactly the pixels they had, so the three modes
// line up to the pixel. Ambient effects (dust, haze, snow, lights) keep running; the tool averages several normal frames instead.
using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace Roguehalla.Client
{
    public enum LabMode { Normal, NoActors, Mask }

    public sealed class ContrastLabStage : MonoBehaviour
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void RhContrastLab_Init();
        [DllImport("__Internal")] static extern void RhContrastLab_Publish(string json);
#endif
        public const int ActorLayer = 30;
        public const string ObjectName = "ContrastLab";
        // Mask classes (flat colours on black; see the header).
        public const int ClassSilhouette = 0, ClassHp = 1, ClassFootprint = 2, ClassInsignia = 3, ClassOther = 4, ClassShadow = 5, ClassRim = 6;
        public static readonly Color32[] ClassColors =
        {
            new Color32(255, 0, 0, 255), new Color32(0, 255, 0, 255), new Color32(0, 0, 255, 255), new Color32(255, 255, 0, 255), new Color32(255, 0, 255, 255), new Color32(0, 0, 0, 255), new Color32(0, 255, 255, 255)
        };
        const float WalkSeconds = .4f, WalkDistance = 64f;       // server units walked before the freeze
        const float SettleFirst = 4f, SettleZone = 3.5f, SettlePage = 1.5f;
        const int ModeFrames = 4;

        /// <summary>True only for `?contrastlab=1`. The single gate: Bootstrap builds nothing of the lab otherwise.</summary>
        public static bool Requested(string search) { return Bootstrap.Query(search, "contrastlab", "0") == "1"; }

        /// <summary>The renderer-name to mask class table (names come from SpriteActorPresenter.Create and ShowcaseIdentityOwner).</summary>
        public static int ClassOf(string name)
        {
            // The adaptive outline of a marker or of the mantle is part of that mark ("<mark> outline"); the body's stroke is "Character contrast rim".
            if (name != null && name.EndsWith(" outline")) name = name.Substring(0, name.Length - " outline".Length);
            switch (name)
            {
                case "Authored character": case "Character contrast rim": case "Faction mantle": case "Equipped weapon cue": return ClassSilhouette;
                case "Character light rim": return ClassRim;
                case "Contact shadow": return ClassShadow;
                case "Faction footprint": return ClassFootprint;
                case "Health and barrier track": case "Confirmed health": case "Confirmed barrier": return ClassHp;
                case "Faction insignia backplate": case "Faction insignia": case "Faction badge backplate": case "Faction badge glyph":
                case "Mob role badge backplate": case "Mob role badge glyph": case "Elite emblem backplate": case "Elite emblem glyph": return ClassInsignia;
            }
            return name != null && name.StartsWith("Barrier ring step") ? ClassHp : ClassOther;
        }

        enum Phase { Settle, Walk, Frozen }

        sealed class Live
        {
            public LabCell Cell; public Transform Root;
            public readonly List<SpriteRenderer> Renderers = new List<SpriteRenderer>();
            public readonly List<int> Classes = new List<int>();
            public string Clip = "idle"; public int Frame = -1, Direction = -1;
        }

        Camera _cam; ArenaView _arena; ShowcaseCatalog _catalog;
        LabPlan _plan; List<LabAppearance> _apps; List<string> _unreachable;
        List<LabPage> _zonePages = new List<LabPage>();
        int _zoneIndex = -1, _pageIndex;
        LabPage _page;
        LabMode _mode = LabMode.Normal; bool _modeDirty; int _modeFrames;
        Phase _phase; float _phaseStart, _settleSeconds;
        int _cmdSeq, _publishedFor = -1;
        readonly List<InterpActor> _rows = new List<InterpActor>();
        readonly List<Live> _live = new List<Live>();
        readonly Dictionary<SpriteRenderer, Material> _origMaterial = new Dictionary<SpriteRenderer, Material>();
        Material[] _maskMats, _outlineMaskMats;
        UniversalAdditionalCameraData _camData;
        Color _origBackground; int _origCulling;
        readonly List<GameObject> _layerScratch = new List<GameObject>();

        public LabPlan Plan { get { return _plan; } }

        public void Initialize(Camera cam, string search)
        {
            _cam = cam; _camData = cam.GetComponent<UniversalAdditionalCameraData>();
            _origBackground = cam.backgroundColor; _origCulling = cam.cullingMask;
            gameObject.name = ObjectName;
            ShowcaseSprites.Initialize();
            if (ShowcaseSettings.Current == null) new GameObject("Showcase presentation settings").AddComponent<ShowcaseSettings>();
            _catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            var keys = new List<string>(); foreach (var a in _catalog.Actors) if (a != null) keys.Add(a.Key);
            _apps = ContrastLabAppearances.Build(keys, out _unreachable);
            _arena = new GameObject("Contrast lab arena").AddComponent<ArenaView>();
            var map = ContrastLabMap.Build();
            _arena.Build(map);
            var options = new LabOptions();
            int n;
            if (int.TryParse(Bootstrap.Query(search, "facings", "2"), out n)) options.Facings = Mathf.Clamp(n, 1, 8);
            if (int.TryParse(Bootstrap.Query(search, "props", "2"), out n)) options.PropArts = Mathf.Clamp(n, 0, 8);
            _plan = ContrastLabPlanner.Plan(map, _arena.Surfaces, _apps, options);
            var shader = Resources.Load<Shader>("ContrastLab/RhContrastMask");
            _maskMats = new Material[ClassColors.Length];
            _outlineMaskMats = new Material[ClassColors.Length];
            var outlineShader = SpriteOutline.SharedMaterial != null ? SpriteOutline.SharedMaterial.shader : null;
            for (int i = 0; i < _maskMats.Length; i++)
            {
                _maskMats[i] = new Material(shader) { name = "Contrast lab mask " + i };
                _maskMats[i].SetColor("_MaskColor", (Color)ClassColors[i]);
                // The adaptive outline rebuilds its own silhouette in the shader, so its mask material is the same shader in mask mode.
                if (outlineShader != null)
                {
                    _outlineMaskMats[i] = new Material(outlineShader) { name = "Contrast lab outline mask " + i };
                    _outlineMaskMats[i].SetFloat("_MaskMode", 1f); _outlineMaskMats[i].SetColor("_MaskColor", (Color)ClassColors[i]);
                }
            }
#if UNITY_WEBGL && !UNITY_EDITOR
            RhContrastLab_Init();
#endif
            RegionId zone; int zi = 0;
            if (ContrastLabMap.TryZone(Bootstrap.Query(search, "zone", ""), out zone)) zi = ContrastLabMap.ZoneIndex(zone);
            int.TryParse(Bootstrap.Query(search, "page", "0"), out n);
            SelectPage(zi, n, SettleFirst);
        }

        // ---- page and mode control ----------------------------------------------------------------------------------------

        void SelectPage(int zoneIndex, int pageIndex, float settle)
        {
            zoneIndex = Mathf.Clamp(zoneIndex, 0, ContrastLabMap.Zones.Length - 1);
            if (zoneIndex != _zoneIndex) { _zoneIndex = zoneIndex; _zonePages = _plan.ForZone(ContrastLabMap.Zones[zoneIndex]); }
            _pageIndex = _zonePages.Count == 0 ? 0 : Mathf.Clamp(pageIndex, 0, _zonePages.Count - 1);
            _page = _zonePages.Count == 0 ? null : _zonePages[_pageIndex];
            // Undo whatever the previous page's render mode did to its (pooled, soon reused) actors and to the camera, then start clean.
            _mode = LabMode.Normal; ApplyMode();
            _live.Clear(); _origMaterial.Clear();
            _modeDirty = true; _modeFrames = 0;
            _phase = Phase.Settle; _phaseStart = Time.unscaledTime; _settleSeconds = settle;
            _publishedFor = -1;
            PublishNotReady();
        }

        /// <summary>Called from the page through RhContrastLab.jslib (SendMessage): {"zone":"fire","page":0,"mode":"normal","seq":3}.</summary>
        [UnityEngine.Scripting.Preserve]
        public void JsCommand(string json)
        {
            var cmd = JsonUtility.FromJson<Command>(json);
            if (cmd == null) return;
            _cmdSeq = cmd.seq;
            RegionId zone; int zi = _zoneIndex;
            if (!string.IsNullOrEmpty(cmd.zone) && ContrastLabMap.TryZone(cmd.zone, out zone)) zi = ContrastLabMap.ZoneIndex(zone);
            if (zi != _zoneIndex) { SelectPage(zi, cmd.page, SettleZone); return; }
            if (cmd.page != _pageIndex) { SelectPage(zi, cmd.page, SettlePage); return; }
            LabMode m = ParseMode(cmd.mode);
            if (m != _mode) { _mode = m; _modeDirty = true; _modeFrames = 0; }
            _publishedFor = -1;
            PublishNotReady();
        }

        [Serializable] sealed class Command { public string zone; public int page; public string mode; public int seq; }

        static LabMode ParseMode(string s) { return s == "mask" ? LabMode.Mask : s == "no-actors" ? LabMode.NoActors : LabMode.Normal; }
        static string ModeName(LabMode m) { return m == LabMode.Mask ? "mask" : m == LabMode.NoActors ? "no-actors" : "normal"; }

        // ---- per-frame ---------------------------------------------------------------------------------------------------

        void Update()
        {
            if (_arena == null || _cam == null) return;
            if (_page == null) { if (_publishedFor != _cmdSeq) { _publishedFor = _cmdSeq; Publish(true); } return; }
            var view = _page.ViewTile;
            // ArenaView.Follow puts the camera 1.5 world units above the point it is given; ask for the point that lands the view centre on `view`.
            _arena.Follow(_cam, view.x * 32f, (view.y + 1.5f / ArenaView.GroundSquash) * 32f);
            float now = Time.unscaledTime, dt = now - _phaseStart;
            if (_phase == Phase.Settle)
            {
                PresentRows(0f);
                if (dt >= _settleSeconds) { _phase = Phase.Walk; _phaseStart = now; }
            }
            else if (_phase == Phase.Walk)
            {
                float p = Mathf.Clamp01(dt / WalkSeconds);
                PresentRows(p);
                if (dt >= WalkSeconds) { _phase = Phase.Frozen; _phaseStart = now; CollectLive(); _modeDirty = true; _modeFrames = 0; }
            }
            if (_phase != Phase.Frozen) return;
            if (_modeDirty) { ApplyMode(); _modeDirty = false; _modeFrames = 0; return; }
            _modeFrames++;
            if (_modeFrames >= ModeFrames && _publishedFor != _cmdSeq) { _publishedFor = _cmdSeq; Publish(true); }
        }

        void PresentRows(float walkProgress)
        {
            _rows.Clear();
            foreach (var c in _page.Cells)
            {
                float x = c.TileX * 32f, y = c.TileY * 32f;
                if (c.Pose == LabPose.Walk)
                {
                    float back = WalkDistance * (1f - walkProgress);
                    x -= Mathf.Cos(c.Facing) * back; y -= Mathf.Sin(c.Facing) * back;
                }
                var app = c.Appearance;
                _rows.Add(new InterpActor
                {
                    Id = (uint)(1000 + c.Id), Faction = app.Faction, Status = ActorStatus.Alive, Weapon = app.Weapon, HpPct = 80, X = x, Y = y, Facing = c.Facing,
                    Kind = app.Kind, MobType = app.Mob
                });
            }
            _arena.Present(_rows, null, null, 0f);
            TagActorLayers();
        }

        void TagActorLayers()
        {
            for (int i = 0; i < _arena.transform.childCount; i++)
            {
                var child = _arena.transform.GetChild(i);
                if (child.name != "Observed actor" || child.gameObject.layer == ActorLayer) continue;
                SetLayer(child, ActorLayer);
            }
        }

        static void SetLayer(Transform t, int layer)
        {
            t.gameObject.layer = layer;
            for (int i = 0; i < t.childCount; i++) SetLayer(t.GetChild(i), layer);
        }

        /// <summary>Matches each cell to the presenter's actor root (by position) and caches its renderers and mask classes.</summary>
        void CollectLive()
        {
            _live.Clear();
            var roots = new List<Transform>();
            for (int i = 0; i < _arena.transform.childCount; i++)
            {
                var child = _arena.transform.GetChild(i);
                if (child.name == "Observed actor" && child.gameObject.activeSelf) roots.Add(child);
            }
            foreach (var c in _page.Cells)
            {
                var feet = ArenaView.WorldPoint(c.TileX * 32f, c.TileY * 32f);
                Transform best = null; float bd = .02f;
                foreach (var r in roots) { float d = ((Vector2)(r.position - feet)).sqrMagnitude; if (d < bd) { bd = d; best = r; } }
                var live = new Live { Cell = c, Root = best };
                if (best != null)
                {
                    foreach (var sr in best.GetComponentsInChildren<SpriteRenderer>(true))
                    {
                        live.Renderers.Add(sr); live.Classes.Add(ClassOf(sr.gameObject.name));
                        if (sr.gameObject.name == "Authored character") DescribeFrame(live, sr.sprite);
                    }
                }
                _live.Add(live);
            }
        }

        void DescribeFrame(Live live, Sprite sprite)
        {
            var a = _catalog.Find(live.Cell.Appearance.Key);
            if (a == null || sprite == null) return;
            string[] names = { "idle", "walk" }; Sprite[][] clips = { a.Idle, a.Walk };
            for (int k = 0; k < clips.Length; k++)
            {
                var clip = clips[k]; if (clip == null || clip.Length == 0) continue;
                int idx = Array.IndexOf(clip, sprite); if (idx < 0) continue;
                int count = Mathf.Max(1, clip.Length / 8);
                live.Clip = names[k]; live.Frame = idx % count; live.Direction = idx / count; return;
            }
            live.Clip = "other";
        }

        // ---- render modes ------------------------------------------------------------------------------------------------

        void ApplyMode()
        {
            // Restore first, then apply, so any mode change starts from the normal state.
            _cam.cullingMask = _origCulling; _cam.backgroundColor = _origBackground;
            if (_camData != null) _camData.renderPostProcessing = true;
            foreach (var live in _live)
                for (int i = 0; i < live.Renderers.Count; i++)
                {
                    var sr = live.Renderers[i]; if (sr == null) continue;
                    if (_origMaterial.TryGetValue(sr, out var m)) sr.sharedMaterial = m;
                    if (live.Classes[i] == ClassShadow) sr.forceRenderingOff = false;
                }
            _origMaterial.Clear();
            if (_mode == LabMode.NoActors) { _cam.cullingMask = _origCulling & ~(1 << ActorLayer); return; }
            if (_mode != LabMode.Mask) return;
            _cam.cullingMask = 1 << ActorLayer; _cam.backgroundColor = Color.black;
            if (_camData != null) _camData.renderPostProcessing = false;
            foreach (var live in _live)
                for (int i = 0; i < live.Renderers.Count; i++)
                {
                    var sr = live.Renderers[i]; if (sr == null) continue;
                    int cls = live.Classes[i];
                    if (cls == ClassShadow) { sr.forceRenderingOff = true; continue; }
                    _origMaterial[sr] = sr.sharedMaterial;
                    bool outline = sr.sharedMaterial != null && SpriteOutline.SharedMaterial != null && sr.sharedMaterial.shader == SpriteOutline.SharedMaterial.shader && _outlineMaskMats[cls] != null;
                    sr.sharedMaterial = outline ? _outlineMaskMats[cls] : _maskMats[cls];
                }
        }

        // ---- publishing --------------------------------------------------------------------------------------------------

        [Serializable] sealed class CellJson
        {
            public int id; public string zone, surface, key, appearance, kind, pose, facing, clip, prop, propMode, faction, mob, weapon;
            public int facingIndex, frame, dir; public float facingRad, purity;
            public float x, y, w, h, feetX, feetY;       // backbuffer pixels, y down
            public bool overlap, found;
        }

        [Serializable] sealed class StateJson
        {
            public int version = 1, ack; public bool ready; public string mode, zone, kind, surface, prop, quality, row;
            public int page, pageCount, totalPages, screenW, screenH, unplaced; public float orthoSize; public bool reducedMotion, grab, outline, outlineGrab;
            public string[] zones, notes, unreachable; public int[] zonePageCounts; public string[] modes;
            public List<CellJson> cells = new List<CellJson>();
        }

        void PublishNotReady() { Publish(false); }

        void Publish(bool ready)
        {
            var s = new StateJson
            {
                ready = ready, ack = _cmdSeq, mode = ModeName(_mode), zone = ContrastLabMap.ZoneName(ContrastLabMap.Zones[Mathf.Max(0, _zoneIndex)]),
                page = _pageIndex, pageCount = _zonePages.Count, totalPages = _plan.Pages.Count, screenW = Screen.width, screenH = Screen.height,
                orthoSize = _cam.orthographicSize, grab = Shader.GetGlobalTexture("_CameraSortingLayerTexture") != null, outline = SpriteOutline.Enabled, outlineGrab = SpriteOutline.UseGrab, reducedMotion = ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion,
                quality = ShowcaseSettings.Current != null ? ShowcaseSettings.Current.EffectiveQuality.ToString() : "?", row = Quality.Row.Name,
                unplaced = _plan.Unplaced, notes = _plan.Notes.ToArray(), unreachable = _unreachable.ToArray(), modes = new[] { "normal", "no-actors", "mask" },
                kind = _page != null ? _page.Kind : "", surface = _page != null ? _page.Surface.ToString() : "", prop = _page != null ? _page.Prop ?? "" : ""
            };
            var names = new string[ContrastLabMap.Zones.Length]; var counts = new int[names.Length];
            for (int i = 0; i < names.Length; i++) { names[i] = ContrastLabMap.ZoneName(ContrastLabMap.Zones[i]); counts[i] = _plan.ForZone(ContrastLabMap.Zones[i]).Count; }
            s.zones = names; s.zonePageCounts = counts;
            if (ready && _page != null && _phase == Phase.Frozen) FillCells(s);
            string json = JsonUtility.ToJson(s);
#if UNITY_WEBGL && !UNITY_EDITOR
            RhContrastLab_Publish(json);
#endif
            LastJson = json;
        }

        /// <summary>The last published state (also readable in the editor, for tests).</summary>
        public string LastJson { get; private set; }

        void FillCells(StateJson s)
        {
            foreach (var live in _live)
            {
                var c = live.Cell; var app = c.Appearance;
                var j = new CellJson
                {
                    id = c.Id, zone = ContrastLabMap.ZoneName(c.Zone), surface = c.Surface.ToString(), key = app.Key, appearance = app.Id, kind = app.Kind.ToString(),
                    pose = c.Pose.ToString().ToLowerInvariant(), facing = ContrastLabPlanner.FacingNames[c.FacingIndex], facingIndex = c.FacingIndex, facingRad = c.Facing,
                    clip = live.Clip, frame = live.Frame, dir = live.Direction, purity = c.Purity, prop = c.Prop ?? "", propMode = c.PropMode ?? "",
                    faction = app.Faction.HasValue ? app.Faction.Value.ToString() : "", mob = app.Mob.HasValue ? app.Mob.Value.ToString() : "",
                    weapon = app.Weapon.HasValue ? app.Weapon.Value.ToString() : "", found = live.Root != null
                };
                if (live.Root != null)
                {
                    bool any = false; Bounds b = default;
                    for (int i = 0; i < live.Renderers.Count; i++)
                    {
                        var sr = live.Renderers[i];
                        if (sr == null || !sr.enabled || sr.sprite == null || live.Classes[i] == ClassShadow) continue;
                        if (!any) { b = sr.bounds; any = true; } else b.Encapsulate(sr.bounds);
                    }
                    if (any)
                    {
                        var lo = _cam.WorldToScreenPoint(b.min); var hi = _cam.WorldToScreenPoint(b.max);
                        j.x = Mathf.Min(lo.x, hi.x); j.w = Mathf.Abs(hi.x - lo.x);
                        j.y = Screen.height - Mathf.Max(lo.y, hi.y); j.h = Mathf.Abs(hi.y - lo.y);
                    }
                    var feet = _cam.WorldToScreenPoint(live.Root.position); j.feetX = feet.x; j.feetY = Screen.height - feet.y;
                }
                s.cells.Add(j);
            }
            const float pad = 14f;
            for (int i = 0; i < s.cells.Count; i++)
                for (int k = i + 1; k < s.cells.Count; k++)
                {
                    var a = s.cells[i]; var b = s.cells[k];
                    if (a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h) { a.overlap = true; b.overlap = true; }
                }
        }

        void OnDestroy()
        {
            if (_maskMats != null) foreach (var m in _maskMats) if (m != null) Destroy(m);
            if (_outlineMaskMats != null) foreach (var m in _outlineMaskMats) if (m != null) Destroy(m);
        }
    }
}
