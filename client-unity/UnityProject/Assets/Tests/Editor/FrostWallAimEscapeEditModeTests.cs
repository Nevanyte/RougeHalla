using System;
using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine.InputSystem;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-FROST-WALL-1 review note 1: an Esc that only cancels the Frost Wall aim must not also leave a practice room (or close
    /// the map or a panel); with no aim open Esc behaves as before. Uses the Training integration fixture through reflection (it is a
    /// private nested class of an existing test), and opens the aim directly through MatchClient.WishAim because the wire does not
    /// carry a Wall Welcome on this base.
    /// </summary>
    public sealed class FrostWallAimEscapeEditModeTests
    {
        const BindingFlags Any = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        static readonly Type FixtureType = typeof(TrainingConsoleIntegrationEditModeTests).GetNestedType("Fixture", BindingFlags.NonPublic);

        static object Call(object f, string name, params object[] args) { return FixtureType.GetMethod(name, Any).Invoke(f, args); }
        static T Member<T>(object f, string name)
        {
            var fi = FixtureType.GetField(name, Any); if (fi != null) return (T)fi.GetValue(f);
            return (T)FixtureType.GetProperty(name, Any).GetValue(f);
        }

        static WishAimFrame Wall()
        {
            return new WishAimFrame { Wish = FrostWishKind.Wall, HasGroundPoint = true, CursorX = 420, CursorY = 320, CasterX = 320, CasterY = 320,
                Numbers = new FrostWallNumbers(450, 64, 224, 4000, 24, 8) };
        }

        [Test]
        public async Task AnEscapeThatClosesTheAimDoesNotLeaveTrainingAndALaterOneStillDoes()
        {
            var f = Activator.CreateInstance(FixtureType, true);
            try
            {
                await (Task)Call(f, "JoinReady", MatchLaunchMode.Training);
                Call(f, "Welcome"); Call(f, "Snapshot", true, 1u, 50.0);
                var client = Member<MatchClient>(f, "Client"); var hud = Member<MatchHud>(f, "Hud");
                var session = client.Session;
                Assert.That(Member<TrainingConsoleView>(f, "Console").SetOpen(true), Is.True);
                Call(f, "Press", (object)new[] { Key.Escape }); client.ReadAimEscape(); hud.ReadUiInput();
                Assert.That(client.EscapeConsumedByAim, Is.False, "no aim open: Esc is not the aim's");
                Assert.That(client.Session, Is.SameAs(session)); // this one closed the console
                Call(f, "ReleaseKeys");

                client.WishAim.Key(session, Wall());
                Assert.That(client.WishAim.Aiming, Is.True);
                Call(f, "Press", (object)new[] { Key.Escape }); client.ReadAimEscape(); hud.ReadUiInput();
                Assert.That(client.EscapeConsumedByAim, Is.True);
                Assert.That(client.WishAim.Aiming, Is.False, "the Esc closed the aim");
                Assert.That(client.Session, Is.SameAs(session), "and did not leave the practice room");
                Call(f, "ReleaseKeys");

                Call(f, "Press", (object)new[] { Key.Escape }); client.ReadAimEscape(); hud.ReadUiInput();
                Assert.That(client.EscapeConsumedByAim, Is.False);
                Assert.That(client.Session, Is.Null, "with no aim open a bare Esc leaves the practice room as before");
            }
            finally { ((IDisposable)f).Dispose(); }
        }
    }
}
