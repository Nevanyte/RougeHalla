// Generated presentation-only metadata from crates/rh-sim/src/cards/catalog_data.rs.
// Source order is CardId::ALL; rules, formulas, readiness, and eligibility are deliberately excluded.
namespace Roguehalla.Client
{
    public static class CardDisplayCatalog
    {
        public const int Count = 80;
        public readonly struct Entry
        {
            public readonly string Id, Title, Description, Tags;
            public Entry(string id, string title, string description, string tags) { Id = id; Title = title; Description = description; Tags = tags; }
        }
        static readonly Entry[] Entries =
        {
            new Entry("Ad1", "Offense I", "+12 Offense", "Physical"), // 00
            new Entry("Ad2", "Offense II", "+21 Offense", "Physical"), // 01
            new Entry("Ad3", "Offense III", "+33 Offense", "Physical"), // 02
            new Entry("Ap1", "Soul Offence I", "+12 Soul Offence", "Magic, Dot"), // 03
            new Entry("Ap2", "Soul Offence II", "+21 Soul Offence", "Magic, Dot"), // 04
            new Entry("Ap3", "Soul Offence III", "+33 Soul Offence", "Magic, Dot"), // 05
            new Entry("Haste1", "Haste I", "+9% attack speed", ""), // 06
            new Entry("Haste2", "Haste II", "+16% attack speed", ""), // 07
            new Entry("Haste3", "Haste III", "+25% attack speed", ""), // 08
            new Entry("Vitality1", "Vitality I", "+9% max health", ""), // 09
            new Entry("Vitality2", "Vitality II", "+16% max health", ""), // 10
            new Entry("Vitality3", "Vitality III", "+25% max health", ""), // 11
            new Entry("Armor1", "Defense I", "+15 Defense", "Physical"), // 12
            new Entry("Armor2", "Defense II", "+26 Defense", "Physical"), // 13
            new Entry("Armor3", "Defense III", "+41 Defense", "Physical"), // 14
            new Entry("Mr1", "Soul Defense I", "+15 Soul Defense", "Magic"), // 15
            new Entry("Mr2", "Soul Defense II", "+26 Soul Defense", "Magic"), // 16
            new Entry("Mr3", "Soul Defense III", "+41 Soul Defense", "Magic"), // 17
            new Entry("Leech1", "Leech I", "+5% lifesteal", "Heal"), // 18
            new Entry("Leech2", "Leech II", "+9% lifesteal", "Heal"), // 19
            new Entry("Leech3", "Leech III", "+14% lifesteal", "Heal"), // 20
            new Entry("Fleet1", "Fleet I", "+6% move speed (off while shooting)", ""), // 21
            new Entry("Fleet2", "Fleet II", "+10% move speed (off while shooting)", ""), // 22
            new Entry("Fleet3", "Fleet III", "+15% move speed (off while shooting)", ""), // 23
            new Entry("Bloodthirst", "Bloodthirst", "While below 50% health, your lifesteal is doubled.", "Heal"), // 24
            new Entry("SecondSkin", "Second Skin", "Healing you receive also grants a barrier worth 30% of it (up to 25% of max health).", "Heal"), // 25
            new Entry("Juggernaut", "Juggernaut", "Gain 1 Defense and 1 Soul Defense per 4 Offense.", "Physical, Magic"), // 26
            new Entry("Spellsword", "Spellsword", "Your Offense also counts as SO at half value.", "Magic"), // 27
            new Entry("BigBrain", "Big Brain", "Gain SO equal to 2% of your max health.", "Magic"), // 28
            new Entry("ArcaneTempo", "Arcane Tempo", "Every 1% attack speed above base also grants 1 SO.", "Magic"), // 29
            new Entry("Momentum", "Momentum", "Your bonus move speed is added to your damage.", ""), // 30
            new Entry("StoneSkin", "Stone Skin", "Gain 2 Defense and 2 Soul Defense per 100 max health.", "Physical, Magic"), // 31
            new Entry("Hearty", "Hearty", "+18% max health.", ""), // 32
            new Entry("FesteringArcana", "Festering Arcana", "Your magic damage over time keeps ticking 4 more times after it ends, each tick 1/8 of your SO.", "Magic, Dot"), // 33
            new Entry("Rhythm", "Rhythm", "Every 3rd attack is a critical strike.", "Crit"), // 34
            new Entry("HeavierSentence", "Heavier Sentence", "Your marks deal +15% more for every 10% bonus max health you have.", "True_, Ramping"), // 35
            new Entry("SwiftJudgment", "Swift Judgment", "Every 2nd hit on a marked enemy counts as a weapon swap for your marks' tiers.", "Ramping"), // 36
            new Entry("HereComesTheBoom", "Here Comes the Boom", "Your attack speed is halved, but your hits deal 2.5x damage, Offense and SO alike. Your damage over time and returned damage deal 1.25x.", "Dot, Returned"), // 37
            new Entry("MachineGun", "Machine Gun", "Your attack speed is doubled, but each hit deals half damage. Your on-hit effects keep their full strength.", "OnHit"), // 38
            new Entry("GlassCannon", "Glass Cannon", "+35% damage, -25% max health.", ""), // 39
            new Entry("ThickSkull", "Thick Skull", "+30% max health, but your hits can never critically strike.", "Crit"), // 40
            new Entry("VampiricPact", "Vampiric Pact", "+15% lifesteal, but no other healing works on you (camp heals included).", "Heal"), // 41
            new Entry("ArcaneOverload", "Arcane Overload", "Your SO is multiplied by 1.5, but your Wish's cooldown is doubled.", "Magic, Wish"), // 42
            new Entry("Committed", "Committed", "Your second weapon slot is locked. The weapon you hold deals +20% damage and attacks 15% faster.", ""), // 43
            new Entry("SlowBurn", "Slow Burn", "Your damage over time keeps burning twice as long after a fight breaks off, at 30% less per second.", "Dot"), // 44
            new Entry("FistsOfFury", "Fists of Fury", "While unarmed: +40% attack speed (counts toward the cap), and your on-hit effects apply twice.", "OnHit"), // 45
            new Entry("Overkill", "Overkill", "Damage beyond a kill splashes onto the nearest enemy within 200 u.", "Area"), // 46
            new Entry("TankEngine", "Tank Engine", "Permanently gain 1 max health for every point of damage your blocks prevent (up to +250).", "Block"), // 47
            new Entry("PocketSand", "Pocket Sand", "Your blocks slow the attacker by 30% for 1 s.", "Block, Slow"), // 48
            new Entry("Gambler", "Gambler", "Each hit has a 15% chance to deal double damage and a 15% chance to deal half.", "Crit"), // 49
            new Entry("SlowStarter", "Slow Starter", "-30% damage for your first 3 s in a fight, then +35%.", ""), // 50
            new Entry("CoupDeGrace", "Coup de Grace", "+30% damage to targets below 30% health.", "Execute"), // 51
            new Entry("BigGameHunter", "Big Game Hunter", "+25% damage to elites and to players above 70% health.", ""), // 52
            new Entry("PackLeader", "Pack Leader", "+3% damage for every camp you helped clear this run (up to +24%).", ""), // 53
            new Entry("Adrenaline", "Adrenaline", "After losing 10% or more of your max health in one hit: +40% move and attack speed for 2 s.", ""), // 54
            new Entry("RaceToZero", "A Race to 0", "Damage you deal and take is multiplied by 1 / your health fraction (up to 2.5x).", ""), // 55
            new Entry("CruelWounds", "Cruel Wounds", "Your damage over time can critically strike (+20% critical strike chance).", "Crit, Dot"), // 56
            new Entry("ThirdTimesTheCharm", "Third Time's the Charm", "Every 3rd hit on the same target applies its on-hit effects twice.", "OnHit"), // 57
            new Entry("EyeForAnEye", "Eye for an Eye", "Damage you return to attackers applies your on-hit effects.", "OnHit, Returned"), // 58
            new Entry("BestOffense", "Best Offense", "Your blocks count as hits.", "Block"), // 59
            new Entry("SittingDucks", "Sitting Ducks", "Slowed enemies take 12% more damage from you.", "Slow"), // 60
            new Entry("TunnelVision", "Tunnel Vision", "+4% damage per hit on the same target, up to 10 stacks; switching targets resets it.", "Ramping"), // 61
            new Entry("FirstImpressions", "First Impressions", "Your first hit on a new target deals +40% damage.", ""), // 62
            new Entry("PlantYourFeet", "Plant Your Feet", "After standing still for 1 s, your next attack has +25% range and damage.", ""), // 63
            new Entry("WishfulThinking", "Wishful Thinking", "Each hit you land shortens your Wish's cooldown by 1 s (at most 30 s a minute).", "Wish"), // 64
            new Entry("Hemorrhage", "Hemorrhage", "Your physical hits make the target bleed for 10% of the hit over 2 s.", "OnHit, Dot, Physical"), // 65
            new Entry("IronWill", "Iron Will", "Slows on you are 40% weaker.", "Slow"), // 66
            new Entry("SpikedShell", "Spiked Shell", "Melee attackers take 15% of the damage they deal to you back as physical damage.", "Returned, Physical"), // 67
            new Entry("GatheringStorm", "Gathering Storm", "Your marks climb their tiers 50% faster.", "Ramping"), // 68
            new Entry("Wellspring", "Wellspring", "Healing you receive is 25% stronger (camp heals included).", "Heal"), // 69
            new Entry("Siphon", "Siphon", "Your damage over time heals you for 20% of the damage it deals.", "Dot, Heal"), // 70
            new Entry("Quickdraw", "Quickdraw", "Your melee windups are 50% shorter.", ""), // 71
            new Entry("BountyHunter", "Bounty Hunter", "+10% damage to players who hold more card power than you.", ""), // 72
            new Entry("SecondWind", "Second Wind", "Once per run, the first time a hit leaves you below 25% health: heal 20% of max health over 1.5 s.", "Heal"), // 73
            new Entry("Witness", "Witness", "+8% damage to a target that is fighting someone else.", ""), // 74
            new Entry("Pestilence", "Pestilence", "Your execute starts at 60% health instead of 50%; with no execute, +8% damage to targets below 60% health.", "Execute"), // 75
            new Entry("LastRites", "Last Rites", "+25% attack speed while below 30% health.", ""), // 76
            new Entry("GallowsPatience", "Gallows' Patience", "Your zone Wish lasts 2 s longer, and an enemy that leaves it is stunned for 2.25 s.", "Wish"), // 77
            new Entry("NoCommutation", "No Commutation", "When a marked enemy swaps weapons, your mark climbs two tiers instead of one.", "Ramping"), // 78
            new Entry("FinalVerdict", "Final Verdict", "When your mark blocks an enemy's execute, the blocked damage is dealt back to it as true damage.", "True_, Execute, Returned"), // 79
        };
        public static Entry Get(int index) => index >= 0 && index < Entries.Length ? Entries[index] : new Entry("unknown", "Unknown card", "No catalog entry is available.", "");
        public static string Label(byte index) => Get(index).Title;
        public static string Title(byte index) => Get(index).Title;
        public static Entry[] Snapshot() => (Entry[])Entries.Clone();
    }
}
