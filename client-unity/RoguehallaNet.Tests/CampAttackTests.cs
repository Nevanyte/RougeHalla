using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-UNITY-CAMP-PATIENCE-SHOW-1 oracle (owner direction 2026-11-14): a camp's patience outline shows only while the local player attacks
    /// that camp. "Attacking" = within <see cref="CampAttack.LingerMs"/> of damage between the local player and a mob standing in that camp's patience
    /// area (either direction). The camp of a mob is the patience plane value under it (a mob never chases past its plane).</summary>
    public sealed class CampAttackTests
    {
        const uint Me = 1, Other = 2, MobA = 10, MobA2 = 11, MobB = 20, MobFar = 30;

        // 8 x 8 tiles of 32 sim units. Camp 1 (index 0): tiles (1,1),(2,1). Camp 2 (index 1): tile (5,5). Everything else 0.
        static byte[] Plane()
        {
            var p = new byte[64];
            p[1 * 8 + 1] = 1; p[1 * 8 + 2] = 1; p[5 * 8 + 5] = 2;
            return p;
        }

        static readonly CampAttackMob[] Mobs =
        {
            new CampAttackMob(MobA, 48, 48),      // tile (1,1): camp index 0
            new CampAttackMob(MobA2, 80, 48),     // tile (2,1): camp index 0
            new CampAttackMob(MobB, 176, 176),    // tile (5,5): camp index 1
            new CampAttackMob(MobFar, 240, 240),  // tile (7,7): in no camp
        };

        static void Frame(CampAttack c, double now, CampAttackMob[] mobs = null, uint local = Me, bool alive = true)
            => c.Update(now, local, alive, mobs ?? Mobs, Plane(), 8, 8);

        static bool[] Seen(CampAttack c) => new[] { c.IsAttacked(0), c.IsAttacked(1) };

        [Test]
        public void An_idle_camp_is_hidden()
        {
            var c = new CampAttack();
            Frame(c, 0); Frame(c, 50);
            Assert.AreEqual(new[] { false, false }, Seen(c));
            Assert.IsFalse(c.IsAttacked(-1)); Assert.IsFalse(c.IsAttacked(99));
        }

        [Test]
        public void Hitting_a_camp_mob_shows_that_camp_and_only_that_camp()
        {
            var c = new CampAttack();
            c.NoteHit(Me, MobA);
            Frame(c, 1000);
            Assert.AreEqual(new[] { true, false }, Seen(c), "camp 1 only, though camp 2's mob is in view");
        }

        [Test]
        public void A_mob_hitting_the_local_player_shows_its_camp()
        {
            var c = new CampAttack();
            c.NoteHit(MobB, Me);
            Frame(c, 1000);
            Assert.AreEqual(new[] { false, true }, Seen(c));
        }

        [Test]
        public void Damage_between_other_players_and_mobs_does_not_count()
        {
            var c = new CampAttack();
            c.NoteHit(Other, MobA);           // another player's hit
            c.NoteHit(MobA, Other);           // a mob hitting another player
            c.NoteHit(uint.MaxValue, MobB);   // a redacted source
            c.NoteHit(Me, Other);             // local player hits a player, not a mob
            Frame(c, 1000);
            Assert.AreEqual(new[] { false, false }, Seen(c));
        }

        [Test]
        public void A_hit_on_a_mob_outside_every_camp_or_an_unknown_id_shows_nothing_and_throws_nothing()
        {
            var c = new CampAttack();
            c.NoteHit(Me, MobFar);
            c.NoteHit(Me, 9999);
            Assert.DoesNotThrow(() => Frame(c, 1000));
            Assert.AreEqual(new[] { false, false }, Seen(c));
        }

        [Test]
        public void The_camp_stays_shown_for_the_linger_after_the_last_damage_then_hides()
        {
            Assert.That(CampAttack.LingerMs, Is.InRange(2000d, 3000d), "dial: about 2 to 3 s");
            var c = new CampAttack();
            c.NoteHit(Me, MobA);
            Frame(c, 10_000);
            Frame(c, 10_000 + CampAttack.LingerMs - 50);
            Assert.IsTrue(c.IsAttacked(0), "no flicker between swings");
            Frame(c, 10_000 + CampAttack.LingerMs + 50);
            Assert.IsFalse(c.IsAttacked(0), "linger over");
        }

        [Test]
        public void A_new_hit_restarts_the_linger_and_each_camp_has_its_own_clock()
        {
            var c = new CampAttack();
            c.NoteHit(Me, MobA);
            Frame(c, 0);
            c.NoteHit(Me, MobA2);                       // same camp, a different mob
            Frame(c, 2000);
            Frame(c, 2000 + CampAttack.LingerMs - 50);
            Assert.IsTrue(c.IsAttacked(0), "the hit at 2000 restarted the clock");
            c.NoteHit(MobB, Me);
            Frame(c, 2000 + CampAttack.LingerMs - 40);
            Frame(c, 2000 + CampAttack.LingerMs + 50);
            Assert.AreEqual(new[] { false, true }, Seen(c), "camp 1 lapsed; camp 2 was hit later");
        }

        [Test]
        public void A_killing_blow_still_counts_though_the_mob_is_gone_by_the_next_frame()
        {
            var c = new CampAttack();
            Frame(c, 0);                                 // the mob was seen standing in camp 1
            c.NoteHit(Me, MobA);
            Frame(c, 50, new[] { Mobs[2], Mobs[3] });    // dead: no longer in the list
            Assert.IsTrue(c.IsAttacked(0), "remembers which camp the mob stood in");
        }

        [Test]
        public void Dying_ends_it_at_once_and_a_late_revival_does_not_bring_it_back()
        {
            var c = new CampAttack();
            c.NoteHit(Me, MobA);
            Frame(c, 0);
            Assert.IsTrue(c.IsAttacked(0));
            Frame(c, 100, alive: false);
            Assert.AreEqual(new[] { false, false }, Seen(c), "a dead local player attacks nothing");
            Frame(c, 200, alive: true);
            Assert.AreEqual(new[] { false, false }, Seen(c), "no new damage since");
        }

        [Test]
        public void A_spectator_with_no_seat_shows_nothing()
        {
            var c = new CampAttack();
            c.NoteHit(0, MobA);                          // by 0 is no player
            c.NoteHit(MobA, 0);
            Frame(c, 0, local: 0);
            Assert.AreEqual(new[] { false, false }, Seen(c));
            c.NoteHit(Me, MobA);
            Frame(c, 50, local: 0);
            Assert.AreEqual(new[] { false, false }, Seen(c), "no seat, no attack, whoever is named");
        }

        [Test]
        public void Clear_forgets_everything_for_a_new_match()
        {
            var c = new CampAttack();
            c.NoteHit(Me, MobA);
            Frame(c, 0);
            c.Clear();
            Assert.AreEqual(new[] { false, false }, Seen(c));
            Frame(c, 50);
            Assert.AreEqual(new[] { false, false }, Seen(c));
        }

        [Test]
        public void Guard_a_missing_or_wrong_sized_plane_or_no_mobs_throws_nothing_and_shows_nothing()
        {
            var c = new CampAttack();
            c.NoteHit(Me, MobA);
            Assert.DoesNotThrow(() => c.Update(0, Me, true, null, Plane(), 8, 8));
            Assert.DoesNotThrow(() => c.Update(1, Me, true, Mobs, null, 8, 8));
            Assert.DoesNotThrow(() => c.Update(2, Me, true, Mobs, new byte[5], 8, 8));
            Assert.DoesNotThrow(() => c.Update(3, Me, true, new[] { new CampAttackMob(MobA, -5, 1e9f) }, Plane(), 8, 8));
            Assert.AreEqual(new[] { false, false }, Seen(c));
        }
    }
}
