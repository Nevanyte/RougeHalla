// World-space indicators for delivered props and deaths, each built as legacy has it and cited to its source:
//   container labels (ContainerView.ts:111-113,200), the reward-chest ring that drains over its life with the seconds text (ContainerView.ts:30-68,153),
//   quest item markers (QuestView.ts:154-165) and the death X decal (FxView.ts:84-92,687).
// Pooled sprites, text and one fixed-topology mesh per chest ring; nothing allocates per frame. Every mark has a dark plate or dark outline so it
// holds 4.5:1 on any ground, and every mark is drawn only for a delivered row that is not in fog. Rules live in Roguehalla.Net.Ui.WorldIndicatorRules.
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    public sealed class WorldIndicators
    {
        const int LabelOrder = 29100, DecalOrder = 1240, RingOrder = 1236, MaxDecals = 16, MaxChestRings = 8, Segs = WorldIndicatorRules.RingSteps;
        const float TimerRadius = 26f, ArcWidth = 3f, BackWidth = 6.2f, EdgeWidth = 1.2f;

        sealed class Label { public SpriteRenderer Plate; public TextMeshPro Text; public string Shown; }
        sealed class Decal { public SpriteRenderer Sprite; public float X, Y, Start; public bool Live; }
        sealed class ChestRing
        {
            public GameObject Go; public Mesh Mesh; public Vector3[] V; public Color32[] C; public int Step = -1; public bool Urgent;
            public SpriteRenderer Range, Cue; public Label Seconds; public uint Key; public float Born = -1f;
        }

        readonly Transform _root;
        readonly List<Label> _labels = new List<Label>(); int _labelsUsed;
        readonly List<SpriteRenderer> _markers = new List<SpriteRenderer>(), _markerPlates = new List<SpriteRenderer>(); int _markersUsed;
        readonly List<Decal> _decals = new List<Decal>(MaxDecals);
        readonly List<ChestRing> _rings = new List<ChestRing>(); int _ringsUsed;
        readonly Dictionary<uint, float> _born = new Dictionary<uint, float>();
        int[] _tris;
        public int LabelsShown { get { return _labelsUsed; } }
        public int RingsShown { get { return _ringsUsed; } }
        public int DecalsLive { get { int n = 0; foreach (var d in _decals) if (d.Live) n++; return n; } }
        public int MarkersShown { get { return _markersUsed; } }

        public WorldIndicators(Transform root) { _root = root; }
        /// <summary>Test seam: the seconds text currently shown over ring <paramref name="index"/>, or null when hidden.</summary>
        public string SecondsShownForTest(int index) { return index < _rings.Count && _rings[index].Seconds.Text.gameObject.activeSelf ? _rings[index].Seconds.Text.text : null; }

        // ---- per frame ----------------------------------------------------------------------------------------------------
        /// <param name="canSee">True when the ground at a sim position is not fogged; null shows everything.</param>
        public void Update(CollectionsView c, double serverMs, bool haveLocal, float localX, float localY, float now, System.Func<float, float, bool> canSee)
        {
            _labelsUsed = _markersUsed = _ringsUsed = 0;
            if (_born.Count > 64) _born.Clear();
            var theme = UiTheme.Current;
            if (c != null)
            {
                foreach (var p in c.Props)
                {
                    if (canSee != null && !canSee(p.X, p.Y)) continue;
                    byte kind = (byte)p.Kind;
                    bool reloading = p.ReadyAt > serverMs;
                    string text = WorldIndicatorRules.ContainerLabel(kind, p.Focused, p.Weapon.HasValue ? (int)p.Weapon.Value : -1, p.BodyLabel, p.CorpseLabel,
                        reloading, reloading ? (int)System.Math.Ceiling((p.ReadyAt - serverMs) / 1000d) : 0);
                    var at = ArenaView.WorldPoint(p.X, p.Y);
                    if (p.Kind == PropAppearance.QuestItem)
                    {
                        // Quest item marker: a crate for a fetch item, a diamond for a token, in the quest accent over its dark outline (QuestView.makeItem).
                        var m = NextMarker();
                        m.sprite = IndicatorArt.Get(p.QuestFetch ? "crate" : "diamond"); m.color = (Color)theme.Accent; m.enabled = true;
                        m.transform.position = at + new Vector3(0, .78f, 0); m.transform.localScale = new Vector3(.5f, .5f, 1); m.sortingOrder = 2000 + Mathf.RoundToInt(p.Y * .5f) + 6;
                        // A dark plate under the glyph: the quest accent alone (gold, white) vanished on sand and snow once the outlines were off.
                        var plate = _markerPlates[_markersUsed - 1]; var pc = (Color)theme.OutlineDark; pc.a = .92f;
                        plate.enabled = true; plate.color = pc; plate.transform.position = m.transform.position; plate.transform.localScale = new Vector3(.66f, .66f, 1); plate.sortingOrder = m.sortingOrder - 1;
                        if (p.Focused) text = "Quest item";
                    }
                    if (text == null) continue;
                    float lift = p.Kind == PropAppearance.Chest ? 1.15f : p.Kind == PropAppearance.Cannon ? 1.4f : p.Kind == PropAppearance.QuestItem ? 1.2f : .85f;
                    Show(NextLabel(), text, at + new Vector3(0, lift, 0), 2.4f, p.Kind == PropAppearance.Body ? theme.TextSecondary : theme.TextPrimary);
                }
                foreach (var chest in c.RewardChests)
                {
                    if (canSee != null && !canSee(chest.X, chest.Y)) continue;
                    if (_ringsUsed >= MaxChestRings) break;
                    float left = (float)((chest.ExpiresAt - serverMs) / 1000d);
                    DrawChestRing(chest.Handle.Value, chest.X, chest.Y, left, haveLocal && WorldIndicatorRules.Near(chest.X - localX, chest.Y - localY), now, theme);
                }
            }
            for (int i = _labelsUsed; i < _labels.Count; i++) { _labels[i].Plate.enabled = false; _labels[i].Text.gameObject.SetActive(false); }
            for (int i = _markersUsed; i < _markers.Count; i++) { _markers[i].enabled = false; _markerPlates[i].enabled = false; }
            for (int i = _ringsUsed; i < _rings.Count; i++) HideRing(_rings[i]);
            TickDecals(now, canSee);
        }

        // ---- death X ---------------------------------------------------------------------------------------------------------
        /// <summary>A player fell at (x, y) (sim units; the last drawn position of a delivered actor). Ignored when the spot is fogged.</summary>
        public void AddDeath(float x, float y, float now, System.Func<float, float, bool> canSee)
        {
            if (canSee != null && !canSee(x, y)) return;
            Decal d = null;
            foreach (var e in _decals) if (!e.Live) { d = e; break; }
            if (d == null)
            {
                if (_decals.Count >= MaxDecals) { d = _decals[0]; foreach (var e in _decals) if (e.Start < d.Start) d = e; }
                else
                {
                    d = new Decal { Sprite = ShowcaseSprites.Create(_root, "Death X", "bar", DecalOrder, Color.white, Vector2.one, Vector3.zero, false) };
                    d.Sprite.sprite = IndicatorArt.Get("xmark"); _decals.Add(d);
                }
            }
            d.X = x; d.Y = y; d.Start = now; d.Live = true;
            var theme = UiTheme.Current;
            d.Sprite.enabled = true; d.Sprite.color = (Color)theme.Danger;
            d.Sprite.transform.position = ArenaView.WorldPoint(x, y);
            float w = WorldIndicatorRules.DecalHalfWidth * 2f / 32f * 1.18f; // the glyph fills 85% of its square
            d.Sprite.transform.localScale = new Vector3(w, w * ArenaView.GroundSquash, 1);
        }

        void TickDecals(float now, System.Func<float, float, bool> canSee)
        {
            foreach (var d in _decals)
            {
                if (!d.Live) continue;
                float a = WorldIndicatorRules.DecalAlpha((now - d.Start) * 1000f);
                if (a <= 0f || (canSee != null && !canSee(d.X, d.Y))) { d.Live = false; d.Sprite.enabled = false; continue; }
                var c = d.Sprite.color; c.a = a; d.Sprite.color = c;
            }
        }

        public void Clear()
        {
            foreach (var d in _decals) { d.Live = false; d.Sprite.enabled = false; }
            _born.Clear();
        }

        // ---- reward chest ring -------------------------------------------------------------------------------------------------
        void DrawChestRing(uint key, float x, float y, float left, bool near, float now, UiTheme theme)
        {
            var r = NextRing();
            if (!_born.TryGetValue(key, out float born)) { born = now; _born[key] = born; }
            int step = WorldIndicatorRules.RingStep(left); bool urgent = WorldIndicatorRules.Urgent(left);
            var centre = ArenaView.WorldPoint(x, y);
            r.Go.SetActive(true); r.Go.transform.position = Vector3.zero;
            if (step != r.Step || urgent != r.Urgent) { r.Step = step; r.Urgent = urgent; WriteRing(r, x, y, step, urgent, theme); }
            float alpha = WorldIndicatorRules.RewardAlpha(left);
            r.Range.enabled = true; r.Range.transform.position = centre;
            r.Range.transform.localScale = new Vector3(2f * WorldIndicatorRules.ChestRange / 32f / .80f, 2f * WorldIndicatorRules.ChestRange / 32f / .80f * ArenaView.GroundSquash, 1);
            var rc = Color.white; rc.a = .38f * alpha; r.Range.color = rc;
            float cue = WorldIndicatorRules.DropCue((now - born) * 1000f);
            bool reduced = ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion;
            r.Cue.enabled = cue >= 0f;
            if (cue >= 0f)
            {
                float radius = reduced ? 34f : 12f + 34f * (1f - Mathf.Pow(1f - cue, 3f));
                float s = 2f * radius / 32f / .80f;
                r.Cue.transform.position = centre; r.Cue.transform.localScale = new Vector3(s, s * ArenaView.GroundSquash, 1);
                var cc = Color.white; cc.a = 1f - cue; r.Cue.color = cc;
            }
            string text = WorldIndicatorRules.SecondsText(left, near);
            if (text != null)
            {
                Show(r.Seconds, text, centre + new Vector3(0, 1.55f, 0), 3.0f, theme.Accent);
                var tc = r.Seconds.Text.color; tc.a = alpha; r.Seconds.Text.color = tc;
            }
            else { r.Seconds.Plate.enabled = false; r.Seconds.Text.gameObject.SetActive(false); }
            var ring = r.Go.GetComponent<MeshRenderer>(); ring.enabled = alpha > 0f;
        }

        void WriteRing(ChestRing r, float cx, float cy, int step, bool urgent, UiTheme theme)
        {
            var arc = (Color32)(urgent ? theme.Danger : theme.Accent); arc.a = 242;
            var dark = (Color32)theme.OutlineDark; var edge = (Color32)theme.OutlineLight;
            var clear = new Color32(0, 0, 0, 0);
            int v = 0;
            for (int band = 0; band < 3; band++)
            {
                float w = band == 0 ? EdgeWidth : band == 1 ? BackWidth : ArcWidth;
                float radius = band == 0 ? TimerRadius + BackWidth * .5f + EdgeWidth * .5f : TimerRadius;
                for (int i = 0; i < Segs; i++)
                {
                    float a0 = -Mathf.PI / 2f + i / (float)Segs * Mathf.PI * 2f, a1 = -Mathf.PI / 2f + (i + 1) / (float)Segs * Mathf.PI * 2f;
                    Color32 col = band == 0 ? new Color32(edge.r, edge.g, edge.b, 140) : band == 1 ? new Color32(dark.r, dark.g, dark.b, 210) : (i < step ? arc : clear);
                    float ri = radius - w * .5f, ro = radius + w * .5f;
                    r.V[v] = ArenaView.WorldPoint(cx + Mathf.Cos(a0) * ri, cy + Mathf.Sin(a0) * ri); r.C[v++] = col;
                    r.V[v] = ArenaView.WorldPoint(cx + Mathf.Cos(a0) * ro, cy + Mathf.Sin(a0) * ro); r.C[v++] = col;
                    r.V[v] = ArenaView.WorldPoint(cx + Mathf.Cos(a1) * ri, cy + Mathf.Sin(a1) * ri); r.C[v++] = col;
                    r.V[v] = ArenaView.WorldPoint(cx + Mathf.Cos(a1) * ro, cy + Mathf.Sin(a1) * ro); r.C[v++] = col;
                }
            }
            r.Mesh.SetVertices(r.V); r.Mesh.SetColors(r.C);
        }

        ChestRing NextRing()
        {
            if (_ringsUsed == _rings.Count)
            {
                var r = new ChestRing { V = new Vector3[3 * Segs * 4], C = new Color32[3 * Segs * 4] };
                r.Go = new GameObject("Reward chest ring"); r.Go.transform.SetParent(_root, false);
                var mf = r.Go.AddComponent<MeshFilter>(); var mr = r.Go.AddComponent<MeshRenderer>();
                ShowcaseSprites.Initialize();
                mr.sharedMaterial = ShowcaseSprites.Unlit; mr.sortingOrder = RingOrder;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; mr.receiveShadows = false;
                r.Mesh = new Mesh { name = "Reward chest ring" }; r.Mesh.MarkDynamic();
                if (_tris == null) { _tris = new int[3 * Segs * 6]; for (int q = 0; q < 3 * Segs; q++) { int a = q * 4, t = q * 6; _tris[t] = a; _tris[t + 1] = a + 1; _tris[t + 2] = a + 2; _tris[t + 3] = a + 2; _tris[t + 4] = a + 1; _tris[t + 5] = a + 3; } }
                r.Mesh.SetVertices(r.V); r.Mesh.SetColors(r.C); r.Mesh.SetTriangles(_tris, 0); r.Mesh.uv = new Vector2[r.V.Length];
                r.Mesh.bounds = new Bounds(Vector3.zero, new Vector3(4000, 4000, 1)); mf.sharedMesh = r.Mesh;
                r.Range = ShowcaseSprites.Create(_root, "Reward chest pick range", "bar", RingOrder - 1, Color.white, Vector2.one, Vector3.zero, false);
                r.Range.sprite = GroundMarkArt.Ring(UiTheme.Current.Accent, true, .012f);
                r.Cue = ShowcaseSprites.Create(_root, "Reward chest drop cue", "bar", RingOrder + 1, Color.white, Vector2.one, Vector3.zero, false);
                r.Cue.sprite = GroundMarkArt.Ring(UiTheme.Current.TextPrimary, false, .02f);
                r.Seconds = NewLabel();
                _rings.Add(r);
            }
            return _rings[_ringsUsed++];
        }

        static void HideRing(ChestRing r)
        {
            r.Go.SetActive(false); r.Range.enabled = false; r.Cue.enabled = false; r.Seconds.Plate.enabled = false; r.Seconds.Text.gameObject.SetActive(false); r.Step = -1;
        }

        // ---- labels and markers --------------------------------------------------------------------------------------------------
        SpriteRenderer NextMarker()
        {
            if (_markersUsed == _markers.Count)
            {
                _markers.Add(ShowcaseSprites.Create(_root, "Quest item marker", "bar", LabelOrder - 2, Color.white, Vector2.one, Vector3.zero, false));
                var back = ShowcaseSprites.Create(_root, "Quest item marker plate", "bar", LabelOrder - 3, Color.white, Vector2.one, Vector3.zero, false); back.enabled = false; _markerPlates.Add(back);
            }
            return _markers[_markersUsed++];
        }

        Label NextLabel() { if (_labelsUsed == _labels.Count) _labels.Add(NewLabel()); return _labels[_labelsUsed++]; }

        Label NewLabel()
        {
            var l = new Label();
            l.Plate = ShowcaseSprites.Create(_root, "World label plate", "bar", LabelOrder, Color.white, Vector2.one, Vector3.zero, false);
            var go = new GameObject("World label"); go.transform.SetParent(_root, false);
            l.Text = go.AddComponent<TextMeshPro>();
            var font = Resources.Load<TMP_FontAsset>("Showcase/NunitoBold");
            l.Text.font = font != null ? font : TMP_Settings.defaultFontAsset;
            l.Text.alignment = TextAlignmentOptions.Center; l.Text.enableWordWrapping = false; l.Text.fontStyle = FontStyles.Bold;
            l.Text.fontSharedMaterial = OverheadIndicators.OutlinedMaterial(l.Text.font); l.Text.rectTransform.sizeDelta = new Vector2(6f, .5f);
            l.Text.GetComponent<MeshRenderer>().sortingOrder = LabelOrder + 1; go.SetActive(false); l.Plate.enabled = false;
            return l;
        }

        static void Show(Label l, string text, Vector3 at, float size, Color32 colour)
        {
            if (!ReferenceEquals(l.Shown, text) && l.Shown != text) { l.Shown = text; l.Text.text = text; }
            l.Text.fontSize = size; l.Text.color = (Color)colour;
            l.Text.transform.position = at; l.Text.gameObject.SetActive(true);
            var d = (Color)UiTheme.Current.OutlineDark; d.a = .92f;
            l.Plate.enabled = true; l.Plate.color = d; l.Plate.transform.position = at + new Vector3(0, .02f, 0);
            l.Plate.transform.localScale = new Vector3(l.Text.preferredWidth + .16f, size * .1f + .08f, 1);
        }
    }
}
