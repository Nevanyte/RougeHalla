using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    /// <summary>Draws copied, currently delivered contacts. Membership is replaced on every presentation.</summary>
    [RequireComponent(typeof(CanvasRenderer))]
    public sealed class TacticalMapMarks : MaskableGraphic
    {
        readonly List<InterpActor> _actors = new List<InterpActor>();
        readonly List<Vector2> _route = new List<Vector2>();
        readonly List<Vector2> _chests = new List<Vector2>();
        readonly List<DeliveredPoint> _delivered = new List<DeliveredPoint>();
        readonly List<TMP_Text> _labels = new List<TMP_Text>();
        struct DeliveredPoint { public Vector2 At; public string Label; public byte Kind; }
        public QuestHandle? TrackedQuest { get; set; }
        public bool ShowDeliveredLabels { get; set; }
        public int MerchantCount { get; private set; }
        public int QuestGiverCount { get; private set; }
        public int QuestObjectiveCount { get; private set; }
        MapBlob _map;
        Vector2? _self;
        uint _selfId;
        public int ContactCount => _actors.Count;
        public void SetMap(MapBlob map)
        {
            _map = map;
            if (map == null) { _actors.Clear(); _route.Clear(); _chests.Clear(); _self = null; ClearDelivered(); }
            SetVerticesDirty();
        }
        public void Present(Session session, IReadOnlyList<RoutePoint> route)
        {
            _actors.Clear(); _route.Clear(); _chests.Clear(); _self = null; ClearDelivered(false);
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
            RefreshDeliveredLabels();
            SetVerticesDirty();
        }
        void ClearDelivered(bool hideLabels = true)
        {
            _delivered.Clear(); MerchantCount = QuestGiverCount = QuestObjectiveCount = 0;
            if (hideLabels) foreach (var label in _labels) if (label.gameObject.activeSelf) label.gameObject.SetActive(false);
        }
        void RefreshDeliveredLabels()
        {
            if (!ShowDeliveredLabels || _map == null)
            { foreach (var label in _labels) if (label.gameObject.activeSelf) label.gameObject.SetActive(false); return; }
            for (int i = 0; i < _delivered.Count; i++)
            {
                if (i == _labels.Count)
                {
                    var label = MythicUi.Text(transform, "DeliveredPointLabel" + i, "", new Vector2(.5f, .5f), new Vector2(.5f, .5f), 12);
                    label.rectTransform.sizeDelta = new Vector2(180, 32); _labels.Add(label);
                }
                var point = _delivered[i]; var text = _labels[i];
                string value = (point.Kind == 0 ? "Trader · " : point.Kind == 1 ? "Giver · " : "Objective · ") + point.Label;
                if (text.text != value) text.text = value;
                var r = rectTransform.rect;
                var projected = At(point.At);
                if (!r.Contains(projected)) { text.gameObject.SetActive(false); continue; }
                var at = projected + new Vector2(92, 14);
                at.x = Mathf.Clamp(at.x, r.xMin + 90, r.xMax - 90); at.y = Mathf.Clamp(at.y, r.yMin + 16, r.yMax - 16);
                text.rectTransform.anchoredPosition = at;
                if (!text.gameObject.activeSelf) text.gameObject.SetActive(true);
            }
            for (int i = _delivered.Count; i < _labels.Count; i++) if (_labels[i].gameObject.activeSelf) _labels[i].gameObject.SetActive(false);
        }
        Vector2 At(Vector2 world)
        {
            var r = rectTransform.rect;
            return new Vector2(r.xMin + world.x / (_map.W * 32f) * r.width, r.yMax - world.y / (_map.H * 32f) * r.height);
        }
        protected override void OnPopulateMesh(VertexHelper vh)
        {
            vh.Clear(); if (_map == null) return;
            for (int i = 1; i < _route.Count; i++) Line(vh, At(_route[i - 1]), At(_route[i]), 2, ShowcasePalette.Gold);
            foreach (var point in _route) Mark(vh, At(point), 3, ShowcasePalette.Gold, true);
            foreach (var point in _chests) { var p = At(point); Line(vh, p + Vector2.left * 4, p + Vector2.right * 4, 2, ShowcasePalette.Gold); Line(vh, p + Vector2.down * 4, p + Vector2.up * 4, 2, ShowcasePalette.Gold); }
            foreach (var point in _delivered)
            {
                var p = At(point.At);
                if (!rectTransform.rect.Contains(p)) continue;
                if (point.Kind == 2) { Line(vh, p + Vector2.left * 5, p + Vector2.right * 5, 2, ShowcasePalette.Text); Line(vh, p + Vector2.up * 5, p + Vector2.down * 5, 2, ShowcasePalette.Text); }
                else { Mark(vh, p, 6, ShowcasePalette.Text, point.Kind == 1); Mark(vh, p, 3, ShowcasePalette.Background, point.Kind == 1); }
            }
            foreach (var actor in _actors)
            {
                if (actor.Id == _selfId) continue;
                var point = At(new Vector2(actor.X, actor.Y));
                float radius = actor.Kind == ActorKind.Player ? 6 : 3;
                Mark(vh, point, radius + 2, ShowcasePalette.Background, actor.Kind == ActorKind.Player);
                FactionMark(vh, point, radius, actor.Faction);
            }
            if (_self.HasValue) { var p = At(_self.Value); Mark(vh, p, 7, ShowcasePalette.Background, true); Mark(vh, p, 4, ShowcasePalette.Text, true); }
        }
        static void FactionMark(VertexHelper vh, Vector2 point, float radius, FactionId? faction)
        {
            if (!faction.HasValue) { Mark(vh, point, radius, ShowcasePalette.MutedText, true); return; }
            Color32 color = ShowcasePalette.Faction((int)faction.Value);
            if (faction == FactionId.Frost)
            {
                Line(vh, point + Vector2.up * radius, point + Vector2.down * radius, 2, color);
                Line(vh, point + Vector2.left * radius, point + Vector2.right * radius, 2, color);
            }
            else if (faction == FactionId.Fire)
            {
                int i = vh.currentVertCount;
                vh.AddVert(point + Vector2.up * radius, color, Vector2.zero);
                vh.AddVert(point + new Vector2(radius, -radius), color, Vector2.zero);
                vh.AddVert(point + new Vector2(-radius, -radius), color, Vector2.zero);
                vh.AddTriangle(i, i + 1, i + 2);
            }
            else if (faction == FactionId.Holy)
            {
                for (int n = 0; n < 8; n++)
                {
                    float a = n * Mathf.PI / 4, b = (n + 1) * Mathf.PI / 4;
                    Line(vh, point + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * radius, point + new Vector2(Mathf.Cos(b), Mathf.Sin(b)) * radius, 2, color);
                }
            }
            else Mark(vh, point, radius, color, faction == FactionId.Sentenced);
        }
        static void Mark(VertexHelper vh, Vector2 p, float radius, Color32 color, bool diamond)
        {
            int i = vh.currentVertCount;
            vh.AddVert(p + (diamond ? Vector2.up : new Vector2(-1, 1)) * radius, color, Vector2.zero);
            vh.AddVert(p + (diamond ? Vector2.right : new Vector2(1, 1)) * radius, color, Vector2.zero);
            vh.AddVert(p + (diamond ? Vector2.down : new Vector2(1, -1)) * radius, color, Vector2.zero);
            vh.AddVert(p + (diamond ? Vector2.left : new Vector2(-1, -1)) * radius, color, Vector2.zero);
            vh.AddTriangle(i, i + 1, i + 2); vh.AddTriangle(i + 2, i + 3, i);
        }
        static void Line(VertexHelper vh, Vector2 from, Vector2 to, float width, Color32 color)
        {
            var delta = to - from; if (delta.sqrMagnitude < .001f) return;
            var n = new Vector2(-delta.y, delta.x).normalized * width * .5f; int i = vh.currentVertCount;
            vh.AddVert(from + n, color, Vector2.zero); vh.AddVert(to + n, color, Vector2.zero);
            vh.AddVert(to - n, color, Vector2.zero); vh.AddVert(from - n, color, Vector2.zero);
            vh.AddTriangle(i, i + 1, i + 2); vh.AddTriangle(i + 2, i + 3, i);
        }
    }
}
