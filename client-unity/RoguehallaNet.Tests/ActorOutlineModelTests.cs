using NUnit.Framework;
using Roguehalla.Client;

namespace Roguehalla.Net.Tests
{
    /// <summary>The polarity rule of the adaptive actor outline (docs/rework/CONTRAST_GATE.md): the stroke is chosen against the ground behind it.</summary>
    public class ActorOutlineModelTests
    {
        [Test] public void TheTwoStrokeColoursAreFarEnoughApart()
        {
            // Nominal colours: the worst case of a perfect hard choice is sqrt((Ll + .05) / (Ld + .05)).
            Assert.GreaterOrEqual(ActorOutlineModel.WorstRatio(), 4.0f);
            Assert.GreaterOrEqual(ActorOutlineModel.Ratio(ActorOutlineModel.LightLuma, 0f), 15f);
        }

        [Test] public void TheChosenStrokeBeatsThreeToOneOnEveryGroundOutsideTheDeadZone()
        {
            for (float l = 0f; l <= 1.0001f; l += .001f)
            {
                if (System.Math.Abs(l - ActorOutlineModel.Threshold) <= ActorOutlineModel.DeadZone) continue;
                foreach (bool previous in new[] { false, true })
                    Assert.GreaterOrEqual(ActorOutlineModel.StrokeRatio(l, previous), 3.0f, "ground " + l + " previous " + previous);
            }
        }

        [Test] public void InsideTheDeadZoneTheWorstCaseStaysAboveTwoPointEight()
        {
            for (float l = ActorOutlineModel.Threshold - ActorOutlineModel.DeadZone; l <= ActorOutlineModel.Threshold + ActorOutlineModel.DeadZone; l += .001f)
                foreach (bool previous in new[] { false, true })
                    Assert.GreaterOrEqual(ActorOutlineModel.StrokeRatio(l, previous), 2.8f, "ground " + l);
        }

        [Test] public void FourPointFiveHoldsAwayFromTheFlip()
        {
            for (float l = 0f; l <= 1.0001f; l += .001f)
            {
                if (System.Math.Abs(l - ActorOutlineModel.Threshold) <= ActorOutlineModel.DeadZone + .06f) continue;
                Assert.GreaterOrEqual(ActorOutlineModel.StrokeRatio(l, false), 4.5f, "ground " + l);
                Assert.GreaterOrEqual(ActorOutlineModel.StrokeRatio(l, true), 4.5f, "ground " + l);
            }
        }

        [Test] public void ChoiceIsHardAndStable()
        {
            float t = ActorOutlineModel.Threshold, dz = ActorOutlineModel.DeadZone;
            Assert.IsTrue(ActorOutlineModel.ChooseLight(.02f, false)); Assert.IsFalse(ActorOutlineModel.ChooseLight(.8f, true));
            Assert.IsTrue(ActorOutlineModel.ChooseLight(t - dz - .001f, false));
            Assert.IsFalse(ActorOutlineModel.ChooseLight(t + dz + .001f, true));
            // inside the dead zone the previous choice stays, in both directions: no flicker on a boundary
            Assert.IsTrue(ActorOutlineModel.ChooseLight(t, true)); Assert.IsFalse(ActorOutlineModel.ChooseLight(t, false));
            // a ground walking through the whole range flips exactly once
            int flips = 0; bool light = true;
            for (float l = 0f; l <= 1f; l += .001f) { bool next = ActorOutlineModel.ChooseLight(l, light); if (next != light) flips++; light = next; }
            Assert.AreEqual(1, flips);
        }

        [Test] public void TheMeasuredThresholdSitsBetweenTheNominalAndTheLiftedCrossover()
        {
            float nominal = ActorOutlineModel.Crossover(), lifted = ActorOutlineModel.Crossover(ActorOutlineModel.LiftedDarkLuma, ActorOutlineModel.LightLuma);
            Assert.Less(nominal, ActorOutlineModel.Threshold); Assert.Less(ActorOutlineModel.Threshold, lifted);
            Assert.AreEqual(ActorOutlineModel.WorstRatio(), ActorOutlineModel.Ratio(ActorOutlineModel.DarkLuma, nominal), 1e-3);
        }

        [Test] public void PlainBlackAndWhiteGiveTheTaskArithmetic()
        {
            // Black against ground L: (L + .05) / .05; white: 1.05 / (L + .05). They agree at L = .179.
            Assert.AreEqual(.179f, ActorOutlineModel.Crossover(0f, 1f), .002f);
            Assert.AreEqual(4.58f, ActorOutlineModel.WorstRatio(0f, 1f), .02f);
        }

        [Test] public void StateAlphaFollowsDeadAndHidden()
        {
            Assert.AreEqual(1f, ActorOutlineModel.StateAlpha(false, 1f));
            Assert.AreEqual(.6f, ActorOutlineModel.StateAlpha(true, 1f), 1e-5);
            Assert.AreEqual(.35f, ActorOutlineModel.StateAlpha(false, .35f), 1e-5);
            Assert.AreEqual(0f, ActorOutlineModel.StateAlpha(false, -1f));
        }

        [Test] public void PadFractionLeavesRoomForTheStroke()
        {
            Assert.Greater(ActorOutlineModel.PadFraction(ActorOutlineModel.Width, 1.9f), ActorOutlineModel.Width / 1.9f);
            Assert.AreEqual(0f, ActorOutlineModel.PadFraction(.05f, 0f));
        }

        [Test] public void EstimateIsMonotoneInTheBase()
        {
            Assert.Less(ActorOutlineModel.EstimateLit(.1f, .5f, .3f), ActorOutlineModel.EstimateLit(.2f, .5f, .3f));
            Assert.AreEqual(0f, ActorOutlineModel.EstimateLit(-1f, .5f, .3f));
        }
    }
}
