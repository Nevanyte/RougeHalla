using System.Collections.Generic;
using NUnit.Framework;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>The contrast lab's map, plan and entry gate. No GPU needed: the map and plan are pure functions of the public planes.</summary>
    public sealed class ContrastLabEditModeTests
    {
        static MapBlob _map; static SurfaceMap _surfaces; static List<LabAppearance> _apps; static LabPlan _plan; static List<string> _keys;

        [OneTimeSetUp]
        public void Build()
        {
            _map = ContrastLabMap.Build();
            var rm = new RegionMap(); rm.Load(_map); _surfaces = new SurfaceMap(rm);
            var catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            _keys = new List<string>(); foreach (var a in catalog.Actors) _keys.Add(a.Key);
            _apps = ContrastLabAppearances.Build(_keys, out var unreachable);
            Assert.That(unreachable, Is.Empty, "catalog keys the real presenter can never pick");
            _plan = ContrastLabPlanner.Plan(_map, _surfaces, _apps, new LabOptions());
        }

        static readonly Dictionary<RegionId, SurfaceKind[]> Expected = new Dictionary<RegionId, SurfaceKind[]>
        {
            { RegionId.Fire, new[] { SurfaceKind.Basalt, SurfaceKind.Ember, SurfaceKind.Lava } },
            { RegionId.Sentenced, new[] { SurfaceKind.Flagstone } },
            { RegionId.Plague, new[] { SurfaceKind.Mud, SurfaceKind.Bog } },
            { RegionId.Frost, new[] { SurfaceKind.Snow, SurfaceKind.Ice } },
            { RegionId.Holy, new[] { SurfaceKind.Sand, SurfaceKind.HolyLight } },
            { RegionId.Coliseum, new[] { SurfaceKind.Limestone } },
        };

        [Test]
        public void EveryZoneHoldsEverySurfaceTheSurfaceMapCanReturnThere()
        {
            foreach (var zone in ContrastLabMap.Zones)
            {
                var found = ContrastLabPlanner.ScanSurfaces(_map, _surfaces, ContrastLabMap.ZoneIndex(zone) * ContrastLabMap.BlockW);
                foreach (var kind in Expected[zone]) Assert.That(found, Contains.Item(kind), zone + " lacks " + kind);
            }
        }

        [Test]
        public void ZoneBlocksCarryTheirTerrainWallsLowAndPillars()
        {
            int fences = 0, walls = 0, lows = 0, pillars = 0;
            int holy = ContrastLabMap.ZoneIndex(RegionId.Holy) * ContrastLabMap.BlockW, sentenced = ContrastLabMap.ZoneIndex(RegionId.Sentenced) * ContrastLabMap.BlockW;
            for (int y = 0; y < _map.H; y++) for (int x = 0; x < _map.W; x++)
            {
                bool inSentenced = x >= sentenced && x < sentenced + ContrastLabMap.BlockW;
                if (inSentenced && _map.Terrain[y * _map.W + x] == (byte)TerrainKind.Fence) fences++;
                if (x > 2 && x < _map.W - 3 && y > 2 && y < _map.H - 3 && _map.At(x, y) == MapBlob.Wall) walls++;
                if (x > 2 && x < _map.W - 3 && _map.At(x, y) == MapBlob.Low) lows++;
                if (x >= holy && x < holy + ContrastLabMap.BlockW && y > 37 && _map.At(x, y) == MapBlob.Wall && x % 3 == (holy + 5) % 3) pillars++;
            }
            Assert.That(fences, Is.GreaterThan(50)); Assert.That(walls, Is.GreaterThan(100)); Assert.That(lows, Is.GreaterThan(50));
            Assert.That(pillars, Is.GreaterThanOrEqualTo(40), "Holy needs a dense pillar grid");
        }

        [Test]
        public void EveryCatalogKeyIsStampedInEveryZoneOnEverySurface()
        {
            foreach (var zone in ContrastLabMap.Zones)
            {
                var surfacePages = _plan.ForZone(zone).FindAll(p => p.Kind == "surface");
                Assert.That(surfacePages, Is.Not.Empty, zone.ToString());
                var bySurface = new Dictionary<SurfaceKind, HashSet<string>>();
                foreach (var page in surfacePages)
                    foreach (var c in page.Cells)
                    {
                        if (!bySurface.TryGetValue(c.Surface, out var set)) bySurface[c.Surface] = set = new HashSet<string>();
                        set.Add(c.Appearance.Key);
                    }
                foreach (var kind in Expected[zone])
                {
                    Assert.That(bySurface.ContainsKey(kind), zone + " has no cells on " + kind);
                    foreach (var key in _keys) Assert.That(bySurface[kind], Contains.Item(key), zone + "/" + kind + " lacks " + key);
                }
            }
        }

        [Test]
        public void EveryAppearancePoseAndFacingIsStampedOnEverySurface()
        {
            foreach (var zone in ContrastLabMap.Zones)
            {
                var seen = new Dictionary<SurfaceKind, HashSet<string>>();
                foreach (var page in _plan.ForZone(zone).FindAll(p => p.Kind == "surface"))
                    foreach (var c in page.Cells)
                    {
                        if (!seen.TryGetValue(c.Surface, out var set)) seen[c.Surface] = set = new HashSet<string>();
                        set.Add(c.Appearance.Id + "|" + c.Pose + "|" + c.FacingIndex);
                    }
                foreach (var pair in seen) Assert.That(pair.Value.Count, Is.EqualTo(_apps.Count * 2 * 2), zone + "/" + pair.Key);
            }
        }

        [Test]
        public void CellsStandOnTheirSurfaceAndNeverOverlapOnSurfacePages()
        {
            foreach (var page in _plan.Pages)
            {
                Assert.That(page.Cells.Count, Is.LessThanOrEqualTo(30));
                foreach (var c in page.Cells)
                    Assert.That(_surfaces.SurfaceAtTile(Mathf.FloorToInt(c.TileX), Mathf.FloorToInt(c.TileY)), Is.EqualTo(c.Surface));
                if (page.Kind != "surface") continue;
                for (int i = 0; i < page.Cells.Count; i++) for (int k = i + 1; k < page.Cells.Count; k++)
                {
                    var a = page.Cells[i]; var b = page.Cells[k];
                    Assert.That(Mathf.Abs(a.TileX - b.TileX) >= 2.6f || Mathf.Abs(a.TileY - b.TileY) >= 4.1f, "cells " + a.Id + " and " + b.Id + " overlap");
                }
            }
        }

        [Test]
        public void PropPagesPlaceEveryAppearanceNearPropsInEveryZoneThatHasThem()
        {
            foreach (var zone in new[] { RegionId.Fire, RegionId.Sentenced, RegionId.Plague, RegionId.Frost, RegionId.Holy })
            {
                var cells = new List<LabCell>(); foreach (var p in _plan.ForZone(zone)) if (p.Kind == "props") cells.AddRange(p.Cells);
                Assert.That(cells, Is.Not.Empty, zone + " has props but no prop cells");
                var keys = new HashSet<string>(); foreach (var c in cells) { keys.Add(c.Appearance.Key); Assert.That(c.Prop, Is.Not.Empty); }
                foreach (var key in _keys) Assert.That(keys, Contains.Item(key), zone + " props lack " + key);
            }
        }

        [Test]
        public void PropCellsCoverTallPropsLikeTreesAndTombstonesAsWellAsLowOnes()
        {
            foreach (var zone in new[] { RegionId.Fire, RegionId.Sentenced, RegionId.Plague, RegionId.Frost, RegionId.Holy })
            {
                int tall = 0, low = 0;
                foreach (var p in _plan.ForZone(zone)) if (p.Kind == "props") foreach (var c in p.Cells)
                {
                    Assert.That(RegionPropArt.TryGet(c.Prop, out var art), c.Prop);
                    if (art.Tall) tall++; else low++;
                }
                Assert.That(tall, Is.GreaterThanOrEqualTo(4), zone + " tall prop cells");
                Assert.That(low, Is.GreaterThanOrEqualTo(4), zone + " low prop cells");
            }
        }

        [Test]
        public void SurfacePagesAreBalancedAndNothingIsStrandedOnATinyPage()
        {
            foreach (var zone in ContrastLabMap.Zones)
            {
                var bySurface = new Dictionary<SurfaceKind, List<int>>();
                foreach (var p in _plan.ForZone(zone).FindAll(q => q.Kind == "surface"))
                {
                    if (!bySurface.TryGetValue(p.Surface, out var l)) bySurface[p.Surface] = l = new List<int>();
                    l.Add(p.Cells.Count);
                }
                foreach (var pair in bySurface) Assert.That(pair.Value.Count, Is.LessThanOrEqualTo(3), zone + "/" + pair.Key + " pages: " + string.Join(",", pair.Value));
            }
        }

        [Test]
        public void PlanIsDeterministic()
        {
            var again = ContrastLabPlanner.Plan(_map, _surfaces, _apps, new LabOptions());
            Assert.That(again.Pages.Count, Is.EqualTo(_plan.Pages.Count));
            for (int i = 0; i < again.Pages.Count; i++)
            {
                Assert.That(again.Pages[i].ViewTile, Is.EqualTo(_plan.Pages[i].ViewTile));
                for (int k = 0; k < again.Pages[i].Cells.Count; k++)
                {
                    Assert.That(again.Pages[i].Cells[k].TileX, Is.EqualTo(_plan.Pages[i].Cells[k].TileX));
                    Assert.That(again.Pages[i].Cells[k].Appearance.Id, Is.EqualTo(_plan.Pages[i].Cells[k].Appearance.Id));
                }
            }
        }

        [Test]
        public void ViewsStayInsideTheirZoneBlock()
        {
            foreach (var page in _plan.Pages)
            {
                if (page.Kind == "seam") continue;   // a seam page is framed on the border of two zone blocks on purpose
                int x0 = ContrastLabMap.ZoneIndex(page.Zone) * ContrastLabMap.BlockW;
                Assert.That(page.ViewTile.x - 16f, Is.GreaterThanOrEqualTo(x0)); Assert.That(page.ViewTile.x + 16f, Is.LessThanOrEqualTo(x0 + ContrastLabMap.BlockW));
                Assert.That(page.ViewTile.y - 11.5f, Is.GreaterThanOrEqualTo(0)); Assert.That(page.ViewTile.y + 11.5f, Is.LessThanOrEqualTo(ContrastLabMap.BlockH));
            }
        }

        [Test]
        public void BoundaryPagesStraddleRealSurfaceChangesAndZoneSeams()
        {
            var edgeNames = new HashSet<string>();
            foreach (var page in _plan.Pages)
            {
                if (page.Kind != "edge" && page.Kind != "seam") continue;
                Assert.That(page.Cells.Count, Is.EqualTo(12)); Assert.That(page.Prop, Is.Not.Empty);
                foreach (var c in page.Cells) { Assert.That(c.Prop, Is.EqualTo(page.Prop)); Assert.That(c.PropMode, Does.StartWith("straddle")); }
                if (page.Kind == "edge") edgeNames.Add(page.Prop);
            }
            Assert.That(edgeNames.Contains("edge:Basalt|Lava") || edgeNames.Contains("edge:Lava|Basalt"), Is.True, "the lava edge: " + string.Join(",", edgeNames));
            Assert.That(_plan.Pages.FindAll(p => p.Kind == "seam").Count, Is.EqualTo(ContrastLabMap.Zones.Length - 1));
            foreach (var zone in new[] { RegionId.Plague, RegionId.Frost, RegionId.Holy, RegionId.Fire })
                Assert.That(_plan.ForZone(zone).FindAll(p => p.Kind == "edge"), Is.Not.Empty, zone + " has a surface change to straddle");
            var off = ContrastLabPlanner.Plan(_map, _surfaces, _apps, new LabOptions { Boundaries = false });
            Assert.That(off.Pages.FindAll(p => p.Kind == "edge" || p.Kind == "seam"), Is.Empty);
        }

        [Test]
        public void TheLabIsUnreachableWithoutTheFlag()
        {
            Assert.That(ContrastLabStage.Requested(""), Is.False);
            Assert.That(ContrastLabStage.Requested(null), Is.False);
            Assert.That(ContrastLabStage.Requested("?preview=1"), Is.False);
            Assert.That(ContrastLabStage.Requested("?contrastlab=0"), Is.False);
            Assert.That(ContrastLabStage.Requested("?contrastlab="), Is.False);
            Assert.That(ContrastLabStage.Requested("?xcontrastlab=1"), Is.False);
            Assert.That(ContrastLabStage.Requested("?server=ws://h/?contrastlab=1"), Is.False);
            Assert.That(ContrastLabStage.Requested("?contrastlab=1"), Is.True);
            Assert.That(ContrastLabStage.Requested("?quality=ultra&contrastlab=1&zone=fire"), Is.True);
        }

        [Test]
        public void MaskClassesCoverTheMarkersThePresenterDraws()
        {
            Assert.That(ContrastLabStage.ClassOf("Authored character"), Is.EqualTo(ContrastLabStage.ClassSilhouette));
            Assert.That(ContrastLabStage.ClassOf("Character contrast rim"), Is.EqualTo(ContrastLabStage.ClassSilhouette));
            Assert.That(ContrastLabStage.ClassOf("Character light rim"), Is.EqualTo(ContrastLabStage.ClassRim));
            Assert.That(ContrastLabStage.ClassOf("Health and barrier track outline"), Is.EqualTo(ContrastLabStage.ClassHp));
            Assert.That(ContrastLabStage.ClassOf("Faction footprint outline"), Is.EqualTo(ContrastLabStage.ClassFootprint));
            Assert.That(ContrastLabStage.ClassOf("Faction insignia backplate outline"), Is.EqualTo(ContrastLabStage.ClassInsignia));
            Assert.That(ContrastLabStage.ClassOf("Equipped weapon cue outline"), Is.EqualTo(ContrastLabStage.ClassSilhouette));
            Assert.That(ContrastLabStage.ClassOf("Faction mantle outline"), Is.EqualTo(ContrastLabStage.ClassSilhouette));
            Assert.That(ContrastLabStage.ClassOf("Contact shadow"), Is.EqualTo(ContrastLabStage.ClassShadow));
            Assert.That(ContrastLabStage.ClassOf("Health and barrier track"), Is.EqualTo(ContrastLabStage.ClassHp));
            Assert.That(ContrastLabStage.ClassOf("Confirmed health"), Is.EqualTo(ContrastLabStage.ClassHp));
            Assert.That(ContrastLabStage.ClassOf("Faction footprint"), Is.EqualTo(ContrastLabStage.ClassFootprint));
            Assert.That(ContrastLabStage.ClassOf("Faction insignia"), Is.EqualTo(ContrastLabStage.ClassInsignia));
            Assert.That(ContrastLabStage.ClassOf("Public status cue"), Is.EqualTo(ContrastLabStage.ClassOther));
        }
    }
}
