using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// ADR0024 P-HB-8 presentation: look from the server's archetype key (with the legacy fallback), the debug overlay being off by
    /// default, projectile draw maths, click picking and the sprite-fit of every boxed archetype. The table is read from the Rust-written
    /// protocol/fixtures/archetypes_v1.json, never copied into C#.
    /// </summary>
    public sealed class HitboxPresentationEditModeTests
    {
        readonly List<GameObject> _objects = new List<GameObject>();

        [TearDown]
        public void TearDown()
        {
            HitboxOverlay.ForceForTests(null);
            for (int i = _objects.Count - 1; i >= 0; i--) if (_objects[i] != null) UnityEngine.Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
        }

        static string FixturePath(string name) { return Path.GetFullPath(Path.Combine(Application.dataPath, "../../../protocol/fixtures/" + name)); }

        [Serializable] sealed class FixtureHull { public string kind; public float r; public float[] foot, body, bodyOffset; }
        [Serializable] sealed class FixtureRow { public int id; public string key; public float chest; public FixtureHull hull; }
        [Serializable] sealed class FixturePlayer { public int Fire, Frost, Holy, Plague, Sentenced; }
        [Serializable] sealed class FixtureMobs
        {
            public int acolyte;
            public int archon;
            public int ashDrake;
            public int avalancheTroll;
            public int bailiff;
            public int bloatfly;
            public int bloodSaint;
            public int chainWarden;
            public int cinderHound;
            public int emberImp;
            public int executioner;
            public int flameCaller;
            public int frostWisp;
            public int frostbowSentry;
            public int gaoler;
            public int glacialWarden;
            public int iceGolem;
            public int inquisitor;
            public int magmaBrute;
            public int miasmaWitch;
            public int pardoner;
            public int penitent;
            public int plagueRat;
            public int poxBehemoth;
            public int ratOgre;
            public int rimeStalker;
            public int rotMonk;
            public int seraphShard;
            public int wyrmling;
            public int zealot;
        }
        [Serializable] sealed class FixtureAssign { public int dummy, zombie, playerNeutral, questGiver; public FixturePlayer player; public FixtureMobs mob; }
        [Serializable] sealed class FixtureFile { public FixtureRow[] archetypes; public FixtureAssign assign; }

        static FixtureFile ReadFixture() { return JsonUtility.FromJson<FixtureFile>(File.ReadAllText(FixturePath("archetypes_v1.json"))); }

        static WireArchetype[] Table()
        {
            var rows = new List<WireArchetype>();
            foreach (var a in ReadFixture().archetypes)
            {
                var h = a.hull;
                var row = new WireArchetype { Id = (byte)a.id, Key = a.key, Chest = (byte)a.chest };
                if (h.kind == "circle") { row.Hull = 0; row.R = (byte)h.r; }
                else
                {
                    row.Hull = 1;
                    row.Fx = (byte)h.foot[0]; row.Fy = (byte)h.foot[1];
                    row.Bx = (byte)h.body[0]; row.By = (byte)h.body[1];
                    row.Ox = (sbyte)h.bodyOffset[0]; row.Oy = (sbyte)h.bodyOffset[1];
                }
                rows.Add(row);
            }
            return rows.ToArray();
        }

        static string KeyOf(WireArchetype[] table, int id) { return WireArchetype.Find(table, (byte)id).Key; }

        // ---- look from the archetype key ----------------------------------------------------------------------------------

        [Test]
        public void TheServerKeyWinsAndNoKeyOrTheLegacyRowFallsBackToTheFactionAndTypeMapping()
        {
            Assert.AreEqual("mob-zombie", ShowcaseActorLook.AppearanceKey(ActorKind.RegionalMob, FactionId.Fire, MobTypeId.EmberImp, "mob-zombie"), "the server key wins");
            Assert.AreEqual("goblin", ShowcaseActorLook.AppearanceKey(ActorKind.RegionalMob, FactionId.Fire, MobTypeId.EmberImp, null), "no table: the old mapping");
            Assert.AreEqual("goblin", ShowcaseActorLook.AppearanceKey(ActorKind.RegionalMob, FactionId.Fire, MobTypeId.EmberImp, ShowcaseActorLook.LegacyArchetypeKey), "legacy row names no look");
            Assert.AreEqual("goblin", ShowcaseActorLook.AppearanceKey(ActorKind.RegionalMob, FactionId.Fire, MobTypeId.EmberImp, ""));
            Assert.IsNull(ShowcaseActorLook.AppearanceKey(ActorKind.QuestGiver, null, null, "hero"), "a quest giver stays the neutral silhouette");
            Assert.AreEqual(ShowcaseActorLook.AppearanceKey(ActorKind.Player, FactionId.Holy, null), ShowcaseActorLook.AppearanceKey(ActorKind.Player, FactionId.Holy, null, null));
        }

        [Test]
        public void EveryServerKeyInTheTableNamesACatalogLook()
        {
            var catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            Assert.NotNull(catalog);
            foreach (var row in Table())
            {
                if (row.Hull == 0) continue;
                Assert.NotNull(catalog.Find(row.Key), "archetype key " + row.Key + " has no catalog appearance");
            }
        }

        [Test]
        public void ThePlayerFactionLooksAgreeWithTheServerKeys()
        {
            var table = Table();
            var assign = ReadFixture().assign;
            var player = assign.player;
            Assert.AreEqual(KeyOf(table, player.Fire), ShowcaseActorLook.AppearanceKey(ActorKind.Player, FactionId.Fire, null), "Fire");
            Assert.AreEqual(KeyOf(table, player.Sentenced), ShowcaseActorLook.AppearanceKey(ActorKind.Player, FactionId.Sentenced, null), "Sentenced");
            Assert.AreEqual(KeyOf(table, player.Plague), ShowcaseActorLook.AppearanceKey(ActorKind.Player, FactionId.Plague, null), "Plague");
            Assert.AreEqual(KeyOf(table, player.Frost), ShowcaseActorLook.AppearanceKey(ActorKind.Player, FactionId.Frost, null), "Frost");
            Assert.AreEqual(KeyOf(table, player.Holy), ShowcaseActorLook.AppearanceKey(ActorKind.Player, FactionId.Holy, null), "Holy");
            Assert.AreEqual(KeyOf(table, assign.playerNeutral), ShowcaseActorLook.AppearanceKey(ActorKind.Player, null, null), "neutral player");
            Assert.AreEqual(KeyOf(table, assign.dummy), ShowcaseActorLook.AppearanceKey(ActorKind.TrainingDummy, null, null));
            Assert.AreEqual(KeyOf(table, assign.zombie), ShowcaseActorLook.AppearanceKey(ActorKind.Zombie, null, null));
        }

        [Test]
        public void TheLegacyMobMappingStillAgreesWithTheServerAssignmentForAllThirtyMobs()
        {
            var table = Table();
            var mobs = ReadFixture().assign.mob;
            Assert.AreEqual(30, ShowcaseActorLook.MobLooks.Length);
            int disagreements = 0;
            foreach (MobTypeId type in Enum.GetValues(typeof(MobTypeId)))
            {
                string name = type.ToString(); name = char.ToLowerInvariant(name[0]) + name.Substring(1);
                var field = typeof(FixtureMobs).GetField(name); Assert.NotNull(field, name);
                string server = KeyOf(table, (int)field.GetValue(mobs));
                if (server != ShowcaseActorLook.MobLooks[(int)type]) { disagreements++; Debug.Log("look disagreement: " + type + " unity " + ShowcaseActorLook.MobLooks[(int)type] + " server " + server); }
            }
            Assert.AreEqual(0, disagreements);
        }

        // ---- overlay off by default ----------------------------------------------------------------------------------------

        [Test]
        public void TheOverlayFlagParsesOnlyHitboxesEqualsOne()
        {
            Assert.IsFalse(HitboxOverlay.ParseFlag(""));
            Assert.IsFalse(HitboxOverlay.ParseFlag("?server=ws%3A%2F%2Fx"));
            Assert.IsFalse(HitboxOverlay.ParseFlag("?hitboxes=0"));
            Assert.IsFalse(HitboxOverlay.ParseFlag("?hitboxes=true"));
            Assert.IsTrue(HitboxOverlay.ParseFlag("?profile=a&hitboxes=1"));
            Assert.IsTrue(HitboxOverlay.ParseFlag("?hitboxes=1"));
        }

        [Test]
        public void TheOverlayIsOffByDefaultAndNeverBuildsAnyLineObjects()
        {
            HitboxOverlay.ForceForTests(null);
            Assert.IsFalse(HitboxOverlay.Enabled, "no page flag in the editor");
            var arena = CreateArena();
            Assert.IsFalse(arena.HitboxOverlayActive);
            Assert.IsNull(arena.transform.Find("Hitbox overlay"));
            UnityEngine.Object.DestroyImmediate(arena.gameObject);   // two arenas in one scene would add a second global light
            HitboxOverlay.ForceForTests(true);
            var on = CreateArena();
            Assert.IsTrue(on.HitboxOverlayActive);
            Assert.NotNull(on.transform.Find("Hitbox overlay"));
        }

        [Test]
        public void TheOverlayDrawsFootAndBodyBoxesOfABoxedRowAndOnlyARingForTheLegacyDisc()
        {
            var root = new GameObject("overlay test"); _objects.Add(root);
            var overlay = new HitboxOverlay(root.transform, new SpriteActorPresenter(root.transform, null));
            var table = Table();
            overlay.DrawActor(100, 200, WireArchetype.Find(table, 1));
            Assert.AreEqual(8, overlay.Used, "foot box (4 lines) plus body box (4 lines)");
            overlay.Draw(table); // no notes this frame: clears the lines
            Assert.AreEqual(0, overlay.Used);
            overlay.DrawActor(100, 200, WireArchetype.Find(table, 0));
            Assert.AreEqual(20, overlay.Used, "the legacy disc is one 20-gon ring");
        }

        // ---- projectiles ----------------------------------------------------------------------------------------------------

        [Test]
        public void AProjectileIsDrawnRaisedByItsHeightAndLegacyHeightZeroIsTheGroundPoint()
        {
            Assert.AreEqual(ArenaView.WorldPoint(320, 640), ArenaView.ProjectileDrawPoint(320, 640, 0f));
            var raised = ArenaView.ProjectileDrawPoint(320, 640, 30f);
            Assert.AreEqual(ArenaView.WorldPoint(320, 640 - 30), raised);
            Assert.AreEqual(30f * ArenaView.Scale * ArenaView.GroundSquash, raised.y - ArenaView.WorldPoint(320, 640).y, 1e-5f, "30 sim units up the screen on the squashed ground");
            Assert.AreEqual(raised.x, ArenaView.WorldPoint(320, 640).x);
        }

        [Test]
        public void TheProjectileSpriteAngleFollowsTheSquashedHeading()
        {
            Assert.AreEqual(0f, ArenaView.ProjectileScreenAngleDeg(0f), 1e-4f);
            Assert.AreEqual(-90f, ArenaView.ProjectileScreenAngleDeg(Mathf.PI / 2f), 1e-3f, "south is down the screen");
            float f = Mathf.PI / 4f;
            Assert.AreEqual(Mathf.Atan2(-Mathf.Sin(f) * .78f, Mathf.Cos(f)) * Mathf.Rad2Deg, ArenaView.ProjectileScreenAngleDeg(f), 1e-4f);
            Assert.Greater(ArenaView.ProjectileScreenAngleDeg(f), -f * Mathf.Rad2Deg, "flatter than the unsquashed angle");
        }

        // ---- click picking --------------------------------------------------------------------------------------------------

        [Test]
        public void AnActorIsPickedAtItsTorsoWhenItHasABodyBoxAndOnlyNearItsFeetWithout()
        {
            var feet = new Vector2(500, 300);
            var torsoLow = new Vector2(480, 300 + 20); var torsoHigh = new Vector2(520, 300 + 60);
            Assert.Less(ActorPick.Score(new Vector2(500, 350), feet, false, default, default), 0f, "legacy: 50 px above the feet is a miss");
            Assert.GreaterOrEqual(ActorPick.Score(new Vector2(500, 350), feet, true, torsoLow, torsoHigh), 0f, "box: the torso picks it");
            Assert.GreaterOrEqual(ActorPick.Score(new Vector2(503, 304), feet, true, torsoLow, torsoHigh), 0f, "the feet radius still works");
            Assert.Less(ActorPick.Score(new Vector2(600, 350), feet, true, torsoLow, torsoHigh), 0f, "outside both");
            float legacy = ActorPick.Score(new Vector2(510, 310), feet, false, default, default);
            Assert.AreEqual((new Vector2(510, 310) - feet).sqrMagnitude, legacy, 0f, "without a box the score is the old squared feet distance");
        }

        // ---- sprite fit -----------------------------------------------------------------------------------------------------

        /// <summary>Sim units per vertical Unity unit on the squashed ground: 32 / 0.78.</summary>
        const float SimPerUnitY = 1f / (ArenaView.Scale * ArenaView.GroundSquash), SimPerUnitX = 1f / ArenaView.Scale;
        const float ActorScale = 1.2f, BodyLift = .08f, CentreTolerance = 7f;

        static float Median(List<float> v) { v.Sort(); int n = v.Count; return n % 2 == 1 ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) * .5f; }

        /// <summary>
        /// For every boxed archetype: the opaque sprite bounds AS DRAWN (frame mesh bounds about the foot pivot, x WorldHeight, + the 0.08
        /// body lift, x the 1.2 actor scale, in sim units) against the delivered body box. Medians over the 8-direction Idle frames. The
        /// table was measured with the same rule, so the median error is rounding (under 1 u); the tolerance is 2 u top and bottom
        /// and 2 u half width on the N and S facings, and the per-frame worst case over all facings is reported. The sideways centre
        /// of the opaque bounds may sit up to 7 u from the feet: the heroes and the knight carry a weapon or shield on one side, so their
        /// opaque bounds are asymmetric while the torso is on the pivot (mobs with nothing in hand measure 0 to 3.4 u).
        /// </summary>
        [Test]
        public void EverySpriteSitsInsideItsBodyBoxWithinTwoSimUnitsAtMedian()
        {
            var catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            var lines = new List<string>(); var failures = new List<string>();
            foreach (var row in Table())
            {
                if (row.Hull != 1) continue;
                var look = catalog.Find(row.Key);
                Assert.NotNull(look, row.Key);
                var idle = look.Idle; Assert.AreEqual(0, idle.Length % 8, row.Key);
                int per = idle.Length / 8;
                var tops = new List<float>(); var belows = new List<float>(); var halfNS = new List<float>(); var centreNS = new List<float>();
                float worstTop = 0, worstBelow = 0, worstHalf = 0;
                for (int i = 0; i < idle.Length; i++)
                {
                    var b = idle[i].bounds; int dir = i / per;
                    float top = (b.max.y * look.WorldHeight + BodyLift) * ActorScale * SimPerUnitY;
                    float below = -(b.min.y * look.WorldHeight + BodyLift) * ActorScale * SimPerUnitY;
                    float half = b.extents.x * look.WorldHeight * ActorScale * SimPerUnitX;
                    float centre = b.center.x * look.WorldHeight * ActorScale * SimPerUnitX;
                    tops.Add(top); belows.Add(below);
                    if (dir == 3 || dir == 7) { halfNS.Add(half); centreNS.Add(centre); }
                    worstTop = Mathf.Max(worstTop, Mathf.Abs(top - (row.By - row.Oy)));
                    worstBelow = Mathf.Max(worstBelow, Mathf.Abs(below - (row.Oy + row.By)));
                    worstHalf = Mathf.Max(worstHalf, Mathf.Abs(half - row.Bx));
                }
                float boxTop = row.By - row.Oy, boxBelow = row.Oy + row.By;
                float topErr = Median(tops) - boxTop, belowErr = Median(belows) - boxBelow, halfErr = Median(halfNS) - row.Bx;
                lines.Add(string.Format("{0,-20} top {1,6:F1} vs {2,3} ({3,5:F1})  below {4,6:F1} vs {5,3} ({6,5:F1})  half-width(N,S) {7,5:F1} vs {8,3} ({9,5:F1})  centre-x {10,5:F1}  worst frame top/below/half {11:F1}/{12:F1}/{13:F1}",
                    row.Key, Median(tops), boxTop, topErr, Median(belows), boxBelow, belowErr, Median(halfNS), row.Bx, halfErr, Median(centreNS), worstTop, worstBelow, worstHalf));
                if (Mathf.Abs(topErr) > 2f) failures.Add(row.Key + " top error " + topErr);
                if (Mathf.Abs(belowErr) > 2f) failures.Add(row.Key + " below error " + belowErr);
                // The skeleton's Idle frames hold a two-handed weapon wider than its body; its box takes the knight's width on purpose.
                // The baked ground shadow is gone from every actor frame (owner decision 2026-11-10): the figure itself is 2 to 7 sim units narrower than the width this table
                // was fitted to while the shadow widened the sprite bounds. The sprite must still not overhang its box (+2), and may be at most 8 narrower (worst today: hero-female, -6.7).
                if (row.Key != "skeleton" && (halfErr > 2f || halfErr < -8f)) failures.Add(row.Key + " half-width error " + halfErr);
                if (Mathf.Abs(Median(centreNS)) > CentreTolerance) failures.Add(row.Key + " centre-x " + Median(centreNS));
            }
            Debug.Log("sprite fit (median over Idle frames, sim units; error in brackets)\n" + string.Join("\n", lines));
            Assert.IsEmpty(failures, string.Join("; ", failures));
        }

        ArenaView CreateArena()
        {
            var go = new GameObject("test arena"); _objects.Add(go);
            var arena = go.AddComponent<ArenaView>();
            arena.GetType().GetMethod("Awake", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(arena, null);
            return arena;
        }
    }
}
