using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// The overhead stack of one actor equals legacy (docs/backlog/packets/P-UNITY-OVERHEAD-1.md). Units: legacy px, y up from the feet,
    /// Y = bottom edge, X = centre. Legacy: PlayerView.ts:23,60-65,394-483, FighterArt.ts:354-394, MobView.ts:19-23,169-175, MarkPlate.ts:25-37.
    /// BODY_LIFT 14 + FIGURE_RADIUS 13.2: bar top 35.2 (PlayerView.ts:285), name bottom LABEL_Y 45.2 (PlayerView.ts:65).
    /// </summary>
    public class OverheadLayoutTests
    {
        const float Tol = .01f;
        static readonly OverheadKind[] Legacy =
        {
            OverheadKind.HpBack, OverheadKind.HpFill, OverheadKind.BarrierFill, OverheadKind.Name, OverheadKind.WishIcon, OverheadKind.MarkPips,
            OverheadKind.BountyCrown, OverheadKind.BountyNumber, OverheadKind.SecondaryWeapon, OverheadKind.StatMark,
        };

        static OverheadFacts Player() { return new OverheadFacts { Kind = OverheadActorKind.Player, HpPct = 80, Name = "Ada" }; }

        static List<OverheadElement> Build(OverheadFacts f) { var l = new List<OverheadElement>(); OverheadStack.Build(in f, l); return l; }
        static OverheadElement One(List<OverheadElement> l, OverheadKind k) { return l.Single(e => e.Kind == k); }

        static OverheadFacts Full()
        {
            var f = Player(); f.BarrierPct = 40; f.Bounty = 150; f.WishState = 1; f.HasSecondary = true; f.Secondary = (byte)WeaponId.Bow;
            f.Stat1 = 1; f.Stat2 = 4; f.MarkTier = 2; return f;
        }

        [Test]
        public void Elements_come_in_the_legacy_order()
        {
            var kinds = Build(Full()).Select(e => e.Kind).ToArray();
            CollectionAssert.AreEqual(new[]
            {
                OverheadKind.HpBack, OverheadKind.HpFill, OverheadKind.BarrierFill, OverheadKind.Name, OverheadKind.WishIcon, OverheadKind.MarkPips,
                OverheadKind.BountyCrown, OverheadKind.BountyNumber, OverheadKind.SecondaryWeapon, OverheadKind.StatMark, OverheadKind.StatMark,
            }, kinds);
        }

        [Test]
        public void Nothing_beyond_the_legacy_elements_is_emitted()
        {
            // No faction insignia plate, signature-icon row, name plate or status badge row, for any actor kind (legacy draws none of them).
            foreach (var kind in new[] { OverheadActorKind.Player, OverheadActorKind.Mob, OverheadActorKind.Elite, OverheadActorKind.Dummy })
            {
                var f = Full(); f.Kind = kind; f.HpPct = 60;
                foreach (var e in Build(f)) CollectionAssert.Contains(Legacy, e.Kind, "unexpected element " + e.Kind + " for " + kind);
            }
            Assert.IsEmpty(Build(new OverheadFacts { Kind = OverheadActorKind.Player, Dead = true, HpPct = 50, Name = "Ada" }));
        }

        [Test]
        public void Player_stack_sits_at_the_legacy_heights()
        {
            var f = Player(); f.WishState = 1; f.HasSecondary = true; f.Secondary = (byte)WeaponId.Bow; f.Stat1 = 1; f.MarkTier = 3;
            var l = Build(f);
            var back = One(l, OverheadKind.HpBack);
            Assert.AreEqual(28f, back.W, Tol); Assert.AreEqual(4f, back.H, Tol); Assert.AreEqual(31.2f, back.Y, Tol); Assert.AreEqual(0f, back.X, Tol);
            Assert.AreEqual(45.2f, One(l, OverheadKind.Name).Y, Tol);
            var pips = One(l, OverheadKind.MarkPips); // MarkPlate.ts:25-37: 4 pips 5x3, gap 4, top at LABEL_Y - 12
            Assert.AreEqual(3, pips.Lit); Assert.AreEqual(32f, pips.W, Tol); Assert.AreEqual(3f, pips.H, Tol); Assert.AreEqual(54.2f, pips.Y, Tol);
            // Build row with no crown: centre LABEL_Y - 27 (PlayerView.ts:458), 18 px squares.
            var row = One(l, OverheadKind.SecondaryWeapon);
            Assert.AreEqual(18f, row.W, Tol); Assert.AreEqual(18f, row.H, Tol); Assert.AreEqual(72.2f - 9f, row.Y, Tol);
        }

        [Test]
        public void Bounty_crown_scales_and_lifts_the_name_number_and_build_row()
        {
            var l = Build(Full()); // bounty 150 => scale 1.5 (PlayerView.ts:34-39)
            var crown = One(l, OverheadKind.BountyCrown);
            Assert.AreEqual(22f * 1.5f, crown.W, Tol); Assert.AreEqual(13f * 1.5f, crown.H, Tol); Assert.AreEqual(60.2f, crown.Y, Tol);
            var num = One(l, OverheadKind.BountyNumber);
            Assert.AreEqual("150", num.Text); Assert.AreEqual(60.2f + 13f * 1.5f + 1f, num.Y, Tol); // PlayerView.ts:492
            Assert.AreEqual(60.2f + 13f * 1.5f + 14f - 9f, One(l, OverheadKind.SecondaryWeapon).Y, Tol); // row centre = crown top + 14
            Assert.IsFalse(Build(Player()).Any(e => e.Kind == OverheadKind.BountyCrown || e.Kind == OverheadKind.BountyNumber));
        }

        [Test]
        public void Build_row_uses_three_fixed_spots()
        {
            var f = Full(); f.Bounty = 0;
            var l = Build(f);
            var stats = l.Where(e => e.Kind == OverheadKind.StatMark).ToArray();
            Assert.AreEqual(-18f, One(l, OverheadKind.SecondaryWeapon).X, Tol);
            Assert.AreEqual(0f, stats[0].X, Tol); Assert.AreEqual(18f, stats[1].X, Tol);
            Assert.AreEqual(1, stats[0].Variant); Assert.AreEqual(4, stats[1].Variant);
            // A remote player's secondary weapon is not on the wire: the other spots do not shift to centre (legacy never centres them).
            f.HasSecondary = false;
            stats = Build(f).Where(e => e.Kind == OverheadKind.StatMark).ToArray();
            Assert.AreEqual(0f, stats[0].X, Tol); Assert.AreEqual(18f, stats[1].X, Tol);
        }

        [TestCase(51f, OverheadTone.Green)]
        [TestCase(50f, OverheadTone.Amber)]
        [TestCase(26f, OverheadTone.Amber)]
        [TestCase(25f, OverheadTone.Red)]
        [TestCase(1f, OverheadTone.Red)]
        public void Hp_bar_colour_changes_above_50_and_above_25(float hpPct, OverheadTone tone)
        {
            var f = Player(); f.HpPct = hpPct;
            Assert.AreEqual(tone, One(Build(f), OverheadKind.HpFill).Tone);
        }

        [Test]
        public void Barrier_does_not_change_the_hp_colour()
        {
            var f = Player(); f.HpPct = 60; f.BarrierPct = 80; // FighterArt.ts:383: the colour follows hp against max hp, not the shrunk bar
            Assert.AreEqual(OverheadTone.Green, One(Build(f), OverheadKind.HpFill).Tone);
        }

        [Test]
        public void Barrier_segment_follows_the_hp_fill_on_the_same_bar()
        {
            var f = Player(); f.HpPct = 80; f.BarrierPct = 40; // hpBarFractions: total 120; half-pixel rounding: 37/2 and 19/2 px of 28
            var l = Build(f);
            var fill = One(l, OverheadKind.HpFill); var bar = One(l, OverheadKind.BarrierFill);
            Assert.AreEqual(18.5f, fill.W, Tol); Assert.AreEqual(9.5f, bar.W, Tol);
            Assert.AreEqual(-14f, fill.X - fill.W / 2, Tol);
            Assert.AreEqual(fill.X + fill.W / 2, bar.X - bar.W / 2, Tol);
            Assert.AreEqual(OverheadTone.Barrier, bar.Tone);
            Assert.AreEqual(fill.Y, bar.Y, Tol); Assert.AreEqual(4f, bar.H, Tol);
            // Within max hp the bar keeps its scale.
            f.HpPct = 50; f.BarrierPct = 25;
            l = Build(f); fill = One(l, OverheadKind.HpFill); bar = One(l, OverheadKind.BarrierFill);
            Assert.AreEqual(14f, fill.W, Tol); Assert.AreEqual(7f, bar.W, Tol);
            f.BarrierPct = 0;
            Assert.IsFalse(Build(f).Any(e => e.Kind == OverheadKind.BarrierFill));
        }

        [TestCase(OverheadActorKind.Player, 28f)]
        [TestCase(OverheadActorKind.Mob, 36f)]
        [TestCase(OverheadActorKind.Elite, 48f)]
        [TestCase(OverheadActorKind.Dummy, 36f)]
        public void Bar_width_follows_the_actor_kind(OverheadActorKind kind, float width)
        {
            var f = Player(); f.Kind = kind; f.HpPct = 70;
            Assert.AreEqual(width, One(Build(f), OverheadKind.HpBack).W, Tol);
        }

        [Test]
        public void Mob_bar_shows_only_when_hurt_but_always_for_elites_and_dummies_and_mobs_have_no_player_extras()
        {
            var f = Full(); f.Kind = OverheadActorKind.Mob; f.HpPct = 100; f.BarrierPct = 0; f.Name = "Wolf";
            Assert.IsFalse(Build(f).Any(e => e.Kind == OverheadKind.HpBack)); // MobView.ts:173-175
            f.Kind = OverheadActorKind.Elite; Assert.IsTrue(Build(f).Any(e => e.Kind == OverheadKind.HpBack));
            f.Kind = OverheadActorKind.Dummy; Assert.IsTrue(Build(f).Any(e => e.Kind == OverheadKind.HpBack));
            f.Kind = OverheadActorKind.Mob; f.HpPct = 90;
            CollectionAssert.AreEqual(new[] { OverheadKind.HpBack, OverheadKind.HpFill, OverheadKind.Name }, Build(f).Select(e => e.Kind).ToArray());
        }

        [Test]
        public void Wish_icon_is_left_of_the_name_not_above_it()
        {
            var f = Player(); f.WishState = 1; f.NameWidthPx = 40f;
            var l = Build(f);
            var name = One(l, OverheadKind.Name); var wish = One(l, OverheadKind.WishIcon);
            Assert.AreEqual(15f, wish.W, Tol);
            // PlayerView.ts:394-410: right edge = name left edge - 3; centre y = LABEL_Y - 6.5.
            Assert.AreEqual(-20f - 3f, wish.X + wish.W / 2, Tol);
            Assert.AreEqual(51.7f, wish.Y + wish.H / 2, Tol);
            Assert.Less(wish.X + wish.W / 2, name.X - 20f + Tol);
            Assert.AreEqual(OverheadTone.WishReady, wish.Tone);
            f.WishState = 2; Assert.AreEqual(OverheadTone.WishRecharging, One(Build(f), OverheadKind.WishIcon).Tone);
            f.WishState = 0; Assert.IsFalse(Build(f).Any(e => e.Kind == OverheadKind.WishIcon));
        }

        [Test]
        public void Unmeasured_name_width_falls_back_to_six_px_per_character_of_the_drawn_text()
        {
            var f = Player(); f.WishState = 1; f.Name = "Rook"; f.Bot = true; f.NameWidthPx = 0; // "[BOT] Rook" = 10 chars = 60 px
            var wish = One(Build(f), OverheadKind.WishIcon);
            Assert.AreEqual(-30f - 3f, wish.X + wish.W / 2, Tol);
        }

        [Test]
        public void Bot_names_carry_the_prefix_and_the_name_colour_follows_who_it_is()
        {
            var f = Player(); f.Name = "Rook"; f.Bot = true;
            Assert.AreEqual("[BOT] Rook", One(Build(f), OverheadKind.Name).Text);
            f.Bot = false; Assert.AreEqual("Rook", One(Build(f), OverheadKind.Name).Text);
            Assert.AreEqual(OverheadTone.NameOther, One(Build(f), OverheadKind.Name).Tone);
            f.Local = true; Assert.AreEqual(OverheadTone.NameOwn, One(Build(f), OverheadKind.Name).Tone);
            f.Local = false; f.Kind = OverheadActorKind.Mob; f.HpPct = 50; Assert.AreEqual(OverheadTone.NameMob, One(Build(f), OverheadKind.Name).Tone);
            f.Kind = OverheadActorKind.Elite; Assert.AreEqual(OverheadTone.NameElite, One(Build(f), OverheadKind.Name).Tone);
            f.Name = null; f.Kind = OverheadActorKind.Player;
            Assert.IsFalse(Build(f).Any(e => e.Kind == OverheadKind.Name)); // unknown name: nothing drawn
        }

        [Test]
        public void Pixels_convert_to_actor_units_once_in_the_layout()
        {
            Assert.AreEqual(.026f, OverheadStack.UnitsPerPx, 1e-6f);
            Assert.AreEqual(.9152f, OverheadStack.ToUnits(35.2f), 1e-4f);
        }
    }
}
