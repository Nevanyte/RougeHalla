using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    public sealed class NameStackCapTests
    {
        [Test]
        public void ALabelIsRaisedAtMostThreeLinesAboveItsOwnPosition()
        {
            var items = new NameStackItem[6];
            for (uint i = 0; i < 6; i++) items[i] = new NameStackItem { Id = i, X = 0f, Y = 0f, W = 2f, H = 1f, Dist = i };
            var lift = new float[6];
            NameStack.Separate(items, 6, .1f, lift);
            Assert.That(lift[3], Is.EqualTo(3.3f).Within(1e-4f), "the fourth label sits three lines up");
            Assert.That(lift[4], Is.EqualTo(3.3f).Within(1e-4f), "later labels stay at the cap");
            Assert.That(lift[5], Is.EqualTo(3.3f).Within(1e-4f));
        }
    }
}
