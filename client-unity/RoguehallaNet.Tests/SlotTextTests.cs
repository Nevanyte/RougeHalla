using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// P-UNITY-HUD-STATUS-1, loose proof against packages/client/src/ui/abilitySlot.ts formatCooldown (:129-133), castDenial (:149),
    /// the badge (:286-288) and weaponBar.ts :145-148. Legacy counts whole seconds under a minute ("9", not "0:09") and uses
    /// "m:ss" from 60 s; seconds round up. Healing and wind-emblem end times are NOT on the wire (only counts), so the end-time forms are
    /// pinned as functions and the Unity call site keeps count-only text until the wire carries them.
    /// </summary>
    public sealed class SlotTextTests
    {
        [Test] public void Cooldown_seconds_round_up_and_switch_to_minutes_at_sixty()
        {
            Assert.AreEqual("", SlotText.Cooldown(0));
            Assert.AreEqual("", SlotText.Cooldown(-500));
            Assert.AreEqual("1", SlotText.Cooldown(1));
            Assert.AreEqual("9", SlotText.Cooldown(8001));
            Assert.AreEqual("9", SlotText.Cooldown(9000));
            Assert.AreEqual("59", SlotText.Cooldown(59000));
            Assert.AreEqual("1:00", SlotText.Cooldown(59001));
            Assert.AreEqual("1:00", SlotText.Cooldown(60000));
            Assert.AreEqual("2:05", SlotText.Cooldown(125000));
        }
        [Test] public void A_cooling_ability_reads_ready_in_and_a_ready_one_reads_nothing()
        {
            Assert.AreEqual("Ready in 9", SlotText.ReadyIn(9000));
            Assert.AreEqual("Ready in 2:05", SlotText.ReadyIn(125000));
            Assert.AreEqual("", SlotText.ReadyIn(0));
        }
        [Test] public void The_charge_badge_shows_only_for_a_multi_charge_ability()
        {
            Assert.AreEqual("2", SlotText.ChargeBadge(2, 3));
            Assert.AreEqual("0", SlotText.ChargeBadge(0, 2));
            Assert.AreEqual("", SlotText.ChargeBadge(1, 1));
        }
        [Test] public void Potion_counts_read_large_then_small()
        {
            Assert.AreEqual("2 large · 1 small", SlotText.PotionCounts(2, 1, true));
            Assert.AreEqual("— large · — small", SlotText.PotionCounts(0, 0, false), "no inventory delivered: today's Unity text");
        }
        [Test] public void Healing_reads_the_count_and_the_seconds_left_when_the_end_is_known()
        {
            Assert.AreEqual("Healing 5s", SlotText.HealingStatus(1, 6000, 1000));
            Assert.AreEqual("Healing x2 5s", SlotText.HealingStatus(2, 5001, 1000));
            Assert.AreEqual("", SlotText.HealingStatus(2, 1000, 1000), "legacy shows it only while healingUntil > now");
        }
        [Test] public void Healing_without_a_delivered_end_keeps_the_count_only_text()
        {
            Assert.AreEqual("Healing", SlotText.HealingStatus(1, null, 1000));
            Assert.AreEqual("Healing x3", SlotText.HealingStatus(3, null, 1000));
            Assert.AreEqual("", SlotText.HealingStatus(0, null, 1000));
        }
        [Test] public void The_wind_emblem_reads_active_seconds_or_asks_for_an_emblem()
        {
            Assert.AreEqual("+50% speed", SlotText.SpeedLabel(6000, 1000));
            Assert.AreEqual("Active 5s", SlotText.SpeedStatus(6000, 1000));
            Assert.AreEqual("Active 1s", SlotText.SpeedStatus(1001, 1000));
            Assert.AreEqual("Walk over emblems", SlotText.SpeedLabel(1000, 1000));
            Assert.AreEqual("", SlotText.SpeedStatus(0, 1000));
        }
    }
}
