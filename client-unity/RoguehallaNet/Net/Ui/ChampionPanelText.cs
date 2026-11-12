using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>One row of the bottom-left champion panel: legacy's name, value line, scaling line and (auto row only) the
    /// per-hit parts sentence that legacy puts in the tooltip. A string that is not shown is empty.</summary>
    public readonly struct ChampionRow
    {
        public readonly string Name, Value, Scaling, Detail;
        public ChampionRow(string name, string value, string scaling, string detail) { Name = name; Value = value; Scaling = scaling; Detail = detail; }
    }

    /// <summary>The auto and faction passive rows, and the Fire roam sentence ("" for other factions or when not delivered).</summary>
    public readonly struct ChampionRows
    {
        public readonly ChampionRow Auto, Passive;
        public readonly string Roam;
        public ChampionRows(ChampionRow auto, ChampionRow passive, string roam) { Auto = auto; Passive = passive; Roam = roam; }
    }

    /// <summary>
    /// Pure text for the champion panel's auto and passive rows from the owner's panel values (P-UNITY-HUD-BUILD-2).
    /// Legacy: ui/championCombatModel.ts :91-216, ui/championCombatHud.ts :72. Stub: the implementer fills the bodies.
    /// </summary>
    public static class ChampionPanelText
    {
        /// <summary>Legacy shows the panel only while the local player is alive and the room is training or active.</summary>
        public static bool Visible(bool alive, bool roomActive, bool training) => false;

        /// <summary>The two rows. A null summary or empty panel gives the empty state: legacy names, value "—", nothing else.</summary>
        public static ChampionRows Rows(WireBuildSummary summary, FactionId faction, WeaponId weapon) => default;
    }
}
