using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>One ground chip: a stable id, a glyph and a word (colour is never the only cue) and a one-line explanation.</summary>
    public struct TerrainChip
    {
        public string Id, Glyph, Label, Explanation;
    }

    /// <summary>
    /// The chips for the ground under the local player (legacy render/zoneArt/terrainFeedback.ts chipsOf/homeNote, ui/terrainChips.ts).
    /// Pure: the caller reads the terrain code from the delivered map plane and the faction and map terrain mode from state it holds.
    /// </summary>
    public static class TerrainChips
    {
        /// <summary>Mirrors crates/rh-sim/src/constants.rs TERRAIN_BURN (share of max hp per second); a test reads the Rust value.</summary>
        public const double BurnShare = 0.02;
        /// <summary>Mirrors crates/rh-sim/src/constants.rs TERRAIN_BOG (speed multiplier); a test reads the Rust value.</summary>
        public const double BogSpeed = 0.7;

        static readonly TerrainChip[] None = new TerrainChip[0];

        /// <summary>The chips (usually zero or one) for a terrain code, the map's terrain mode and the player's faction (null = none).</summary>
        public static TerrainChip[] For(byte terrain, byte terrainMode, FactionId? faction) { return None; }

        /// <summary>The "Home ground: ..." line, or null.</summary>
        public static string HomeNote(byte terrain, byte terrainMode, FactionId? faction) { return null; }
    }
}
