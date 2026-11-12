using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>Tab-map enemy labels, pinned to legacy. RaidScene.ts:842-845 pushes every living non-local player as a map enemy,
    /// flagged tracked when it is the hunt target; planning.ts:1117 prints "HUNT" for a tracked dot and "ENEMY" otherwise (same CSS,
    /// no colour difference: planning.css:183). The target counts only for a living Sentenced local player and only while the target
    /// lives (RaidScene.ts:587-588). Enemy dots exist only on the held-Tab map (RaidScene.ts:843 mode "map"; planning.ts:45); the
    /// minimap takes plain points (RaidScene.ts:777) and prints no word.</summary>
    public sealed class WorldMarksTests
    {
        const uint Self = 1, Rival = 2, Other = 3, Third = 4;

        static InterpActor Player(uint id, ActorStatus status = ActorStatus.Alive) =>
            new InterpActor { Id = id, Kind = ActorKind.Player, Status = status, Faction = FactionId.Fire };

        static InterpActor Mob(uint id) => new InterpActor { Id = id, Kind = ActorKind.RegionalMob, Status = ActorStatus.Alive };

        static ContactMark[] Run(InterpActor[] actors, uint? hunt, FactionId faction = FactionId.Sentenced,
            ActorStatus self = ActorStatus.Alive, bool open = true)
        {
            var into = new List<ContactMark>();
            WorldMarks.TabMapContacts(actors, Self, faction, self, hunt, open, into);
            return into.ToArray();
        }

        static string[] Texts(ContactMark[] m)
        {
            var t = new string[m.Length];
            for (int i = 0; i < m.Length; i++) t[i] = m[i].Text;
            return t;
        }

        [Test]
        public void TheHuntTargetIsLabelledHuntAndEveryOtherLivingRivalEnemy()
        {
            var m = Run(new[] { Player(Self), Player(Other), Player(Rival), Player(Third) }, Rival);
            Assert.AreEqual(3, m.Length);
            Assert.AreEqual(Other, m[0].Id); Assert.AreEqual("ENEMY", m[0].Text); Assert.AreEqual(ContactLabel.Enemy, m[0].Label);
            Assert.AreEqual(Rival, m[1].Id); Assert.AreEqual("HUNT", m[1].Text); Assert.AreEqual(ContactLabel.Hunt, m[1].Label);
            Assert.AreEqual(Third, m[2].Id); Assert.AreEqual("ENEMY", m[2].Text);
            Assert.AreEqual("ENEMY", WorldMarks.EnemyText); Assert.AreEqual("HUNT", WorldMarks.HuntText);
        }

        [Test]
        public void OnlyLivingOtherPlayersAreContacts()
        {
            var m = Run(new[] { Player(Self), Mob(10), Player(Other, ActorStatus.Dead), Player(Third, ActorStatus.Mia), Player(5, ActorStatus.Lobby), Player(Rival) }, null);
            Assert.AreEqual(1, m.Length);
            Assert.AreEqual(Rival, m[0].Id); Assert.AreEqual("ENEMY", m[0].Text);
        }

        [Test]
        public void ADeadHuntTargetHasNoDot()
        {
            var m = Run(new[] { Player(Self), Player(Rival, ActorStatus.Dead), Player(Other) }, Rival);
            Assert.AreEqual(1, m.Length);
            Assert.AreEqual(Other, m[0].Id); Assert.AreEqual("ENEMY", m[0].Text);
        }

        [Test]
        public void HuntNeedsALivingSentencedLocalPlayer()
        {
            var actors = new[] { Player(Self), Player(Rival) };
            Assert.AreEqual(new[] { "ENEMY" }, Texts(Run(actors, Rival, FactionId.Fire)));
            Assert.AreEqual(new[] { "ENEMY" }, Texts(Run(actors, Rival, FactionId.Sentenced, ActorStatus.Dead)));
            Assert.AreEqual(new[] { "HUNT" }, Texts(Run(actors, Rival)));
        }

        [Test]
        public void NoLabelsWhenTheTabMapIsNotOpen()
        {
            Assert.AreEqual(0, Run(new[] { Player(Self), Player(Rival), Player(Other) }, Rival, open: false).Length);
        }

        [Test]
        public void ATargetThatIsNotDeliveredGetsNothingAndFillsReplaceTheList()
        {
            var into = new List<ContactMark> { new ContactMark { Id = 99, Text = "STALE" } };
            WorldMarks.TabMapContacts(new[] { Player(Self), Player(Other) }, Self, FactionId.Sentenced, ActorStatus.Alive, Rival, true, into);
            Assert.AreEqual(1, into.Count);
            Assert.AreEqual(Other, into[0].Id); Assert.AreEqual("ENEMY", into[0].Text);
        }
    }
}
