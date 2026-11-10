// Pure 2D presentation of delivered public facts. No collision, rules, physics or visibility inference.
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using TMPro;

namespace Roguehalla.Client
{
    public sealed class ArenaView : MonoBehaviour
    {
        public const float Scale = 1f / 32f;
        public const float GroundSquash = .78f;
        public static Vector3 WorldPoint(float x, float y) { return new Vector3(x * Scale, -y * Scale * GroundSquash, 0); }
        public bool HasMap { get; private set; }
        SpriteActorPresenter _actors;
        ConfirmedWishPresenter _wishes;
        double _sourceTimeMs;
        ShowcaseCatalog _catalog;
        Transform _mapRoot, _propsRoot, _fxRoot;
        readonly List<SpriteRenderer> _props = new List<SpriteRenderer>();
        readonly List<ShowcasePointLight> _lamps = new List<ShowcasePointLight>();
        readonly List<SpriteRenderer> _lampGlows = new List<SpriteRenderer>();
        readonly List<SpriteRenderer> _motes = new List<SpriteRenderer>();
        readonly List<SpriteRenderer> _fog = new List<SpriteRenderer>();
        readonly List<InterpActor> _latestMembership = new List<InterpActor>();
        readonly List<InterpActor> _latestNpcs = new List<InterpActor>();
        readonly HashSet<uint> _membership = new HashSet<uint>();
        readonly List<PendingFx> _pendingFx = new List<PendingFx>(64);
        // Remote-player cues held until render time reaches their tick. Bounded in count, lead and wall time; past any
        // bound a cue is shown at once (the previous on-arrival behaviour).
        const int MaxScheduledFx = 48;
        const double MaxFxLeadMs = 200; // RenderClock's 150 ms maximum delay plus one 50 ms tick
        const float MaxFxHoldSeconds = .25f;
        readonly List<PendingFx> _scheduledFx = new List<PendingFx>(MaxScheduledFx);
        double _renderMs;
        bool _renderReady;
        // The drawn timeline (Session.AttackRenderMs: render time plus the remote draw-ahead lead, never past the newest
        // snapshot). Remote windups and projectile flights are placed on it so they meet the drawn remote players.
        double _drawMs, _drawTick;
        bool _drawReady;
        // Remote ranged windups (protocol 15): the draw/cast clip is started once per windup when the drawn timeline
        // enters it, and cut only if the server ends it well before its release. Presentation only; never a rule.
        struct WindupShown { public uint StartedAt; public double ReleaseAt; public bool Live; }
        readonly Dictionary<uint, WindupShown> _windups = new Dictionary<uint, WindupShown>(64);
        readonly List<uint> _windupDrop = new List<uint>(16);
        // Projectile flights keyed by the server's track alias, drawn every frame on the drawn timeline from their anchor
        // (NetProjectileView.At). A track the server ended is kept only until the drawn timeline reaches the State that
        // ended it (bounded like scheduled Fx), so it never outlives the server's end-of-track. A retarget anchored ahead of
        // the drawn timeline keeps the previous line (Prev) until the drawn tick reaches the new anchor.
        struct ShotTrack { public NetProjectileView View, Prev; public float OffX, OffY, LastX, LastY, EndedAt; public bool Drawn, Ended, HasPrev; public uint EndTick; }
        const int MaxShots = 96;
        const float ShotBlendSeconds = .08f, MaxShotHoldSeconds = .25f;
        ShotTrack[] _shots = new ShotTrack[MaxShots], _shotsNext = new ShotTrack[MaxShots];
        int _shotCount;
        IReadOnlyList<NetProjectileView> _shotSource;
        bool _hasMembership;
        readonly List<Flash> _flashes = new List<Flash>();
        readonly Stack<Flash> _flashPool = new Stack<Flash>();
        Volume _volume;
        Light2D _ambient;
        int _used;
        Vector3 _lastFollow;
        bool _hasFollow;
        public bool IsObserved(uint id) { return _actors != null && _actors.Contains(id); }
        public bool TrySoundContext(uint id, out WeaponId weapon, out FactionId faction, out ActorKind kind, out MobTypeId? type)
        {
            if (_actors != null) return _actors.TrySoundContext(id,out weapon,out faction,out kind,out type);
            weapon=default; faction=default; kind=default; type=null; return false;
        }
        sealed class Flash { public SpriteRenderer Sprite; public TMP_Text Text; public uint Actor; public float Start, Duration; public Vector3 Position; public Color Color; public float Size; }
        struct PendingFx { public FxKind Kind; public uint Subject; public float Amount; public double DueMs; public float QueuedAt; public bool NoClip; }
        /// <summary>Own provisional attack clip state (set by MatchClient). Only used to avoid replaying a clip already started at the click.</summary>
        public OwnAttackCue OwnCue;
        /// <summary>Starts the attack clip only (no flash, number or sound) for a press the server-sent readiness says will act now.</summary>
        public void ProvisionalAttackCue(uint id) { _actors.ConfirmedCue(id, FxKind.Swing); }
        public void CancelAttackCue(uint id) { _actors.CancelAttackCue(id); }
        /// <summary>Own Wish telegraph at the press, until any server Wish cue for <paramref name="caster"/> or <paramref name="holdMs"/> (local) ends it.</summary>
        public void ProvisionalWish(uint caster, AbilityId ability, double holdMs) { _wishes.Provisional(caster, (byte)ability, holdMs); }

