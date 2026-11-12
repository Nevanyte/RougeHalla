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
        public static TerrainChip[] For(byte terrain, byte terrainMode, FactionId? faction)
        {
            if (terrainMode == MapBlob.GroundTerrainOff || HomeNote(terrain, terrainMode, faction) != null) return None;
            switch (terrain)
            {
                case 4:
                    return new[] { new TerrainChip { Id = "burning", Glyph = "\u25B2", Label = "BURNING",
                        Explanation = "Embers burn " + Pct(BurnShare) + " of your max hp every second" } };
                case 5:
                    return new[] { new TerrainChip { Id = "slowed", Glyph = "\u25BC", Label = "SLOWED",
                        Explanation = "Bog slows you to " + Pct(BogSpeed) + " speed" } };
                case 6:
                    return new[] { new TerrainChip { Id = "ice", Glyph = "\u25C7", Label = "ICE",
                        Explanation = "Slippery: you slide when you start, turn or stop" } };
                default: return None;
            }
        }

        /// <summary>The "Home ground: ..." line, or null. Only under map mode (the live All mode exempts nobody).</summary>
        public static string HomeNote(byte terrain, byte terrainMode, FactionId? faction)
        {
            if (terrainMode != MapBlob.GroundTerrainMap || faction == null) return null;
            if (terrain == 4 && faction == FactionId.Fire) return "Home ground: embers can't burn you";
            if (terrain == 5 && faction == FactionId.Plague) return "Home ground: bog can't slow you";
            if (terrain == 6 && faction == FactionId.Frost) return "Home ground: full grip on ice";
            return null;
        }

        static string Pct(double share)
        {
            return (Math.Round(share * 1000) / 10).ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + "%";
        }
    }
}
