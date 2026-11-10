using System;

namespace Roguehalla.Net
{
    /// <summary>
    /// Engine-independent mirror of the client's SurfaceKind (same names, same byte values; an EditMode test asserts the match), so the
    /// surface-to-effect tables below can be unit tested without Unity. Presentation only: no game rule reads any of this.
    /// </summary>
    public enum FxSurface : byte
    {
        None, Snow, Ice, Sand, TempleFloor, Flagstone, Basalt, Ember, Lava, Mud, Grass, ShallowWater, Bog, Limestone, HolyLight
    }

    /// <summary>Look of a lingering print on the ground.</summary>
    public enum PrintStyle : byte { None, Sand, Snow, Mud, Grass, Ash, Wet }

    /// <summary>How water-like ground reacts to a walker.</summary>
    public enum WaterReaction : byte { None, Shallow, Bog }

    /// <summary>Footstep sound family. Several variations of each are produced.</summary>
    public enum StepSound : byte { None, Snow, Sand, Grass, Mud, Water, Bog, Stone, Temple, Gritty, Ice }

    public struct SurfaceFxProfile
    {
        public PrintStyle Print;
        public WaterReaction Water;
        public StepSound Sound;
    }

    /// <summary>Surface to effect mapping (pure). Stone family, ice, lava and holy light leave no dry prints on purpose: a competitive view must stay uncluttered.</summary>
    public static class SurfaceFxTable
    {
        public static SurfaceFxProfile For(FxSurface s)
        {
            switch (s)
            {
                case FxSurface.Snow: return P(PrintStyle.Snow, WaterReaction.None, StepSound.Snow);
                case FxSurface.Sand: return P(PrintStyle.Sand, WaterReaction.None, StepSound.Sand);
                case FxSurface.Mud: return P(PrintStyle.Mud, WaterReaction.None, StepSound.Mud);
                case FxSurface.Grass: return P(PrintStyle.Grass, WaterReaction.None, StepSound.Grass);
                case FxSurface.ShallowWater: return P(PrintStyle.None, WaterReaction.Shallow, StepSound.Water);
                case FxSurface.Bog: return P(PrintStyle.None, WaterReaction.Bog, StepSound.Bog);
                case FxSurface.Basalt: return P(PrintStyle.Ash, WaterReaction.None, StepSound.Gritty);
                case FxSurface.Ember: return P(PrintStyle.Ash, WaterReaction.None, StepSound.Gritty);
                case FxSurface.Lava: return P(PrintStyle.None, WaterReaction.None, StepSound.Gritty);
                case FxSurface.TempleFloor: return P(PrintStyle.None, WaterReaction.None, StepSound.Temple);
                case FxSurface.HolyLight: return P(PrintStyle.None, WaterReaction.None, StepSound.Temple);
                case FxSurface.Flagstone: return P(PrintStyle.None, WaterReaction.None, StepSound.Stone);
                case FxSurface.Limestone: return P(PrintStyle.None, WaterReaction.None, StepSound.Stone);
                case FxSurface.Ice: return P(PrintStyle.None, WaterReaction.None, StepSound.Ice);
                default: return P(PrintStyle.None, WaterReaction.None, StepSound.None);
            }
        }
        static SurfaceFxProfile P(PrintStyle p, WaterReaction w, StepSound s) { return new SurfaceFxProfile { Print = p, Water = w, Sound = s }; }

        /// <summary>True for surfaces that wet the feet.</summary>
        public static bool IsWet(FxSurface s) { return s == FxSurface.ShallowWater || s == FxSurface.Bog; }
    }

    /// <summary>Lifetime and fade of a lingering mark. The vertex shader mirrors <see cref="Alpha"/> exactly.</summary>
    public static class TrackLife
    {
        public const float Lifetime = 10f;
        /// <summary>The gentle fade at the end of a track's life.</summary>
        public const float FadeSeconds = 2.5f;
        /// <summary>Short fade-in so a new print does not pop.</summary>
        public const float FadeInSeconds = 0.1f;

        /// <summary>Opacity multiplier 0..1 at <paramref name="age"/> seconds for a mark living <paramref name="life"/> seconds.</summary>
        public static float Alpha(float age, float life, float fadeSeconds)
        {
            if (!(age >= 0f) || age >= life) return 0f;
            float fin = Math.Min(1f, age / FadeInSeconds);
            float f0 = life - fadeSeconds;
            float t = fadeSeconds <= 0f ? 0f : Clamp01((age - f0) / fadeSeconds);
            float tail = 1f - t * t * (3f - 2f * t);
            return fin * tail;
        }
        public static bool Alive(float age, float life) { return age < life; }
        static float Clamp01(float v) { return v < 0f ? 0f : v > 1f ? 1f : v; }
    }

