using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    public class MobContinuityTests
    {
        static MobLook Grunt = new MobLook(1, 3, 0, "grunt");
        static MobCandidate C(int h, float x, float y, float seen, MobLook? look = null) { return new MobCandidate { Handle = h, Look = look ?? Grunt, X = x, Y = y, SeenAt = seen }; }

        [Test]
        public void A_renewed_handle_continues_the_nearby_departed_creature()
        {
            var pool = new[] { C(7, 100, 100, 10f) };
            Assert.AreEqual(0, MobContinuity.Pick(pool, 1, Grunt, 104, 98, 10.05f));
        }

        [Test]
        public void Nothing_is_continued_beyond_two_tiles_or_after_the_stale_time_or_for_another_look()
        {
            var pool = new[] { C(7, 100, 100, 10f) };
            Assert.AreEqual(-1, MobContinuity.Pick(pool, 1, Grunt, 100 + 65, 100, 10.05f), "just past two tiles");
            Assert.AreEqual(0, MobContinuity.Pick(pool, 1, Grunt, 100 + 63, 100, 10.05f), "just inside two tiles");
            Assert.AreEqual(-1, MobContinuity.Pick(pool, 1, Grunt, 100, 100, 10.61f), "stale");
            Assert.AreEqual(0, MobContinuity.Pick(pool, 1, Grunt, 100, 100, 10.59f), "fresh");
            Assert.AreEqual(-1, MobContinuity.Pick(pool, 1, new MobLook(1, 4, 0, "grunt"), 100, 100, 10.05f), "other mob type");
            Assert.AreEqual(-1, MobContinuity.Pick(pool, 1, new MobLook(2, 3, 0, "grunt"), 100, 100, 10.05f), "other kind");
            Assert.AreEqual(-1, MobContinuity.Pick(pool, 1, new MobLook(1, 3, 1, "grunt"), 100, 100, 10.05f), "other faction");
            Assert.AreEqual(-1, MobContinuity.Pick(pool, 1, new MobLook(1, 3, 0, "brute"), 100, 100, 10.05f), "other archetype");
        }

        [Test]
        public void The_nearest_of_several_wins_and_only_the_counted_candidates_are_looked_at()
        {
            var pool = new[] { C(1, 140, 100, 10f), C(2, 110, 100, 10f), C(3, 100, 100, 10f) };
            Assert.AreEqual(1, MobContinuity.Pick(pool, 2, Grunt, 100, 100, 10.05f), "the third is outside the count");
            Assert.AreEqual(2, MobContinuity.Pick(pool, 3, Grunt, 100, 100, 10.05f));
        }

        [Test]
        public void A_candidate_seen_in_the_future_or_an_empty_pool_matches_nothing()
        {
            Assert.AreEqual(-1, MobContinuity.Pick(new MobCandidate[0], 0, Grunt, 0, 0, 1f));
            Assert.AreEqual(-1, MobContinuity.Pick(null, 0, Grunt, 0, 0, 1f));
            Assert.AreEqual(-1, MobContinuity.Pick(new[] { C(1, 0, 0, 5f) }, 1, Grunt, 0, 0, 1f));
        }

        [Test]
        public void Look_equality_ignores_a_missing_archetype_string()
        {
            Assert.IsTrue(new MobLook(1, 3, 0, null).Equals(new MobLook(1, 3, 0, "")));
        }

        // ---- P-UNITY-MOB-DEATH-1: a dead body keeps its art and its death start across renewed handles ----

        static MobCandidate Body(int h, float x, float y, float seen, float diedAt, MobLook? look = null) { var c = C(h, x, y, seen, look); c.Dead = true; c.DiedAt = diedAt; return c; }

        [Test]
        public void A_dead_body_whose_handle_was_renewed_is_the_same_body_and_keeps_its_death_start()
        {
            var pool = new[] { Body(7, 100, 100, 10f, 9.2f) };
            int i = MobContinuity.Adopt(pool, 1, Grunt, true, 104, 98, 10.05f, out float diedAt);
            Assert.AreEqual(0, i, "the same-look dead sighting nearby continues the body");
            Assert.AreEqual(9.2f, diedAt, 1e-4f, "the death clip keeps its original start; it is not restarted at 'now'");
            Assert.IsTrue(pool[0].Claimed, "an adopted body is claimed");
        }

        [Test]
        public void A_body_found_dead_one_snapshot_after_it_was_last_seen_alive_starts_its_death_now()
        {
            var pool = new[] { C(7, 100, 100, 10f) };
            int i = MobContinuity.Adopt(pool, 1, Grunt, true, 100, 100, 10.05f, out float diedAt);
            Assert.AreEqual(0, i, "it died between two snapshots: still the same creature");
            Assert.AreEqual(10.05f, diedAt, 1e-4f, "there was no earlier death start to keep");
        }

        [Test]
        public void A_living_sighting_never_takes_over_a_corpse()
        {
            var pool = new[] { Body(7, 100, 100, 10f, 9.2f) };
            Assert.AreEqual(-1, MobContinuity.Adopt(pool, 1, Grunt, false, 100, 100, 10.05f, out _));
            Assert.IsFalse(pool[0].Claimed);
        }

        [Test]
        public void A_body_is_adopted_by_the_same_rules_of_distance_age_and_look_as_a_living_creature()
        {
            var pool = new[] { Body(7, 100, 100, 10f, 9f) };
            Assert.AreEqual(-1, MobContinuity.Adopt(pool, 1, Grunt, true, 100 + 65, 100, 10.05f, out float d1), "just past two tiles");
            Assert.AreEqual(10.05f, d1, 1e-4f, "nothing adopted: a new body starts its clip now");
            Assert.AreEqual(-1, MobContinuity.Adopt(pool, 1, Grunt, true, 100, 100, 10.61f, out _), "stale");
            Assert.AreEqual(-1, MobContinuity.Adopt(pool, 1, new MobLook(1, 3, 0, "brute"), true, 100, 100, 10.05f, out _), "other look");
            Assert.AreEqual(0, MobContinuity.Adopt(pool, 1, Grunt, true, 100 + 63, 100, 10.05f, out _), "just inside two tiles");
        }

        [Test]
        public void Two_bodies_of_one_look_side_by_side_are_adopted_one_to_one()
        {
            var pool = new[] { Body(1, 100, 100, 10f, 9.0f), Body(2, 150, 100, 10f, 9.5f) };
            int first = MobContinuity.Adopt(pool, 2, Grunt, true, 110, 100, 10.05f, out float d1);
            Assert.AreEqual(0, first); Assert.AreEqual(9.0f, d1, 1e-4f);
            int second = MobContinuity.Adopt(pool, 2, Grunt, true, 105, 100, 10.05f, out float d2);
            Assert.AreEqual(1, second, "the nearer body is already taken, so the other one is used (within two tiles)");
            Assert.AreEqual(9.5f, d2, 1e-4f, "each body keeps its own death start");
            Assert.AreEqual(-1, MobContinuity.Adopt(pool, 2, Grunt, true, 120, 100, 10.05f, out _), "no body is used twice");
        }

        [Test]
        public void A_dead_body_nobody_continues_is_released_when_the_server_drops_it()
        {
            var pool = new[] { Body(7, 100, 100, 10f, 9.2f) };
            Assert.AreEqual(-1, MobContinuity.Adopt(pool, 1, Grunt, true, 400, 400, 10.1f, out _), "no successor in range");
            Assert.AreEqual(-1, MobContinuity.Adopt(pool, 1, Grunt, true, 100, 100, 10.0f + MobContinuity.StaleSeconds + 0.01f, out _), "parking ends after StaleSeconds");
            // A last-delivered dead state is still a Died departure (the body is not faded like one that walked out of sight).
            Assert.AreEqual(DepartureCause.Died, VisionFade.Classify(ActorStatus.Dead, false, true, false));
            Assert.AreEqual(DepartureCause.LeftSight, VisionFade.Classify(ActorStatus.Alive, false, true, false));
        }

        [Test]
        public void An_actor_first_seen_already_dead_enters_at_full_opacity_and_a_living_one_fades_in()
        {
            Assert.AreEqual(1f, VisionFade.EnterStartAlpha(ActorStatus.Dead), 1e-6f);
            Assert.AreEqual(1f, VisionFade.EnterStartAlpha(ActorStatus.Mia), 1e-6f);
            Assert.AreEqual(0f, VisionFade.EnterStartAlpha(ActorStatus.Alive), 1e-6f);
            Assert.AreEqual(1f, VisionFade.EnterAlpha(0f, VisionFade.EnterStartAlpha(ActorStatus.Dead)), 1e-6f, "no fade-in for a body on its first frame");
            Assert.AreEqual(0f, VisionFade.EnterAlpha(0f, VisionFade.EnterStartAlpha(ActorStatus.Alive)), 1e-6f);
        }
    }
}