        void Awake()
        {
            ShowcaseSprites.Initialize();
            _catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            _actors = new SpriteActorPresenter(transform, _catalog);
            _mapRoot = Child("Authoritative map artwork"); _propsRoot = Child("Observed collections"); _fxRoot = Child("Confirmed effects");
            _wishes = new ConfirmedWishPresenter(_fxRoot, _actors);
            var global = Child("Ambient light");
            _ambient = global.gameObject.AddComponent<Light2D>(); _ambient.lightType = Light2D.LightType.Global;
            _ambient.color = new Color(.81f, .83f, .9f); _ambient.intensity = .86f;
            _volume = gameObject.AddComponent<Volume>(); _volume.isGlobal = true; _volume.priority = 2;
            var profile = Resources.Load<VolumeProfile>("Showcase/Atmosphere");
            if (profile != null) _volume.sharedProfile = profile;
            for (int i = 0; i < 32; i++) _motes.Add(ShowcaseSprites.Create(transform, "Ambient dust", "glow", 1500,
                new Color(1.6f,1.2f,.6f,.35f), new Vector2(.07f,.07f), Vector3.zero, false));
            for(int i=0;i<3;i++) _fog.Add(ShowcaseSprites.Create(transform,"Layered ambient haze","glow",29990,
                new Color(.22f,.32f,.48f,.075f),new Vector2(20,5),Vector3.zero,false));
            if (ShowcaseSettings.Current != null) ShowcaseSettings.Current.Changed += ApplyQuality;
            ApplyQuality();
        }
        Transform Child(string name) { var go = new GameObject(name); go.transform.SetParent(transform, false); return go.transform; }

        public void Build(MapBlob map)
        {
            if (HasMap) return;
            float w = map.W, h = map.H * GroundSquash;
            for (int y = 0; y < map.H; y += 4) for (int x = 0; x < map.W; x += 4)
            {
                float cw = Mathf.Min(4, map.W - x), ch = Mathf.Min(4, map.H - y);
                var ground = ShowcaseSprites.Create(_mapRoot, "Neutral carved flagstone", "bar", -100, Color.white,
                    new Vector2(cw, ch * GroundSquash), new Vector3(x + cw / 2, -(y + ch / 2) * GroundSquash));
                // Collision-only maps identify no faction or terrain. Neutral artwork is deliberate;
                // lava, ice, healing and zone treatments wait for public static-map facts.
                ground.sprite = ShowcaseBiomeArt.Floor(ShowcaseBiome.Neutral, (x/4 + y/4) % 3);
            }
            for (int y = 0; y < map.H; y++) for (int x = 0; x < map.W; x++)
            {
                byte tile = map.At(x, y); if (tile == MapBlob.Floor) continue;
                Vector3 p = WorldPoint((x + .5f) * 32, (y + .5f) * 32);
                bool wall = tile == MapBlob.Wall;
                int order = 2000 + y * 16;
                float height = wall ? .67f : .25f;
                var tint = wall ? new Color(.88f, .80f, .65f) : new Color(.48f, .56f, .60f);
                ShowcaseSprites.Create(_mapRoot, "Wall contact", "shadow", order - 5, Color.white, new Vector2(1.5f, .65f), p + new Vector3(.16f, -.26f), false);
                ShowcaseSprites.Create(_mapRoot, "Painted wall face", "stone", order, tint * .58f, new Vector2(1.02f, height + .32f), p + new Vector3(0, height / 2));
                var crown = ShowcaseSprites.Create(_mapRoot, "Beveled stone crown", "stone", order + 1, tint, new Vector2(1.02f, .7f), p + new Vector3(0, height));
                if (wall && (x+y)%4==0) { var caster = crown.gameObject.AddComponent<ShadowCaster2D>(); caster.selfShadows = false; caster.useRendererSilhouette = true; }
                bool edge = y + 1 < map.H && map.At(x, y + 1) == MapBlob.Floor || x > 0 && map.At(x - 1, y) == MapBlob.Floor || x + 1 < map.W && map.At(x + 1, y) == MapBlob.Floor;
                if (wall && edge && ((x + y * 3) % 7 == 0))
                    AddLantern(p + new Vector3(0, .32f, -1), order + 2, _lamps.Count);
                if (wall && edge && (x*7+y*3)%29==0 && _catalog!=null && _catalog.Statue!=null)
                {
                    var ornament=ShowcaseSprites.Create(_mapRoot,"Authored wall statue","bar",order+2,Color.white,Vector2.one,p);
                    ornament.sprite=_catalog.Statue; ornament.transform.localScale=Vector3.one*.85f;
                }
            }
            HasMap = true;
            ApplyQuality();
        }
        static float Hash(int x, int y) { unchecked { uint h = (uint)(x * 73856093 ^ y * 19349663); return (h & 255) / 255f; } }

