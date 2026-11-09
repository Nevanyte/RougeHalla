using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>Owned visual objects keyed only by currently supplied observer handles. Nothing here simulates a rule.</summary>
    public sealed class SpriteActorPresenter
    {
        sealed class Art
        {
            public GameObject Root;
            public SpriteRenderer Body, BodyRim, Shadow, Halo, RuneBack, Rune, Hp, HpBack, Barrier, Weapon, Status;
            public ShowcaseIdentityOwner Identity;
            public SpriteRenderer[] BarrierRing;
            public SpriteRenderer[] StatusIcons;
            public SpriteRenderer[] SignatureIcons;
            public SpriteRenderer[] SignatureBackers;
            public SpriteRenderer UnknownSignature, UnknownSignatureBacker;
            public ShowcasePointLight Light;
            public ShowcaseCatalog.Appearance Appearance;
            public Vector3 LastPosition;
            public float MovingUntil, AttackUntil;
            public float AttackAt, HitAt, BlockAt, DeadAt, HitUntil, BlockUntil;
            public bool Dead, HoldDeathFrame;
            public WeaponId WeaponId;
            public FactionId Faction;
            public ActorKind Kind;
            public MobTypeId? MobType;
            public int Stamp;
        }
        readonly Transform _parent;
        readonly Dictionary<uint, Art> _active = new Dictionary<uint, Art>();
        readonly Stack<Art> _pool = new Stack<Art>();
        readonly List<uint> _remove = new List<uint>();
        readonly ShowcaseCatalog _catalog;
        int _stamp;
        const byte KnownSignatureMask = 1 | 2 | 4 | 8 | 64;
        static readonly byte[] SignatureBits = { 1, 2, 4, 8, 64 };
        static readonly string[] SignatureSpriteKeys = { "sigil3", "spark", "sigil2", "weapon0", "sigil4" };
        static readonly Color[] SignatureColors =
        {
            ShowcasePalette.Faction((int)FactionId.Frost), ShowcasePalette.Faction((int)FactionId.Fire),
            ShowcasePalette.Faction((int)FactionId.Plague), ShowcasePalette.Faction((int)FactionId.Sentenced),
            ShowcasePalette.MutedText
        };
        const int UnknownSignatureSlot = 5;

        public SpriteActorPresenter(Transform parent, ShowcaseCatalog catalog) { _parent = parent; _catalog = catalog; }
        public bool Contains(uint id) { return _active.ContainsKey(id); }
        public bool IsLiving(uint id) { return _active.TryGetValue(id, out var art) && !art.Dead; }
        public bool TrySoundContext(uint id, out WeaponId weapon, out FactionId faction, out ActorKind kind, out MobTypeId? type)
        {
            if (_active.TryGetValue(id, out var art))
            { weapon=art.WeaponId; faction=art.Faction; kind=art.Kind; type=art.MobType; return true; }
            weapon=default; faction=default; kind=default; type=null; return false;
        }
        /// <summary>Clears local-time animation phases after a presentation clock cut.</summary>
        public void ResetTransientTimers()
        {
            foreach (var pair in _active)
            {
                var a = pair.Value;
                a.MovingUntil = a.AttackUntil = a.HitUntil = a.BlockUntil = 0;
                a.AttackAt = a.HitAt = a.BlockAt = a.DeadAt = 0;
                a.HoldDeathFrame = a.Dead;
            }
        }
        public bool TryPosition(uint id, out Vector3 position)
        {
            if (_active.TryGetValue(id, out var art)) { position = art.Root.transform.position; return true; }
            position = default; return false;
        }
        public void ConfirmedCue(uint id, FxKind kind)
        {
            if (!_active.TryGetValue(id,out var art)) return;
            float now=Time.unscaledTime;
            if(kind==FxKind.Swing)
            {
                art.AttackAt=now;
                var clip=AttackFrames(art.Appearance,art.WeaponId,out float fps);
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
        static float ClipDuration(Sprite[] clip,float fps,float fallback)
        { return clip!=null && clip.Length>0 ? clip.Length/8f/Mathf.Max(1,fps) : fallback; }
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
        }
        public void Retain(HashSet<uint> membership)
        {
            _remove.Clear(); foreach(var pair in _active) if(!membership.Contains(pair.Key)) _remove.Add(pair.Key);
            foreach(uint id in _remove) Evict(id);
        }
        void Evict(uint id)
        {
            var art=_active[id];
            art.Light.SetVisible(false);
            foreach (var icon in art.SignatureIcons) icon.enabled = false;
            foreach (var backing in art.SignatureBackers) backing.enabled = false;
            art.Barrier.enabled = false;
            foreach (var segment in art.BarrierRing) segment.enabled = false;
            art.UnknownSignature.enabled = false;
            art.UnknownSignatureBacker.enabled = false;
            art.Identity.Clear();
            art.Root.SetActive(false);
            _active.Remove(id);_pool.Push(art);
        }

        public void Present(uint id, float x, float y, float facing, float hp, FactionId faction, ActorStatus status, WeaponId weapon,
            ActorKind kind, MobTypeId? mob, ushort effects, byte signature, bool local, float barrierPct = 0f, byte barrierRingStep = 0)
        {
            if (!_active.TryGetValue(id, out var a))
            {
                a = _pool.Count > 0 ? _pool.Pop() : Create(); _active.Add(id, a);
                a.Root.SetActive(true); a.LastPosition = ArenaView.WorldPoint(x, y); a.MovingUntil = a.AttackUntil = 0;
                a.HitUntil=a.BlockUntil=0;a.Dead=false;a.HoldDeathFrame=false;
            }
            a.Stamp = _stamp;
            var position = ArenaView.WorldPoint(x, y);
            if ((position - a.LastPosition).sqrMagnitude > .000001f) a.MovingUntil = Time.unscaledTime + .12f;
            a.LastPosition = position; a.Root.transform.position = position;
            int order = 2000 + Mathf.RoundToInt(y * .5f);
            Color color = ShowcasePalette.Faction((int)faction);
            bool dead = status == ActorStatus.Dead || status == ActorStatus.Mia;
            if(dead && !a.Dead) { a.DeadAt=Time.unscaledTime; a.HoldDeathFrame=false; }
            if(!dead) a.HoldDeathFrame=false;
            a.Dead=dead;a.WeaponId=weapon; a.Faction=faction; a.Kind=kind; a.MobType=mob;
            bool isMob = kind != ActorKind.Player;
            string key = ShowcaseActorLook.AppearanceKey(kind, faction, mob);
            a.Appearance = _catalog != null ? _catalog.Find(key) : null;
            if (a.Appearance == null && _catalog != null && kind == ActorKind.Player) a.Appearance = _catalog.Find("hero");
            if (a.Appearance == null && _catalog != null) a.Appearance = _catalog.Find("knight");
            bool reduced = ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion;
            var appearance = a.Appearance;
            Sprite[] frames=appearance?.Idle;
            float fps=appearance!=null ? appearance.IdleFPS : 10;
            float elapsed=Time.unscaledTime;bool loop=true;
            if(appearance!=null)
            {
                if(dead && appearance.Death!=null && appearance.Death.Length>0)
                { frames=appearance.Death;fps=appearance.DeathFPS;elapsed-=a.DeadAt;loop=false; }
                else if(a.BlockUntil>Time.unscaledTime && appearance.Block!=null && appearance.Block.Length>0)
                { frames=appearance.Block;fps=appearance.BlockFPS;elapsed-=a.BlockAt;loop=false; }
                else if(a.HitUntil>Time.unscaledTime && appearance.Hit!=null && appearance.Hit.Length>0)
                { frames=appearance.Hit;fps=appearance.HitFPS;elapsed-=a.HitAt;loop=false; }
                else if(a.AttackUntil>Time.unscaledTime)
                { frames=AttackFrames(appearance,weapon,out fps);elapsed-=a.AttackAt;loop=false; }
                else if(a.MovingUntil>Time.unscaledTime && appearance.Walk.Length>0)
                { frames=appearance.Walk;fps=appearance.WalkFPS; }
            }
            if (frames != null && frames.Length > 0)
            {
                // Catalog arrays are direction-major, with exactly eight source directions. Facing is artwork only.
                int count = frames.Length / 8;
                // Flare: SW,W,NW,N,NE,E,SE,S; server facing zero is screen east.
                int direction = ((Mathf.RoundToInt(facing / (Mathf.PI / 4)) + 5) % 8 + 8) % 8;
                int rawFrame=Mathf.Max(0,Mathf.FloorToInt(elapsed*Mathf.Max(1,fps)));
                int frame = dead && a.HoldDeathFrame ? count - 1 :
                    reduced ? (dead ? count-1 : 0) : loop ? rawFrame%Mathf.Max(1,count) : Mathf.Min(count-1,rawFrame);
                a.Body.sprite = frames[Mathf.Min(frames.Length - 1, direction * count + frame)];
                float height = appearance.WorldHeight;
                a.Body.transform.localScale = Vector3.one * height;
                a.Body.transform.localPosition = new Vector3(0, .08f, 0);
            }
            else
            {
                a.Body.sprite = ShowcaseSprites.Get("rune");
                a.Body.transform.localScale = new Vector3(.8f, 1.35f, 1);
                a.Body.transform.localPosition = new Vector3(0, .55f, 0);
            }
            a.Body.color = dead ? new Color(.4f, .43f, .48f, .65f) : Color.Lerp(Color.white, color, isMob ? .14f : .22f);
            a.Body.sortingOrder = order;
            a.Body.transform.localRotation = Quaternion.Euler(0, 0, dead && (appearance==null || appearance.Death==null || appearance.Death.Length==0) ? 75 : 0);
            a.BodyRim.sprite = a.Body.sprite;
            a.BodyRim.transform.localPosition = a.Body.transform.localPosition + new Vector3(.01f,.005f);
            a.BodyRim.transform.localRotation = a.Body.transform.localRotation;
            a.BodyRim.transform.localScale = a.Body.transform.localScale * 1.045f;
            a.BodyRim.sortingOrder = order-1;
            a.BodyRim.color = new Color(.008f,.012f,.02f,dead ? .35f : .88f);
            a.Identity.Present((int)faction,kind,mob,order,!dead);
            a.Shadow.sortingOrder = order - 8;
            a.Halo.sortingOrder = order - 7;
            a.Halo.transform.localScale = new Vector3(local ? 1.05f : .9f, .48f, 1);
            a.Halo.sprite = FactionIndicators.GetFootprint((int)faction);
            a.Halo.color = color;
            a.Halo.enabled = true;
            a.RuneBack.sortingOrder = order + 2;
            a.RuneBack.transform.localPosition = new Vector3(-.72f, isMob ? 1.23f : 1.55f, 0);
            a.RuneBack.transform.localScale = new Vector3(.46f, .46f, 1);
            a.RuneBack.color = new Color(.008f, .012f, .022f, .96f);
            a.Rune.sortingOrder = order + 3;
            bool knownFaction = (int)faction >= 0 && (int)faction < 5;
            a.Rune.sprite = ShowcaseSprites.Get(knownFaction ? "sigil" + (int)faction : "rune");
            a.Rune.transform.localPosition = new Vector3(-.72f, isMob ? 1.23f : 1.55f, 0);
            a.Rune.transform.localRotation = Quaternion.identity;
            a.Rune.color = color;
            a.Rune.transform.localScale = new Vector3(.4f, .4f, 1);
            a.HpBack.sortingOrder = order + 4; a.Hp.sortingOrder = order + 5;
            float healthShare = dead ? 0f : Mathf.Clamp01(hp / 100f);
            float barrierShare = dead || isMob ? 0f : Mathf.Clamp01(barrierPct / 100f);
            const float unitWidth = .85f;
            float width = healthShare * unitWidth;
            float totalTrackWidth = Mathf.Max(.98f, unitWidth * (healthShare + barrierShare) + .04f);
            a.HpBack.transform.localScale = new Vector3(totalTrackWidth, .11f, 1);
            a.HpBack.transform.localPosition = new Vector3(-.49f + totalTrackWidth / 2, 1.8f, 0);
            a.Hp.transform.localScale = new Vector3(width, .055f, 1);
            a.Hp.transform.localPosition = new Vector3(-.49f + width / 2, 1.8f, 0);
            a.Hp.color = local ? new Color(.55f, .94f, .72f) : color;
            a.Hp.enabled = !dead; a.HpBack.enabled = !dead;
            float barrierWidth = barrierShare * unitWidth;
            a.Barrier.transform.localScale = new Vector3(barrierWidth, .095f, 1);
            a.Barrier.transform.localPosition = new Vector3(-.49f + width + barrierWidth / 2, 1.8f, 0);
            a.Barrier.color = (Color)ShowcasePalette.Gold;
            a.Barrier.enabled = !dead && barrierWidth > 0;
            int ringSteps = dead || isMob ? 0 : Mathf.Clamp(barrierRingStep, (byte)0, (byte)8);
            for (int i = 0; i < a.BarrierRing.Length; i++)
            {
                var segment = a.BarrierRing[i];
                segment.enabled = i < ringSteps;
                segment.color = (Color)ShowcasePalette.Gold;
                segment.sortingOrder = order + 10;
            }
            a.Weapon.sortingOrder = order + 2;
            a.Weapon.transform.localPosition = new Vector3(Mathf.Cos(facing) * .42f, .6f - Mathf.Sin(facing) * .12f, 0);
            a.Weapon.sprite = ShowcaseSprites.Get("weapon" + Mathf.Clamp((int)weapon,0,5));
            a.Weapon.transform.localRotation = Quaternion.Euler(0, 0, -facing * Mathf.Rad2Deg - 90);
            a.Weapon.transform.localScale = Vector3.one * (weapon == WeaponId.Fists ? .35f : .65f);
            a.Weapon.enabled = !dead;
            byte unknownSignature = (byte)(signature & ~KnownSignatureMask);
            bool hasUnknownSignature = unknownSignature != 0;
            a.Status.enabled = !dead && effects != 0;
            a.Status.sortingOrder = order + 6; a.Status.color = color;
            a.Status.transform.localPosition = new Vector3(.55f, 1.5f, 0);
            int shown = 0;
            for (int bit = 0; bit < a.StatusIcons.Length; bit++)
            {
                var icon = a.StatusIcons[bit]; icon.enabled = !dead && (effects & (1 << bit)) != 0;
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
        }

        Art Create()
        {
            var a = new Art { Root = new GameObject("Observed actor") };
            a.Root.transform.SetParent(_parent, false);
            var t = a.Root.transform;
            a.Shadow = ShowcaseSprites.Create(t, "Contact shadow", "shadow", 0, Color.white, new Vector2(1.2f, .45f), new Vector3(.13f, -.04f), false);
            a.Halo = ShowcaseSprites.Create(t, "Faction footprint", "ring", 1, Color.white, Vector2.one, Vector3.zero, false);
            a.Body = ShowcaseSprites.Create(t, "Authored character", "rune", 2, Color.white, Vector2.one, Vector3.zero);
            a.BodyRim = ShowcaseSprites.Create(t, "Character contrast rim", "rune", 1, Color.black, Vector2.one, Vector3.zero, false);
            a.Identity = ShowcaseIdentityOwner.Configure(t);
            a.Identity.StandaloneFactionBadge = false; // The existing tested backed faction mark remains canonical here.
            a.RuneBack = ShowcaseSprites.Create(t, "Faction insignia backplate", "bar", 2, new Color(.008f, .012f, .022f, .96f), new Vector2(.46f, .46f), Vector3.zero, false);
            a.Rune = ShowcaseSprites.Create(t, "Faction insignia", "rune", 3, Color.white, Vector2.one, Vector3.zero, false);
            a.HpBack = ShowcaseSprites.Create(t, "Health and barrier track", "bar", 4, new Color(.015f, .02f, .035f), new Vector2(.98f, .11f), new Vector3(0, 1.8f), false);
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
            return a;
        }

        static Vector3 SignatureSlotPosition(int slot) { return new Vector3(-.9f + slot * .36f, 2.4f, 0); }

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
