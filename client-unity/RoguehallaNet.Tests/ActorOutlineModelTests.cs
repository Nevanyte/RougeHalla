using NUnit.Framework;
using Roguehalla.Client;

namespace Roguehalla.Net.Tests
{
    /// <summary>The polarity rule of the adaptive actor outline (docs/rework/CONTRAST_GATE.md): the stroke is chosen against the ground behind it.</summary>
    public class ActorOutlineModelTests
    {
        [Test] public void ChosenStrokeNeverFallsBelowTheWorstCaseOnAnyGround()
        {
            float worst = ActorOutlineModel.WorstRatio();
            Assert.GreaterOrEqual(worst, 4.2f, "the two stroke colours must be far enough apart for the crossover to stay above 4.2:1");
            for (float l = 0f; l <= 1.0001f; l += .0025f)
                foreach (bool previous in new[] { false, true })
                    Assert.GreaterOrEqual(ActorOutlineModel.StrokeRatio(l, previous), worst * .93f, "ground " + l + " previous " + previous);
        }

        [Test] public void ThreeToOneHoldsOnEveryGroundWhateverTheDeadZoneKept()
        {
            for (float l = 0f; l <= 1.0001f; l += .001f)
                foreach (bool previous in new[] { false, true })
                    Assert.GreaterOrEqual(ActorOutlineModel.StrokeRatio(l, previous), 3.0f, "ground " + l);
        }

        [Test] public void FourPointFiveHoldsAwayFromTheCrossoverBand()
        {
            float t = ActorOutlineModel.Crossover();
            for (float l = 0f; l <= 1.0001f; l += .001f)
            {
                if (System.Math.Abs(l - t) <= .035f) continue;     // the band where neither stroke can exceed its worst case
                Assert.GreaterOrEqual(ActorOutlineModel.StrokeRatio(l, false), 4.5f, "ground " + l);
                Assert.GreaterOrEqual(ActorOutlineModel.StrokeRatio(l, true), 4.5f, "ground " + l);
            }
        }

        [Test] public void ChoiceIsHardAndStable()
        {
            float t = ActorOutlineModel.Crossover();
            Assert.IsTrue(ActorOutlineModel.ChooseLight(.02f, false)); Assert.IsFalse(ActorOutlineModel.ChooseLight(.6f, true));
            Assert.IsTrue(ActorOutlineModel.ChooseLight(t - ActorOutlineModel.DeadZone - .001f, false));
            Assert.IsFalse(ActorOutlineModel.ChooseLight(t + ActorOutlineModel.DeadZone + .001f, true));
            // inside the dead zone the previous choice stays, in both directions: no flicker on a boundary
            Assert.IsTrue(ActorOutlineModel.ChooseLight(t, true)); Assert.IsFalse(ActorOutlineModel.ChooseLight(t, false));
            // a ground walking through the whole range flips exactly once each way
            int flips = 0; bool light = true;
            for (float l = 0f; l <= 1f; l += .001f) { bool next = ActorOutlineModel.ChooseLight(l, light); if (next != light) flips++; light = next; }
            Assert.AreEqual(1, flips);
        }

        [Test] public void CrossoverIsWhereBothStrokesAgree()
        {
            float t = ActorOutlineModel.Crossover();
            Assert.AreEqual(ActorOutlineModel.Ratio(ActorOutlineModel.DarkLuma, t), ActorOutlineModel.Ratio(ActorOutlineModel.LightLuma, t), 1e-3);
            Assert.AreEqual(ActorOutlineModel.WorstRatio(), ActorOutlineModel.Ratio(ActorOutlineModel.DarkLuma, t), 1e-3);
            Assert.That(t, Is.InRange(.1f, .25f));
        }

        [Test] public void PlainBlackAndWhiteGiveTheSpecifiedCrossover()
        {
            // Black against ground L: (L + .05) / .05; white: 1.05 / (L + .05). They agree at L = .179 (the task's arithmetic).
            float t = ActorOutlineModel.Crossover(0f, 1f);
            Assert.AreEqual(.179f, t, .002f);
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
