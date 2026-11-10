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
        MapBlob _map;
        Vector2? _self;
        uint _selfId;
        MapPing _ping;
        bool[] _zoneFound = new bool[MapZones.Count + 1];
        double[] _zoneX = new double[MapZones.Count + 1], _zoneY = new double[MapZones.Count + 1];
        public int ContactCount => _actors.Count;
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
            _actors.Clear(); _route.Clear(); _chests.Clear(); _self = null; ClearDelivered();
            if (session != null && session.State == SessionState.InMatch)
            {
                session.Snapshots.Sample(session.Snapshots.NewestMs, _actors);
                _selfId = session.PlayerId;
                if (session.Me != null) _self = new Vector2(session.Me.X, session.Me.Y);
                foreach (var chest in session.Collections.RewardChests) _chests.Add(new Vector2(chest.X, chest.Y));
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
                text.rectTransform.anchoredPosition = ZoneAt(region) + new Vector2(0f, -17f);
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
                    GlyphXY(vh, p + new Vector2(0f, -8f), 96f, 44f, MapGlyph.Disc, Alpha(ink, .62f));
                }
                Glyph(vh, p, size + 4f, glyph, Alpha(ink, Large ? 1f : .8f));
                Glyph(vh, p, size, glyph, Alpha(zone, Large ? 1f : .9f));
                if (region == MapZones.Holy) Glyph(vh, p, size * .28f, MapGlyph.Disc, Alpha(zone, 1f));
            }
            for (int i = 1; i < _route.Count; i++) LineAA(vh, At(_route[i - 1]), At(_route[i]), 2f, Alpha(theme.Accent, .8f));
            foreach (var point in _route) Marker(vh, At(point), 7f, MapGlyph.Disc, theme.Accent, ink);
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
