// World markers for delivered quest givers and merchants, as legacy QuestView / TraderView: a bright "!" over a giver with an offer the
// player has not accepted, a dim "?" over one they hold, "Turn in here" when the quest is ready, and a diamond with the merchant's name.
// Pooled sprites and text; a marker is drawn only for a delivered row that is not in fog. Presentation only.
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    public sealed class WorldMarks
    {
        sealed class Mark { public SpriteRenderer Glyph, GlyphPlate, LabelPlate; public TextMeshPro Label; public string Text; }
        readonly Transform _root;
        readonly List<Mark> _marks = new List<Mark>();
        int _used;
        public int Used { get { return _used; } }
        const int Order = 29000;

        public WorldMarks(Transform root) { _root = root; }

        /// <param name="canSee">True when the ground at a sim position is not fogged; null shows everything (no fog yet).</param>
        public void Update(CollectionsView c, System.Func<float, float, bool> canSee)
        {
            _used = 0;
            if (c != null)
            {
                var theme = UiTheme.Current;
                if (c.Quests != null && c.Quests.Available)
                    foreach (var q in c.Quests.Rows)
                    {
                        if (q.State != QuestRowState.Open) continue;
                        float x = (float)q.GiverX, y = (float)q.GiverY;
                        if (canSee != null && !canSee(x, y)) continue;
                        bool accepted = q.OwnerAccepted;
                        var m = Next();
                        Place(m, ArenaView.WorldPoint(x, y) + new Vector3(0, 2.55f, 0), IndicatorArt.Get(Indicators.QuestMark(accepted) == '!' ? "bang" : "query"), (Color)theme.Accent, accepted ? .6f : 1f, .5f);
                        bool turnIn = accepted && q.OwnerReady;
                        SetLabel(m, turnIn ? "Turn in here" : q.GiverLabel, turnIn ? theme.Accent : theme.TextPrimary, new Vector3(0, -.2f, 0), 2.3f, 1f);
                    }
                if (c.Trade != null && c.Trade.Available)
                    foreach (var t in c.Trade.Merchants)
                    {
                        float x = (float)t.X, y = (float)t.Y;
                        if (canSee != null && !canSee(x, y)) continue;
                        var m = Next();
                        Color tone = (Color)(t.Kind == TradeKind.Stats ? theme.Info : theme.Accent);
                        Place(m, ArenaView.WorldPoint(x, y) + new Vector3(0, 2.2f, 0), IndicatorArt.Get("diamond"), tone, 1f, .46f);
                        SetLabel(m, t.Name, theme.TextPrimary, new Vector3(0, -.2f, 0), 2.3f, 1f);
                    }
            }
            for (int i = _used; i < _marks.Count; i++) { _marks[i].Glyph.enabled = false; _marks[i].GlyphPlate.enabled = false; _marks[i].LabelPlate.enabled = false; _marks[i].Label.gameObject.SetActive(false); }
        }

        Mark Next()
        {
            if (_used == _marks.Count)
            {
                var m = new Mark();
                // Opaque dark plates behind the glyph and the label keep both above 4.5:1 on any ground (sand, snow): plates, not outlines.
                m.GlyphPlate = ShowcaseSprites.Create(_root, "World marker plate", "bar", Order - 2, Color.white, Vector2.one, Vector3.zero, false);
                m.LabelPlate = ShowcaseSprites.Create(_root, "World marker label plate", "bar", Order - 1, Color.white, Vector2.one, Vector3.zero, false);
                m.GlyphPlate.enabled = m.LabelPlate.enabled = false;
                m.Glyph = ShowcaseSprites.Create(_root, "World marker", "bar", Order, Color.white, Vector2.one, Vector3.zero, false);
                var go = new GameObject("World marker label"); go.transform.SetParent(_root, false);
                m.Label = go.AddComponent<TextMeshPro>();
                var font = Resources.Load<TMP_FontAsset>("Showcase/NunitoBold");
                m.Label.font = font != null ? font : TMP_Settings.defaultFontAsset;
                m.Label.alignment = TextAlignmentOptions.Center; m.Label.enableWordWrapping = false;
                m.Label.fontSharedMaterial = OverheadIndicators.OutlinedMaterial(m.Label.font); m.Label.rectTransform.sizeDelta = new Vector2(5f, .5f);
                m.Label.GetComponent<MeshRenderer>().sortingOrder = Order + 1; go.SetActive(false);
                _marks.Add(m);
            }
            return _marks[_used++];
        }

        static void Place(Mark m, Vector3 at, Sprite sprite, Color color, float alpha, float size)
        {
            m.Glyph.enabled = true; m.Glyph.sprite = sprite; color.a = alpha; m.Glyph.color = color;
            m.Glyph.transform.position = at; m.Glyph.transform.localScale = new Vector3(size, size, 1);
            var plate = (Color)UiTheme.Current.OutlineDark; plate.a = 1f;
            m.GlyphPlate.enabled = true; m.GlyphPlate.color = plate; m.GlyphPlate.transform.position = at; m.GlyphPlate.transform.localScale = new Vector3(size * 1.32f, size * 1.32f, 1);
        }

        static void SetLabel(Mark m, string text, Color32 color, Vector3 offset, float size, float alpha)
        {
            if (string.IsNullOrEmpty(text)) { m.Label.gameObject.SetActive(false); m.LabelPlate.enabled = false; return; }
            if (!ReferenceEquals(m.Text, text)) { m.Text = text; m.Label.text = text; }
            m.Label.fontSize = size; var c = (Color)color; c.a = alpha; m.Label.color = c;
            m.Label.transform.position = m.Glyph.transform.position + offset - new Vector3(0, .25f, 0);
            m.Label.gameObject.SetActive(true);
            var lp = (Color)UiTheme.Current.OutlineDark; lp.a = 1f;
            m.LabelPlate.enabled = true; m.LabelPlate.color = lp;
            m.LabelPlate.transform.position = m.Label.transform.position + new Vector3(0, .02f, 0);
            m.LabelPlate.transform.localScale = new Vector3(m.Label.preferredWidth + .2f, size * .12f + .02f, 1);
        }
    }
}
