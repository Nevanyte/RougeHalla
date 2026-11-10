using System;

namespace Roguehalla.Net
{
    public enum FootEventKind : byte
    {
        /// <summary>A foot lands on ground that leaves a print (or, on water or bog, a footfall ripple).</summary>
        Print,
        /// <summary>A footstep sound is due (from the walk phase where the actor has one, from distance otherwise).</summary>
        Step,
        /// <summary>A wake or trough segment while moving through water or bog.</summary>
        Wake,
        /// <summary>An idle ring while standing still in water or bog.</summary>
        Idle
    }

    public struct FootEvent
    {
        public FootEventKind Kind;
        public uint Id;
        public bool Local, Mob;
        /// <summary>Server units. Prints are already shifted sideways to the foot that landed.</summary>
        public float X, Y;
        /// <summary>Unit heading of the movement.</summary>
        public float DirX, DirY;
        public byte Foot;
        public FxSurface Surface;
        public PrintStyle Style;
        /// <summary>1 for a normal print, less for the last wet prints after leaving water (they dry quickly).</summary>
        public float Wetness;
        public float Size;
    }

    public struct Observation
    {
        public uint Id;
        public bool Local, Mob, Alive;
        /// <summary>Delivered position, server units.</summary>
        public float X, Y;
        /// <summary>Look size factor (1 = a standard character); scales stride, feet and prints.</summary>
        public float Size;
        public FxSurface Surface;
        /// <summary>True when the actor has a live walk animation whose continuous phase drives its footfalls.</summary>
        public bool PhaseValid;
        public float Phase;
        public int WalkFrames;
        /// <summary>Monotonic frame stamp: a second observation in the same frame is a duplicate.</summary>
        public int Frame;
        public float Now;
    }

    /// <summary>
    /// Turns delivered actor positions into foot events. It never needs a stable actor id: the server renews mob handles almost every
    /// observation, so a walker is found by id when it is still around and otherwise by position (a mob appearing within
    /// <see cref="RenewRadius"/> of a walker last seen very recently continues it). A walker that is not observed again simply stops
    /// producing events: nothing is ever extrapolated for an actor that is no longer delivered. Pure, allocation-free after construction.
    /// </summary>
    public sealed class FootTracker
    {
        public const int MaxWalkers = 64;
        public const float TileUnits = 32f;
        /// <summary>Distance between prints (tiles, scaled by look size).</summary>
        public const float StrideTiles = 1.15f;
        /// <summary>Distance between sounds for an actor without a walk phase (tiles).</summary>
        public const float StepStrideTiles = 1.9f;
        public const float SideTiles = 0.17f;
        public const float MoveEpsilon = 0.4f;
        public const float TeleportUnits = 160f;
        public const float StaleSeconds = 0.6f;
        public const float RenewRadius = 64f;
        public const float SameSpot = 0.5f;
        public const int WetPrints = 5;

        struct Walker
        {
            public bool Used;
            public uint Id; public bool Mob;
            public float X, Y, DirX, DirY, Seen, Idle, StepDist, Dist, WakeAcc, IdleAcc, Phase;
            public bool HaveDir, HavePhase;
            public int Frame, Foot, Wet;
        }

        readonly Walker[] _w = new Walker[MaxWalkers];
        public readonly FootEvent[] Events;
        public int EventCount { get; private set; }
        public int Dropped { get; private set; }
        public int WalkerCount { get { int n = 0; for (int i = 0; i < _w.Length; i++) if (_w[i].Used) n++; return n; } }

        public FootTracker(int eventCapacity = 512) { Events = new FootEvent[eventCapacity]; }

        public void ClearEvents() { EventCount = 0; }
        public void Reset() { Array.Clear(_w, 0, _w.Length); EventCount = 0; Dropped = 0; }

