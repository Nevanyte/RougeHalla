using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
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

        // ---- P-AUG-UI-3: Marked Man holders on every minimap (State key 15, public under C-OBS; AUGMENT_ELITE_REWORK decision 9) ----

        static WireMarked M(uint id, float x, float y) => new WireMarked { Id = id, X = x, Y = y };

        static MarkedMark[] Holders(WireMarked[] rows, uint self = Self)
        {
            var into = new List<MarkedMark>();
            WorldMarks.MarkedHolders(rows, self, into);
            return into.ToArray();
        }

        [Test]
        public void EveryOtherHolderGetsAMarkAtItsWireRowPositionWithoutAnyActorOrVisionInput()
        {
            // The helper takes only the rows: a holder far outside the viewer's vision has no InterpActor and still gets a mark.
            var m = Holders(new[] { M(Other, 12.5f, 40f), M(900, 310.25f, 7.125f) });
            Assert.AreEqual(2, m.Length);
            Assert.AreEqual(Other, m[0].Id); Assert.AreEqual(12.5f, m[0].X); Assert.AreEqual(40f, m[0].Y);
            Assert.AreEqual(900u, m[1].Id); Assert.AreEqual(310.25f, m[1].X); Assert.AreEqual(7.125f, m[1].Y);
        }

        [Test]
        public void TheViewersOwnRowIsNotDrawnAsASecondMarkBecauseTheSelfMarkerAlreadySitsThere()
        {
            // Pinned choice: a viewer holding the card already has the self ring at the same point and knows its own card.
            var m = Holders(new[] { M(Self, 1f, 1f), M(Other, 2f, 2f), M(Third, 3f, 3f) });
            Assert.AreEqual(2, m.Length);
            Assert.AreEqual(Other, m[0].Id); Assert.AreEqual(Third, m[1].Id);
        }

        [Test]
        public void MarksAreInAscendingIdEvenIfRowsArriveOutOfOrder()
        {
            var m = Holders(new[] { M(Third, 3f, 3f), M(Other, 2f, 2f), M(Rival, 5f, 5f) });
            Assert.AreEqual(3, m.Length);
            Assert.AreEqual(new uint[] { Rival, Other, Third }, new[] { m[0].Id, m[1].Id, m[2].Id });
        }

        [Test]
        public void NoRowsDrawNothingAndAStaleListIsClearedWhenTheRowsClear()
        {
            var into = new List<MarkedMark> { new MarkedMark { Id = 77 } };
            WorldMarks.MarkedHolders(System.Array.Empty<WireMarked>(), Self, into);
            Assert.AreEqual(0, into.Count);
            WorldMarks.MarkedHolders(new[] { M(Other, 2f, 2f) }, Self, into);
            Assert.AreEqual(1, into.Count);
            WorldMarks.MarkedHolders(System.Array.Empty<WireMarked>(), Self, into); // holder died or lost the card
            Assert.AreEqual(0, into.Count);
        }

        [Test]
        public void MarkedHoldersDoNotChangeTheTabMapContactLabels()
        {
            var into = new List<ContactMark>();
            var marks = new List<MarkedMark>();
            var actors = new[] { Player(Self), Player(Other), Player(Rival) };
            WorldMarks.TabMapContacts(actors, Self, FactionId.Sentenced, ActorStatus.Alive, Rival, true, into);
            WorldMarks.MarkedHolders(new[] { M(Other, 2f, 2f) }, Self, marks);
            Assert.AreEqual(2, into.Count);
            Assert.AreEqual("ENEMY", into[0].Text); Assert.AreEqual("HUNT", into[1].Text);
            Assert.AreEqual(1, marks.Count); // the new list is filled (red until implemented)
        }
    }
}
