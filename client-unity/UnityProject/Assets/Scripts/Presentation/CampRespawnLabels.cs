using System;
using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// "RESPAWN Ns" / "RESPAWN READY" in the world below a cleared camp (legacy CampWards.ts:19-30: 11 px monospace #e5edf7 with a
    /// dark stroke, centred 32 units below the camp). Text comes from the pure <see cref="CampMarks"/> model; labels are pooled and the
    /// text is only rewritten when it changes, so a steady frame allocates nothing. Presentation only.
    /// </summary>
    public sealed class CampRespawnLabels
    {
        const int Order = 29000;
        const float OffsetUnits = 32f;
        readonly Transform _root;
        readonly List<CampWorldLabel> _rows = new List<CampWorldLabel>();
        readonly List<TextMeshPro> _labels = new List<TextMeshPro>();
        public int Used { get; private set; }
        public string TextAt(int i) { return i >= 0 && i < Used ? _labels[i].text : null; }

        // Reward badges and ward beacons share the file (legacy CampBuffs.ts, CampWards.ts); pooled, no per-frame allocation.
        const float BadgeOffsetUnits = -44f, BeaconTextOffsetUnits = -48f, BadgeScale = .55f, BadgeStep = .62f, PlaqueHeight = .78f;
        readonly List<CampBadgeRow> _badges = new List<CampBadgeRow>();
        readonly List<CampWardRow> _wards = new List<CampWardRow>();
        readonly List<SpriteRenderer> _badgeIcons = new List<SpriteRenderer>();
        readonly List<SpriteRenderer> _plaques = new List<SpriteRenderer>();
        readonly List<SpriteRenderer> _beacons = new List<SpriteRenderer>();
        readonly List<TextMeshPro> _beaconTexts = new List<TextMeshPro>();
        public int BadgesUsed { get; private set; }
        public int BeaconsUsed { get; private set; }
        public string BeaconTextAt(int i) { return i >= 0 && i < BeaconsUsed ? _beaconTexts[i].text : null; }

        static readonly MythicGlyph[] StatGlyphs = { MythicGlyph.Sword, MythicGlyph.Wish, MythicGlyph.Axe, MythicGlyph.Bow, MythicGlyph.Potion, MythicGlyph.Health, MythicGlyph.Armor, MythicGlyph.Shield, MythicGlyph.Speed };
        static readonly string[] StatKeys = { "ad", "ap", "damage", "attackSpeed", "leech", "health", "armor", "mr", "speed" };

        /// <summary>The GAINED strip's glyph for a legacy combat-icon key (same table as MatchHud.Legacy.cs:130 <c>CellGlyph</c>, in
        /// <see cref="CampBadges.IconKey"/> order); an unknown key reads as damage.</summary>
        public static MythicGlyph StatGlyph(string iconKey)
        {
            for (int i = 0; i < StatKeys.Length; i++) if (StatKeys[i] == iconKey) return StatGlyphs[i];
            return MythicGlyph.Axe;
        }

        /// <summary>The sprite for a badge icon key: the stat glyph, or the crate glyph for the elite augment chest (no stat glyph exists).</summary>
        public static Sprite Art(string iconKey) { return iconKey == "chest" ? IndicatorArt.Get("crate") : MythicUi.GlyphSprite(StatGlyph(iconKey)); }

        static Sprite _plaque, _beacon;

        /// <summary>Dark rounded plaque with a light edge (CampBuffs.ts draw: 0x101820 fill, 0xd7e6f3 line, radius 6), 9-sliced.</summary>
        static Sprite Plaque()
        {
            if (_plaque != null) return _plaque;
            const int W = 48, H = 32; const float R = 10f;
            var px = new Color32[W * H];
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    float dx = Mathf.Max(R - (x + .5f), (x + .5f) - (W - R), 0f), dy = Mathf.Max(R - (y + .5f), (y + .5f) - (H - R), 0f);
                    float d = Mathf.Sqrt(dx * dx + dy * dy) - R;
                    float outer = Mathf.Clamp01(.5f - d), edge = Mathf.Clamp01(1.5f + d);
                    byte a = (byte)Mathf.RoundToInt(255f * outer * .96f);
                    px[y * W + x] = Color32.Lerp(new Color32(0x10, 0x18, 0x20, a), new Color32(0xd7, 0xe6, 0xf3, a), edge);
                }
            var tex = new Texture2D(W, H, TextureFormat.RGBA32, false) { name = "Camp badge plaque", filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            tex.SetPixels32(px); tex.Apply(false, true);
            return _plaque = Sprite.Create(tex, new Rect(0, 0, W, H), new Vector2(.5f, .5f), H, 0, SpriteMeshType.FullRect, new Vector4(12, 12, 12, 12));
        }

        /// <summary>Pole-and-flag beacon over a ground ellipse (CampWards.ts:46-49), white so the look colour tints it. Pivot at the ellipse centre.</summary>
        static Sprite Beacon()
        {
            if (_beacon != null) return _beacon;
            const int W = 48, H = 56;
            var px = new Color32[W * H];
            for (int y = 0; y < H; y++)
                for (int x = 0; x < W; x++)
                {
                    int hit = 0;
                    for (int sy = 0; sy < 3; sy++) for (int sx = 0; sx < 3; sx++) if (BeaconCovers(x + (sx + .5f) / 3f, y + (sy + .5f) / 3f)) hit++;
                    px[y * W + x] = new Color32(255, 255, 255, (byte)(255 * hit / 9));
                }
            var tex = new Texture2D(W, H, TextureFormat.RGBA32, false) { name = "Camp ward beacon", filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            tex.SetPixels32(px); tex.Apply(false, true);
            return _beacon = Sprite.Create(tex, new Rect(0, 0, W, H), new Vector2(24f / W, 10f / H), 32f);
        }

        static bool BeaconCovers(float x, float y)
        {
            float ex = (x - 24f) / 22f, ey = (y - 10f) / 9f, e = Mathf.Sqrt(ex * ex + ey * ey);
            if (e < 1f && e > .78f) return true;
            if (x > 23f && x < 25f && y >= 10f && y <= 29f) return true;
            if (y >= 30f && y <= 42f) return Mathf.Abs(x - 24f) <= 7f * (42f - y) / 12f;
            return false;
        }

        Func<float, float, bool> _visible;
        readonly Func<double, double, bool> _canSee;

        public CampRespawnLabels(Transform root) { _root = root; _canSee = (x, y) => _visible == null || _visible((float)x, (float)y); }

        /// <summary>Redraws from the session's camp rows and map; hides every label when there is no map, no rows or the match is not active.</summary>
        public void Update(Session session) { Update(session, null); }

        /// <summary>As above, and the world reward badges (icon only, over living camps the viewer can see through <paramref name="visible"/>) and ward beacons.</summary>
        public void Update(Session session, Func<float, float, bool> visible)
        {
            _badges.Clear(); _wards.Clear();
            if (session != null && session.Map != null && session.State == SessionState.InMatch)
            {
                bool active = !session.Training;
                _visible = visible;
                CampBadges.Rewards(session.Map.Camps, session.Collections.Camps, active, CampSurface.World, _canSee, _badges);
                CampBadges.Wards(session.Map.Camps, session.Collections.Camps, session.ServerTimeMs, active, _wards);
            }
            FetchNames();
            DrawBadges(); DrawBeacons();

            _rows.Clear();
            if (session != null && session.Map != null && session.State == SessionState.InMatch)
                CampMarks.WorldLabels(session.Map.Camps, session.Collections.Camps, session.ServerTimeMs, !session.Training, _rows);
            DrawRows();
        }

        /// <summary>
        /// P-UNITY-NAME-GROUP-2 seam: world-space rects of the fighter names drawn this frame (Unity world units, y up). The respawn and ward
        /// labels must not intersect any of them. ArenaView sets it to the presenter's name rects (one line there, owned by another packet).
        /// </summary>
        public System.Action<List<Rect>> NameRectSource;

        /// <summary>
        /// P-UNITY-NAME-GROUP-2 seam for tests: draws the respawn labels and the ward beacons with their labels from ready rows, without a
        /// Session. <see cref="Update(Session, Func{float, float, bool})"/> does the same from the session's rows.
        /// </summary>
        public void Draw(List<CampWorldLabel> rows, List<CampWardRow> wards)
        {
            _rows.Clear(); _rows.AddRange(rows);
            _wards.Clear(); _wards.AddRange(wards);
            FetchNames();
            DrawBeacons(); DrawRows();
        }

        readonly List<Rect> _names = new List<Rect>();
        readonly Dictionary<TextMeshPro, SpriteRenderer> _plates = new Dictionary<TextMeshPro, SpriteRenderer>();
        void FetchNames() { _names.Clear(); if (NameRectSource != null) NameRectSource(_names); }

        static Sprite _plate;
        static Sprite PlateSprite()
        {
            if (_plate != null) return _plate;
            var tex = new Texture2D(4, 4, TextureFormat.RGBA32, false) { name = "Camp label plate", filterMode = FilterMode.Point };
            var px = new Color32[16]; for (int i = 0; i < 16; i++) px[i] = new Color32(255, 255, 255, 255);
            tex.SetPixels32(px); tex.Apply(false, true);
            return _plate = Sprite.Create(tex, new Rect(0, 0, 4, 4), new Vector2(.5f, .5f), 4f);
        }

        // The label's dark backing plate, a child of the label so it moves with it; sized to the text when the text changes.
        static void FitPlate(TextMeshPro label, Dictionary<TextMeshPro, SpriteRenderer> plates)
        {
            label.ForceMeshUpdate();
            plates.TryGetValue(label, out var plate);
            if (plate == null)
            {
                var go = new GameObject("Plate"); go.transform.SetParent(label.transform, false);
                plate = go.AddComponent<SpriteRenderer>(); plate.sprite = PlateSprite();
                plate.color = new Color(0x10 / 255f, 0x18 / 255f, 0x20 / 255f, .88f);
                plate.sortingOrder = Order - 1;
                plates[label] = plate;
            }
            var b = label.textBounds;
            plate.transform.localPosition = b.center;
            plate.transform.localScale = new Vector3(b.size.x + .3f, b.size.y + .16f, 1f);
        }

        // Shifts the label up, one line at a time, until its plate clears every fighter name.
        void Clear(TextMeshPro label)
        {
            _plates.TryGetValue(label, out var plate);
            if (plate == null || _names.Count == 0) return;
            for (int pass = 0; pass < 8; pass++)
            {
                var pb = plate.bounds; var rect = new Rect(pb.min.x, pb.min.y, pb.size.x, pb.size.y);
                float lift = 0f;
                for (int i = 0; i < _names.Count; i++)
                    if (rect.Overlaps(_names[i])) lift = Mathf.Max(lift, _names[i].yMax - rect.yMin + .04f);
                if (lift <= 0f) return;
                label.transform.position += new Vector3(0f, lift, 0f);
            }
        }

        void DrawRows()
        {
            Used = _rows.Count;
            for (int i = 0; i < Used; i++)
            {
                var label = Get(i);
                var row = _rows[i];
                bool changed = label.text != row.Text;
                if (changed) label.text = row.Text;
                label.transform.position = ArenaView.WorldPoint((float)row.WorldX, (float)row.WorldY + OffsetUnits);
                if (!label.gameObject.activeSelf) label.gameObject.SetActive(true);
                if (changed || !_plates.ContainsKey(label)) FitPlate(label, _plates);
                Clear(label);
            }
            for (int i = Used; i < _labels.Count; i++) if (_labels[i].gameObject.activeSelf) _labels[i].gameObject.SetActive(false);
        }

        static Color32 Rgb(uint rgb) { return new Color32((byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb, 255); }

        SpriteRenderer Icon(List<SpriteRenderer> pool, int i, string name, int order)
        {
            while (pool.Count <= i)
            {
                var go = new GameObject(name); go.transform.SetParent(_root, false);
                var r = go.AddComponent<SpriteRenderer>(); r.sortingOrder = order; go.SetActive(false);
                pool.Add(r);
            }
            return pool[i];
        }

        void Place(SpriteRenderer r, Sprite sprite, Color32 color, Vector3 at, float scale)
        {
            if (r.sprite != sprite) r.sprite = sprite;
            r.color = color; r.transform.position = at; r.transform.localScale = Vector3.one * scale;
            if (!r.gameObject.activeSelf) r.gameObject.SetActive(true);
        }

        // Legacy CampBuffs.ts places the badge over the living mobs' centroid; actor rows carry no camp index, so it stays over the camp position.
        void DrawBadges()
        {
            int used = 0, plaques = 0;
            for (int i = 0; i < _badges.Count; i++)
            {
                var b = _badges[i];
                int n = (b.IconKey != null ? 1 : 0) + (b.EliteIconKey != null ? 1 : 0);
                if (n == 0) continue;
                var centre = ArenaView.WorldPoint((float)b.WorldX, (float)b.WorldY + BadgeOffsetUnits);
                var back = Icon(_plaques, plaques++, "Camp reward plaque", Order - 1);
                back.drawMode = SpriteDrawMode.Sliced; back.size = new Vector2(n * BadgeStep + .3f, PlaqueHeight);
                Place(back, Plaque(), Color.white, centre, 1f);
                int k = 0;
                if (b.IconKey != null)
                    Place(Icon(_badgeIcons, used++, "Camp reward badge", Order), Art(b.IconKey), Rgb(b.IconRgb), centre + new Vector3((k++ - (n - 1) * .5f) * BadgeStep, 0f, 0f), BadgeScale);
                if (b.EliteIconKey != null)
                    Place(Icon(_badgeIcons, used++, "Camp reward badge", Order), Art(b.EliteIconKey), Rgb(b.EliteIconRgb), centre + new Vector3((k++ - (n - 1) * .5f) * BadgeStep, 0f, 0f), BadgeScale);
            }
            BadgesUsed = used;
            for (int i = used; i < _badgeIcons.Count; i++) if (_badgeIcons[i].gameObject.activeSelf) _badgeIcons[i].gameObject.SetActive(false);
            for (int i = plaques; i < _plaques.Count; i++) if (_plaques[i].gameObject.activeSelf) _plaques[i].gameObject.SetActive(false);
        }

        void DrawBeacons()
        {
            BeaconsUsed = _wards.Count;
            for (int i = 0; i < _wards.Count; i++)
            {
                var w = _wards[i];
                Place(Icon(_beacons, i, "Camp ward beacon", Order - 1), Beacon(), Rgb(w.BeaconRgb), ArenaView.WorldPoint((float)w.WorldX, (float)w.WorldY), 1f);
                var label = TextAt(_beaconTexts, i);
                bool changed = label.text != w.WorldText;
                if (changed) label.text = w.WorldText;
                label.color = Rgb(w.TextRgb);
                label.transform.position = ArenaView.WorldPoint((float)w.WorldX, (float)w.WorldY + BeaconTextOffsetUnits);
                if (!label.gameObject.activeSelf) label.gameObject.SetActive(true);
                if (changed || !_plates.ContainsKey(label)) FitPlate(label, _plates);
                Clear(label);
            }
            for (int i = BeaconsUsed; i < _beacons.Count; i++) if (_beacons[i].gameObject.activeSelf) _beacons[i].gameObject.SetActive(false);
            for (int i = BeaconsUsed; i < _beaconTexts.Count; i++) if (_beaconTexts[i].gameObject.activeSelf) _beaconTexts[i].gameObject.SetActive(false);
        }

        TextMeshPro TextAt(List<TextMeshPro> pool, int i)
        {
            while (pool.Count <= i)
            {
                var t = NewLabel("Camp ward label"); t.alignment = TextAlignmentOptions.Bottom;
                pool.Add(t);
            }
            return pool[i];
        }

        TextMeshPro Get(int i)
        {
            while (_labels.Count <= i) _labels.Add(NewLabel("Camp respawn label"));
            return _labels[i];
        }

        TextMeshPro NewLabel(string name)
        {
            var go = new GameObject(name); go.transform.SetParent(_root, false);
            var t = go.AddComponent<TextMeshPro>();
            var font = Resources.Load<TMP_FontAsset>("Showcase/NunitoBold");
            t.font = font != null ? font : TMP_Settings.defaultFontAsset;
            t.alignment = TextAlignmentOptions.Center; t.enableWordWrapping = false;
            t.fontSize = 3.4f; t.color = new Color32(0xe5, 0xed, 0xf7, 255);
            t.fontSharedMaterial = OverheadIndicators.OutlinedMaterial(t.font);
            t.rectTransform.sizeDelta = new Vector2(6f, .6f);
            t.GetComponent<MeshRenderer>().sortingOrder = Order;
            go.SetActive(false);
            return t;
        }
    }
}
