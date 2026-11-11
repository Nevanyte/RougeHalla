using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>Why an actor stopped being delivered, as far as the client can tell from what it was told.</summary>
    public enum DepartureCause : byte
    {
        /// <summary>It is alive and the match goes on: it walked out of sight (or the server stopped sending it). Fades out.</summary>
        LeftSight = 0,
        /// <summary>The last delivered state was dead or missing in action, or a Death event named it. Keeps the death presentation.</summary>
        Died = 1,
        /// <summary>The match is not running (lobby, planning, ended). Nothing was seen to leave; clears at once.</summary>
        LeftMatch = 2,
        /// <summary>The timeline was cut (welcome, resume, clock epoch, map change): the old view is void. Clears at once.</summary>
        Reset = 3,
    }

    /// <summary>
    /// The graceful-exit rules, free of any engine. The wire says only that an actor is no longer in the observation: it does not
    /// say whether it walked behind a wall, died, or left the match. So the cause is read from what the client was told earlier: the
    /// actor's last delivered status, a Death event naming it, the match phase and any timeline cut. Only <see cref="DepartureCause.LeftSight"/>
    /// fades; the others keep their own presentations. A fading actor stays exactly where it was last drawn: no extrapolation, no
    /// movement, so the fade cannot show where it went.
    /// </summary>
    public static class VisionFade
    {
        /// <summary>A departing actor fades out over this long (seconds); an arriving one fades in over <see cref="EnterSeconds"/>.</summary>
        public const float ExitSeconds = 0.26f, EnterSeconds = 0.12f;

        public static DepartureCause Classify(ActorStatus lastStatus, bool deathEventSeen, bool matchActive, bool timelineCut)
        {
            if (timelineCut) return DepartureCause.Reset;
            if (!matchActive) return DepartureCause.LeftMatch;
            if (deathEventSeen || lastStatus == ActorStatus.Dead || lastStatus == ActorStatus.Mia) return DepartureCause.Died;
            // Lobby is not part of a running raid either.
            if (lastStatus == ActorStatus.Lobby) return DepartureCause.LeftMatch;
            return DepartureCause.LeftSight;
        }

        /// <summary>Opacity of a departing actor <paramref name="elapsed"/> seconds after its last delivery, starting from <paramref name="from"/>.</summary>
        public static float ExitAlpha(float elapsed, float from = 1f)
        {
            float t = elapsed / ExitSeconds;
            if (!(t > 0f)) return from;
            if (t >= 1f) return 0f;
            return from * (1f - t * t * (3f - 2f * t));
        }

        /// <summary>Opacity of an arriving actor <paramref name="elapsed"/> seconds after it first appeared, starting from <paramref name="from"/>.</summary>
        public static float EnterAlpha(float elapsed, float from = 0f)
        {
            float t = elapsed / EnterSeconds;
            if (!(t > 0f)) return from;
            if (t >= 1f) return 1f;
            float k = t * t * (3f - 2f * t);
            return from + (1f - from) * k;
        }

        /// <summary>
        /// Opacity an actor first shown with this status starts its entrance from: 0 for a living one, 1 for one that is already dead
        /// or missing in action (a body is not an arrival, it must not fade in).
        /// </summary>
        public static float EnterStartAlpha(ActorStatus status)
        {
            // STUB: today every arrival starts at 0. The implementer replaces this.
            return 0f;
        }

        /// <summary>The elapsed time at which an exit that began at opacity <paramref name="alpha"/> would be at that opacity: lets a re-entry continue smoothly.</summary>
        public static float EnterElapsedFor(float alpha)
        {
            float a = alpha < 0f ? 0f : alpha > 1f ? 1f : alpha;
            // Invert the smoothstep by bisection (called once per re-entry).
            float lo = 0f, hi = 1f;
            for (int i = 0; i < 16; i++) { float mid = (lo + hi) * 0.5f; float k = mid * mid * (3f - 2f * mid); if (k < a) lo = mid; else hi = mid; }
            return (lo + hi) * 0.5f * EnterSeconds;
        }
    }

    /// <summary>Actors a Death event named in the last few seconds. Fixed storage; no allocation.</summary>
    public sealed class RecentDeaths
    {
        public const float MemorySeconds = 3f;
        readonly uint[] _ids;
        readonly float[] _at;
        int _next;

        public RecentDeaths(int capacity = 32) { _ids = new uint[capacity]; _at = new float[capacity]; Clear(); }

        public void Clear() { for (int i = 0; i < _ids.Length; i++) { _ids[i] = 0; _at[i] = float.NegativeInfinity; } _next = 0; }

        public void Note(uint id, float nowSeconds)
        {
            if (id == 0) return;
            for (int i = 0; i < _ids.Length; i++) if (_ids[i] == id) { _at[i] = nowSeconds; return; }
            _ids[_next] = id; _at[_next] = nowSeconds; _next = (_next + 1) % _ids.Length;
        }

        public bool Contains(uint id, float nowSeconds)
        {
            if (id == 0) return false;
            for (int i = 0; i < _ids.Length; i++) if (_ids[i] == id && nowSeconds - _at[i] <= MemorySeconds) return true;
            return false;
        }
    }
}
