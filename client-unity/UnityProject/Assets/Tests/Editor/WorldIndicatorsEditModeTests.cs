using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Client;
using Roguehalla.Net;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>The third-pass world indicators: container labels, the reward-chest ring, quest item markers, the death X, the hurt vignette, the ground-mark art.</summary>
    public sealed class WorldIndicatorsEditModeTests
    {
        GameObject _root; WorldIndicators _world;

        [SetUp] public void SetUp() { ShowcaseSprites.Initialize(); _root = new GameObject("world indicators test"); _world = new WorldIndicators(_root.transform); }
        [TearDown] public void TearDown() { Object.DestroyImmediate(_root); }

        static CollectionsView View(PropView[] props, RewardChestView[] chests)
        {
            var c = new CollectionsView();
            typeof(CollectionsView).GetProperty("Props", BindingFlags.Instance | BindingFlags.Public).SetValue(c, props);
            typeof(CollectionsView).GetProperty("RewardChests", BindingFlags.Instance | BindingFlags.Public).SetValue(c, chests);
            return c;
        }

        static RewardChestView Chest(float x, float y, double expiresAt)
        {
            var r = new RewardChestView();
            typeof(RewardChestView).GetProperty("X").SetValue(r, x); typeof(RewardChestView).GetProperty("Y").SetValue(r, y);
            typeof(RewardChestView).GetProperty("ExpiresAt").SetValue(r, expiresAt);
            typeof(RewardChestView).GetProperty("Handle").SetValue(r, new RewardChestHandle(7));
            return r;
        }

        [Test]
        public void Bodies_are_labelled_always_and_other_props_only_when_focused()
        {
            var props = new[] {
                new PropView { Kind = PropAppearance.Body, BodyLabel = "Ash", X = 100, Y = 100 },
                new PropView { Kind = PropAppearance.Chest, X = 200, Y = 100 },
                new PropView { Kind = PropAppearance.Chest, X = 300, Y = 100, Focused = true } };
            _world.Update(View(props, new RewardChestView[0]), 0, false, 0, 0, 1f, null);
            Assert.AreEqual(2, _world.LabelsShown, "the body and the focused chest");
        }

        [Test]
        public void A_fogged_row_gets_no_marker_label_or_ring()
        {
            var props = new[] { new PropView { Kind = PropAppearance.Body, BodyLabel = "Ash", X = 100, Y = 100 }, new PropView { Kind = PropAppearance.QuestItem, X = 100, Y = 100 } };
            _world.Update(View(props, new[] { Chest(100, 100, 5000) }), 0, false, 0, 0, 1f, (x, y) => false);
            Assert.AreEqual(0, _world.LabelsShown); Assert.AreEqual(0, _world.MarkersShown); Assert.AreEqual(0, _world.RingsShown);
        }

        [Test]
        public void A_quest_item_gets_a_marker_and_a_focused_one_a_label()
        {
            var props = new[] { new PropView { Kind = PropAppearance.QuestItem, X = 100, Y = 100, QuestFetch = true }, new PropView { Kind = PropAppearance.QuestItem, X = 140, Y = 100, Focused = true } };
            _world.Update(View(props, new RewardChestView[0]), 0, false, 0, 0, 1f, null);
            Assert.AreEqual(2, _world.MarkersShown); Assert.AreEqual(1, _world.LabelsShown);
        }

        [Test]
        public void A_reward_chest_draws_its_ring_and_shows_seconds_only_when_the_player_is_near()
        {
            var chests = new[] { Chest(100, 100, 12000) };
            _world.Update(View(new PropView[0], chests), 0, true, 100, 100, 1f, null);
            Assert.AreEqual(1, _world.RingsShown); Assert.AreEqual(0, _world.LabelsShown, "the seconds text is the ring's own label, not a prop label");
            Assert.AreEqual("12s", _world.SecondsShownForTest(0), "near: the seconds are shown");
            _world.Update(View(new PropView[0], chests), 0, true, 5000, 5000, 1.1f, null);
            Assert.AreEqual(1, _world.RingsShown); Assert.IsNull(_world.SecondsShownForTest(0), "far: no seconds text");
        }

        [Test]
        public void The_death_x_lives_two_seconds_then_goes_and_is_not_added_in_fog()
        {
            _world.AddDeath(100, 100, 1f, null); Assert.AreEqual(1, _world.DecalsLive);
            _world.Update(null, 0, false, 0, 0, 2.9f, null); Assert.AreEqual(1, _world.DecalsLive, "still fading at 1.9 s");
            _world.Update(null, 0, false, 0, 0, 3.1f, null); Assert.AreEqual(0, _world.DecalsLive);
            _world.AddDeath(100, 100, 5f, (x, y) => false); Assert.AreEqual(0, _world.DecalsLive);
        }

        [Test]
        public void The_vignette_flashes_on_a_real_hit_decays_in_350_ms_and_ignores_scratches()
        {
            var v = new HurtVignette();
            try
            {
                v.Hit(1f, 100f, 0f); v.Tick(0f, false); Assert.AreEqual(0f, v.Strength, "1 percent is below the 2 percent floor");
                v.Hit(30f, 100f, 1f); v.Tick(1f, false); Assert.AreEqual(1f, v.Strength, .01f);
                v.Tick(1.175f, false); Assert.AreEqual(.5f, v.Strength, .02f);
                v.Tick(1.4f, false); Assert.AreEqual(0f, v.Strength, .001f);
                v.Hit(30f, 100f, 2f); v.Tick(2f, true); Assert.AreEqual(.5f, v.Strength, .01f, "reduced motion halves it");
            }
            finally { v.Dispose(); }
        }

        [Test]
        public void Ground_mark_rings_carry_a_dark_and_a_light_hairline_and_keep_their_own_colour()
        {
            var sprite = GroundMarkArt.Ring(UiTheme.Current.Danger, true);
            var tex = sprite.texture; int n = tex.width, mid = n / 2;
            Color core = Color.clear, dark = Color.clear, light = Color.clear;
            // walk outward along +x from the centre: fill, band, dark hairline, light hairline, nothing
            float bestCore = 0, bestDark = 1, bestLight = 0; int lastOpaque = 0;
            for (int x = mid; x < n; x++)
            {
                var c = tex.GetPixel(x, mid); if (c.a > .05f) lastOpaque = x;
                if (c.a > .9f && c.r > bestCore) { bestCore = c.r; core = c; }
                if (c.a > .5f && c.r + c.g + c.b < bestDark * 3f && x > mid + n * .38f) { bestDark = (c.r + c.g + c.b) / 3f; dark = c; }
                if (c.a > .3f && (c.r + c.g + c.b) / 3f > bestLight && x > mid + n * .38f) { bestLight = (c.r + c.g + c.b) / 3f; light = c; }
            }
            Assert.Greater(core.r, core.g + .2f, "the band is the danger red");
            Assert.Less(bestDark, .25f, "a dark hairline beside the band");
            Assert.Greater(lastOpaque, mid + n * .40f); Assert.Less(lastOpaque, n - 1, "the mark ends inside the sprite");
            Assert.Greater(bestLight, 0.3f, "and a light hairline outside it");
        }

        [Test]
        public void The_plague_puddle_is_generated_and_dark_rimmed()
        {
            var s = GroundMarkArt.Puddle(); Assert.AreEqual(128, s.texture.width);
            var edge = s.texture.GetPixel(64, 63 - 30); Assert.Greater(s.texture.GetPixel(64, 32).a, .9f);
            Assert.AreEqual(1f, s.texture.GetPixel(64, 32).a, .01f); Assert.IsTrue(edge.a > 0f);
        }

        [Test]
        public void Tab_selection_keeps_the_graphic_white_so_a_token_is_not_multiplied_by_a_token()
        {
            var go = new GameObject("tab"); var image = go.AddComponent<UnityEngine.UI.Image>(); var button = go.AddComponent<UnityEngine.UI.Button>(); button.targetGraphic = image;
            try
            {
                MythicUi.Select(button, true); Assert.AreEqual(Color.white, image.color);
                Assert.AreEqual((Color)UiTheme.Current.SurfaceSelected, button.colors.normalColor);
                MythicUi.Select(button, false); Assert.AreEqual((Color)UiTheme.Current.SurfaceRaised, button.colors.normalColor);
            }
            finally { Object.DestroyImmediate(go); }
        }

        [TestCase(1280, 800, 1f)] [TestCase(1920, 1080, 1.35f)] [TestCase(2560, 1440, 1.5f)]
        public void The_hub_panel_dock_sits_right_of_the_launch_panel_and_under_the_wordmark_at_every_size(int w, int h, float scale)
        {
            var vp = new HudViewport(scale, w, h);
            HubPanelDock.Anchors(vp.UiWidth, vp.UiHeight, out var min, out var max);
            Assert.GreaterOrEqual(min.x * vp.UiWidth, 354f - .5f, "clear of the 330 unit launch panel docked at 12");
            Assert.LessOrEqual(max.x * vp.UiWidth, vp.UiWidth - 11.5f);
            Assert.LessOrEqual((1f - max.y) * vp.UiHeight, 123f); Assert.GreaterOrEqual((1f - max.y) * vp.UiHeight, 121.5f, "below the wordmark and tagline");
            Assert.LessOrEqual((max.x - min.x) * vp.UiWidth, HubPanelDock.MaxWidth + .5f);
            Assert.Greater((max.x - min.x) * vp.UiWidth, 600f, "wide enough for a two column page");
            Assert.Greater((max.y - min.y) * vp.UiHeight, 400f, "tall enough to read");
        }
    }
}
