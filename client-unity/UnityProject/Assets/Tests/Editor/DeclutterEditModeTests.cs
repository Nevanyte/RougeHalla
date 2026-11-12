using System;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// P-UNITY-DECLUTTER-1 (owner direction 2026-11-12, DEV-022; departs from legacy mapPainter.ts:503-516,584-629 and mobRole.ts:20-26 on purpose):
    /// a camp on either map is its buff glyph plus at most one elite marker (no zone shape, ring on the Tab map only), and no mob carries a role badge.
    /// </summary>
    public sealed class DeclutterEditModeTests
    {
        GameObject _root;
        Session _session;
        FakeTransport _transport;

        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("Declutter fixture", typeof(RectTransform));
            _transport = new FakeTransport();
            _session = new Session(_transport, new SessionOptions { Url = "ws://localhost/ws", Profile = "fixture", Now = () => 1000 });
            _session.Connect(); _transport.Open();
            _transport.Deliver(new ServerMsg.Welcome { Protocol = Wire.ProtocolVersion, MatchId = new byte[16], Session = new byte[16],
                PlayerId = 1, TickRate = 20, Map = new MapBlob(4, 4, new byte[16]) });
        }

        [TearDown]
        public void TearDown()
        {
            if (_session != null) _session.Leave();
            UnityEngine.Object.DestroyImmediate(_root);
        }

        static readonly MapCamp[] Camps = { new MapCamp(96, 96, 8, 1), new MapCamp(32, 32, 8, 3) };

        TacticalMapMarks Marks(bool large, params WireCamp[] rows)
        {
            var map = new MapBlob(4, 4, new byte[16]).WithPublic(Camps, null, null, null, null);
            var marks = _root.AddComponent<TacticalMapMarks>(); marks.Large = large; marks.SetMap(map);
            _transport.Deliver(new ServerMsg.State { Tick = 3, Items = new StateItem[] { new CampsState { Rows = rows } } });
            marks.Present(_session, null);
            Canvas.ForceUpdateCanvases();
            return marks;
        }

        static WireCamp Camp(byte state = 0, bool reward = true, bool elite = false, bool ward = false) => new WireCamp
        {
            MobType = 0, Elite = (byte)(elite ? 1 : 0), Alive = state == 2 ? 0u : 3u, State = state,
            ClearedAt = state == 2 ? 1000 : 0, RespawnAt = state == 2 ? 181000 : 0,
            Reward = reward ? new WireCampReward { Stat = 2, Amount = 100 } : (WireCampReward?)null,
            Ward = ward ? new WireWard { Yours = true, ExpiresAt = 1e12 } : null,
        };

        [TestCase(false)]
        [TestCase(true)]
        public void TheMapDrawsNoZoneShapeForCamps(bool large)
        {
            var marks = Marks(large, Camp(), Camp(2, reward: false));
            Assert.AreEqual(2, marks.CampMarkerCount, "both camps are still on the map");
            Assert.AreEqual(0, marks.CampShapesDrawn, "the zone tint says the zone; shapes mean players only");
        }

        [TestCase(false)]
        [TestCase(true)]
        public void EachCampIsOneBuffGlyphAndARowWithoutARewardIsADot(bool large)
        {
            var marks = Marks(large, Camp(), Camp(reward: false));
            Assert.AreEqual(2, marks.CampBuffGlyphsDrawn, "the buff icon and the neutral dot");
            Assert.AreEqual(0, marks.CampDimGlyphsDrawn);
        }

        [TestCase(false)]
        [TestCase(true)]
        public void AClearedCampKeepsItsDimmedGlyphAndItsClock(bool large)
        {
            var marks = Marks(large, Camp(2), Camp());
            Assert.AreEqual(2, marks.CampBuffGlyphsDrawn);
            Assert.AreEqual(1, marks.CampDimGlyphsDrawn, "only the cleared camp is dimmed");
            Assert.AreEqual(1, marks.CampClocksShown, "its respawn seconds stay");
        }

        [TestCase(false)]
        [TestCase(true)]
        public void AnEliteCampHasExactlyOneEliteMarker(bool large)
        {
            var marks = Marks(large, Camp(elite: true), Camp());
            Assert.AreEqual(1, marks.EliteMarkersDrawn);
        }

        [Test]
        public void TheMinimapDrawsAtMostBuffAndEliteMarkPerCampPlusItsWardMark()
        {
            // The map has two camps, so the second (plain, idle, with a reward) is a plain camp: exactly one glyph, subtracted here.
            var marks = Marks(false, Camp(1, elite: true, ward: true), Camp());
            int perCamp = marks.CampBuffGlyphsDrawn + marks.EliteMarkersDrawn + marks.CampShapesDrawn + marks.EngagedRingsDrawn - 1;
            Assert.AreEqual(2, perCamp, "buff + elite, nothing else (no zone shape, no ring)");
            Assert.AreEqual(1, marks.WardsDrawn, "the ward mark stays");
        }

        [Test]
        public void TheFoughtHereRingIsOnTheTabMapOnly()
        {
            Assert.AreEqual(0, Marks(false, Camp(1), Camp()).EngagedRingsDrawn, "minimap");
            UnityEngine.Object.DestroyImmediate(_root.GetComponent<TacticalMapMarks>());
            Assert.AreEqual(1, Marks(true, Camp(1), Camp()).EngagedRingsDrawn, "Tab map");
        }

        // ---- the world: no role mark on any mob ----

        [TestCase(MobTypeId.EmberImp)]     // swarm
        [TestCase(MobTypeId.CinderHound)]  // skirmisher
        [TestCase(MobTypeId.FlameCaller)]  // caster
        [TestCase(MobTypeId.MagmaBrute)]   // brute
        [TestCase(MobTypeId.Bailiff)]      // grunt
        [TestCase(MobTypeId.RotMonk)]      // grunt
        [TestCase(MobTypeId.Wyrmling)]     // elite
        public void NoMobCarriesARoleBadgeOrItsBackplate(MobTypeId type)
        {
            Assert.That(ShowcaseIdentityAssets.TryGetMobInfo(type, out var info), Is.True);
            var go = new GameObject("identity");
            try
            {
                var owner = ShowcaseIdentityOwner.Configure(go.transform);
                owner.Present((int)info.Faction, ActorKind.RegionalMob, type, 2000, true, 0f);
                Assert.That(go.transform.Find("Mob role badge glyph"), Is.Null, type + " glyph object");
                Assert.That(go.transform.Find("Mob role badge backplate"), Is.Null, type + " backplate object");
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        [Test]
        public void AnEliteMobStillHasItsStarAboveItsName()
        {
            ShowcaseSprites.Initialize();
            var go = new GameObject("actor");
            try
            {
                var ind = new OverheadIndicators(go.transform);
                ind.Update(new OverheadIndicators.Facts { Order = 2000, HeadY = 1.68f, BarY = 1.8f, HpPct = 100f, Mob = true, Elite = true, Name = "Wyrmling" });
                var star = go.transform.Find("Elite star").GetComponent<SpriteRenderer>();
                Assert.IsTrue(star.enabled);
                Assert.Greater(star.transform.localPosition.y, go.transform.Find("Name").localPosition.y);
                Assert.That(go.transform.Find("Mob role badge glyph"), Is.Null);
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        sealed class FakeTransport : ITransport
        {
            public event Action Opened;
            public event Action<byte[]> Received;
            public event Action<string> Closed;
            public void Open() => Opened?.Invoke();
            public void Deliver(ServerMsg msg) => Received?.Invoke(msg.Encode());
            public void Connect(string url) { }
            public void Send(byte[] frame) { }
            public void Close() { Closed?.Invoke("closed"); }
            public void Poll() { }
        }
    }
}
