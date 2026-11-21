using System;
using System.Collections.Generic;
using System.Text;

namespace Roguehalla.Net
{
    /// <summary>An issued pickup reference, distinct from an actor or reward chest.</summary>
    public readonly struct PickupHandle : IEquatable<PickupHandle>
    {
        public uint Value { get; }
        public bool IsValid { get { return Value != 0; } }
        public PickupHandle(uint value) { if (value == 0) throw new ArgumentOutOfRangeException(nameof(value)); Value = value; }
        public bool Equals(PickupHandle other) { return Value == other.Value; }
        public override bool Equals(object other) { return other is PickupHandle h && Equals(h); }
        public override int GetHashCode() { return Value.GetHashCode(); }
    }
    public readonly struct RewardChestHandle : IEquatable<RewardChestHandle>
    {
        public uint Value { get; }
        public bool IsValid { get { return Value != 0; } }
        public RewardChestHandle(uint value) { if (value == 0) throw new ArgumentOutOfRangeException(nameof(value)); Value = value; }
        public bool Equals(RewardChestHandle other) { return Value == other.Value; }
        public override bool Equals(object other) { return other is RewardChestHandle h && Equals(h); }
        public override int GetHashCode() { return Value.GetHashCode(); }
    }
    /// <summary>A seat-scoped quest-row reference. It is not a pickup or actor handle.</summary>
    public readonly struct QuestHandle : IEquatable<QuestHandle>
    {
        public uint Value { get; }
        public bool IsValid { get { return Value != 0; } }
        public QuestHandle(uint value) { if (value == 0) throw new ArgumentOutOfRangeException(nameof(value)); Value = value; }
        public bool Equals(QuestHandle other) { return Value == other.Value; }
        public override bool Equals(object other) { return other is QuestHandle h && Equals(h); }
        public override int GetHashCode() { return Value.GetHashCode(); }
    }
    /// <summary>A view-local quest roster reference. It is not a player ID or display label.</summary>
    public readonly struct RosterId : IEquatable<RosterId>
    {
        public uint Value { get; }
        public bool IsValid { get { return Value != 0; } }
        public RosterId(uint value) { if (value == 0) throw new ArgumentOutOfRangeException(nameof(value)); Value = value; }
        public bool Equals(RosterId other) { return Value == other.Value; }
        public override bool Equals(object other) { return other is RosterId id && Equals(id); }
        public override int GetHashCode() { return Value.GetHashCode(); }
    }
}

