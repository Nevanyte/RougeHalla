// The overhead cluster and body marks of one observed actor, placed as legacy PlayerView/MobView do (hp bar, then statuses, name, bounty
// crown and number, build row with the secondary weapon) in the settled skin. Owned by the presenter's pooled Art; every renderer is a
// SpriteRenderer child of the actor root so the vision fade reaches it, and text is faded through ApplyOpacity. No allocation per frame:
// text is rewritten only when its value changes. It shows what the facts say and decides no rule: each fact is a delivered public value.
using TMPro;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    public sealed class OverheadIndicators
    {
        public struct Facts
        {
            public int Order;            // the actor's sorting order
            public float HeadY;          // local y of the head top (look height)
            public float BarY;           // local y of the hp bar
            public float SigTopY;        // local y just above the signature icons row, or BarY if none shown
            public bool Dead, Local, Mob, Elite, Dummy;
            public float HpPct;
            public int Bounty;
            public bool HasSecondary; public WeaponId Secondary;
            public bool Locked;
            public ushort Effects;
            public string Name;
            public bool Reduced;
        }

        const float Px = .026f; // legacy px to actor-local units
        readonly Transform _t;
        readonly SpriteRenderer _crown, _badgeBack, _badgeEdge, _badgeIcon, _lockOuter, _lockInner, _root, _zone, _numberBack, _nameBack;
        readonly SpriteRenderer[] _glyphs = new SpriteRenderer[Indicators.StatusOrder.Length];
        readonly TextMeshPro _number, _name;
        readonly Indicators.StatusLayer[] _layers = new Indicators.StatusLayer[Indicators.StatusOrder.Length];
        int _bounty = -1; string _nameText;
        float _textFade = 1f;
        Color _numberBase, _nameBase;

        static readonly string[] GlyphKeys = { "shackle", "chain", "cast", "faststand", "dashring", "haste", "slow", "flame", "stun", "silence", "clock", "antiheal" };

        public OverheadIndicators(Transform root)
        {
            _t = root;
            _crown = Sprite(root, "Bounty crown", IndicatorArt.Get("crown"), 9);
            _badgeBack = Sprite(root, "Secondary weapon backer", ShowcaseSprites.Get("bar"), 9);
            _badgeEdge = Sprite(root, "Secondary weapon edge", ShowcaseSprites.Get("bar"), 8);
            _badgeIcon = Sprite(root, "Secondary weapon icon", ShowcaseSprites.Get("weapon0"), 10);
            for (int i = 0; i < _glyphs.Length; i++) _glyphs[i] = Sprite(root, "Status " + GlyphKeys[i], IndicatorArt.Get(GlyphKeys[i]), 9);
            _lockOuter = Sprite(root, "Attack lock ring", ShowcaseSprites.Get("ring"), -6);
            _lockInner = Sprite(root, "Attack lock ring inner", ShowcaseSprites.Get("ring"), -6);
            _root = Sprite(root, "Rooted ring", ShowcaseSprites.Get("ring"), -5);
            _zone = Sprite(root, "Zoned ring", ShowcaseSprites.Get("ring"), -5);
            _numberBack = Sprite(root, "Bounty number plate", ShowcaseSprites.Get("bar"), 11);
            _nameBack = Sprite(root, "Name plate", ShowcaseSprites.Get("bar"), 11);
            _number = Text(root, "Bounty number", 2.6f, FontStyles.Bold);
            _name = Text(root, "Name", 2.3f, FontStyles.Normal);
            HideAll();
        }

        static Material _outlined; static TMP_FontAsset _outlinedFor;
        /// <summary>One shared dark-outlined text material per font (no per-label material instance, so labels batch and nothing leaks).</summary>
        public static Material OutlinedMaterial(TMP_FontAsset font)
        {
            if (_outlined != null && _outlinedFor == font) return _outlined;
            _outlined = new Material(font.material) { name = "Roguehalla / outlined world text" };
            _outlined.EnableKeyword("OUTLINE_ON");
            _outlined.SetFloat(ShaderUtilities.ID_OutlineWidth, .24f);
            _outlined.SetColor(ShaderUtilities.ID_OutlineColor, (Color)UiTheme.Current.OutlineDark);
            _outlinedFor = font;
            return _outlined;
        }

        static SpriteRenderer Sprite(Transform parent, string name, Sprite sprite, int order)
        {
            var r = ShowcaseSprites.Create(parent, name, "bar", order, Color.white, Vector2.one, Vector3.zero, false);
            r.sprite = sprite; r.enabled = false; return r;
        }

        static TextMeshPro Text(Transform parent, string name, float size, FontStyles style)
        {
            var go = new GameObject(name); go.transform.SetParent(parent, false);
            var t = go.AddComponent<TextMeshPro>();
            var font = Resources.Load<TMP_FontAsset>("Showcase/NunitoBold");
            t.font = font != null ? font : TMP_Settings.defaultFontAsset;
            t.fontSize = size; t.fontStyle = style; t.alignment = TextAlignmentOptions.Center; t.enableWordWrapping = false;
            t.rectTransform.sizeDelta = new Vector2(4f, .5f); t.fontSharedMaterial = OutlinedMaterial(t.font);
            t.GetComponent<MeshRenderer>().sortingOrder = 30;
            go.SetActive(false);
            return t;
        }

        public void HideAll()
        {
            _crown.enabled = _badgeBack.enabled = _badgeEdge.enabled = _badgeIcon.enabled = _lockOuter.enabled = _lockInner.enabled = _root.enabled = _zone.enabled = _numberBack.enabled = _nameBack.enabled = false;
            foreach (var g in _glyphs) g.enabled = false;
            _number.gameObject.SetActive(false); _name.gameObject.SetActive(false);
            _bounty = -1; _nameText = null; _textFade = 1f;
        }

        /// <summary>Vision fade for text, which is not a SpriteRenderer: scales the alpha written by Update.</summary>
        public void ApplyOpacity(float alpha)
        {
            _textFade = alpha;
            if (_number.gameObject.activeSelf) { var c = _numberBase; c.a *= alpha; _number.color = c; }
            if (_name.gameObject.activeSelf) { var c = _nameBase; c.a *= alpha; _name.color = c; }
        }

        public void Update(in Facts f)
        {
            if (f.Dead) { HideAll(); return; }
            var theme = UiTheme.Current;
            float cursor = f.SigTopY + .08f;

            // Statuses: ground rings at the feet, glyph badges in one row above the bar in legacy draw order.
            int n = Indicators.StatusLayers(f.Effects, _layers);
            bool rooted = false, zoned = false; int shown = 0;
            for (int i = 0; i < _glyphs.Length; i++) _glyphs[i].enabled = false;
            for (int i = 0; i < n; i++)
            {
                ushort bit = _layers[i].Bit;
                if (bit == Indicators.Rooted) { rooted = true; continue; }
                if (bit == Indicators.Zoned) { zoned = true; continue; }
                shown++;
            }
            float rowW = shown * .34f, x0 = -rowW * .5f + .17f, rowY = f.BarY + .26f;
            int slot = 0;
            for (int i = 0; i < n; i++)
            {
                ushort bit = _layers[i].Bit;
                if (bit == Indicators.Rooted || bit == Indicators.Zoned) continue;
                int idx = IndexOfBit(bit);
                var g = _glyphs[idx];
                g.enabled = true; g.color = GlyphColour(bit, theme);
                g.transform.localPosition = new Vector3(x0 + slot * .34f, rowY, 0);
                g.transform.localScale = new Vector3(.3f, .3f, 1);
                g.sortingOrder = f.Order + 9;
                slot++;
            }
            if (shown > 0) cursor = Mathf.Max(cursor, rowY + .22f);
            Ground(_root, rooted, f.Order - 5, new Vector2(1.15f, .6f), (Color)theme.TextPrimary, .9f);
            Ground(_zone, zoned, f.Order - 5, new Vector2(1.5f, .78f), (Color)theme.Info, .9f);

            // Mob name (legacy 11 px grey, faint while calm; elite gold and bold).
            bool wantName = f.Mob && !string.IsNullOrEmpty(f.Name);
            if (wantName)
            {
                if (!ReferenceEquals(_nameText, f.Name)) { _name.text = f.Name; _nameText = f.Name; }
                _nameBase = f.Elite ? (Color)theme.Accent : (Color)theme.TextSecondary;
                _nameBase.a = 1f; // hierarchy by colour, not faintness: the plate keeps every name above 4.5:1
                var c = _nameBase; c.a *= _textFade; _name.color = c;
                _name.fontStyle = f.Elite ? FontStyles.Bold : FontStyles.Normal;
                _name.gameObject.SetActive(true);
                _name.transform.localPosition = new Vector3(0, cursor + .14f, 0);
                _name.GetComponent<MeshRenderer>().sortingOrder = f.Order + 12;
                Plate(_nameBack, new Vector3(0, cursor + .14f + .02f, 0), _name.preferredWidth + .14f, .27f, f.Order + 11, theme);
                cursor += .36f;
            }
            else { _name.gameObject.SetActive(false); _nameBack.enabled = false; }

            // Bounty crown and number, scaled with the bounty (legacy 1x to 1.5x at 150).
            bool crown = Indicators.CrownVisible(f.Bounty, true);
            _crown.enabled = crown;
            if (crown)
            {
                float s = Indicators.CrownScale(f.Bounty);
                _crown.color = (Color)theme.Accent; _crown.sortingOrder = f.Order + 11;
                _crown.transform.localScale = new Vector3(22f * Px * s * .9f, 22f * Px * s * .9f, 1);
                _crown.transform.localPosition = new Vector3(0, cursor + 11f * Px * s, 0);
                if (_bounty != f.Bounty) { _bounty = f.Bounty; _number.text = f.Bounty.ToString(System.Globalization.CultureInfo.InvariantCulture); }
                _numberBase = (Color)theme.Accent; var c = _numberBase; c.a *= _textFade; _number.color = c;
                _number.gameObject.SetActive(true);
                _number.transform.localPosition = new Vector3(0, cursor + 22f * Px * s + .02f, 0);
                _number.GetComponent<MeshRenderer>().sortingOrder = f.Order + 12;
                Plate(_numberBack, new Vector3(0, cursor + 22f * Px * s + .02f + .13f, 0), _number.preferredWidth + .12f, .24f, f.Order + 11, theme);
                cursor += 22f * Px * s + .3f;
            }
            else { _number.gameObject.SetActive(false); _numberBack.enabled = false; _bounty = -1; }

            // Build row: the secondary weapon (the slot not in hand; fists when empty).
            bool badge = f.HasSecondary;
            _badgeBack.enabled = _badgeEdge.enabled = _badgeIcon.enabled = badge;
            if (badge)
            {
                float size = 17f * Px, y = cursor + size * .5f;
                var pos = new Vector3(0, y, 0);
                _badgeEdge.transform.localPosition = pos; _badgeEdge.transform.localScale = new Vector3(size + .05f, size + .05f, 1);
                _badgeEdge.color = (Color)theme.Border; _badgeEdge.sortingOrder = f.Order + 10;
                _badgeBack.transform.localPosition = pos; _badgeBack.transform.localScale = new Vector3(size, size, 1);
                _badgeBack.color = (Color)theme.Surface; _badgeBack.sortingOrder = f.Order + 11;
                _badgeIcon.sprite = ShowcaseSprites.Get("weapon" + Mathf.Clamp((int)f.Secondary, 0, 5));
                _badgeIcon.transform.localPosition = pos; _badgeIcon.transform.localScale = Vector3.one * (f.Secondary == WeaponId.Fists ? .55f : .62f);
                _badgeIcon.color = (Color)theme.TextPrimary; _badgeIcon.sortingOrder = f.Order + 12;
            }

            // The attack lock: a red double ring on the ground under the locked fighter, breathing slowly.
            _lockOuter.enabled = _lockInner.enabled = f.Locked;
            if (f.Locked)
            {
                float breathe = f.Reduced ? 1f : 1f + .035f * Mathf.Sin(Time.unscaledTime * 2f * Mathf.PI / 1.7f);
                _lockOuter.color = (Color)theme.Danger; _lockInner.color = new Color(theme.Danger.r / 255f, theme.Danger.g / 255f, theme.Danger.b / 255f, .75f);
                _lockOuter.transform.localScale = new Vector3(1.55f * breathe, .8f * breathe, 1); _lockInner.transform.localScale = new Vector3(1.2f * breathe, .62f * breathe, 1);
                _lockOuter.sortingOrder = _lockInner.sortingOrder = f.Order - 6;
            }
        }

        static void Plate(SpriteRenderer r, Vector3 at, float w, float h, int order, UiTheme theme)
        {
            r.enabled = true; r.sortingOrder = order; r.transform.localPosition = at; r.transform.localScale = new Vector3(w, h, 1);
            var c = (Color)theme.OutlineDark; c.a = .78f; r.color = c;
        }

        static int IndexOfBit(ushort bit) { for (int i = 0; i < Indicators.StatusOrder.Length; i++) if (Indicators.StatusOrder[i].Bit == bit) return i; return 0; }

        void Ground(SpriteRenderer r, bool on, int order, Vector2 size, Color color, float alpha)
        {
            r.enabled = on; if (!on) return;
            color.a = alpha; r.color = color; r.sortingOrder = order; r.transform.localScale = new Vector3(size.x, size.y, 1);
            r.transform.localPosition = new Vector3(0, .02f, 0);
        }

        static Color GlyphColour(ushort bit, UiTheme t)
        {
            switch (bit)
            {
                case Indicators.Stunned: case Indicators.LastStand: return (Color)t.Accent;
                case Indicators.Haste: return (Color)t.Success;
                case Indicators.Slowed: case Indicators.AttackSlowed: case Indicators.Casting: return (Color)t.Info;
                case Indicators.Dot: case Indicators.AntiHeal: return (Color)t.Danger;
                default: return (Color)t.TextPrimary;
            }
        }
    }
}
