using System;

namespace Roguehalla.Net
{
    /// <summary>
    /// Decides which region's music and ambience may be requested (pure). Nothing is allowed until the match is running AND the local
    /// player's region has been known and unchanged for <see cref="SettleSeconds"/>, so a placeholder first fix can never fetch or play
    /// the wrong region's files. Once playing, a new region takes over as soon as the region map has debounced it. Returns 0 for "no region
    /// audio" (launch, planning, results, unknown region).
    /// </summary>
    public sealed class RegionAudioGate
    {
        public const float SettleSeconds = 0.6f;
        int _candidate, _active; float _since;
        public int Active { get { return _active; } }

        /// <param name="matchActive">The match phase is Active.</param>
        /// <param name="region">The local player's region id, 0 when unknown.</param>
        /// <param name="now">Unscaled seconds.</param>
        public int Update(bool matchActive, int region, float now)
        {
            if (!matchActive || region <= 0) { _candidate = 0; _active = 0; return 0; }
            if (region != _candidate) { _candidate = region; _since = now; }
            if (_active == 0) { if (now - _since >= SettleSeconds) _active = _candidate; }
            else _active = _candidate;
            return _active;
        }
    }

    /// <summary>Per-file gain trims (dB) that bring the streamed tracks to a common loudness; measured by the browser audio probe.</summary>
    public static class AudioTrims
    {
        public static float TrimDb(string id)
        {
            switch (id)
            {
                default: return 0f;
            }
        }
        public static float Gain(string id) { return (float)Math.Pow(10.0, TrimDb(id) / 20.0); }
    }
}
