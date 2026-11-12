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
        const float BadgeOffsetUnits = -44f, BeaconTextOffsetUnits = 50f, BadgeScale = .55f, BeaconScale = 1.5f;
        readonly List<CampBadgeRow> _badges = new List<CampBadgeRow>();
        readonly List<CampWardRow> _wards = new List<CampWardRow>();
        readonly List<SpriteRenderer> _badgeIcons = new List<SpriteRenderer>();
        readonly List<SpriteRenderer> _beacons = new List<SpriteRenderer>();
        readonly List<TextMeshPro> _beaconTexts = new List<TextMeshPro>();
        public int BadgesUsed { get; private set; }
        public int BeaconsUsed { get; private set; }
        public string BeaconTextAt(int i) { return i >= 0 && i < BeaconsUsed ? _beaconTexts[i].text : null; }

        /// <summary>Existing indicator art by legacy combat-icon key; keys with no art draw the plain "pip" disc in the stat colour.
        /// Art exists for ad and armor only; the chest uses the crate glyph.</summary>
        public static string ArtKey(string iconKey)
        {
            switch (iconKey) { case "ad": return "ad"; case "armor": return "armor"; case "chest": return "crate"; default: return "pip"; }
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
            DrawBadges(); DrawBeacons();

            _rows.Clear();
            if (session != null && session.Map != null && session.State == SessionState.InMatch)
                CampMarks.WorldLabels(session.Map.Camps, session.Collections.Camps, session.ServerTimeMs, !session.Training, _rows);
            Used = _rows.Count;
            for (int i = 0; i < Used; i++)
            {
                var label = Get(i);
                var row = _rows[i];
                if (label.text != row.Text) label.text = row.Text;
                label.transform.position = ArenaView.WorldPoint((float)row.WorldX, (float)row.WorldY + OffsetUnits);
                if (!label.gameObject.activeSelf) label.gameObject.SetActive(true);
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

        void Place(SpriteRenderer r, string artKey, Color32 color, Vector3 at, float scale)
        {
            var sprite = IndicatorArt.Get(artKey);
            if (r.sprite != sprite) r.sprite = sprite;
            r.color = color; r.transform.position = at; r.transform.localScale = Vector3.one * scale;
            if (!r.gameObject.activeSelf) r.gameObject.SetActive(true);
        }

        void DrawBadges()
        {
            int used = 0;
            for (int i = 0; i < _badges.Count; i++)
            {
                var b = _badges[i];
                float x = (float)b.WorldX, y = (float)b.WorldY + BadgeOffsetUnits;
                bool both = b.IconKey != null && b.EliteIconKey != null;
                if (b.IconKey != null)
                    Place(Icon(_badgeIcons, used++, "Camp reward badge", Order), ArtKey(b.IconKey), Rgb(b.IconRgb), ArenaView.WorldPoint(x - (both ? 12f : 0f), y), BadgeScale);
                if (b.EliteIconKey != null)
                    Place(Icon(_badgeIcons, used++, "Camp reward badge", Order), ArtKey(b.EliteIconKey), Rgb(b.EliteIconRgb), ArenaView.WorldPoint(x + (both ? 12f : 0f), y), BadgeScale);
            }
            BadgesUsed = used;
            for (int i = used; i < _badgeIcons.Count; i++) if (_badgeIcons[i].gameObject.activeSelf) _badgeIcons[i].gameObject.SetActive(false);
        }

        void DrawBeacons()
        {
            BeaconsUsed = _wards.Count;
            for (int i = 0; i < _wards.Count; i++)
            {
                var w = _wards[i];
                Place(Icon(_beacons, i, "Camp ward beacon", Order - 1), "dashring", Rgb(w.BeaconRgb), ArenaView.WorldPoint((float)w.WorldX, (float)w.WorldY), BeaconScale);
                var label = TextAt(_beaconTexts, i);
                if (label.text != w.WorldText) label.text = w.WorldText;
                label.color = Rgb(w.TextRgb);
                label.transform.position = ArenaView.WorldPoint((float)w.WorldX, (float)w.WorldY + BeaconTextOffsetUnits);
                if (!label.gameObject.activeSelf) label.gameObject.SetActive(true);
            }
            for (int i = BeaconsUsed; i < _beacons.Count; i++) if (_beacons[i].gameObject.activeSelf) _beacons[i].gameObject.SetActive(false);
            for (int i = BeaconsUsed; i < _beaconTexts.Count; i++) if (_beaconTexts[i].gameObject.activeSelf) _beaconTexts[i].gameObject.SetActive(false);
        }

        TextMeshPro TextAt(List<TextMeshPro> pool, int i)
        {
            while (pool.Count <= i)
            {
                var t = NewLabel("Camp ward label");
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
