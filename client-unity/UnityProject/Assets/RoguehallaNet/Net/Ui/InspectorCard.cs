using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// The legacy opponent inspector card (packages/client/src/ui/opponentInspector.ts) as a pure function of the hovered actor's
    /// delivered row (docs/backlog/packets/P-UNITY-INSPECTOR-1.md). Only facts the row carries; a legacy line whose fact is not on
    /// the wire is left out. No allocation beyond growing the caller's list.
    /// </summary>
    public static class InspectorCard
    {
        /// <summary>
        /// Clears <paramref name="lines"/> and, when the card shows for <paramref name="row"/>, fills it in legacy order: the kit line,
        /// the health line, then one entry per delivered invested-stat chip. Returns whether the card shows (false leaves the list empty).
        /// </summary>
        public static bool Build(in InterpActor row, uint selfId, List<string> lines)
        {
            lines.Clear();
            if (row.Kind != ActorKind.Player || row.Id == selfId || row.Status != ActorStatus.Alive) return false;
            if ((row.Effects & (HiddenBit | UntargetableBit)) != 0) return false;
            if (row.Faction == null) return false;
            int f = (int)row.Faction.Value;
            if (f < 0 || f >= FactionNames.Length) return false;
            int w = row.Weapon.HasValue ? (int)row.Weapon.Value : 5;
            string weapon = w >= 0 && w < WorldIndicatorRules.WeaponNames.Length ? WorldIndicatorRules.WeaponNames[w] : "Fists";
            lines.Add(FactionNames[f] + " · " + weapon + " · " + Roles[f]);
            lines.Add("Health " + row.HpPct.ToString(System.Globalization.CultureInfo.InvariantCulture) + "%");
            AddChip(row.TopStat1, lines);
            AddChip(row.TopStat2, lines);
            return true;
        }

        const ushort UntargetableBit = 128, HiddenBit = 256;

        // Must agree with Unity's ShowcasePalette.FactionNames and HubGuideView.Roles (FactionId order).
        static readonly string[] FactionNames = { "Fire", "Sentenced", "Plague", "Frost", "Holy" };
        static readonly string[] Roles = { "Glass-cannon duelist", "Patient executioner", "Attrition swarm", "Control bruiser", "Sustain juggernaut" };
        // combatReadability.ts:44-54, indexed by StatKey (1..9).
        static readonly string[] StatLabels = { null, "Offense", "Soul Offence", "Damage", "Health", "Attack Speed", "Defense", "Soul Defense", "Move Speed", "Leech" };

        static void AddChip(StatKey? key, List<string> lines)
        {
            if (!key.HasValue) return;
            int k = (int)key.Value;
            if (k > 0 && k < StatLabels.Length) lines.Add(StatLabels[k]);
        }
    }
}
