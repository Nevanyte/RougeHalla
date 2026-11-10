using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    /// <summary>Owned visual objects keyed only by currently supplied observer handles. Nothing here simulates a rule.</summary>
    public sealed partial class SpriteActorPresenter
    {
        sealed class Art
        {
            public GameObject Root;
            public SpriteRenderer Body, BodyRim, BodyGlow, Shadow, Halo, RuneBack, Rune, Hp, HpBack, Barrier, Weapon, Status;
            public ShowcaseIdentityOwner Identity;
            public SpriteRenderer[] BarrierRing;
            public SpriteRenderer[] StatusIcons;
            public SpriteRenderer[] SignatureIcons;
            public SpriteRenderer[] SignatureBackers;
            public SpriteRenderer UnknownSignature, UnknownSignatureBacker;
            public ShowcasePointLight Light;
            public ShowcaseCatalog.Appearance Appearance;
            public Vector3 LastPosition;
            public float AttackUntil;
            public GaitState Gait;
            public float StampTime;
            public bool LocalCue;
            public float AttackAt, HitAt, BlockAt, DeadAt, HitUntil, BlockUntil;
            public float WishAt, WishUntil; public byte WishClip;
            public Color WishTint; public float WishTintAmount;
            public bool Dead, HoldDeathFrame;
            public WeaponId? WeaponId;
            public FactionId? Faction;
            public ActorKind Kind;
            public MobTypeId? MobType;
            public int Stamp;
            public readonly ActorFadeSlot Fade = new ActorFadeSlot(); // vision fade state (SpriteActorPresenter.Fade.cs)
            public OverheadIndicators Ind; // overhead cluster and body marks (OverheadIndicators.cs)
            public OverheadIndicators.Facts IndFacts;
            public MobLook Look; // what a creature looked like when last presented (MobContinuity)
        }
        readonly Transform _parent;
        public SurfaceFx Fx; // SURFACE-FX HOOK: set by the owning ArenaView, so cues go to the arena that presents
        readonly Dictionary<uint, Art> _active = new Dictionary<uint, Art>();
        readonly Stack<Art> _pool = new Stack<Art>();
        readonly List<uint> _remove = new List<uint>();
        readonly ShowcaseCatalog _catalog;
        int _stamp;
        const float ActorVisualScale = 1.2f;
        /// <summary>The faction footprint outline sits at this fraction of the sprite's half-size (FactionIndicators textures).</summary>
        const float FootprintOutline = .72f;
        const byte KnownSignatureMask = 1 | 2 | 4 | 8 | 16 | 32 | 64; // 16 (taxed) and 32 (suppressed) are named by text cues (OverheadExtras), not icons
        static readonly byte[] SignatureBits = { 1, 2, 4, 8, 64 };
        static readonly string[] SignatureSpriteKeys = { "sigil3", "spark", "sigil2", "weapon0", "sigil4" };
        // Legacy SignatureArt colours: icy e1f5fe, burning ff7043, diseased b2d96c, execute c6ff00, exec-blocked pale grey; glyphs from IndicatorArt.
        static readonly Color[] SignatureColors =
        {
            new Color32(0xe1, 0xf5, 0xfe, 255), new Color32(0xff, 0x70, 0x43, 255), new Color32(0xb2, 0xd9, 0x6c, 255), new Color32(0xc6, 0xff, 0x00, 255), new Color32(0xcf, 0xd8, 0xdc, 255)
        };
        static readonly string[] SignatureGlyphs = { "snow", "flame", "droplet", "skull", "skull" };
        const int UnknownSignatureSlot = 5;

        public SpriteActorPresenter(Transform parent, ShowcaseCatalog catalog) { _parent = parent; _catalog = catalog; }
        public bool Contains(uint id) { return _active.ContainsKey(id); }
        public int ActiveCount { get { return _active.Count; } }
        public bool IsLiving(uint id) { return _active.TryGetValue(id, out var art) && !art.Dead; }
        public bool TrySoundContext(uint id, out WeaponId weapon, out FactionId faction, out ActorKind kind, out MobTypeId? type)
        {
            if (_active.TryGetValue(id, out var art) && art.WeaponId.HasValue && art.Faction.HasValue)
            { weapon=art.WeaponId.Value; faction=art.Faction.Value; kind=art.Kind; type=art.MobType; return true; }
            weapon=default; faction=default; kind=default; type=null; return false;
        }
        /// <summary>Clears local-time animation phases after a presentation clock cut.</summary>
        public void ResetTransientTimers()
        {
            foreach (var pair in _active)
            {
                var a = pair.Value;
                a.AttackUntil = a.HitUntil = a.BlockUntil = 0; a.WishUntil = 0;
                a.Gait.Reset();
                a.AttackAt = a.HitAt = a.BlockAt = a.DeadAt = 0;
                a.LocalCue = false;
                a.HoldDeathFrame = a.Dead;
            }
        }
        public bool TryPosition(uint id, out Vector3 position)
        {
            if (_active.TryGetValue(id, out var art)) { position = art.Root.transform.position; return true; }
            position = default; return false;
        }
        /// <summary>
        /// Cosmetic swing at the moment of the owner's click, before the server answers. It carries no rule: hit, damage and
        /// cooldown come only from the server. The clip simply ends if the server never confirms; the first confirmed swing
        /// within <see cref="LocalCueWindow"/> adopts it instead of restarting it.
        /// </summary>
        public void LocalAttackCue(uint id)
        {
            if (!_active.TryGetValue(id, out var art) || art.Dead || !art.WeaponId.HasValue) return;
            float now = Time.unscaledTime;
            if (art.AttackUntil > now && !art.LocalCue) return; // a confirmed swing is already playing
            art.AttackAt = now; art.LocalCue = true;
            art.AttackUntil = now + ClipDuration(AttackFrames(art.Appearance, art.WeaponId.Value, out float fps), fps, .32f);
        }
        const float LocalCueWindow = .6f;
        public void ConfirmedCue(uint id, FxKind kind)
        {
            if (!_active.TryGetValue(id,out var art)) return;
            float now=Time.unscaledTime;
            if(kind==FxKind.Swing && art.WeaponId.HasValue)
            {
                if(art.LocalCue && now-art.AttackAt<LocalCueWindow) { art.LocalCue=false; return; }
                art.LocalCue=false;
                art.AttackAt=now;
                var clip=AttackFrames(art.Appearance,art.WeaponId.Value,out float fps);
                art.AttackUntil=now+ClipDuration(clip,fps,.32f);
            }
            else if(kind==FxKind.Hit || kind==FxKind.Stagger)
            {
                art.HitAt=now;art.HitUntil=now+ClipDuration(art.Appearance?.Hit,art.Appearance!=null ? art.Appearance.HitFPS : 10,.2f);
            }
            else if(kind==FxKind.Block)
            {
                art.BlockAt=now;art.BlockUntil=now+ClipDuration(art.Appearance?.Block,art.Appearance!=null ? art.Appearance.BlockFPS : 10,.2f);
            }
        }
        /// <summary>
        /// Plays the character clip that fits a delivered Wish cue on an observed actor: Cast for Freeze, Swarm and Trial, Attack
        /// for Blaze Step, Block for Last Stand (each falling back to another clip when the character lacks it).
        /// Presentation only; the cue was confirmed by the server's Wish fx record.
        /// </summary>
        public bool WishCue(uint id, AbilityId ability)
        {
            if (!_active.TryGetValue(id, out var art) || art.Dead) return false;
            byte clip = ability == AbilityId.Blaze ? (byte)1 : ability == AbilityId.LastStand ? (byte)2 : (byte)0;
            Sprite[] frames; float fps; WishFrames(art.Appearance, clip, out frames, out fps);
            float now = Time.unscaledTime;
            art.WishClip = clip; art.WishAt = now; art.WishUntil = now + ClipDuration(frames, fps, .4f);
            return true;
        }
        static void WishFrames(ShowcaseCatalog.Appearance a, byte clip, out Sprite[] frames, out float fps)
        {
            frames = null; fps = 10;
            if (a == null) return;
            if (clip == 2 && a.Block != null && a.Block.Length > 0) { frames = a.Block; fps = a.BlockFPS; return; }
            if (clip == 1 && a.Attack != null && a.Attack.Length > 0) { frames = a.Attack; fps = a.AttackFPS; return; }
            if (a.Cast != null && a.Cast.Length > 0) { frames = a.Cast; fps = a.CastFPS; return; }
            if (a.Attack != null && a.Attack.Length > 0) { frames = a.Attack; fps = a.AttackFPS; return; }
            if (a.Block != null && a.Block.Length > 0) { frames = a.Block; fps = a.BlockFPS; }
        }
        /// <summary>Tints an observed actor's body toward <paramref name="tint"/> for the status it shows. Cleared by <see cref="ClearWishTints"/>.</summary>
        public void SetWishTint(uint id, Color tint, float amount)
        {
            if (_active.TryGetValue(id, out var art)) { art.WishTint = tint; art.WishTintAmount = Mathf.Clamp01(amount); }
        }
        public void ClearWishTints() { foreach (var pair in _active) pair.Value.WishTintAmount = 0f; }
        static float ClipDuration(Sprite[] clip,float fps,float fallback)
        { return clip!=null && clip.Length>0 ? clip.Length/8f/Mathf.Max(1,fps) : fallback; }
        static bool WishClipFrames(ShowcaseCatalog.Appearance a, byte clip, out Sprite[] frames, out float fps)
        { WishFrames(a, clip, out frames, out fps); return frames != null && frames.Length > 0; }
        static Sprite[] AttackFrames(ShowcaseCatalog.Appearance a,WeaponId weapon,out float fps)
        {
            fps=a!=null ? a.AttackFPS : 10;
            if(a==null) return null;
            if(weapon==WeaponId.Bow && a.Shoot!=null && a.Shoot.Length>0) {fps=a.ShootFPS;return a.Shoot;}
            if(weapon==WeaponId.Wand && a.Cast!=null && a.Cast.Length>0) {fps=a.CastFPS;return a.Cast;}
            return a.Attack;
        }
        public void Begin() { _stamp++; }
        public void End()
        {
            _remove.Clear(); foreach (var pair in _active) if (pair.Value.Stamp != _stamp) _remove.Add(pair.Key);
            foreach (uint id in _remove)
            {
                Evict(id);
            }
            SuppressOverlappingNames();
        }
        // Creature names of a tight camp overprint each other ("Miasma WitchMiasma Witch"): the plate of the creature in front (lower on
        // screen) and any elite's keeps its place, a plate that would cover a kept one is hidden for the frame.
        readonly List<Art> _nameOrder = new List<Art>();
        void SuppressOverlappingNames()
        {
            _nameOrder.Clear();
            foreach (var pair in _active) { var ind = pair.Value.Ind; if (ind != null && ind.NameShown) _nameOrder.Add(pair.Value); }
            if (_nameOrder.Count < 2) return;
            _nameOrder.Sort((a, b) =>
            {
                int e = b.Ind.NameElite.CompareTo(a.Ind.NameElite); if (e != 0) return e;
                return a.Ind.NameRect.center.y.CompareTo(b.Ind.NameRect.center.y); // lower y (more negative, further down the screen) first
            });
            for (int i = 1; i < _nameOrder.Count; i++)
                for (int j = 0; j < i; j++)
                    if (_nameOrder[j].Ind.NameShown && _nameOrder[j].Ind.NameRect.Overlaps(_nameOrder[i].Ind.NameRect)) { _nameOrder[i].Ind.SuppressName(); break; }
        }
        public void Retain(HashSet<uint> membership)
        {
            _remove.Clear(); foreach(var pair in _active) if(!membership.Contains(pair.Key)) _remove.Add(pair.Key);
            foreach(uint id in _remove) Evict(id);
        }
        void Evict(uint id)
        {
            var art=_active[id];
            if (TryBeginExit(id, art)) return; // a living actor that left sight fades out (SpriteActorPresenter.Fade.cs)
            _active.Remove(id); Release(art);
        }
        void Release(Art art)
        {
            if (IsCreature(art.Fade.Kind)) MobArt.Destroyed++;
            art.Light.SetVisible(false);
            foreach (var icon in art.SignatureIcons) icon.enabled = false;
            foreach (var backing in art.SignatureBackers) backing.enabled = false;
            art.Barrier.enabled = false;
            art.Ind.HideAll();
            foreach (var segment in art.BarrierRing) segment.enabled = false;
            art.UnknownSignature.enabled = false;
            art.UnknownSignatureBacker.enabled = false;
            art.Identity.Clear();
            art.Root.SetActive(false);
            _pool.Push(art);
        }

        public void Present(uint id, float x, float y, float facing, float hp, FactionId? faction, ActorStatus status, WeaponId? weapon,
            ActorKind kind, MobTypeId? mob, ushort effects, byte signature, bool local, float barrierPct = 0f, byte barrierRingStep = 0, string archetypeKey = null, float footHx = 0f, float footHy = 0f)
        {
            if (!_active.TryGetValue(id, out var a))
            {
                if (!local && IsCreature(kind) && TryContinue(id, kind, faction, mob, archetypeKey, x, y, out a)) _active.Add(id, a); // a renewed handle
                else
                {
                    a = _pool.Count > 0 ? _pool.Pop() : Create(); _active.Add(id, a);
                    a.Root.SetActive(true); a.LastPosition = ArenaView.WorldPoint(x, y); a.AttackUntil = 0;
                    a.Gait.Reset(); a.StampTime = Time.unscaledTime;
                    a.HitUntil=a.BlockUntil=0;a.Dead=false;a.HoldDeathFrame=false;a.WishUntil=0;a.WishTintAmount=0;
                    if (IsCreature(kind)) MobArt.Created++;
                    BeginEnter(a, local, kind);
                }
            }
            if (IsCreature(kind)) a.Look = LookOf(kind, faction, mob, archetypeKey);
            a.Stamp = _stamp; a.Fade.Note(id, local, status, kind);
            var position = ArenaView.WorldPoint(x, y);
            // Gait reads displacement only (presentation). Present can run twice in a frame for NPCs: a zero-dt call leaves
            // LastPosition alone so the next real frame still sees the whole displacement.
            float gaitNow = Time.unscaledTime, gaitDt = gaitNow - a.StampTime;
            if (gaitDt > 1e-4f)
            {
                float dxs = (position.x - a.LastPosition.x) / ArenaView.Scale;
                float dys = -(position.y - a.LastPosition.y) / (ArenaView.Scale * ArenaView.GroundSquash);
                float walkFps = a.Appearance != null ? a.Appearance.WalkFPS : 10f;
                Gait.Advance(ref a.Gait, dxs, dys, gaitDt, facing, walkFps, local ? 0f : .12f);
                a.StampTime = gaitNow; a.LastPosition = position;
            }
            a.Root.transform.position = position;
            int order = 2000 + Mathf.RoundToInt(y * .5f);
            bool neutral = kind == ActorKind.QuestGiver;
            Color color = faction.HasValue ? ShowcasePalette.Faction((int)faction.Value) : ShowcasePalette.MutedText;
            bool dead = status == ActorStatus.Dead || status == ActorStatus.Mia;
            if(dead && !a.Dead) { a.DeadAt=Time.unscaledTime; a.HoldDeathFrame=false; }
            if(!dead) a.HoldDeathFrame=false;
            a.Dead=dead;a.WeaponId=weapon; a.Faction=faction; a.Kind=kind; a.MobType=mob;
            if (!weapon.HasValue) a.AttackUntil = 0;
            bool isMob = kind != ActorKind.Player;
            // The server's archetype key (catalog key) picks the look; a key the catalog lacks falls back to the faction/type mapping.
            string key = ShowcaseActorLook.AppearanceKey(kind, faction, mob, archetypeKey);
            a.Appearance = !neutral && _catalog != null ? _catalog.Find(key) : null;
            if (a.Appearance == null && !neutral && _catalog != null && ShowcaseActorLook.IsArchetypeLook(archetypeKey))
                a.Appearance = _catalog.Find(ShowcaseActorLook.AppearanceKey(kind, faction, mob));
            if (a.Appearance == null && _catalog != null && kind == ActorKind.Player) a.Appearance = _catalog.Find("hero");
            if (a.Appearance == null && _catalog != null && !neutral) a.Appearance = _catalog.Find("knight");
            bool reduced = ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion;
            var appearance = a.Appearance;
            Sprite[] frames=appearance?.Idle;
            float fps=appearance!=null ? appearance.IdleFPS : 10;
            float elapsed=Time.unscaledTime;bool loop=true,walkPhase=false;
            if(appearance!=null)
            {
                if(dead && appearance.Death!=null && appearance.Death.Length>0)
                { frames=appearance.Death;fps=appearance.DeathFPS;elapsed-=a.DeadAt;loop=false; }
                else if(a.WishUntil>Time.unscaledTime && WishClipFrames(appearance,a.WishClip,out frames,out fps))
                { elapsed-=a.WishAt;loop=false; }
                else if(a.BlockUntil>Time.unscaledTime && appearance.Block!=null && appearance.Block.Length>0)
                { frames=appearance.Block;fps=appearance.BlockFPS;elapsed-=a.BlockAt;loop=false; }
                else if(a.HitUntil>Time.unscaledTime && appearance.Hit!=null && appearance.Hit.Length>0)
                { frames=appearance.Hit;fps=appearance.HitFPS;elapsed-=a.HitAt;loop=false; }
                else if(a.AttackUntil>Time.unscaledTime && weapon.HasValue)
                { frames=AttackFrames(appearance,weapon.Value,out fps);elapsed-=a.AttackAt;loop=false; }
                else if(a.Gait.Walking && appearance.Walk.Length>0)
                { frames=appearance.Walk;fps=appearance.WalkFPS;walkPhase=true; }
            }
            if (frames != null && frames.Length > 0)
            {
                // Catalog arrays are direction-major, with exactly eight source directions. Facing is artwork only.
                int count = frames.Length / 8;
                // Flare: SW,W,NW,N,NE,E,SE,S; server facing zero is screen east.
                int direction = ((Mathf.RoundToInt(facing / (Mathf.PI / 4)) + 5) % 8 + 8) % 8;
                int rawFrame=walkPhase ? 0 : Mathf.Max(0,Mathf.FloorToInt(elapsed*Mathf.Max(1,fps)));
                int frame = dead && a.HoldDeathFrame ? count - 1 :
                    reduced ? (dead ? count-1 : 0) : walkPhase ? Gait.FrameIndex(a.Gait.Phase,count) : loop ? rawFrame%Mathf.Max(1,count) : Mathf.Min(count-1,rawFrame);
                a.Body.sprite = frames[Mathf.Min(frames.Length - 1, direction * count + frame)];
                float height = appearance.WorldHeight;
                a.Body.transform.localScale = Vector3.one * height;
                a.Body.transform.localPosition = new Vector3(0, .08f, 0);
            }
            else
            {
                a.Body.sprite = neutral ? ShowcaseIdentityAssets.GetFactionSilhouette(-1) : ShowcaseSprites.Get("rune");
                a.Body.transform.localScale = new Vector3(.8f, 1.35f, 1);
                a.Body.transform.localPosition = new Vector3(0, .55f, 0);
            }
            // Overheads follow the look's body height (Appearance.WorldHeight), so a tall or short look keeps its cluster just above its head.
            float headY = appearance != null && frames != null && frames.Length > 0 ? .08f + appearance.WorldHeight : 1.68f;
            float lift = headY - 1.68f; _sigLift = lift;
            a.Body.color = dead ? new Color(.4f, .43f, .48f, .65f) : Color.Lerp(Color.white, color, isMob ? .14f : .22f);
            if (!dead && a.WishTintAmount > 0f) a.Body.color = Color.Lerp(a.Body.color, a.WishTint, a.WishTintAmount);
            a.Body.sortingOrder = order;
            a.Body.transform.localRotation = Quaternion.Euler(0, 0, dead && (appearance==null || appearance.Death==null || appearance.Death.Length==0) ? 75 : 0);
            a.BodyRim.sprite = a.Body.sprite;
            a.BodyRim.transform.localPosition = a.Body.transform.localPosition + new Vector3(.01f,.005f);
            a.BodyRim.transform.localRotation = a.Body.transform.localRotation;
            a.BodyRim.transform.localScale = a.Body.transform.localScale * 1.045f;
            a.BodyRim.sortingOrder = order-1;
            a.BodyRim.color = new Color(.008f,.012f,.02f,dead ? .35f : .88f);
            // Light outer rim outside the dark outline: dark characters stay separable on dark ground (the dark outline carries pale ground).
            a.BodyGlow.sprite = a.Body.sprite;
            a.BodyGlow.transform.localPosition = a.Body.transform.localPosition;
            a.BodyGlow.transform.localRotation = a.Body.transform.localRotation;
            a.BodyGlow.transform.localScale = a.Body.transform.localScale * 1.13f;
            a.BodyGlow.sortingOrder = order - 3;
            AtmosphereShadows.ApplyRim(a.BodyGlow, x / 32f, y / 32f, dead ? .4f : 1f);
            int factionArt = faction.HasValue ? (int)faction.Value : -1;
            a.Identity.Present(factionArt,kind,mob,order,!dead,lift);
            a.Shadow.sortingOrder = order - 8;
            AtmosphereShadows.ApplyActor(a.Shadow, x / 32f, y / 32f);
            a.Halo.sortingOrder = order - 7;
            // The ground mark is the foot box when the server delivered one (ADR0024): its outline spans the box, drawn on the squashed
            // ground inside the 1.2 actor scale. Without a box (legacy or no table) it keeps the old fixed size.
            a.Halo.transform.localScale = footHx > 0f && footHy > 0f
                ? new Vector3(2f * footHx * ArenaView.Scale / (ActorVisualScale * FootprintOutline), 2f * footHy * ArenaView.Scale * ArenaView.GroundSquash / (ActorVisualScale * FootprintOutline), 1)
                : new Vector3(local ? 1.05f : .9f, .48f, 1);
            a.Halo.sprite = FactionIndicators.GetFootprint(factionArt);
            a.Halo.color = color;
            a.Halo.enabled = true;
            a.RuneBack.sortingOrder = order + 2;
            a.RuneBack.enabled = a.Rune.enabled = !dead; // a dead fighter keeps no insignia plate floating beside nothing
            a.RuneBack.transform.localPosition = new Vector3(-.72f, (isMob ? 1.23f : 1.55f) + lift, 0);
            a.RuneBack.transform.localScale = new Vector3(.46f, .46f, 1);
            a.RuneBack.color = new Color(.008f, .012f, .022f, .96f);
            a.Rune.sortingOrder = order + 3;
            bool knownFaction = faction.HasValue && factionArt >= 0 && factionArt < 5;
            a.Rune.sprite = ShowcaseSprites.Get(knownFaction ? "sigil" + factionArt : "rune");
            a.Rune.transform.localPosition = new Vector3(-.72f, (isMob ? 1.23f : 1.55f) + lift, 0);
            a.Rune.transform.localRotation = Quaternion.identity;
            a.Rune.color = color;
            a.Rune.transform.localScale = new Vector3(.4f, .4f, 1);
            a.HpBack.sortingOrder = order + 4; a.Hp.sortingOrder = order + 5;
            float healthShare = dead ? 0f : Mathf.Clamp01(hp / 100f);
            float barrierShare = dead || (isMob && !neutral) ? 0f : Mathf.Clamp01(barrierPct / 100f);
            const float unitWidth = .85f;
            float width = healthShare * unitWidth;
            float totalTrackWidth = Mathf.Max(.98f, unitWidth * (healthShare + barrierShare) + .04f);
            a.HpBack.transform.localScale = new Vector3(totalTrackWidth + .06f, .145f, 1);
            a.HpBack.transform.localPosition = new Vector3(-.49f + totalTrackWidth / 2, 1.8f + lift, 0);
            a.Hp.transform.localScale = new Vector3(width, .055f, 1);
            a.Hp.transform.localPosition = new Vector3(-.49f + width / 2, 1.8f + lift, 0);
            // Legacy FighterArt.HpBar: green above 50%, amber above 25%, red below; the barrier segment is the theme's barrier blue.
            var tone = Indicators.Tone(hp); var theme = UiTheme.Current;
            a.Hp.color = (Color)(tone == HpTone.Green ? theme.Success : tone == HpTone.Amber ? theme.Warning : theme.Danger);
            bool elite = false; string label = null;
            if (kind == ActorKind.RegionalMob && mob.HasValue && ShowcaseIdentityAssets.TryGetMobInfo(mob.Value, out var mobInfo)) { elite = mobInfo.Elite; label = mobInfo.DisplayName; }
            // A regional mob's bar shows when it is hurt (and always for an elite); the "fighting" case is not on the wire.
            bool barOn = !dead && (kind != ActorKind.RegionalMob || Indicators.MobBarVisible(elite, false, hp, false) || a.IndFacts.M.Engaged);
            a.Hp.enabled = barOn; a.HpBack.enabled = barOn;
            float barrierWidth = barrierShare * unitWidth;
            a.Barrier.transform.localScale = new Vector3(barrierWidth, .095f, 1);
            a.Barrier.transform.localPosition = new Vector3(-.49f + width + barrierWidth / 2, 1.8f + lift, 0);
            a.Barrier.color = (Color)theme.Info;
            a.Barrier.enabled = barOn && barrierWidth > 0;
            int ringSteps = dead || (isMob && !neutral) ? 0 : Mathf.Clamp(barrierRingStep, (byte)0, (byte)8);
            for (int i = 0; i < a.BarrierRing.Length; i++)
            {
                var segment = a.BarrierRing[i];
                segment.enabled = false; // the barrier is the legacy bubble round the body (OverheadExtras), not ticks above the head
                float ringAngle = i * Mathf.PI / 4f - Mathf.PI / 2f;
                segment.transform.localPosition = new Vector3(Mathf.Cos(ringAngle) * .19f, 2.18f + lift + Mathf.Sin(ringAngle) * .19f, 0);
                segment.color = (Color)theme.Info;
                segment.sortingOrder = order + 10;
            }
            a.Weapon.sortingOrder = order + 2;
            a.Weapon.transform.localPosition = new Vector3(Mathf.Cos(facing) * .42f, .6f - Mathf.Sin(facing) * .12f, 0);
            a.Weapon.sprite = weapon.HasValue ? ShowcaseSprites.Get("weapon" + Mathf.Clamp((int)weapon.Value,0,5)) : null;
            a.Weapon.transform.localRotation = Quaternion.Euler(0, 0, -facing * Mathf.Rad2Deg - 90);
            a.Weapon.transform.localScale = Vector3.one * (weapon == WeaponId.Fists ? .35f : .65f);
            a.Weapon.enabled = !dead && weapon.HasValue;
            byte unknownSignature = (byte)(signature & ~KnownSignatureMask);
            bool hasUnknownSignature = unknownSignature != 0;
            a.Status.enabled = false; // the generic status cue is replaced by the per-status glyphs (OverheadIndicators)
            a.Status.sortingOrder = order + 6; a.Status.color = color;
            a.Status.transform.localPosition = new Vector3(.55f, 1.5f, 0);
            int shown = 0;
            for (int bit = 0; bit < a.StatusIcons.Length; bit++)
            {
                var icon = a.StatusIcons[bit]; icon.enabled = false;
                if (!icon.enabled) continue;
                icon.transform.localPosition = new Vector3(-.45f + shown++ * .16f, 2, 0);
                icon.sortingOrder = order + 7;
            }
            for (int bit = 0; bit < SignatureBits.Length; bit++)
            {
                var icon = a.SignatureIcons[bit];
                icon.enabled = !dead && (signature & SignatureBits[bit]) != 0;
                var backing = a.SignatureBackers[bit];
                backing.enabled = icon.enabled;
                if (!icon.enabled) continue;
                icon.transform.localPosition = SignatureSlotPosition(bit);
                backing.transform.localPosition = SignatureSlotPosition(bit);
                icon.sortingOrder = order + 8;
                backing.sortingOrder = order + 7;
            }
            a.UnknownSignature.enabled = !dead && hasUnknownSignature;
            a.UnknownSignatureBacker.enabled = a.UnknownSignature.enabled;
            a.UnknownSignature.transform.localPosition = SignatureSlotPosition(UnknownSignatureSlot);
            a.UnknownSignatureBacker.transform.localPosition = SignatureSlotPosition(UnknownSignatureSlot);
            a.UnknownSignature.sortingOrder = order + 8;
            a.UnknownSignatureBacker.sortingOrder = order + 7;
            a.Light.Configure(color, local ? .65f : .2f, .3f, 2.4f, .5f, false, true);
            a.Light.SetVisible(!dead && local);
            // A hidden fighter (Swarm) is not drawn for anyone else and faint for its owner (legacy PlayerView).
            float hiddenAlpha = Indicators.HiddenAlpha(effects, local);
            if (hiddenAlpha > 0f && hiddenAlpha < 1f) { var bc = a.Body.color; bc.a *= hiddenAlpha; a.Body.color = bc; var rc = a.BodyRim.color; rc.a *= hiddenAlpha; a.BodyRim.color = rc; var gc = a.BodyGlow.color; gc.a *= hiddenAlpha; a.BodyGlow.color = gc; }
            bool hideAll = hiddenAlpha <= 0f; if (a.Root.activeSelf == hideAll) a.Root.SetActive(!hideAll);
            // Geometry for the overhead cluster; PresentIndicators adds the facts only the caller has.
            var fx = a.IndFacts; float barY = 1.8f + lift;
            fx.Order = order; fx.HeadY = headY; fx.BarY = barY; fx.Dead = dead; fx.Local = local; fx.Mob = kind == ActorKind.RegionalMob || kind == ActorKind.TrainingDummy;
            fx.Elite = elite; fx.Dummy = kind == ActorKind.TrainingDummy; fx.HpPct = hp; fx.Effects = effects; fx.Name = fx.Mob ? (kind == ActorKind.TrainingDummy ? "Training dummy" : label) : null;
            fx.SigTopY = (signature != 0 || ringSteps > 0) ? 2.62f + lift : barY;
            fx.Reduced = reduced; fx.BarrierStep = ringSteps; fx.Sig = signature;
            a.IndFacts = fx;
            // SURFACE-FX HOOK: delivered actors only (see SurfaceFx); prints, ripples and footsteps come from here and nowhere else.
            // A fighter that is hidden from this viewer (not drawn at all) leaves no prints, ripples or footsteps either.
            if (Fx != null && !hideAll) Fx.Note(id, x, y, kind, local, dead, appearance != null ? appearance.WorldHeight : 1.6f, a.Gait.Walking, a.Gait.Phase, appearance != null && appearance.Walk != null ? appearance.Walk.Length / 8 : 0);
        }

        Art Create()
        {
            var a = new Art { Root = new GameObject("Observed actor") };
            a.Root.transform.SetParent(_parent, false);
            var t = a.Root.transform;
            // Scale character art and its overhead indicators together about the grounded actor position.
            t.localScale = new Vector3(ActorVisualScale, ActorVisualScale, 1f);
            a.Shadow = ShowcaseSprites.Create(t, "Contact shadow", "shadow", 0, Color.white, new Vector2(1.2f, .45f), new Vector3(.13f, -.04f), false);
            a.Halo = ShowcaseSprites.Create(t, "Faction footprint", "ring", 1, Color.white, Vector2.one, Vector3.zero, false);
            a.Body = ShowcaseSprites.Create(t, "Authored character", "rune", 2, Color.white, Vector2.one, Vector3.zero);
            a.Body.sharedMaterial = ShowcaseSprites.ActorLit;      // render pass (fx.actorlights): characters are lit by the analytic local lights, with a rim on the lit edge
            a.BodyRim = ShowcaseSprites.Create(t, "Character contrast rim", "rune", 1, Color.black, Vector2.one, Vector3.zero, false);
            a.BodyGlow = ShowcaseSprites.Create(t, "Character light rim", "rune", 0, Color.white, Vector2.one, Vector3.zero, false);
            a.Identity = ShowcaseIdentityOwner.Configure(t);
            a.Identity.StandaloneFactionBadge = false; // The existing tested backed faction mark remains canonical here.
            a.RuneBack = ShowcaseSprites.Create(t, "Faction insignia backplate", "bar", 2, new Color(.008f, .012f, .022f, .96f), new Vector2(.46f, .46f), Vector3.zero, false);
            a.Rune = ShowcaseSprites.Create(t, "Faction insignia", "rune", 3, Color.white, Vector2.one, Vector3.zero, false);
            a.HpBack = ShowcaseSprites.Create(t, "Health and barrier track", "bar", 4, (Color)UiTheme.Current.OutlineDark, new Vector2(1.04f, .145f), new Vector3(0, 1.8f), false);
            a.Hp = ShowcaseSprites.Create(t, "Confirmed health", "bar", 5, Color.white, Vector2.one, Vector3.zero, false);
            a.Barrier = ShowcaseSprites.Create(t, "Confirmed barrier", "bar", 6, ShowcasePalette.Gold, Vector2.one, Vector3.zero, false);
            a.BarrierRing = new SpriteRenderer[8];
            for (int i = 0; i < a.BarrierRing.Length; i++)
            {
                float angle = i * Mathf.PI / 4f - Mathf.PI / 2f;
                var segment = ShowcaseSprites.Create(t, "Barrier ring step " + (i + 1), "bar", 10,
                    ShowcasePalette.Gold, new Vector2(.16f, .045f),
                    new Vector3(Mathf.Cos(angle) * .19f, 2.18f + Mathf.Sin(angle) * .19f, 0), false);
                segment.transform.localRotation = Quaternion.Euler(0, 0, angle * Mathf.Rad2Deg);
                segment.enabled = false;
                a.BarrierRing[i] = segment;
            }
            a.Weapon = ShowcaseSprites.Create(t, "Equipped weapon cue", "bar", 3, new Color(.9f, .86f, .72f), Vector2.one, Vector3.zero, false);
            a.Status = ShowcaseSprites.Create(t, "Public status cue", "rune", 6, Color.white, new Vector2(.18f, .18f), new Vector3(.55f, 1.5f), false);
            a.StatusIcons = new SpriteRenderer[13];
            for(int bit=0;bit<a.StatusIcons.Length;bit++)
                a.StatusIcons[bit] = ShowcaseSprites.Create(t, "Public status bit " + bit, "sigil" + bit%5, 7,
                    bit<3 ? new Color(1,.8f,.4f) : bit<5 ? new Color(.5f,.85f,1) : bit<7 ? new Color(1,.45f,.35f) : new Color(.8f,.7f,1), new Vector2(.14f,.14f), Vector3.zero,false);
            a.SignatureIcons = new SpriteRenderer[SignatureBits.Length];
            a.SignatureBackers = new SpriteRenderer[SignatureBits.Length];
            for (int i = 0; i < a.SignatureIcons.Length; i++)
            {
                a.SignatureBackers[i] = ShowcaseSprites.Create(t, SignatureName(SignatureBits[i]) + " backer", "bar", 7,
                    ShowcasePalette.Panel, new Vector2(.34f, .34f), Vector3.zero, false);
                a.SignatureIcons[i] = ShowcaseSprites.Create(t, SignatureName(SignatureBits[i]), SignatureSpriteKeys[i], 8,
                    SignatureColors[i], new Vector2(.3f, .3f), Vector3.zero, false);
                a.SignatureIcons[i].sprite = IndicatorArt.Get(SignatureGlyphs[i]);
            }
            a.UnknownSignatureBacker = ShowcaseSprites.Create(t, "Unknown signature backer", "bar", 7,
                ShowcasePalette.Panel, new Vector2(.34f, .34f), Vector3.zero, false);
            a.UnknownSignature = ShowcaseSprites.Create(t, "Unknown signature", "rune", 8,
                ShowcasePalette.MutedText, new Vector2(.3f, .3f), Vector3.zero, false);
            foreach (var icon in a.SignatureIcons) icon.enabled = false;
            foreach (var backing in a.SignatureBackers) backing.enabled = false;
            a.UnknownSignature.enabled = false;
            a.UnknownSignatureBacker.enabled = false;
            a.Light = ShowcaseSprites.CreateLight(t, "Observed local accent", new Vector3(0, .6f, -1));
            a.Light.Configure(Color.white, .2f, .3f, 2.4f, .5f, false, true);
            a.Ind = new OverheadIndicators(t);
            return a;
        }

        float _sigLift;
        Vector3 SignatureSlotPosition(int slot) { return new Vector3(-.9f + slot * .36f, 2.4f + _sigLift, 0); }

        /// <summary>
        /// The delivered facts only the caller has (bounty, the local player's off-hand weapon, whether this actor is the attack lock), then the
        /// overhead cluster is drawn. Called once per actor right after <see cref="Present"/>.
        /// </summary>
        public void PresentIndicators(uint id, int bounty, bool hasSecondary, WeaponId secondary, bool locked, int effectsOverride = -1,
            bool hovered = false, bool hunted = false, int wishState = 0, byte wishAbility = 0)
        {
            if (!_active.TryGetValue(id, out var a)) return;
            var fx = a.IndFacts; fx.Bounty = bounty; fx.HasSecondary = hasSecondary; fx.Secondary = secondary; fx.Locked = locked; if (effectsOverride >= 0) fx.Effects = (ushort)effectsOverride;
            fx.Hovered = hovered; fx.Hunted = hunted; fx.WishState = wishState; fx.WishAbility = wishAbility;
            a.IndFacts = fx; a.Ind.Update(in a.IndFacts);
            if (a.Fade.Entering || a.Fade.Opacity < .999f) a.Ind.ApplyOpacity(a.Fade.Opacity);
        }

        /// <summary>The protocol 16 indicator facts of an observed actor (names, stat marks, mark plate, immunity, roam, engaged); read on the next <see cref="PresentIndicators"/>.</summary>
        public void PresentMarks(uint id, in OverheadIndicators.Marks marks)
        {
            if (!_active.TryGetValue(id, out var a)) return;
            var fx = a.IndFacts; fx.M = marks; a.IndFacts = fx;
        }

        static string SignatureName(byte bit)
        {
            switch (bit)
            {
                case 1: return "Signature chilled (1)";
                case 2: return "Signature burning (2)";
                case 4: return "Signature diseased (4)";
                case 8: return "Signature execute (8)";
                case 64: return "Signature execute-blocked (64)";
                default: return "Signature unknown";
            }
        }
    }
}
