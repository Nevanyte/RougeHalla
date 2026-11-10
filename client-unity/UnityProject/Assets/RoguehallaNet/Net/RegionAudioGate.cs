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

    /// <summary>
    /// Per-file gain trims (dB) that bring the streamed tracks to a common loudness without re-encoding. <see cref="MeasuredDb"/> is the
    /// output RMS of each file played alone at volume 1 through the real Web player (browser audio probe, 2026-11-10); the trim moves it to
    /// <see cref="MusicTargetDb"/> (music) or <see cref="AmbienceTargetDb"/> (ambience: 10 dB under the music).
    /// </summary>
    public static class AudioTrims
    {
        public const float MusicTargetDb = -21f, AmbienceTargetDb = -31f;
        public static readonly string[] Ids = { "music_fire", "music_sentenced", "music_plague", "music_frost", "music_holy", "music_coliseum", "amb_fire", "amb_sentenced", "amb_plague", "amb_frost", "amb_holy" };
        static readonly float[] Measured = { -20.09f, -18.02f, -21.50f, -18.64f, -19.35f, -22.56f, -21.01f, -29.59f, -21.27f, -25.74f, -17.25f };
        public static float MeasuredDb(string id) { int i = System.Array.IndexOf(Ids, id); return i >= 0 ? Measured[i] : float.NaN; }
        public static float TrimDb(string id)
        {
            int i = System.Array.IndexOf(Ids, id); if (i < 0) return 0f;
            return (id.StartsWith("amb_") ? AmbienceTargetDb : MusicTargetDb) - Measured[i];
        }
        public static float Gain(string id) { return (float)Math.Pow(10.0, TrimDb(id) / 20.0); }
    }

    /// <summary>
    /// Loop points (seconds into the decoded file) that skip a track's own quiet fade-in and fade-out, so the loop has no hole at the seam.
    /// Measured by the browser audio probe from the decoded files (AudioProbeLib.suggestLoop: the first and last stretch that stays within
    /// 12 dB of the track's median level for 3 s). EndSeconds 0 means the whole file. The player also fades 25 ms at both ends of every loop.
    /// </summary>
    public static class AudioLoops
    {
        public static void For(string id, out float startSeconds, out float endSeconds)
        {
            switch (id)
            {
                case "music_frost": startSeconds = 0.5f; endSeconds = 77.9f; return;
                case "music_holy": startSeconds = 3.0f; endSeconds = 95.4f; return;
                case "music_coliseum": startSeconds = 0.5f; endSeconds = 92.9f; return;
                default: startSeconds = 0f; endSeconds = 0f; return;
            }
        }
    }
}
