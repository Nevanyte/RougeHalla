using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    /// <summary>Own attack clip at the click: presentation only, started on server-sent readiness, adopted or cut by server state.</summary>
    public class OwnAttackCueTests
    {
        const byte Playing = 1;
        const double Rtt = 100;

        static SelfView Me(ushort readyInMs = 0, WeaponId weapon = WeaponId.Sword, ActorStatus status = ActorStatus.Alive, ushort effects = 0)
        {
            return new SelfView { Id = 1, Status = status, Weapon = weapon, ReadyInMs = readyInMs, Effects = effects };
        }

        // Snapshot at server 1000; the ping clock says server now is 1040 at local 0, so the press reaches the server at 1090.
        static bool Press(OwnAttackCue cue, SelfView me, double now = 0, byte phase = Playing, bool clock = true)
        {
            return cue.TryStart(now, me, phase, 1000, clock, 1040 + now, Rtt);
        }

        [Test]
        public void ReadyPressStartsAtTheClick()
        {
            var cue = new OwnAttackCue();
            Assert.IsTrue(Press(cue, Me()));
            Assert.IsTrue(cue.Pending);
        }

        [Test]
        public void ReadinessWithinOneTickOfArrivalStarts_LaterDoesNot()
        {
            // Ready at 1000 + 140 = 1140 = arrival 1090 + 50: the server buffers the press and starts on readiness.
            Assert.IsTrue(Press(new OwnAttackCue(), Me(readyInMs: 140)));
            Assert.IsFalse(Press(new OwnAttackCue(), Me(readyInMs: 141)));
            Assert.IsFalse(Press(new OwnAttackCue(), Me(readyInMs: 400)));
        }

        [Test]
        public void ObviouslyRefusedPressesStartNothing()
        {
            Assert.IsFalse(Press(new OwnAttackCue(), Me(effects: OwnAttackCue.StunBit)));
            Assert.IsFalse(Press(new OwnAttackCue(), Me(effects: OwnAttackCue.CastingBit)));
            Assert.IsFalse(Press(new OwnAttackCue(), Me(status: ActorStatus.Dead)));
            Assert.IsFalse(Press(new OwnAttackCue(), Me(), phase: 0));
            Assert.IsFalse(Press(new OwnAttackCue(), null));
            Assert.IsFalse(Press(new OwnAttackCue(), Me(), clock: false));
            // Other effect bits (slow, haste, ...) do not block an attack.
            Assert.IsTrue(Press(new OwnAttackCue(), Me(effects: 8 | 2048)));
        }

        [Test]
        public void SecondPressWhilePendingDoesNotRestartTheClip()
        {
            var cue = new OwnAttackCue();
            Assert.IsTrue(Press(cue, Me()));
            Assert.IsFalse(Press(cue, Me(), now: 30));
        }

        [Test]
        public void ReadyTimeJumpOnANewerSnapshotAdopts()
        {
            var cue = new OwnAttackCue();
            Press(cue, Me());
            // Same snapshot, then a newer one still ready: not yet confirmed, not cancelled inside RTT + 2 ticks.
            Assert.IsFalse(cue.Update(20, Me(), Playing, 1000));
            Assert.IsFalse(cue.Update(60, Me(), Playing, 1050));
            Assert.IsTrue(cue.Pending);
            // The server started the swing at 1100 with a 600 ms interval: ready 1700, seen at snapshot 1100.
            Assert.IsFalse(cue.Update(150, Me(readyInMs: 600), Playing, 1100));
            Assert.IsTrue(cue.Adopted);
            // Adopted clips are never cut later, even past the bound or under a later stun.
            Assert.IsFalse(cue.Update(900, Me(effects: OwnAttackCue.StunBit), Playing, 1900));
        }

        [Test]
        public void OldCooldownStillRunningIsNotConfirmation()
        {
            var cue = new OwnAttackCue();
            Assert.IsTrue(Press(cue, Me(readyInMs: 120)));
            // Ready time unchanged (1120) on newer snapshots: no new attack yet.
            Assert.IsFalse(cue.Update(60, Me(readyInMs: 70), Playing, 1050));
            Assert.IsTrue(cue.Pending);
        }

        [Test]
        public void NoConfirmationWithinRttPlusTwoTicksCancels()
        {
            var cue = new OwnAttackCue();
            Press(cue, Me());
            Assert.IsFalse(cue.Update(200, Me(), Playing, 1150));
            Assert.IsTrue(cue.Update(201, Me(), Playing, 1150));
            Assert.IsFalse(cue.Pending);
            Assert.IsFalse(cue.Update(300, Me(), Playing, 1250), "cancels once");
        }

        [Test]
        public void TimeoutIsCappedAtHighPing()
        {
            var cue = new OwnAttackCue();
            Assert.IsTrue(cue.TryStart(0, Me(), Playing, 1000, true, 1040, 900));
            Assert.IsFalse(cue.Update(OwnAttackCue.HardCapMs, Me(), Playing, 1000));
            Assert.IsTrue(cue.Update(OwnAttackCue.HardCapMs + 1, Me(), Playing, 1000));
        }

        [Test]
        public void ServerStateThatForbidsTheActionCancelsAtOnce()
        {
            foreach (var bad in new[] { Me(effects: OwnAttackCue.StunBit), Me(status: ActorStatus.Dead), Me(weapon: WeaponId.Bow), null })
            {
                var cue = new OwnAttackCue();
                Press(cue, Me());
                Assert.IsTrue(cue.Update(40, bad, Playing, 1050));
            }
            var ended = new OwnAttackCue();
            Press(ended, Me());
            Assert.IsTrue(ended.Update(40, Me(), 2, 1050));
        }

        [Test]
        public void OwnMeleeSwingFxIsAbsorbedOnceAndAdopts()
        {
            var cue = new OwnAttackCue();
            Press(cue, Me());
            Assert.IsTrue(cue.AbsorbServerSwing(80));
            Assert.IsTrue(cue.Adopted);
            Assert.IsFalse(cue.AbsorbServerSwing(400), "a later held swing replays the clip");
        }

        [Test]
        public void SwingAfterAdoptionByReadyJumpIsAbsorbed()
        {
            var cue = new OwnAttackCue();
            Press(cue, Me());
            cue.Update(150, Me(readyInMs: 600), Playing, 1100);
            Assert.IsTrue(cue.AbsorbServerSwing(450));
        }

        [Test]
        public void NothingIsAbsorbedWithoutAStartedMeleePress()
        {
            var none = new OwnAttackCue();
            Assert.IsFalse(none.AbsorbServerSwing(10));

            var refused = new OwnAttackCue();
            Assert.IsFalse(Press(refused, Me(readyInMs: 400)));
            Assert.IsFalse(refused.AbsorbServerSwing(500));

            var cancelled = new OwnAttackCue();
            Press(cancelled, Me());
            Assert.IsTrue(cancelled.Update(250, Me(), Playing, 1200));
            Assert.IsFalse(cancelled.AbsorbServerSwing(300), "a late server swing after a cancel plays as before");

            var ranged = new OwnAttackCue();
            Assert.IsTrue(Press(ranged, Me(weapon: WeaponId.Bow)));
            Assert.IsFalse(ranged.AbsorbServerSwing(50));

            var stale = new OwnAttackCue();
            Press(stale, Me());
            stale.Update(150, Me(readyInMs: 600), Playing, 1100);
            stale.Update(OwnAttackCue.AbsorbWindowMs + 1, Me(), Playing, 2500);
            Assert.IsFalse(stale.AbsorbServerSwing(OwnAttackCue.AbsorbWindowMs + 2));
        }

        [Test]
        public void ResetForgetsEverything()
        {
            var cue = new OwnAttackCue();
            Press(cue, Me());
            cue.Reset();
            Assert.IsFalse(cue.Pending);
            Assert.IsFalse(cue.Update(1000, Me(), Playing, 1000));
            Assert.IsFalse(cue.AbsorbServerSwing(10));
        }

        // ---- a ready-time jump never overrides a blocker seen in the same update ----

        [Test]
        public void ReadyJumpTogetherWithDeathIsRejected()
        {
            var cue = new OwnAttackCue();
            Press(cue, Me());
            Assert.IsTrue(cue.Update(150, Me(readyInMs: 600, status: ActorStatus.Dead), Playing, 1100));
            Assert.IsFalse(cue.Pending); Assert.IsFalse(cue.Adopted);
        }

        [Test]
        public void ReadyJumpTogetherWithStunIsRejected()
        {
            var cue = new OwnAttackCue();
            Press(cue, Me());
            Assert.IsTrue(cue.Update(150, Me(readyInMs: 600, effects: OwnAttackCue.StunBit), Playing, 1100));
            Assert.IsFalse(cue.Pending); Assert.IsFalse(cue.Adopted);
        }

        [Test]
        public void ReadyJumpTogetherWithAWeaponChangeIsRejected()
        {
            var cue = new OwnAttackCue();
            Press(cue, Me());
            Assert.IsTrue(cue.Update(150, Me(readyInMs: 600, weapon: WeaponId.Bow), Playing, 1100));
            Assert.IsFalse(cue.Pending); Assert.IsFalse(cue.Adopted);
        }

        [Test]
        public void ReadyJumpPastTheTimeoutIsRejected()
        {
            var cue = new OwnAttackCue();
            Press(cue, Me());
            Assert.IsTrue(cue.Update(201, Me(readyInMs: 600), Playing, 1200));
            Assert.IsFalse(cue.Pending); Assert.IsFalse(cue.Adopted);
        }

        [Test]
        public void GenuineLateServerEffectsAreStillRetainedAndAbsorbedOnce()
        {
            // The real Swing Fx arrives (Poll) before the frame's Update, even when the same snapshot also stuns or the bound passed.
            var late = new OwnAttackCue();
            Press(late);
            Assert.IsTrue(late.AbsorbServerSwing(230));
            Assert.IsFalse(late.Update(230, Me(readyInMs: 600, effects: OwnAttackCue.StunBit), Playing, 1200));
            Assert.IsTrue(late.Adopted);
            Assert.IsFalse(late.AbsorbServerSwing(300), "absorbed exactly once");

            // A jump confirmed in an earlier update stays adopted when a short stun begins later, and its swing is absorbed once.
            var stunned = new OwnAttackCue();
            Press(stunned);
            Assert.IsFalse(stunned.Update(150, Me(readyInMs: 600), Playing, 1100));
            Assert.IsFalse(stunned.Update(200, Me(readyInMs: 550, effects: OwnAttackCue.StunBit), Playing, 1150));
            Assert.IsTrue(stunned.Adopted);
            Assert.IsTrue(stunned.AbsorbServerSwing(450));
            Assert.IsFalse(stunned.AbsorbServerSwing(500));
        }

        static void Press(OwnAttackCue cue) { Assert.IsTrue(Press(cue, Me())); }
    }
}
