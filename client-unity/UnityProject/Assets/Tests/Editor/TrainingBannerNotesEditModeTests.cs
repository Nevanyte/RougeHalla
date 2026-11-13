using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-TRAINING-BANNER-1 review notes: leaving practice restores the arena plate; a confirmation with no state change still shows the banner.</summary>
    public sealed class TrainingBannerNotesEditModeTests
    {
        const string LegacyBanner = "TRAINING — nothing here is recorded: no GV, no stats";
        const BindingFlags Any = BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public;

        static void Settle(TrainingHudRig rig) { for (int i = 0; i < 4; i++) rig.Frame(); }
        static void Set(object target, string name, object value)
        {
            var f = target.GetType().GetField(name, Any);
            Assert.That(f, Is.Not.Null, "missing field " + name);
            f.SetValue(target, value);
        }
        static TMP_Text Label(TrainingHudRig rig, string field) => (TMP_Text)TrainingHudRig.GetField(rig.Hud, field);

        [Test]
        public async Task PracticeThenArenaInTheSameHudRestoresTheThreeRowPlate()
        {
            using (var rig = await TrainingHudRig.Start(practice: true))
            {
                Settle(rig);
                var plate = (RectTransform)TrainingHudRig.GetField(rig.Hud, "_vitalsPanel");
                float practiceHeight = plate.sizeDelta.y;
                Assert.That(Label(rig, "_plateStatus").text, Is.EqualTo(LegacyBanner), "set-up: practice shows the banner");
                Assert.That(Label(rig, "_combatStats").gameObject.activeSelf, Is.False, "set-up: no Kills/GV row in practice");

                // The same HUD joins an arena room: a new owned join through the rig's fake transport (rig.Join asserts the mode is confirmed).
                rig.Client.Leave();
                Set(rig, "<Practice>k__BackingField", false);
                Set(rig, "_transport", null);
                await (Task)TrainingHudRig.Call(rig, "Join");
                Settle(rig);
                Assert.That(rig.Client.ConfirmedPractice, Is.False, "set-up: the room is the arena now");
                // The rig's snapshots are Active; put the plate in the non-active mode (lobby, planning, ended) as the arena guard of the oracle does.
                TrainingHudRig.Call(rig.Hud, "SetPlateMode", false);
                var stats = Label(rig, "_combatStats");
                Assert.That(stats.gameObject.activeInHierarchy, Is.True, "the Kills/GV row is active again");
                Assert.That(stats.text, Does.StartWith("Kills "));
                Assert.That(Label(rig, "_plateStatus").text, Is.Not.EqualTo(LegacyBanner), "the banner is gone");
                Assert.That(plate.sizeDelta.y, Is.EqualTo(59f).Within(.01f), "three rows again");
                Assert.That(plate.sizeDelta.y, Is.GreaterThan(practiceHeight));
            }
        }

        [Test]
        public async Task AConfirmationThatChangesNoStateStillEndsWithTheBannerOnThePlate()
        {
            using (var rig = await TrainingHudRig.Start(practice: true))
            {
                Settle(rig);
                // Un-confirm the launch (the plate then reads the pending text), then confirm it again with State, phase and reconnect count unchanged.
                Set(rig.Client, "_modeConfirmed", false);
                Set(rig.Hud, "_dirty", true);
                TrainingHudRig.Call(rig.Hud, "LateUpdate");
                Assert.That(rig.Client.LaunchPending, Is.True, "set-up: launch pending");
                Assert.That(Label(rig, "_plateStatus").text, Does.StartWith("Verifying"), "set-up: plate shows the pending text");
                Set(rig.Client, "_modeConfirmed", true);
                Set(rig.Hud, "_dirty", true);
                TrainingHudRig.Call(rig.Hud, "LateUpdate");
                Assert.That(rig.Client.ConfirmedPractice, Is.True, "set-up: confirmed practice");
                Assert.That(Label(rig, "_plateStatus").text, Is.EqualTo(LegacyBanner));
            }
        }
    }
}