namespace Roguehalla.Net.Protocol
{
    public struct WireInventory
    {
        public byte ActiveSlot, PotionSmall, PotionLarge, PotionsHealing; public byte? Slot0, Slot1;
        /// <summary>P-WIRE17-HUD-3: server ms the running healing potions end (legacy healingUntil); null when none runs.</summary>
        public double? HealingUntil;
        /// <summary>P-WIRE17-HUD-3: server ms the wind emblem's speed boost ends (legacy speedBoostUntil); null when none runs.</summary>
        public double? SpeedBoostUntil;
    }
    public enum PropKind : byte { Ground = 1, Chest = 2, Body = 3, Corpse = 4, WindEmblem = 5, Cannon = 6, QuestItem = 7, Heal = 8 }
    public struct WireProp
    {
        public PickupHandle Handle;
        public ushort X, Y;
        public PropKind Kind;
        public byte GroundWeapon;
        public bool Open;
        public string BodyLabel;
        public string CorpseLabel;
        public uint ReadyAt;
        public QuestHandle QuestRef;
        public bool QuestFetch;
    }
    public struct WireFocus { public PickupHandle Handle; public byte? BodyHint; }
    public struct WireField
    {
        public byte Kind, Ability;
        public uint? Owner, Subject;
        public float X, Y, X2, Y2, Radius, Vx, Vy;
        public double StartedAt, EndsAt;
        /// <summary>P-FROST-WALL-2: a wall's tiles (Kind <see cref="FieldsState.KindWall"/> only): row-major tile indices into the
        /// Welcome map, strictly ascending, 1..<see cref="FieldsState.MaxWallTiles"/>, each below MapBlob's tile cap. Null or
        /// empty for every other kind. On the wire only for a wall row, after EndsAt: <c>count u8 | count x tile u32 LE</c>.</summary>
        public uint[] Tiles;
    }
    /// <summary>Legacy Trophy stat keys in source declaration order (rh-sim TrophyStatKey).</summary>
    public enum TrophyStatKey : byte { Ad = 0, Ap = 1, Damage = 2, Health = 3, AttackSpeed = 4, Armor = 5, Mr = 6, Speed = 7, Leech = 8 }
    public struct WireRewardOption
    {
        public byte Kind, Id;
        public TrophyStatKey? KillKey;
        public double KillGain;
        public bool Taken;
        public uint? TakenBy;
    }
    public sealed class WireRewardChest
    {
        public RewardChestHandle Handle;
        public ushort X, Y;
        public double ExpiresAt;
        public WireRewardOption[] Options = Array.Empty<WireRewardOption>();
        public bool Picked, CanChoose;
        /// <summary>P-WIRE19-A (protocol 19): the killer first-pick window while it is in force; null without one.</summary>
        public WireFirstPick? FirstPick;
    }
    /// <summary>P-WIRE19-A: a chest's first-pick window as this viewer sees it. Its end is public; Mine is the viewer's own
    /// fact (true only for the killer). It names no player.</summary>
    public struct WireFirstPick
    {
        public double Until;
        public bool Mine;
    }
    /// <summary>P-WIRE19-B (State key 14): one of the viewer's own native readout rows. Card is a native card id (80..93),
    /// Kind 0 counter, 1 meter, 2 marks; Value and Max are finite with 0 &lt;= Value &lt;= Max.</summary>
    public struct WireReadout
    {
        public byte Card;
        public byte Kind;
        public double Value;
        public double Max;
    }
    public struct WireProjectile
    {
        public byte Kind; public ushort X,Y,Facing; public uint? Owner;
        /// <summary>Height above the ground position in whole sim units (protocol 16, ADR0024): the shooter's chest at launch.</summary>
        public byte Height;
    }
    public struct WireCamp
    {
        public byte MobType, Elite; public uint Alive; public byte State; public double ClearedAt, RespawnAt;
        /// <summary>P-WIRE17-HUD-1: the per-kill reward (public content), or null.</summary>
        public WireCampReward? Reward;
        /// <summary>P-WIRE17-HUD-1: the camp ward as a verdict for this viewer (never an owner id), or null.</summary>
        public WireWard? Ward;
    }

    /// <summary>HUD fixed point (P-WIRE17-HUD-1): every HUD number on the wire is an integer count of 1e-4. Stat codes:
    /// 0 Offense, 1 Soul Offense, 2 Damage, 3 Attack speed, 4 Life steal, 5 Health, 6 Defense, 7 Soul Defense, 8 Move speed.</summary>
    public static class Hud
    {
        public const double Quantum = 1e-4;
        public const byte StatCount = 9;
        public const int MaxSummaryMobRows = 20;
        /// <summary>P-WIRE17-HUD-2: champion panel codes (0..27 after P-WIRE17-HUD-2c, append only) and the most a summary
        /// carries.</summary>
        public const byte PanelCodeCount = 28;
        public const int MaxPanelValues = 28;
    }

    /// <summary>P-WIRE17-HUD-2: one champion panel number: its code and its value in <see cref="Hud.Quantum"/> units.</summary>
    public struct WirePanelValue
    {
        public byte Code; public int Value;
        public double Scaled => Value * Hud.Quantum;
    }

    /// <summary>A camp's per-kill reward: HUD stat code and amount in <see cref="Hud.Quantum"/> units (greater than 0).</summary>
    public struct WireCampReward
    {
        public byte Stat; public ushort Amount;
        public double Value => Amount * Hud.Quantum;
    }

    /// <summary>A live camp ward as this viewer sees it: yours or another player's, and its expiry (server ms).</summary>
    public struct WireWard { public bool Yours; public double ExpiresAt; }

    /// <summary>One "Mob bonuses" row of the owner's build summary (State key 13).</summary>
    public struct WireMobBonusRow
    {
        public byte MobType, Stat; public uint Stacks; public int Total;
        public double TotalValue => Total * Hud.Quantum;
    }

