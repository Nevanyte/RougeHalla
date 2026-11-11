using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// Wand click picking, pinned to legacy packages/client/src/render/targeting.ts (pickTarget :17, targetableMob :8, targetable :37,
    /// LockDisplay :65) and packages/client/test/targeting.test.ts, plus the click decision in RaidScene.ts clickAttack :1403 and
    /// sendTarget :1476. Distances are world units from the cursor's world point; screen zoom does not enter.
    /// </summary>
    public sealed class TargetPickTests
    {
        const uint Me = 1;
        const ushort Stunned = 1, Rooted = 2, Silenced = 4, Slowed = 8, AttackSlowed = 16, AntiHeal = 32, Dot = 64, Untargetable = 128,
            Hidden = 256, Zoned = 512, LastStand = 1024, Haste = 2048, Casting = 4096;

        static PickCandidate At(uint id, float x, float y, ActorKind kind = ActorKind.Player, ActorStatus status = ActorStatus.Alive,
            ushort effects = 0, bool own = false)
        {
            return new PickCandidate { Id = id, X = x, Y = y, Kind = kind, Status = status, Effects = effects, OwnCompanion = own };
        }

        static uint PickAt(float cx, float cy, bool gatesLocked, params PickCandidate[] list)
        {
            return TargetPick.Pick(cx, cy, list, Me, gatesLocked);
        }

        static uint Pick(params PickCandidate[] list) { return PickAt(0, 0, false, list); }

        // ---- the picker (targeting.test.ts "pickTarget") ----

        [Test]
        public void SnapRadiusIsSixtyFourWorldUnits()
        {
            Assert.AreEqual(64f, TargetPick.SnapRadius);
        }

        [Test]
        public void TakesTheNearestToTheCursorNotTheFirstInTheList()
        {
            Assert.AreEqual(3u, Pick(At(2, 40, 0), At(3, 10, 5), At(4, 25, 0)));
        }

        [Test]
        public void SnapsFromAMissUpToTheRadius()
        {
            Assert.AreEqual(2u, Pick(At(2, TargetPick.SnapRadius - 0.5f, 0)));
            Assert.AreEqual(0u, Pick(At(2, TargetPick.SnapRadius + 0.5f, 0)));
        }

        [Test]
        public void ExactlyOnTheRadiusIsOutside()
        {
            // Legacy compares squared distance with "<" (targeting.ts:24), so a fighter exactly 64 away is not picked.
            Assert.AreEqual(0u, Pick(At(2, 64f, 0)));
            Assert.AreEqual(0u, Pick(At(2, 0, -64f)));
        }

        [Test]
        public void MeasuresOnTheGroundPlaneInBothAxes()
        {
            var list = new[] { At(2, 50, 50) };
            Assert.AreEqual(0u, PickAt(0, 0, false, list), "70.7 away");
            Assert.AreEqual(2u, PickAt(20, 20, false, list));
        }

        [Test]
        public void DoesNothingOnEmptyGround()
        {
            Assert.AreEqual(0u, Pick());
            Assert.AreEqual(0u, Pick(At(2, 500, 500)));
        }

        [Test]
        public void UsesTheGivenRadius()
        {
            var one = new[] { At(2, 30, 0) };
            Assert.AreEqual(0u, TargetPick.Pick(0, 0, one, Me, false, 20f));
            Assert.AreEqual(2u, TargetPick.Pick(0, 0, one, Me, false, 40f));
        }

        [Test]
        public void AnExactTieGoesToTheLowerIdWhateverTheOrder()
        {
            Assert.AreEqual(2u, Pick(At(2, 10, 0), At(3, -10, 0)));
            Assert.AreEqual(2u, Pick(At(3, -10, 0), At(2, 10, 0)));
            // Legacy compares ids as strings ("p10" < "p9", targeting.ts:24); the wire id is a number, so this port orders numerically.
            Assert.AreEqual(9u, Pick(At(10, 0, 5), At(9, 5, 0)));
        }

        [Test]
        public void ANearerOneBeatsALowerId()
        {
            Assert.AreEqual(9u, Pick(At(2, 30, 0), At(9, 10, 0)));
        }

        [Test]
        public void TheCursorWorldPointIsWhatCountsNotTheOriginOrTheSelf()
        {
            Assert.AreEqual(5u, PickAt(1000, -400, false, At(4, 1060, -400), At(5, 1010, -405), At(6, 0, 0)));
        }

        // ---- the filters (targeting.ts:8 targetableMob, :37 targetable; RaidScene.ts:1366 targetCandidates) ----

        [Test]
        public void NeverOffersADeadOrAbsentActor()
        {
            Assert.AreEqual(0u, Pick(At(2, 1, 0, status: ActorStatus.Dead)));
            Assert.AreEqual(0u, Pick(At(2, 1, 0, status: ActorStatus.Mia)));
            Assert.AreEqual(0u, Pick(At(2, 1, 0, status: ActorStatus.Lobby)));
            Assert.AreEqual(0u, Pick(At(2, 1, 0, ActorKind.RegionalMob, ActorStatus.Dead)));
        }

        [Test]
        public void ADeadActorNearerTheCursorDoesNotShadowAnAliveOne()
        {
            Assert.AreEqual(3u, Pick(At(2, 1, 0, status: ActorStatus.Dead), At(3, 50, 0)));
        }

        [Test]
        public void NeverOffersTheLocalPlayer()
        {
            Assert.AreEqual(0u, Pick(At(Me, 0, 0)));
            Assert.AreEqual(3u, Pick(At(Me, 0, 0), At(3, 50, 0)));
        }

        [Test]
        public void NeverOffersAQuestNpc()
        {
            Assert.AreEqual(0u, Pick(At(2, 1, 0, ActorKind.QuestGiver)));
            Assert.AreEqual(0u, PickAt(0, 0, true, At(2, 1, 0, ActorKind.QuestGiver)));
            Assert.AreEqual(3u, Pick(At(2, 1, 0, ActorKind.QuestGiver), At(3, 50, 0, ActorKind.RegionalMob)));
        }

        [Test]
        public void NeverOffersTheLocalPlayersOwnCompanionButOffersAnEnemyZombie()
        {
            foreach (bool locked in new[] { false, true })
            {
                Assert.AreEqual(0u, PickAt(0, 0, locked, At(2, 1, 0, ActorKind.Zombie, own: true)), "locked " + locked);
                Assert.AreEqual(2u, PickAt(0, 0, locked, At(2, 1, 0, ActorKind.Zombie)), "locked " + locked);
            }
            Assert.AreEqual(3u, Pick(At(2, 1, 0, ActorKind.Zombie, own: true), At(3, 50, 0, ActorKind.Zombie)));
        }

        [Test]
        public void WhileTheGatesAreLockedOnlyZombiesAndPlayersAreOfferedNotRegionalMobsOrDummies()
        {
            Assert.AreEqual(2u, PickAt(0, 0, false, At(2, 1, 0, ActorKind.RegionalMob)));
            Assert.AreEqual(2u, PickAt(0, 0, false, At(2, 1, 0, ActorKind.TrainingDummy)));
            Assert.AreEqual(0u, PickAt(0, 0, true, At(2, 1, 0, ActorKind.RegionalMob)));
            Assert.AreEqual(0u, PickAt(0, 0, true, At(2, 1, 0, ActorKind.TrainingDummy)));
            Assert.AreEqual(2u, PickAt(0, 0, true, At(2, 1, 0, ActorKind.Zombie)));
            Assert.AreEqual(2u, PickAt(0, 0, true, At(2, 1, 0, ActorKind.Player)));
            // The gates test is on mobs only: a player is always offered (RaidScene.ts:1377 filters only mobs).
            Assert.AreEqual(3u, PickAt(0, 0, true, At(2, 1, 0, ActorKind.RegionalMob), At(3, 50, 0, ActorKind.Player)));
        }

        [Test]
        public void NeverOffersAHiddenOrUntargetableActorAloneOrAmongOtherBits()
        {
            Assert.AreEqual(0u, Pick(At(2, 1, 0, effects: Hidden)));
            Assert.AreEqual(0u, Pick(At(2, 1, 0, effects: Untargetable)));
            Assert.AreEqual(0u, Pick(At(2, 1, 0, effects: (ushort)(Hidden | Untargetable))));
            Assert.AreEqual(0u, Pick(At(2, 1, 0, effects: (ushort)(Stunned | Hidden | Haste))));
            Assert.AreEqual(0u, Pick(At(2, 1, 0, ActorKind.RegionalMob, effects: Untargetable)));
            Assert.AreEqual(3u, Pick(At(2, 1, 0, effects: Hidden), At(3, 50, 0)));
        }

        [Test]
        public void CrowdControlAndBuffsDoNotMakeAnActorUnpickable()
        {
            foreach (ushort bit in new ushort[] { Stunned, Rooted, Silenced, Slowed, AttackSlowed, AntiHeal, Dot, Zoned, LastStand, Haste, Casting })
                Assert.AreEqual(2u, Pick(At(2, 1, 0, effects: bit)), "bit " + bit);
            Assert.AreEqual(2u, Pick(At(2, 1, 0, effects: (ushort)(Stunned | Rooted | Zoned | LastStand))));
        }

        [Test]
        public void EligibleAgreesWithPickOnASingleCandidate()
        {
            Assert.IsTrue(TargetPick.Eligible(At(2, 0, 0), Me, false));
            Assert.IsFalse(TargetPick.Eligible(At(2, 0, 0, status: ActorStatus.Dead), Me, false));
            Assert.IsFalse(TargetPick.Eligible(At(Me, 0, 0), Me, false));
            Assert.IsFalse(TargetPick.Eligible(At(2, 0, 0, ActorKind.RegionalMob), Me, true));
        }

        // ---- the click decision (RaidScene.ts clickAttack :1403, sendTarget :1476) ----

        [Test]
        public void AWandClickOnACandidateSendsALockOrder()
        {
            var o = TargetPick.Decide(WeaponId.Wand, 7);
            Assert.AreEqual(ClickOrderKind.Target, o.Kind);
            Assert.AreEqual(7u, o.Target);
        }

        [Test]
        public void AWandClickWithNoCandidateSendsNothingNeverAnUnlockedShot()
        {
            var o = TargetPick.Decide(WeaponId.Wand, 0);
            Assert.AreEqual(ClickOrderKind.None, o.Kind);
            Assert.AreEqual(0u, o.Target);
        }

        [Test]
        public void EveryOtherWeaponAttacksInTheAimDirectionWhateverIsUnderTheCursor()
        {
            foreach (var w in new[] { WeaponId.Sword, WeaponId.Bow, WeaponId.Shield, WeaponId.Axe, WeaponId.Fists })
                foreach (uint picked in new uint[] { 0, 7 })
                {
                    var o = TargetPick.Decide(w, picked);
                    Assert.AreEqual(ClickOrderKind.DirectionalAttack, o.Kind, w + " picked " + picked);
                    Assert.AreEqual(0u, o.Target, w + " picked " + picked);
                }
        }

        // ---- the instant lock ring (targeting.test.ts "LockDisplay") ----

        [Test]
        public void TheOptimisticLockLastsFiveHundredMs()
        {
            Assert.AreEqual(500.0, LockDisplay.OptimisticLockMs);
        }

        [Test]
        public void ShowsTheSyncedLockWhenNothingWasOrdered()
        {
            var d = new LockDisplay();
            Assert.AreEqual(0u, d.Shown(0, 1000));
            Assert.AreEqual(5u, d.Shown(5, 1000));
        }

        [Test]
        public void ShowsAFreshTargetAtOnceBeforeTheServersPatch()
        {
            var d = new LockDisplay();
            d.Note(6, 1000);
            Assert.AreEqual(6u, d.Shown(0, 1000));
            Assert.AreEqual(6u, d.Shown(5, 1000 + LockDisplay.OptimisticLockMs - 1));
        }

        [Test]
        public void AMoveOrStopShowsNoLockAtOnceThoughTheSyncedOneHasNotCleared()
        {
            var d = new LockDisplay();
            d.Note(0, 1000);
            Assert.AreEqual(0u, d.Shown(5, 1100));
        }

        [Test]
        public void HandsOverToTheSyncedLockAfterTheWindowSoARefusedOrderFallsBack()
        {
            var d = new LockDisplay();
            d.Note(6, 1000);
            Assert.AreEqual(5u, d.Shown(5, 1000 + LockDisplay.OptimisticLockMs));
            Assert.AreEqual(0u, d.Shown(0, 5000));
        }

        [Test]
        public void TheNewestOrderWins()
        {
            var d = new LockDisplay();
            d.Note(6, 1000);
            d.Note(0, 1100);
            Assert.AreEqual(0u, d.Shown(0, 1200));
            d.Note(8, 1300);
            Assert.AreEqual(8u, d.Shown(0, 1400));
        }

        [Test]
        public void ResetForgetsTheOrder()
        {
            var d = new LockDisplay();
            d.Note(6, 1000);
            d.Reset();
            Assert.AreEqual(0u, d.Shown(0, 1001));
        }
    }
}
