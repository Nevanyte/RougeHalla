using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine.InputSystem;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-TRAINING-HUD-1, defects 1 and 3. The real MatchClient, MatchHud and TacticalMapController are driven by a real keyboard
    /// (<see cref="TrainingHudRig"/>). Cause of the vanishing HUD (see the packet): in practice FocusRoot returns the training console's root
    /// (MatchHud.Features.cs:74), so the Tab key's focus walk (MatchHud.Features.cs:304-306) selects the CONSOLE button;
    /// TrainingConsoleView.ContainsFocus then makes TrainingOwnsKeyboard true (MatchHud.Training.cs:22), which makes WorldHudVisible false
    /// (MatchHud.Features.cs:38,44) and RefreshHudElementVisibility hides the plate, champion panel and hotbar while the minimap is
    /// suppressed. Nothing clears the selection, so the HUD stays off.
    /// </summary>
    public sealed class TrainingHudVisibilityEditModeTests
    {
        static readonly HudEvent[] Events = { HudEvent.DrawerOpen, HudEvent.DrawerClose, HudEvent.TabHold, HudEvent.TabRelease, HudEvent.WishCast };

        static IEnumerable<HudEvent[]> Sequences(int maxLength)
        {
            var frontier = new List<HudEvent[]> { new HudEvent[0] };
            for (int length = 1; length <= maxLength; length++)
            {
                var next = new List<HudEvent[]>();
                foreach (var prefix in frontier)
                    foreach (var e in Events)
                        if (!prefix.Contains(e)) next.Add(prefix.Concat(new[] { e }).ToArray());
                foreach (var s in next) yield return s;
                frontier = next;
            }
        }

        static void AssertSame(SortedDictionary<string, bool> before, SortedDictionary<string, bool> after, string what)
        {
            Assert.That(TrainingHudRig.Describe(after), Is.EqualTo(TrainingHudRig.Describe(before)),
                what + ": a HUD panel shown before is hidden after (the HUD vanished)");
        }

        [Test]
        public async Task InPracticeAHeldAndReleasedTabLeavesEveryHudPanelShown()
        {
            using (var rig = await TrainingHudRig.Start(practice: true))
            {
                var before = rig.Panels();
                Assert.That(before.Values.Any(on => on), Is.True, "set-up: the in-match HUD shows panels: " + TrainingHudRig.Describe(before));
                rig.Hold(Key.Tab); rig.Let(Key.Tab);
                AssertSame(before, rig.Panels(), "after holding and releasing Tab in practice");
            }
        }

        [Test]
        public async Task InPracticeTabOpensNoMapLikeLegacyAndNothingHidesTheHud()
        {
            // Legacy: packages/client/src/ui/mapHold.ts:38-39, mapHoldAllowed is false when state.training is true, so Tab is not taken for the
            // map in practice. The brief's other option (a one-line "No map in practice") is not legacy; the map stays closed.
            using (var rig = await TrainingHudRig.Start(practice: true))
            {
                var before = rig.Panels();
                rig.Hold(Key.Tab);
                Assert.That(rig.MapOpen, Is.False, "legacy takes no Tab map in practice");
                AssertSame(before, rig.Panels(), "while Tab is down in practice");
                rig.Let(Key.Tab);
                Assert.That(rig.MapOpen, Is.False);
                AssertSame(before, rig.Panels(), "after Tab is released in practice");
            }
        }

        [Test]
        public async Task InTheArenaTabOpensTheMapAndReleasingItRestoresTheHud()
        {
            using (var rig = await TrainingHudRig.Start(practice: false))
            {
                var before = rig.Panels();
                rig.Hold(Key.Tab);
                Assert.That(rig.MapOpen, Is.True, "arena Tab is the map hold");
                rig.Let(Key.Tab);
                Assert.That(rig.MapOpen, Is.False);
                AssertSame(before, rig.Panels(), "after the arena map is released");
            }
        }

        [Test]
        public async Task InTheArenaNoOrderingOfDrawerTabMapAndWishLeavesAHudPanelHidden()
        {
            using (var rig = await TrainingHudRig.Start(practice: false)) RunAll(rig, "arena");
        }

        [Test]
        public async Task InPracticeNoOrderingOfDrawerTabMapAndWishLeavesAHudPanelHidden()
        {
            using (var rig = await TrainingHudRig.Start(practice: true)) RunAll(rig, "practice");
        }

        static void RunAll(TrainingHudRig rig, string room)
        {
            var before = rig.Panels();
            Assert.That(before.Values.Any(on => on), Is.True, "set-up: the in-match HUD shows panels: " + TrainingHudRig.Describe(before));
            var failures = new List<string>();
            int count = 0;
            foreach (var sequence in Sequences(5))
            {
                count++;
                rig.ClickAway();
                foreach (var e in sequence) rig.Do(e);
                rig.Settle();
                var after = rig.Panels();
                if (TrainingHudRig.Describe(after) != TrainingHudRig.Describe(before))
                    failures.Add(string.Join(" > ", sequence) + " => " + TrainingHudRig.Describe(after));
            }
            Assert.That(count, Is.EqualTo(325), "5 + 20 + 60 + 120 + 120 orderings of length 1 to 5");
            Assert.That(failures, Is.Empty, room + ": " + failures.Count + " of " + count + " sequences leave a panel hidden (before: " +
                TrainingHudRig.Describe(before) + "); first: " + string.Join(" | ", failures.Take(5)));
        }
    }
}