        int Find(in Observation o)
        {
            int best = -1;
            for (int i = 0; i < _w.Length; i++)
                if (_w[i].Used && _w[i].Id == o.Id && !_w[i].Mob == !o.Mob && Dist2(_w[i], o) <= TeleportUnits * TeleportUnits) return i;
            if (!o.Mob) return -1;
            float bestD = RenewRadius * RenewRadius;
            for (int i = 0; i < _w.Length; i++)
            {
                if (!_w[i].Used || !_w[i].Mob || o.Now - _w[i].Seen > StaleSeconds) continue;
                float d2 = Dist2(_w[i], o);
                bool sameFrame = _w[i].Frame == o.Frame;
                if (sameFrame && d2 > SameSpot * SameSpot) continue;   // already updated this frame by another mob: do not steal it
                if (d2 < bestD) { bestD = d2; best = i; }
            }
            return best;
        }
        static float Dist2(in Walker w, in Observation o) { float dx = o.X - w.X, dy = o.Y - w.Y; return dx * dx + dy * dy; }

        int Create(in Observation o)
        {
            int slot = -1; float oldest = float.MaxValue;
            for (int i = 0; i < _w.Length; i++)
            {
                if (!_w[i].Used || o.Now - _w[i].Seen > StaleSeconds) { slot = i; break; }
                if (_w[i].Seen < oldest) { oldest = _w[i].Seen; slot = i; }
            }
            _w[slot] = default;
            Anchor(ref _w[slot], o);
            _w[slot].Used = true;
            return slot;
        }

        static void Anchor(ref Walker w, in Observation o)
        {
            w.Id = o.Id; w.Mob = o.Mob; w.X = o.X; w.Y = o.Y; w.Seen = o.Now; w.Frame = o.Frame;
            w.Dist = 0; w.StepDist = 0; w.HavePhase = false; w.Idle = 0; w.WakeAcc = 0; w.IdleAcc = 0;
        }

        void Emit(FootEventKind kind, in Observation o, in Walker w, float x, float y, byte foot, PrintStyle style, float wetness)
        {
            if (EventCount >= Events.Length) { Dropped++; return; }
            Events[EventCount++] = new FootEvent
            {
                Kind = kind, Id = o.Id, Local = o.Local, Mob = o.Mob, X = x, Y = y,
                DirX = w.HaveDir ? w.DirX : 0f, DirY = w.HaveDir ? w.DirY : 1f,
                Foot = foot, Surface = o.Surface, Style = style, Wetness = wetness, Size = o.Size
            };
        }

