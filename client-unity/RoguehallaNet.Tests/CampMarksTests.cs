using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>Camp markers and respawn clocks, pinned to legacy: minimap.ts setCampTimers (:258-270: state 2 and respawnAt &gt; 0,
    /// seconds = max(0, ceil((respawnAt - now) / 1000)), only while the match is active), setCampStates (:298-310: 0 idle,
    /// 1 engaged, 2 cleared), CampWards.ts:19-21 ("RESPAWN Ns" / "RESPAWN READY").</summary>
    public sealed class CampMarksTests
    {
        static readonly MapCamp[] Map = { new MapCamp(640, 960, 80, 1), new MapCamp(3200, 1600, 80, 3), new MapCamp(5000, 4000, 80, 5) };

        static CampView Row(byte state, double respawnAt = 0, bool elite = false) =>
            new CampView { MobType = MobTypeId.EmberImp, Elite = elite ? MobTypeId.EmberImp : (MobTypeId?)null, Alive = state == 2 ? 0u : 3u, State = state, RespawnAt = respawnAt };

        static CampMarkRow[] Marks(CampView[] rows, double now = 1000, bool active = true)
        {
            var into = new List<CampMarkRow>();
            CampMarks.Markers(Map, rows, now, active, into);
            return into.ToArray();
        }

        static CampWorldLabel[] Labels(CampView[] rows, double now, bool active = true)
        {
            var into = new List<CampWorldLabel>();
            CampMarks.WorldLabels(Map, rows, now, active, into);
            return into.ToArray();
        }

        [Test]
        public void OneMarkerPerCampAtTheMapPositionWithItsZone()
        {
            var m = Marks(new[] { Row(0), Row(0), Row(0) });
            Assert.AreEqual(3, m.Length);
            for (int i = 0; i < m.Length; i++)
            {
                Assert.AreEqual(i, m[i].Index);
                Assert.AreEqual((double)Map[i].X, m[i].WorldX);
                Assert.AreEqual((double)Map[i].Y, m[i].WorldY);
                Assert.AreEqual(Map[i].Zone, m[i].Zone);
            }
        }

        [Test]
        public void StatesIdleEngagedClearedAndEliteAreCarried()
        {
            var m = Marks(new[] { Row(1), Row(2, 181000), Row(0, 0, elite: true) });
            Assert.AreEqual(3, m.Length);
            Assert.AreEqual(CampMarkState.Engaged, m[0].State);
            Assert.AreEqual(CampMarkState.Cleared, m[1].State);
            Assert.AreEqual(CampMarkState.Idle, m[2].State);
            Assert.IsFalse(m[0].Elite);
            Assert.IsTrue(m[2].Elite);
        }

        [Test]
        public void ClearedCampCountdownRoundsUpToWholeSeconds()
        {
            var rows = new[] { Row(0), Row(2, 181000), Row(0) };
            Assert.AreEqual(3, Marks(rows, 1000).Length);
            Assert.AreEqual("180", Marks(rows, 1000)[1].Countdown);
            Assert.AreEqual("180", Marks(rows, 1100)[1].Countdown, "179.9 s left rounds up, as Math.ceil");
            Assert.AreEqual("179", Marks(rows, 2000)[1].Countdown);
            Assert.AreEqual("1", Marks(rows, 180999)[1].Countdown);
            Assert.AreEqual("0", Marks(rows, 181000)[1].Countdown, "legacy keeps a 0 clock; it does not vanish");
            Assert.AreEqual("0", Marks(rows, 200000)[1].Countdown, "past the respawn time clamps to 0");
        }

        [Test]
        public void NoCountdownWhenNotClearedWithoutATimeOrOutsideActivePlay()
        {
            var m = Marks(new[] { Row(0, 181000), Row(1, 181000), Row(2, 0) });
            Assert.AreEqual(3, m.Length);
            Assert.IsNull(m[0].Countdown, "idle camp");
            Assert.IsNull(m[1].Countdown, "engaged camp");
            Assert.IsNull(m[2].Countdown, "cleared with respawnAt 0");
            var off = Marks(new[] { Row(0), Row(2, 181000), Row(0) }, 1000, active: false);
            Assert.AreEqual(3, off.Length, "markers are map knowledge and stay");
            Assert.IsNull(off[1].Countdown);
            Assert.AreEqual(CampMarkState.Cleared, off[1].State);
        }

        [Test]
        public void WorldLabelsOnlyForClearedCampsWithATime()
        {
            var rows = new[] { Row(0), Row(2, 181000), Row(2, 0) };
            var l = Labels(rows, 1100);
            Assert.AreEqual(1, l.Length);
            Assert.AreEqual(1, l[0].Index);
            Assert.AreEqual("RESPAWN 180s", l[0].Text);
            Assert.AreEqual((double)Map[1].X, l[0].WorldX);
            Assert.AreEqual((double)Map[1].Y, l[0].WorldY);
            Assert.AreEqual("RESPAWN 179s", Labels(rows, 2000)[0].Text);
            Assert.AreEqual("RESPAWN READY", Labels(rows, 181000)[0].Text);
            Assert.AreEqual("RESPAWN READY", Labels(rows, 190000)[0].Text);
            Assert.AreEqual(0, Labels(rows, 1100, active: false).Length);
        }

        [Test]
        public void ARowCountThatDiffersFromTheMapGivesNoMarkersAndNoException()
        {
            Assert.AreEqual(3, Marks(new[] { Row(0), Row(0), Row(0) }).Length, "control: matching counts draw");
            Assert.DoesNotThrow(() => Assert.AreEqual(0, Marks(new[] { Row(0), Row(2, 5000) }).Length));
            Assert.DoesNotThrow(() => Assert.AreEqual(0, Marks(new[] { Row(0), Row(0), Row(0), Row(0) }).Length));
            Assert.DoesNotThrow(() => Assert.AreEqual(0, Marks(null).Length));
            Assert.DoesNotThrow(() => Assert.AreEqual(0, Marks(new CampView[0]).Length));
            Assert.AreEqual(1, Labels(new[] { Row(0), Row(2, 181000), Row(0) }, 1000).Length, "control: matching counts label");
            Assert.AreEqual(0, Labels(new[] { Row(2, 181000) }, 1000).Length);
        }
    }
}