        void AddLantern(Vector3 p, int order, int index)
        {
            var color = new Color(1, .57f, .22f);
            ShowcaseSprites.Create(_mapRoot, "Iron brazier", "stone", order, new Color(.28f, .22f, .17f), new Vector2(.3f, .38f), p);
            ShowcaseSprites.Create(_mapRoot, "Flame", "spark", order + 1, new Color(2, 1.1f, .4f), new Vector2(.22f, .4f), p + new Vector3(0, .17f), false);
            var glow = ShowcaseSprites.Create(_mapRoot, "Ember haze", "glow", order + 2, new Color(1, .4f, .1f, .35f), new Vector2(1.8f, 1.8f), p, false);
            _lampGlows.Add(glow);
            var light = ShowcaseSprites.CreateLight(_mapRoot, "Static torch light", p);
            light.Configure(color, 2.3f, .3f, 4.8f, .6f, true);
            _lamps.Add(light);
        }

        public void Present(List<InterpActor> remote, SelfView me, LocalMotion motion, float aimAngle)
        {
            _actors.Begin();
            uint mine = me != null ? me.Id : 0;
            foreach (var a in remote)
            {
                if (a.Id == mine) continue;
                if (_hasMembership && !_membership.Contains(a.Id)) continue;
                // NPC observer handles may renew on every observation. Never infer continuity
                // from appearance or position; draw their latest typed public facts instead.
                if (_hasMembership && a.Kind != ActorKind.Player) continue;
                _actors.Present(a.Id, a.X, a.Y, a.Facing, a.HpPct, a.Faction, a.Status, a.Weapon, a.Kind, a.MobType, a.Effects, a.SourceSig, false, a.BarrierPct, a.BarrierRingStep);
                if (_drawReady) PresentWindup(a.Id, a.Windup, _drawMs);
            }
            if (_hasMembership) PresentLatestNpcs();
            if (me != null && (!_hasMembership || _membership.Contains(me.Id)))
            {
                bool initialized = motion != null && motion.Initialized;
                OwnerVitalBars.Percent(me, out float healthPercent, out float barrierPercent);
                _actors.Present(me.Id, initialized ? motion.DrawnX : me.X, initialized ? motion.DrawnY : me.Y, aimAngle, healthPercent,
                    me.Faction, me.Status, me.Weapon, ActorKind.Player, null, me.Effects, me.SelfSig, true, barrierPercent, me.BarrierRingStep);
            }
            _actors.End();
            ReleaseScheduledFx();
            UpdateEffects();
            _wishes.Tick(_sourceTimeMs);
        }

        /// <summary>Latest membership wins over delayed interpolation, before the frame is rendered.</summary>
        public void RefreshVisibility(Session session)
        {
            _sourceTimeMs = session != null ? session.ServerTimeMs : 0;
            _renderReady = session != null && session.Clock.Ready;
            _renderMs = _renderReady ? session.Clock.RenderMs : 0;
            var latest = session != null ? session.Latest : null;
            _drawReady = _renderReady && latest != null;
            _drawMs = _drawReady ? session.AttackRenderMs : 0;
            // Sim tick on the drawn timeline, anchored on the newest snapshot so a source-time override is respected.
            _drawTick = _drawReady ? latest.Tick + (_drawMs - latest.ServerMs) / Wire.TickMs : 0;
            _latestMembership.Clear();
            if(session!=null && session.Snapshots.Count>0)
            {
                session.Snapshots.Sample(session.Snapshots.NewestMs,_latestMembership);
                RetainObservedActors(_latestMembership,session.Me);
            }
            else RetainObservedActors(_latestMembership,null); // Welcome/resume resets the observation timeline.
        }
        public void RetainObservedActors(List<InterpActor> current,SelfView me)
        {
            _membership.Clear(); _latestNpcs.Clear();
            foreach(var actor in current)
            {
                _membership.Add(actor.Id);
                if(actor.Kind != ActorKind.Player) _latestNpcs.Add(actor);
            }
            if(me!=null) _membership.Add(me.Id);
            _hasMembership=true; _actors.Retain(_membership);
            _windupDrop.Clear();
            foreach(var pair in _windups) if(!_membership.Contains(pair.Key)) _windupDrop.Add(pair.Key);
            foreach(uint id in _windupDrop) _windups.Remove(id);
            _wishes.Retain(_membership);
            // This also runs after Poll/Present, before rendering, so new observer handles
            // are visible immediately and removed handles leave no cosmetic residue.
            PresentLatestNpcs();
            foreach(var fx in _pendingFx) PresentFx(fx);
            _pendingFx.Clear();
            UpdateEffects();
        }
        void PresentLatestNpcs()
        {
            foreach(var a in _latestNpcs)
            {
                _actors.Present(a.Id,a.X,a.Y,a.Facing,a.HpPct,a.Faction,a.Status,a.Weapon,a.Kind,a.MobType,a.Effects,a.SourceSig,false,a.BarrierPct,a.BarrierRingStep);
                // NPCs are drawn at their newest delivered pose, so their windup uses the newest server time.
                if(_drawReady) PresentWindup(a.Id,a.Windup,_sourceTimeMs);
            }
        }

