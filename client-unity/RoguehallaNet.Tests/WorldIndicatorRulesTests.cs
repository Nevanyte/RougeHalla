using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    public class WorldIndicatorRulesTests
    {
        [Test] public void Vignette_decays_linearly_to_nothing_after_350_ms()
        {
            Assert.AreEqual(.5f, WorldIndicatorRules.VignetteDecayed(1f, 175f), 1e-4f);
            Assert.AreEqual(0f, WorldIndicatorRules.VignetteDecayed(1f, 350f), 1e-4f);
            Assert.AreEqual(0f, WorldIndicatorRules.VignetteDecayed(0f, 0f));
            Assert.AreEqual(.8f, WorldIndicatorRules.VignetteDecayed(.8f, -40f), 1e-4f);
        }

        [Test] public void Overlapping_hits_keep_the_stronger_pulse()
        {
            var p = new WorldIndicatorRules.Pulse();
            p.Hit(.9f, 0f); p.Hit(.3f, 175f);   // .9 has decayed to .45 when the weaker hit lands
            Assert.AreEqual(.45f, p.Value(175f), 1e-3f);
            p.Hit(.8f, 200f);
            Assert.AreEqual(.8f, p.Value(200f), 1e-4f);
        }

        [Test] public void Ring_steps_drain_over_fifteen_seconds_in_quarter_seconds()
        {
            Assert.AreEqual(60, WorldIndicatorRules.RingStep(15f));
            Assert.AreEqual(60, WorldIndicatorRules.RingStep(99f));
            Assert.AreEqual(30, WorldIndicatorRules.RingStep(7.5f));
            Assert.AreEqual(1, WorldIndicatorRules.RingStep(.01f));
            Assert.AreEqual(0, WorldIndicatorRules.RingStep(0f));
            Assert.AreEqual(0, WorldIndicatorRules.RingStep(-3f));
            Assert.AreEqual(30, WorldIndicatorRules.RingStep(15f, 30f));
        }

        [Test] public void The_ring_turns_urgent_in_the_last_five_seconds_and_the_chest_fades_in_the_last_half_second()
        {
            Assert.IsFalse(WorldIndicatorRules.Urgent(5.01f)); Assert.IsTrue(WorldIndicatorRules.Urgent(5f));
            Assert.AreEqual(1f, WorldIndicatorRules.RewardAlpha(.5f)); Assert.AreEqual(.5f, WorldIndicatorRules.RewardAlpha(.25f), 1e-4f); Assert.AreEqual(0f, WorldIndicatorRules.RewardAlpha(-1f));
        }

        [Test] public void Seconds_text_shows_only_when_near_and_time_remains()
        {
            Assert.AreEqual("12s", WorldIndicatorRules.SecondsText(11.2f, true));
            Assert.AreEqual("1s", WorldIndicatorRules.SecondsText(.1f, true));
            Assert.IsNull(WorldIndicatorRules.SecondsText(11.2f, false));
            Assert.IsNull(WorldIndicatorRules.SecondsText(0f, true));
            Assert.IsTrue(WorldIndicatorRules.Near(191f, 0f)); Assert.IsFalse(WorldIndicatorRules.Near(193f, 0f));
        }

        [Test] public void The_drop_cue_runs_450_ms()
        {
            Assert.AreEqual(0f, WorldIndicatorRules.DropCue(0f)); Assert.AreEqual(.5f, WorldIndicatorRules.DropCue(225f), 1e-4f);
            Assert.AreEqual(-1f, WorldIndicatorRules.DropCue(450f)); Assert.AreEqual(-1f, WorldIndicatorRules.DropCue(-1f));
        }

        [Test] public void The_death_x_holds_a_quarter_of_its_two_seconds_then_fades()
        {
            Assert.AreEqual(1f, WorldIndicatorRules.DecalAlpha(0f)); Assert.AreEqual(1f, WorldIndicatorRules.DecalAlpha(500f));
            Assert.AreEqual(.5f, WorldIndicatorRules.DecalAlpha(1250f), 1e-3f);
            Assert.AreEqual(0f, WorldIndicatorRules.DecalAlpha(2000f)); Assert.AreEqual(0f, WorldIndicatorRules.DecalAlpha(-5f));
        }

        [Test] public void Container_labels_follow_the_legacy_rule()
        {
            Assert.AreEqual("Ash", WorldIndicatorRules.ContainerLabel(3, false, -1, "Ash", null, false, 0), "bodies always");
            Assert.AreEqual("Body", WorldIndicatorRules.ContainerLabel(3, false, -1, null, null, false, 0));
            Assert.IsNull(WorldIndicatorRules.ContainerLabel(2, false, -1, null, null, false, 0), "a chest names itself only when focused");
            Assert.AreEqual("Chest", WorldIndicatorRules.ContainerLabel(2, true, -1, null, null, false, 0));
            Assert.AreEqual("Axe", WorldIndicatorRules.ContainerLabel(1, true, 4, null, null, false, 0));
            Assert.AreEqual("Weapon", WorldIndicatorRules.ContainerLabel(1, true, -1, null, null, false, 0));
            Assert.AreEqual("Corpse", WorldIndicatorRules.ContainerLabel(4, true, -1, null, null, false, 0));
            Assert.AreEqual("Cannon · reloading 4s", WorldIndicatorRules.ContainerLabel(6, true, -1, null, null, true, 4));
            Assert.AreEqual("Travel cannon · F to blast", WorldIndicatorRules.ContainerLabel(6, true, -1, null, null, false, 0));
            Assert.IsNull(WorldIndicatorRules.ContainerLabel(7, true, -1, null, null, false, 0));
        }

        [Test] public void Multipliers_print_two_decimals_and_survive_garbage()
        {
            Assert.AreEqual("x1.25", WorldIndicatorRules.Multiplier(1250)); Assert.AreEqual("x1.00", WorldIndicatorRules.Multiplier(double.NaN));
            Assert.AreEqual("x0.80", WorldIndicatorRules.Multiplier(800));
        }
    }
}
