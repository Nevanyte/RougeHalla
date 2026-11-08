namespace Roguehalla.Net.Ui
{
    /// <summary>Hub-only destinations. These are presentation links, not gameplay commands.</summary>
    public enum HubDestination : byte
    {
        Champions,
        Weapons,
        Counters,
        Shop,
        Wardrobe,
        Titles,
        Achievements,
        Leaderboard
    }

    /// <summary>Small immutable point in the atrium's normalized, cosmetic floor space.</summary>
    public readonly struct HubPoint
    {
        public readonly float X;
        public readonly float Y;

        public HubPoint(float x, float y) { X = x; Y = y; }
    }

    /// <summary>
    /// Local visual avatar motion. Coordinates remain within 0..1; this model has no world, collision,
    /// session or gameplay authority. Its values are safe to discard at any time.
    /// </summary>
    public struct HubAtriumMotion
    {
        const float MaxStepSeconds = .1f;

        public float X { get; private set; }
        public float Y { get; private set; }

        public HubAtriumMotion(float x, float y)
        {
            X = Clamp01(IsFinite(x) ? x : .5f);
            Y = Clamp01(IsFinite(y) ? y : .5f);
        }

        /// <summary>Moves from normalized keyboard input; diagonal input is capped to unit speed.</summary>
        public bool Move(float horizontal, float vertical, float deltaSeconds, float speed)
        {
            if (!IsFinite(horizontal) || !IsFinite(vertical) || !ValidStep(deltaSeconds, speed)) return false;
            float magnitudeSquared = horizontal * horizontal + vertical * vertical;
            if (magnitudeSquared <= .000001f) return false;
            if (magnitudeSquared > 1f)
            {
                float inverseMagnitude = 1f / Sqrt(magnitudeSquared);
                horizontal *= inverseMagnitude;
                vertical *= inverseMagnitude;
            }
            return SetMoved(X + horizontal * speed * Step(deltaSeconds), Y + vertical * speed * Step(deltaSeconds));
        }

        /// <summary>Advances toward one clicked station, returning true on arrival.</summary>
        public bool MoveToward(HubPoint destination, float deltaSeconds, float speed)
        {
            if (!IsFinite(destination.X) || !IsFinite(destination.Y)) return false;
            float targetX = Clamp01(destination.X), targetY = Clamp01(destination.Y);
            float dx = targetX - X, dy = targetY - Y;
            float distanceSquared = dx * dx + dy * dy;
            if (distanceSquared <= .000001f) { X = targetX; Y = targetY; return true; }
            if (!ValidStep(deltaSeconds, speed)) return false;
            float distance = Sqrt(distanceSquared);
            float step = speed * Step(deltaSeconds);
            if (distance <= step) { X = targetX; Y = targetY; return true; }
            SetMoved(X + dx / distance * step, Y + dy / distance * step);
            return false;
        }

        /// <summary>Returns the nearest station inside radius, or -1. Ties preserve caller order.</summary>
        public int FindNearby(HubPoint[] stations, float radius)
        {
            if (stations == null || stations.Length == 0 || !IsFinite(radius) || radius < 0f) return -1;
            float maxDistanceSquared = radius * radius;
            float bestDistanceSquared = maxDistanceSquared;
            int best = -1;
            for (int i = 0; i < stations.Length; i++)
            {
                float dx = stations[i].X - X, dy = stations[i].Y - Y;
                float distanceSquared = dx * dx + dy * dy;
                if (IsFinite(distanceSquared) && distanceSquared <= bestDistanceSquared)
                {
                    if (best < 0 || distanceSquared < bestDistanceSquared)
                    { bestDistanceSquared = distanceSquared; best = i; }
                }
            }
            return best;
        }

        bool SetMoved(float x, float y)
        {
            x = Clamp01(x); y = Clamp01(y);
            if (x == X && y == Y) return false;
            X = x; Y = y;
            return true;
        }

        static bool ValidStep(float deltaSeconds, float speed)
        { return IsFinite(deltaSeconds) && IsFinite(speed) && deltaSeconds > 0f && speed > 0f; }
        static float Step(float deltaSeconds) { return deltaSeconds > MaxStepSeconds ? MaxStepSeconds : deltaSeconds; }
        static bool IsFinite(float value) { return !float.IsNaN(value) && !float.IsInfinity(value); }
        static float Clamp01(float value) { return value < 0f ? 0f : value > 1f ? 1f : value; }
        static float Sqrt(float value) { return (float)System.Math.Sqrt(value); }
    }
}
