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
        /// <summary>Region and terrain lookup for the lighting, particle and music systems; see <see cref="RegionMap"/>.</summary>
        public RegionMap Regions { get; } = new RegionMap();
        /// <summary>"What is the character standing on" (snow, sand, mud, shallow water, bog...); see <see cref="SurfaceMap"/>.</summary>
        public SurfaceMap Surfaces { get { return _surfaces ?? (_surfaces = new SurfaceMap(Regions)); } }
        SurfaceMap _surfaces;
        /// <summary>Region at a Unity world position (the space <see cref="WorldPoint"/> returns); None when the map has no region plane.</summary>
        public RegionId RegionAt(Vector3 worldPos) { return Regions.RegionAt(worldPos); }
        /// <summary>Region under the local player (debounced); None until the first position is known.</summary>
        public RegionId LocalRegion { get { return Regions.LocalRegion; } }
        /// <summary>Raised (previous, current) when the local player enters another region.</summary>
        public event System.Action<RegionId, RegionId> LocalRegionChanged { add { Regions.LocalRegionChanged += value; } remove { Regions.LocalRegionChanged -= value; } }
        RegionGround _regionGround; RegionWalls _regionWalls; RegionProps _regionProps;
        /// <summary>Brightness multiplier for region ground and walls (they are lit by the same Light2D set as the actors).</summary>
        public const float RegionExposure = 1f;
        SpriteActorPresenter _actors;
        VisionFog _visionFog;     // fog of war layer (VisionFog.cs); presentation only
        Session _visionSession;
        // Diagnostics only (url flag vision.fadeDemo=1): every 6 s the nearest remote player is withheld for 2.5 s, as if the server stopped
        // sending it, so the exit and entry fades can be captured on screen. It goes through the real departure path; it never runs by default.
        bool _fadeDemo; uint _demoId; float _demoNext = 8f, _demoUntil;
        ConfirmedWishPresenter _wishes;
        WishFxPresenter _wishFx;
        bool _collectWishNotes;
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
        bool _hasMembership;
        readonly List<Flash> _flashes = new List<Flash>();
        readonly Stack<Flash> _flashPool = new Stack<Flash>();
        Volume _volume;
        Light2D _ambient;
        RegionAtmosphere _atmos;
        Color _fogColor = new Color(.22f, .32f, .48f, .075f);
        /// <summary>Region atmosphere driver (light, grading, haze, particles, accent lights, shadows, audio).</summary>
        public RegionAtmosphere Atmosphere { get { return _atmos; } }
        void ApplyHaze(Color c) { _fogColor = c; for (int i = 0; i < _fog.Count; i++) if (_fog[i] != null) _fog[i].color = c; }
        int _used;
        Vector3 _lastFollow;
        float _smoothX, _smoothY;
        bool _smoothValid;
        /// <summary>Legacy CameraFollow constants: tau 35 ms, cut over 256 u or after a gap of more than 250 ms.</summary>
        const float FollowTauSeconds = .035f, FollowCutUnits = 256f, FollowMaxDt = .25f;
        bool _hasFollow;
        /// <summary>Observed actors currently presented (perf recorder context).</summary>
        public int ObservedActorCount { get { return _actors != null ? _actors.ActiveCount : 0; } }
        public bool IsObserved(uint id) { return _actors != null && _actors.Contains(id); }
        public bool TrySoundContext(uint id, out WeaponId weapon, out FactionId faction, out ActorKind kind, out MobTypeId? type)
        {
            if (_actors != null) return _actors.TrySoundContext(id,out weapon,out faction,out kind,out type);
            weapon=default; faction=default; kind=default; type=null; return false;
        }
        sealed class Flash { public SpriteRenderer Sprite; public TMP_Text Text; public uint Actor; public float Start, Duration; public Vector3 Position; public Color Color; public float Size; }
        struct PendingFx { public FxKind Kind; public uint Subject; public float Amount; public double DueMs; public float QueuedAt; }

        void Awake()
        {
            ShowcaseSprites.Initialize();
            _catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            _actors = new SpriteActorPresenter(transform, _catalog);
            _visionFog = new VisionFog(transform); _actors.Delivered = _membership; _actors.OnDeparted = _visionFog.AuditDeparture; _actors.OnArrived = _visionFog.AuditArrival;
            _visionFog.AuditLog = Application.absoluteURL != null && Application.absoluteURL.Contains("vision.audit=1");
            _visionFog.DebugRadiusTiles = DebugRadiusFlag(Application.absoluteURL);
            _fadeDemo = Application.absoluteURL != null && Application.absoluteURL.Contains("vision.fadeDemo=1");
            _mapRoot = Child("Authoritative map artwork"); _propsRoot = Child("Observed collections"); _fxRoot = Child("Confirmed effects");
            _wishes = new ConfirmedWishPresenter(_fxRoot, _actors);
            _wishFx = new WishFxPresenter(Child("Wish effects"), _actors);
            var global = Child("Ambient light");
            _ambient = global.gameObject.AddComponent<Light2D>(); _ambient.lightType = Light2D.LightType.Global;
            _ambient.color = new Color(.81f, .83f, .9f); _ambient.intensity = .86f;
            _volume = gameObject.AddComponent<Volume>(); _volume.isGlobal = true; _volume.priority = 2;
            var profile = Resources.Load<VolumeProfile>("Showcase/Atmosphere");
            if (profile != null) _volume.sharedProfile = profile;
            AtmosphereQuality.Initialize();
            _atmos = gameObject.AddComponent<RegionAtmosphere>();
            for (int i = 0; i < 32; i++) _motes.Add(ShowcaseSprites.Create(transform, "Ambient dust", "glow", 1500,
                new Color(1.6f,1.2f,.6f,.35f), new Vector2(.07f,.07f), Vector3.zero, false));
            for(int i=0;i<3;i++) _fog.Add(ShowcaseSprites.Create(transform,"Layered ambient haze","glow",29990,
                new Color(.22f,.32f,.48f,.075f),new Vector2(20,5),Vector3.zero,false));
            _atmos.Bind(this, _ambient, _volume, ApplyHaze);
            if (ShowcaseSettings.Current != null) ShowcaseSettings.Current.Changed += ApplyQuality;
            ApplyQuality();
        }
        Transform Child(string name) { var go = new GameObject(name); go.transform.SetParent(transform, false); return go.transform; }

        public void Build(MapBlob map)
        {
            if (HasMap) return;
            Regions.Load(map);
            if (_atmos != null) _atmos.OnMapBuilt(map);
            _visionFog.Configure(map);
            if (map.Regions != null && map.Regions.Length == map.W * map.H) { BuildRegionMap(map); return; }
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
        /// <summary>Region-aware map: one ground quad, row-batched walls and deterministic props. Used when the map carries the region plane.</summary>
        void BuildRegionMap(MapBlob map)
        {
            var temple = TempleLayout.For(map); var plague = PlagueGround.Build(map);
            Debug.Log("[regions] " + temple.Describe() + "; plague ground: " + plague.MudTiles + " mud, " + plague.GrassTiles + " grass, " + plague.WaterTiles + " shallow water tiles; terrain mode " + map.TerrainMode);
            Surfaces.ClearLayers(); Surfaces.AddLayer(temple); Surfaces.AddLayer(plague);          // decorative surfaces for SurfaceMap (never override real terrain)
            _regionGround = RegionGround.Create(_mapRoot, map, RegionExposure, temple, plague);
            if (temple.Found) AddTempleEmblem(temple);
            _regionWalls = RegionWalls.Build(_mapRoot, map, RegionExposure);
            _regionProps = RegionProps.Build(_mapRoot, map);
            HasMap = true;
            ApplyQuality();
        }
        /// <summary>The Holy faction's own icon inlaid at the centre of the temple medallion (flat on the floor, under actors).</summary>
        void AddTempleEmblem(TempleLayout temple)
        {
            var glyph = ShowcaseIdentityAssets.GetFactionGlyph((int)FactionId.Holy);
            if (glyph == null) return;
            var c = temple.Center;
            var r = ShowcaseSprites.Create(_mapRoot, "Temple emblem (Holy faction icon)", "bar", -90, new Color(1f, .93f, .62f, .95f), Vector2.one, new Vector3(c.x, -c.y * GroundSquash, 0), false);
            r.sprite = glyph;
            float side = Mathf.Max(glyph.bounds.size.x, glyph.bounds.size.y, .01f);
            r.transform.localScale = new Vector3(1.7f / side, 1.7f / side * GroundSquash, 1f);
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
            _wishFx.BeginFrame(); _wishFx.SetOwner(mine);
            foreach (var a in remote)
            {
                if (a.Id == mine) continue;
                if (_hasMembership && !_membership.Contains(a.Id)) continue;
                // NPC observer handles may renew on every observation. Never infer continuity
                // from appearance or position; draw their latest typed public facts instead.
                if (_hasMembership && a.Kind != ActorKind.Player) continue;
                _actors.Present(a.Id, a.X, a.Y, a.Facing, a.HpPct, a.Faction, a.Status, a.Weapon, a.Kind, a.MobType, a.Effects, a.SourceSig, false, a.BarrierPct, a.BarrierRingStep);
                _wishFx.NoteActor(a.Id, a.Kind, a.Effects, a.Status != ActorStatus.Dead && a.Status != ActorStatus.Mia);
                if (_regionProps != null) _regionProps.NoteActor(WorldPoint(a.X, a.Y));
            }
            if (_hasMembership) { _collectWishNotes = true; PresentLatestNpcs(); _collectWishNotes = false; }
            if (me != null && (!_hasMembership || _membership.Contains(me.Id)))
            {
                bool initialized = motion != null && motion.Initialized;
                OwnerVitalBars.Percent(me, out float healthPercent, out float barrierPercent);
                float mx = initialized ? motion.DrawnX : me.X, my = initialized ? motion.DrawnY : me.Y;
                _actors.Present(me.Id, mx, my, aimAngle, healthPercent,
                    me.Faction, me.Status, me.Weapon, ActorKind.Player, null, me.Effects, me.SelfSig, true, barrierPercent, me.BarrierRingStep);
                _wishFx.NoteActor(me.Id, ActorKind.Player, me.Effects, me.Status == ActorStatus.Alive);
                Regions.UpdateLocal(mx, my, Time.unscaledTime);
                if (_regionProps != null) _regionProps.NoteActor(WorldPoint(mx, my));
            }
            _actors.End();
            _actors.StepFades(); TickVision();
            if (_regionProps != null) _regionProps.Tick(Time.unscaledDeltaTime);
            ReleaseScheduledFx();
            UpdateEffects();
            _wishes.Tick(_sourceTimeMs);
            _wishFx.Tick(_sourceTimeMs, Time.unscaledDeltaTime);
        }

        /// <summary>Latest membership wins over delayed interpolation, before the frame is rendered.</summary>
        public void RefreshVisibility(Session session)
        {
            if (_atmos != null) _atmos.SetMatchActive(session != null && session.Phase == MatchPhase.Active);
            _sourceTimeMs = session != null ? session.ServerTimeMs : 0;
            BindVisionSession(session);
            _renderReady = session != null && session.Clock.Ready;
            _renderMs = _renderReady ? session.Clock.RenderMs : 0;
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
            if (_fadeDemo) UpdateFadeDemo(current, me);
            foreach(var actor in current)
            {
                if (_demoId != 0 && actor.Id == _demoId) continue;
                _membership.Add(actor.Id);
                if(actor.Kind != ActorKind.Player) _latestNpcs.Add(actor);
            }
            if(me!=null) _membership.Add(me.Id);
            _hasMembership=true; _actors.Retain(_membership);
            _wishes.Retain(_membership);
            _wishFx.Retain(_membership);
            // This also runs after Poll/Present, before rendering, so new observer handles
            // are visible immediately and removed handles leave no cosmetic residue.
            PresentLatestNpcs();
            foreach(var fx in _pendingFx) PresentFx(fx);
            _pendingFx.Clear();
            UpdateEffects();
            _actors.StepFades();
        }
        void UpdateFadeDemo(List<InterpActor> current, SelfView me)
        {
            float now = Time.unscaledTime;
            if (_demoId != 0 && now >= _demoUntil) { _demoId = 0; _demoNext = now + 3.5f; }
            if (_demoId != 0 || now < _demoNext || me == null || !_actors.ExitFadesAllowed) return;
            float best = float.MaxValue; uint pick = 0;
            foreach (var a in current)
            {
                if (a.Kind != ActorKind.Player || a.Status != ActorStatus.Alive) continue;
                float dx = a.X - me.X, dy = a.Y - me.Y, d = dx * dx + dy * dy;
                if (d < best && d < 12f * 32 * 12f * 32) { best = d; pick = a.Id; }
            }
            if (pick != 0) { _demoId = pick; _demoUntil = now + 2.5f; }
        }
        static float DebugRadiusFlag(string url)
        {
            const string key = "vision.debugRadius=";
            int i = url == null ? -1 : url.IndexOf(key, System.StringComparison.Ordinal);
            if (i < 0) return 0f;
            int j = i + key.Length, k = j;
            while (k < url.Length && (char.IsDigit(url[k]) || url[k] == '.')) k++;
            return float.TryParse(url.Substring(j, k - j), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float v) ? v : 0f;
        }
        // ---- vision hooks: exit/entry fades and the fog layer (presentation only) ----
        void BindVisionSession(Session session)
        {
            if (!ReferenceEquals(session, _visionSession))
            {
                if (_visionSession != null) _visionSession.EventsReceived -= OnVisionEvents;
                _visionSession = session;
                if (_visionSession != null) _visionSession.EventsReceived += OnVisionEvents;
            }
            // A departing actor fades only while a raid is running; elsewhere (lobby, planning, results) it just goes.
            _actors.ExitFadesAllowed = session != null && session.State == SessionState.InMatch && session.Phase == MatchPhase.Active;
        }
        void OnVisionEvents(ServerMsg.Events message)
        {
            if (message == null) return;
            foreach (var ev in message.List) if (ev.Kind == EventKind.Death) _actors.NoteDeath(ev.Id);
        }
        void TickVision()
        {
            var s = _visionSession;
            bool on = HasMap && s != null && s.State == SessionState.InMatch && s.Phase == MatchPhase.Active && !s.Training
                && s.Me != null && s.Me.Status == ActorStatus.Alive;
            _visionFog.Tick(on, on ? s.Me.X : 0, on ? s.Me.Y : 0, s != null ? s.ServerTimeMs : 0, _actors);
        }
        void PresentLatestNpcs()
        {
            foreach(var a in _latestNpcs)
            {
                _actors.Present(a.Id,a.X,a.Y,a.Facing,a.HpPct,a.Faction,a.Status,a.Weapon,a.Kind,a.MobType,a.Effects,a.SourceSig,false,a.BarrierPct,a.BarrierRingStep);
                if (_collectWishNotes) _wishFx.NoteActor(a.Id, a.Kind, a.Effects, a.Status != ActorStatus.Dead && a.Status != ActorStatus.Mia);
                if (_regionProps != null) _regionProps.NoteActor(WorldPoint(a.X, a.Y));
            }
        }

        public void PresentCollections(CollectionsView collections)
        {
            _used = 0;
            if (collections == null) _wishFx.PresentAreas(null);
            if (collections != null)
            {
                // Zone, cloud and trail rows: drawn by the Wish presenter at exactly the delivered extents.
                _wishFx.PresentAreas(collections.Fields);
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
                foreach (var shot in collections.Projectiles)
                {
                    var p = WorldPoint(shot.X, shot.Y); bool arrow = shot.Kind == ProjectileKind.Arrow;
                    var r = Prop(arrow ? "spark" : "glow", p, arrow ? new Vector2(.6f, .14f) : new Vector2(.7f, .7f),
                        arrow ? new Color(1.6f, 1.25f, .6f) : new Color(1.5f, .55f, 2), 29000);
                    r.transform.rotation = Quaternion.Euler(0, 0, -shot.Facing * Mathf.Rad2Deg);
                }
            }
            for (int i = _used; i < _props.Count; i++) _props[i].gameObject.SetActive(false);
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
        /// <summary>Presentation-only swing at the owner's click; see <see cref="SpriteActorPresenter.LocalAttackCue"/>.</summary>
        public void LocalAttackCue(uint id) { _actors.LocalAttackCue(id); }
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
                    _wishFx.Accept(f);
                    continue;
                }
                uint subject = f.Kind == FxKind.Hit ? f.Victim : f.Kind == FxKind.Stagger || f.Kind == FxKind.Block ? f.Id : f.By;
                var cue=new PendingFx{Kind=f.Kind,Subject=subject,Amount=f.Amount};
                bool own = owner != 0 && (subject == owner || f.By == owner || f.Victim == owner);
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
            _wishes.Reset();
            _wishFx.Reset();
            _actors.CancelFades(); _visionFog.Reset();
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
                _actors.ConfirmedCue(f.Subject,f.Kind);
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
        /// <summary>
        /// Follows the owner with light smoothing (absorbs 2 to 6 u reconciliation corrections, legacy CameraFollow). The cursor is
        /// always mapped through the camera as it actually stands (<see cref="ScreenToServer"/>), so smoothing never skews aim.
        /// Cuts straight to the target on a jump, a long frame, or when <paramref name="cut"/> is set.
        /// </summary>
        public void FollowSmoothed(Camera cam, float serverX, float serverY, float dt, bool cut)
        {
            float dx = serverX - _smoothX, dy = serverY - _smoothY;
            if (cut || !_smoothValid || !(dt >= 0f) || dt > FollowMaxDt || dx * dx + dy * dy > FollowCutUnits * FollowCutUnits)
            { _smoothX = serverX; _smoothY = serverY; }
            else
            {
                float alpha = 1f - Mathf.Exp(-dt / FollowTauSeconds);
                _smoothX += dx * alpha; _smoothY += dy * alpha;
            }
            _smoothValid = true;
            Follow(cam, _smoothX, _smoothY);
        }
        /// <summary>Raw follow (map peek); the next smoothed follow starts from its target.</summary>
        public void FollowExact(Camera cam, float serverX, float serverY) { _smoothValid = false; Follow(cam, serverX, serverY); }
        public void Follow(Camera cam, float serverX, float serverY)
        {
            var p = WorldPoint(serverX, serverY); cam.transform.position = new Vector3(p.x, p.y + 1.5f, -30);
            cam.transform.rotation = Quaternion.identity;
            _lastFollow = p; _hasFollow = true;
            UpdateLampVisibility(p);
            if (_atmos != null) _atmos.OnFollow(cam, Time.unscaledDeltaTime);
            bool ambient = Quality.AmbientParticles && Quality.Particles > 0f;
            bool motion = ShowcaseSettings.Current == null || !ShowcaseSettings.Current.ReducedMotion;
            int moteLimit = ambient ? Mathf.Min(_motes.Count, Mathf.CeilToInt(_motes.Count * Mathf.Min(1f, Quality.Particles))) : 0;
            for(int i=0;i<_motes.Count;i++)
            {
                var m = _motes[i]; m.enabled = i < moteLimit && !(_atmos != null && _atmos.OwnsMotes);
                float t = motion ? Time.unscaledTime * .03f : 0;
                m.transform.position = p + new Vector3(Mathf.Repeat(i*7.31f+t,32)-16, Mathf.Repeat(i*3.71f+t*.7f,18)-9,0);
            }
            for(int i=0;i<_fog.Count;i++)
            {
                _fog[i].enabled=ambient;
                float t=motion ? Time.unscaledTime*.04f : 0;
                _fog[i].transform.position=p+new Vector3(Mathf.Sin(t+i*2)*6,(i-1)*5,0);
            }
        }
        void UpdateLampVisibility(Vector3 p)
        {
            int budget = Quality.DynamicLights;
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
            // Presets come from the Quality row (QualityModel); AtmosphereQuality turns them into the per-effect switches
            // (volume enable, bloom, grading, sun, shadows, lights, particles) and applies ?fx.* overrides.
            AtmosphereQuality.RefreshFromSettings();
            if (_atmos != null) _atmos.SetAmbientBase(AtmosphereQuality.PostProcessing ? .36f : .3f);   // near-constant base for every quality (no tonemapping at Low, so a little less)
            if (_visionFog != null) _visionFog.ApplyQuality();   // fog is information: presets only change its softness
            foreach (var glow in _lampGlows) glow.enabled = Quality.DynamicLights > 0;
            foreach (var light in _lamps) { light.SetShadows(Quality.Shadows); light.ApplyQuality(); }
            if (_hasFollow) UpdateLampVisibility(_lastFollow);
        }
        static void SetActive<T>(VolumeProfile profile, bool active) where T : VolumeComponent
        {
            T component; if (profile.TryGet(out component)) component.active = active;
        }
        void OnDestroy()
        {
            if (ShowcaseSettings.Current != null) ShowcaseSettings.Current.Changed -= ApplyQuality;
            if (_visionSession != null) _visionSession.EventsReceived -= OnVisionEvents;
            if (_visionFog != null) _visionFog.Dispose();
            if (_regionGround != null) _regionGround.Dispose();
            if (_regionWalls != null) _regionWalls.Dispose();
            if (_regionProps != null) _regionProps.Dispose();
        }
    }
}
