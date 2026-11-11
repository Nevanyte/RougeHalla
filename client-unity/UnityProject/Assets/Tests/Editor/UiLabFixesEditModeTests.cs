using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>What the indicator gallery (?uilab=1) found wrong and what was changed for it, one test per finding.</summary>
    public sealed class UiLabFixesEditModeTests
    {
        GameObject _go; OverheadIndicators _ind;
        [SetUp] public void Up() { ShowcaseSprites.Initialize(); _go = new GameObject("actor"); _ind = new OverheadIndicators(_go.transform); }
        [TearDown] public void Down() { Object.DestroyImmediate(_go); }
        static OverheadIndicators.Facts Facts() { return new OverheadIndicators.Facts { Order = 2000, HeadY = 1.68f, BarY = 1.8f, HpPct = 100f }; }
        SpriteRenderer Find(string name) { var t = _go.transform.Find(name); return t == null ? null : t.GetComponent<SpriteRenderer>(); }

        // ---- barrier bubble (P5) ---------------------------------------------------------------------------------------------------
        [Test] public void The_barrier_is_a_bubble_round_the_body_that_strengthens_with_the_step()
        {
            var f = Facts(); _ind.Update(f);
            Assert.IsFalse(Find("Barrier bubble").enabled, "no barrier, no bubble");
            f.BarrierStep = 2; _ind.Update(f);
            Assert.IsTrue(Find("Barrier bubble").enabled); Assert.IsTrue(Find("Barrier bubble ring").enabled);
            float weakFill = Find("Barrier bubble").color.a, weakRing = Find("Barrier bubble ring").color.a;
            f.BarrierStep = 8; _ind.Update(f);
            Assert.Greater(Find("Barrier bubble").color.a, weakFill); Assert.Greater(Find("Barrier bubble ring").color.a, weakRing);
            Assert.AreEqual(.24f, Find("Barrier bubble").color.a, .001f, "legacy: fill alpha .10 + .14 s");
            Assert.AreEqual(.95f, Find("Barrier bubble ring").color.a, .001f, "legacy: stroke alpha .45 + .5 s");
            f.Dead = true; _ind.Update(f); Assert.IsFalse(Find("Barrier bubble").enabled);
        }

        [Test] public void The_bubble_sits_on_the_body_and_below_the_stun_stars_at_the_head()
        {
            var f = Facts(); f.BarrierStep = 8; f.Effects = Indicators.Stunned; _ind.Update(f);
            var bubble = Find("Barrier bubble"); var glyph = Find("Status stun");
            float top = bubble.transform.localPosition.y + bubble.transform.localScale.y * .5f;
            Assert.IsTrue(StatusAnchors.TryGet(StatusKind.Stun, OverheadActorKind.Player, out var anchor));
            float feet = f.BarY - OverheadStack.ToUnits(33.2f);
            Assert.AreEqual(feet + OverheadStack.ToUnits(anchor.Y + anchor.H * .5f), glyph.transform.localPosition.y, 1e-4f, "the stun art sits at its legacy head anchor");
            Assert.Less(top, glyph.transform.localPosition.y + OverheadStack.ToUnits(anchor.H * .5f), "the bubble top stays under the top of the stun stars' orbit");
        }

        // ---- bounty number (legacy: outlined text, no plate) ----------------------------------------------------------------------------
        [Test] public void The_bounty_number_is_plain_outlined_text_just_above_the_crown()
        {
            var f = Facts(); f.Bounty = 90; _ind.Update(f);
            var text = _go.transform.Find("Bounty number"); Assert.IsNull(_go.transform.Find("Bounty number plate"), "legacy draws no plate");
            var crown = Find("Bounty crown");
            Assert.Greater(text.localPosition.y, crown.transform.localPosition.y, "the number sits above the crown");
        }

        // ---- elite marks (M4) --------------------------------------------------------------------------------------------------------
        [Test] public void Elites_get_the_gold_double_ring_and_the_star_over_the_name()
        {
            var f = Facts(); f.Mob = true; f.Name = "Wyrmling"; _ind.Update(f);
            Assert.IsFalse(Find("Elite ring outer").enabled); Assert.IsFalse(Find("Elite star").enabled);
            f.Elite = true; _ind.Update(f);
            Assert.IsTrue(Find("Elite ring outer").enabled); Assert.IsTrue(Find("Elite ring inner").enabled); Assert.IsTrue(Find("Elite star").enabled);
            Assert.Greater(Find("Elite star").transform.localPosition.y, _go.transform.Find("Name").localPosition.y, "the star is above the name");
            Assert.Greater(Find("Elite ring outer").transform.localScale.x, Find("Elite ring inner").transform.localScale.x);
            f.Dead = true; _ind.Update(f); Assert.IsFalse(Find("Elite star").enabled);
        }

        // ---- signature text cues (P9, G5, G6) ------------------------------------------------------------------------------------------
        [Test] public void Taxed_suppressed_and_exec_blocked_are_named_not_unknown()
        {
            Assert.AreEqual("TAXED", OverheadExtras.CueText(16)); Assert.AreEqual("SUPPRESSED", OverheadExtras.CueText(32));
            Assert.AreEqual("EXEC BLOCKED", OverheadExtras.CueText(64)); Assert.IsNull(OverheadExtras.CueText(1 | 2 | 4 | 8));
            var f = Facts(); f.Sig = 16; _ind.Update(f);
            var cue = _go.transform.Find("Signature cue");
            Assert.IsTrue(cue.gameObject.activeSelf); Assert.AreEqual("TAXED", cue.GetComponent<TMPro.TextMeshPro>().text); Assert.IsTrue(Find("Signature cue plate").enabled);
            f.Sig = 0; _ind.Update(f); Assert.IsFalse(cue.gameObject.activeSelf); Assert.IsFalse(Find("Signature cue plate").enabled);
        }

        // ---- role badge rides the body height (M1) ---------------------------------------------------------------------------------------
        [Test] public void The_role_badge_follows_the_look_height_so_the_name_plate_cannot_cover_it()
        {
            var go = new GameObject("identity"); var owner = ShowcaseIdentityOwner.Configure(go.transform);
            try
            {
                owner.Present((int)FactionId.Fire, ActorKind.RegionalMob, MobTypeId.CinderHound, 2000, true, 0f);
                float tall = go.transform.Find("Mob role badge glyph").localPosition.y;
                owner.Present((int)FactionId.Fire, ActorKind.RegionalMob, MobTypeId.CinderHound, 2000, true, -.8f);
                Assert.AreEqual(tall - .8f, go.transform.Find("Mob role badge glyph").localPosition.y, .001f);
            }
            finally { Object.DestroyImmediate(go); }
        }

        // ---- the glow of the edge threats follows the legacy gradient (W15) ---------------------------------------------------------------
        [Test] public void The_edge_glow_falls_off_linearly_like_the_legacy_css_gradient()
        {
            Assert.AreEqual(1f, EdgeThreatView.GlowAlpha(0f), 1e-5f); Assert.AreEqual(.5f, EdgeThreatView.GlowAlpha(.5f), 1e-5f);
            Assert.AreEqual(0f, EdgeThreatView.GlowAlpha(1f), 1e-5f); Assert.AreEqual(0f, EdgeThreatView.GlowAlpha(1.4f), 1e-5f);
        }

        // ---- a trader has a body (W8) --------------------------------------------------------------------------------------------------
        [Test] public void A_merchant_marker_stands_on_a_figure_a_quest_mark_does_not_add_one()
        {
            var root = new GameObject("marks");
            try
            {
                var marks = new WorldMarks(root.transform);
                var state = new ServerMsg.State { Tick = 1, Items = new StateItem[] { new TradeState { Available = true, Value = new WireTradeView { Merchants = new[] { new WireMerchant { Kind = TradeKind.Stats, X = 300, Y = 300, Name = "Orrin" } } } } } };
                var view = new CollectionsView();
                typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] { state });
                marks.Update(view, null);
                var figure = root.transform.Find("Trader/Trader figure"); Assert.IsNotNull(figure); Assert.IsTrue(figure.GetComponent<SpriteRenderer>().enabled);
                marks.Update(null, null);
                Assert.IsFalse(figure.GetComponent<SpriteRenderer>().enabled, "no merchant, no figure");
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test] public void A_merchant_is_drawn_from_a_catalog_look_with_goods_and_the_shadow_pair_of_any_figure()
        {
            var catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog"); Assert.IsNotNull(catalog);
            Assert.AreNotEqual(WorldMarks.LookKey(TradeKind.Stats), WorldMarks.LookKey(TradeKind.Barter), "the two kinds do not share one body");
            foreach (var kind in new[] { TradeKind.Stats, TradeKind.Barter }) Assert.IsNotNull(catalog.Find(WorldMarks.LookKey(kind)), "catalog look for " + kind);
            var root = new GameObject("marks");
            try
            {
                var marks = new WorldMarks(root.transform, catalog);
                var state = new ServerMsg.State { Tick = 1, Items = new StateItem[] { new TradeState { Available = true, Value = new WireTradeView { Merchants = new[] { new WireMerchant { Kind = TradeKind.Barter, X = 300, Y = 300, Name = "Tessa" } } } } } };
                var view = new CollectionsView();
                typeof(CollectionsView).GetMethod("Apply", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(view, new object[] { state });
                marks.Update(view, null);
                var figure = root.transform.Find("Trader/Trader figure").GetComponent<SpriteRenderer>();
                Assert.AreNotEqual(ShowcaseIdentityAssets.GetFactionSilhouette(-1), figure.sprite, "a real figure, not the neutral silhouette");
                Assert.IsTrue(root.transform.Find("Trader/Trader goods").GetComponent<SpriteRenderer>().enabled, "the stall's goods stand beside it");
                Assert.IsTrue(root.transform.Find("Trader/Trader contact shadow").GetComponent<SpriteRenderer>().enabled, "shadowed like any figure");
                Assert.AreEqual(1.2f, root.transform.Find("Trader").localScale.x, 1e-4f, "the observed actors' scale");
                var glyph = root.transform.Find("World marker"); Assert.Greater(glyph.position.y, figure.bounds.max.y, "the marker is above the head");
            }
            finally { Object.DestroyImmediate(root); }
        }

        // ---- no faction insignia plate (D5) and the damage number has a plate (D4) ----------------------------------------------
        GameObject _arenaGo; ArenaView _arena;
        void MakeArena()
        {
            _arenaGo = new GameObject("arena"); _arena = _arenaGo.AddComponent<ArenaView>();
            _arena.GetType().GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_arena, null);
        }
        [TearDown] public void DownArena() { if (_arenaGo != null) Object.DestroyImmediate(_arenaGo); _arenaGo = null; }

        [Test] public void A_creature_has_no_faction_insignia_plate_alive_or_dead()
        {
            MakeArena();
            var rows = new List<InterpActor> { new InterpActor { Id = 5, Faction = FactionId.Plague, Status = ActorStatus.Alive, HpPct = 100, X = 300, Y = 300, Kind = ActorKind.RegionalMob, MobType = MobTypeId.PlagueRat } };
            _arena.Present(rows, null, null, 0f);
            var root = _arenaGo.transform.Find("Observed actor");
            Assert.IsNull(root.Find("Faction insignia"), "legacy draws no insignia plate");
            rows[0] = new InterpActor { Id = 5, Faction = FactionId.Plague, Status = ActorStatus.Dead, HpPct = 0, X = 300, Y = 300, Kind = ActorKind.RegionalMob, MobType = MobTypeId.PlagueRat };
            _arena.Present(rows, null, null, 0f);
            Assert.IsNull(root.Find("Faction insignia")); Assert.IsNull(root.Find("Faction insignia backplate"));
        }

        [Test] public void A_damage_number_has_a_dark_plate_under_it()
        {
            MakeArena();
            var rows = new List<InterpActor> { new InterpActor { Id = 5, Faction = FactionId.Fire, Status = ActorStatus.Alive, HpPct = 100, X = 300, Y = 300, Kind = ActorKind.Player, Weapon = WeaponId.Sword } };
            _arena.Present(rows, null, null, 0f);
            var fx = new ServerMsg.Fx { Tick = 1 };
            fx.List.Add(new WireFx { Kind = FxKind.Hit, Victim = 5, By = 9, Amount = 34 });
            _arena.ConfirmedFx(fx);
            _arena.Present(rows, null, null, 0f);
            var plate = _arenaGo.transform.Find("Confirmed effects/Confirmed damage plate");
            Assert.IsNotNull(plate); Assert.IsTrue(plate.gameObject.activeSelf);
            Assert.Greater(plate.GetComponent<SpriteRenderer>().color.a, .5f);
        }
    }
}
