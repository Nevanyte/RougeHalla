using System;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Surface-reactive effects: lingering prints, water and bog ripples and wakes, and surface footstep sounds. Presentation only.
    ///
    /// FAIRNESS: every cue is produced from <see cref="NoteActor"/>, which the actor presenter calls only for actors the server delivered, at
    /// their delivered positions. Nothing is extrapolated for an actor that stopped being delivered; marks already placed simply live
    /// out their lifetime (prints 10 s) and are dimmed by the fog layer like the ground under them.
    ///
    /// SHADER HOOK (ripple positions for a later distortion/reflection pass): <see cref="CopyRipples"/> fills a caller array with the
    /// currently active ripple centres (world space), birth time (same clock as Time.unscaledTime), life, final diameter in world units
    /// and the reaction (Shallow or Bog). Also the shader globals _RhFxNow (clock) and the atlas are public via <see cref="SurfaceFxAtlas"/>.
    /// Debug: ?surfacefx=1 logs every print, ripple and footstep cue to the browser console.
    /// </summary>
    public sealed class SurfaceFx
    {
        public const int TrackSortingOrder = -40, FluidSortingOrder = -39;
        public const float ActorVisualScale = 1.2f, StandardHeight = 1.9f;
        public const int MaxRipples = 64;

        public struct RippleInfo { public Vector2 World; public float Birth, Life, Diameter; public WaterReaction Reaction; }

        public static SurfaceFx Current;
        public static bool DebugLog;
        /// <summary>Test hook: receives each log line instead of (as well as) the console.</summary>
        public static Action<string> LogSink;
        /// <summary>Injectable clocks (seconds, frame stamp) so EditMode tests can step time.</summary>
        public Func<float> Clock = () => Time.unscaledTime;
        public Func<int> FrameStamp = () => Time.frameCount;

        public int PrintsEmitted, RipplesEmitted, StepsRequested, StepsPlayed;
        public FootTracker Tracker { get { return _tracker; } }
        public SurfaceFxMesh Tracks { get { return _tracks; } }
        public SurfaceFxMesh Fluids { get { return _fluids; } }

        readonly Func<float, float, SurfaceKind> _surfaceAt;
        readonly Transform _root;
        readonly FootTracker _tracker = new FootTracker();
        readonly SurfaceFxMesh _tracks, _fluids;
        readonly SurfaceFootsteps _steps;
        readonly Material _material;
        readonly RippleInfo[] _ripples = new RippleInfo[MaxRipples];
        int _rippleNext;
        readonly System.Random _rng = new System.Random(77);
        float _localX, _localY; bool _haveLocal;
        float _now;
        bool _hidden;
        static readonly Vector2 SunWorld = -RegionShadowMap.ShadowPerHeight;

        public static SurfaceFx Create(ArenaView arena)
        {
            var root = new GameObject("Surface effects").transform; root.SetParent(arena.transform, false);
            var fx = new SurfaceFx(root, (x, y) => arena.Surfaces.SurfaceAtServer(x, y));
            string url = ""; try { url = Application.absoluteURL ?? ""; } catch (Exception) { }
            DebugLog = url.IndexOf("surfacefx=1", StringComparison.OrdinalIgnoreCase) >= 0;
            Debug.Log("[surfacefx] ready debug=" + DebugLog + " urlLength=" + url.Length);
            Current = fx;
            return fx;
        }

        public SurfaceFx(Transform root, Func<float, float, SurfaceKind> surfaceAt)
        {
            _root = root; _surfaceAt = surfaceAt;
            var shader = Resources.Load<Shader>("Shaders/RhSurfaceFx");
            _material = shader != null ? new Material(shader) { name = "SurfaceFx", mainTexture = SurfaceFxAtlas.Texture } : null;
            if (_material == null) _material = new Material(Shader.Find("Sprites/Default")) { mainTexture = SurfaceFxAtlas.Texture };
            _tracks = new SurfaceFxMesh(root, "Prints", SurfaceFxQuality.MaxTracks, _material, TrackSortingOrder);
            _fluids = new SurfaceFxMesh(root, "Ripples and wakes", SurfaceFxQuality.MaxFluids, _material, FluidSortingOrder);
            UnityEngine.Audio.AudioMixerGroup group = null;
            try { var cat = Resources.Load<ShowcaseCatalog>("Showcase/Catalog"); if (cat != null) group = cat.SfxGroup; } catch (Exception) { }
            _steps = new SurfaceFootsteps(root, VoicePicker.DefaultVoices, group);
            ApplyQuality();
            AtmosphereQuality.Changed += ApplyQuality;
        }

        public void Dispose()
        {
            AtmosphereQuality.Changed -= ApplyQuality;
            if (Current == this) Current = null;
            _tracks.Destroy(); _fluids.Destroy();
            if (_root != null) UnityEngine.Object.Destroy(_root.gameObject);
        }

        void ApplyQuality()
        {
            if (_root == null) { AtmosphereQuality.Changed -= ApplyQuality; return; }   // the arena that owned this was destroyed
            _tracks.SetCap(AtmosphereQuality.SurfaceTrackCap);
            _fluids.SetCap(AtmosphereQuality.SurfaceRipples ? AtmosphereQuality.SurfaceFluidCap : 0);
        }

        /// <summary>Hook target: the actor presenter calls this for every delivered actor, every present (and for nothing else).</summary>
        public void Note(uint id, float x, float y, ActorKind kind, bool local, bool dead, float lookHeight, bool walking, float phase, int walkFrames)
        {
            _now = Clock();
            if (local) { _localX = x; _localY = y; _haveLocal = true; }
            var surface = _surfaceAt(x, y);
            var o = new Observation
            {
                Id = id, Local = local, Mob = kind != ActorKind.Player, Alive = !dead, X = x, Y = y,
                Size = Mathf.Clamp(lookHeight * ActorVisualScale / StandardHeight, .6f, 2f),
                Surface = (FxSurface)(byte)surface, PhaseValid = walking && walkFrames >= 2, Phase = phase, WalkFrames = walkFrames,
                Frame = FrameStamp(), Now = _now
            };
            _tracker.ClearEvents();
            _tracker.Observe(o);
            for (int i = 0; i < _tracker.EventCount; i++) Handle(_tracker.Events[i], kind);
        }

        void Handle(in FootEvent ev, ActorKind kind)
        {
            switch (ev.Kind)
            {
                case FootEventKind.Print: Print(ev, kind); break;
                case FootEventKind.Step: Step(ev, kind); break;
                case FootEventKind.Wake: Wake(ev, kind); break;
                case FootEventKind.Idle: Idle(ev, kind); break;
            }
        }

        // ---- geometry helpers: server units to world, vectors in tiles to world (ground squash) ----
        static Vector2 Ground(float sx, float sy) { return new Vector2(sx * ArenaView.Scale, -sy * ArenaView.Scale * ArenaView.GroundSquash); }
        static Vector2 Vec(float tx, float ty) { return new Vector2(tx, -ty * ArenaView.GroundSquash); }
        static Color32 Col(float r, float g, float b, float a) { return new Color32((byte)(r * 255), (byte)(g * 255), (byte)(b * 255), (byte)(Mathf.Clamp01(a) * 255)); }
        void LogLine(string s) { if (DebugLog) Debug.Log("[surfacefx] " + s); var sink = LogSink; if (sink != null) sink(s); }
        float Rnd() { return (float)_rng.NextDouble(); }

        // ---- prints ----
        void Print(in FootEvent ev, ActorKind kind)
        {
            var sf = (SurfaceKind)(byte)ev.Surface;
            if (SurfaceFxTable.IsWet(ev.Surface)) { if (AtmosphereQuality.SurfaceRipples) Footfall(ev, kind); return; }
            if (_tracks.Capacity == 0 || ev.Style == PrintStyle.None) return;
            Vector2 c = Ground(ev.X, ev.Y), d = new Vector2(ev.DirX, ev.DirY), sd = new Vector2(-d.y, d.x);
            float s = ev.Size, len = .9f * s, wid = .66f * s;
            int cell = SurfaceFxAtlas.Foot; float style = 0, life = TrackLife.Lifetime, fade = TrackLife.FadeSeconds;
            Color32 col; bool mirror = ev.Foot == 1;
            switch (ev.Style)
            {
                case PrintStyle.Sand: col = Col(.20f, .12f, .06f, .92f); style = 1; break;
                case PrintStyle.Snow: col = Col(.30f, .40f, .62f, .95f); style = 2; wid = .74f * s; break;
                case PrintStyle.Mud: col = Col(.05f, .035f, .025f, .88f); style = 3; break;
                case PrintStyle.Grass: col = Col(.07f, .14f, .04f, .5f); cell = SurfaceFxAtlas.GrassTrail; len = 1.7f * s; wid = .5f * s; mirror = false; break;
                case PrintStyle.Ash:
                    cell = SurfaceFxAtlas.Scuff; len = .9f * s; wid = .7f * s; mirror = false;
                    col = ev.Surface == FxSurface.Ember ? Col(.05f, .04f, .04f, .7f) : Col(.66f, .63f, .6f, .5f); break;
                case PrintStyle.Wet: col = Col(.04f, .06f, .08f, .75f * ev.Wetness); style = 3; life = 3.2f; fade = 1.6f; break;
                default: return;
            }
            Vector2 u = Vec(sd.x, sd.y) * wid, v = Vec(d.x, d.y) * len;
            var r = SurfaceFxAtlas.Rect(cell); if (mirror) { float t = r.x; r.x = r.z; r.z = t; }
            _tracks.Add(c, u, v, r, col, _now, life, fade, 1f, 1f, style, SunWorld);
            PrintsEmitted++;
            LogLine("print surface=" + sf + " style=" + ev.Style + " actor=" + Kind(ev) + " foot=" + ev.Foot + " at=" + (int)ev.X + "," + (int)ev.Y);
        }

        // ---- water and bog ----
        void Ring(Vector2 c, int cell, Color32 col, float birth, WaterSpec spec, float extentTiles, float sizeScale, WaterReaction reaction, float style = 0)
        {
            if (_fluids.Capacity == 0) return;
            Vector2 u = Vec(extentTiles, 0), v = Vec(0, extentTiles);
            _fluids.Add(c, u, v, SurfaceFxAtlas.Rect(cell), col, birth, spec.Life, spec.Life * .85f, spec.SizeFrom * sizeScale, spec.SizeTo * sizeScale, style, SunWorld);
            var info = new RippleInfo { World = c, Birth = birth, Life = spec.Life, Diameter = extentTiles * spec.SizeTo * sizeScale * .82f, Reaction = reaction };
            if (cell == SurfaceFxAtlas.RingThin || cell == SurfaceFxAtlas.RingThick) { _ripples[_rippleNext] = info; _rippleNext = (_rippleNext + 1) % MaxRipples; }
        }

        void Footfall(in FootEvent ev, ActorKind kind)
        {
            var reaction = ev.Surface == FxSurface.Bog ? WaterReaction.Bog : WaterReaction.Shallow;
            Vector2 c = Ground(ev.X, ev.Y); float s = ev.Size;
            if (reaction == WaterReaction.Shallow)
            {
                var spec = WaterFxModel.Ring(reaction);
                Ring(c, SurfaceFxAtlas.RingThin, Col(.86f, .97f, .95f, spec.Alpha), _now, spec, 1.6f * s, 1f, reaction);
                var inner = spec; inner.Life = .8f; inner.SizeTo *= .65f;
                Ring(c, SurfaceFxAtlas.RingThin, Col(.86f, .97f, .95f, spec.Alpha * .8f), _now + .09f, inner, 1.6f * s, 1f, reaction);
                float a = Rnd() * Mathf.PI * 2f; Vector2 sd = new Vector2(Mathf.Cos(a), Mathf.Sin(a));
                var sp = new WaterSpec { Life = .5f, SizeFrom = .55f, SizeTo = 1.25f, Alpha = .6f };
                Ring(c, SurfaceFxAtlas.Splash, Col(.92f, 1f, 1f, sp.Alpha), _now, sp, .9f * s, 1f, reaction);
            }
            else
            {
                var spec = WaterFxModel.Ring(reaction);
                Ring(c, SurfaceFxAtlas.RingThick, Col(.17f, .21f, .07f, spec.Alpha), _now, spec, 1.6f * s, 1f, reaction);
                var glow = new WaterSpec { Life = .9f, SizeFrom = .5f, SizeTo = 1.1f, Alpha = .3f };
                Ring(c, SurfaceFxAtlas.Glow, Col(.62f, .78f, .22f, glow.Alpha), _now, glow, 1.4f * s, 1f, reaction, 5);
                for (int i = 0; i < 2; i++)
                {
                    var bub = new WaterSpec { Life = .9f + Rnd() * .4f, SizeFrom = .3f, SizeTo = 1f, Alpha = .55f };
                    Vector2 off = Vec((Rnd() - .5f) * .7f * s, (Rnd() - .5f) * .5f * s);
                    Ring(c + off, SurfaceFxAtlas.Bubble, Col(.62f, .72f, .36f, bub.Alpha), _now + .1f + Rnd() * .25f, bub, .34f * s, 1f, reaction);
                }
            }
            RipplesEmitted++;
            LogLine("ripple surface=" + ev.Surface + " reaction=" + reaction + " actor=" + Kind(ev));
        }

        void Wake(in FootEvent ev, ActorKind kind)
        {
            if (!AtmosphereQuality.SurfaceRipples) return;
            var reaction = ev.Surface == FxSurface.Bog ? WaterReaction.Bog : WaterReaction.Shallow;
            Vector2 c = Ground(ev.X, ev.Y), d = new Vector2(ev.DirX, ev.DirY); float s = ev.Size;
            var spec = WaterFxModel.Wake(reaction);
            if (reaction == WaterReaction.Shallow)
            {
                for (int side = -1; side <= 1; side += 2)
                {
                    float ang = side * 25f * Mathf.Deg2Rad; float ca = Mathf.Cos(ang), sa = Mathf.Sin(ang);
                    Vector2 back = new Vector2(-d.x, -d.y); Vector2 arm = new Vector2(back.x * ca - back.y * sa, back.x * sa + back.y * ca);
                    Vector2 armSide = new Vector2(-arm.y, arm.x);
                    float len = 1.1f * s;
                    Vector2 mid = c + Vec(arm.x, arm.y) * (len * .5f);
                    _fluids.Add(mid, Vec(armSide.x, armSide.y) * (.5f * s), Vec(arm.x, arm.y) * len, SurfaceFxAtlas.Rect(SurfaceFxAtlas.Streak), Col(.84f, .96f, .94f, spec.Alpha), _now, spec.Life, spec.Life * .8f, spec.SizeFrom, spec.SizeTo, 0, SunWorld);
                }
                var dist = new WaterSpec { Life = 1.6f, SizeFrom = .6f, SizeTo = 1.2f, Alpha = .16f };
                Ring(c, SurfaceFxAtlas.Smudge, Col(.55f, .75f, .75f, dist.Alpha), _now, dist, 1.1f * s, 1f, reaction);
            }
            else
            {
                Vector2 side = new Vector2(-d.y, d.x);
                Vector2 mid = c + Vec(-d.x, -d.y) * (.45f * s);
                _fluids.Add(mid, Vec(side.x, side.y) * (.55f * s), Vec(d.x, d.y) * (1.1f * s), SurfaceFxAtlas.Rect(SurfaceFxAtlas.Trough), Col(.12f, .15f, .06f, spec.Alpha), _now, spec.Life, spec.Life * .8f, spec.SizeFrom, spec.SizeTo, 0, SunWorld);
            }
            RipplesEmitted++;
            LogLine("wake surface=" + ev.Surface + " reaction=" + reaction + " actor=" + Kind(ev));
        }

        void Idle(in FootEvent ev, ActorKind kind)
        {
            if (!AtmosphereQuality.SurfaceRipples) return;
            var reaction = ev.Surface == FxSurface.Bog ? WaterReaction.Bog : WaterReaction.Shallow;
            Vector2 c = Ground(ev.X, ev.Y); float s = ev.Size;
            if (reaction == WaterReaction.Shallow)
            {
                var spec = new WaterSpec { Life = 1.7f, SizeFrom = .2f, SizeTo = .85f, Alpha = .34f };
                Ring(c, SurfaceFxAtlas.RingThin, Col(.86f, .97f, .95f, spec.Alpha), _now, spec, 1.6f * s, 1f, reaction);
            }
            else
            {
                var spec = new WaterSpec { Life = 2.8f, SizeFrom = .25f, SizeTo = .55f, Alpha = .5f };
                Ring(c, SurfaceFxAtlas.RingThick, Col(.17f, .21f, .07f, spec.Alpha), _now, spec, 1.6f * s, 1f, reaction);
                var bub = new WaterSpec { Life = 1.1f, SizeFrom = .3f, SizeTo = 1f, Alpha = .5f };
                Ring(c + Vec((Rnd() - .5f) * .5f, (Rnd() - .5f) * .3f), SurfaceFxAtlas.Bubble, Col(.62f, .72f, .36f, bub.Alpha), _now, bub, .34f * s, 1f, reaction);
            }
            RipplesEmitted++;
            LogLine("idle-ring surface=" + ev.Surface + " reaction=" + reaction + " actor=" + Kind(ev));
        }

        // ---- sound ----
        void Step(in FootEvent ev, ActorKind kind)
        {
            if (!AtmosphereQuality.SurfaceFootsteps) return;
            var sound = SurfaceFxTable.For(ev.Surface).Sound;
            if (sound == StepSound.None) return;
            float dist = 0f;
            if (!ev.Local)
            {
                if (!_haveLocal) return;
                float dx = ev.X - _localX, dy = ev.Y - _localY; dist = Mathf.Sqrt(dx * dx + dy * dy) / 32f;
            }
            float screenX = 0f; var cam = Camera.main;
            if (cam != null && cam.orthographic && !ev.Local)
            {
                float halfW = cam.orthographicSize * cam.aspect; screenX = halfW > .01f ? (Ground(ev.X, ev.Y).x - cam.transform.position.x) / halfW : 0f;
            }
            if (!FootstepVoicing.Plan(ev.Local, ev.Mob, dist, screenX, out float gain, out float pan)) return;
            StepsRequested++;
            float sfx = ShowcaseSettings.Current != null ? ShowcaseSettings.Current.SfxVolume : .85f;
            int voice = AtmosphereQuality.Audio ? _steps.Play(sound, gain, pan, dist, sfx, _now) : -1;
            if (voice >= 0) StepsPlayed++;
            LogLine("step surface=" + ev.Surface + " sound=" + sound + " actor=" + Kind(ev) + " at=" + (int)ev.X + "," + (int)ev.Y + " dist=" + dist.ToString("0.0") + " gain=" + gain.ToString("0.00") + " voice=" + voice);
        }

        static string Kind(in FootEvent ev) { return ev.Local ? "Local" : ev.Mob ? "Mob" : "Player"; }

        /// <summary>Active ripple centres for a later shader pass. Returns how many were written to <paramref name="dest"/>.</summary>
        public int CopyRipples(RippleInfo[] dest)
        {
            int n = 0;
            for (int i = 0; i < MaxRipples && n < dest.Length; i++)
            { var r = _ripples[i]; if (r.Life > 0f && _now < r.Birth + r.Life) dest[n++] = r; }
            return n;
        }

        float _nextCensus, _nextBeat;
        /// <summary>Debug only (?surfacefx=1): logs the local player's position and the nearest interior tile of each surface, so automated runs can steer to it.</summary>
        void Census()
        {
            if (!DebugLog || !_haveLocal || _now < _nextCensus) return;
            _nextCensus = _now + 6f;
            try { CensusNow(); } catch (Exception e) { LogLine("census failed: " + e.Message); }
        }
        void CensusNow()
        {
            var best = new float[16]; var bx = new int[16]; var by = new int[16];
            for (int i = 0; i < best.Length; i++) best[i] = float.MaxValue;
            int ltx = (int)(_localX / 32f), lty = (int)(_localY / 32f);
            for (int ty = 0; ty < 200; ty++) for (int tx = 0; tx < 200; tx++)
            {
                int k = (int)_surfaceAt(tx * 32f + 16f, ty * 32f + 16f); if (k <= 0 || k >= 16) continue;
                // interior only: every tile within 3 of it is the same surface, so a run through it stays on that surface for a while
                bool inside = true;
                for (int oy = -3; oy <= 3 && inside; oy += 3) for (int ox = -3; ox <= 3 && inside; ox += 3) if ((int)_surfaceAt((tx + ox) * 32f + 16f, (ty + oy) * 32f + 16f) != k) inside = false;
                if (!inside) continue;
                float d = (tx - ltx) * (tx - ltx) + (ty - lty) * (ty - lty); if (d < best[k]) { best[k] = d; bx[k] = tx; by[k] = ty; }
            }
            var sb = new System.Text.StringBuilder("census local=" + (int)_localX + "," + (int)_localY + " under=" + _surfaceAt(_localX, _localY));
            for (int k = 1; k < 16; k++) if (best[k] < float.MaxValue) sb.Append(' ').Append((SurfaceKind)k).Append("=tile(").Append(bx[k]).Append(',').Append(by[k]).Append(")d").Append((int)Mathf.Sqrt(best[k]));
            LogLine(sb.ToString());
        }

        /// <summary>Once per frame, after the actors were presented: updates the shader clock and rebuilds the visible batches.</summary>
        public void Tick(float dt)
        {
            _now = Clock();
            Shader.SetGlobalFloat("_RhFxNow", _now);
            Shader.SetGlobalFloat("_RhFxGlisten", AtmosphereQuality.SurfaceGlisten ? 1f : 0f);
            var cam = Camera.main; Vector4 view = default; bool cull = false;
            if (cam != null && cam.orthographic)
            {
                float h = cam.orthographicSize + 1.5f, w = cam.orthographicSize * cam.aspect + 1.5f; var p = cam.transform.position;
                view = new Vector4(p.x - w, p.y - h, p.x + w, p.y + h); cull = true;
            }
            _tracks.Flush(_now, view, cull);
            _fluids.Flush(_now, view, cull);
            if (DebugLog && _now >= _nextBeat) { _nextBeat = _now + 5f; LogLine("beat prints=" + PrintsEmitted + " drawn=" + _tracks.LastDrawn + " cap=" + _tracks.Capacity + " recycled=" + _tracks.Recycled + " ripples=" + RipplesEmitted + " fluidsDrawn=" + _fluids.LastDrawn + " steps=" + StepsPlayed + "/" + StepsRequested + " walkers=" + _tracker.WalkerCount); }
            Census();
        }

        /// <summary>Drops every mark and tracker state (a new match or a clock cut).</summary>
        public void Reset() { _tracker.Reset(); _tracks.Clear(); _fluids.Clear(); Array.Clear(_ripples, 0, _ripples.Length); _haveLocal = false; }
    }
}
