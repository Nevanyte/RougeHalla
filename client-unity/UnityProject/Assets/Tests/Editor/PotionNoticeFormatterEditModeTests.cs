using NUnit.Framework;
using Roguehalla.Net;

namespace Roguehalla.Client.Tests
{
    public sealed class PotionNoticeFormatterEditModeTests
    {
        [TestCase(PotionNotice.Stored, "Small potion stored · Heal 25% HP over 5s")]
        [TestCase(PotionNotice.BagFull, "Consumable bag full (5 of each)")]
        [TestCase(PotionNotice.Used, "Small potion · healing over 5s")]
        [TestCase(PotionNotice.Blocked, "Can't use an item now")]
        [TestCase(PotionNotice.Busy, "Already drinking 3 potions")]
        [TestCase(PotionNotice.Full, "Already at full health")]
        [TestCase(PotionNotice.Empty, "No potion stored")]
        [TestCase(PotionNotice.LargeStored, "Camp potion stored · Heal 40% HP over 5s")]
        [TestCase(PotionNotice.LargeUsed, "Camp potion · healing over 5s")]
        [TestCase(PotionNotice.CampBagFull, "Camp cleared · camp potion bag full (5)")]
        public void FormatsEveryServerPotionNotice(PotionNotice notice, string expected)
        {
            Assert.That(PotionNoticeFormatter.Format(notice), Is.EqualTo(expected));
        }

        [Test]
        public void UnknownNoticeUsesNeutralFallback()
        {
            Assert.That(PotionNoticeFormatter.Format((PotionNotice)255), Is.EqualTo("Potion update"));
        }
    }
}