        /// <summary>
        /// Shows a server-sent ranged windup (bow draw or wand cast) through the existing attack clip path at the moment the
        /// given timeline (server sim ms, the clock of <see cref="WireWindup.StartedAt"/>) enters it. No hit, release or
        /// projectile is implied: the arrow or bolt is drawn only from the server's projectile tracks.
        /// </summary>
        void PresentWindup(uint id, WireWindup w, double atMs)
        {
            bool has = _windups.TryGetValue(id, out var seen);
            if (w.Active && atMs >= w.StartedAt && atMs < w.ReleaseAt)
            {
                if (has && seen.Live && seen.StartedAt == w.StartedAt) return;
                _actors.ConfirmedCue(id, FxKind.Swing); // bow Shoot or wand Cast clip, chosen by the drawn weapon
                _windups[id] = new WindupShown { StartedAt = w.StartedAt, ReleaseAt = w.ReleaseAt, Live = true };
                return;
            }
            if (!has || !seen.Live || w.Active && w.StartedAt == seen.StartedAt) return;
            // The shown windup is gone. Well before its release time the server cancelled it (stun, swap, death): cut the
            // clip. Near the release it simply released (the sample may lead the release by up to a tick).
            if (atMs < seen.ReleaseAt - 2 * Wire.TickMs) _actors.CancelAttackCue(id);
            seen.Live = false; _windups[id] = seen;
        }

