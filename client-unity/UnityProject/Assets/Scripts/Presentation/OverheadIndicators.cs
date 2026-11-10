// The overhead cluster and body marks of one observed actor, placed as legacy PlayerView/MobView do (hp bar, then statuses, name, bounty
// crown and number, build row with the secondary weapon) in the settled skin. Owned by the presenter's pooled Art; every renderer is a
// SpriteRenderer child of the actor root so the vision fade reaches it, and text is faded through ApplyOpacity. No allocation per frame:
// text is rewritten only when its value changes. It shows what the facts say and decides no rule: each fact is a delivered public value.
using TMPro;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
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
            public bool Hovered, Hunted;          // the fighter a click would lock (hover ring); the Sentenced hunt target (violet ring)
            public int WishState;                 // the local fighter's own Wish beside the name: 0 none, 1 ready, 2 recharging
            public byte WishAbility;              // AbilityId of that Wish (glyph shape)
            public int BarrierStep;               // barrier ring step 0..8 (the barrier bubble round the body)
            public byte Sig;                      // signature byte (TAXED / SUPPRESSED / EXEC BLOCKED text cues)
        }

        const float RingK = .86f / .80f; // GroundMarkArt rings sit at .80 of the sprite, the old generic ring at .86
        const float Px = .026f; // legacy px to actor-local units
        readonly Transform _t;
        readonly SpriteRenderer _hover, _hunt, _wishBack, _wishIcon, _crown, _badgeBack, _badgeEdge, _badgeIcon, _lockOuter, _lockInner, _root, _zone, _numberBack, _nameBack;
        readonly SpriteRenderer[] _glyphs = new SpriteRenderer[Indicators.StatusOrder.Length];
        readonly SpriteRenderer[] _backs = new SpriteRenderer[Indicators.StatusOrder.Length];
        readonly SpriteRenderer _lockDark;
        readonly TextMeshPro _number, _name;
        readonly OverheadExtras _extras;      // barrier bubble, elite rings and star, signature text cues (OverheadExtras.cs)
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
            for (int i = 0; i < _glyphs.Length; i++)
            {
                _backs[i] = Sprite(root, "Status plate " + GlyphKeys[i], ShowcaseSprites.Get("bar"), 8);
                _glyphs[i] = Sprite(root, "Status " + GlyphKeys[i], IndicatorArt.Get(GlyphKeys[i]), 9);
            }
            var t0 = UiTheme.Current;
            _lockDark = Sprite(root, "Attack lock ring shade", ShowcaseSprites.Get("ring"), -7);
            _lockOuter = Sprite(root, "Attack lock ring", GroundMarkArt.Ring(t0.Danger, true), -6);
            _lockInner = Sprite(root, "Attack lock ring inner", GroundMarkArt.Ring(t0.Danger, false, .016f), -6);
            _hover = Sprite(root, "Hover ring", GroundMarkArt.Ring(t0.TextPrimary, false, .016f), -6);
            _hunt = Sprite(root, "Sentenced hunt ring", GroundMarkArt.Ring(t0.FactionColor((int)FactionId.Sentenced), true), -6);
            _root = Sprite(root, "Rooted ring", GroundMarkArt.Ring(t0.TextPrimary), -5);
            _zone = Sprite(root, "Zoned ring", GroundMarkArt.Ring(t0.Info), -5);
            _wishBack = Sprite(root, "Wish icon plate", ShowcaseSprites.Get("bar"), 11);
            _wishIcon = Sprite(root, "Wish icon", IndicatorArt.Get("snow"), 12);
            _numberBack = Sprite(root, "Bounty number plate", ShowcaseSprites.Get("bar"), 11);
            _nameBack = Sprite(root, "Name plate", ShowcaseSprites.Get("bar"), 11);
            _number = Text(root, "Bounty number", 3.1f, FontStyles.Bold);
            _name = Text(root, "Name", 2.5f, FontStyles.Normal);
            _extras = new OverheadExtras(root);
            HideAll();
        }

        static Material _outlined; static TMP_FontAsset _outlinedFor;
        /// <summary>One shared dark-outlined text material per font (no per-label material instance, so labels batch and nothing leaks).</summary>
        public static Material OutlinedMaterial(TMP_FontAsset font)
        {
            if (_outlined != null && _outlinedFor == font) return _outlined;
            _outlined = new Material(font.material) { name = "Roguehalla / outlined world text" };
            _outlined.EnableKeyword("OUTLINE_ON");
            _outlined.SetFloat(ShaderUtilities.ID_OutlineWidth, .1f);
            // Crisp when magnified (2x display): a harder distance-field edge and no softness on the face or the outline.
            if (_outlined.HasProperty("_Sharpness")) _outlined.SetFloat("_Sharpness", .7f);
            if (_outlined.HasProperty("_OutlineSoftness")) _outlined.SetFloat("_OutlineSoftness", 0f);
            if (_outlined.HasProperty("_FaceDilate")) _outlined.SetFloat("_FaceDilate", .04f);
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

        /// <summary>World rectangle of the shown mob name plate (valid when <see cref="NameShown"/>), for the presenter's overlap pass.</summary>
        public Rect NameRect { get; private set; }
        public bool NameShown => _name.gameObject.activeSelf;
        public bool NameElite { get; private set; }
        /// <summary>Hides this frame's name plate (another creature's plate already occupies the spot). Update shows it again next frame.</summary>
        public void SuppressName() { _name.gameObject.SetActive(false); _nameBack.enabled = false; }

        public void HideAll()
        {
            _hover.enabled = _hunt.enabled = _wishBack.enabled = _wishIcon.enabled = _crown.enabled = _badgeBack.enabled = _badgeEdge.enabled = _badgeIcon.enabled = _lockOuter.enabled = _lockInner.enabled = _root.enabled = _zone.enabled = _numberBack.enabled = _nameBack.enabled = false;
            foreach (var g in _glyphs) g.enabled = false;
            foreach (var b in _backs) b.enabled = false;
            _lockDark.enabled = false;
            _number.gameObject.SetActive(false); _name.gameObject.SetActive(false);
            _bounty = -1; _nameText = null; _textFade = 1f;
            if (_extras != null) _extras.HideAll();
        }

        /// <summary>Vision fade for text, which is not a SpriteRenderer: scales the alpha written by Update.</summary>
        public void ApplyOpacity(float alpha)
        {
            _textFade = alpha; _extras.ApplyOpacity(alpha);
            if (_number.gameObject.activeSelf) { var c = _numberBase; c.a *= alpha; _number.color = c; }
            if (_name.gameObject.activeSelf) { var c = _nameBase; c.a *= alpha; _name.color = c; }
        }

        public void Update(in Facts f)
        {
            if (f.Dead) { HideAll(); return; }
            var theme = UiTheme.Current;
            float cursor = f.SigTopY + .08f;
            _extras.Update(in f, theme);

            // Statuses: ground rings at the feet, glyph badges in one row above the bar in legacy draw order.
            int n = Indicators.StatusLayers(f.Effects, _layers);
            bool rooted = false, zoned = false; int shown = 0;
            for (int i = 0; i < _glyphs.Length; i++) { _glyphs[i].enabled = false; _backs[i].enabled = false; }
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
                var back = _backs[idx]; back.enabled = true; back.sortingOrder = f.Order + 8;
                back.transform.localPosition = g.transform.localPosition; back.transform.localScale = new Vector3(.33f, .33f, 1);
                var bc = (Color)theme.OutlineDark; bc.a = 1f; back.color = bc;
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
                float k = _t.lossyScale.x; float w = (_name.preferredWidth + .14f) * k, h = .27f * k;
                NameRect = new Rect(_t.position.x - w * .5f, _t.position.y + (cursor + .16f) * k - h * .5f, w, h); NameElite = f.Elite;
                cursor += .36f;
            }
            else { _name.gameObject.SetActive(false); _nameBack.enabled = false; }
            cursor = _extras.EliteStar(in f, cursor, theme);

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
                _number.transform.localPosition = new Vector3(0, cursor + 22f * Px * s + .04f, 0);
                _number.GetComponent<MeshRenderer>().sortingOrder = f.Order + 12;
                Plate(_numberBack, new Vector3(0, cursor + 22f * Px * s + .04f, 0), _number.preferredWidth + .14f, .3f, f.Order + 11, theme);
                cursor += 22f * Px * s + .44f;
            }
            else { _number.gameObject.SetActive(false); _numberBack.enabled = false; _bounty = -1; }

            // The local fighter's own Wish beside the name plate (legacy PlayerView.setWishIcon): a 15 px ability glyph, in the faction colour
            // when ready and grey while recharging, on the dark plate. Remote Wish state is not delivered, so nothing is drawn for others.
            bool wish = f.Local && f.WishState != 0;
            _wishBack.enabled = _wishIcon.enabled = wish;
            if (wish)
            {
                float size = 15f * Px + .06f, y = cursor + size * .5f;
                var pos = new Vector3(0, y, 0);
                _wishBack.transform.localPosition = pos; _wishBack.transform.localScale = new Vector3(size + .06f, size + .06f, 1);
                var wc = (Color)theme.OutlineDark; wc.a = 1f; _wishBack.color = wc; _wishBack.sortingOrder = f.Order + 11;
                _wishIcon.sprite = IndicatorArt.Get(WishGlyph(f.WishAbility));
                _wishIcon.transform.localPosition = pos; _wishIcon.transform.localScale = new Vector3(size, size, 1);
                _wishIcon.color = f.WishState == 1 ? (Color)theme.FactionColor(WishFaction(f.WishAbility)) : (Color)theme.TextSecondary; _wishIcon.sortingOrder = f.Order + 12;
                cursor += size + .08f;
            }

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

            // The attack lock: a red double ring on the ground under the locked fighter, breathing slowly (legacy TargetRings). The hairline
            // edges are in the ring art, so the ring reads on any ground without getting brighter.
            _lockOuter.enabled = _lockInner.enabled = f.Locked; _lockDark.enabled = false;
            if (f.Locked)
            {
                float breathe = f.Reduced ? 1f : 1f + .035f * Mathf.Sin(Time.unscaledTime * 2f * Mathf.PI / 1.7f);
                _lockOuter.color = Color.white; var ic = Color.white; ic.a = .75f; _lockInner.color = ic;
                _lockOuter.transform.localScale = new Vector3(1.55f * breathe * RingK, .8f * breathe * RingK, 1); _lockInner.transform.localScale = new Vector3(1.2f * breathe * RingK, .62f * breathe * RingK, 1);
                _lockOuter.sortingOrder = _lockInner.sortingOrder = f.Order - 6;
            }
            // Hover ring: the fighter a click would lock right now (not drawn over the lock ring); hunt ring: the Sentenced hunt target.
            bool hover = f.Hovered && !f.Locked && !f.Local;
            _hover.enabled = hover;
            if (hover) { _hover.color = new Color(1, 1, 1, .9f); _hover.transform.localScale = new Vector3(1.4f * RingK, .72f * RingK, 1); _hover.sortingOrder = f.Order - 6; }
            _hunt.enabled = f.Hunted && !f.Local;
            if (_hunt.enabled)
            {
                float breathe = f.Reduced ? 1f : 1f + .03f * Mathf.Sin(Time.unscaledTime * 2f * Mathf.PI / 1.7f);
                _hunt.color = Color.white; _hunt.sortingOrder = f.Order - 6;
                _hunt.transform.localScale = new Vector3(1.7f * breathe * RingK, .86f * breathe * RingK, 1);
            }
        }

        static void Plate(SpriteRenderer r, Vector3 at, float w, float h, int order, UiTheme theme)
        {
            r.enabled = true; r.sortingOrder = order; r.transform.localPosition = at; r.transform.localScale = new Vector3(w, h, 1);
            var c = (Color)theme.OutlineDark; c.a = 1f; r.color = c;
        }

        static string WishGlyph(byte ability)
        {
            switch ((AbilityId)ability) { case AbilityId.Freeze: return "snow"; case AbilityId.Swarm: return "swarm"; case AbilityId.Trial: return "chain"; case AbilityId.Blaze: return "flame"; default: return "faststand"; }
        }
        static int WishFaction(byte ability)
        {
            switch ((AbilityId)ability) { case AbilityId.Freeze: return (int)FactionId.Frost; case AbilityId.Swarm: return (int)FactionId.Plague; case AbilityId.Trial: return (int)FactionId.Sentenced; case AbilityId.Blaze: return (int)FactionId.Fire; default: return (int)FactionId.Holy; }
        }

        static int IndexOfBit(ushort bit) { for (int i = 0; i < Indicators.StatusOrder.Length; i++) if (Indicators.StatusOrder[i].Bit == bit) return i; return 0; }

        void Ground(SpriteRenderer r, bool on, int order, Vector2 size, Color color, float alpha)
        {
            r.enabled = on; if (!on) return;
            color = Color.white; color.a = alpha; r.color = color; r.sortingOrder = order; r.transform.localScale = new Vector3(size.x * RingK, size.y * RingK, 1);
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
