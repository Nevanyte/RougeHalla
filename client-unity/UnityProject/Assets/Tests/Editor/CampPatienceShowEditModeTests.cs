using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-UNITY-CAMP-PATIENCE-SHOW-1 oracle (owner direction 2026-11-14): the outlines object draws a camp only while that camp is attacked.
    /// The decision itself is pinned engine-free in RoguehallaNet.Tests/CampAttackTests.cs.</summary>
    public sealed class CampPatienceShowEditModeTests
    {
        sealed class Attacked : ICampAttacked
        {
            public readonly HashSet<int> On = new HashSet<int>();
            public bool IsAttacked(int campIndex) { return On.Contains(campIndex); }
        }

        GameObject _root;
        [SetUp] public void SetUp() { ShowcaseSprites.Initialize(); _root = new GameObject("camp patience show test"); }
        [TearDown] public void TearDown() { Object.DestroyImmediate(_root); }

        // 8 x 8: camp 1 owns tiles (1,1),(2,1); camp 2 owns (5,5).
        static MapBlob Map()
        {
            var plane = new byte[64];
            plane[1 * 8 + 1] = 1; plane[1 * 8 + 2] = 1; plane[5 * 8 + 5] = 2;
            var camps = new[] { new MapCamp(64, 64, 96, 1), new MapCamp(176, 176, 96, 1) };
            return new MapBlob(8, 8, new byte[64]).WithPublic(camps, null, null, null, null, plane);
        }

        static List<CampView> Camps(uint a, uint b) => new List<CampView> { new CampView { Alive = a }, new CampView { Alive = b } };

        /// <summary>Active line and label objects under the outlines root: what the player would see.</summary>
        int ActiveObjects()
        {
            int n = 0;
            foreach (Transform t in _root.transform) if (t.gameObject.activeSelf) n++;
            return n;
        }

        [Test]
        public void No_attacked_camp_draws_nothing()
        {
            var o = new CampPatienceOutlines(_root.transform);
            var a = new Attacked();
            for (int i = 0; i < 3; i++) o.Update(Map(), Camps(2, 3), MatchPhase.Active, false, a);
            Assert.AreEqual(0, o.Shown, "two living camps with tiles, neither attacked");
            Assert.IsFalse(o.IsShown(0)); Assert.IsFalse(o.IsShown(1));
            Assert.IsNull(o.LabelAt(0));
            Assert.AreEqual(0, ActiveObjects(), "no line or label object is active");
        }

        [Test]
        public void A_null_attacked_source_draws_nothing_and_throws_nothing()
        {
            var o = new CampPatienceOutlines(_root.transform);
            Assert.DoesNotThrow(() => o.Update(Map(), Camps(2, 3), MatchPhase.Active, false, null));
            Assert.AreEqual(0, o.Shown);
            Assert.AreEqual(0, ActiveObjects());
        }

        [Test]
        public void Only_the_attacked_camp_is_drawn_and_it_follows_the_source_each_frame()
        {
            var o = new CampPatienceOutlines(_root.transform);
            var a = new Attacked(); var map = Map();
            a.On.Add(0);
            o.Update(map, Camps(2, 3), MatchPhase.Active, false, a);
            Assert.IsTrue(o.IsShown(0)); Assert.IsFalse(o.IsShown(1));
            Assert.AreEqual("PATIENCE RANGE", o.LabelAt(0), "the look is unchanged");
            Assert.AreEqual(6, o.EdgeCount(0));
            Assert.AreEqual(2, ActiveObjects(), "camp 1's line and label");
            a.On.Clear(); a.On.Add(1);
            o.Update(map, Camps(2, 3), MatchPhase.Active, false, a);
            Assert.IsFalse(o.IsShown(0)); Assert.IsTrue(o.IsShown(1));
            Assert.AreEqual(2, ActiveObjects());
            a.On.Clear();
            o.Update(map, Camps(2, 3), MatchPhase.Active, false, a);
            Assert.AreEqual(0, o.Shown); Assert.AreEqual(0, ActiveObjects());
        }

        [Test]
        public void An_attacked_camp_still_follows_the_legacy_rules_for_phase_and_living_mobs()
        {
            var o = new CampPatienceOutlines(_root.transform);
            var a = new Attacked(); a.On.Add(0); a.On.Add(1);
            o.Update(Map(), Camps(0, 3), MatchPhase.Active, false, a);
            Assert.IsFalse(o.IsShown(0), "a cleared camp has no chase range (CampPatience.ts:92)");
            Assert.IsTrue(o.IsShown(1));
            o.Update(Map(), Camps(2, 3), MatchPhase.Ended, false, a);
            Assert.AreEqual(0, o.Shown, "not an active run");
            o.Update(Map(), Camps(2, 3), MatchPhase.Active, true, a);
            Assert.AreEqual(0, o.Shown, "training");
        }
    }
}
