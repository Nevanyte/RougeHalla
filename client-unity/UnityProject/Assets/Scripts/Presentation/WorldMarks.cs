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
        sealed class Mark { public SpriteRenderer Glyph, GlyphPlate, LabelPlate, Figure, Shadow, Cast, Goods; public Transform FigureRoot; public TextMeshPro Label; public string Text; }
        readonly Transform _root;
        readonly ShowcaseCatalog _catalog;
        readonly List<Mark> _marks = new List<Mark>();
        int _used;
        public int Used { get { return _used; } }
        const int Order = 29000;

        /// <summary>The look catalog the merchants' figures are drawn from (null: the neutral silhouette, as before).</summary>
        public WorldMarks(Transform root, ShowcaseCatalog catalog = null) { _root = root; _catalog = catalog; }

        /// <summary>Same scale as every observed actor (SpriteActorPresenter.ActorVisualScale), so a trader is as tall as a fighter drawn from the same look.</summary>
        const float FigureScale = 1.2f;
        /// <summary>Catalog looks a merchant is drawn from: an existing robed character per kind (stats and barter), standing with a barrel of goods.</summary>
        public static string LookKey(TradeKind kind) { return kind == TradeKind.Stats ? "mage" : "mage-female"; }

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
                        var m = Next(); HideFigure(m);
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
                        // The trader stands there: the marker needs a body to point at (lab finding). Figure first: its top decides where the marker and the name sit.
                        float top = Figure(m, t.Kind, ArenaView.WorldPoint(x, y), x / 32f, y / 32f, 2000 + Mathf.RoundToInt(y * .5f), tone);
                        Place(m, ArenaView.WorldPoint(x, y) + new Vector3(0, top + .62f, 0), IndicatorArt.Get("diamond"), tone, 1f, .46f);
                        SetLabel(m, t.Name, theme.TextPrimary, new Vector3(0, -.2f, 0), 2.3f, 1f);
                    }
            }
            for (int i = _used; i < _marks.Count; i++) { HideFigure(_marks[i]); _marks[i].Glyph.enabled = false; _marks[i].GlyphPlate.enabled = false; _marks[i].LabelPlate.enabled = false; _marks[i].Label.gameObject.SetActive(false); }
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
                // Same parts and scale as an observed actor (SpriteActorPresenter.Create): contact and cast shadow, the authored body lit by the field, drawn under one 1.2x root.
                var fr = new GameObject("Trader"); fr.transform.SetParent(_root, false); fr.transform.localScale = new Vector3(FigureScale, FigureScale, 1f); m.FigureRoot = fr.transform;
                m.Shadow = ShowcaseSprites.Create(m.FigureRoot, "Trader contact shadow", "actorshadow", 1990, Color.white, new Vector2(1.2f, .45f), new Vector3(.13f, -.04f), false); m.Shadow.enabled = false;
                m.Cast = ShowcaseSprites.Create(m.FigureRoot, "Trader cast shadow", "actorshadow", 1989, Color.white, new Vector2(1.2f, .45f), new Vector3(.13f, -.04f), false); m.Cast.enabled = false;
                m.Goods = ShowcaseSprites.Create(m.FigureRoot, "Trader goods", "bar", 2000, Color.white, Vector2.one, Vector3.zero); m.Goods.enabled = false;
                m.Figure = ShowcaseSprites.Create(m.FigureRoot, "Trader figure", "bar", 2000, Color.white, Vector2.one, Vector3.zero); m.Figure.enabled = false;
                m.Figure.sharedMaterial = ShowcaseSprites.ActorLit;
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

        static void HideFigure(Mark m)
        {
            m.Figure.enabled = m.Shadow.enabled = m.Cast.enabled = m.Goods.enabled = false;
        }

        /// <summary>
        /// A merchant's figure: an existing robed look from the catalog (see <see cref="LookKey"/>) idling facing the camera, with a barrel of goods beside it, a contact and a
        /// cast shadow exactly as an observed actor gets (AtmosphereShadows.ApplyActor), standing at the delivered position. Without a catalog the neutral silhouette in the
        /// kind colour is drawn as before. Returns the figure's top above its feet, in world units, so the marker sits above the head.
        /// </summary>
        float Figure(Mark m, TradeKind kind, Vector3 feet, float tileX, float tileY, int order, Color tone)
        {
            m.FigureRoot.position = feet;
            var look = _catalog != null ? _catalog.Find(LookKey(kind)) : null;
            m.Figure.enabled = true; m.Figure.sortingOrder = order;
            m.Shadow.enabled = true; m.Shadow.sortingOrder = order - 8; m.Cast.sortingOrder = order - 9;
            AtmosphereShadows.ApplyActor(m.Shadow, tileX, tileY, 0f, 0f, m.Cast);
            var frames = look != null ? look.Idle : null;
            if (frames == null || frames.Length < 8)
            {
                m.Figure.sprite = ShowcaseIdentityAssets.GetFactionSilhouette(-1); m.Figure.color = Color.Lerp(Color.white, tone, .5f);
                m.Figure.transform.localScale = new Vector3(.8f, 1.35f, 1f); m.Figure.transform.localPosition = new Vector3(0, .55f, 0);
                m.Goods.enabled = false;
                return (.55f + .675f) * FigureScale;
            }
            int count = frames.Length / 8; bool reduced = ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion;
            int frame = reduced ? 0 : Mathf.FloorToInt(Time.unscaledTime * Mathf.Max(1f, look.IdleFPS)) % Mathf.Max(1, count);
            var sprite = frames[Mathf.Min(frames.Length - 1, FacingSouth * count + frame)];
            m.Figure.sprite = sprite; m.Figure.color = Color.Lerp(Color.white, tone, .12f);
            m.Figure.transform.localScale = Vector3.one * look.WorldHeight; m.Figure.transform.localPosition = new Vector3(0, .08f, 0);
            float top = (.08f + sprite.bounds.max.y * look.WorldHeight);
            var barrel = _catalog.Barrel;
            if (barrel != null && barrel.bounds.size.y > 1e-4f)
            {
                m.Goods.enabled = true; m.Goods.sprite = barrel; m.Goods.sortingOrder = order + 1;
                float s = GoodsHeight / barrel.bounds.size.y;       // the barrel reads as a stall's goods, about knee to hip high beside the figure
                m.Goods.transform.localScale = new Vector3(s, s, 1f);
                m.Goods.transform.localPosition = new Vector3(GoodsSide, .02f - barrel.bounds.min.y * s, 0f);
                m.Goods.color = Color.white;
            }
            else m.Goods.enabled = false;
            return top * FigureScale;
        }
        /// <summary>Catalog direction index facing the camera (flare order SW,W,NW,N,NE,E,SE,S, as SpriteActorPresenter).</summary>
        const int FacingSouth = 7;
        const float GoodsHeight = .62f, GoodsSide = .62f;

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