    /// <summary>Which footfalls an advancing walk phase crosses. Two per cycle (contact poses at 0 and half), for forward and backward walking.</summary>
    public static class Footfalls
    {
        /// <summary>Number of footfalls between two phases (frames) of a walk clip with <paramref name="frames"/> frames. Capped at 3 per call.</summary>
        public static int Crossings(float prevPhase, float phase, int frames)
        {
            if (frames < 2 || float.IsNaN(prevPhase) || float.IsNaN(phase)) return 0;
            float half = frames * 0.5f;
            int a = (int)Math.Floor(prevPhase / half), b = (int)Math.Floor(phase / half);
            int n = Math.Abs(b - a);
            return n > 3 ? 3 : n;
        }
    }

    /// <summary>Spawn parameters for the water and bog reactions (pure data; the renderer maps them to quads).</summary>
    public struct WaterSpec
    {
        public float Life, SizeFrom, SizeTo, Alpha;
    }

    public static class WaterFxModel
    {
        public const float ShallowWakeInterval = 0.10f, BogWakeInterval = 0.20f;
        public const float ShallowIdleInterval = 1.15f, BogIdleInterval = 2.2f;
        public const float IdleAfterSeconds = 0.5f;
        public static WaterSpec Ring(WaterReaction r)
        {
            return r == WaterReaction.Bog
                ? new WaterSpec { Life = 2.4f, SizeFrom = 0.30f, SizeTo = 0.62f, Alpha = 0.55f }   // thick, slow, barely travels
                : new WaterSpec { Life = 1.1f, SizeFrom = 0.25f, SizeTo = 1.05f, Alpha = 0.50f };  // light, quick, wide
        }
        public static WaterSpec Wake(WaterReaction r)
        {
            return r == WaterReaction.Bog
                ? new WaterSpec { Life = 2.0f, SizeFrom = 1.0f, SizeTo = 0.30f, Alpha = 0.42f }    // trough that closes
                : new WaterSpec { Life = 0.9f, SizeFrom = 0.55f, SizeTo = 1.45f, Alpha = 0.34f };  // V arms that spread
        }
    }
}

namespace Roguehalla.Net
{
    public struct SurfaceFxSwitches
    {
        /// <summary>Print pool capacity; 0 switches tracks off.</summary>
        public int TrackCap;
        public bool Ripples, Footsteps, Glisten;
        /// <summary>Ripple and splash pool capacity.</summary>
        public int FluidCap;
    }

    /// <summary>Quality preset (0 Low, 1 Medium, 2 High, 3 Ultra) and reduced motion to switches (pure).</summary>
    public static class SurfaceFxQuality
    {
        public const int MaxTracks = 1536, MaxFluids = 768;
        public static SurfaceFxSwitches Decide(int preset, bool reducedMotion)
        {
            var s = new SurfaceFxSwitches { Footsteps = true };
            if (preset <= 0) { s.TrackCap = 384; s.FluidCap = 0; s.Ripples = false; }
            else if (preset == 1) { s.TrackCap = 768; s.FluidCap = 384; s.Ripples = true; }
            else { s.TrackCap = MaxTracks; s.FluidCap = MaxFluids; s.Ripples = true; }
            s.Glisten = preset >= 2;
            if (reducedMotion) { s.Ripples = false; s.FluidCap = 0; s.Glisten = false; }   // static, slowly fading prints stay; moving water effects go
            return s;
        }
    }

    /// <summary>Fixed-capacity ring of mark lifetimes: the pure bookkeeping behind the pooled meshes (oldest recycled at the cap).</summary>
    public sealed class MarkPool
    {
        readonly float[] _birth, _life;
        int _next, _count;
        public int Capacity { get; private set; }
        public int Recycled { get; private set; }
        public MarkPool(int capacity) { Capacity = capacity; _birth = new float[capacity]; _life = new float[capacity]; }
        /// <summary>Claims the slot for a new mark; when full this recycles the oldest.</summary>
        public int Add(float birth, float life)
        {
            if (Capacity == 0) return -1;
            int slot = _next; _next = (_next + 1) % Capacity;
            if (_count < Capacity) _count++;
            else if (_birth[slot] + _life[slot] > birth) Recycled++;
            _birth[slot] = birth; _life[slot] = life;
            return slot;
        }
        public bool IsLive(int slot, float now) { return slot >= 0 && slot < Capacity && now < _birth[slot] + _life[slot] && _life[slot] > 0f; }
        public int LiveCount(float now) { int n = 0; for (int i = 0; i < _count; i++) if (IsLive(i, now)) n++; return n; }
        public int Used { get { return _count; } }
        public void Clear() { _next = 0; _count = 0; for (int i = 0; i < Capacity; i++) { _birth[i] = 0; _life[i] = 0; } }
    }
}