        public void PresentCollections(CollectionsView collections)
        {
            _used = 0;
            if (collections != null)
            {
                foreach (var f in collections.Fields)
                {
                    Color c = FieldColor(f.Ability);
                    if (f.Radius > 0) Prop("ring", WorldPoint(f.X, f.Y), new Vector2(f.Radius * Scale * 2, f.Radius * Scale * 2 * GroundSquash), c, 1200);
                    if (f.Kind == AreaKind.Trail)
                    {
                        Vector3 a = WorldPoint(f.X, f.Y), b = WorldPoint(f.X2, f.Y2), d = b - a;
                        var line = Prop("bar", (a + b) / 2, new Vector2(d.magnitude, .07f), c, 1201);
                        line.transform.rotation = Quaternion.Euler(0, 0, Mathf.Atan2(d.y, d.x) * Mathf.Rad2Deg);
                    }
                }
                foreach (var p in collections.Props)
                {
                    var position = WorldPoint(p.X, p.Y); int order = 2000 + Mathf.RoundToInt(p.Y * .5f);
                    Prop("shadow", position + new Vector3(.1f, -.03f), new Vector2(.9f, .35f), Color.white, order - 3);
                    if (p.Kind == PropAppearance.Ground)
                    {
                        // Ground weapons are the protocol's five carried weapon ids. Unsupported or absent
                        // values get a neutral stone cue and never borrow a known weapon glyph.
                        int weapon = p.Weapon.HasValue ? (int)p.Weapon.Value : -1;
                        string glyph = weapon >= 0 && weapon <= 4 ? "weapon" + weapon : "stone";
                        Color tint = weapon >= 0 && weapon <= 4 ? ShowcasePalette.Gold : ShowcasePalette.MutedText;
                        Prop(glyph, position + new Vector3(0, .22f), new Vector2(.48f, .48f), tint, order);
                    }
                    else if (p.Kind == PropAppearance.WindEmblem)
                    {
                        // A ring, rune and small spark form a wind marker distinct from both weapons and cannon.
                        Prop("ring", position, new Vector2(.72f, .58f), ShowcasePalette.Faction(3), order);
                        Prop("rune", position + new Vector3(0, .13f), new Vector2(.42f, .42f), ShowcasePalette.Text, order + 1);
                        Prop("spark", position + new Vector3(.25f, .2f), new Vector2(.2f, .28f), ShowcasePalette.MutedText, order + 2);
                    }
                    else if (p.Kind == PropAppearance.Cannon)
                    {
                        // Reuse the neutral bar, stone and ring shapes for a compact cannon silhouette.
                        Prop("stone", position + new Vector3(-.02f, .04f), new Vector2(.62f, .34f), ShowcasePalette.MutedText, order);
                        Prop("bar", position + new Vector3(.25f, .15f), new Vector2(.48f, .12f), ShowcasePalette.Text, order + 1);
                        Prop("ring", position + new Vector3(-.2f, -.14f), new Vector2(.2f, .2f), ShowcasePalette.PanelStroke, order + 2);
                        Prop("ring", position + new Vector3(.2f, -.14f), new Vector2(.2f, .2f), ShowcasePalette.PanelStroke, order + 2);
                    }
                    else
                    {
                        string sprite = p.Kind == PropAppearance.Chest ? "chest" : p.Kind == PropAppearance.Body || p.Kind == PropAppearance.Corpse ? "stone" : "rune";
                        var art = Prop(sprite, position + new Vector3(0, .22f), new Vector2(.78f, p.Kind == PropAppearance.Body ? .3f : .6f), Color.white, order);
                        if (p.Kind == PropAppearance.Chest)
                        {
                            if (_catalog != null && _catalog.Chest != null) { art.sprite = _catalog.Chest; art.transform.position = position; art.transform.localScale = Vector3.one * 1.3f; }
                            // Open is a delivered boolean fact: show a dark opening and raised lid without
                            // inferring contents, eligibility, or timing.
                            if (p.Open)
                            {
                                Prop("bar", position + new Vector3(0, .12f), new Vector2(.48f, .12f), ShowcasePalette.Panel, order + 1);
                                Prop("bar", position + new Vector3(0, .32f), new Vector2(.62f, .08f), ShowcasePalette.GoldDim, order + 2);
                            }
                        }
                    }
                    if (p.Focused) Prop("ring", position, new Vector2(1.25f, .65f), new Color(.9f, .95f, 1), order - 2);
                }
                foreach (var chest in collections.RewardChests)
                {
                    var p = WorldPoint(chest.X, chest.Y); int order = 2000 + Mathf.RoundToInt(chest.Y * .5f);
                    Prop("glow", p, new Vector2(2, 1), new Color(1, .67f, .2f, chest.Picked ? .08f : .35f), order - 2);
                    var art=Prop("chest", p + new Vector3(0, .25f), new Vector2(.9f, .8f), chest.Picked ? new Color(.48f, .48f, .48f) : Color.white, order);
                    if(_catalog!=null && _catalog.Chest!=null) {art.sprite=_catalog.Chest;art.transform.position=p;art.transform.localScale=Vector3.one*1.6f;}
                    if (chest.CanChoose) Prop("rune", p + new Vector3(0, 1), new Vector2(.3f, .4f), new Color(1, .85f, .46f), order + 2);
                }
            }
            SyncShots(collections);
            DrawShots();
            for (int i = _used; i < _props.Count; i++) _props[i].gameObject.SetActive(false);
        }

