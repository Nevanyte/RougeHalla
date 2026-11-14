using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>One area as it was drawn this frame (server-unit radius turned into world size), for diagnostics and tests.</summary>
    public struct WishDrawnArea
    {
        public AreaKind Kind;
        public AbilityId Ability;
        public Vector3 Center, End;
        /// <summary>World width/height of the ring (circle areas) or length/thickness of the band (trails).</summary>
        public Vector2 Size;
    }

    /// <summary>
    /// The five Wish sequences: cast telegraph, landing, the area while it lives, status looks on the affected actors and the
    /// end effect. Everything is drawn from delivered facts only: Wish fx records (cast, landing, end), the area rows
    /// (zone, cloud, trail) and the public status bits of observed actors. Nothing is simulated here.
    /// Sprites are immediate-mode from a pool, particles come from four capped systems, and no frame allocates.
    /// </summary>
    public sealed class WishFxPresenter
    {
        public const int CueCapacity = 48, GhostCapacity = 12, ActorCapacity = 160, SpriteCap = 420;
        const float S = ArenaView.Scale, G = ArenaView.GroundSquash;
        const int GroundOrder = 1230, RingOrder = 1240, BurstOrder = 29950, ParticleOrder = 29990;
        const double TrailScorchMs = 2000;

        enum CueType : byte { Windup, Landing, Shatter, Radiant, Break }
        struct Cue
        {
            public CueType Type; public byte Ability; public uint Caster, Target;
            public bool HasAnchor, HasDest, Fired;
            public float X, Y, X2, Y2; public Vector3 Pos;
            public double Start, Dur; public uint Seed;
        }
        struct Ghost { public WishAreaEnded Ended; public double At; }
        struct ActorNote { public uint Id; public ActorKind Kind; public ushort Effects; public bool Alive; }

        readonly SpriteActorPresenter _actors;
        readonly Pen _pen;
        readonly Particles _particles;
        readonly Cue[] _cues = new Cue[CueCapacity];
        int _cueCount;
        readonly Ghost[] _ghosts = new Ghost[GhostCapacity];
        int _ghostCount;
        readonly ActorNote[] _notes = new ActorNote[ActorCapacity];
        int _noteCount;
        readonly WishAreaTracker _areaTracker = new WishAreaTracker();
        readonly WishStatusTracker _statusTracker = new WishStatusTracker();
        readonly List<WishAreaEnded> _ended = new List<WishAreaEnded>(8);
        readonly List<WishDrawnArea> _drawn = new List<WishDrawnArea>(16);
        readonly float[] _acc = new float[12];
        readonly Dictionary<uint, Vector3> _lastPos = new Dictionary<uint, Vector3>(16);
        IReadOnlyList<AreaView> _areas = System.Array.Empty<AreaView>();
        uint _owner;
        double _sourceMs, _smoothMs, _lastBlazeMs = double.NegativeInfinity;
        float _sourceWall;
        // The latest Freeze landing, so a stun that appears at that spot is styled as ice. Nothing else is inferred from it.
        double _freezeAt = double.NegativeInfinity; float _freezeX, _freezeY;

        public WishFxPresenter(Transform parent, SpriteActorPresenter actors)
        {
            _actors = actors;
            var root = new GameObject("Wish effects").transform; root.SetParent(parent, false);
            _pen = new Pen(root, SpriteCap);
            _particles = new Particles(root);
        }

        // ---------------------------------------------------------------- introspection (tests, diagnostics)
        public int ActiveCueCount { get { return _cueCount; } }
        public int GhostCount { get { return _ghostCount; } }
        public int SpritesDrawn { get { return _pen.Used; } }
        public int SpritePoolSize { get { return _pen.PoolSize; } }
        public IReadOnlyList<WishDrawnArea> DrawnAreas { get { return _drawn; } }
        public int LiveParticles { get { return _particles.Live; } }
        public int ParticleCapacity { get { return _particles.Capacity; } }
        public bool IsReduced { get { return Reduced; } }
        static bool Reduced { get { return ShowcaseSettings.Current != null && ShowcaseSettings.Current.ReducedMotion; } }

        public void SetOwner(uint id) { _owner = id; }
        /// <summary>Which Wish Frost has here; under Wall the Freeze windup beam is not drawn (FrostWallPresenter draws the wall's telegraph).</summary>
        public FrostWishKind FrostWish;

        // ---------------------------------------------------------------- inputs
        /// <summary>Copies a delivered Wish fx record into a bounded cue. Same acceptance rules as the confirmed-cue layer.</summary>
        public void Accept(WireFx f)
        {
            if (f == null || f.Ability > 4 || double.IsNaN(f.EventTime) || double.IsInfinity(f.EventTime) || f.EventTime < 0) return;
            if (f.Kind != FxKind.WishStarted && f.Kind != FxKind.WishLanded && f.Kind != FxKind.WishEnded) return;
            if (f.Kind != FxKind.WishStarted && f.Caster.HasValue)
                for (int i = _cueCount - 1; i >= 0; i--)
                    if (_cues[i].Type == CueType.Windup && _cues[i].Caster == f.Caster.Value && _cues[i].Ability == f.Ability && _cues[i].Start <= f.EventTime) RemoveCue(i);
            if (f.Kind == FxKind.WishEnded) return;
            var cue = new Cue
            {
                Ability = f.Ability, Caster = f.Caster ?? 0, Target = f.Target ?? 0, HasAnchor = f.HasAnchor, HasDest = f.HasDestination,
                X = f.AnchorX, Y = f.AnchorY, X2 = f.DestinationX, Y2 = f.DestinationY, Start = f.EventTime,
                Seed = (uint)(f.EventTime * 7 + f.Ability * 131 + (f.Caster ?? 0) * 17)
            };
            if (f.Kind == FxKind.WishStarted)
            {
                if (!f.Caster.HasValue || !(f.Duration > 0)) return;
                cue.Type = CueType.Windup; cue.Dur = f.Duration;
                _actors.WishCue(cue.Caster, (AbilityId)f.Ability);
            }
            else
            {
                if (!f.HasAnchor) return;
                if (f.Ability == (byte)AbilityId.Blaze && !f.HasDestination) return;
                if (f.Ability != (byte)AbilityId.Blaze && f.HasDestination) return;
                cue.Type = CueType.Landing; cue.Dur = LandingMs((AbilityId)f.Ability);
                if (f.Ability == (byte)AbilityId.Freeze) { _freezeAt = f.EventTime; _freezeX = f.AnchorX; _freezeY = f.AnchorY; }
                if (f.Caster.HasValue && (f.Ability == (byte)AbilityId.Blaze || f.Ability == (byte)AbilityId.LastStand)) _actors.WishCue(cue.Caster, (AbilityId)f.Ability);
            }
            AddCue(cue);
        }

        static double LandingMs(AbilityId a)
        {
            switch (a) { case AbilityId.Trial: return 650; case AbilityId.LastStand: return 850; case AbilityId.Blaze: return 700; default: return 600; }
        }

        void AddCue(in Cue cue)
        {
            if (_cueCount == CueCapacity) RemoveCue(0);
            _cues[_cueCount++] = cue;
        }
        void RemoveCue(int i) { for (int j = i + 1; j < _cueCount; j++) _cues[j - 1] = _cues[j]; _cueCount--; }

        /// <summary>Start of an actor-presenting pass; clears the per-frame status notes.</summary>
        public void BeginFrame() { _noteCount = 0; }

        /// <summary>Records one observed actor's public status bits. Players also feed the edge tracker.</summary>
        public void NoteActor(uint id, ActorKind kind, ushort effects, bool alive)
        {
            for (int i = 0; i < _noteCount; i++) if (_notes[i].Id == id) { _notes[i].Effects = effects; _notes[i].Alive = alive; _notes[i].Kind = kind; return; }
            if (_noteCount < ActorCapacity) _notes[_noteCount++] = new ActorNote { Id = id, Kind = kind, Effects = effects, Alive = alive };
        }

        public void PresentAreas(IReadOnlyList<AreaView> fields) { _areas = fields ?? (IReadOnlyList<AreaView>)System.Array.Empty<AreaView>(); }

        /// <summary>A departed caster takes its windup telegraph with it.</summary>
        public void Retain(HashSet<uint> membership)
        {
            for (int i = _cueCount - 1; i >= 0; i--)
                if (_cues[i].Type == CueType.Windup && !membership.Contains(_cues[i].Caster)) RemoveCue(i);
        }

        public void Reset()
        {
            _cueCount = 0; _ghostCount = 0; _noteCount = 0; _areaTracker.Clear(); _statusTracker.Clear(); _drawn.Clear(); _lastPos.Clear();
            _areas = System.Array.Empty<AreaView>(); _freezeAt = _lastBlazeMs = double.NegativeInfinity; _sourceMs = 0;
            for (int i = 0; i < _acc.Length; i++) _acc[i] = 0;
            _pen.Begin(); _pen.End(); _particles.Clear(); _actors.ClearWishTints();
        }

        // ---------------------------------------------------------------- frame
        public void Tick(double serverTimeMs, float dt)
        {
            if (double.IsNaN(serverTimeMs) || serverTimeMs < 0) return;
            float wall = Time.unscaledTime;
            if (serverTimeMs != _sourceMs) { if (serverTimeMs < _sourceMs) { _cueCount = 0; _ghostCount = 0; } _sourceMs = serverTimeMs; _sourceWall = wall; }
            // Snapshots arrive every 50 ms; between them time advances on the local clock so motion is smooth.
            _smoothMs = _sourceMs + System.Math.Min(100d, (wall - _sourceWall) * 1000d);
            double now = _smoothMs; float t = wall; bool reduced = Reduced;
            _pen.Begin(); _drawn.Clear(); _actors.ClearWishTints();
            _particles.Configure(reduced);
            if (dt > .25f) dt = .25f;

            DrawAreas(now, t, reduced, dt);
            DrawStatuses(now, t, reduced, dt);
            DrawCues(now, t, reduced);
            DrawGhosts(now, t, reduced);
            _pen.End();
        }

        // ---------------------------------------------------------------- helpers
        static Vector3 W(float x, float y) { return ArenaView.WorldPoint(x, y); }
        static Color Fac(int faction, float alpha = 1f) { Color c = ShowcasePalette.Faction(faction); c.a = alpha; return c; }
        static Color Mix(Color a, Color b, float t) { return Color.Lerp(a, b, t); }
        static Color A(Color c, float alpha) { c.a = alpha; return c; }
        static Color Deep(Color c, float alpha) { Color d = Color.Lerp(c, new Color(.02f, .03f, .06f), .62f); d.a = alpha; return d; }
        static int OrderOf(Vector3 p) { return 2000 + Mathf.RoundToInt(-p.y / (S * G) * .5f); }
        static Vector2 Ell(float radiusWorld) { return new Vector2(radiusWorld * 2f, radiusWorld * 2f * G); }
        bool Pos(uint id, out Vector3 p) { p = default(Vector3); return id != 0 && _actors.TryPosition(id, out p); }

        void Line(string key, Vector3 a, Vector3 b, float thick, Color c, int order)
        {
            Vector3 d = b - a; float len = d.magnitude; if (len < .001f) return;
            _pen.Draw(key, (a + b) * .5f, new Vector2(len, thick), Mathf.Atan2(d.y, d.x) * Mathf.Rad2Deg, c, order);
        }
        void Ring(string key, Vector3 c, float radiusWorld, Color col, int order) { _pen.Draw(key, c, Ell(radiusWorld), 0, col, order); }
        /// <summary>A ring with a dark underlay so it reads on bright snow as well as on dark stone.</summary>
        void SafeRing(string key, Vector3 c, float radiusWorld, Color col, int order, float underlay = .85f)
        {
            Ring(key, c, radiusWorld * 1.025f, Deep(col, col.a * underlay), order - 1);
            Ring(key, c, radiusWorld, col, order);
        }

        // ---------------------------------------------------------------- areas
        void DrawAreas(double now, float t, bool reduced, float dt)
        {
            _areaTracker.BeginFrame();
            bool blazeLive = false;
            for (int i = 0; i < _areas.Count; i++)
            {
                var row = _areas[i]; var f = new WishAreaFacts(row);
                _areaTracker.Observe(f, now);
                switch (f.Kind)
                {
                    case AreaKind.Cloud: DrawCloud(f, now, t, reduced, dt); break;
                    case AreaKind.Zone: DrawZone(f, now, t, reduced, dt); break;
                    case AreaKind.Trail: DrawTrail(f, now, t, reduced, dt); blazeLive = true; break;
                }
            }
            if (blazeLive) _lastBlazeMs = now;
            _ended.Clear(); _areaTracker.EndFrame(_ended);
            for (int i = 0; i < _ended.Count; i++)
            {
                if (_ghostCount == GhostCapacity) { for (int j = 1; j < _ghostCount; j++) _ghosts[j - 1] = _ghosts[j]; _ghostCount--; }
                _ghosts[_ghostCount++] = new Ghost { Ended = _ended[i], At = now };
            }
        }

        void Drawn(in WishAreaFacts f, Vector3 c, Vector3 end, Vector2 size)
        {
            _drawn.Add(new WishDrawnArea { Kind = f.Kind, Ability = f.Ability, Center = c, End = end, Size = size });
        }

        Vector3 CloudCenter(in WishAreaFacts f)
        {
            // A cloud follows its owner. Only the owner's own cloud knows that owner; for everyone else the owner is hidden
            // and the row is anonymous, so the cast origin it was delivered with is the only place there is.
            if (f.Owner != 0 && f.Owner == _owner && Pos(f.Owner, out var p)) return p;
            return W(f.X, f.Y);
        }

        void DrawCloud(in WishAreaFacts f, double now, float t, bool reduced, float dt)
        {
            Color g = Fac(2); Vector3 c = CloudCenter(f);
            float r = f.CircleRadius * S; float el = f.Elapsed(now), rem = 1f - el;
            float born = reduced ? 1f : WishFxModel.EaseOut(WishFxModel.Phase(now, f.StartedAt, 300));
            float fade = Mathf.Clamp01(rem * 8f);
            float pulse = WishFxModel.Pulse(t, 1.6f, reduced);
            WishLight(c + new Vector3(0, .3f, 0), .9f, r * born * 1.3f + 1.4f, Mix(g, Color.white, .2f), (.6f + .15f * pulse) * fade);
            Ring(WishFxArt.Disc, c, r * born, A(Mix(g, Color.black, .45f), (.24f + .06f * pulse) * fade), GroundOrder);
            SafeRing(WishFxArt.Dashed, c, r * born, A(Mix(g, Color.white, .2f), .85f * fade), RingOrder);
            Ring(WishFxArt.Hairline, c, r * born, A(g, .55f * fade), RingOrder + 1);
            Drawn(f, c, c, Ell(r));
            TimeSweep(c, r, el, g, RingOrder + 2, fade, reduced);
            int flies = reduced ? 5 : System.Math.Max(5, WishFxModel.Budget(16, Quality.Particles, false, 16));
            for (int i = 0; i < flies; i++)
            {
                uint seed = (uint)(i * 7919 + 13);
                float h1 = WishFxModel.Hash01(seed), h2 = WishFxModel.Hash01(seed + 1), h3 = WishFxModel.Hash01(seed + 2);
                float orbit = r * (.22f + .62f * h1);
                float ang = h2 * 6.283f + (reduced ? 0f : (float)(t * (.7f + h3 * 1.6f)) * (i % 2 == 0 ? 1f : -1f));
                float bob = reduced ? 0f : Mathf.Sin(t * 5f + h1 * 9f) * .06f;
                Vector3 p = c + new Vector3(Mathf.Cos(ang) * orbit, Mathf.Sin(ang) * orbit * G + .35f + bob, 0);
                Fly(p, ang + 1.57f, .15f + .05f * h3, Mix(g, Color.white, .25f), OrderAt(c, i), fade, t, i);
            }
            if (!reduced) for (int q = EmitCount(ref _acc[0], dt, 6f * Mathf.Min(1.5f, Quality.Particles)); q > 0; q--) _particles.Rise(c + Rand2(r * .85f), new Vector3(0, .3f), .1f, 1.3f, A(Mix(g, Color.white, .15f), .7f));
        }

        int OrderAt(Vector3 c, int i) { return OrderOf(c) + 2 + (i % 3); }

        // ---- scene light (render pass, switch fx.fxlights): every Wish emits real light into the analytic local-light field, in its own colour ----
        static bool LightsOn { get { return AtmosphereQuality.AnalyticLights && AtmosphereQuality.FxLights; } }
        static void WishLight(Vector3 world, float height, float radius, Color col, float intensity)
        {
            if (LightsOn && intensity > .01f) LocalLightField.StageWorld(world, height, radius, col, intensity);
        }
        void CueLight(in Cue c, float p, bool fire)
        {
            var ab = (AbilityId)c.Ability; Color col = Mix(Fac(WishFxModel.FactionIndex(ab)), Color.white, .25f);
            Vector3 pos;
            if (c.Type == CueType.Windup) { if (!Pos(c.Caster, out pos)) return; WishLight(pos, .9f, 2.6f, col, .45f + 1.1f * p); return; }
            if (c.Type == CueType.Landing)
            {
                if (!c.HasAnchor) return;
                pos = W(c.X, c.Y);
                if (fire) LocalLightField.FlashWorld(pos, 1.0f, 5.2f, col, 2.6f, .5f);
                WishLight(pos, .9f, 3.4f, col, 1.1f * (1f - p)); return;
            }
            if (!Pos(c.Target, out pos) && !Pos(c.Caster, out pos)) return;      // shatter, radiant and break end effects sit on an actor the client is drawing
            if (fire) LocalLightField.FlashWorld(pos, .9f, 3.6f, col, 2.1f, .4f);
        }

        void Fly(Vector3 p, float rotRad, float size, Color col, int order, float fade, float t, int i)
        {
            float flap = 1f + .35f * Mathf.Sin(t * 38f + i * 2.1f) * (Reduced ? 0f : 1f);
            _pen.Draw(WishFxArt.Fly, p, new Vector2(size * flap, size), rotRad * Mathf.Rad2Deg, A(col, .95f * fade), order);
        }

        void TimeSweep(Vector3 c, float rWorld, float elapsed, Color col, int order, float fade, bool reduced)
        {
            // A bright bead rides the ring once round over the delivered lifetime; its tail shows how much has gone.
            float head = elapsed * 6.2832f - 1.5708f;
            int tail = reduced ? 0 : 6;
            for (int k = tail; k >= 0; k--)
            {
                float a = head - k * .09f;
                Vector3 p = c + new Vector3(Mathf.Cos(a) * rWorld, Mathf.Sin(a) * rWorld * G, 0);
                float s = k == 0 ? .34f : .2f - k * .02f;
                _pen.Draw(WishFxArt.Soft, p, Vector2.one * s * 1.6f, 0, A(Mix(col, Color.white, .5f), (k == 0 ? .9f : .5f - k * .06f) * fade), order);
                if (k == 0) _pen.Draw(WishFxArt.Cross, p, Vector2.one * s, 0, A(Color.white, .9f * fade), order + 1);
            }
        }

        void DrawZone(in WishAreaFacts f, double now, float t, bool reduced, float dt)
        {
            Color v = Fac(1); Vector3 c = W(f.X, f.Y);
            float full = f.CircleRadius * S;
            float born = reduced ? 1f : WishFxModel.EaseOut(WishFxModel.Phase(now, f.StartedAt, 350));
            float r = full * born; float el = f.Elapsed(now); float fade = Mathf.Clamp01((1f - el) * 8f);
            WishLight(c, .9f, r * 1.3f + 1.2f, Mix(v, Color.white, .25f), .6f * fade);
            Ring(WishFxArt.Disc, c, r, A(Deep(v, 1f), .24f * fade), GroundOrder);
            Ring(WishFxArt.Disc, c, r, A(v, .05f * fade), GroundOrder + 1);
            SafeRing(WishFxArt.Dashed, c, r, A(Mix(v, Color.white, .3f), .95f * fade), RingOrder, .7f);
            Ring(WishFxArt.Hairline, c, r, A(v, .5f * fade), RingOrder + 1);
            Drawn(f, c, c, Ell(r));
            if (born >= 1f) TimeSweep(c, r, el, v, RingOrder + 2, fade, reduced);
            // Caster sigil: the judgment rests on whoever cast it, if that caster is observed.
            if (Pos(f.Owner, out var cp))
                Ring("sigil1", cp, .62f, A(Mix(v, Color.white, .35f), (.35f + .15f * WishFxModel.Pulse(t, 1.8f, reduced)) * fade), GroundOrder + 2);
        }

        void DrawTrail(in WishAreaFacts f, double now, float t, bool reduced, float dt)
        {
            Color fire = Fac(0); Vector3 a = W(f.X, f.Y), b = W(f.X2, f.Y2);
            float el = f.Elapsed(now); float life = Mathf.Clamp01((1f - el) * 6f);
            float band = TrailBandThickness(f);
            DrawTrailBand(a, b, band, f.TrailHalfWidth * S, Deep(fire, 1f), .85f * life, GroundOrder + 4);
            Vector3 d = b - a; float len = d.magnitude;
            if (LightsOn)      // a fire path lights its length: the ends and the middle, flickering
            {
                Color fl = Mix(fire, new Color(1f, .8f, .4f), .4f); float fk = (1.05f + .3f * WishFxModel.Pulse(t, 4.3f, reduced)) * life;
                WishLight(Vector3.Lerp(a, b, .0f) + new Vector3(0, .25f, 0), .6f, 2.8f, fl, fk); WishLight(Vector3.Lerp(a, b, .5f) + new Vector3(0, .25f, 0), .6f, 2.8f + len * .3f, fl, fk);
                WishLight(Vector3.Lerp(a, b, 1f) + new Vector3(0, .25f, 0), .6f, 2.8f, fl, fk);
            }
            Drawn(f, (a + b) * .5f, b, new Vector2(len, band));
            if (len < .01f) return;
            Line(WishFxArt.Beam, a, b, band * 1.5f, A(Mix(fire, new Color(1f, .85f, .4f), .2f), (.6f + .2f * WishFxModel.Pulse(t, .5f, reduced)) * life), GroundOrder + 6);
            int tongues = Mathf.Clamp(Mathf.CeilToInt(len / (band * 1.1f)), 2, 14);
            for (int i = 0; i < tongues; i++)
            {
                float u = (i + .5f) / tongues; uint seed = (uint)(i * 31 + (int)f.StartedAt);
                float h = WishFxModel.Hash01(seed);
                float flick = reduced ? .85f : .75f + .25f * Mathf.Sin(t * (9f + h * 5f) + h * 17f);
                Vector3 p = Vector3.Lerp(a, b, u) + new Vector3((h - .5f) * band * .5f, .02f, 0);
                float hgt = (.55f + .4f * h) * flick * (.5f + .5f * life);
                _pen.Draw(WishFxArt.Flame, p + new Vector3(0, hgt * .5f, 0), new Vector2(band * 1.6f, hgt * 1.25f), 0,
                    A(Mix(fire, new Color(1f, .9f, .5f), .25f + .3f * h), .85f * life), OrderOf(p) + 1);
                _pen.Draw(WishFxArt.Flame, p + new Vector3(0, hgt * .32f, 0), new Vector2(band * .6f, hgt * .6f), 0,
                    A(new Color(1f, .95f, .7f), .8f * life), OrderOf(p) + 2);
            }
            if (!reduced) for (int q = EmitCount(ref _acc[1], dt, Mathf.Min(24f, len * 3f) * Mathf.Min(1.5f, Quality.Particles)); q > 0; q--) _particles.Rise(Vector3.Lerp(a, b, Random01(ref _rng)) + new Vector3(0, .1f, 0), new Vector3((Random01(ref _rng) - .5f) * .3f, .5f + Random01(ref _rng) * .5f), .09f, 1.1f, A(Mix(fire, new Color(1f, .8f, .3f), .5f), .9f));
        }

        // The band's world thickness: the perpendicular distance between the two edges the server's half-width describes,
        // measured after the ground squash so the drawn band really covers 2 x half-width of floor.
        static float TrailBandThickness(in WishAreaFacts f)
        {
            float dx = f.X2 - f.X, dy = f.Y2 - f.Y, len = Mathf.Sqrt(dx * dx + dy * dy);
            float hw = f.TrailHalfWidth;
            if (len < .001f) return hw * 2f * S;
            float nx = -dy / len * hw, ny = dx / len * hw;               // server-space edge offset
            Vector2 o = new Vector2(nx * S, -ny * S * G);                // as drawn
            Vector2 wd = new Vector2(dx * S, -dy * S * G).normalized;    // drawn direction
            return Mathf.Abs(wd.x * o.y - wd.y * o.x) * 2f;
        }

        void DrawTrailBand(Vector3 a, Vector3 b, float thickness, float capRadiusWorldX, Color col, float alpha, int order)
        {
            _pen.Draw(WishFxArt.Solid, (a + b) * .5f, new Vector2((b - a).magnitude, thickness), Mathf.Atan2((b - a).y, (b - a).x) * Mathf.Rad2Deg, A(col, alpha), order);
            Vector2 cap = new Vector2(capRadiusWorldX * 2f, capRadiusWorldX * 2f * G);
            _pen.Draw(WishFxArt.Disc, a, cap, 0, A(col, alpha), order); _pen.Draw(WishFxArt.Disc, b, cap, 0, A(col, alpha), order);
        }

        // ---------------------------------------------------------------- ended areas
        void DrawGhosts(double now, float t, bool reduced)
        {
            for (int i = _ghostCount - 1; i >= 0; i--)
            {
                var g = _ghosts[i]; var f = g.Ended.Facts; double age = now - g.At;
                double life = f.Kind == AreaKind.Trail ? TrailScorchMs : f.Kind == AreaKind.Zone ? 600 : 650;
                if (age >= life || age < 0) { if (age >= life) RemoveGhost(i); continue; }
                float p = (float)(age / life);
                if (f.Kind == AreaKind.Trail)
                {
                    Vector3 a = W(f.X, f.Y), b = W(f.X2, f.Y2);
                    DrawTrailBand(a, b, TrailBandThickness(f), f.TrailHalfWidth * S, Deep(Fac(0), 1f), .8f * (1f - p), GroundOrder + 4);
                    continue;
                }
                if (f.Kind == AreaKind.Zone)
                {
                    Vector3 c = W(f.X, f.Y); float r = f.CircleRadius * S; Color v = Fac(1);
                    if (g.Ended.Natural || reduced)
                        SafeRing(WishFxArt.Dashed, c, r * (reduced ? 1f : 1f - .55f * WishFxModel.EaseOut(p)), A(Mix(v, Color.white, .3f), .9f * (1f - p)), RingOrder, .7f);
                    else
                    {
                        // The judged left the ring: it breaks into its dashes, which fly outward and fade.
                        int n = 18;
                        for (int k = 0; k < n; k++)
                        {
                            float ang = k * 6.2832f / n; float push = 1f + .22f * WishFxModel.EaseOut(p);
                            Vector3 q = c + new Vector3(Mathf.Cos(ang) * r * push, Mathf.Sin(ang) * r * push * G, 0);
                            _pen.Draw(WishFxArt.Shard, q, new Vector2(.14f, .55f), ang * Mathf.Rad2Deg - 90f, A(Mix(v, Color.white, .4f), .9f * (1f - p)), RingOrder + 1);
                        }
                    }
                    continue;
                }
                // Cloud: the swarm disperses outward from where it last stood.
                Vector3 cc = W(f.X, f.Y); if (f.Owner != 0 && f.Owner == _owner && Pos(f.Owner, out var op)) cc = op;
                float rr = f.CircleRadius * S; Color gcol = Fac(2);
                Ring(WishFxArt.Hairline, cc, rr * (1f + .25f * p), A(gcol, .5f * (1f - p)), RingOrder);
                int fl = reduced ? 0 : 10;
                for (int k = 0; k < fl; k++)
                {
                    float h = WishFxModel.Hash01((uint)(k * 53 + 7)); float ang = h * 6.2832f;
                    float dist = rr * (.3f + 1.4f * WishFxModel.EaseOut(p)) * (.6f + .4f * WishFxModel.Hash01((uint)k + 99));
                    Fly(cc + new Vector3(Mathf.Cos(ang) * dist, Mathf.Sin(ang) * dist * G + .35f, 0), ang, .16f, Mix(gcol, Color.white, .25f), OrderOf(cc) + 3, 1f - p, t, k);
                }
            }
        }
        void RemoveGhost(int i) { for (int j = i + 1; j < _ghostCount; j++) _ghosts[j - 1] = _ghosts[j]; _ghostCount--; }

        // ---------------------------------------------------------------- cues
        void DrawCues(double now, float t, bool reduced)
        {
            for (int i = _cueCount - 1; i >= 0; i--)
            {
                var c = _cues[i]; double age = now - c.Start;
                if (age >= c.Dur) { RemoveCue(i); continue; }
                if (age < 0) continue;
                float p = (float)(age / c.Dur);
                bool fire = !c.Fired; if (fire) _cues[i].Fired = true;
                switch (c.Type)
                {
                    case CueType.Windup: DrawWindup(c, p, t, reduced); break;
                    case CueType.Landing: DrawLanding(c, p, t, reduced, fire); break;
                    case CueType.Shatter: DrawShatter(c, p, reduced, fire); break;
                    case CueType.Radiant: DrawRadiant(c, p, reduced, fire); break;
                    case CueType.Break: DrawBreak(c, p, reduced, fire); break;
                }
                if (LightsOn) CueLight(c, p, fire);
            }
        }

        void DrawWindup(in Cue c, float p, float t, bool reduced)
        {
            if (!Pos(c.Caster, out var P)) return;
            var ab = (AbilityId)c.Ability; int fi = WishFxModel.FactionIndex(ab); Color col = Fac(fi);
            int order = OrderOf(P);
            float e = reduced ? 1f : WishFxModel.EaseOut(p);
            Vector3 T = P; bool hasT = false;
            if (c.Target != 0 && Pos(c.Target, out var tp)) { T = tp; hasT = true; }
            else if (c.HasAnchor) { T = W(c.X, c.Y); hasT = true; }
            switch (ab)
            {
                case AbilityId.Freeze:
                {
                    float rr = Mathf.Lerp(1.9f, .62f, e);
                    SafeRing(WishFxArt.Band, P, rr, A(Mix(col, Color.white, .15f), .25f + .45f * p), RingOrder);
                    SafeRing(WishFxArt.Hairline, P, .62f, A(Color.white, .5f * p), RingOrder + 1);
                    if (hasT && FrostWish != FrostWishKind.Wall)
                    {
                        Vector3 up = new Vector3(0, .75f, 0);
                        Vector3 head = Vector3.Lerp(P, T, reduced ? 1f : WishFxModel.EaseOut(Mathf.Min(1f, p * 1.7f)));
                        Line(WishFxArt.Beam, P + up, head + up, .5f * (.4f + .6f * p), A(Deep(col, 1f), .45f), order + 1);
                        Line(WishFxArt.Beam, P + up, head + up, .3f * (.4f + .6f * p), A(Mix(col, Color.white, .55f), .9f), order + 2);
                        Ring(WishFxArt.Band, T, Mathf.Lerp(1.5f, .7f, e), A(Mix(col, Color.white, .3f), .4f + .4f * p), RingOrder);
                        _pen.Draw(WishFxArt.Cross, head + up, Vector2.one * (.35f + .2f * p), 0, A(Color.white, .9f), order + 3);
                    }
                    break;
                }
                case AbilityId.Swarm:
                {
                    SafeRing(WishFxArt.Band, P, Mathf.Lerp(1.8f, .55f, e), A(Mix(col, Color.white, .1f), .22f + .4f * p), RingOrder);
                    int n = reduced ? 6 : 16;
                    for (int i = 0; i < n; i++)
                    {
                        float h1 = WishFxModel.Hash01((uint)(i * 17 + 5)), h2 = WishFxModel.Hash01((uint)(i * 17 + 6));
                        float ang = h1 * 6.2832f + (reduced ? 0f : p * 4f);
                        float dist = Mathf.Lerp(2.1f, .35f, reduced ? .5f : WishFxModel.EaseIn(p)) * (.55f + .45f * h2);
                        Fly(P + new Vector3(Mathf.Cos(ang) * dist, Mathf.Sin(ang) * dist * G + .55f, 0), ang + 1.57f, .17f, Mix(col, Color.white, .25f), order + 3, .5f + .5f * p, t, i);
                    }
                    break;
                }
                case AbilityId.Trial:
                {
                    SafeRing(WishFxArt.Band, P, Mathf.Lerp(1.8f, .6f, e), A(Mix(col, Color.white, .2f), .25f + .4f * p), RingOrder);
                    if (hasT)
                    {
                        // Chains pay out from the caster toward the judged; the lock-on ring narrows. No area is shown yet:
                        // the ring's radius is only delivered with the zone itself, on landing.
                        int links = Mathf.Clamp(Mathf.CeilToInt((T - P).magnitude / .42f), 2, 16);
                        float reach = reduced ? 1f : WishFxModel.EaseOut(Mathf.Min(1f, p * 1.6f));
                        Vector3 up = new Vector3(0, .6f, 0);
                        for (int k = 0; k < links; k++)
                        {
                            float u = (k + .5f) / links; if (u > reach) break;
                            Vector3 q = Vector3.Lerp(P, T, u) + up; Vector3 dd = T - P;
                            float rot = Mathf.Atan2(dd.y, dd.x) * Mathf.Rad2Deg + (k % 2 == 0 ? 0f : 90f);
                            _pen.Draw(WishFxArt.Chain, q, new Vector2(.36f, .22f), rot, A(Deep(col, 1f), .6f), order + 1);
                            _pen.Draw(WishFxArt.Chain, q, new Vector2(.3f, .18f), rot, A(Mix(col, Color.white, .45f), .95f), order + 2);
                        }
                        SafeRing(WishFxArt.Dashed, T, Mathf.Lerp(1.7f, .75f, e), A(Mix(col, Color.white, .3f), .9f), RingOrder + 1);
                        float swing = Mathf.Lerp(-55f, 8f, WishFxModel.EaseIn(p));
                        Vector3 gp = T + new Vector3(.95f, 1.6f + (reduced ? 0f : .25f * (1f - p)), 0);
                        _pen.Draw(WishFxArt.Gavel, gp, Vector2.one * .95f, swing, A(Deep(col, 1f), .7f), order + 2);
                        _pen.Draw(WishFxArt.Gavel, gp, Vector2.one * .8f, swing, A(Mix(col, Color.white, .55f), .95f), order + 3);
                    }
                    break;
                }
            }
        }

        void DrawLanding(in Cue c, float p, float t, bool reduced, bool fire)
        {
            var ab = (AbilityId)c.Ability; Color col = Fac(WishFxModel.FactionIndex(ab)); Vector3 A0 = W(c.X, c.Y);
            float e = reduced ? 1f : WishFxModel.EaseOut(p); float fade = 1f - p;
            int order = BurstOrder;
            int pn = WishFxModel.Budget(14, Quality.Particles, reduced, 28);
            switch (ab)
            {
                case AbilityId.Freeze:
                {
                    SafeRing(WishFxArt.Band, A0, Mathf.Lerp(.3f, 1.45f, e), A(Mix(col, Color.white, .4f), .85f * fade), order);
                    _pen.Draw(WishFxArt.Soft, A0 + new Vector3(0, .6f, 0), Vector2.one * 2.6f * (.6f + .4f * e), 0, A(col, .6f * fade), order - 1);
                    _pen.Draw(WishFxArt.Cross, A0 + new Vector3(0, .6f, 0), Vector2.one * (1.1f + .5f * e), 45f * e, A(Color.white, .9f * fade), order + 1);
                    if (fire) for (int i = 0; i < pn; i++) { float a = i * 6.2832f / pn + Random01(ref _rng); _particles.Fall(A0 + new Vector3(0, .5f, 0), new Vector3(Mathf.Cos(a), Mathf.Sin(a) * .7f + .4f) * (1.4f + Random01(ref _rng)), .16f, .7f, A(Mix(col, Color.white, .5f), .95f), a * Mathf.Rad2Deg); }
                    break;
                }
                case AbilityId.Swarm:
                {
                    SafeRing(WishFxArt.Band, A0, Mathf.Lerp(.25f, 1.25f, e), A(Mix(col, Color.white, .15f), .7f * fade), order);
                    _pen.Draw(WishFxArt.Soft, A0 + new Vector3(0, .5f, 0), Vector2.one * 2.2f, 0, A(Deep(col, 1f), .4f * fade), order - 1);
                    if (fire) for (int i = 0; i < pn; i++) { float a = i * 6.2832f / pn; _particles.Float(A0 + new Vector3(0, .5f, 0), new Vector3(Mathf.Cos(a), Mathf.Sin(a) * .7f) * (.8f + Random01(ref _rng)), .13f, .9f, A(Mix(col, Color.white, .2f), .85f)); }
                    break;
                }
                case AbilityId.Trial:
                {
                    // The gavel comes down: a violet flash and shock ring at the judged, then the zone ring (an area row)
                    // takes over and carries the true extent.
                    SafeRing(WishFxArt.Band, A0, Mathf.Lerp(.35f, 1.9f, e), A(Mix(col, Color.white, .35f), .9f * fade), order);
                    _pen.Draw(WishFxArt.Soft, A0 + new Vector3(0, .4f, 0), Vector2.one * 3.1f * (.7f + .3f * e), 0, A(col, .45f * fade * fade), order - 1);
                    Vector3 gp = A0 + new Vector3(.95f, 1.45f, 0);
                    _pen.Draw(WishFxArt.Gavel, gp, Vector2.one * .95f, Mathf.Lerp(8f, -4f, e), A(Deep(col, 1f), .7f * fade), order + 1);
                    _pen.Draw(WishFxArt.Gavel, gp, Vector2.one * .8f, Mathf.Lerp(8f, -4f, e), A(Mix(col, Color.white, .6f), .95f * fade), order + 2);
                    _pen.Draw(WishFxArt.Scales, A0 + new Vector3(-.95f, 1.55f + .1f * e, 0), Vector2.one * .8f, 0, A(Mix(col, Color.white, .55f), .95f * fade), order + 2);
                    _pen.Draw(WishFxArt.Cross, A0 + new Vector3(0, .4f, 0), Vector2.one * (.9f + .4f * e), 0, A(Color.white, .85f * fade), order + 3);
                    if (fire) for (int i = 0; i < pn; i++) { float a = i * 6.2832f / pn; _particles.Spark(A0 + new Vector3(0, .4f, 0), new Vector3(Mathf.Cos(a), Mathf.Sin(a) * .7f) * (1.6f + Random01(ref _rng)), .17f, .6f, A(Mix(col, Color.white, .5f), .95f)); }
                    break;
                }
                case AbilityId.Blaze:
                {
                    Vector3 D = W(c.X2, c.Y2);
                    float streak = Mathf.Clamp01(1f - p * 1.8f);
                    Line(WishFxArt.Beam, A0 + new Vector3(0, .5f, 0), D + new Vector3(0, .5f, 0), .85f * streak, A(Deep(col, 1f), .45f * streak), order - 1);
                    Line(WishFxArt.Beam, A0 + new Vector3(0, .5f, 0), D + new Vector3(0, .5f, 0), .5f * streak, A(Mix(col, new Color(1f, .85f, .45f), .55f), .95f * streak), order);
                    Line(WishFxArt.Beam, A0 + new Vector3(0, .5f, 0), D + new Vector3(0, .5f, 0), .18f * streak, A(Color.white, .95f * streak), order + 1);
                    SafeRing(WishFxArt.Band, A0, Mathf.Lerp(.2f, .95f, e), A(Mix(col, Color.white, .3f), .75f * fade), order);
                    SafeRing(WishFxArt.Band, D, Mathf.Lerp(.25f, 1.75f, e), A(Mix(col, Color.white, .25f), .85f * fade), order);
                    _pen.Draw(WishFxArt.Soft, D + new Vector3(0, .5f, 0), Vector2.one * 3f * (.6f + .4f * e), 0, A(col, .42f * fade * fade), order - 2);
                    _pen.Draw(WishFxArt.Cross, D + new Vector3(0, .5f, 0), Vector2.one * (1.0f + .6f * e), 0, A(Color.white, .85f * fade), order + 2);
                    _pen.Draw(WishFxArt.Cross, A0 + new Vector3(0, .5f, 0), Vector2.one * (.7f + .3f * e), 0, A(Color.white, .75f * fade), order + 2);
                    if (fire)
                    {
                        for (int i = 0; i < pn; i++) _particles.Rise(Vector3.Lerp(A0, D, Random01(ref _rng)) + new Vector3(0, .5f, 0), new Vector3((Random01(ref _rng) - .5f) * 1.2f, .4f + Random01(ref _rng) * .9f), .11f, .9f, A(Mix(col, new Color(1f, .8f, .3f), .5f), .95f));
                        for (int i = 0; i < pn; i++) { float a = i * 6.2832f / pn; _particles.Rise(D + new Vector3(0, .5f, 0), new Vector3(Mathf.Cos(a), Mathf.Sin(a) * .7f + .5f) * (1.2f + Random01(ref _rng)), .12f, .8f, A(new Color(1f, .75f, .3f), .95f)); }
                    }
                    break;
                }
                case AbilityId.LastStand:
                {
                    SafeRing(WishFxArt.Band, A0, Mathf.Lerp(.3f, 2.1f, e), A(Mix(col, Color.white, .35f), .85f * fade), order);
                    _pen.Draw(WishFxArt.Rays, A0 + new Vector3(0, .7f, 0), new Vector2(3.4f, 3.4f * G) * (.6f + .5f * e), reduced ? 0f : 18f * p, A(Mix(col, Color.white, .45f), .55f * fade), order - 1);
                    _pen.Draw(WishFxArt.Column, A0 + new Vector3(0, 2.2f, 0), new Vector2(1.7f * (1.2f - .3f * e), 4.8f), 0, A(col, .55f * fade), order - 2);
                    _pen.Draw(WishFxArt.Cross, A0 + new Vector3(0, .8f, 0), Vector2.one * (1.1f + .6f * e), 0, A(Color.white, .8f * fade), order + 1);
                    if (fire) for (int i = 0; i < pn; i++) { float a = i * 6.2832f / pn; _particles.Spark(A0 + new Vector3(0, .6f, 0), new Vector3(Mathf.Cos(a) * 1.2f, .5f + Random01(ref _rng) * 1.2f), .17f, .9f, A(Mix(col, Color.white, .35f), .95f)); }
                    break;
                }
            }
        }

        void DrawShatter(in Cue c, float p, bool reduced, bool fire)
        {
            Color col = Fac(3); float fade = 1f - p; float e = reduced ? 1f : WishFxModel.EaseOut(p);
            SafeRing(WishFxArt.Band, c.Pos, Mathf.Lerp(.3f, 1.3f, e), A(Mix(col, Color.white, .5f), .8f * fade), BurstOrder);
            _pen.Draw(WishFxArt.Cross, c.Pos + new Vector3(0, .8f, 0), Vector2.one * (1f + .5f * e), 30f * e, A(Color.white, .9f * fade), BurstOrder + 1);
            int n = reduced ? 0 : 7;
            for (int i = 0; i < n; i++)
            {
                float a = i * 6.2832f / n + c.Seed * .1f; float d = .35f + 1.1f * e;
                _pen.Draw(WishFxArt.Shard, c.Pos + new Vector3(Mathf.Cos(a) * d, .6f + Mathf.Sin(a) * d * .6f - .4f * p * p, 0), new Vector2(.2f, .5f), a * Mathf.Rad2Deg - 90f + 140f * p, A(Mix(col, Color.white, .6f), .95f * fade), BurstOrder + 2);
            }
            if (fire) { int pn = WishFxModel.Budget(16, Quality.Particles, reduced, 28); for (int i = 0; i < pn; i++) { float a = i * 6.2832f / pn; _particles.Fall(c.Pos + new Vector3(0, .7f, 0), new Vector3(Mathf.Cos(a), Mathf.Sin(a) * .8f + .5f) * (1.5f + Random01(ref _rng) * 1.2f), .15f, .8f, A(Mix(col, Color.white, .55f), .95f), a * Mathf.Rad2Deg); } }
        }

        void DrawRadiant(in Cue c, float p, bool reduced, bool fire)
        {
            Color col = Fac(4); float fade = 1f - p; float e = reduced ? 1f : WishFxModel.EaseOut(p);
            SafeRing(WishFxArt.Band, c.Pos, Mathf.Lerp(.4f, 2.4f, e), A(Mix(col, Color.white, .4f), .8f * fade), BurstOrder);
            _pen.Draw(WishFxArt.Rays, c.Pos + new Vector3(0, .8f, 0), new Vector2(3.8f, 3.8f * G) * (.6f + .4f * e), reduced ? 0f : 25f * p, A(Mix(col, Color.white, .5f), .5f * fade), BurstOrder - 1);
            _pen.Draw(WishFxArt.Cross, c.Pos + new Vector3(0, .9f, 0), Vector2.one * (1.2f + .7f * e), 0, A(Color.white, .85f * fade), BurstOrder + 1);
            if (fire) { int pn = WishFxModel.Budget(20, Quality.Particles, reduced, 30); for (int i = 0; i < pn; i++) { float a = i * 6.2832f / pn; _particles.Spark(c.Pos + new Vector3(0, .8f, 0), new Vector3(Mathf.Cos(a) * 1.6f, Mathf.Sin(a) * 1f + .4f), .16f, .9f, A(Mix(col, Color.white, .4f), .95f)); } }
        }

        void DrawBreak(in Cue c, float p, bool reduced, bool fire)
        {
            Color col = Fac(1); float fade = 1f - p; float e = reduced ? 1f : WishFxModel.EaseOut(p);
            _pen.Draw(WishFxArt.Cross, c.Pos + new Vector3(0, .9f, 0), Vector2.one * (.9f + .5f * e), 0, A(Color.white, .9f * fade), BurstOrder + 1);
            int n = reduced ? 0 : 8;
            for (int i = 0; i < n; i++)
            {
                float a = i * 6.2832f / n + c.Seed * .07f; float d = .3f + .95f * e;
                _pen.Draw(WishFxArt.Chain, c.Pos + new Vector3(Mathf.Cos(a) * d, .9f + Mathf.Sin(a) * d * .7f - .5f * p * p, 0), new Vector2(.3f, .18f), a * Mathf.Rad2Deg + 200f * p, A(Mix(col, Color.white, .5f), .95f * fade), BurstOrder + 2);
            }
            if (fire) { int pn = WishFxModel.Budget(10, Quality.Particles, reduced, 20); for (int i = 0; i < pn; i++) { float a = i * 6.2832f / pn; _particles.Spark(c.Pos + new Vector3(0, .8f, 0), new Vector3(Mathf.Cos(a), Mathf.Sin(a)) * 1.3f, .14f, .6f, A(Mix(col, Color.white, .5f), .9f)); } }
        }

        // ---------------------------------------------------------------- statuses
        void DrawStatuses(double now, float t, bool reduced, float dt)
        {
            _statusTracker.BeginFrame();
            bool blazeRecent = now - _lastBlazeMs < TrailScorchMs;
            for (int i = 0; i < _noteCount; i++)
            {
                var n = _notes[i];
                if (n.Kind == ActorKind.Player && _statusTracker.Note(n.Id, n.Effects, n.Alive, out var edge)) OnEdge(edge, now);
                if (!n.Alive || n.Effects == 0 || !Pos(n.Id, out var P)) continue;
                int order = OrderOf(P); uint seed = n.Id * 2654435761u;
                if ((n.Effects & WishEffectBits.Stunned) != 0) DrawStun(P, order, seed, now, t, reduced, dt, n.Id);
                if ((n.Effects & WishEffectBits.Zoned) != 0) DrawJudged(P, order, seed, t, reduced, n.Id);
                if ((n.Effects & WishEffectBits.LastStand) != 0) DrawHoly(P, order, seed, t, reduced, dt, n);
                if ((n.Effects & WishEffectBits.Hidden) != 0 && n.Id == _owner) DrawHiddenSelf(P, order, seed, t, reduced, dt, n.Id);
                if ((n.Effects & WishEffectBits.Dot) != 0 && blazeRecent) DrawBurning(P, order, seed, t, reduced, dt);
            }
            _statusTracker.EndFrame();
        }

        void OnEdge(in WishStatusEdge e, double now)
        {
            if (!Pos(e.Id, out var P)) return;
            if ((e.Ended & WishEffectBits.Stunned) != 0 && IsIceStun(P)) AddCue(new Cue { Type = CueType.Shatter, Start = now, Dur = 650, Pos = P, Seed = e.Id });
            if ((e.Ended & WishEffectBits.LastStand) != 0) AddCue(new Cue { Type = CueType.Radiant, Start = now, Dur = 800, Pos = P, Seed = e.Id });
            if ((e.Ended & WishEffectBits.Zoned) != 0) AddCue(new Cue { Type = CueType.Break, Start = now, Dur = 550, Pos = P, Seed = e.Id });
        }

        bool IsIceStun(Vector3 p)
        {
            // Styled as ice when a Freeze landing was delivered at this spot a moment ago; any other stun is plain.
            if (_smoothMs - _freezeAt > 2200) return false;
            return (p - W(_freezeX, _freezeY)).sqrMagnitude < 1f;
        }

        void DrawStun(Vector3 P, int order, uint seed, double now, float t, bool reduced, float dt, uint id)
        {
            bool ice = IsIceStun(P);
            Color ic = Fac(3);
            float formed = ice ? (reduced ? 1f : WishFxModel.EaseOut(WishFxModel.Phase(now, _freezeAt, 250))) : 0f;
            if (ice)
            {
                _actors.SetWishTint(id, ic, .6f * formed);
                SafeRing(WishFxArt.Band, P, 1.0f * (.7f + .3f * formed), A(Mix(ic, Color.white, .15f), .9f * formed), RingOrder);
                for (int k = 0; k < 7; k++)
                {
                    float h = WishFxModel.Hash01(seed + (uint)k * 7);
                    float ang = (k / 7f + h * .06f) * 6.2832f; float sy = Mathf.Sin(ang);
                    float height = (.85f + .6f * h) * formed;
                    Vector3 b = P + new Vector3(Mathf.Cos(ang) * .62f, sy * .2f + .08f, 0);
                    float lean = Mathf.Cos(ang) * -18f;
                    int o = sy < 0 ? order + 1 : order - 2;
                    _pen.Draw(WishFxArt.Shard, b + new Vector3(0, height * .5f, 0), new Vector2(.58f, height * 1.1f), lean, A(Deep(ic, 1f), .85f), o - 1);
                    _pen.Draw(WishFxArt.Shard, b + new Vector3(0, height * .5f, 0), new Vector2(.46f, height), lean, A(Mix(ic, Color.white, .3f), .97f), o);
                }
                // An ice cap over the shoulders reads as the frozen pose.
                _pen.Draw(WishFxArt.Soft, P + new Vector3(0, 1f, 0), new Vector2(1.5f, 2.1f), 0, A(Mix(ic, Color.white, .3f), .22f * formed), order + 1);
            }
            else _actors.SetWishTint(id, Mix(Fac(4), Color.white, .4f), .08f);
            // Stars circle over the head (above the bars) while the stun lasts, ice or not.
            for (int k = 0; k < 3; k++)
            {
                float a = (reduced ? 0f : t * 2.2f) + k * 2.094f;
                Vector3 sp = P + new Vector3(Mathf.Cos(a) * .55f, 3.15f + Mathf.Sin(a) * .1f, 0);
                _pen.Draw(WishFxArt.Star, sp, Vector2.one * .42f, reduced ? 0f : t * 90f, A(Deep(ic, 1f), .9f), order + 12);
                _pen.Draw(WishFxArt.Star, sp, Vector2.one * .32f, reduced ? 0f : t * 90f, A(new Color(1f, .98f, .8f), .98f), order + 13);
            }
            if (ice && !reduced) for (int q = EmitCount(ref _acc[2], dt, 5f * Mathf.Min(1.5f, Quality.Particles)); q > 0; q--) _particles.Fall(P + new Vector3((Random01(ref _rng) - .5f) * 1.1f, .4f + Random01(ref _rng) * 1.2f, 0), new Vector3(0, -.15f, 0), .1f, 1.1f, A(Mix(ic, Color.white, .7f), .95f), 0);
        }

        void DrawJudged(Vector3 P, int order, uint seed, float t, bool reduced, uint id)
        {
            Color v = Fac(1);
            _actors.SetWishTint(id, v, .16f);
            float pulse = WishFxModel.Pulse(t, 2f, reduced);
            SafeRing(WishFxArt.Dashed, P, .8f, A(Mix(v, Color.white, .35f), .9f), RingOrder + 2, .7f);
            Ring("sigil1", P, .5f, A(Mix(v, Color.white, .4f), .55f + .2f * pulse), RingOrder + 3);
            // Two chains cross the torso.
            for (int s = 0; s < 2; s++)
            {
                Vector3 a = P + new Vector3(s == 0 ? -.5f : .5f, 1.75f, 0), b = P + new Vector3(s == 0 ? .5f : -.5f, .3f, 0);
                for (int k = 0; k < 5; k++)
                {
                    Vector3 q = Vector3.Lerp(a, b, (k + .5f) / 5f); Vector3 d = b - a;
                    float rot = Mathf.Atan2(d.y, d.x) * Mathf.Rad2Deg + (k % 2 == 0 ? 0f : 90f);
                    _pen.Draw(WishFxArt.Chain, q, new Vector2(.3f, .19f), rot, A(Deep(v, 1f), .65f), order);
                    _pen.Draw(WishFxArt.Chain, q, new Vector2(.25f, .15f), rot, A(Mix(v, Color.white, .5f), .95f), order + 1);
                }
            }
            Vector3 mp = P + new Vector3(1.05f, 1.9f + (reduced ? 0f : .06f * Mathf.Sin(t * 2f)), 0);
            _pen.Draw(WishFxArt.Scales, mp, Vector2.one * .56f, 0, A(Deep(v, 1f), .75f), order + 9);
            _pen.Draw(WishFxArt.Scales, mp, Vector2.one * .46f, 0, A(Mix(v, Color.white, .55f), .98f), order + 10);
        }

        void DrawHoly(Vector3 P, int order, uint seed, float t, bool reduced, float dt, in ActorNote n)
        {
            Color h = Fac(4); float pulse = WishFxModel.Pulse(t + seed * .001f, 1.0f, reduced);
            _actors.SetWishTint(n.Id, Mix(h, Color.white, .5f), .14f + .06f * pulse);
            // Behind the body: a column of light, a bubble and its rim (the shield of light).
            _pen.Draw(WishFxArt.Column, P + new Vector3(0, 2.1f, 0), new Vector2(1.75f, 4.4f), 0, A(Deep(h, 1f), .3f), order - 5);
            _pen.Draw(WishFxArt.Column, P + new Vector3(0, 2.1f, 0), new Vector2(1.55f, 4.4f), 0, A(h, .55f + .15f * pulse), order - 4);
            _pen.Draw(WishFxArt.Disc, P + new Vector3(0, 1f, 0), new Vector2(2.0f, 2.35f), 0, A(h, .34f + .08f * pulse), order - 3);
            _pen.Draw(WishFxArt.Hairline, P + new Vector3(0, 1f, 0), new Vector2(2.06f, 2.42f), 0, A(Deep(h, 1f), .8f), order - 3);
            _pen.Draw(WishFxArt.Hairline, P + new Vector3(0, 1f, 0), new Vector2(2.0f, 2.35f), 0, A(Mix(h, Color.white, .35f), 1f), order - 2);
            // In front: a thin rim at the feet and the halo above the bars.
            SafeRing(WishFxArt.Band, P, .95f, A(h, .75f + .2f * pulse), RingOrder + 4);
            Vector3 hp = P + new Vector3(0, 3.35f, 0);
            _pen.Draw(WishFxArt.Hairline, hp, new Vector2(1.4f, .46f), 0, A(Deep(h, 1f), .9f), order + 11);
            _pen.Draw(WishFxArt.Hairline, hp, new Vector2(1.15f, .36f), 0, A(Mix(h, Color.white, .6f), .95f), order + 12);
            _pen.Draw(WishFxArt.Soft, hp, new Vector2(2.2f, 1f), 0, A(h, .55f + .15f * pulse), order + 11);
            if ((n.Effects & WishEffectBits.Haste) != 0 && n.Kind == ActorKind.Player && !reduced) DrawSpeedStreaks(P, order, n.Id, h, dt);
            if (!reduced) for (int q = EmitCount(ref _acc[3], dt, 7f * Mathf.Min(1.5f, Quality.Particles)); q > 0; q--) _particles.Spark(P + new Vector3((Random01(ref _rng) - .5f) * 1.2f, .2f, 0), new Vector3(0, .5f + Random01(ref _rng) * .5f), .12f, 1.2f, A(Mix(h, Color.white, .4f), .9f));
        }

        void DrawSpeedStreaks(Vector3 P, int order, uint id, Color h, float dt)
        {
            if (_lastPos.TryGetValue(id, out var prev) && dt > .0001f)
            {
                Vector3 d = P - prev; float speed = d.magnitude / dt;
                if (speed > .6f)
                {
                    Vector3 dir = -d.normalized; float len = Mathf.Clamp(speed * .12f, .5f, 1.4f);
                    for (int k = 0; k < 3; k++)
                    {
                        Vector3 o = new Vector3(-dir.y, dir.x, 0) * (k - 1) * .22f + new Vector3(0, .35f + k * .22f, 0);
                        Line(WishFxArt.Beam, P + o + dir * .25f, P + o + dir * (.25f + len), .12f, A(Mix(h, Color.white, .6f), .55f - k * .08f), order - 1);
                    }
                }
            }
            _lastPos[id] = P;
        }

        void DrawHiddenSelf(Vector3 P, int order, uint seed, float t, bool reduced, float dt, uint id)
        {
            Color g = Fac(2);
            _actors.SetWishTint(id, g, .22f);
            int n = reduced ? 4 : 8;
            for (int i = 0; i < n; i++)
            {
                float h1 = WishFxModel.Hash01(seed + (uint)i), h2 = WishFxModel.Hash01(seed + (uint)i + 40);
                float ang = h1 * 6.2832f + (reduced ? 0f : t * (1.4f + h2 * 1.8f) * (i % 2 == 0 ? 1f : -1f));
                Vector3 p = P + new Vector3(Mathf.Cos(ang) * (.35f + .35f * h2), .35f + h2 * 1.4f + (reduced ? 0f : .1f * Mathf.Sin(t * 4f + i)), 0);
                Fly(p, ang + 1.57f, .14f, Mix(g, Color.white, .3f), order + 1, .9f, t, i);
            }
            if (!reduced) for (int q = EmitCount(ref _acc[4], dt, 6f * Mathf.Min(1.5f, Quality.Particles)); q > 0; q--) _particles.Float(P + new Vector3((Random01(ref _rng) - .5f) * .9f, .3f + Random01(ref _rng), 0), new Vector3(0, .25f), .1f, 1.0f, A(Mix(g, Color.white, .2f), .75f));
        }

        void DrawBurning(Vector3 P, int order, uint seed, float t, bool reduced, float dt)
        {
            Color f = Fac(0);
            for (int k = 0; k < 3; k++)
            {
                float h = WishFxModel.Hash01(seed + (uint)k * 3);
                float flick = reduced ? .85f : .7f + .3f * Mathf.Sin(t * (10f + h * 4f) + h * 9f);
                Vector3 p = P + new Vector3((k - 1) * .32f, .15f, 0);
                _pen.Draw(WishFxArt.Flame, p + new Vector3(0, .3f * flick, 0), new Vector2(.42f, .6f * flick), 0, A(Mix(f, new Color(1f, .85f, .4f), .3f), .9f), order + 2 + k);
            }
            if (!reduced) for (int q = EmitCount(ref _acc[5], dt, 6f * Mathf.Min(1.5f, Quality.Particles)); q > 0; q--) _particles.Rise(P + new Vector3((Random01(ref _rng) - .5f) * .7f, .6f, 0), new Vector3(0, .6f), .09f, .8f, A(new Color(1f, .75f, .3f), .9f));
        }

        // ---------------------------------------------------------------- small utilities
        uint _rng = 0x9e3779b9u;
        static float Random01(ref uint s) { unchecked { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s & 0xffffff) / 16777215f; } }
        Vector3 Rand2(float radius) { float a = Random01(ref _rng) * 6.2832f, d = Mathf.Sqrt(Random01(ref _rng)) * radius; return new Vector3(Mathf.Cos(a) * d, Mathf.Sin(a) * d * G, 0); }

        /// <summary>How many particles an emitter owes this frame at <paramref name="perSecond"/> (fractions carry in <paramref name="acc"/>).</summary>
        static int EmitCount(ref float acc, float dt, float perSecond)
        {
            if (Quality.Particles <= 0f) return 0;
            acc += dt * perSecond;
            int n = Mathf.Min(3, (int)acc); acc -= (int)acc;
            return n;
        }

        // ---------------------------------------------------------------- pooled sprite pen
        sealed class Pen
        {
            readonly Transform _root; readonly List<SpriteRenderer> _list = new List<SpriteRenderer>(); readonly int _cap;
            int _used, _previous;
            public Pen(Transform parent, int cap) { _root = new GameObject("Wish sprites").transform; _root.SetParent(parent, false); _cap = cap; }
            public int Used { get { return _used; } }
            public int PoolSize { get { return _list.Count; } }
            public void Begin() { _used = 0; }
            public void End() { for (int i = _used; i < _previous && i < _list.Count; i++) _list[i].enabled = false; _previous = _used; }
            public void Draw(string key, Vector3 pos, Vector2 size, float rotDeg, Color color, int order)
            {
                if (color.a <= .004f || _used >= _cap) return;
                SpriteRenderer r;
                if (_used == _list.Count)
                {
                    var go = new GameObject("Wish fx"); go.transform.SetParent(_root, false);
                    r = go.AddComponent<SpriteRenderer>(); ShowcaseSprites.Initialize(); r.sharedMaterial = ShowcaseSprites.Unlit;
                    _list.Add(r);
                }
                else r = _list[_used];
                _used++;
                r.enabled = true;
                r.sprite = key[0] == 's' ? ShowcaseSprites.Get(key) : WishFxArt.Get(key);
                r.color = color; r.sortingOrder = order;
                r.transform.SetPositionAndRotation(pos, Quaternion.Euler(0, 0, rotDeg));
                r.transform.localScale = new Vector3(size.x, size.y, 1f);
            }
        }

        // ---------------------------------------------------------------- capped particle systems
        sealed class Particles
        {
            readonly ParticleSystem _rise, _float, _fall, _spark;
            readonly ParticleSystem[] _all;
            public Particles(Transform parent)
            {
                _rise = Make(parent, "Wish embers and motes (rise)", WishFxArt.Soft, 240, -.12f);
                _float = Make(parent, "Wish motes (drift)", WishFxArt.Soft, 160, 0f);
                _fall = Make(parent, "Wish ice shards", WishFxArt.Shard, 160, .35f);
                _spark = Make(parent, "Wish sparkles", WishFxArt.Cross, 160, 0f);
                _all = new[] { _rise, _float, _fall, _spark };
            }
            public int Capacity { get { int n = 0; foreach (var s in _all) n += s.main.maxParticles; return n; } }
            public int Live { get { int n = 0; foreach (var s in _all) n += s.particleCount; return n; } }
            public void Configure(bool reduced)
            {
                // Reduced motion and the Low preset draw no particles at all; whatever was alive is cleared at once.
                bool off = reduced || Quality.Particles <= 0f;
                foreach (var s in _all) if (off && s.particleCount > 0) s.Clear(false);
            }
            public void Clear() { foreach (var s in _all) s.Clear(false); }
            static bool Off { get { return Quality.Particles <= 0f || Reduced; } }

            public void Rise(Vector3 p, Vector3 v, float size, float life, Color c) { Emit(_rise, p, v, size, life, c, 0); }
            public void Float(Vector3 p, Vector3 v, float size, float life, Color c) { Emit(_float, p, v, size, life, c, 0); }
            public void Fall(Vector3 p, Vector3 v, float size, float life, Color c, float rotDeg) { Emit(_fall, p, v, size, life, c, rotDeg); }
            public void Spark(Vector3 p, Vector3 v, float size, float life, Color c) { Emit(_spark, p, v, size, life, c, 0); }

            static void Emit(ParticleSystem ps, Vector3 p, Vector3 v, float size, float life, Color c, float rotDeg)
            {
                if (Off) return;
                var ep = new ParticleSystem.EmitParams
                {
                    position = p, velocity = v, startSize = size, startLifetime = life, startColor = c, rotation = rotDeg
                };
                ps.Emit(ep, 1);
            }

            static ParticleSystem Make(Transform parent, string name, string textureKey, int max, float gravity)
            {
                var go = new GameObject(name); go.transform.SetParent(parent, false);
                var ps = go.AddComponent<ParticleSystem>();
                ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
                var main = ps.main;
                main.loop = true; main.playOnAwake = false; main.maxParticles = max; main.simulationSpace = ParticleSystemSimulationSpace.World;
                main.startLifetime = 1f; main.startSpeed = 0f; main.startSize = .12f; main.gravityModifier = gravity; main.scalingMode = ParticleSystemScalingMode.Hierarchy;
                main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
                var emission = ps.emission; emission.enabled = false; emission.rateOverTime = 0f;
                var shape = ps.shape; shape.enabled = false;
                var col = ps.colorOverLifetime; col.enabled = true;
                var g = new Gradient();
                g.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) },
                    new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(1f, .12f), new GradientAlphaKey(.8f, .6f), new GradientAlphaKey(0f, 1f) });
                col.color = new ParticleSystem.MinMaxGradient(g);
                var size = ps.sizeOverLifetime; size.enabled = true;
                size.size = new ParticleSystem.MinMaxCurve(1f, new AnimationCurve(new Keyframe(0, .6f), new Keyframe(.2f, 1f), new Keyframe(1, .25f)));
                var r = go.GetComponent<ParticleSystemRenderer>();
                r.renderMode = ParticleSystemRenderMode.Billboard; r.sortingOrder = ParticleOrder; r.sharedMaterial = WishFxArt.ParticleMaterial(textureKey);
                ps.Play();
                return ps;
            }
        }

    }
}
