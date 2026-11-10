using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>The indicator gallery (?uilab=1): its catalog covers the audit rows, its grounds are what they claim, and every page drives the real presenters.</summary>
    public sealed class UiLabEditModeTests
    {
        // Audit rows (docs/rework/LEGACY_INDICATORS.md) the gallery must have a cell for. The rest of the 77 are not world or actor marks the presenters draw:
        // wire-blocked rows (B*), HUD panels (H*, W4), the route preview (W13), the zone strips (W14, W16) and the HUD sudden death line (W18).
        static readonly string[] Required =
        {
            "P1", "P4", "P5", "P6", "P7", "P9", "P15", "P16", "P17",
            "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S13",
            "G1", "G2", "G3", "G4", "G5", "G6", "M1", "M2", "M3", "M4", "M5", "M6", "M7", "F1", "F2", "F5", "F8",
            "W1", "W2", "W3", "W5", "W6", "W8", "W9", "W15", "W17", "X1", "X2", "X3", "X4",
            "P2", "P8", "G7", "P13", "P14", "F3", "F4", "HZ", "B1", "B2"
        };

        [Test]
        public void The_catalog_has_a_cell_for_every_coverable_audit_row()
        {
            var rows = UiLabCatalog.Rows(UiLabCatalog.Build());
            foreach (var id in Required) Assert.That(rows, Contains.Item(id), "no gallery cell for " + id);
        }

        [Test]
        public void Cells_have_unique_ids_and_pages_hold_at_most_one_grid()
        {
            var seen = new HashSet<string>();
            foreach (var page in UiLabCatalog.Build())
            {
                Assert.That(page.Cells.Count, Is.LessThanOrEqualTo(UiLabGrid.PerPage), page.Name);
                int me = 0;
                foreach (var cell in page.Cells)
                {
                    if (cell.Row.Length > 0) Assert.That(seen.Add(cell.Id), "duplicate cell id " + cell.Id);
                    foreach (var a in cell.Actors) if (a.Own) me++;
                    if (cell.NeedsMe) Assert.That(page.HasMe, page.Name + "/" + cell.Id + " needs the local fighter but its page has none");
                }
                Assert.That(me, Is.LessThanOrEqualTo(1), page.Name + " has more than one local fighter");
            }
        }

        [Test]
        public void Every_time_based_cell_has_a_non_negative_age_and_still_cells_none()
        {
            foreach (var page in UiLabCatalog.Build())
                foreach (var cell in page.Cells)
                    foreach (var a in cell.Actors)
                    {
                        bool timed = a.AppearAge >= 0 || a.LeaveAge >= 0 || a.DieAge >= 0 || a.HitAge >= 0 || a.SwingAge >= 0 || a.WindupAge >= 0 || a.HealAge >= 0;
                        Assert.That(cell.Age >= 0, Is.EqualTo(timed), cell.Id);
                    }
        }

        [Test]
        public void The_three_grounds_are_uniform_floor_with_no_prop_under_the_grid()
        {
            var map = UiLabMap.Build();
            var regions = new RegionMap(); regions.Load(map);
            var surfaces = new SurfaceMap(regions);
            var temple = TempleLayout.For(map);
            Assert.That(temple.Found, "the Holy block must produce a temple: " + temple.Reason);
            surfaces.AddLayer(temple); surfaces.AddLayer(PlagueGround.Build(map));
            var props = RegionProps.Scatter(map);
            foreach (UiLabGround g in new[] { UiLabGround.Dark, UiLabGround.Bright, UiLabGround.Snow })
            {
                var c = UiLabMap.GridCentre[(int)g];
                int x0 = Mathf.FloorToInt(c.x - UiLabGrid.Width * .5f) - 1, x1 = Mathf.CeilToInt(c.x + UiLabGrid.Width * .5f) + 1;
                int y0 = Mathf.FloorToInt(c.y - UiLabGrid.Height * .5f) - 1, y1 = Mathf.CeilToInt(c.y + UiLabGrid.Height * .5f) + 1;
                for (int y = y0; y < y1; y++)
                    for (int x = x0; x < x1; x++)
                    {
                        Assert.That(map.At(x, y), Is.EqualTo(MapBlob.Floor), g + " tile " + x + "," + y + " is not floor");
                        Assert.That(surfaces.SurfaceAtTile(x, y), Is.EqualTo(UiLabMap.SurfaceOf(g)), g + " tile " + x + "," + y + " (" + temple.Describe() + ")");
                    }
                foreach (var p in props)
                    Assert.That(p.X >= x0 - 2.6f && p.X <= x1 + 2.6f && p.Y >= y0 && p.Y <= y1 + 4f, Is.False, g + " has a prop " + p.Art + " at " + p.X + "," + p.Y + " near the grid");
            }
        }

        // ---- the stage drives the real presenters ------------------------------------------------------------------------------------

        GameObject _camGo; ArenaView _arena; UiLabStage _stage; readonly List<GameObject> _objects = new List<GameObject>();

        [SetUp]
        public void SetUp()
        {
            ShowcaseSprites.Initialize();
            if (ShowcaseSettings.Current == null) _objects.Add(new GameObject("settings", typeof(ShowcaseSettings)));
            _camGo = new GameObject("cam", typeof(Camera)); _objects.Add(_camGo);
            var cam = _camGo.GetComponent<Camera>(); cam.orthographic = true; cam.orthographicSize = 9f;
            var arenaGo = new GameObject("arena"); _objects.Add(arenaGo);
            _arena = arenaGo.AddComponent<ArenaView>();
            _arena.GetType().GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_arena, null);
            var stageGo = new GameObject("stage"); _objects.Add(stageGo);
            _stage = stageGo.AddComponent<UiLabStage>();
            _stage.Begin(cam, _arena, "");
        }

        [TearDown]
        public void TearDown()
        {
            SpriteActorPresenter.FadeClock = null;
            for (int i = _objects.Count - 1; i >= 0; i--) if (_objects[i] != null) Object.DestroyImmediate(_objects[i]);
            _objects.Clear();
        }

        int PageNamed(string name, int ground = 0)
        {
            for (int i = 0; i < _stage.Pages.Count; i++) if (_stage.Pages[i].Name == name) return ground * _stage.Pages.Count + i;
            Assert.Fail("no page " + name); return -1;
        }
        bool Enabled(string rendererName)
        {
            foreach (var r in _arena.GetComponentsInChildren<SpriteRenderer>(false)) if (r.name == rendererName && r.enabled && r.gameObject.activeInHierarchy) return true;
            return false;
        }

        [Test]
        public void Every_page_on_every_ground_runs_through_the_real_presenters_and_publishes_its_cells()
        {
            for (int p = 0; p < _stage.TotalPages; p++)
            {
                _stage.ShowPageForTest(p);
                _stage.DriveForTest(-1f); _stage.DriveForTest(_stage.FreezeSeconds);
                var json = _stage.PublishForTest();
                var state = JsonUtility.FromJson<PublishedState>(json);
                Assert.That(state.page, Is.EqualTo(p)); Assert.That(state.cells, Is.Not.Empty, "page " + p);
                foreach (var c in state.cells) { Assert.That(c.w, Is.GreaterThan(10f), c.id); Assert.That(c.h, Is.GreaterThan(10f), c.id); }
            }
        }

        [System.Serializable] sealed class PublishedCell { public string id; public float x, y, w, h; }
        [System.Serializable] sealed class PublishedState { public int page; public List<PublishedCell> cells; }

        [Test]
        public void The_local_fighter_page_shows_the_wish_icon_the_off_hand_badge_and_the_lock_ring()
        {
            _stage.ShowPageForTest(PageNamed("me-ready"));
            _stage.DriveForTest(-1f);
            Assert.That(Enabled("Wish icon"), "own Wish icon (P6)");
            Assert.That(Enabled("Secondary weapon icon"), "own off-hand badge");
            Assert.That(Enabled("Attack lock ring"), "P17 lock ring");
            Assert.That(Enabled("Hover ring"), "P17 hover ring");
            Assert.That(Enabled("Sentenced hunt ring"), "W17 hunt ring");
        }

        [Test]
        public void Status_bits_and_bounty_cells_draw_their_glyphs()
        {
            _stage.ShowPageForTest(PageNamed("grid1"));
            _stage.DriveForTest(-1f);
            Assert.That(Enabled("Bounty crown"), "P7 crown");
            Assert.That(Enabled("Status stun"), "S1 glyph");
            Assert.That(Enabled("Rooted ring"), "S2 ring");
        }

        [Test]
        public void The_vision_fade_page_fades_a_leaving_actor_instead_of_removing_it()
        {
            _stage.ShowPageForTest(PageNamed("vision-fades"));
            _arena.DiagSetExitFades(true);
            float t = Time.unscaledTime; SpriteActorPresenter.FadeClock = () => t;
            _stage.DriveForTest(-1f);
            int before = CountActors();
            t += 1f;                                      // the arrivals are fully faded in, so a leaver starts from full opacity
            _stage.DriveForTest(-1f);
            _stage.DriveForTest(_stage.FreezeSeconds);   // every leave event has fired
            Assert.That(CountActors(), Is.GreaterThanOrEqualTo(before), "leaving actors stay on screen as fading ghosts");
        }

        [Test]
        public void A_leaving_player_fades_its_whole_body_not_only_its_plates()
        {
            _arena.DiagSetExitFades(true);
            float t = Time.unscaledTime; SpriteActorPresenter.FadeClock = () => t;
            var rows = new List<InterpActor> { new InterpActor { Id = 5, Faction = FactionId.Holy, Status = ActorStatus.Alive, HpPct = 100, X = 300, Y = 300, Kind = ActorKind.Player, Weapon = WeaponId.Sword } };
            _arena.RetainObservedActors(rows, null); _arena.Present(rows, null, null, 0f);
            t += 1f; _arena.RetainObservedActors(rows, null); _arena.Present(rows, null, null, 0f);   // fully arrived
            var root = _arena.transform.Find("Observed actor");
            Assert.AreEqual(1f, root.Find("Authored character").GetComponent<SpriteRenderer>().color.a, .01f);
            var none = new List<InterpActor>();
            _arena.RetainObservedActors(none, null); _arena.Present(none, null, null, 0f);             // it left sight: a ghost starts at full opacity
            Assert.AreEqual(1f, root.Find("Authored character").GetComponent<SpriteRenderer>().color.a, .01f);
            t += VisionFade.ExitSeconds * .5f; _arena.RetainObservedActors(none, null); _arena.Present(none, null, null, 0f);
            float body = root.Find("Authored character").GetComponent<SpriteRenderer>().color.a, rim = root.Find("Character contrast rim").GetComponent<SpriteRenderer>().color.a, bar = root.Find("Confirmed health").GetComponent<SpriteRenderer>().color.a;
            Assert.AreEqual(.5f, body, .05f, "body half way through the fade");
            Assert.Less(rim, .88f * .6f, "the dark outline fades with it"); Assert.AreEqual(.5f, bar, .1f);
        }

        int CountActors() { int n = 0; foreach (Transform c in _arena.transform) if (c.name == "Observed actor" && c.gameObject.activeSelf) n++; return n; }
    }
}