        /// <summary>
        /// Merges a newly applied projectile list (a complete replacement per State) into the drawn tracks, keyed by alias.
        /// A changed line on a kept alias (a homing retarget) blends from the drawn point onto the new line; a missing alias
        /// is the server's end-of-track. Runs only when the list instance changes; allocation-free.
        /// </summary>
        void SyncShots(CollectionsView collections)
        {
            var rows = collections != null ? collections.Projectiles : null;
            if (ReferenceEquals(rows, _shotSource)) return;
            _shotSource = rows;
            uint endTick = collections != null ? collections.Tick : 0;
            float now = Time.unscaledTime;
            int n = 0;
            if (rows != null)
                for (int i = 0; i < rows.Count && n < MaxShots; i++)
                {
                    var v = rows[i];
                    var s = new ShotTrack { View = v };
                    int old = FindLiveShot(v.Track);
                    if (old >= 0)
                    {
                        var o = _shots[old];
                        s.OffX = o.OffX; s.OffY = o.OffY; s.LastX = o.LastX; s.LastY = o.LastY; s.Drawn = o.Drawn;
                        s.Prev = o.Prev; s.HasPrev = o.HasPrev;
                        bool retarget = o.View.X != v.X || o.View.Y != v.Y || o.View.Facing != v.Facing || o.View.Speed != v.Speed || o.View.Tick != v.Tick;
                        // Keep drawing the line already on screen until the drawn timeline reaches the new anchor (DrawShots).
                        if (retarget && o.Drawn && !o.HasPrev) { s.Prev = o.View; s.HasPrev = true; }
                    }
                    _shotsNext[n++] = s;
                }
            for (int i = 0; i < _shotCount && n < MaxShots; i++)
            {
                var o = _shots[i];
                if (collections != null && collections.TryGetProjectile(o.View.Track, out _)) continue; // live (merged above)
                if (!o.Ended) { o.Ended = true; o.EndTick = endTick; o.EndedAt = now; }
                _shotsNext[n++] = o;
            }
            var swap = _shots; _shots = _shotsNext; _shotsNext = swap;
            _shotCount = n;
        }
        int FindLiveShot(uint track)
        {
            for (int i = 0; i < _shotCount; i++) if (!_shots[i].Ended && _shots[i].View.Track == track) return i;
            return -1;
        }
        /// <summary>A server line at the drawn tick (the library rule, never a local physics step).</summary>
        void ShotLine(in NetProjectileView v, out float x, out float y)
        {
            if (_drawReady) v.At(_drawTick, out x, out y);
            else { x = v.X; y = v.Y; }
        }
        void DrawShots()
        {
            const double MaxLeadTicks = MaxFxLeadMs / Wire.TickMs;
            float now = Time.unscaledTime, decay = Mathf.Exp(-Time.unscaledDeltaTime / ShotBlendSeconds);
            int keep = 0;
            for (int i = 0; i < _shotCount; i++)
            {
                var s = _shots[i];
                // An ended flight lasts until the drawn timeline reaches the State that ended it, within the Fx bounds.
                if (s.Ended && (!_drawReady || _drawTick >= s.EndTick || s.EndTick - _drawTick > MaxLeadTicks || now - s.EndedAt > MaxShotHoldSeconds))
                    continue;
                s.OffX *= decay; s.OffY *= decay;
                if (s.HasPrev && (!_drawReady || _drawTick >= s.View.Tick || s.View.Tick - _drawTick > MaxLeadTicks))
                {
                    // The drawn timeline reached the retarget: switch lines, blending from the drawn point.
                    s.HasPrev = false;
                    ShotLine(s.View, out float nx, out float ny);
                    s.OffX = s.LastX - nx; s.OffY = s.LastY - ny;
                }
                // A new flight anchored ahead of the drawn timeline waits for it, so it leaves the bow when the drawn archer
                // releases. One anchored in the past (lag compensation) appears at its current point on the line.
                bool due = s.Drawn || !_drawReady || _drawTick >= s.View.Tick || s.View.Tick - _drawTick > MaxLeadTicks;
                if (due)
                {
                    float x, y, facing;
                    if (s.HasPrev) { ShotLine(s.Prev, out x, out y); facing = s.Prev.Facing; }
                    else { ShotLine(s.View, out x, out y); facing = s.View.Facing; }
                    x += s.OffX; y += s.OffY;
                    s.LastX = x; s.LastY = y; s.Drawn = true;
                    bool arrow = s.View.Kind == ProjectileKind.Arrow;
                    var r = Prop(arrow ? "spark" : "glow", WorldPoint(x, y), arrow ? new Vector2(.6f, .14f) : new Vector2(.7f, .7f),
                        arrow ? new Color(1.6f, 1.25f, .6f) : new Color(1.5f, .55f, 2), 29000);
                    r.transform.rotation = Quaternion.Euler(0, 0, -facing * Mathf.Rad2Deg);
                }
                _shots[keep++] = s;
            }
            _shotCount = keep;
        }
        SpriteRenderer Prop(string sprite, Vector3 p, Vector2 scale, Color color, int order)
        {
            SpriteRenderer r;
            if (_used == _props.Count) { r = ShowcaseSprites.Create(_propsRoot, "Observed artwork", sprite, order, color, scale, p, false); _props.Add(r); }
            else r = _props[_used];
            _used++; r.gameObject.SetActive(true); r.sprite = ShowcaseSprites.Get(sprite); r.color = color; r.sortingOrder = order;
            r.sharedMaterial = ShowcaseSprites.Unlit;
            r.transform.position = p; r.transform.localScale = new Vector3(scale.x, scale.y, 1); r.transform.rotation = Quaternion.identity;
            return r;
        }
        static Color FieldColor(AbilityId ability)
        {
            int i = ability == AbilityId.Blaze ? 0 : ability == AbilityId.Trial ? 1 : ability == AbilityId.Swarm ? 2 : ability == AbilityId.Freeze ? 3 : 4;
            return ShowcasePalette.Faction(i);
        }
        public void ConfirmedFx(ServerMsg.Fx fx) { ConfirmedFx(fx, 0, double.NaN); }
        /// <summary>
        /// Cues on a remote player drawn by interpolation wait until render time reaches <paramref name="dueMs"/> (source ms
        /// of the Fx tick), so they meet the drawn pose. Cues involving <paramref name="owner"/>, NPCs (drawn at their newest
        /// position) and NaN <paramref name="dueMs"/> are shown on arrival.
        /// </summary>
        public void ConfirmedFx(ServerMsg.Fx fx, uint owner, double dueMs)
        {
            if (fx == null) return;
            foreach (var f in fx.List)
            {
                if (f.Kind == FxKind.WishStarted || f.Kind == FxKind.WishLanded || f.Kind == FxKind.WishEnded)
                {
                    _wishes.Accept(f);
                    continue;
                }
                uint subject = f.Kind == FxKind.Hit ? f.Victim : f.Kind == FxKind.Stagger || f.Kind == FxKind.Block ? f.Id : f.By;
                var cue=new PendingFx{Kind=f.Kind,Subject=subject,Amount=f.Amount};
                bool own = owner != 0 && (subject == owner || f.By == owner || f.Victim == owner);
                // The own clip already started at the click: the server's swing keeps its flash but does not restart the clip.
                if (f.Kind == FxKind.Swing && own && subject == owner && OwnCue != null &&
                    OwnCue.AbsorbServerSwing(Time.realtimeSinceStartupAsDouble * 1000.0)) cue.NoClip = true;
                if (!own && _renderReady && dueMs > _renderMs && dueMs - _renderMs <= MaxFxLeadMs &&
                    _scheduledFx.Count < MaxScheduledFx && _actors.Contains(subject) && !IsLatestNpc(subject))
                {
                    cue.DueMs = dueMs; cue.QueuedAt = Time.unscaledTime;
                    _scheduledFx.Add(cue);
                    continue;
                }
                if (_actors.Contains(subject)) PresentFx(cue);
                else if(_pendingFx.Count<64) _pendingFx.Add(cue); // Copy scalars; decoded messages are recycled.
            }
        }
        bool IsLatestNpc(uint id)
        {
            foreach (var a in _latestNpcs) if (a.Id == id) return true;
            return false;
        }
        /// <summary>Called after this frame's poses are drawn; compacts in place without allocating.</summary>
        void ReleaseScheduledFx()
        {
            int keep = 0; float now = Time.unscaledTime;
            for (int i = 0; i < _scheduledFx.Count; i++)
            {
                var cue = _scheduledFx[i];
                bool due = !_renderReady || cue.DueMs <= _renderMs || cue.DueMs - _renderMs > MaxFxLeadMs || now - cue.QueuedAt > MaxFxHoldSeconds;
                if (!due) { _scheduledFx[keep++] = cue; continue; }
                if (_actors.Contains(cue.Subject)) PresentFx(cue); // An actor that left view drops its cue.
            }
            _scheduledFx.RemoveRange(keep, _scheduledFx.Count - keep);
        }
        /// <summary>A clock epoch cut clears cosmetics only; latest membership and collections remain intact.</summary>
        public void ResetTransientPresentation(double serverTimeMs = 0)
        {
            _sourceTimeMs = serverTimeMs;
            _pendingFx.Clear();
            _scheduledFx.Clear();
            _windups.Clear();
            _shotCount = 0; _shotSource = null;
            _wishes.Reset();
            OwnCue?.Reset();
            for (int i = _flashes.Count - 1; i >= 0; i--)
            {
                var flash = _flashes[i];
                flash.Sprite.gameObject.SetActive(false); flash.Text.gameObject.SetActive(false);
                _flashes.RemoveAt(i); _flashPool.Push(flash);
            }
            _actors.ResetTransientTimers();
        }

