using NUnit.Framework;

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
    }
}
