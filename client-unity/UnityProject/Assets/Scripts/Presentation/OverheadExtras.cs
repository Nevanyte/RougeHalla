// The overhead marks the UI lab (?uilab=1) found missing or unreadable, kept out of OverheadIndicators so that file stays small:
//   * the barrier BUBBLE (legacy PlayerView.ts:412): a translucent circle in the barrier blue round the body, stronger with the barrier step
//     (fill alpha .10 + .14 s, stroke alpha .45 + .5 s, s = step / 8). It replaces the eight ticks above the head, which collided with the
//     status glyph row and vanished on snow and sand;
//   * the elite marks (legacy MobView.ts:32,112,242): the gold double ring on the ground and the five-point star above the name;
//   * the signature text cues (legacy MarkPlate.ts:39-44): TAXED, SUPPRESSED and EXEC BLOCKED, named instead of an unknown glyph (the tax
//     percentage is not delivered, so no number is shown).
// Owned by one OverheadIndicators (one actor); every renderer is a child of the actor root, so the vision fade reaches it.
using TMPro;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    public sealed class OverheadExtras
    {
        public const byte TaxedBit = 16, SuppressedBit = 32, ExecBlockedBit = 64;
        const float RingK = .86f / .80f;
        readonly SpriteRenderer _fill, _ring, _edge, _elite1, _elite2, _star, _cueBack;
        readonly TextMeshPro _cue;
        readonly SpriteRenderer[] _pips = new SpriteRenderer[4], _statEdge = new SpriteRenderer[2], _statBack = new SpriteRenderer[2], _statIcon = new SpriteRenderer[2];
        readonly SpriteRenderer _pipTop, _brand, _immune, _roam1, _roam2;
        static readonly string[] StatGlyphs = { "", "ad", "cast", "star", "antiheal", "haste", "armor", "dashring", "up", "droplet" };
        string _cueText; float _textFade = 1f; Color _cueBase;
        static Sprite _disc, _band;

        public OverheadExtras(Transform root)
        {
            var theme = UiTheme.Current;
            _fill = Make(root, "Barrier bubble", Disc(), -1);
            _edge = Make(root, "Barrier bubble edge", Band(), -1);
            _ring = Make(root, "Barrier bubble ring", Band(), -1);
            _elite1 = Make(root, "Elite ring outer", GroundMarkArt.Ring(theme.Accent, false, .02f), -1);
            _elite2 = Make(root, "Elite ring inner", GroundMarkArt.Ring(theme.Accent, false, .02f), -1);
            _star = Make(root, "Elite star", IndicatorArt.Get("star"), -1);
            _cueBack = Make(root, "Signature cue plate", ShowcaseSprites.Get("bar"), -1);
            for (int i = 0; i < 4; i++) _pips[i] = Make(root, "Mark pip " + (i + 1), ShowcaseSprites.Get("bar"), -1);
            _pipTop = Make(root, "Mark top pip outline", ShowcaseSprites.Get("bar"), -1);
            for (int i = 0; i < 2; i++)
            {
                _statEdge[i] = Make(root, "Stat mark edge " + (i + 1), ShowcaseSprites.Get("bar"), -1); _statBack[i] = Make(root, "Stat mark backer " + (i + 1), ShowcaseSprites.Get("bar"), -1);
                _statIcon[i] = Make(root, "Stat mark " + (i + 1), IndicatorArt.Get("star"), -1);
            }
            var violet = theme.FactionColor((int)FactionId.Sentenced);
            _brand = Make(root, "Mark brand ring", GroundMarkArt.Ring(violet, true), -1);
            _immune = Make(root, "Teleport immunity ring", GroundMarkArt.Ring(new Color32(0x4f, 0xc3, 0xf7, 255), false, .03f), -1);
            _roam1 = Make(root, "Roam ready ring outer", GroundMarkArt.Ring(new Color32(0xff, 0x8a, 0x3d, 255), false, .025f), -1);
            _roam2 = Make(root, "Roam ready ring inner", GroundMarkArt.Ring(new Color32(0xff, 0xb7, 0x4d, 255), false, .025f), -1);
            var go = new GameObject("Signature cue"); go.transform.SetParent(root, false);
            _cue = go.AddComponent<TextMeshPro>();
            var font = Resources.Load<TMP_FontAsset>("Showcase/NunitoBold");
            _cue.font = font != null ? font : TMP_Settings.defaultFontAsset;
            _cue.fontSize = 2.1f; _cue.fontStyle = FontStyles.Bold; _cue.alignment = TextAlignmentOptions.Center; _cue.enableWordWrapping = false;
            _cue.rectTransform.sizeDelta = new Vector2(4f, .4f); _cue.fontSharedMaterial = OverheadIndicators.OutlinedMaterial(_cue.font);
            _cue.GetComponent<MeshRenderer>().sortingOrder = 30; go.SetActive(false);
            HideAll();
        }

        static SpriteRenderer Make(Transform parent, string name, Sprite sprite, int order)
        {
            var r = ShowcaseSprites.Create(parent, name, "bar", order, Color.white, Vector2.one, Vector3.zero, false);
            r.sprite = sprite; r.enabled = false; return r;
        }

        public void HideAll()
        {
            _fill.enabled = _ring.enabled = _edge.enabled = _elite1.enabled = _elite2.enabled = _star.enabled = _cueBack.enabled = false;
            foreach (var r in _pips) r.enabled = false;
            _pipTop.enabled = _brand.enabled = _immune.enabled = _roam1.enabled = _roam2.enabled = false;
            for (int i = 0; i < 2; i++) _statEdge[i].enabled = _statBack[i].enabled = _statIcon[i].enabled = false;
            _cue.gameObject.SetActive(false); _cueText = null; _textFade = 1f;
        }

        public void ApplyOpacity(float alpha)
        {
            _textFade = alpha;
            if (_cue.gameObject.activeSelf) { var c = _cueBase; c.a *= alpha; _cue.color = c; }
        }

        /// <summary>The cue text a signature byte calls for (null when none).</summary>
        public static string CueText(byte sig)
        {
            bool tax = (sig & TaxedBit) != 0, sup = (sig & SuppressedBit) != 0, blocked = (sig & ExecBlockedBit) != 0;
            if (!tax && !sup && !blocked) return null;
            string text = null;
            if (tax) text = "TAXED";
            if (sup) text = text == null ? "SUPPRESSED" : text + " · SUPPRESSED";
            if (blocked) text = text == null ? "EXEC BLOCKED" : text + " · EXEC BLOCKED";
            return text;
        }

        /// <summary>Barrier bubble, elite ground rings and the signature cue for one frame.</summary>
        public void Update(in OverheadIndicators.Facts f, UiTheme theme)
        {
            // ---- barrier bubble -------------------------------------------------------------------------------------------------
            int step = Mathf.Clamp(f.BarrierStep, 0, 8);
            bool bubble = !f.Dead && step > 0;
            _fill.enabled = _ring.enabled = _edge.enabled = bubble;
            if (bubble)
            {
                float s = step / 8f, h = Mathf.Max(1.3f, f.HeadY * 1.12f), w = Mathf.Max(.95f, h * .66f);
                var at = new Vector3(0, f.HeadY * .5f + .04f, 0);
                var blue = (Color)theme.Info;
                var fc = blue; fc.a = .10f + .14f * s; _fill.color = fc; Place(_fill, at, w, h, f.Order + 1);
                var rc = blue; rc.a = .45f + .5f * s; _ring.color = rc; Place(_ring, at, w, h, f.Order + 1);
                var ec = (Color)theme.OutlineDark; ec.a = .55f + .3f * s; _edge.color = ec; Place(_edge, at, w * 1.045f, h * 1.045f, f.Order + 1);
            }
            // ---- elite ground rings -----------------------------------------------------------------------------------------------
            bool elite = !f.Dead && f.Elite;
            _elite1.enabled = _elite2.enabled = elite;
            if (elite)
            {
                _elite1.color = Color.white; _elite2.color = Color.white;
                _elite1.transform.localPosition = _elite2.transform.localPosition = new Vector3(0, .02f, 0);
                _elite1.transform.localScale = new Vector3(1.62f * RingK, .84f * RingK, 1); _elite2.transform.localScale = new Vector3(1.3f * RingK, .68f * RingK, 1);
                _elite1.sortingOrder = _elite2.sortingOrder = f.Order - 4;
            }
            // ---- signature text cue (right of the bar) -------------------------------------------------------------------------------
            Marks(in f, theme);
            string text = f.Dead ? null : Indicators.MarkCue(f.Sig, f.M.Tax);
            if (text == null) { _cue.gameObject.SetActive(false); _cueBack.enabled = false; _cueText = null; return; }
            if (!ReferenceEquals(_cueText, text)) { _cue.text = text; _cueText = text; }
            _cueBase = Color.white; var tc = _cueBase; tc.a *= _textFade; _cue.color = tc;
            float x = .62f, y = f.BarY + .02f;
            _cue.gameObject.SetActive(true);
            float width = _cue.preferredWidth + .16f, cx = x + width * .5f - .02f;
            _cue.transform.localPosition = new Vector3(cx, y, 0); _cue.GetComponent<MeshRenderer>().sortingOrder = f.Order + 14;
            _cueBack.enabled = true; _cueBack.sortingOrder = f.Order + 13;
            _cueBack.transform.localPosition = new Vector3(cx, y, 0); _cueBack.transform.localScale = new Vector3(width, .25f, 1);
            var pc = (Color)theme.OutlineDark; pc.a = 1f; _cueBack.color = pc;
        }

        /// <summary>Mark plate pips and brand ring (B5), teleport immunity (B7) and the Fire roam glow (B8).</summary>
        void Marks(in OverheadIndicators.Facts f, UiTheme theme)
        {
            var m = f.M; bool alive = !f.Dead;
            // Pips (markPresentation.ts:2): four 5 x 3 px pips, lit up to the tier, the top lit one outlined white.
            int tier = alive ? Mathf.Clamp(m.Tier, 0, 4) : 0;
            for (int i = 0; i < 4; i++)
            {
                var r = _pips[i]; r.enabled = tier > 0; if (tier == 0) continue;
                var c = Rgb(Indicators.TierColours[i]); c.a = i < tier ? 1f : .2f; r.color = c;
                r.transform.localPosition = new Vector3((i - 1.5f) * .22f, f.BarY - .13f, 0); r.transform.localScale = new Vector3(.17f, .1f, 1); r.sortingOrder = f.Order + 9;
            }
            _pipTop.enabled = tier > 0;
            if (tier > 0)
            {
                _pipTop.color = new Color(1, 1, 1, .85f); _pipTop.transform.localPosition = _pips[tier - 1].transform.localPosition;
                _pipTop.transform.localScale = new Vector3(.22f, .15f, 1); _pipTop.sortingOrder = f.Order + 8;
            }
            // Brand (G7): a violet floor ring that fills in as the brand grows to 100 and pulses when full.
            bool brand = alive && m.Brand > 0;
            _brand.enabled = brand;
            if (brand)
            {
                float k = Mathf.Clamp01(m.Brand / 100f), pulse = m.Brand >= 100 && !f.Reduced ? .75f + .25f * Mathf.Sin(Time.unscaledTime * 6f) : 1f;
                var c = Color.white; c.a = (.25f + .6f * k) * pulse; _brand.color = c;
                _brand.transform.localPosition = new Vector3(0, .02f, 0); _brand.transform.localScale = new Vector3(1.9f * RingK, .98f * RingK, 1); _brand.sortingOrder = f.Order - 5;
            }
            // Teleport immunity (PlayerView.ts:290): a 4fc3f7 ring round the fighter.
            bool immune = alive && m.Immune;
            _immune.enabled = immune;
            if (immune)
            {
                float a = f.Reduced ? .9f : .7f + .3f * Mathf.Sin(Time.unscaledTime * 5f);
                _immune.color = new Color(1, 1, 1, a); _immune.transform.localPosition = new Vector3(0, f.HeadY * .45f, 0); _immune.transform.localScale = new Vector3(1.5f, 1.5f * ArenaView.GroundSquash + .5f, 1); _immune.sortingOrder = f.Order + 1;
            }
            // Fire roam ready (PlayerView.ts:309): a pulsing orange double ring.
            bool roam = alive && m.Roam;
            _roam1.enabled = _roam2.enabled = roam;
            if (roam)
            {
                float p = f.Reduced ? 0f : .5f + .5f * Mathf.Sin(Time.unscaledTime * 7f);
                _roam1.color = new Color(1, 1, 1, .55f + .4f * p); _roam2.color = new Color(1, 1, 1, .9f - .4f * p);
                _roam1.transform.localPosition = _roam2.transform.localPosition = new Vector3(0, f.HeadY * .45f, 0);
                _roam1.transform.localScale = Vector3.one * (1.15f + .1f * p) * 1.2f; _roam2.transform.localScale = Vector3.one * (.95f + .1f * p) * 1.2f;
                _roam1.sortingOrder = _roam2.sortingOrder = f.Order + 1;
            }
        }

        /// <summary>The top two stat marks (B2): 18 px dark squares with the stat glyph in its colour, placed after the secondary weapon in the build row.</summary>
        public void StatMarks(in OverheadIndicators.Facts f, float y, float x, float pitch, UiTheme theme)
        {
            byte[] keys = { f.M.Top1, f.M.Top2 };
            for (int i = 0; i < 2; i++)
            {
                bool on = !f.Dead && keys[i] >= 1 && keys[i] <= 9;
                _statEdge[i].enabled = _statBack[i].enabled = _statIcon[i].enabled = on;
                if (!on) continue;
                var key = (StatKey)keys[i]; var col = Rgb(Indicators.StatColour(key)); float size = 17f * .026f; var pos = new Vector3(x + i * pitch, y, 0);
                _statEdge[i].color = col; _statEdge[i].transform.localPosition = pos; _statEdge[i].transform.localScale = new Vector3(size + .05f, size + .05f, 1); _statEdge[i].sortingOrder = f.Order + 10;
                _statBack[i].color = (Color)theme.Surface; _statBack[i].transform.localPosition = pos; _statBack[i].transform.localScale = new Vector3(size, size, 1); _statBack[i].sortingOrder = f.Order + 11;
                _statIcon[i].sprite = IndicatorArt.Get(StatGlyphs[keys[i]]); _statIcon[i].color = col; _statIcon[i].transform.localPosition = pos; _statIcon[i].transform.localScale = Vector3.one * .36f; _statIcon[i].sortingOrder = f.Order + 12;
            }
        }

        static Color Rgb(uint rgb) { return new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f, 1f); }

        /// <summary>The elite star over the name plate (legacy: 5 point star at y -68.2, gold with a dark edge); returns the cursor above it.</summary>
        public float EliteStar(in OverheadIndicators.Facts f, float cursor, UiTheme theme)
        {
            bool on = !f.Dead && f.Elite;
            _star.enabled = on;
            if (!on) return cursor;
            const float size = .3f;
            _star.color = (Color)theme.Accent; _star.sortingOrder = f.Order + 12;
            _star.transform.localPosition = new Vector3(0, cursor + size * .5f, 0); _star.transform.localScale = new Vector3(size, size, 1);
            return cursor + size + .04f;
        }

        static void Place(SpriteRenderer r, Vector3 at, float w, float h, int order)
        {
            r.transform.localPosition = at; r.transform.localScale = new Vector3(w, h, 1); r.sortingOrder = order;
        }

        // ---- generated art -------------------------------------------------------------------------------------------------------------

        static Sprite Disc() { return _disc != null ? _disc : (_disc = Build("Barrier bubble fill", 0f)); }
        static Sprite Band() { return _band != null ? _band : (_band = Build("Barrier bubble band", .045f)); }

        /// <summary>A unit circle texture: a filled disc (band 0) or a ring of the given relative thickness, anti-aliased, white.</summary>
        static Sprite Build(string name, float band)
        {
            const int n = 128;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { name = name, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            var px = new Color32[n * n];
            for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float dx = (x + .5f - n * .5f) / (n * .5f), dy = (y + .5f - n * .5f) / (n * .5f), d = Mathf.Sqrt(dx * dx + dy * dy), edge = 1.5f / (n * .5f);
                    float a = Mathf.Clamp01((.985f - d) / edge);
                    if (band > 0f) a *= Mathf.Clamp01((d - (.985f - band)) / edge);
                    px[y * n + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(255f * a));
                }
            tex.SetPixels32(px); tex.Apply(false, false);
            var s = Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(.5f, .5f), n); s.name = name; return s;
        }
    }
}
