using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>P-UNITY-CAMP-PATIENCE-SHOW-1 review note: a mob that chases the player off its camp's tiles still belongs to that camp.</summary>
    public sealed class CampAttackChaseTests
    {
        [Test]
        public void A_mob_that_chased_off_its_camp_tiles_still_shows_that_camp_when_it_hits()
        {
            var plane = new byte[64]; plane[1 * 8 + 1] = 1;
            var c = new CampAttack();
            c.Update(0, 1, true, new[] { new CampAttackMob(10, 48, 48) }, plane, 8, 8);     // on camp 1's tile
            c.NoteHit(10, 1);
            c.Update(50, 1, true, new[] { new CampAttackMob(10, 200, 200) }, plane, 8, 8);  // now on unowned ground
            Assert.IsTrue(c.IsAttacked(0));
            Assert.IsFalse(c.IsAttacked(1));
        }
    }
}