    /// <summary>State key 13: the owner's GAINED strip; Gains in stat-code order, Hud.Quantum units.</summary>
    public sealed class WireBuildSummary
    {
        public int[] Gains = new int[9];
        public WireMobBonusRow[] MobRows = Array.Empty<WireMobBonusRow>();
        /// <summary>P-WIRE17-HUD-2: champion panel values (codes 0..22, strictly ascending, at most 23), appended after the
        /// mob rows. Unity formats them; it never recomputes them (R-AUTH).</summary>
        public WirePanelValue[] Panel = Array.Empty<WirePanelValue>();
        public double Gain(int stat) => Gains[stat] * Hud.Quantum;
    }
    public struct WireBuild { public byte[] Cards, Boosts; }
    /// <summary>One resolved planning option: where it is, which zone and how long the walk takes.</summary>
    public struct WirePlanOption { public uint Index; public ushort X, Y; public byte Zone; public float? WalkSeconds; }
    /// <summary>The viewer's own private planning deal (key 8); never another player's options.</summary>
    public sealed class WirePlan
    {
        public double EndsAt;
        public uint? Spawn0, Spawn1;
        public bool Taken0, Taken1;
        public byte? Pick, Boon;
        public string[] Boons = Array.Empty<string>();
        public bool Ready;
        public WirePlanOption? Option0, Option1;
    }
    /// <summary>The public source arena lifecycle view (key 9); typed absent deadlines, never Infinity.</summary>
    public struct WireArena
    {
        public double LobbyEndsAt, PlanEndsAt, RaidStartedAt;
        public double? PatienceEndsAt;
        public bool InColiseum, GatesLocked;
        public double SuddenDeathAt;
        public uint StartedWith;
        /// <summary>P-WIRE17-HUD-3: the room's minimum players (legacy RaidState.minPlayers), 0..<see cref="MaxMinPlayers"/>.</summary>
        public byte MinPlayers;
        /// <summary>Largest accepted <see cref="MinPlayers"/> (Rust <c>state::MAX_MIN_PLAYERS</c>).</summary>
        public const byte MaxMinPlayers = 32;
    }

    public enum QuestRowState : byte { Preview = 0, Open = 1, Done = 2, Expired = 3 }
    public sealed class WireQuestRosterEntry { public RosterId Id; public string Label; }
    public struct WireQuestParticipant { public RosterId Id; public bool Accepted; public uint Progress; public byte Visited; }
    public sealed class WireQuestRow
    {
        public QuestHandle Handle;
        public string Def;
        public double GiverX, GiverY;
        public QuestRowState State;
        public double ExpiresAt;
        public WireQuestParticipant[] Participants = Array.Empty<WireQuestParticipant>();
        public RosterId? Carrier;
        /// <summary>P-WIRE17-MAP-2: the carrier's public actor id, present only while the viewer is delivered that fighter
        /// (row flag 0x10, a non-zero varint after the flags byte; only with a carrier).</summary>
        public uint? CarrierActor;
        public string DoneBy;
        public bool CanAccept, OwnerAccepted, OwnerCompleted, OwnerReady;
        public uint OwnerProgress;
        public byte OwnerVisited;
        public string Name, GiverLabel, Brief, Objective, Reward;
    }
    public struct WireQuestObjective { public QuestHandle Quest; public double X, Y; }
    public sealed class WireQuestView
    {
        public uint UnknownCount, DisplayUnknownCount;
        public RosterId? OwnerRoster;
        public WireQuestRosterEntry[] Roster = Array.Empty<WireQuestRosterEntry>();
        public WireQuestRow[] Rows = Array.Empty<WireQuestRow>();
        public WireQuestObjective[] Objectives = Array.Empty<WireQuestObjective>();
    }
    public enum TradeKind : byte { Barter = 0, Stats = 1 }
    public enum TradeStat : byte { MaxHp = 0, Ad = 1, Ap = 2, AttackSpeed = 3, MoveSpeed = 4, Armor = 5, Shield = 6 }
    public struct WireTradeOffer { public TradeStat Cost, Gain; public double CostValue, GainValue; public string Label; }
    public struct WireTradeDelta { public TradeStat Stat; public double Value; }
    public struct WireMerchant { public TradeKind Kind; public double X, Y; public string Name; }
    public sealed class WireTradeView
    {
        public bool TradeUsed;
        public WireTradeOffer[] Offers = Array.Empty<WireTradeOffer>();
        public WireTradeDelta[] Stats = Array.Empty<WireTradeDelta>();
        public double? BarterReadyAt;
        public WireMerchant[] Merchants = Array.Empty<WireMerchant>();
        public string[] BarterLabels = new[] { "", "", "" };
    }
    public enum StateKey : byte { Inventory = 1, Props = 2, Fields = 3, RewardChests = 4, Build = 5, Camps = 6, Projectiles = 7, Plan = 8, Arena = 9, Quests = 10, Trade = 11, Roster = 12, BuildSummary = 13, Readouts = 14, Marked = 15 }
}