        void PresentFx(PendingFx f)
        {
                if (!_actors.TryPosition(f.Subject, out var p)) return;
                if (!f.NoClip) _actors.ConfirmedCue(f.Subject,f.Kind);
                if (_flashes.Count >= 48) return;
                var flash = _flashPool.Count > 0 ? _flashPool.Pop() : CreateFlash();
                flash.Actor = f.Subject; flash.Position = p + new Vector3(0, .65f); flash.Start = Time.unscaledTime; flash.Duration = f.Kind==FxKind.Hit ? .55f : .2f;
                flash.Size = f.Kind == FxKind.Swing ? 1.25f : .8f;
                flash.Color = f.Kind == FxKind.Block ? new Color(.65f, .85f, 2) : new Color(2, 1.4f, .6f);
                flash.Sprite.gameObject.SetActive(true);
                flash.Text.gameObject.SetActive(f.Kind==FxKind.Hit);
                if(f.Kind==FxKind.Hit) flash.Text.text=Mathf.RoundToInt(f.Amount).ToString(System.Globalization.CultureInfo.InvariantCulture);
                _flashes.Add(flash);
        }
        void UpdateEffects()
        {
            bool reduced = ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion;
            for (int i = _flashes.Count - 1; i >= 0; i--)
            {
                var f = _flashes[i]; float t = (Time.unscaledTime - f.Start) / f.Duration;
                if (t >= 1 || !_actors.Contains(f.Actor)) { f.Sprite.gameObject.SetActive(false); f.Text.gameObject.SetActive(false); _flashes.RemoveAt(i); _flashPool.Push(f); continue; }
                f.Sprite.transform.position = f.Position;
                f.Sprite.transform.localScale = Vector3.one * f.Size * (reduced ? 1 : 1 + t * .55f);
                // Keep the silhouette readable even when confirmed hits overlap rapidly.
                // Damage text retains its longer lifetime; the hollow impact rim fades quickly.
                var c = f.Color; c.a = .55f * Mathf.Clamp01(1 - (Time.unscaledTime - f.Start) / .16f); f.Sprite.color = c;
                f.Text.transform.position=f.Position+new Vector3(0,.7f+(reduced ? 0 : t*.35f),0); f.Text.color=new Color(1,.9f,.65f,1-t);
            }
        }
        Flash CreateFlash()
        {
            var sprite=ShowcaseSprites.Create(_fxRoot,"Confirmed impact","ring",30000,Color.white,Vector2.one,Vector3.zero,false);
            var go=new GameObject("Confirmed damage amount");go.transform.SetParent(_fxRoot,false);
            var text=go.AddComponent<TextMeshPro>();text.font=TMP_Settings.defaultFontAsset;text.fontSize=3;text.alignment=TextAlignmentOptions.Center;
            text.rectTransform.sizeDelta=new Vector2(3,1);text.GetComponent<MeshRenderer>().sortingOrder=30001;
            go.SetActive(false);
            return new Flash{Sprite=sprite,Text=text};
        }
        public void Follow(Camera cam, float serverX, float serverY)
        {
            var p = WorldPoint(serverX, serverY); cam.transform.position = new Vector3(p.x, p.y + 1.5f, -30);
            cam.transform.rotation = Quaternion.identity;
            _lastFollow = p; _hasFollow = true;
            UpdateLampVisibility(p);
            int budget = ShowcaseSettings.Current == null || ShowcaseSettings.Current.EffectiveQuality == ShowcaseQuality.High ? 6 : ShowcaseSettings.Current.EffectiveQuality == ShowcaseQuality.Medium ? 3 : 0;
            bool motion = ShowcaseSettings.Current == null || !ShowcaseSettings.Current.ReducedMotion;
            for(int i=0;i<_motes.Count;i++)
            {
                var m = _motes[i]; m.enabled = budget > 0;
                float t = motion ? Time.unscaledTime * .03f : 0;
                m.transform.position = p + new Vector3(Mathf.Repeat(i*7.31f+t,32)-16, Mathf.Repeat(i*3.71f+t*.7f,18)-9,0);
            }
            for(int i=0;i<_fog.Count;i++)
            {
                _fog[i].enabled=budget>0;
                float t=motion ? Time.unscaledTime*.04f : 0;
                _fog[i].transform.position=p+new Vector3(Mathf.Sin(t+i*2)*6,(i-1)*5,0);
            }
        }
        void UpdateLampVisibility(Vector3 p)
        {
            int budget = ShowcaseSettings.Current == null || ShowcaseSettings.Current.EffectiveQuality == ShowcaseQuality.High ? 6 : ShowcaseSettings.Current.EffectiveQuality == ShowcaseQuality.Medium ? 3 : 0;
            int count = 0;
            foreach (var lamp in _lamps)
            {
                bool near = Mathf.Abs(lamp.transform.position.x - p.x) < 18 && Mathf.Abs(lamp.transform.position.y - p.y) < 12;
                lamp.SetVisible(near && count++ < budget);
            }
        }
        public bool ScreenToServer(Camera cam, Vector2 screen, out float sx, out float sy)
        {
            var p = cam.ScreenToWorldPoint(new Vector3(screen.x, screen.y, -cam.transform.position.z));
            sx = p.x / Scale; sy = -p.y / (Scale * GroundSquash);
            return !float.IsNaN(sx) && !float.IsNaN(sy);
        }
        void ApplyQuality()
        {
            var quality = ShowcaseSettings.Current != null ? ShowcaseSettings.Current.EffectiveQuality : ShowcaseQuality.High;
            if (_volume != null) _volume.enabled = quality != ShowcaseQuality.Low;
            if (_ambient != null) _ambient.intensity = quality == ShowcaseQuality.Low ? 1 : quality==ShowcaseQuality.Medium ? .6f : .36f;
            foreach (var glow in _lampGlows) glow.enabled = quality != ShowcaseQuality.Low;
            foreach (var light in _lamps) { light.SetShadows(quality == ShowcaseQuality.High); light.ApplyQuality(); }
            if (_hasFollow) UpdateLampVisibility(_lastFollow);
        }
        void OnDestroy() { if (ShowcaseSettings.Current != null) ShowcaseSettings.Current.Changed -= ApplyQuality; }
    }
}
