using System;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    public class UiRouteStateTests
    {
        static MapBlob OpenMap()
        {
            return new MapBlob(5, 5, Enumerable.Repeat(MapBlob.Floor, 25).ToArray());
        }

        static RouteGeometry Geometry(double speed = 100)
        {
            return new RouteGeometry(32, Pathfinder.PlayerRadius, speed);
        }

        [Test]
        public void RouteClampsAtTwelveAndPreviewIsCachedByMapStateAndGeometry()
        {
            var map = OpenMap();
            var route = new RouteState();
            route.SetStart(new RoutePoint(16, 16));
            for (int i = 0; i < RouteState.MaxWaypoints; i++) Assert.IsTrue(route.Add(new RoutePoint(24 + i, 24), map, 32));
            Assert.IsFalse(route.Add(new RoutePoint(40, 40), map, 32));
            var first = route.Plan(map, Geometry());
            Assert.AreSame(first, route.Plan(map, Geometry()));
            Assert.AreNotSame(first, route.Plan(map, Geometry(200)));
            Assert.AreEqual(first.Distance / 100, first.EtaSeconds, 1e-8);
            route.Undo();
            Assert.AreNotSame(first, route.Plan(map, Geometry()));
        }

        [Test]
        public void LoadDropsInvalidRoundsClampsAndCapsAndExportIsDetached()
        {
            var map = OpenMap();
            var route = new RouteState();
            var values = new[] { new RouteWaypoint(double.NaN, 3), new RouteWaypoint(-8.4, 15.6), new RouteWaypoint(999, 999) }
                .Concat(Enumerable.Range(0, 30).Select(i => new RouteWaypoint(20 + i, 20 + i)));
            route.Load(values, map, 32);
            Assert.AreEqual(RouteState.MaxWaypoints, route.Waypoints.Count);
            Assert.AreEqual(new RoutePoint(0, 16), route.Waypoints[0]);
            Assert.AreEqual(new RoutePoint(160, 160), route.Waypoints[1]);
            var export = route.Export();
            export[0] = new RouteWaypoint(100, 100);
            Assert.AreEqual(new RoutePoint(0, 16), route.Waypoints[0]);
        }

        [Test]
        public void ToggleAndAdvanceOnlyAffectUpcomingStopsAndReachedStopsAdvanceSequentially()
        {
            var map = OpenMap();
            var route = new RouteState();
            route.Add(new RoutePoint(40, 40), map, 32);
            route.Add(new RoutePoint(90, 90), map, 32);
            Assert.IsTrue(route.Advance(new RoutePoint(40, 40), 32));
            Assert.AreEqual(1, route.NextIndex);
            Assert.IsTrue(route.ToggleUpcoming(new RoutePoint(95, 90), map, 32));
            Assert.AreEqual(1, route.Waypoints.Count);
            Assert.AreEqual(1, route.NextIndex);
            Assert.IsFalse(route.Advance(new RoutePoint(40, 40), 32));
            route.Restart();
            Assert.IsTrue(route.Advance(new RoutePoint(40, 40), 32));
        }

        [Test]
        public void AheadPlanStartsAtSuppliedPositionAndIncludesOnlyUnreachedStops()
        {
            var map = OpenMap();
            var route = new RouteState();
            route.Add(new RoutePoint(40, 40), map, 32);
            route.Add(new RoutePoint(120, 120), map, 32);
            route.Advance(new RoutePoint(40, 40), 32);
            var ahead = route.PlanAhead(map, Geometry(), new RoutePoint(48, 48));
            Assert.AreEqual(1, ahead.Legs.Count);
            Assert.AreEqual(1, ahead.Legs[0].WaypointIndex);
            Assert.AreEqual(new RoutePoint(48, 48), ahead.Points[0]);
            Assert.AreEqual(2, route.Waypoints.Count);
            Assert.AreEqual(1, route.NextIndex);
        }

        [Test]
        public void PathPreviewReportsUnreachableLegsWithoutDeletingStops()
        {
            var tiles = Enumerable.Repeat(MapBlob.Floor, 25).ToArray();
            for (int y = 0; y < 5; y++) tiles[y * 5 + 2] = MapBlob.Wall;
            var map = new MapBlob(5, 5, tiles);
            var route = new RouteState();
            route.SetStart(new RoutePoint(16, 16));
            route.Add(new RoutePoint(144, 16), map, 32);
            var plan = route.Plan(map, Geometry());
            CollectionAssert.AreEqual(new[] { 0 }, plan.Unreachable);
            Assert.AreEqual(1, route.Waypoints.Count);
        }
    }

    public class UiInputGateTests
    {
        static UiInputContext Run(bool chest = false, bool training = false, bool results = false, bool typing = false, bool panel = false)
        { return new UiInputContext(true, training, results, chest, typing, panel); }

        [Test]
        public void TabIsMomentaryAndOnlyBelongsToEligibleRun()
        {
            var gate = new UiInputGate();
            Assert.AreEqual(UiKeyAction.ShowMap, gate.KeyDown(UiKey.Tab, new UiKeyModifiers(), Run()));
            Assert.IsTrue(gate.MapHeld);
            Assert.AreEqual(UiKeyAction.HideMap, gate.KeyUp(UiKey.Tab));
            Assert.IsFalse(gate.MapHeld);
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyDown(UiKey.Tab, new UiKeyModifiers(shift: true), Run()));
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyDown(UiKey.Tab, new UiKeyModifiers(), Run(training: true)));
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyDown(UiKey.Tab, new UiKeyModifiers(), Run(results: true)));
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyDown(UiKey.Tab, new UiKeyModifiers(), Run(typing: true)));
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyDown(UiKey.Tab, new UiKeyModifiers(), Run(panel: true)));
        }

        [Test]
        public void ToggleModePersistsAcrossKeyUpAndCanBeClosedExplicitly()
        {
            var gate = new UiInputGate { MapToggle = true };
            Assert.AreEqual(UiKeyAction.ShowMap, gate.KeyDown(UiKey.Tab, new UiKeyModifiers(), Run()));
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyUp(UiKey.Tab));
            Assert.IsTrue(gate.MapHeld);
            Assert.AreEqual(UiKeyAction.HideMap, gate.KeyDown(UiKey.Tab, new UiKeyModifiers(), Run()));
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyUp(UiKey.Tab));
            Assert.IsFalse(gate.MapHeld);
        }

        [Test]
        public void BlurAndContextChangeReleaseMomentaryMap()
        {
            var gate = new UiInputGate();
            gate.KeyDown(UiKey.Tab, new UiKeyModifiers(), Run());
            Assert.AreEqual(UiKeyAction.HideMap, gate.Reconcile(Run(results: true)));
            gate.KeyDown(UiKey.Tab, new UiKeyModifiers(), Run());
            gate.WindowBlur();
            Assert.IsFalse(gate.MapHeld);
        }

        [Test]
        public void ChestFocusOwnsDigitsAndTabUntilChoiceOrRelease()
        {
            var gate = new UiInputGate();
            Assert.AreEqual(UiKeyAction.FocusChest, gate.KeyDown(UiKey.C, new UiKeyModifiers(), Run(chest: true)));
            Assert.IsTrue(gate.ChestFocused);
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyDown(UiKey.Tab, new UiKeyModifiers(), Run(chest: true)));
            Assert.AreEqual(UiKeyAction.ChooseChest1, gate.KeyDown(UiKey.Digit2, new UiKeyModifiers(), Run(chest: true)));
            Assert.IsFalse(gate.ChestFocused);
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyDown(UiKey.Digit2, new UiKeyModifiers(), Run(chest: true)));
            Assert.AreEqual(UiKeyAction.FocusChest, gate.KeyDown(UiKey.C, new UiKeyModifiers(), Run(chest: true)));
            Assert.AreEqual(UiKeyAction.ReleaseChest, gate.KeyDown(UiKey.Escape, new UiKeyModifiers(), Run(chest: true)));
        }

        [Test]
        public void ChestCannotTakeFocusFromTypingOrAnotherPanelAndDisappearingChestReleases()
        {
            var gate = new UiInputGate();
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyDown(UiKey.C, new UiKeyModifiers(), Run(chest: true, typing: true)));
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyDown(UiKey.C, new UiKeyModifiers(), Run(chest: true, panel: true)));
            Assert.AreEqual(UiKeyAction.Unhandled, gate.KeyDown(UiKey.C, new UiKeyModifiers(control: true), Run(chest: true)));
            gate.KeyDown(UiKey.C, new UiKeyModifiers(), Run(chest: true));
            gate.Reconcile(Run(chest: false));
            Assert.IsFalse(gate.ChestFocused);
        }
    }

    public class InputSenderPlanTests
    {
        [Test]
        public void PlanWrapperQueuesExistingWireCommandAndPreservesOptionalValues()
        {
            var sender = new InputSender();
            sender.Plan(spawn: 1, boon: 0);
            sender.Plan(ready: true);
            var commands = sender.Flush(0).SelectMany(f => f.Commands).ToArray();
            Assert.AreEqual(2, commands.Length);
            Assert.AreEqual(CommandKind.Plan, commands[0].Kind);
            Assert.AreEqual((byte)1, commands[0].Spawn);
            Assert.AreEqual((byte)0, commands[0].Boon);
            Assert.IsNull(commands[0].Ready);
            Assert.AreEqual(CommandKind.Plan, commands[1].Kind);
            Assert.IsNull(commands[1].Spawn);
            Assert.IsNull(commands[1].Boon);
            Assert.AreEqual(true, commands[1].Ready);
            var roundTrip = new InputSender();
            roundTrip.Plan(spawn: 1, boon: 0, ready: true);
            foreach (var frame in roundTrip.Flush(0))
                Assert.DoesNotThrow(() => ClientMsg.Decode(frame.Encode()));
        }
    }
}