        /// <summary>Feeds one delivered observation. Returns the number of events appended.</summary>
        public int Observe(in Observation o)
        {
            int start = EventCount;
            if (!(o.Now >= 0f) || float.IsNaN(o.X) || float.IsNaN(o.Y)) return 0;
            float size = o.Size < 0.3f ? 0.3f : o.Size > 3f ? 3f : o.Size;
            int wi = Find(o);
            if (wi < 0) { Create(o); return 0; }
            ref Walker w = ref _w[wi];
            float dx = o.X - w.X, dy = o.Y - w.Y;
            float d = (float)Math.Sqrt(dx * dx + dy * dy);
            if (w.Frame == o.Frame && d < SameSpot) { w.Id = o.Id; return 0; }   // second call in one frame
            float dt = o.Now - w.Seen;
            if (!o.Alive || d > TeleportUnits || dt > StaleSeconds)
            {
                bool keepDir = o.Alive; Anchor(ref w, o); if (!keepDir) w.HaveDir = false; return 0;   // a gap or a respawn is never bridged
            }
            w.Id = o.Id;
            bool moving = d > MoveEpsilon;
            if (moving)
            {
                float nx = dx / d, ny = dy / d;
                if (w.HaveDir) { nx = nx * 0.6f + w.DirX * 0.4f; ny = ny * 0.6f + w.DirY * 0.4f; float l = (float)Math.Sqrt(nx * nx + ny * ny); if (l > 1e-4f) { nx /= l; ny /= l; } }
                w.DirX = nx; w.DirY = ny; w.HaveDir = true;
                if (w.Idle > 0.5f) w.Dist = StrideTiles * TileUnits * size * 0.5f;   // the first print after a stop comes quickly
                w.Idle = 0;
            }
            else if (dt > 0f) w.Idle += dt;

            bool wet = SurfaceFxTable.IsWet(o.Surface);
            var profile = SurfaceFxTable.For(o.Surface);
            if (wet) w.Wet = WetPrints;

            // sounds: from the walk phase when there is one (two per cycle, backward walking too), from distance otherwise
            if (o.PhaseValid)
            {
                if (w.HavePhase)
                {
                    int n = Footfalls.Crossings(w.Phase, o.Phase, o.WalkFrames);
                    for (int k = 1; k <= n; k++)
                    {
                        float f = (float)k / n;
                        Emit(FootEventKind.Step, o, w, w.X + dx * f, w.Y + dy * f, (byte)(w.Foot & 1), PrintStyle.None, 1f);
                    }
                }
                else if (moving) Emit(FootEventKind.Step, o, w, o.X, o.Y, (byte)(w.Foot & 1), PrintStyle.None, 1f);   // the first contact pose of a walk
                w.Phase = o.Phase; w.HavePhase = true; w.StepDist = 0;
            }
            else
            {
                w.HavePhase = false;
                if (moving)
                {
                    float stepStride = StepStrideTiles * TileUnits * size;
                    w.StepDist += d;
                    int guard = 0;
                    while (w.StepDist >= stepStride && guard++ < 3)
                    {
                        w.StepDist -= stepStride;
                        float f = 1f - w.StepDist / d; if (f < 0f) f = 0f; if (f > 1f) f = 1f;
                        Emit(FootEventKind.Step, o, w, w.X + dx * f, w.Y + dy * f, (byte)(w.Foot & 1), PrintStyle.None, 1f);
                    }
                }
            }

            // prints and footfall ripples: distance driven so the spacing is even whatever the frame rate
            if (moving)
            {
                float stride = StrideTiles * TileUnits * size;
                w.Dist += d;
                int guard = 0;
                while (w.Dist >= stride && guard++ < 4)
                {
                    w.Dist -= stride;
                    float f = 1f - w.Dist / d; if (f < 0f) f = 0f; if (f > 1f) f = 1f;
                    PrintStyle style = profile.Print; float wetness = 1f;
                    if (!wet && w.Wet > 0) { style = PrintStyle.Wet; wetness = (float)w.Wet / WetPrints; w.Wet--; }
                    if (style != PrintStyle.None || wet)
                    {
                        float sign = (w.Foot & 1) == 0 ? -1f : 1f;
                        float side = SideTiles * TileUnits * size * sign;
                        float px = w.X + dx * f + (-w.DirY) * side, py = w.Y + dy * f + w.DirX * side;
                        Emit(FootEventKind.Print, o, w, px, py, (byte)(w.Foot & 1), style, wetness);
                    }
                    w.Foot ^= 1;
                }
            }

            // wake / idle rings
            if (wet)
            {
                bool bog = o.Surface == FxSurface.Bog;
                if (moving)
                {
                    w.IdleAcc = 0; w.WakeAcc += dt;
                    if (w.WakeAcc >= (bog ? WaterFxModel.BogWakeInterval : WaterFxModel.ShallowWakeInterval))
                    { w.WakeAcc = 0; Emit(FootEventKind.Wake, o, w, o.X, o.Y, 0, PrintStyle.None, 1f); }
                }
                else if (w.Idle >= WaterFxModel.IdleAfterSeconds)
                {
                    w.WakeAcc = 0; w.IdleAcc += dt;
                    if (w.IdleAcc >= (bog ? WaterFxModel.BogIdleInterval : WaterFxModel.ShallowIdleInterval))
                    { w.IdleAcc = 0; Emit(FootEventKind.Idle, o, w, o.X, o.Y, 0, PrintStyle.None, 1f); }
                }
            }
            else { w.WakeAcc = 0; w.IdleAcc = 0; }

            w.X = o.X; w.Y = o.Y; w.Seen = o.Now; w.Frame = o.Frame;
            return EventCount - start;
        }
    }
}
