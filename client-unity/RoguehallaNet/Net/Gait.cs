using System;

namespace Roguehalla.Net
{
    /// <summary>How the legs should move relative to where the body faces. Presentation only; no game rule.</summary>
    public enum GaitMode : byte { Forward = 0, Strafe = 1, Backward = 2 }

    /// <summary>Per-actor gait state: smoothed velocity (server units per second), continuous walk phase (frames) and the latched mode.</summary>
    public struct GaitState
    {
        public float VelX, VelY, Phase, IdleFor;
        public GaitMode Mode;
        public bool Walking;
        /// <summary>True once <see cref="Gait.Advance"/> has seen a first sample; the first one only anchors time.</summary>
        public bool Primed;
        public void Reset() { this = default; }
    }

    /// <summary>
    /// Pure walk-animation decisions (no engine types): classify the angle between movement and facing as forward, strafe or
    /// backward, and advance a continuous walk phase that runs backwards for backward walking. Thresholds are the 8-way sprite
    /// sector edges (67.5 and 112.5 degrees) with hysteresis so a cursor circling the boundary does not flicker.
    /// </summary>
    public static class Gait
    {
        /// <summary>cos(67.5 degrees): forward below this angle.</summary>
        public const float ForwardCos = 0.38268343f;
        /// <summary>Hysteresis half-width on the cosine.</summary>
        public const float Hysteresis = 0.10f;
        /// <summary>Below this smoothed speed the previous mode is kept (u/s).</summary>
        public const float MinDirectionSpeed = 25f;
        /// <summary>Raw speed above which the feet move (u/s).</summary>
        public const float WalkingSpeed = 10f;
        /// <summary>A step faster than this is a teleport or respawn, not a walk (u/s); matches the snapshot teleport rule per tick.</summary>
        public const float TeleportSpeed = 600f;
        public const float SmoothingSeconds = 0.08f;
        public const float NominalSpeed = 170f;

        /// <summary>
        /// Mode for velocity (vx, vy) and facing angle (radians, same axes as the velocity). Below <see cref="MinDirectionSpeed"/>
        /// or on non-finite input the previous mode is returned.
        /// </summary>
        public static GaitMode Classify(float vx, float vy, float facing, GaitMode previous)
        {
            if (!IsFinite(vx) || !IsFinite(vy) || !IsFinite(facing)) return previous;
            float speed = MathF.Sqrt(vx * vx + vy * vy);
            if (speed < MinDirectionSpeed) return previous;
            float c = (vx * MathF.Cos(facing) + vy * MathF.Sin(facing)) / speed;
            // Backward is latched with hysteresis; forward/strafe split has its own band.
            float backEnter = -ForwardCos - Hysteresis, backLeave = -ForwardCos + Hysteresis;
            float fwdEnter = ForwardCos + Hysteresis, fwdLeave = ForwardCos - Hysteresis;
            switch (previous)
            {
                case GaitMode.Backward:
                    if (c >= backLeave) return c >= fwdEnter ? GaitMode.Forward : GaitMode.Strafe;
                    return GaitMode.Backward;
                case GaitMode.Forward:
                    if (c >= fwdLeave) return GaitMode.Forward;
                    return c <= backEnter ? GaitMode.Backward : GaitMode.Strafe;
                default:
                    if (c <= backEnter) return GaitMode.Backward;
                    return c >= fwdEnter ? GaitMode.Forward : GaitMode.Strafe;
            }
        }

        /// <summary>
        /// Advances one presentation frame. (dx, dy) is the actor's displacement this frame in server units, <paramref name="dt"/> the
        /// frame time in seconds, <paramref name="clipFps"/> the walk clip's frame rate. A step with dt at or below zero, a non-finite
        /// input or a teleport changes nothing but re-anchors the state. Returns true while the feet should walk.
        /// <paramref name="holdSeconds"/> keeps a walk going through that long a gap in movement, for actors drawn at the
        /// 20 Hz snapshot rate (zero for the local, per-frame-smooth actor, so its feet stop on the frame the body stops).
        /// </summary>
        public static bool Advance(ref GaitState s, float dx, float dy, float dt, float facing, float clipFps, float holdSeconds = 0f)
        {
            if (!(dt > 1e-4f) || !IsFinite(dx) || !IsFinite(dy) || !IsFinite(facing)) return s.Walking;
            float rx = dx / dt, ry = dy / dt;
            float raw = MathF.Sqrt(rx * rx + ry * ry);
            if (raw > TeleportSpeed)
            {
                s.VelX = s.VelY = 0; s.Walking = false; s.Primed = true; return false;
            }
            bool walking = raw > WalkingSpeed;
            if (!walking && s.Walking && s.IdleFor + dt <= holdSeconds)
            {
                s.IdleFor += dt;
                s.Phase += dt * Math.Max(1f, clipFps) * (s.Mode == GaitMode.Backward ? -1f : 1f);
                return true;
            }
            float k = 1f - MathF.Exp(-dt / SmoothingSeconds);
            if (!s.Primed) { s.VelX = rx; s.VelY = ry; s.Primed = true; }
            else { s.VelX += (rx - s.VelX) * k; s.VelY += (ry - s.VelY) * k; }
            if (!walking) { s.Walking = false; s.Phase = 0f; s.IdleFor = 0f; return false; }
            s.IdleFor = 0f;
            s.Mode = Classify(s.VelX, s.VelY, facing, s.Mode);
            if (!s.Walking) s.Phase = 0f; // start on the contact pose
            s.Walking = true;
            float rate = Math.Clamp(raw / NominalSpeed, 0.6f, 1.2f);
            s.Phase += dt * Math.Max(1f, clipFps) * rate * (s.Mode == GaitMode.Backward ? -1f : 1f);
            if (s.Phase > 1e6f || s.Phase < -1e6f) s.Phase = 0f;
            return true;
        }

        /// <summary>Frame index in a clip of <paramref name="count"/> frames for a (possibly negative) phase.</summary>
        public static int FrameIndex(float phase, int count)
        {
            if (count <= 1) return 0;
            float m = phase - MathF.Floor(phase / count) * count;
            int i = (int)MathF.Floor(m);
            return i >= count ? count - 1 : i < 0 ? 0 : i;
        }

        static bool IsFinite(float v) { return !float.IsNaN(v) && !float.IsInfinity(v); }
    }
}
