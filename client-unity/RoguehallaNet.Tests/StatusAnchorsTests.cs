using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Roguehalla.Net.Ui;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// Statuses are art at fixed spots on the body, not a badge row (docs/backlog/packets/P-UNITY-OVERHEAD-2.md). Units: legacy px, y UP from
    /// the feet, X centre, Y bottom edge, W/H envelope (stroke widths ignored). Legacy: packages/client/src/render/StatusArt.ts with
    /// R = PLAYER_RADIUS 12, CY = -BODY_LIFT = -14 (screen y, down positive), Y_SCALE .8, HEAD_Y = CY - R - 11 (:20-21), draw order LAYERS (:37-50).
    /// </summary>
    public class StatusAnchorsTests
    {
        const float Tol = .6f;
        static readonly OverheadActorKind P = OverheadActorKind.Player;

        static StatusAnchor Get(StatusKind k, OverheadActorKind a = OverheadActorKind.Player)
        {
            Assert.IsTrue(StatusAnchors.TryGet(k, a, out var anchor), k + " has legacy art");
            return anchor;
        }

        static void Is(StatusKind k, float x, float y, float w, float h, OverheadActorKind a = OverheadActorKind.Player)
        {
            var s = Get(k, a);
            Assert.AreEqual(x, s.X, Tol, k + " X"); Assert.AreEqual(y, s.Y, Tol, k + " Y (bottom edge)");
            Assert.AreEqual(w, s.W, Tol, k + " W"); Assert.AreEqual(h, s.H, Tol, k + " H");
            Assert.AreEqual(StatusDepth.FrontOfBody, s.Depth, k + " is drawn over the body (one Graphics over body, weapon and bar)");
        }

        [Test] public void Floor_rings_sit_at_the_feet_StatusArt_ts_139_170()
        {
            Is(StatusKind.Root, 0, -13.6f, 34, 13.6f);       // :139-147 front half of a ring r = R+5 = 17, squashed by .8
            Is(StatusKind.Zoned, 0, -17.6f, 44, 35.2f);      // :170-185 chain links on a ring r = R+10 = 22, squashed by .8
        }

        [Test] public void Body_effects_centre_on_the_body_StatusArt_ts_187_234()
        {
            Is(StatusKind.Casting, 0, -5, 38, 38);           // :187-191 glow R+5, ring R+7, centred 14 above the feet
            Is(StatusKind.LastStand, 0, -4, 36, 36);         // :193-199 rim up to R+6
            Is(StatusKind.Untargetable, 0, -1.5f, 31, 31);   // :201-210 dashed ring R+3.5
            Is(StatusKind.Haste, 0, 8, 66, 12);              // :212-222 streaks off both flanks, out to R+3+4+14 = 33 each side
            Is(StatusKind.Slow, -23, -1, 18, 22);            // :224-232 trailing (left) side, x from -14 to -32
            Is(StatusKind.Dot, 0, 7, 25.6f, 22.95f);         // :234-244 flames within +-.8R rising 18 px
        }

        [Test] public void Head_marks_sit_by_the_head_StatusArt_ts_255_290()
        {
            Is(StatusKind.Stun, 0, 29.5f, 33, 15);           // :255-266 three stars circling HEAD_Y (37 up), orbit 13 x 4
            Is(StatusKind.Silence, 21, 19.2f, 11.6f, 11.6f); // :268-276 face at the head's right: x = R+9, y = 25 up
            Is(StatusKind.AttackSlow, -21, 19.2f, 11.6f, 11.6f);   // :278-288 clock at the head's left
            Is(StatusKind.AntiHeal, -23, 33, 10, 10);        // :290-296 beside the hp bar's left end: -(barHalfW+9), 38 up
        }

        [Test] public void Anti_heal_follows_the_bar_half_width_legacy_gives_each_actor_kind()
        {
            // PlayerView.ts:154 default 14; MobView.ts:19,96 HP_BAR_W/2 = 18 for every mob, elite and dummy alike.
            Assert.AreEqual(-23f, Get(StatusKind.AntiHeal, OverheadActorKind.Player).X, Tol);
            foreach (var k in new[] { OverheadActorKind.Mob, OverheadActorKind.Elite, OverheadActorKind.Dummy })
                Assert.AreEqual(-27f, Get(StatusKind.AntiHeal, k).X, Tol, k.ToString());
        }

        [Test] public void Every_other_status_is_the_same_for_every_actor_kind_and_does_not_scale_with_the_body()
        {
            // StatusArt uses PLAYER_RADIUS for everything (:19); MobView passes no radius.
            foreach (StatusKind s in System.Enum.GetValues(typeof(StatusKind)))
            {
                if (s == StatusKind.AntiHeal) continue;
                var p = Get(s, P);
                foreach (var k in new[] { OverheadActorKind.Mob, OverheadActorKind.Elite, OverheadActorKind.Dummy })
                {
                    var a = Get(s, k);
                    Assert.AreEqual(p.X, a.X, .001f, s + " X"); Assert.AreEqual(p.Y, a.Y, .001f, s + " Y");
                    Assert.AreEqual(p.W, a.W, .001f, s + " W"); Assert.AreEqual(p.H, a.H, .001f, s + " H");
                }
            }
        }

        [Test] public void Unknown_status_gives_nothing_but_known_ones_still_draw()
        {
            Assert.IsFalse(StatusAnchors.TryGet((StatusKind)200, P, out _));
            var l = new List<StatusAnchor>();
            // Hidden (256) has no art (the fighter itself is hidden or faint) and 8192/16384 are spare bits.
            int n = StatusAnchors.Build((ushort)(Indicators.Hidden | 8192 | 16384 | Indicators.Stunned), P, l);
            Assert.AreEqual(1, n); Assert.AreEqual(1, l.Count); Assert.AreEqual(StatusKind.Stun, l[0].Kind);
            Assert.AreEqual(0, StatusAnchors.Build((ushort)(Indicators.Hidden | 8192), P, l)); Assert.AreEqual(0, l.Count);
        }

        [Test] public void Statuses_that_share_an_anchor_follow_legacy_draw_order_StatusArt_ts_37_50()
        {
            var l = new List<StatusAnchor>();
            // Casting, Last Stand and Untargetable are concentric on the body; later in LAYERS draws over earlier. Not stacked sideways.
            StatusAnchors.Build((ushort)(Indicators.Untargetable | Indicators.Casting | Indicators.LastStand), P, l);
            CollectionAssert.AreEqual(new[] { StatusKind.Casting, StatusKind.LastStand, StatusKind.Untargetable }, l.Select(a => a.Kind).ToArray());
            Assert.IsTrue(l.All(a => a.X == 0 && System.Math.Abs((a.Y + a.H / 2) - 14f) < .01f), "all centred 14 px above the feet");
            Assert.IsTrue(l[0].Order < l[1].Order && l[1].Order < l[2].Order);
        }

        [Test] public void All_twelve_in_legacy_order_floor_then_body_then_head()
        {
            var l = new List<StatusAnchor>();
            StatusAnchors.Build(Indicators.DrawnMask, P, l);
            CollectionAssert.AreEqual(new[]
            {
                StatusKind.Root, StatusKind.Zoned, StatusKind.Casting, StatusKind.LastStand, StatusKind.Untargetable, StatusKind.Haste,
                StatusKind.Slow, StatusKind.Dot, StatusKind.Stun, StatusKind.Silence, StatusKind.AttackSlow, StatusKind.AntiHeal,
            }, l.Select(a => a.Kind).ToArray());
        }

        [Test] public void Nothing_resembles_a_badge_row()
        {
            var l = new List<StatusAnchor>();
            StatusAnchors.Build(Indicators.DrawnMask, P, l);
            Assert.AreEqual(12, l.Count);
            Assert.GreaterOrEqual(l.Select(a => System.Math.Round(a.Y + a.H / 2, 1)).Distinct().Count(), 6, "centres spread over the feet, body and head, not one line");
            // Nothing sits above the head marks: the old row went above the whole overhead stack (name bottom 45.2).
            Assert.IsTrue(l.All(a => a.Y + a.H <= 45.2f), "no status reaches the name plate");
            // Every status is within 40 px sideways of the feet: a row of 12 badges would be wider.
            Assert.IsTrue(l.All(a => System.Math.Abs(a.X) + a.W / 2 <= 40f));
        }

        [Test] public void Anchors_convert_through_OverheadStack_ToUnits()
        {
            Assert.AreEqual(OverheadStack.ToUnits(21f), OverheadStack.ToUnits(Get(StatusKind.Silence).X), 1e-5f);
        }
    }
}
