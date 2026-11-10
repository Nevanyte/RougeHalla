using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>Protocol 16 indicator facts (ADR0026): the weapon table feed, the wind-up telegraph, name, stat, mark, immunity, roam, engaged, crit and heal numbers.</summary>
    public sealed class LegacyFactsEditModeTests
    {
        GameObject _go; OverheadIndicators _ind;
        [SetUp] public void Up() { ShowcaseSprites.Initialize(); _go = new GameObject("actor"); _ind = new OverheadIndicators(_go.transform); WeaponShapes.Clear(); }
        [TearDown] public void Down() { Object.DestroyImmediate(_go); WeaponShapes.Clear(); if (_arenaGo != null) Object.DestroyImmediate(_arenaGo); }
        static OverheadIndicators.Facts Facts() { return new OverheadIndicators.Facts { Order = 2000, HeadY = 1.68f, BarY = 1.8f, SigTopY = 1.8f, HpPct = 100f }; }
        SpriteRenderer Find(string n) { var t = _go.transform.Find(n); return t == null ? null : t.GetComponent<SpriteRenderer>(); }

        [Test] public void The_welcome_weapon_table_becomes_the_hit_zone_shapes()
        {
            var table = new[] { new WireWeapon { Id = 0, Kind = 1, Reach = 112, HalfArc = .785 }, new WireWeapon { Id = 1, Kind = 2, Reach = 600, Speed = 500, Radius = 4 } };
            LegacyFacts.SyncWeapons(table);
            Assert.IsTrue(WeaponShapes.TryGet(0, out var s)); Assert.AreEqual(112f, s.Reach, .01f); Assert.AreEqual(.785f, s.HalfArc, .001f);
            Assert.IsFalse(WeaponShapes.TryGet(1, out _), "a projectile weapon has no melee zone");
        }

        // ---- wind-up telegraph (B13) ---------------------------------------------------------------------------------------------------------
        HitZonePresenter Zones(out GameObject root)
        {
            root = new GameObject("zones"); var z = new HitZonePresenter(root.transform, id => true, "");
            z.Position = (uint id, out float x, out float y) => { x = 300; y = 300; return true; };
            WeaponShapes.Set(new List<WeaponShape> { new WeaponShape { Weapon = 0, Kind = 1, Reach = 112, HalfArc = .785f } });
            return z;
        }
        [Test] public void A_windup_draws_the_weapon_zone_until_it_ends_is_cancelled_or_the_swing_lands()
        {
            var z = Zones(out var root);
            try
            {
                Assert.IsTrue(z.Windup(7, 0, 0f, 400f, 10f)); Assert.IsTrue(z.WindupLive(7)); Assert.AreEqual(1, z.LiveCount);
                z.Tick(10.2f, false); Assert.AreEqual(1, z.LiveCount);
                z.CancelWindup(7); Assert.AreEqual(0, z.LiveCount); Assert.IsFalse(z.WindupLive(7));
                z.Windup(7, 0, 0f, 400f, 20f); z.Tick(20.6f, false); Assert.AreEqual(0, z.LiveCount, "ran out");
                z.Windup(7, 0, 0f, 400f, 30f); z.Swing(7, 0, 300, 300, 0f, 30.3f); Assert.IsFalse(z.WindupLive(7), "the swing replaces the telegraph"); Assert.AreEqual(1, z.LiveCount);
                Assert.IsFalse(z.Windup(8, 1, 0f, 400f, 40f), "no zone for a weapon with no melee row");
            }
            finally { Object.DestroyImmediate(root); }
        }

        // ---- overhead facts --------------------------------------------------------------------------------------------------------------------
        [Test] public void A_player_name_shows_and_the_local_one_is_tinted()
        {
            var f = Facts(); f.M.Name = "[BOT] Ash"; _ind.Update(f);
            var name = _go.transform.Find("Name"); Assert.IsTrue(name.gameObject.activeSelf); Assert.AreEqual("[BOT] Ash", name.GetComponent<TMPro.TextMeshPro>().text);
            f.M.Name = null; _ind.Update(f); Assert.IsFalse(name.gameObject.activeSelf, "no roster row, no name");
        }

        [Test] public void The_top_two_stats_sit_beside_the_off_hand_in_one_row()
        {
            var f = Facts(); f.HasSecondary = true; f.Secondary = WeaponId.Bow; f.M.Top1 = (byte)StatKey.Ad; f.M.Top2 = (byte)StatKey.Armor; _ind.Update(f);
            Assert.IsTrue(Find("Stat mark 1").enabled); Assert.IsTrue(Find("Stat mark 2").enabled);
            float x0 = _go.transform.Find("Secondary weapon icon").localPosition.x, x1 = Find("Stat mark 1").transform.localPosition.x, x2 = Find("Stat mark 2").transform.localPosition.x;
            Assert.Less(x0, x1); Assert.Less(x1, x2); Assert.AreEqual(0f, x1, .001f, "legacy: weapon at -18, stats at 0 and +18");
            f.M.Top2 = 0; _ind.Update(f); Assert.IsFalse(Find("Stat mark 2").enabled);
        }

        [Test] public void The_mark_plate_lights_pips_up_to_the_tier_and_shows_the_delivered_percentage()
        {
            var f = Facts(); f.M.Tier = 3; f.Sig = 16; f.M.Tax = 20; _ind.Update(f);
            Assert.AreEqual(1f, Find("Mark pip 3").color.a, .001f); Assert.AreEqual(.2f, Find("Mark pip 4").color.a, .001f); Assert.IsTrue(Find("Mark top pip outline").enabled);
            Assert.AreEqual("AS -20%", _go.transform.Find("Signature cue").GetComponent<TMPro.TextMeshPro>().text);
            f.M.Tier = 0; f.M.Brand = 60; _ind.Update(f); Assert.IsFalse(Find("Mark pip 1").enabled); Assert.IsTrue(Find("Mark brand ring").enabled);
        }

        [Test] public void Immunity_and_roam_ready_draw_their_rings()
        {
            var f = Facts(); f.M.Immune = true; f.M.Roam = true; _ind.Update(f);
            Assert.IsTrue(Find("Teleport immunity ring").enabled); Assert.IsTrue(Find("Roam ready ring outer").enabled);
            f.M.Immune = false; f.M.Roam = false; _ind.Update(f); Assert.IsFalse(Find("Teleport immunity ring").enabled); Assert.IsFalse(Find("Roam ready ring inner").enabled);
        }

        // ---- numbers through the arena ----------------------------------------------------------------------------------------------------------
        GameObject _arenaGo; ArenaView _arena;
        void Arena()
        {
            _arenaGo = new GameObject("arena"); _arena = _arenaGo.AddComponent<ArenaView>();
            _arena.GetType().GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_arena, null);
            var rows = new List<InterpActor> { new InterpActor { Id = 5, Faction = FactionId.Fire, Status = ActorStatus.Alive, HpPct = 100, X = 300, Y = 300, Kind = ActorKind.Player, Weapon = WeaponId.Sword } };
            _arena.Present(rows, null, null, 0f);
        }
        string NumberText()
        {
            foreach (Transform t in _arenaGo.transform.Find("Confirmed effects")) if (t.name == "Confirmed damage amount" && t.gameObject.activeSelf) return t.GetComponent<TMPro.TextMeshPro>().text;
            return null;
        }
        void Fx(WireFx f) { var m = new ServerMsg.Fx { Tick = 1 }; m.List.Add(f); _arena.ConfirmedFx(m); }

        [Test] public void A_critical_hit_reads_with_a_bang() { Arena(); Fx(new WireFx { Kind = FxKind.Hit, Victim = 5, By = 9, Amount = 40, Critical = true }); Assert.AreEqual("40!", NumberText()); }
        [Test] public void A_signature_hit_shows_a_number_in_its_kind_colour_and_no_impact_ring()
        {
            Arena(); Fx(new WireFx { Kind = FxKind.SigHit, Victim = 5, By = 9, HitKind = 2, Amount = 6 });
            Assert.AreEqual("6", NumberText());
            _arena.Present(new List<InterpActor> { new InterpActor { Id = 5, Faction = FactionId.Fire, Status = ActorStatus.Alive, HpPct = 100, X = 300, Y = 300, Kind = ActorKind.Player, Weapon = WeaponId.Sword } }, null, null, 0f);
            TMPro.TextMeshPro text = null; foreach (Transform t in _arenaGo.transform.Find("Confirmed effects")) if (t.name == "Confirmed damage amount" && t.gameObject.activeSelf) text = t.GetComponent<TMPro.TextMeshPro>();
            Assert.AreEqual(0xb2 / 255f, text.color.r, .01f, "disease green");
            foreach (Transform t in _arenaGo.transform.Find("Confirmed effects")) if (t.name == "Confirmed impact") Assert.IsFalse(t.gameObject.activeSelf);
        }
        [Test] public void A_heal_shows_plus_n_and_a_heal_under_one_shows_nothing()
        {
            Arena(); Fx(new WireFx { Kind = FxKind.Heal, Id = 5, Amount = .4f }); Assert.IsNull(NumberText());
            Fx(new WireFx { Kind = FxKind.Heal, Id = 5, Amount = 12f }); Assert.AreEqual("+12", NumberText());
        }
        [Test] public void The_credits_link_points_next_to_the_page()
        {
            Assert.AreEqual("http://127.0.0.1:8287/Licenses/Third-Party-Assets.md", LaunchScreenView.CreditsUrl("http://127.0.0.1:8287/?diagnostic=1"));
            Assert.AreEqual("Licenses/Third-Party-Assets.md", LaunchScreenView.CreditsUrl(""));
        }
        [Test] public void Edge_glows_cover_living_creatures_and_fighters_but_not_the_local_one_or_hidden_ones()
        {
            var actors = new List<InterpActor> {
                new InterpActor { Id = 1, Status = ActorStatus.Alive, Kind = ActorKind.Player, X = 0, Y = 0 },
                new InterpActor { Id = 2, Status = ActorStatus.Alive, Kind = ActorKind.Player, X = 400, Y = 0 },
                new InterpActor { Id = 3, Status = ActorStatus.Dead, Kind = ActorKind.RegionalMob, X = 400, Y = 0 },
                new InterpActor { Id = 4, Status = ActorStatus.Alive, Kind = ActorKind.RegionalMob, X = 0, Y = 300 },
                new InterpActor { Id = 5, Status = ActorStatus.Alive, Kind = ActorKind.Player, X = 100, Y = 0, Effects = Indicators.Hidden },
                new InterpActor { Id = 6, Status = ActorStatus.Alive, Kind = ActorKind.QuestGiver, X = 50, Y = 50 } };
            var into = new List<EdgeThreat>(); EdgeThreats.Collect(actors, 1, 0, 0, 1000, 600, 900, into, 24);
            Assert.AreEqual(2, into.Count); Assert.AreEqual(1000f, into[0].X, .01f, "an enemy due east lands on the east edge"); Assert.AreEqual(400f, into[0].Distance, .01f);
        }
        [Test] public void A_windup_fx_starts_the_telegraph_and_a_cancel_ends_it()
        {
            Arena(); WeaponShapes.Set(new List<WeaponShape> { new WeaponShape { Weapon = 0, Kind = 1, Reach = 112, HalfArc = .785f } });
            var zones = _arenaGo.transform.Find("Melee hit zones");
            Fx(new WireFx { Kind = FxKind.Windup, By = 5, Weapon = 0, A = 0f, Ms = 500 });
            int live = 0; foreach (Transform t in zones) if (t.gameObject.activeSelf) live++; Assert.AreEqual(1, live);
            Fx(new WireFx { Kind = FxKind.Cancel, Id = 5 });
            live = 0; foreach (Transform t in zones) if (t.gameObject.activeSelf) live++; Assert.AreEqual(0, live);
        }
    }
}
