using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// The legacy opponent inspector card (packages/client/src/ui/opponentInspector.ts) built from a remote actor's delivered row.
    /// Facts the wire does not carry are absent (docs/backlog/packets/P-UNITY-INSPECTOR-1.md, "Not on the wire").
    /// </summary>
    public sealed class InspectorCardTests
    {
        const uint Self = 1, Other = 7;
        const ushort Untargetable = 128, Hidden = 256;

        static InterpActor Row(FactionId f = FactionId.Fire, WeaponId? w = WeaponId.Sword, byte hp = 100) => new InterpActor
        {
            Id = Other, Kind = ActorKind.Player, Status = ActorStatus.Alive, Faction = f, Weapon = w, HpPct = hp,
        };

        static List<string> Lines(InterpActor row, uint self = Self, bool expectShown = true)
        {
            var lines = new List<string> { "stale" };
            Assert.That(InspectorCard.Build(row, self, lines), Is.EqualTo(expectShown));
            return lines;
        }

        [Test] public void APlayerRowGivesTheKitLineThenTheHealthLine()
            => Assert.That(Lines(Row(FactionId.Fire, WeaponId.Sword, 63)),
                Is.EqualTo(new[] { "Fire · Sword · Glass-cannon duelist", "Health 63%" }), "opponentInspector.ts:57-58; hp is a whole percent on the wire");

        [TestCase(FactionId.Fire, "Fire · Bow · Glass-cannon duelist")]
        [TestCase(FactionId.Sentenced, "Sentenced · Bow · Patient executioner")]
        [TestCase(FactionId.Plague, "Plague · Bow · Attrition swarm")]
        [TestCase(FactionId.Frost, "Frost · Bow · Control bruiser")]
        [TestCase(FactionId.Holy, "Holy · Bow · Sustain juggernaut")]
        public void EveryFactionNamesItselfAndItsRole(FactionId f, string kit)
            => Assert.That(Lines(Row(f, WeaponId.Bow))[0], Is.EqualTo(kit));

        [TestCase(0, "Sword")] [TestCase(1, "Bow")] [TestCase(2, "Wand")] [TestCase(3, "Shield")] [TestCase(4, "Axe")] [TestCase(5, "Fists")]
        [TestCase(99, "Fists")]   // opponentInspector.ts:57 falls back to Fists for a code it does not know
        public void TheHeldWeaponIsNamedAndAnUnknownOneReadsAsFists(int code, string name)
            => Assert.That(Lines(Row(FactionId.Frost, (WeaponId)code))[0], Is.EqualTo("Frost · " + name + " · Control bruiser"));

        [Test] public void NoWeaponReadsAsFists()
            => Assert.That(Lines(Row(FactionId.Holy, null))[0], Is.EqualTo("Holy · Fists · Sustain juggernaut"));

        [Test] public void DeliveredInvestedStatsFollowAsChipsMostInvestedFirst()
        {
            var r = Row(FactionId.Plague, WeaponId.Axe, 40);
            r.TopStat1 = StatKey.Ad; r.TopStat2 = StatKey.Ap;
            Assert.That(Lines(r), Is.EqualTo(new[] { "Plague · Axe · Attrition swarm", "Health 40%", "Offense", "Soul Offence" }),
                "opponentInspector.ts:63-69 chips, combatReadability.ts:44-54 labels; topStats are investedStats.slice(0, 2)");
        }

        [TestCase(StatKey.Ad, "Offense")] [TestCase(StatKey.Ap, "Soul Offence")] [TestCase(StatKey.Damage, "Damage")]
        [TestCase(StatKey.Health, "Health")] [TestCase(StatKey.AttackSpeed, "Attack Speed")] [TestCase(StatKey.Armor, "Defense")]
        [TestCase(StatKey.Mr, "Soul Defense")] [TestCase(StatKey.Speed, "Move Speed")] [TestCase(StatKey.Leech, "Leech")]
        public void EveryStatKeyHasItsLegacyLabelAndAMissingSecondIsOmitted(StatKey key, string label)
        {
            var r = Row(); r.TopStat1 = key;
            Assert.That(Lines(r), Is.EqualTo(new[] { "Fire · Sword · Glass-cannon duelist", "Health 100%", label }));
        }

        [Test] public void OnlyWhatTheWireCarriesAppearsNeverAPlaceholder()
        {
            var r = Row(); r.TopStat1 = StatKey.Armor; r.Flags = 0xff; r.BarrierPct = 50; r.Bounty = 90; r.OffhandWeapon = WeaponId.Bow; r.MarkTier = 3;
            var lines = Lines(r);
            Assert.That(lines, Has.Count.EqualTo(3), "kit, health, one chip");
            foreach (var l in lines)
                foreach (var absent in new[] { "Card power", "PvP", "growth", "damage", "Physical", "Magic", "True", "+", "Wish", "Ready", "not delivered", "?", "—", "Icons name" })
                    Assert.That(l, Does.Not.Contain(absent), "opponentInspector.ts:22,60,77,83-93 are not on the wire");
        }

        [TestCase(ActorKind.RegionalMob)] [TestCase(ActorKind.Zombie)] [TestCase(ActorKind.TrainingDummy)] [TestCase(ActorKind.QuestGiver)]
        public void OnlyPlayersGetACard(ActorKind kind)
        {
            // RaidScene.ts:749 passes state.players.get(id); mobs (zombies and dummies included) are not players, so legacy shows nothing.
            var r = Row(); r.Kind = kind;
            Assert.That(Lines(r, expectShown: false), Is.Empty);
        }

        [TestCase(ActorStatus.Lobby)] [TestCase(ActorStatus.Dead)] [TestCase(ActorStatus.Mia)]
        public void ADeadOrAbsentFighterHasNoCard(ActorStatus s)
        {
            var r = Row(); r.Status = s;   // opponentInspector.ts:46 requires "alive"
            Assert.That(Lines(r, expectShown: false), Is.Empty);
        }

        [TestCase(Hidden)] [TestCase(Untargetable)] [TestCase(Hidden | Untargetable | 1)]
        public void AHiddenOrUntargetableFighterHasNoCard(int effects)
        {
            var r = Row(); r.Effects = (ushort)effects;   // targeting.ts:37 keeps them out of the hover pick (C-OBS)
            Assert.That(Lines(r, expectShown: false), Is.Empty);
        }

        [Test] public void TheLocalPlayerAndAnUnknownFactionHaveNoCard()
        {
            Assert.That(Lines(Row(), self: Other, expectShown: false), Is.Empty, "RaidScene.ts:1376 never offers self");
            Assert.That(Lines(Row((FactionId)9), expectShown: false), Is.Empty, "opponentInspector.ts:46 isFactionId");
            var noFaction = Row(); noFaction.Faction = null;
            Assert.That(Lines(noFaction, expectShown: false), Is.Empty);
        }
    }
}
