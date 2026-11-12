// The overhead cluster and body marks of one observed actor. Name, Wish icon, mark pips, bounty crown and number and the build row are drawn from
// OverheadStack.Build (the legacy PlayerView/MobView layout) and nothing else; the hp bar is drawn by the presenter from the same layout. Owned by the presenter's pooled Art; every renderer is a
// SpriteRenderer child of the actor root so the vision fade reaches it, and text is faded through ApplyOpacity. No allocation per frame:
// text is rewritten only when its value changes. It shows what the facts say and decides no rule: each fact is a delivered public value.
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    public sealed class OverheadIndicators
    {
        /// <summary>The protocol 16 indicator facts of one fighter (ADR0026), all delivered: its name, the top two stat marks, the Sentenced mark, immunity, roam, engaged.</summary>
        public struct Marks
        {
            public string Name;                   // display name (already "[BOT] name" for bots), null when unknown
            public bool Immune, Roam, Engaged;
            public byte Top1, Top2;               // StatKey codes, 0 none
            public byte Tier, Brand, Tax;         // mark tier 0..4, brand 0..100, tax percent
        }

        public struct Facts
        {
            public int Order;            // the actor's sorting order
            public float HeadY;          // local y of the head top (look height)
            public float BarY;           // local y of the hp bar
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
            public Marks M;                       // the protocol 16 indicator facts
            public byte Sig;                      // signature byte (TAXED / SUPPRESSED / EXEC BLOCKED text cues)
        }

        const float RingK = .86f / .80f; // GroundMarkArt rings sit at .80 of the sprite, the old generic ring at .86
        const float Px = .026f; // legacy px to actor-local units
        readonly SpriteRenderer _hover, _hunt, _wishIcon, _crown, _badgeBack, _badgeEdge, _badgeIcon, _lockOuter, _lockInner, _root, _zone;
        readonly SpriteRenderer[] _glyphs = new SpriteRenderer[Indicators.StatusOrder.Length];
        readonly SpriteRenderer _lockDark;
        readonly TextMeshPro _number, _name;
        readonly OverheadExtras _extras;      // barrier bubble, elite rings and star, signature text cues (OverheadExtras.cs)
        readonly List<StatusAnchor> _anchors = new List<StatusAnchor>();   // this frame's status art spots (StatusAnchors.Build)
        readonly List<OverheadElement> _stack = new List<OverheadElement>();   // this frame's layout (OverheadStack.Build)
        int _bounty = -1; string _nameText;
        float _textFade = 1f;
        Color _numberBase, _nameBase;

        static readonly string[] GlyphKeys = { "shackle", "chain", "cast", "faststand", "dashring", "haste", "slow", "flame", "stun", "silence", "clock", "antiheal" };

        public OverheadIndicators(Transform root)
        {
            _crown = Sprite(root, "Bounty crown", IndicatorArt.Get("crown"), 9);
            _badgeBack = Sprite(root, "Secondary weapon backer", ShowcaseSprites.Get("bar"), 9);
            _badgeEdge = Sprite(root, "Secondary weapon edge", ShowcaseSprites.Get("bar"), 8);
            _badgeIcon = Sprite(root, "Secondary weapon icon", ShowcaseSprites.Get("weapon0"), 10);
            for (int i = 0; i < _glyphs.Length; i++)
            {
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
            _wishIcon = Sprite(root, "Wish icon", IndicatorArt.Get("snow"), 12);
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

        /// <summary>True while the name label is drawn (test-visible; P-UNITY-HUD-VISUAL-FIX-2).</summary>
        /// <summary>Where the name label is anchored, in world units.</summary>
        public Vector3 NameWorldPosition { get { return _name.transform.position; } }
        /// <summary>How wide the drawn name is, in world units.</summary>
        public float NameWorldWidth { get { return _name.preferredWidth * _name.transform.lossyScale.x; } }
        /// <summary>Hides the name for this frame (the pack merge); <see cref="Update"/> shows it again next frame.</summary>
        public void HideName() { _name.gameObject.SetActive(false); }
        public bool NameActive { get { return _name.gameObject.activeSelf; } }

        public void HideAll()
        {
            _hover.enabled = _hunt.enabled = _wishIcon.enabled = _crown.enabled = _badgeBack.enabled = _badgeEdge.enabled = _badgeIcon.enabled = _lockOuter.enabled = _lockInner.enabled = _root.enabled = _zone.enabled = false;
            foreach (var g in _glyphs) g.enabled = false;
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

        static float U(float px) { return OverheadStack.ToUnits(px); }

        public void Update(in Facts f)
        {
            if (f.Dead) { HideAll(); return; }
            var theme = UiTheme.Current;
            _extras.Update(in f, theme);

            // The legacy stack: the layout decides what is drawn and where (y up from the feet in legacy px; dy puts the bar where the presenter draws it).
            string label = f.Mob ? f.Name : f.M.Name;
            bool wantName = !string.IsNullOrEmpty(label);
            if (wantName)
            {
                if (!ReferenceEquals(_nameText, label)) { _name.text = label; _nameText = label; }
                _name.gameObject.SetActive(true);
            }
            else { _name.gameObject.SetActive(false); _nameText = null; }
            var sf = new OverheadFacts
            {
                Kind = f.Elite ? OverheadActorKind.Elite : f.Dummy ? OverheadActorKind.Dummy : f.Mob ? OverheadActorKind.Mob : OverheadActorKind.Player,
                Local = f.Local, HpPct = f.HpPct, Name = label, NameWidthPx = wantName ? _name.preferredWidth / Px : 0f,
                Bounty = f.Bounty, WishState = f.WishState, HasSecondary = f.HasSecondary, Secondary = (byte)f.Secondary,
                Stat1 = f.M.Top1, Stat2 = f.M.Top2, MarkTier = Mathf.Clamp(f.M.Tier, 0, 4),
            };
            OverheadStack.Build(in sf, _stack);
            float dy = f.BarY - U(33.2f), nameTopPx = 35.2f;
            bool haveNumber = false; int stats = 0;
            _crown.enabled = _wishIcon.enabled = _badgeBack.enabled = _badgeEdge.enabled = _badgeIcon.enabled = false;
            _extras.ClearBuildMarks();
            for (int i = 0; i < _stack.Count; i++)
            {
                var e = _stack[i];
                float cx = U(e.X), cy = dy + U(e.Y + e.H * .5f);
                switch (e.Kind)
                {
                    case OverheadKind.Name:
                    {
                        nameTopPx = e.Y + e.H;
                        _nameBase = e.Tone == OverheadTone.NameElite ? (Color)theme.Accent : e.Tone == OverheadTone.NameOwn ? (Color)theme.Success : e.Tone == OverheadTone.NameMob ? (Color)theme.TextSecondary : (Color)theme.TextPrimary;
                        // MobView.ts:26-27,183-186: an idle, full-health, non-elite mob's name is faint (IDLE_LABEL_ALPHA); hurt, fighting, elite and the dummy read full.
                        _nameBase.a = f.Mob && !f.Elite && !f.Dummy && !f.M.Engaged && f.HpPct >= 100f ? .5f : 1f;
                        _name.fontSize = f.Mob && f.Elite ? 2.5f * 12f / 11f : 2.5f;   // MobView.ts:247: 12 px elite, 11 px otherwise
                        var nc = _nameBase; nc.a *= _textFade; _name.color = nc;
                        _name.fontStyle = f.Elite ? FontStyles.Bold : FontStyles.Normal;
                        _name.transform.localPosition = new Vector3(cx, cy, 0);
                        _name.GetComponent<MeshRenderer>().sortingOrder = f.Order + 12;
                        break;
                    }
                    case OverheadKind.WishIcon:
                    {
                        // The local fighter's own Wish left of the name (PlayerView.setWishIcon): the ability glyph in its faction colour when ready, grey while recharging.
                        _wishIcon.enabled = true;
                        _wishIcon.sprite = IndicatorArt.Get(WishGlyph(f.WishAbility));
                        _wishIcon.transform.localPosition = new Vector3(cx, cy, 0); _wishIcon.transform.localScale = new Vector3(U(e.W), U(e.H), 1);
                        _wishIcon.color = e.Tone == OverheadTone.WishReady ? (Color)theme.FactionColor(WishFaction(f.WishAbility)) : (Color)theme.TextSecondary;
                        _wishIcon.sortingOrder = f.Order + 12;
                        break;
                    }
                    case OverheadKind.MarkPips: _extras.Pips(in f, e, cy); break;
                    case OverheadKind.BountyCrown:
                    {
                        float side = U(e.W) * .9f;
                        _crown.enabled = true; _crown.color = (Color)theme.Accent; _crown.sortingOrder = f.Order + 11;
                        _crown.transform.localScale = new Vector3(side, side, 1); _crown.transform.localPosition = new Vector3(cx, cy, 0);
                        break;
                    }
                    case OverheadKind.BountyNumber:
                    {
                        haveNumber = true;
                        if (_bounty != f.Bounty) { _bounty = f.Bounty; _number.text = e.Text; }
                        _numberBase = (Color)theme.Accent; var bc = _numberBase; bc.a *= _textFade; _number.color = bc;
                        _number.gameObject.SetActive(true);
                        _number.transform.localPosition = new Vector3(cx, cy, 0);
                        _number.GetComponent<MeshRenderer>().sortingOrder = f.Order + 12;
                        break;
                    }
                    case OverheadKind.SecondaryWeapon:
                    {
                        float size = U(e.W); var pos = new Vector3(cx, cy, 0);
                        _badgeBack.enabled = _badgeEdge.enabled = _badgeIcon.enabled = true;
                        _badgeEdge.transform.localPosition = pos; _badgeEdge.transform.localScale = new Vector3(size + .05f, size + .05f, 1);
                        _badgeEdge.color = (Color)theme.Border; _badgeEdge.sortingOrder = f.Order + 10;
                        _badgeBack.transform.localPosition = pos; _badgeBack.transform.localScale = new Vector3(size, size, 1);
                        _badgeBack.color = (Color)theme.Surface; _badgeBack.sortingOrder = f.Order + 11;
                        _badgeIcon.sprite = ShowcaseSprites.Get("weapon" + Mathf.Clamp((int)e.Variant, 0, 5));
                        _badgeIcon.transform.localPosition = pos; _badgeIcon.transform.localScale = Vector3.one * ((WeaponId)e.Variant == WeaponId.Fists ? .55f : .62f);
                        _badgeIcon.color = (Color)theme.TextPrimary; _badgeIcon.sortingOrder = f.Order + 12;
                        break;
                    }
                    case OverheadKind.StatMark: _extras.StatMark(in f, stats++, e, cy, theme); break;
                }
            }
            if (!haveNumber) { _number.gameObject.SetActive(false); _bounty = -1; }
            _extras.EliteStar(in f, dy + U(nameTopPx) + .02f, theme);   // the elite star sits just above the name (MobView)

            // Statuses (StatusArt.ts): each delivered effect bit is art at its fixed legacy anchor on the body, in legacy draw order (no badge row,
            // no plates). Anchors are fixed pixels relative to the feet and do not scale with the archetype. Rooted and zoned keep their ground rings.
            var kind = f.Elite ? OverheadActorKind.Elite : f.Dummy ? OverheadActorKind.Dummy : f.Mob ? OverheadActorKind.Mob : OverheadActorKind.Player;
            StatusAnchors.Build(f.Effects, kind, _anchors);
            bool rooted = false, zoned = false;
            for (int i = 0; i < _glyphs.Length; i++) _glyphs[i].enabled = false;
            for (int i = 0; i < _anchors.Count; i++)
            {
                var a = _anchors[i];
                if (a.Kind == StatusKind.Root) { rooted = true; continue; }
                if (a.Kind == StatusKind.Zoned) { zoned = true; continue; }
                var g = _glyphs[(int)a.Kind];
                bool ring = a.Kind == StatusKind.Casting || a.Kind == StatusKind.LastStand || a.Kind == StatusKind.Untargetable;
                // The three concentric body rings are sized from their own envelope (38, 36, 31 px) so they stay distinguishable together; the rest use the capped badge size.
                float side = ring ? U(Mathf.Min(a.W, a.H) * .6f) : U(Mathf.Min(Mathf.Min(a.W, a.H), 16f));   // the existing glyph art is badge-sized: it is centred on the anchor, not stretched to the envelope
                g.enabled = true; g.color = GlyphColour(Indicators.StatusOrder[(int)a.Kind].Bit, theme);
                g.transform.localPosition = new Vector3(U(a.X), dy + U(a.Y + a.H * .5f), -.001f * a.Order);
                g.transform.localScale = new Vector3(side, side, 1);
                g.sortingOrder = f.Order + 9;
            }
            Ground(_root, rooted, f.Order - 5, new Vector2(1.15f, .6f), (Color)theme.TextPrimary, .9f);
            Ground(_zone, zoned, f.Order - 5, new Vector2(1.5f, .78f), (Color)theme.Info, .9f);

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

        static string WishGlyph(byte ability)
        {
            switch ((AbilityId)ability) { case AbilityId.Freeze: return "snow"; case AbilityId.Swarm: return "swarm"; case AbilityId.Trial: return "chain"; case AbilityId.Blaze: return "flame"; default: return "faststand"; }
        }
        static int WishFaction(byte ability)
        {
            switch ((AbilityId)ability) { case AbilityId.Freeze: return (int)FactionId.Frost; case AbilityId.Swarm: return (int)FactionId.Plague; case AbilityId.Trial: return (int)FactionId.Sentenced; case AbilityId.Blaze: return (int)FactionId.Fire; default: return (int)FactionId.Holy; }
        }

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
