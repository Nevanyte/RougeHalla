#if UNITY_EDITOR || DEVELOPMENT_BUILD || RH_LAYOUT_REVIEW_TESTS
using System;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>Explicit synthetic layout data; never used for admission or gameplay evidence.</summary>
    public static class UiLayoutReviewFrames
    {
        public static ServerMsg.State State(string mode, uint tick)
        {
            var cards = new byte[80]; for (int i = 0; i < cards.Length; i++) cards[i] = 255;
            var state = new ServerMsg.State { Tick = tick, Items = new StateItem[] {
                new InventoryState { Value = new WireInventory { Slot0 = 0, Slot1 = 1, ActiveSlot = 0, PotionSmall = 5, PotionLarge = 5, PotionsHealing = 3 } },
                new BuildState { Value = new WireBuild { Cards = cards, Boosts = new byte[] {255,255,255,255,255,255,255,255} } },
                new PropsState(), new CampsState(), new ProjectilesState(), new FieldsState(),
                new RewardChestsState { Rows = new [] { new WireRewardChest { Handle = new RewardChestHandle(1), X = 730, Y = 650, ExpiresAt = 100000,
                    CanChoose = true, Options = new [] { new WireRewardOption { Kind = 1, Id = 0 }, new WireRewardOption { Kind = 1, Id = 79 }, new WireRewardOption { Kind = 2, Id = 7 } } } } },
                new ArenaState { Value = new WireArena { PlanEndsAt = mode == "planning" ? 95000 : 0, RaidStartedAt = mode == "planning" ? 0 : 5000, SuddenDeathAt = mode == "planning" ? 0 : 90000, StartedWith = 8 } },
                new PlanState { Value = mode == "planning" ? new WirePlan { EndsAt = 95000, Spawn0 = 5, Spawn1 = 8, Pick = 0, Boon = 1,
                    Boons = new [] { "Guardian's resolve", "Wanderer's fortune" }, Option0 = new WirePlanOption { Index = 5, X = Quant.QuantizePos(176), Y = Quant.QuantizePos(176), Zone = 1 },
                    Option1 = new WirePlanOption { Index = 8, X = Quant.QuantizePos(1152), Y = Quant.QuantizePos(800), Zone = 4 } } : null },
                new QuestsState() // This synthetic review explicitly has no quest publication.
            } };
            // State is a canonical ordered keyed record. The wire encoder intentionally rejects unordered keys.
            Array.Sort(state.Items, (left, right) => left.Key.CompareTo(right.Key));
            return state;
        }
        public static ServerMsg.Snapshot Snapshot(string mode, uint tick)
        {
            var actors = new WireActor[7];
            for (int i = 0; i < actors.Length; i++) actors[i] = new WireActor { Id = (uint)(i + 2), X = 450 + (i % 4) * 150, Y = 520 + (i / 4) * 250,
                Faction = (byte)(i % 5), Weapon = (byte)(i % 5), Kind = 0, Status = 1, HpPct = 100 };
            return new ServerMsg.Snapshot { Tick = tick, Phase = (byte)(mode == "planning" ? 3 : 1), Actors = actors,
                Me = new WireSelf { Id = 1, Faction = 4, X = 700, Y = 650, Hp = 99999, MaxHp = 99999, Barrier = 99999, Kills = ushort.MaxValue, Gv = ushort.MaxValue, Weapon = 0, Status = 1,
                    Wish = new WireWishOwner { Ability = 4, MaxCharges = 2, Charges = 1, ReadyAt = 6000, RechargeMs = 45000, NextChargeAt = 51000, FullAt = 96000 } } };
        }
        public static MapBlob Map()
        {
            const int w = 48, h = 36; var tiles = new byte[w * h];
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
                if (x == 0 || y == 0 || x == w - 1 || y == h - 1 || (x == 12 || x == 32) && y % 12 > 4) tiles[y * w + x] = MapBlob.Wall;
            return new MapBlob(w, h, tiles);
        }
    }
}
#endif
