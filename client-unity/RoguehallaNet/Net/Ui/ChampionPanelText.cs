using System.Globalization;
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
        public const string Placeholder = "\u2014";
        static readonly string[] WeaponNames = { "Sword", "Bow", "Wand", "Shield", "Axe", "Fists" };
        static readonly string[] PassiveNames = { "Dragonslayer", "Sentence", "Rat King", "Ice wall", "Radiant" };

        /// <summary>Legacy shows the panel only while the local player is alive and the room is training or active.</summary>
        public static bool Visible(bool alive, bool roomActive, bool training) => alive && (roomActive || training);

        /// <summary>The two rows. A null summary or empty panel gives the empty state: legacy names, value "—", nothing else.</summary>
        public static ChampionRows Rows(WireBuildSummary summary, FactionId faction, WeaponId weapon)
        {
            var q = new long?[Hud.PanelCodeCount];
            if (summary?.Panel != null)
                foreach (var v in summary.Panel)
                    if (v.Code < Hud.PanelCodeCount) q[v.Code] = v.Value;

            string weaponName = (int)weapon < WeaponNames.Length ? WeaponNames[(int)weapon] : "Weapon";
            string passiveName = (int)faction < PassiveNames.Length ? PassiveNames[(int)faction] : "";
            var auto = AutoRow(q, weaponName + " hit");
            string value = Placeholder, scaling = "", roam = "";
            switch (faction)
            {
                case FactionId.Fire:
                    if (q[4] != null) value = Fmt(q[4].Value) + " magic/s";
                    if (q[5] != null && q[6] != null && q[7] != null)
                        scaling = "SO adds " + Fmt(q[5].Value) + ", Offense " + Fmt(q[6].Value) + " magic DPS/point \u00b7 DoT \u00d7" + Fmt(q[7].Value);
                    if (q[9] is long armed && armed != 0) roam = "Fire Roam is armed";
                    else if (q[8] != null)
                        roam = "Fire Roam is " + Fmt(System.Math.Min(10000000, System.Math.Max(0, q[8].Value))) + "/1000 charged";
                    break;
                case FactionId.Sentenced:
                    if (q[10] != null) value = Pct(q[10].Value) + "% target HP / hit";
                    if (q[11] != null) scaling = "+" + Pct(q[11].Value) + "%/kill stack \u00b7 attack speed";
                    break;
                case FactionId.Plague:
                    if (q[12] != null) value = Fmt(q[12].Value) + " magic/s";
                    if (q[13] != null)
                    {
                        long stacks = (q[13].Value + 5000) / 10000;
                        if (stacks <= 0) scaling = "Walk over a body: raise zombie";
                        else if (q[14] == null || q[15] == null) scaling = "Zombie fallen \u00b7 walk over a body to revive";
                        else scaling = "Zombie " + Fmt(q[14].Value) + "/" + Fmt(q[15].Value) + " HP \u00b7 "
                            + stacks.ToString(CultureInfo.InvariantCulture) + (stacks == 1 ? " body" : " bodies");
                    }
                    break;
                case FactionId.Frost:
                    value = Join(q[16] != null ? Pct(q[16].Value) + "% AS" : null, q[17] != null ? Pct(q[17].Value) + "% MS slow" : null);
                    if (q[18] != null && q[19] != null)
                        scaling = "Frozen Justice: +" + Fmt(q[18].Value) + " Defense/SD \u00b7 " + (q[19].Value != 0 ? "ACTIVE" : "elite fights");
                    break;
                case FactionId.Holy:
                    if (q[20] != null) value = Pct(q[20].Value) + "% life steal";
                    scaling = Join(q[21] != null ? Fmt(q[21].Value) + " camps" : null, q[22] != null ? "+" + Pct(q[22].Value) + "% earned leech" : null, "");
                    break;
            }
            if (value.Length == 0) value = Placeholder;
            return new ChampionRows(auto, new ChampionRow(passiveName, value, scaling, ""), roam);
        }

        static ChampionRow AutoRow(long?[] q, string name)
        {
            if (q[0] == null || q[1] == null || q[2] == null) return new ChampionRow(name, Placeholder, "", "");
            string value = Fmt(q[0].Value + q[1].Value + q[2].Value) + " / hit";
            if (q[3] != null) value += " \u00b7 " + Fmt(q[3].Value) + "/s";
            string detail = "Raw damage per hit before target mitigation: " + Fmt(q[0].Value) + " physical, " + Fmt(q[1].Value)
                + " magic, " + Fmt(q[2].Value) + " true.";
            return new ChampionRow(name, value, "", detail);
        }

        static string Join(string a, string b, string empty = null)
        {
            if (a == null && b == null) return empty ?? Placeholder;
            if (a == null) return b;
            return b == null ? a : a + " \u00b7 " + b;
        }

        /// <summary>Legacy fmt: two decimals, half up, trailing zeros dropped; q is in Hud.Quantum units.</summary>
        static string Fmt(long q) => Scaled(FloorDiv(q + 50, 100), 100);
        /// <summary>A fraction shown as a percent: q / 100 exactly.</summary>
        static string Pct(long q) => Scaled(q, 100);

        static long FloorDiv(long a, long b) { long d = a / b; return (a % b != 0 && (a < 0) != (b < 0)) ? d - 1 : d; }

        static string Scaled(long raw, long divisor)
        {
            bool neg = raw < 0;
            long a = neg ? -raw : raw;
            long whole = a / divisor, frac = a % divisor;
            string f = frac == 0 ? "" : frac.ToString(CultureInfo.InvariantCulture).PadLeft(2, '0').TrimEnd('0');
            return (neg ? "-" : "") + whole.ToString(CultureInfo.InvariantCulture) + (f.Length > 0 ? "." + f : "");
        }
    }
}
