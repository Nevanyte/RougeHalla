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
            public SpriteRenderer Body, Shadow, Cast, Halo, Hp, HpBack, Barrier, Weapon, Status;
            public ShowcaseIdentityOwner Identity;
            public SpriteOutline[] Plates; public SpriteOutline OutBody, OutHp, OutFoot; // CONTRAST: adaptive neutral outlines (SpriteOutline.cs)
            public SpriteRenderer[] BarrierRing;
            public SpriteRenderer[] StatusIcons;
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
        readonly List<OverheadElement> _barLayout = new List<OverheadElement>();
        readonly ShowcaseCatalog _catalog;
        int _stamp;
        const float ActorVisualScale = 1.2f;
        /// <summary>The faction footprint outline sits at this fraction of the sprite's half-size (FactionIndicators textures).</summary>
        const float FootprintOutline = .72f;
        public SpriteActorPresenter(Transform parent, ShowcaseCatalog catalog) { _parent = parent; _catalog = catalog; SpriteOutline.ConfigureFromUrl(Application.absoluteURL); /* CONTRAST */ }
        public bool Contains(uint id) { return _active.ContainsKey(id); }
        /// <summary>
        /// The delivered camps (Session.Map.Camps and Session.Collections.Camps, index-aligned) so a mob's name can be packed by camp
        /// (P-UNITY-HUD-VISUAL-FIX-4, <see cref="NameMerge.CampOfMob"/>). Null or empty: every mob has no camp and packs by distance.
        /// Stub: stores nothing; the implementer keeps the arrays and uses them in the pack merge. ArenaView calls it (coordinator wiring).
        /// </summary>
        public void SetCamps(MapCamp[] camps, IReadOnlyList<CampView> rows) { }
        public int ActiveCount { get { return _active.Count; } }
        /// <summary>True when the actor's overhead name label is drawn this frame (test-visible; P-UNITY-HUD-VISUAL-FIX-2).</summary>
        public bool NameShown(uint id) { return _active.TryGetValue(id, out var art) && art.Ind.NameActive; }
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
        NameMergeItem[] _mergeItems = new NameMergeItem[32]; bool[] _mergeShown = new bool[32]; uint[] _mergeIds = new uint[32]; int[] _mergeScratch = new int[32];
        public void End()
        {
            MergeMobNames();
            _remove.Clear(); foreach (var pair in _active) if (pair.Value.Stamp != _stamp) _remove.Add(pair.Key);
            foreach (uint id in _remove)
            {
                Evict(id);
            }
        }
        NameStackItem[] _stackItems = new NameStackItem[16]; float[] _lift = new float[16]; uint[] _stackIds = new uint[16];
        float[] _anchorX = new float[32], _anchorY = new float[32]; int[] _packSize = new int[32];
        readonly List<Rect> _nameRects = new List<Rect>();
        /// <summary>World rects of the fighter names drawn this frame (after stacking), for the camp labels to keep clear of.</summary>
        public void FighterNameRects(List<Rect> into) { into.AddRange(_nameRects); }

        /// <summary>
        /// Mobs of one camp that stand together show exactly one name (P-UNITY-NAME-GROUP-2): over the pack, or over the hovered or locked member.
        /// Then the fighters' names are stacked so none overlaps another. Runs after every actor's indicators were presented. Players are never merged.
        /// </summary>
        void MergeMobNames()
        {
            _nameRects.Clear();
            int n = 0, fighters = 0;
            foreach (var pair in _active)
            {
                var art = pair.Value;
                if (pair.Value.Stamp != _stamp || art.Dead || art.Ind == null) continue;
                var f = art.IndFacts;
                if (f.Dead || !art.Ind.NameActive) continue;
                if (!f.Mob) { fighters++; continue; }
                if (f.Dummy) continue;
                if (n == _mergeItems.Length)
                {
                    System.Array.Resize(ref _mergeItems, n * 2); System.Array.Resize(ref _mergeShown, n * 2); System.Array.Resize(ref _mergeIds, n * 2); System.Array.Resize(ref _mergeScratch, n * 2);
                    System.Array.Resize(ref _anchorX, n * 2); System.Array.Resize(ref _anchorY, n * 2); System.Array.Resize(ref _packSize, n * 2);
                }
                var at = art.Ind.NameWorldPosition;
                _mergeItems[n] = new NameMergeItem { Id = pair.Key, Text = f.Name, X = at.x, Y = at.y, Width = art.Ind.NameWorldWidth, Elite = f.Elite, Single = (byte)(f.Hovered ? 2 : f.Locked ? 1 : 0) };
                _mergeIds[n] = pair.Key; n++;
            }
            if (n > 0)
            {
                NameMerge.PackNames(_mergeItems, n, NameMerge.PackDistancePx * ArenaView.Scale, _mergeShown, _mergeScratch, _anchorX, _anchorY);
                for (int i = 0; i < n; i++) _packSize[i] = 0;
                for (int i = 0; i < n; i++) _packSize[_mergeScratch[i]]++;
                for (int i = 0; i < n; i++)
                {
                    if (!_active.TryGetValue(_mergeIds[i], out var art)) continue;
                    if (!_mergeShown[i]) { art.Ind.HideName(); continue; }
                    if (_packSize[_mergeScratch[i]] > 1 || _mergeItems[i].Single != 0) art.Ind.NameFullAlpha();
                    if (_anchorX[i] != _mergeItems[i].X || _anchorY[i] != _mergeItems[i].Y) art.Ind.MoveName(_anchorX[i], _anchorY[i]);
                }
            }
            StackFighterNames(fighters);
        }

        // Fighters whose names would overlap are stacked, the one nearest the local fighter lowest. Names are never merged.
        void StackFighterNames(int fighters)
        {
            if (fighters == 0) return;
            if (_stackItems.Length < fighters)
            {
                int size = fighters * 2;
                System.Array.Resize(ref _stackItems, size); System.Array.Resize(ref _lift, size); System.Array.Resize(ref _stackIds, size);
            }
            bool haveLocal = false; Vector3 local = default;
            foreach (var pair in _active)
            {
                var art = pair.Value;
                if (pair.Value.Stamp != _stamp || art.Dead || art.Ind == null || !art.IndFacts.Local || art.IndFacts.Mob || !art.Ind.NameActive) continue;
                local = art.Ind.NameWorldPosition; haveLocal = true; break;
            }
            int k = 0;
            foreach (var pair in _active)
            {
                var art = pair.Value;
                if (pair.Value.Stamp != _stamp || art.Dead || art.Ind == null) continue;
                var f = art.IndFacts;
                if (f.Dead || f.Mob || !art.Ind.NameActive) continue;
                var nb = art.Ind.NameDrawnBounds; var at = nb.center; float w = nb.size.x + .06f, h = nb.size.y;   // the drawn mesh, a couple of pixels of gap
                _stackItems[k] = new NameStackItem { Id = pair.Key, X = at.x, Y = nb.min.y, W = w, H = h, Dist = haveLocal ? Mathf.Sqrt((at.x - local.x) * (at.x - local.x) + (at.y - local.y) * (at.y - local.y)) : 0f };
                _stackIds[k] = pair.Key; k++;
            }
            NameStack.Separate(_stackItems, k, .02f, _lift);
            for (int i = 0; i < k; i++)
            {
                var item = _stackItems[i];
                if (_lift[i] > 0f && _active.TryGetValue(_stackIds[i], out var art)) art.Ind.LiftName(_lift[i]);
                _nameRects.Add(new Rect(item.X - item.W * .5f, item.Y + _lift[i], item.W, item.H));
            }
        }

        public void Retain(HashSet<uint> membership)
        {
            _remove.Clear(); foreach(var pair in _active) if(!membership.Contains(pair.Key)) _remove.Add(pair.Key);
            foreach(uint id in _remove) Evict(id);
        }
        void Evict(uint id)
        {
            var art=_active[id];
            if (TryParkBody(id, art)) return; // a dead creature waits for its renewed id (SpriteActorPresenter.Fade.cs)
            if (TryBeginExit(id, art)) return; // a living actor that left sight fades out (SpriteActorPresenter.Fade.cs)
            _active.Remove(id); Release(art);
        }
        void Release(Art art)
        {
            if (IsCreature(art.Fade.Kind)) MobArt.Destroyed++;
            art.Light.SetVisible(false);
            art.Barrier.enabled = false;
            art.Ind.HideAll();
            foreach (var segment in art.BarrierRing) segment.enabled = false;
            art.Identity.Clear();
            art.Root.SetActive(false);
            _pool.Push(art);
        }

        public void Present(uint id, float x, float y, float facing, float hp, FactionId? faction, ActorStatus status, WeaponId? weapon,
            ActorKind kind, MobTypeId? mob, ushort effects, byte signature, bool local, float barrierPct = 0f, byte barrierRingStep = 0, string archetypeKey = null, float footHx = 0f, float footHy = 0f)
        {
            if (!_active.TryGetValue(id, out var a))
            {
                if (!local && IsCreature(kind) && TryContinue(id, kind, faction, mob, archetypeKey, x, y, status == ActorStatus.Dead || status == ActorStatus.Mia, out a)) _active.Add(id, a); // a renewed handle
                else
                {
                    a = _pool.Count > 0 ? _pool.Pop() : Create(); _active.Add(id, a);
                    a.Root.SetActive(true); a.LastPosition = ArenaView.WorldPoint(x, y); a.AttackUntil = 0;
                    a.Gait.Reset(); a.StampTime = Time.unscaledTime;
                    a.HitUntil=a.BlockUntil=0;a.Dead=false;a.HoldDeathFrame=false;a.WishUntil=0;a.WishTintAmount=0;
                    if (IsCreature(kind)) MobArt.Created++;
                    BeginEnter(a, local, kind, IsCreature(kind) ? VisionFade.EnterStartAlpha(status) : 0f);
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
            // CONTRAST: the overhead cluster clears the figure's real top (hat, horns, a raised bow), not only the catalog height, so a bar never cuts the head's contour.
            if (appearance != null && frames != null && frames.Length > 0) headY = Mathf.Max(headY, HeadTop(appearance) + ActorOutlineModel.Width * 1.2f);
            float lift = headY - 1.68f;
            // Creatures keep their true colours while the death clip plays; the grey tint comes only once it has ended (or when there is no clip).
            bool clipPlaying = dead && IsCreature(kind) && appearance != null && appearance.Death != null && appearance.Death.Length > 0
                && Time.unscaledTime - a.DeadAt < ClipDuration(appearance.Death, appearance.DeathFPS, 0f);
            a.Body.color = dead && !clipPlaying ? new Color(.4f, .43f, .48f, .65f) : Color.Lerp(Color.white, color, isMob ? .14f : .22f);
            if (!dead && a.WishTintAmount > 0f) a.Body.color = Color.Lerp(a.Body.color, a.WishTint, a.WishTintAmount);
            a.Body.sortingOrder = order;
            a.Body.transform.localRotation = Quaternion.Euler(0, 0, dead && (appearance==null || appearance.Death==null || appearance.Death.Length==0) ? 75 : 0);
            // CONTRAST: the dark rim and the pale halo are gone; the adaptive outline (SpriteOutline) is synced at the end of Present.
            int factionArt = faction.HasValue ? (int)faction.Value : -1;
            a.Identity.Present(factionArt,kind,mob,order,!dead,lift);
            a.Shadow.sortingOrder = order - 8;
            // The ground shadow is sized to the look's foot box (the server's ground rectangle, the same one the footprint mark spans), in the actor's local units.
            AtmosphereShadows.ApplyActor(a.Shadow, x / 32f, y / 32f,
                footHx > 0f && footHy > 0f ? 2f * footHx * ArenaView.Scale / ActorVisualScale : 0f,
                footHx > 0f && footHy > 0f ? 2f * footHy * ArenaView.Scale * ArenaView.GroundSquash / ActorVisualScale : 0f, a.Cast);
            a.Cast.sortingOrder = order - 9;
            a.Halo.sortingOrder = order - 7;
            // The ground mark is the foot box when the server delivered one (ADR0024): its outline spans the box, drawn on the squashed
            // ground inside the 1.2 actor scale. Without a box (legacy or no table) it keeps the old fixed size.
            a.Halo.transform.localScale = footHx > 0f && footHy > 0f
                ? new Vector3(2f * footHx * ArenaView.Scale / (ActorVisualScale * FootprintOutline), 2f * footHy * ArenaView.Scale * ArenaView.GroundSquash / (ActorVisualScale * FootprintOutline), 1)
                : new Vector3(local ? 1.05f : .9f, .48f, 1);
            a.Halo.sprite = FactionIndicators.GetFootprint(factionArt);
            a.Halo.color = color;
            a.Halo.enabled = true;
            a.HpBack.sortingOrder = order + 4; a.Hp.sortingOrder = order + 5; a.Barrier.sortingOrder = order + 6;
            float barrierShare = dead || (isMob && !neutral) ? 0f : Mathf.Clamp01(barrierPct / 100f);
            bool elite = false; string label = null;
            if (kind == ActorKind.RegionalMob && mob.HasValue && ShowcaseIdentityAssets.TryGetMobInfo(mob.Value, out var mobInfo)) { elite = mobInfo.Elite; label = mobInfo.DisplayName; }
            // The hp bar is drawn from the legacy overhead layout (OverheadStack): size per actor kind, green above 50%, amber above 25%, red below,
            // the barrier as a segment after the fill. A mob shows it when hurt, an elite and a dummy always; an engaged mob counts as a dummy (always).
            // A quest giver and a dead actor have none.
            var theme = UiTheme.Current;
            var barFacts = new OverheadFacts
            {
                Kind = kind == ActorKind.TrainingDummy ? OverheadActorKind.Dummy
                    : kind == ActorKind.RegionalMob ? (elite ? OverheadActorKind.Elite : a.IndFacts.M.Engaged ? OverheadActorKind.Dummy : OverheadActorKind.Mob)
                    : OverheadActorKind.Player,
                Dead = dead || neutral, HpPct = Mathf.Clamp01(hp / 100f) * 100f, BarrierPct = barrierShare * 100f,
            };
            OverheadStack.Build(in barFacts, _barLayout);
            a.Hp.enabled = a.HpBack.enabled = a.Barrier.enabled = false;
            float barBase = 1.8f + lift - OverheadStack.ToUnits(33.2f);   // the bar's centre stays where it was; the layout's y is up from the feet
            for (int i = 0; i < _barLayout.Count; i++)
            {
                var e = _barLayout[i];
                SpriteRenderer r;
                switch (e.Kind)
                {
                    case OverheadKind.HpBack: r = a.HpBack; break;
                    case OverheadKind.HpFill:
                        r = a.Hp;
                        a.Hp.color = (Color)(e.Tone == OverheadTone.Green ? theme.Success : e.Tone == OverheadTone.Amber ? theme.Warning : theme.Danger);
                        break;
                    case OverheadKind.BarrierFill: r = a.Barrier; a.Barrier.color = (Color)theme.Info; break;
                    default: continue;
                }
                r.enabled = true;
                r.transform.localPosition = new Vector3(OverheadStack.ToUnits(e.X), barBase + OverheadStack.ToUnits(e.Y + e.H * .5f), 0);
                r.transform.localScale = new Vector3(OverheadStack.ToUnits(e.W), OverheadStack.ToUnits(e.H), 1);
            }
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
            a.Light.Configure(color, local ? .65f : .2f, .3f, 2.4f, .5f, false, true);
            a.Light.SetVisible(!dead && local);
            // A hidden fighter (Swarm) is not drawn for anyone else and faint for its owner (legacy PlayerView).
            float hiddenAlpha = Indicators.HiddenAlpha(effects, local);
            if (hiddenAlpha > 0f && hiddenAlpha < 1f) { var bc = a.Body.color; bc.a *= hiddenAlpha; a.Body.color = bc; }
            bool hideAll = hiddenAlpha <= 0f; if (a.Root.activeSelf == hideAll) a.Root.SetActive(!hideAll);
            // CONTRAST: outlines last, once every source sprite, transform, enabled state and sort order is final for the frame.
            {
                bool darkGround = AtmosphereShadows.GroundIsDark(x / 32f, y / 32f);
                float bodyAlpha = ActorOutlineModel.StateAlpha(dead, hiddenAlpha > 0f ? hiddenAlpha : 1f);
                a.OutBody.Sync(order, bodyAlpha, darkGround);
                a.OutHp.Sync(a.HpBack.sortingOrder, 1f, darkGround);
                a.OutFoot.Sync(a.Halo.sortingOrder, 1f, darkGround);
                SyncPlates(a, darkGround);
            }
            // Geometry for the overhead cluster; PresentIndicators adds the facts only the caller has.
            var fx = a.IndFacts; float barY = 1.8f + lift;
            fx.Order = order; fx.HeadY = headY; fx.BarY = barY; fx.Dead = dead; fx.Local = local; fx.Mob = kind == ActorKind.RegionalMob || kind == ActorKind.TrainingDummy;
            fx.Elite = elite; fx.Dummy = kind == ActorKind.TrainingDummy; fx.HpPct = hp; fx.Effects = effects; fx.Name = fx.Mob ? (kind == ActorKind.TrainingDummy ? "Training dummy" : label) : null;
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
            a.Shadow = ShowcaseSprites.Create(t, "Contact shadow", "actorshadow", 0, Color.white, new Vector2(1.2f, .45f), new Vector3(.13f, -.04f), false);
            a.Cast = ShowcaseSprites.Create(t, "Cast shadow", "actorshadow", 0, Color.white, new Vector2(1.2f, .45f), new Vector3(.13f, -.04f), false);
            a.Halo = ShowcaseSprites.Create(t, "Faction footprint", "ring", 1, Color.white, Vector2.one, Vector3.zero, false);
            a.Body = ShowcaseSprites.Create(t, "Authored character", "rune", 2, Color.white, Vector2.one, Vector3.zero);
            a.Body.sharedMaterial = ShowcaseSprites.ActorLit;      // render pass (fx.actorlights): characters are lit by the analytic local lights, with a rim on the lit edge
            a.Identity = ShowcaseIdentityOwner.Configure(t);
            a.Identity.StandaloneFactionBadge = false; // The existing tested backed faction mark remains canonical here.
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
            a.Light = ShowcaseSprites.CreateLight(t, "Observed local accent", new Vector3(0, .6f, -1));
            a.Light.Configure(Color.white, .2f, .3f, 2.4f, .5f, false, true);
            a.Ind = new OverheadIndicators(t);
            // CONTRAST: one adaptive neutral outline per figure and per gated marker (SpriteOutline.cs); faction identity stays in shape and in the colour inside.
            a.OutBody = new SpriteOutline(a.Body, "Character contrast rim", ActorOutlineModel.Width, ActorOutlineModel.TargetRatio);
            a.OutBody.SetCompanion(a.Weapon, true);   // one line around the body and the weapon it holds: never a second stroke over the other part
            a.OutHp = new SpriteOutline(a.HpBack, "Health and barrier track outline", ActorOutlineModel.MarkerWidth, ActorOutlineModel.MarkerTargetRatio);
            a.OutFoot = new SpriteOutline(a.Halo, "Faction footprint outline", ActorOutlineModel.FootWidth, ActorOutlineModel.MarkerTargetRatio);
            a.OutFoot.SetCompanion(a.Body, false);   // the footprint's stroke is cut where the body stands on it
            // Every overhead plate, backer and ground ring (name, bounty, status, off-hand, Wish, stat marks, mark plate, signature, barrier ring steps, elite, lock, root, zone,
            // immunity and roam rings, identity badges) gets the same thin adaptive hairline; the glyph or text inside stays as drawn.
            var plates = new List<SpriteOutline>();
            foreach (var r in t.GetComponentsInChildren<SpriteRenderer>(true))
                if (NeedsStroke(r.gameObject.name)) plates.Add(new SpriteOutline(r, r.gameObject.name + " outline", ActorOutlineModel.MarkerWidth, ActorOutlineModel.MarkerTargetRatio));
            a.Plates = plates.ToArray();
            MoveOverheadToStrokes(t, a);
            return a;
        }

        /// <summary>
        /// The overhead cluster (hp track and fill, names, marks, status plates and icons, text) is drawn in the "Strokes" layer, above every
        /// body and prop and below the strokes' own order ties: it is therefore NOT in the grab the stroke shader reads, so a dark plate beside a fighter never decides that
        /// fighter's stroke polarity (the ground does), and the plates keep their own relative order. Bodies, the held weapon, the footprint, the contact shadow and every ground ring
        /// or bubble stay in "Default".
        /// </summary>
        static void MoveOverheadToStrokes(Transform root, Art a)
        {
            if (!StrokeLayer.Exists) return;
            foreach (var r in root.GetComponentsInChildren<Renderer>(true))
            {
                if (r == a.Body || r == a.Weapon || r == a.Halo || r == a.Shadow || r == a.Cast) continue;
                string n = r.gameObject.name;
                if (n.IndexOf("ring", System.StringComparison.OrdinalIgnoreCase) >= 0 || n.IndexOf("bubble", System.StringComparison.OrdinalIgnoreCase) >= 0 || n.Contains("shade")
                    || n == "Contact shadow" || n == "Cast shadow" || n == "Faction mantle") continue;
                bool authored = false;
                for (var tr = r.transform.parent; tr != null && tr != root; tr = tr.parent) if (tr.name == "Authored character") { authored = true; break; }
                if (authored || n == "Authored character") continue;
                r.sortingLayerID = StrokeLayer.Id;
            }
        }

        static bool NeedsStroke(string n)
        {
            if (n == null || n.EndsWith(" outline") || n == "Character contrast rim" || n == "Authored character" || n == "Contact shadow" || n == "Cast shadow" || n.StartsWith("Faction footprint") || n == "Faction mantle" || n.Contains("shade")) return false;
            return n.IndexOf("plate", System.StringComparison.OrdinalIgnoreCase) >= 0 || n.IndexOf("backer", System.StringComparison.OrdinalIgnoreCase) >= 0 || n.IndexOf("ring", System.StringComparison.OrdinalIgnoreCase) >= 0;
        }

        void SyncPlates(Art a, bool dark)
        {
            var p = a.Plates; if (p == null) return;
            for (int i = 0; i < p.Length; i++) p[i].SyncFollow(1f, dark);
        }

        static readonly Dictionary<ShowcaseCatalog.Appearance, float> HeadTops = new Dictionary<ShowcaseCatalog.Appearance, float>();
        /// <summary>Height of the tallest idle or walk frame above the feet in actor units (cached per look; the sprites are trimmed to their opaque pixels).</summary>
        static float HeadTop(ShowcaseCatalog.Appearance a)
        {
            if (HeadTops.TryGetValue(a, out float top)) return top;
            float m = 0f;
            foreach (var clip in new[] { a.Idle, a.Walk })
                if (clip != null) foreach (var sp in clip) if (sp != null) m = Mathf.Max(m, sp.bounds.max.y);
            top = .08f + m * a.WorldHeight; HeadTops[a] = top; return top;
        }

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
            SyncPlates(a, AtmosphereShadows.GroundIsDark(a.Root.transform.position.x, -a.Root.transform.position.y / ArenaView.GroundSquash));   // CONTRAST: plates were just updated
            if (a.Fade.Entering || a.Fade.Opacity < .999f) a.Ind.ApplyOpacity(a.Fade.Opacity);
        }

        /// <summary>The protocol 16 indicator facts of an observed actor (names, stat marks, mark plate, immunity, roam, engaged); read on the next <see cref="PresentIndicators"/>.</summary>
        public void PresentMarks(uint id, in OverheadIndicators.Marks marks)
        {
            if (!_active.TryGetValue(id, out var a)) return;
            var fx = a.IndFacts; fx.M = marks; a.IndFacts = fx;
        }
    }
}
