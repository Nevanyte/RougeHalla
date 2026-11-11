using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>Tall props fade for a visible actor behind the upper body or inside the footprint; world y is north, so a smaller y is in front.</summary>
    public sealed class PropFadeTests
    {
        // A prop at (10, 5), half-width 0.6, 3 tall, footprint reaching 0.5 south of the base.
        const float FX = 10f, FY = 5f, HalfW = .6f, H = 3f, Depth = .5f;

        static float Alpha(params float[] xy)
        {
            int n = xy.Length / 2; var xs = new float[n]; var ys = new float[n];
            for (int i = 0; i < n; i++) { xs[i] = xy[2 * i]; ys[i] = xy[2 * i + 1]; }
            return PropFade.TargetAlpha(FX, FY, HalfW, H, Depth, xs, ys, n);
        }

        [Test] public void TheNamedConstantsAreThePinnedProposal()
        {
            Assert.That(PropFade.FadedAlpha, Is.EqualTo(.18f), "proposal for the owner to tune");
            Assert.That(PropFade.HorizontalMargin, Is.EqualTo(.5f), "half a tile");
            Assert.That(PropFade.FadeRate, Is.EqualTo(9f), "speed unchanged from RegionProps.FadeRate");
        }

        [Test] public void AnActorBehindTheUpperBodyFadesTheProp() => Assert.That(Alpha(FX, FY + 1.5f), Is.EqualTo(PropFade.FadedAlpha));

        [Test] public void TheFadeAreaIsWiderThanTheOldHalfWidthPlusPointThreeFive()
            => Assert.That(Alpha(FX + HalfW + .45f, FY + 1.5f), Is.EqualTo(PropFade.FadedAlpha), "inside the new margin, outside the old one");

        [Test] public void AnActorInsideTheFootprintFadesTheProp()
            => Assert.That(Alpha(FX + .2f, FY - .25f), Is.EqualTo(PropFade.FadedAlpha), "walk-through: standing in the base must not be hidden");

        [Test] public void AnActorInFrontBesideOrAboveDoesNotFade()
        {
            Assert.That(Alpha(FX, FY - Depth - .6f), Is.EqualTo(1f), "in front, clear of the footprint");
            Assert.That(Alpha(FX + HalfW + PropFade.HorizontalMargin + .1f, FY + 1.5f), Is.EqualTo(1f), "beside, past the margin");
            Assert.That(Alpha(FX, FY + H + .5f), Is.EqualTo(1f), "behind but above the sprite");
        }

        [Test] public void NoActorsGivesFullAlpha()
        {
            Assert.That(PropFade.TargetAlpha(FX, FY, HalfW, H, Depth, new float[0], new float[0], 0), Is.EqualTo(1f));
        }

        [Test] public void OnlyTheFirstCountActorsCountSoAnUnseenActorCannotFade()
        {
            var xs = new[] { FX + 30f, FX }; var ys = new[] { FY, FY + 1.5f };   // the second is behind the prop but not passed
            Assert.That(PropFade.TargetAlpha(FX, FY, HalfW, H, Depth, xs, ys, 1), Is.EqualTo(1f));
        }
    }
}
