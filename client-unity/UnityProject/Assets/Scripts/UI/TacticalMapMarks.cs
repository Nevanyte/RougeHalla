using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>
    /// Draws copied, currently delivered contacts, the personal route, quest/trader/chest markers, the zone icons and the walk ping.
    /// Membership is replaced on every presentation. Every marker is a quad of the anti-aliased <see cref="MapGlyphs"/> atlas, drawn
    /// over a dark outline in the faction/accent colour from the theme, so shapes stay legible on any zone tint.
    /// </summary>
    [RequireComponent(typeof(CanvasRenderer))]
    public sealed class TacticalMapMarks : MaskableGraphic
    {
        readonly List<InterpActor> _actors = new List<InterpActor>();
        readonly List<Vector2> _route = new List<Vector2>();
        readonly List<Vector2> _chests = new List<Vector2>();
        readonly List<DeliveredPoint> _delivered = new List<DeliveredPoint>();
        readonly List<TMP_Text> _zoneLabels = new List<TMP_Text>();
        struct DeliveredPoint { public Vector2 At; public string Label; public byte Kind; }
        public QuestHandle? TrackedQuest { get; set; }
        /// <summary>True on the Tab map: bigger markers and a name beside each zone icon. The minimap draws small icons only.</summary>
        public bool Large { get; set; }
        public int MerchantCount { get; private set; }
        public int QuestGiverCount { get; private set; }
        public int QuestObjectiveCount { get; private set; }
        readonly List<CampMarkRow> _camps = new List<CampMarkRow>();
        readonly List<TMP_Text> _campClocks = new List<TMP_Text>();
        readonly List<CampBadgeRow> _rewards = new List<CampBadgeRow>();
        readonly List<CampWardRow> _wards = new List<CampWardRow>();
        readonly List<ChestBadgeRow> _chestRows = new List<ChestBadgeRow>();
        readonly List<TMP_Text> _chestTexts = new List<TMP_Text>();
        /// <summary>Chest seconds badges the model produced for the last presentation (the minimap has no sight test here, so all delivered chests).</summary>
        public int ChestBadgeCount => _chestRows.Count;
        /// <summary>Respawn clock labels shown after the one-badge rule dropped those of camps whose chest is drawn.</summary>
        public int CampClocksShown { get; private set; }
        /// <summary>The chest seconds text of the badge at <paramref name="i"/> in the last presentation.</summary>
        public string ChestBadgeText(int i) => _chestRows[i].Text;
        readonly List<TMP_Text> _badgeTexts = new List<TMP_Text>();
        readonly List<Image> _badgeIcons = new List<Image>();
        /// <summary>Reward badges (stat badge and elite chest) and ward marks the model produced for the last presentation.</summary>
        public int RewardBadgeCount => _rewards.Count;
        public int WardMarkCount => _wards.Count;
        /// <summary>Badges, chests and ward marks actually drawn in the last mesh pass (not covered by a contact).</summary>
        public int BadgesDrawn { get; private set; }
        public int WardsDrawn { get; private set; }
        MapBlob _map;
        Vector2? _self;
        uint _selfId;
        MapPing _ping;
        bool[] _zoneFound = new bool[MapZones.Count + 1];
        double[] _zoneX = new double[MapZones.Count + 1], _zoneY = new double[MapZones.Count + 1];
        public int ContactCount => _actors.Count;
        /// <summary>Camp markers the model produced for the last presentation (map knowledge, drawn regardless of sight).</summary>
        public int CampMarkerCount => _camps.Count;
        /// <summary>Camp markers actually drawn: those not covered by a contact within <see cref="CampDropPx"/>.</summary>
        public int CampMarkersDrawn { get; private set; }
        /// <summary>Legacy minimapMarkers.ts:87-88: a camp mark is dropped where a contact sits this close.</summary>
        public const float CampDropPx = 8f;
        /// <summary>The zones that have an icon (0 when the map has no region plane).</summary>
        public int ZoneIconCount { get { int n = 0; for (int r = 1; r <= MapZones.Count; r++) if (_zoneFound[r]) n++; return n; } }
        public bool PingActive => _ping.Active && _ping.Progress(NowMs) >= 0d;
        public Vector2 PingAt => new Vector2((float)_ping.WorldX, (float)_ping.WorldY);
        static double NowMs => Time.realtimeSinceStartupAsDouble * 1000d;
        public override Texture mainTexture => MapGlyphs.Texture;

        public void SetMap(MapBlob map)
        {
            _map = map;
            _ping.Active = false;
            if (map == null) { _actors.Clear(); _route.Clear(); _chests.Clear(); _self = null; ClearDelivered(); for (int r = 0; r <= MapZones.Count; r++) _zoneFound[r] = false; }
            else if (map.Regions != null) MapZones.LabelTiles(map.Regions, map.W, map.H, out _zoneFound, out _zoneX, out _zoneY);
            else for (int r = 0; r <= MapZones.Count; r++) _zoneFound[r] = false;
            RefreshZoneLabels();
            SetVerticesDirty();
        }

        /// <summary>Shows the walk-here ping marker at a world point for <see cref="MapPing.LifetimeMs"/>.</summary>
        public void Ping(Vector2 world)
        {
            _ping.Start(world.x, world.y, NowMs);
            SetVerticesDirty();
        }

        void Update()
        {
            if (_ping.Active)
            {
                if (_ping.Progress(NowMs) < 0d) _ping.Active = false;
                SetVerticesDirty();
            }
        }

        protected override void OnRectTransformDimensionsChange() { base.OnRectTransformDimensionsChange(); RefreshZoneLabels(); }

        public void Present(Session session, IReadOnlyList<RoutePoint> route)
        {
            _actors.Clear(); _route.Clear(); _chests.Clear(); _chestRows.Clear(); _camps.Clear(); _rewards.Clear(); _wards.Clear(); _self = null; ClearDelivered();
            if (session != null && session.State == SessionState.InMatch)
            {
                if (_map != null)
                {
                    bool active = !session.Training;
                    CampMarks.Markers(_map.Camps, session.Collections.Camps, session.ServerTimeMs, active, _camps);
                    CampBadges.Rewards(_map.Camps, session.Collections.Camps, active, Large ? CampSurface.TabMap : CampSurface.Minimap, null, _rewards);
                    CampBadges.Wards(_map.Camps, session.Collections.Camps, session.ServerTimeMs, active, _wards);
                }
                session.Snapshots.Sample(session.Snapshots.NewestMs, _actors);
                _selfId = session.PlayerId;
                if (session.Me != null) _self = new Vector2(session.Me.X, session.Me.Y);
                foreach (var chest in session.Collections.RewardChests) _chests.Add(new Vector2(chest.X, chest.Y));
                ChestBadges.Rows(_map?.Camps, session.Collections.RewardChests, session.ServerTimeMs, Large ? CampSurface.TabMap : CampSurface.Minimap, null, _chestRows);
                if (route != null) foreach (var point in route) _route.Add(new Vector2((float)point.X, (float)point.Y));
                var trade = session.Collections.Trade;
                if (trade != null && trade.Available) foreach (var row in trade.Merchants)
                {
                    _delivered.Add(new DeliveredPoint { At = new Vector2((float)row.X, (float)row.Y), Label = row.Name, Kind = 0 });
                    MerchantCount++;
                }
                var quests = session.Collections.Quests;
                if (quests != null && quests.Available)
                {
                    QuestRowView tracked = null;
                    foreach (var row in quests.Rows)
                    {
                        _delivered.Add(new DeliveredPoint { At = new Vector2((float)row.GiverX, (float)row.GiverY), Label = row.GiverLabel, Kind = 1 });
                        QuestGiverCount++;
                        if (TrackedQuest.HasValue && row.Handle.Equals(TrackedQuest.Value)) tracked = row;
                    }
                    if (tracked != null) foreach (var objective in quests.Objectives) if (objective.Quest.Equals(tracked.Handle))
                    {
                        _delivered.Add(new DeliveredPoint { At = new Vector2((float)objective.X, (float)objective.Y), Label = tracked.Name, Kind = 2 });
                        QuestObjectiveCount++;
                    }
                }
            }
            RefreshCampClocks();
            RefreshBadgeTexts();
            RefreshChestTexts();
            RefreshBadgeIcons();
            SetVerticesDirty();
        }

        void ClearDelivered() { _delivered.Clear(); MerchantCount = QuestGiverCount = QuestObjectiveCount = 0; }

        Vector2 At(Vector2 world)
        {
            var r = rectTransform.rect;
            return new Vector2(r.xMin + world.x / (_map.W * 32f) * r.width, r.yMax - world.y / (_map.H * 32f) * r.height);
        }

        Vector2 ZoneAt(int region) { return At(new Vector2((float)_zoneX[region] * 32f, (float)_zoneY[region] * 32f)); }

        void RefreshZoneLabels()
        {
            bool show = Large && _map != null;
            for (int i = 0; i < MapZones.Count; i++)
            {
                int region = i + 1;
                bool on = show && _zoneFound[region];
                if (i >= _zoneLabels.Count)
                {
                    if (!on) continue;
                    var label = HudUi.Label(transform, "ZoneLabel" + region, MapZones.Name(region).ToUpperInvariant(), 10f, UiTheme.Current.TextPrimary, TextAlignmentOptions.Center, false, UiFontRole.Display);
                    var rect = label.rectTransform; rect.anchorMin = rect.anchorMax = new Vector2(.5f, .5f); rect.pivot = new Vector2(.5f, .5f); rect.sizeDelta = new Vector2(120f, 18f);
                    _zoneLabels.Add(label);
                }
                var text = _zoneLabels[i];
                if (text.gameObject.activeSelf != on) text.gameObject.SetActive(on);
                if (!on) continue;
                // Sits just under the zone icon.
                text.rectTransform.anchoredPosition = ZoneAt(region) + new Vector2(0f, -24f);
            }
        }

        bool ContactNear(Vector2 p)
        {
            foreach (var actor in _actors)
                if (actor.Id != _selfId && (At(new Vector2(actor.X, actor.Y)) - p).sqrMagnitude < CampDropPx * CampDropPx) return true;
            return false;
        }

        /// <summary>Respawn countdowns of cleared camps: pooled labels, reused across presentations.</summary>
        void RefreshCampClocks()
        {
            int used = 0;
            if (_map != null)
                for (int i = 0; i < _camps.Count; i++)
                {
                    var camp = _camps[i];
                    if (camp.Countdown == null) continue;
                    if (ChestBadges.Replaces(_chestRows, camp.Index)) continue; // one badge per camp: the chest's seconds win while it stands
                    var p = At(new Vector2((float)camp.WorldX, (float)camp.WorldY));
                    if (ContactNear(p)) continue;
                    if (used >= _campClocks.Count)
                    {
                        var label = HudUi.Label(transform, "CampClock" + used, "", 9f, new Color32(0xb4, 0xc9, 0xdc, 255), TextAlignmentOptions.Center, false, UiFontRole.Display);
                        var rect = label.rectTransform; rect.anchorMin = rect.anchorMax = new Vector2(.5f, .5f); rect.pivot = new Vector2(.5f, .5f); rect.sizeDelta = new Vector2(48f, 14f);
                        label.raycastTarget = false;
                        _campClocks.Add(label);
                    }
                    var text = _campClocks[used++];
                    if (!text.gameObject.activeSelf) text.gameObject.SetActive(true);
                    if (text.text != camp.Countdown) text.text = camp.Countdown;
                    text.rectTransform.anchoredPosition = p + new Vector2(0f, Large ? -16f : -10f);
                }
            for (int i = used; i < _campClocks.Count; i++) if (_campClocks[i].gameObject.activeSelf) _campClocks[i].gameObject.SetActive(false);
            CampClocksShown = used;
        }

        Vector2 ChestTextAt(Vector2 p) { return p + new Vector2(0f, Large ? -15f : -12f); }

        /// <summary>Remaining seconds under each chest blip: pooled labels, rewritten only when the (cached) string changes.</summary>
        void RefreshChestTexts()
        {
            int used = 0;
            if (_map != null)
                for (int i = 0; i < _chestRows.Count; i++)
                {
                    var row = _chestRows[i];
                    if (used >= _chestTexts.Count)
                    {
                        var label = HudUi.Label(transform, "ChestSeconds" + used, "", 9f, new Color32(0xff, 0xe0, 0x8a, 255), TextAlignmentOptions.Center, false, UiFontRole.Display);
                        var rect = label.rectTransform; rect.anchorMin = rect.anchorMax = new Vector2(.5f, .5f); rect.pivot = new Vector2(.5f, .5f); rect.sizeDelta = new Vector2(30f, 14f);
                        label.raycastTarget = false;
                        _chestTexts.Add(label);
                    }
                    var text = _chestTexts[used++];
                    if (!text.gameObject.activeSelf) text.gameObject.SetActive(true);
                    if (text.text != row.Text) text.text = row.Text;
                    text.rectTransform.anchoredPosition = ChestTextAt(At(new Vector2((float)row.WorldX, (float)row.WorldY)));
                }
            for (int i = used; i < _chestTexts.Count; i++) if (_chestTexts[i].gameObject.activeSelf) _chestTexts[i].gameObject.SetActive(false);
        }

        // Layout beside the camp marker: ward mark on the left, reward badge (and elite chest) on the right, the respawn clock below.
        Vector2 RewardSlot(Vector2 p, int row) { float s = Large ? 1.2f : 1f; return p + new Vector2(11f * s, 2f + row * 12f * s); }
        Vector2 WardSlot(Vector2 p) { float s = Large ? 1.2f : 1f; return p + new Vector2(-11f * s, 2f); }
        static readonly Color32 ChestTone = new Color32(0xe8, 0xd9, 0xa8, 255);

        TMP_Text BadgeText(int i)
        {
            while (_badgeTexts.Count <= i)
            {
                var label = HudUi.Label(transform, "CampBadgeText" + _badgeTexts.Count, "", 9f, new Color32(0xe5, 0xed, 0xf7, 255), TextAlignmentOptions.Left, false, UiFontRole.Display);
                var rect = label.rectTransform; rect.anchorMin = rect.anchorMax = new Vector2(.5f, .5f); rect.sizeDelta = new Vector2(40f, 14f);
                label.raycastTarget = false;
                _badgeTexts.Add(label);
            }
            return _badgeTexts[i];
        }

        void ShowBadgeText(ref int used, Vector2 at, string text, Color32 color, bool leftOfPoint)
        {
            var t = BadgeText(used++);
            if (!t.gameObject.activeSelf) t.gameObject.SetActive(true);
            if (t.text != text) t.text = text;
            t.color = color;
            t.alignment = leftOfPoint ? TextAlignmentOptions.Right : TextAlignmentOptions.Left;
            t.rectTransform.pivot = new Vector2(leftOfPoint ? 1f : 0f, .5f);
            t.rectTransform.anchoredPosition = at;
        }

        /// <summary>Tab map amount / "Aug" texts and the ward countdowns: pooled, rewritten only when the model's (cached) string changes.</summary>
        void RefreshBadgeTexts()
        {
            int used = 0;
            if (_map != null)
            {
                for (int i = 0; i < _rewards.Count; i++)
                {
                    var b = _rewards[i];
                    var p = At(new Vector2((float)b.WorldX, (float)b.WorldY));
                    if (ContactNear(p)) continue;
                    int row = 0;
                    if (b.AmountText != null) ShowBadgeText(ref used, RewardSlot(p, row++) + new Vector2(8f, 0f), b.AmountText, Rgb(b.IconRgb), false);
                    if (b.EliteText != null) ShowBadgeText(ref used, RewardSlot(p, row) + new Vector2(8f, 0f), b.EliteText, ChestTone, false);
                }
                for (int i = 0; i < _wards.Count; i++)
                {
                    var w = _wards[i];
                    var p = At(new Vector2((float)w.WorldX, (float)w.WorldY));
                    if (ContactNear(p)) continue;
                    if (!Large) continue; // the minimap keeps the ward mark only, no number
                    ShowBadgeText(ref used, WardSlot(p) + new Vector2(-8f, 0f), w.Countdown, Rgb(w.TextRgb), true);
                }
            }
            for (int i = used; i < _badgeTexts.Count; i++) if (_badgeTexts[i].gameObject.activeSelf) _badgeTexts[i].gameObject.SetActive(false);
        }

        /// <summary>The stat glyph (the GAINED strip's art, tinted with the model's icon colour) of each reward badge: pooled Image children.</summary>
        void RefreshBadgeIcons()
        {
            int used = 0;
            if (_map != null)
                for (int i = 0; i < _rewards.Count; i++)
                {
                    var b = _rewards[i];
                    if (b.IconKey == null) continue;
                    var p = At(new Vector2((float)b.WorldX, (float)b.WorldY));
                    if (ContactNear(p)) continue;
                    if (used >= _badgeIcons.Count)
                    {
                        var go = new GameObject("CampBadgeIcon" + used, typeof(RectTransform)); go.transform.SetParent(transform, false);
                        var image = go.AddComponent<Image>(); image.raycastTarget = false; image.preserveAspect = true;
                        image.rectTransform.anchorMin = image.rectTransform.anchorMax = new Vector2(.5f, .5f);
                        _badgeIcons.Add(image);
                    }
                    var icon = _badgeIcons[used++];
                    float size = (Large ? 15f : 12f);
                    if (!icon.gameObject.activeSelf) icon.gameObject.SetActive(true);
                    icon.sprite = CampRespawnLabels.Art(b.IconKey);
                    icon.color = Rgb(b.IconRgb);
                    icon.rectTransform.sizeDelta = new Vector2(size, size);
                    icon.rectTransform.anchoredPosition = RewardSlot(p, 0);
                }
            for (int i = used; i < _badgeIcons.Count; i++) if (_badgeIcons[i].gameObject.activeSelf) _badgeIcons[i].gameObject.SetActive(false);
        }

        static Color32 Rgb(uint rgb) { return new Color32((byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb, 255); }

        /// <summary>Reward badges as a dark plate under the stat glyph Image, chests as squares, ward marks as rings in the beacon colour.</summary>
        void DrawBadges(VertexHelper vh, Color32 ink, float s)
        {
            BadgesDrawn = WardsDrawn = 0;
            foreach (var b in _rewards)
            {
                var p = At(new Vector2((float)b.WorldX, (float)b.WorldY));
                if (ContactNear(p)) continue;
                BadgesDrawn++;
                int row = 0;
                if (b.IconKey != null) { Glyph(vh, RewardSlot(p, row++), 17f * s, MapGlyph.Disc, Alpha(ink, .9f)); } // dark plate under the glyph Image
                if (b.EliteIconKey != null) Marker(vh, RewardSlot(p, row), 7f * s, MapGlyph.Square, ChestTone, ink);
            }
            foreach (var w in _wards)
            {
                var p = At(new Vector2((float)w.WorldX, (float)w.WorldY));
                if (ContactNear(p)) continue;
                WardsDrawn++;
                Marker(vh, WardSlot(p), 8f * s, MapGlyph.Ring, Rgb(w.BeaconRgb), ink);
            }
        }

        void DrawCamps(VertexHelper vh, UiTheme theme, Color32 ink, float s)
        {
            CampMarkersDrawn = 0;
            foreach (var camp in _camps)
            {
                var p = At(new Vector2((float)camp.WorldX, (float)camp.WorldY));
                if (ContactNear(p)) continue;
                CampMarkersDrawn++;
                float size = (camp.Elite ? 9.2f : 6.8f) * s;
                Color zone = theme.ZoneColor(camp.Zone);
                var glyph = MapGlyphs.ForShape(MapZones.Shape(camp.Zone));
                bool cleared = camp.State == CampMarkState.Cleared;
                float a = cleared ? .38f : 1f;
                Glyph(vh, p, size + 3f, glyph, Alpha(ink, a));
                Glyph(vh, p, size, glyph, Alpha(zone, a));
                if (camp.State == CampMarkState.Engaged) Glyph(vh, p, size + 5f, MapGlyph.Ring, Alpha(theme.TextSecondary, .7f));
                if (cleared)
                {
                    Glyph(vh, p, size + 3f, MapGlyph.Cross, ink);
                    Glyph(vh, p, size, MapGlyph.Cross, new Color32(0xec, 0xef, 0xf1, 255));
                }
                if (camp.Elite) Marker(vh, p + new Vector2(0f, size + 3f), 6f * s, MapGlyph.Diamond, new Color32(0xff, 0xd5, 0x4f, 255), ink);
            }
        }

        protected override void OnPopulateMesh(VertexHelper vh)
        {
            vh.Clear(); if (_map == null) return;
            var theme = UiTheme.Current;
            float s = Large ? 1.2f : 1f;
            Color32 ink = theme.OutlineDark;
            // Zone icons first, so every other marker draws over them.
            for (int region = 1; region <= MapZones.Count; region++)
            {
                if (!_zoneFound[region]) continue;
                var p = ZoneAt(region);
                var glyph = MapGlyphs.ForShape(MapZones.Shape(region));
                Color zone = theme.ZoneColor(region);
                float size = Large ? 22f : 11f;
                if (Large)
                {
                    // A soft dark plate behind icon and name keeps them readable on the zone tint.
                    GlyphXY(vh, p + new Vector2(0f, -12f), 104f, 56f, MapGlyph.Disc, Alpha(ink, .6f));
                }
                Glyph(vh, p, size + 4f, glyph, Alpha(ink, Large ? 1f : .8f));
                Glyph(vh, p, size, glyph, Alpha(zone, Large ? 1f : .9f));
                if (region == MapZones.Holy) Glyph(vh, p, size * .28f, MapGlyph.Disc, Alpha(zone, 1f));
            }
            DrawCamps(vh, theme, ink, s);
            DrawBadges(vh, ink, s);
            for (int i = 1; i < _route.Count; i++) LineAA(vh, At(_route[i - 1]), At(_route[i]), 2f, Alpha(theme.Accent, .8f));
            foreach (var point in _route) Marker(vh, At(point), 7f, MapGlyph.Disc, theme.Accent, ink);
            // The box is drawn only with a map, as its label is (RefreshChestTexts). Chest seconds are not dropped under a
            // contact dot, unlike camp clocks: legacy draws chest blips above the dots (minimapMarkers.ts:60-65).
            if (_map != null) foreach (var row in _chestRows)
                GlyphXY(vh, ChestTextAt(At(new Vector2((float)row.WorldX, (float)row.WorldY))), (row.Text.Length * 6f + 8f) * s, 12f * s, MapGlyph.Square, Alpha(ink, .85f)); // badge box
            foreach (var point in _chests) Marker(vh, At(point), 11f * s, MapGlyph.Plus, theme.Accent, ink);
            foreach (var point in _delivered)
            {
                var p = At(point.At);
                if (!rectTransform.rect.Contains(p)) continue;
                if (point.Kind == 2) Marker(vh, p, 11f * s, MapGlyph.Cross, theme.TextPrimary, ink);
                else if (point.Kind == 1) { Marker(vh, p, 13f * s, MapGlyph.Diamond, theme.TextPrimary, ink); Glyph(vh, p, 5f * s, MapGlyph.Disc, ink); }
                else { Marker(vh, p, 13f * s, MapGlyph.Ring, theme.TextPrimary, ink); Glyph(vh, p, 5f * s, MapGlyph.Disc, theme.TextPrimary); }
            }
            // Creatures under players, so a player marker is never hidden by a crowd of mobs.
            for (int pass = 0; pass < 2; pass++)
                foreach (var actor in _actors)
                {
                    if (actor.Id == _selfId) continue;
                    bool player = actor.Kind == ActorKind.Player;
                    if (player != (pass == 1)) continue;
                    FactionMark(vh, At(new Vector2(actor.X, actor.Y)), (player ? 12f : 6.5f) * s, actor.Faction, theme, ink);
                }
            if (_self.HasValue)
            {
                var p = At(_self.Value);
                Glyph(vh, p, 26f * s, MapGlyph.Ring, Alpha(theme.TextPrimary, .75f));
                Glyph(vh, p, 17f * s, MapGlyph.Disc, ink);
                Glyph(vh, p, 12f * s, MapGlyph.Disc, theme.Info);
            }
            double progress = _ping.Active ? _ping.Progress(NowMs) : -1d;
            if (progress >= 0d)
            {
                var p = At(new Vector2((float)_ping.WorldX, (float)_ping.WorldY));
                float scale = (float)_ping.Scale(progress), alpha = (float)_ping.Alpha(progress);
                Glyph(vh, p, 38f * scale, MapGlyph.Ring, Alpha(ink, alpha * .8f));
                Glyph(vh, p, 34f * scale, MapGlyph.Ring, Alpha(theme.Success, alpha));
                Glyph(vh, p, 8f, MapGlyph.Disc, Alpha(ink, alpha));
                Glyph(vh, p, 5f, MapGlyph.Disc, Alpha(theme.Success, alpha));
            }
        }

        static Color32 Alpha(Color32 c, float a) { return new Color32(c.r, c.g, c.b, (byte)Mathf.RoundToInt(Mathf.Clamp01(a) * c.a)); }
        static Color32 Alpha(Color c, float a) { Color32 k = c; return Alpha(k, a); }

        void FactionMark(VertexHelper vh, Vector2 point, float size, FactionId? faction, UiTheme theme, Color32 ink)
        {
            if (!faction.HasValue) { Marker(vh, point, size * .8f, MapGlyph.Disc, theme.TextSecondary, ink); return; }
            Color32 color = theme.FactionColor((int)faction.Value);
            MapGlyph glyph = faction == FactionId.Fire ? MapGlyph.Triangle : faction == FactionId.Sentenced ? MapGlyph.Diamond :
                faction == FactionId.Plague ? MapGlyph.Trefoil : faction == FactionId.Frost ? MapGlyph.Asterisk : MapGlyph.Ring;
            Marker(vh, point, size, glyph, color, ink);
            if (faction == FactionId.Holy) Glyph(vh, point, size * .3f, MapGlyph.Disc, color);
        }

        /// <summary>A glyph with a dark outline two units wide behind it.</summary>
        static void Marker(VertexHelper vh, Vector2 p, float size, MapGlyph glyph, Color32 color, Color32 ink)
        {
            Glyph(vh, p, size + 4f, glyph, ink);
            Glyph(vh, p, size, glyph, color);
        }

        static void Glyph(VertexHelper vh, Vector2 p, float size, MapGlyph glyph, Color32 color) { GlyphXY(vh, p, size, size, glyph, color); }

        static void GlyphXY(VertexHelper vh, Vector2 p, float width, float height, MapGlyph glyph, Color32 color)
        {
            if (color.a == 0 || width <= 0f) return;
            // The atlas cell is 64 texels with a 26 texel glyph radius, so scale the quad to put the glyph at the asked size.
            float k = 64f / 52f; float hw = width * k * .5f, hh = height * k * .5f;
            var uv = MapGlyphs.Uv(glyph); int i = vh.currentVertCount;
            vh.AddVert(new Vector3(p.x - hw, p.y - hh), color, new Vector2(uv.xMin, uv.yMin));
            vh.AddVert(new Vector3(p.x - hw, p.y + hh), color, new Vector2(uv.xMin, uv.yMax));
            vh.AddVert(new Vector3(p.x + hw, p.y + hh), color, new Vector2(uv.xMax, uv.yMax));
            vh.AddVert(new Vector3(p.x + hw, p.y - hh), color, new Vector2(uv.xMax, uv.yMin));
            vh.AddTriangle(i, i + 1, i + 2); vh.AddTriangle(i + 2, i + 3, i);
        }

        /// <summary>An anti-aliased line: a quad twice the line width across, textured with the soft-edged line profile.</summary>
        static void LineAA(VertexHelper vh, Vector2 from, Vector2 to, float width, Color32 color)
        {
            var delta = to - from; if (delta.sqrMagnitude < .001f) return;
            var n = new Vector2(-delta.y, delta.x).normalized * width; int i = vh.currentVertCount;
            var uv = MapGlyphs.Uv(MapGlyph.Line); float u = (uv.xMin + uv.xMax) * .5f;
            vh.AddVert(from + n, color, new Vector2(u, uv.yMin)); vh.AddVert(to + n, color, new Vector2(u, uv.yMin));
            vh.AddVert(to - n, color, new Vector2(u, uv.yMax)); vh.AddVert(from - n, color, new Vector2(u, uv.yMax));
            vh.AddTriangle(i, i + 1, i + 2); vh.AddTriangle(i + 2, i + 3, i);
        }
    }
}
