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
        ShowcaseCatalog _catalog;
        Transform _mapRoot, _propsRoot, _fxRoot;
        readonly List<SpriteRenderer> _props = new List<SpriteRenderer>();
        readonly List<Light2D> _lamps = new List<Light2D>();
        readonly List<SpriteRenderer> _lampGlows = new List<SpriteRenderer>();
        readonly List<SpriteRenderer> _motes = new List<SpriteRenderer>();
        readonly List<SpriteRenderer> _fog = new List<SpriteRenderer>();
        readonly List<InterpActor> _latestMembership = new List<InterpActor>();
        readonly List<InterpActor> _latestNpcs = new List<InterpActor>();
        readonly HashSet<uint> _membership = new HashSet<uint>();
        readonly List<PendingFx> _pendingFx = new List<PendingFx>(64);
        bool _hasMembership;
        readonly List<Flash> _flashes = new List<Flash>();
        readonly Stack<Flash> _flashPool = new Stack<Flash>();
        Volume _volume;
        Light2D _ambient;
        int _used;
        public bool IsObserved(uint id) { return _actors != null && _actors.Contains(id); }
        sealed class Flash { public SpriteRenderer Sprite; public TMP_Text Text; public uint Actor; public float Start, Duration; public Vector3 Position; public Color Color; public float Size; }
        struct PendingFx { public FxKind Kind; public uint Subject; public float Amount; }

        void Awake()
        {
            ShowcaseSprites.Initialize();
            _catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            _actors = new SpriteActorPresenter(transform, _catalog);
            _mapRoot = Child("Authoritative map artwork"); _propsRoot = Child("Observed collections"); _fxRoot = Child("Confirmed effects");
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
            var floor = new Color(.43f, .4f, .38f);
            for (int y = 0; y < map.H; y += 4) for (int x = 0; x < map.W; x += 4)
            {
                float cw = Mathf.Min(4, map.W - x), ch = Mathf.Min(4, map.H - y);
                ShowcaseSprites.Create(_mapRoot, "Weathered floor", "floor", -100, floor * (1 + Hash(x, y) * .1f),
                    new Vector2(cw, ch * GroundSquash), new Vector3(x + cw / 2, -(y + ch / 2) * GroundSquash));
            }
            for (int y = 0; y < map.H; y++) for (int x = 0; x < map.W; x++)
            {
                byte tile = map.At(x, y); if (tile == MapBlob.Floor) continue;
                Vector3 p = WorldPoint((x + .5f) * 32, (y + .5f) * 32);
                bool wall = tile == MapBlob.Wall;
                int order = 2000 + y * 16;
                float height = wall ? .67f : .25f;
                var tint = wall ? new Color(.5f, .46f, .42f) : new Color(.36f, .37f, .39f);
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
            var light = ShowcaseSprites.CreateLight(_mapRoot, "Static torch light", p); light.lightType = Light2D.LightType.Point; light.color = color;
            light.intensity = 2.3f; light.pointLightInnerRadius = .3f; light.pointLightOuterRadius = 4.8f; light.falloffIntensity = .6f;
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
                _actors.Present(a.Id, a.X, a.Y, a.Facing, a.HpPct, a.Faction, a.Status, a.Weapon, a.Kind, a.MobType, a.Effects, a.SourceSig, false);
            }
            if (_hasMembership) PresentLatestNpcs();
            if (me != null && (!_hasMembership || _membership.Contains(me.Id)))
            {
                bool initialized = motion != null && motion.Initialized;
                _actors.Present(me.Id, initialized ? motion.DrawnX : me.X, initialized ? motion.DrawnY : me.Y, aimAngle, me.HpPct,
                    me.Faction, me.Status, me.Weapon, ActorKind.Player, null, me.Effects, me.SelfSig, true);
            }
            _actors.End();
            UpdateEffects();
        }

        /// <summary>Latest membership wins over delayed interpolation, before the frame is rendered.</summary>
        public void RefreshVisibility(Session session)
        {
            if(session==null || session.Snapshots.Count==0) return;
            session.Snapshots.Sample(session.Snapshots.NewestMs,_latestMembership);
            RetainObservedActors(_latestMembership,session.Me);
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
                _actors.Present(a.Id,a.X,a.Y,a.Facing,a.HpPct,a.Faction,a.Status,a.Weapon,a.Kind,a.MobType,a.Effects,a.SourceSig,false);
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
                    string sprite = p.Kind == PropAppearance.Chest ? "chest" : p.Kind == PropAppearance.Body || p.Kind == PropAppearance.Corpse ? "stone" : "rune";
                    Color color = p.Kind == PropAppearance.Ground ? new Color(.93f, .78f, .46f) : Color.white;
                    var art=Prop(sprite, position + new Vector3(0, .22f), new Vector2(.78f, p.Kind == PropAppearance.Body ? .3f : .6f), color, order);
                    if(p.Kind==PropAppearance.Chest && _catalog!=null && _catalog.Chest!=null) {art.sprite=_catalog.Chest;art.transform.position=position;art.transform.localScale=Vector3.one*1.3f;}
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
            r.transform.position = p; r.transform.localScale = new Vector3(scale.x, scale.y, 1); r.transform.rotation = Quaternion.identity;
            return r;
        }
        static Color FieldColor(AbilityId ability)
        {
            int i = ability == AbilityId.Blaze ? 0 : ability == AbilityId.Trial ? 1 : ability == AbilityId.Swarm ? 2 : ability == AbilityId.Freeze ? 3 : 4;
            return ShowcasePalette.Faction(i);
        }
        public void ConfirmedFx(ServerMsg.Fx fx)
        {
            foreach (var f in fx.List)
            {
                uint subject = f.Kind == FxKind.Hit ? f.Victim : f.Kind == FxKind.Stagger || f.Kind == FxKind.Block ? f.Id : f.By;
                var cue=new PendingFx{Kind=f.Kind,Subject=subject,Amount=f.Amount};
                if (_actors.Contains(subject)) PresentFx(cue);
                else if(_pendingFx.Count<64) _pendingFx.Add(cue); // Copy scalars; decoded messages are recycled.
            }
        }
        void PresentFx(PendingFx f)
        {
                if (!_actors.TryPosition(f.Subject, out var p)) return;
                if (f.Kind == FxKind.Swing) _actors.Swing(f.Subject);
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
                var c = f.Color; c.a = 1 - t; f.Sprite.color = c;
                f.Text.transform.position=f.Position+new Vector3(0,.7f+(reduced ? 0 : t*.35f),0); f.Text.color=new Color(1,.9f,.65f,1-t);
            }
        }
        Flash CreateFlash()
        {
            var sprite=ShowcaseSprites.Create(_fxRoot,"Confirmed impact","spark",30000,Color.white,Vector2.one,Vector3.zero,false);
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
            int budget = ShowcaseSettings.Current == null || ShowcaseSettings.Current.EffectiveQuality == ShowcaseQuality.High ? 6 : ShowcaseSettings.Current.EffectiveQuality == ShowcaseQuality.Medium ? 3 : 0;
            int count = 0;
            foreach (var lamp in _lamps) { bool near = Mathf.Abs(lamp.transform.position.x - p.x) < 18 && Mathf.Abs(lamp.transform.position.y - p.y) < 12; lamp.enabled = near && count++ < budget; }
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
            foreach (var light in _lamps) light.shadowsEnabled = quality == ShowcaseQuality.High;
        }
        void OnDestroy() { if (ShowcaseSettings.Current != null) ShowcaseSettings.Current.Changed -= ApplyQuality; }
    }
}
