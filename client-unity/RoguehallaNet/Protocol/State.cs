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
    public enum PropKind : byte { Ground = 1, Chest = 2, Body = 3, Corpse = 4, WindEmblem = 5, Cannon = 6, QuestItem = 7 }
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
    public enum StateKey : byte { Inventory = 1, Props = 2, Fields = 3, RewardChests = 4, Build = 5, Camps = 6, Projectiles = 7, Plan = 8, Arena = 9, Quests = 10, Trade = 11, Roster = 12, BuildSummary = 13 }

    /// <summary>Keys are ascending, unique complete replacements. Missing keys retain their previous values.</summary>
    public abstract class StateItem
    {
        public abstract uint Key { get; }
        internal abstract void Check();
        internal abstract void Write(Writer w);
        internal const int MaxRows = 512, MaxKeys = (int)StateKey.BuildSummary;
        internal static void Require(bool condition, string name) { if (!condition) throw new EncodeException(name); }
        internal static bool Finite(double v) { return !double.IsNaN(v) && !double.IsInfinity(v); }
        internal static bool QuestFlag(ref Reader r, string field)
        {
            byte value = r.U8();
            if (value > 1) throw new DecodeException(DecodeError.BadField, field);
            return value != 0;
        }
        internal static byte Weapon(byte v) { if (v >= 5) throw new DecodeException(DecodeError.BadField, "carried weapon"); return v; }
        internal static byte? ReadWeapon(ref Reader r) { byte v = r.U8(); return v == 0 ? (byte?)null : Weapon((byte)(v - 1)); }
        internal static void WriteWeapon(Writer w, byte? v) { w.U8(v.HasValue ? (byte)(v.Value + 1) : (byte)0); }
        internal static void CheckWeapon(byte? v) { Require(!v.HasValue || v.Value < 5, "carried weapon"); }
        internal static uint? ReadActor(ref Reader r) { return r.Flag() ? r.Varint() : (uint?)null; }
        internal static void WriteActor(Writer w, uint? id) { w.U8(id.HasValue ? (byte)1 : (byte)0); if (id.HasValue) w.Varint(id.Value); }
        internal static uint Handle(ref Reader r)
        {
            uint id = r.Varint();
            if (id == 0) throw new DecodeException(DecodeError.BadField, "handle");
            return id;
        }
        internal static RosterId ReadRosterId(ref Reader r)
        {
            uint id = r.Varint();
            if (id == 0) throw new DecodeException(DecodeError.BadField, "roster reference");
            return new RosterId(id);
        }
        internal static QuestHandle ReadQuestHandle(ref Reader r)
        {
            uint id = r.Varint();
            if (id == 0) throw new DecodeException(DecodeError.BadField, "quest handle");
            return new QuestHandle(id);
        }
        internal static double QuestPosition(ref Reader r)
        {
            double value = r.F64();
            if (!Finite(value) || value < 0 || value > 8191.875) throw new DecodeException(DecodeError.BadField, "quest position");
            return value;
        }
        internal static string QuestLabel(ref Reader r)
        {
            string value = r.Str();
            if (Encoding.UTF8.GetByteCount(value) > 255) throw new DecodeException(DecodeError.BadField, "quest label");
            return value;
        }
        internal static WireQuestView ReadQuestView(ref Reader r)
        {
            int start = r.Position;
            var view = new WireQuestView();
            view.UnknownCount = r.Varint();
            view.DisplayUnknownCount = r.Varint();
            if (view.UnknownCount > 20 || view.DisplayUnknownCount > view.UnknownCount)
                throw new DecodeException(DecodeError.BadField, "quest unknown count");
            uint owner = r.Varint();
            if (owner != 0) view.OwnerRoster = new RosterId(owner);
            view.Roster = new WireQuestRosterEntry[Count(ref r, 8)];
            var rosterIds = new HashSet<RosterId>();
            for (int i = 0; i < view.Roster.Length; i++)
            {
                var entry = new WireQuestRosterEntry { Id = ReadRosterId(ref r), Label = QuestLabel(ref r) };
                if (!rosterIds.Add(entry.Id)) throw new DecodeException(DecodeError.BadField, "duplicate roster id");
                view.Roster[i] = entry;
            }
            if (view.OwnerRoster.HasValue && !rosterIds.Contains(view.OwnerRoster.Value))
                throw new DecodeException(DecodeError.BadField, "owner roster reference");

            view.Rows = new WireQuestRow[Count(ref r, 20)];
            var questHandles = new HashSet<QuestHandle>();
            for (int i = 0; i < view.Rows.Length; i++)
            {
                var row = new WireQuestRow { Handle = ReadQuestHandle(ref r) };
                if (!questHandles.Add(row.Handle)) throw new DecodeException(DecodeError.BadField, "duplicate quest handle");
                row.Def = r.Str();
                if (row.Def.Length == 0 || Encoding.UTF8.GetByteCount(row.Def) > 16)
                    throw new DecodeException(DecodeError.BadField, "quest definition");
                row.GiverX = QuestPosition(ref r); row.GiverY = QuestPosition(ref r);
                byte status = r.U8();
                if (status > (byte)QuestRowState.Expired) throw new DecodeException(DecodeError.BadField, "quest status");
                row.State = (QuestRowState)status;
                row.ExpiresAt = r.F64();
                if (!Finite(row.ExpiresAt) || row.ExpiresAt < 0) throw new DecodeException(DecodeError.BadField, "quest deadline");
                row.Participants = new WireQuestParticipant[Count(ref r, 8)];
                var participantIds = new HashSet<RosterId>();
                for (int j = 0; j < row.Participants.Length; j++)
                {
                    var participant = new WireQuestParticipant
                    {
                        Id = ReadRosterId(ref r), Accepted = StateItem.QuestFlag(ref r, "quest flag"), Progress = r.Varint(), Visited = r.U8(),
                    };
                    if ((participant.Visited & 0xe0) != 0) throw new DecodeException(DecodeError.BadField, "quest visited mask");
                    if (!rosterIds.Contains(participant.Id) || !participantIds.Add(participant.Id))
                        throw new DecodeException(DecodeError.BadField, "participant roster reference");
                    row.Participants[j] = participant;
                }
                uint carrier = r.Varint();
                if (carrier != 0)
                {
                    var id = new RosterId(carrier);
                    if (!rosterIds.Contains(id)) throw new DecodeException(DecodeError.BadField, "carrier roster reference");
                    row.Carrier = id;
                }
                if (StateItem.QuestFlag(ref r, "quest flag")) row.DoneBy = QuestLabel(ref r);
                byte flags = r.U8();
                // 0x10: the carrier's actor id follows; without a carrier the flag is as unknown as 0x20..0x80.
                if ((flags & 0xe0) != 0 || ((flags & 0x10) != 0 && !row.Carrier.HasValue))
                    throw new DecodeException(DecodeError.BadField, "quest flags");
                if ((flags & 0x10) != 0)
                {
                    uint actor = r.Varint();
                    if (actor == 0) throw new DecodeException(DecodeError.BadField, "quest carrier actor");
                    row.CarrierActor = actor;
                }
                row.CanAccept = (flags & 1) != 0; row.OwnerAccepted = (flags & 2) != 0;
                row.OwnerCompleted = (flags & 4) != 0; row.OwnerReady = (flags & 8) != 0;
                row.OwnerProgress = r.Varint(); row.OwnerVisited = r.U8();
                if ((row.OwnerVisited & 0xe0) != 0) throw new DecodeException(DecodeError.BadField, "owner quest visited mask");
                row.Name = PresentationString(ref r); row.GiverLabel = PresentationString(ref r);
                row.Brief = PresentationString(ref r); row.Objective = PresentationString(ref r);
                row.Reward = PresentationString(ref r);
                view.Rows[i] = row;
            }
            view.Objectives = new WireQuestObjective[Count(ref r, 160)];
            var objectiveCounts = new Dictionary<QuestHandle, int>();
            for (int i = 0; i < view.Objectives.Length; i++)
            {
                var objective = new WireQuestObjective
                {
                    Quest = ReadQuestHandle(ref r), X = QuestPosition(ref r), Y = QuestPosition(ref r),
                };
                if (!questHandles.Contains(objective.Quest)) throw new DecodeException(DecodeError.BadField, "objective quest reference");
                objectiveCounts.TryGetValue(objective.Quest, out int count);
                if (count == 8) throw new DecodeException(DecodeError.TooMany, "objectives per quest");
                objectiveCounts[objective.Quest] = count + 1;
                view.Objectives[i] = objective;
            }
            if (r.Position - start > 24575) throw new DecodeException(DecodeError.TooLarge, "quest view bytes");
            return view;
        }
        internal static string PresentationString(ref Reader r)
        {
            string value = r.Str();
            if (Encoding.UTF8.GetByteCount(value) > 255) throw new DecodeException(DecodeError.BadField, "quest presentation string");
            return value;
        }
        internal static bool IsTradeStat(byte value) => value <= (byte)TradeStat.Shield;
        internal static bool TradePosition(double value) => Finite(value) && value >= 0 && value <= 8191.875;
        internal static WireTradeView ReadTradeView(ref Reader r)
        {
            var view = new WireTradeView { TradeUsed = QuestFlag(ref r, "trade used") };
            int offers = Count(ref r, 3);
            view.Offers = new WireTradeOffer[offers];
            for (int i = 0; i < offers; i++)
            {
                byte cost = r.U8(); if (!IsTradeStat(cost)) throw new DecodeException(DecodeError.BadField, "trade stat");
                double costValue = r.F64();
                byte gain = r.U8(); if (!IsTradeStat(gain)) throw new DecodeException(DecodeError.BadField, "trade stat");
                double gainValue = r.F64();
                string label = r.Str();
                if (cost == gain || !Finite(costValue) || costValue <= 0 || !Finite(gainValue) || gainValue <= 0)
                    throw new DecodeException(DecodeError.BadField, "trade offer");
                view.Offers[i] = new WireTradeOffer { Cost = (TradeStat)cost, CostValue = costValue,
                    Gain = (TradeStat)gain, GainValue = gainValue, Label = label };
            }
            int stats = Count(ref r, 7);
            view.Stats = new WireTradeDelta[stats];
            for (int i = 0; i < stats; i++)
            {
                byte stat = r.U8(); if (!IsTradeStat(stat)) throw new DecodeException(DecodeError.BadField, "trade stat");
                double value = r.F64();
                if (!Finite(value)) throw new DecodeException(DecodeError.BadField, "trade delta");
                view.Stats[i] = new WireTradeDelta { Stat = (TradeStat)stat, Value = value };
            }
            if (QuestFlag(ref r, "trade ready flag"))
            {
                double readyAt = r.F64();
                if (!Finite(readyAt) || readyAt < 0) throw new DecodeException(DecodeError.BadField, "trade ready time");
                view.BarterReadyAt = readyAt;
            }
            int merchants = Count(ref r, 2);
            view.Merchants = new WireMerchant[merchants];
            for (int i = 0; i < merchants; i++)
            {
                byte kind = r.U8(); if (kind > (byte)TradeKind.Stats) throw new DecodeException(DecodeError.BadField, "trade kind");
                double x = r.F64(), y = r.F64();
                string name = r.Str();
                if (!TradePosition(x) || !TradePosition(y)) throw new DecodeException(DecodeError.BadField, "trade position");
                view.Merchants[i] = new WireMerchant { Kind = (TradeKind)kind, X = x, Y = y, Name = name };
            }
            view.BarterLabels = new string[3];
            for (int i = 0; i < view.BarterLabels.Length; i++) view.BarterLabels[i] = r.Str();
            return view;
        }
        internal static byte? ReadPlanCode(ref Reader r) { byte v = r.U8(); if (v > 2) throw new DecodeException(DecodeError.BadField, "plan pick"); return v == 0 ? (byte?)null : (byte)(v - 1); }
        internal static void WritePlanCode(Writer w, byte? v) { if (v.HasValue && v.Value > 1) throw new EncodeException("plan pick"); w.U8(v.HasValue ? (byte)(v.Value + 1) : (byte)0); }
        internal static void WriteIndex(Writer w, uint? v) { if (v.HasValue) { w.U8(1); w.Varint(v.Value); } else w.U8(0); }
        internal static WirePlanOption? ReadPlanOption(ref Reader r)
        {
            if (!r.Flag()) return null;
            var o = new WirePlanOption { Index = r.Varint(), X = r.U16(), Y = r.U16(), Zone = r.U8() };
            if (o.Zone < 1 || o.Zone > 5) throw new DecodeException(DecodeError.BadField, "zone");
            if (r.Flag()) o.WalkSeconds = r.F32();
            if (o.WalkSeconds.HasValue && (!Finite(o.WalkSeconds.Value) || o.WalkSeconds.Value < 0)) throw new DecodeException(DecodeError.BadField, "walk");
            return o;
        }
        internal static void CheckPlanOption(WirePlanOption? o)
        {
            if (!o.HasValue) return;
            var v = o.Value;
            Require(v.Zone >= 1 && v.Zone <= 5, "zone");
            Require(!v.WalkSeconds.HasValue || (Finite(v.WalkSeconds.Value) && v.WalkSeconds.Value >= 0), "walk");
        }
        internal static void WritePlanOption(Writer w, WirePlanOption? o)
        {
            w.U8(o.HasValue ? (byte)1 : (byte)0);
            if (!o.HasValue) return;
            var v = o.Value;
            w.Varint(v.Index); w.U16(v.X); w.U16(v.Y); w.U8(v.Zone);
            if (v.WalkSeconds.HasValue) { w.U8(1); w.F32(v.WalkSeconds.Value); } else w.U8(0);
        }
        internal static int Count(ref Reader r, int max)
        {
            uint n = r.Varint();
            if (n > max) throw new DecodeException(DecodeError.TooMany, n.ToString());
            return (int)n;
        }

        internal static StateItem[] ReadAll(ref Reader r)
        {
            var items = new StateItem[Count(ref r, MaxKeys)]; uint previous = 0;
            for (int i = 0; i < items.Length; i++)
            {
                uint key = r.Varint();
                if (key <= previous) throw new DecodeException(DecodeError.BadField, "state key order");
                previous = key;
                StateItem item;
                switch (key)
                {
                    case 1:
                        var inv = new InventoryState();
                        if (r.Flag())
                        {
                            var v = new WireInventory { ActiveSlot = r.U8(), Slot0 = ReadWeapon(ref r), Slot1 = ReadWeapon(ref r), PotionSmall=r.U8(),PotionLarge=r.U8(),PotionsHealing=r.U8() };
                            // P-WIRE17-HUD-3: the slot, weapons and counts are checked before the clocks are read, as Rust and
                            // JS do, so a bad count stays BadField ("potion count") rather than Truncated.
                            try { new InventoryState { Value = v }.Check(); } catch (EncodeException e) { throw new DecodeException(DecodeError.BadField, e.Message); }
                            v.HealingUntil = r.Flag() ? r.F64() : (double?)null;
                            v.SpeedBoostUntil = r.Flag() ? r.F64() : (double?)null;
                            inv.Value = v;
                        }
                        item = inv; break;
                    case 2:
                        var props = new PropsState { Rows = new WireProp[Count(ref r, MaxRows)] };
                        for (int j = 0; j < props.Rows.Length; j++)
                        {
                            var row = new WireProp { Handle = new PickupHandle(Handle(ref r)), X = r.U16(), Y = r.U16(), Kind = (PropKind)r.U8() };
                            switch (row.Kind)
                            {
                                case PropKind.Ground: row.GroundWeapon = Weapon(r.U8()); break;
                                case PropKind.Chest: row.Open = r.Flag(); break;
                                case PropKind.Body: row.BodyLabel = r.Str(); break;
                                case PropKind.Corpse: row.CorpseLabel = r.Str(); break;
                                case PropKind.WindEmblem: break;
                                case PropKind.Cannon: row.ReadyAt = r.Varint(); break;
                                case PropKind.QuestItem: row.QuestRef = ReadQuestHandle(ref r); row.QuestFetch = QuestFlag(ref r, "flag"); break;
                                default: throw new DecodeException(DecodeError.BadField, "prop kind");
                            }
                            props.Rows[j] = row;
                        }
                        uint focus = r.Varint();
                        if (focus != 0) props.Focus = new WireFocus { Handle = new PickupHandle(focus), BodyHint = ReadWeapon(ref r) };
                        item = props; break;
                    case 3:
                        var fields = new FieldsState { Rows = new WireField[Count(ref r, MaxRows)] };
                        for (int j = 0; j < fields.Rows.Length; j++) fields.Rows[j] = FieldsState.ReadRow(ref r);
                        item = fields; break;
                    case 4:
                        var chests = new RewardChestsState { Rows = new WireRewardChest[Count(ref r, MaxRows)] };
                        for (int j = 0; j < chests.Rows.Length; j++)
                        {
                            var chest = new WireRewardChest { Handle = new RewardChestHandle(Handle(ref r)), X = r.U16(), Y = r.U16(), ExpiresAt = r.F64() };
                            byte n = r.U8(); if (n > 3) throw new DecodeException(DecodeError.TooMany);
                            chest.Options = new WireRewardOption[n];
                            for (int k = 0; k < n; k++)
                            {
                                byte kind = r.U8();
                                WireRewardOption option;
                                switch (kind)
                                {
                                    case 1: case 2:
                                        option = new WireRewardOption { Kind = kind, Id = r.U8() };
                                        break;
                                    case 3:
                                    {
                                        byte rawKey = r.U8();
                                        if (rawKey > (byte)TrophyStatKey.Leech) throw new DecodeException(DecodeError.BadField, "Trophy stat key");
                                        double gain = r.F64();
                                        if (!Finite(gain) || gain <= 0) throw new DecodeException(DecodeError.BadField, "Trophy gain");
                                        option = new WireRewardOption { Kind = kind, KillKey = (TrophyStatKey)rawKey, KillGain = gain };
                                        break;
                                    }
                                    default: throw new DecodeException(DecodeError.BadField, "reward option kind");
                                }
                                option.Taken = r.Flag();
                                option.TakenBy = ReadActor(ref r);
                                chest.Options[k] = option;
                            }
                            chest.Picked = r.Flag(); chest.CanChoose = r.Flag(); chests.Rows[j] = chest;
                        }
                        item = chests; break;
                    case 7:
                        var projectiles = new ProjectilesState { Rows=new WireProjectile[Count(ref r,MaxRows)] };
                        for(int j=0;j<projectiles.Rows.Length;j++) projectiles.Rows[j]=new WireProjectile {Kind=r.U8(),X=r.U16(),Y=r.U16(),Facing=r.U16(),Owner=ReadActor(ref r),Height=r.U8()};
                        item=projectiles;break;
                    case 6:
                        var camps = new CampsState { Rows = new WireCamp[Count(ref r, MaxRows)] };
                        for(int j=0;j<camps.Rows.Length;j++) camps.Rows[j]=CampsState.ReadRow(ref r);
                        item=camps; break;
                    case 5:
                        var build = new BuildState();
                        if (r.Flag())
                        {
                            var v = new WireBuild { Cards = new byte[80], Boosts = new byte[8] };
                            for (int j = 0; j < v.Cards.Length; j++) v.Cards[j] = r.U8();
                            for (int j = 0; j < v.Boosts.Length; j++) v.Boosts[j] = r.U8();
                            build.Value = v;
                        }
                        item = build; break;
                    case 8:
                        var plan = new PlanState();
                        if (r.Flag())
                        {
                            var v = new WirePlan { EndsAt = r.F64() };
                            v.Spawn0 = r.Flag() ? r.Varint() : (uint?)null;
                            v.Spawn1 = r.Flag() ? r.Varint() : (uint?)null;
                            v.Taken0 = r.Flag(); v.Taken1 = r.Flag();
                            v.Pick = ReadPlanCode(ref r);
                            uint nb = r.U8(); if (nb > 4) throw new DecodeException(DecodeError.TooMany, nb.ToString());
                            v.Boons = new string[nb];
                            for (int j = 0; j < nb; j++) v.Boons[j] = r.Str();
                            v.Boon = ReadPlanCode(ref r);
                            v.Ready = r.Flag();
                            v.Option0 = ReadPlanOption(ref r); v.Option1 = ReadPlanOption(ref r);
                            plan.Value = v;
                        }
                        item = plan; break;
                    case 9:
                        var arena = new ArenaState();
                        if (r.Flag()) arena.Value = new WireArena {
                            LobbyEndsAt = r.F64(), PlanEndsAt = r.F64(), RaidStartedAt = r.F64(),
                            PatienceEndsAt = r.Flag() ? r.F64() : (double?)null,
                            InColiseum = r.Flag(), GatesLocked = r.Flag(),
                            SuddenDeathAt = r.F64(), StartedWith = r.Varint(), MinPlayers = r.U8() };
                        item = arena; break;
                    case 10:
                        int questPayloadStart = r.Position;
                        var quests = new QuestsState { Available = QuestFlag(ref r, "quest flag") };
                        if (quests.Available) quests.View = ReadQuestView(ref r);
                        if (r.Position - questPayloadStart > 24576) throw new DecodeException(DecodeError.TooLarge, "quest view bytes");
                        item = quests; break;
                    case 11:
                        int tradePayloadStart = r.Position;
                        var trade = new TradeState { Available = QuestFlag(ref r, "trade availability") };
                        if (trade.Available) trade.Value = ReadTradeView(ref r);
                        if (r.Position - tradePayloadStart > 2213) throw new DecodeException(DecodeError.TooLarge, "trade view bytes");
                        item = trade; break;
                    case 12:
                        item = RosterState.Read(ref r); break;
                    case 13:
                        item = BuildSummaryState.Read(ref r); break;
                    default: throw new DecodeException(DecodeError.BadField, "state key");
                }
                try { item.Check(); } catch (EncodeException e) { throw new DecodeException(DecodeError.BadField, e.Message); }
                items[i] = item;
            }
            ValidateQuestPropReferences(items);
            return items;
        }

        // A frame that replaces both collections must be internally coherent before its
        // state can be applied. Frames that replace only one side are checked against the
        // retained collection by Collections before any mutation.
        static void ValidateQuestPropReferences(StateItem[] items)
        {
            PropsState props = null;
            QuestsState quests = null;
            foreach (var item in items)
            {
                if (item is PropsState p) props = p;
                else if (item is QuestsState q) quests = q;
            }
            if (props == null || quests == null) return;

            var handles = new HashSet<QuestHandle>();
            if (quests.Available && quests.View != null)
                foreach (var row in quests.View.Rows) handles.Add(row.Handle);
            foreach (var prop in props.Rows)
                if (prop.Kind == PropKind.QuestItem && (!quests.Available || !prop.QuestRef.IsValid || !handles.Contains(prop.QuestRef)))
                    throw new DecodeException(DecodeError.BadField, "quest prop reference");
        }
        internal static void WriteAll(Writer w, StateItem[] items)
        {
            Require(items != null && items.Length <= MaxKeys, "state keys"); uint previous = 0;
            foreach (var item in items) { Require(item != null && item.Key > previous, "state key order"); previous = item.Key; item.Check(); }
            w.Varint((uint)items.Length);
            foreach (var item in items) { w.Varint(item.Key); item.Write(w); }
        }
    }
    public sealed class InventoryState : StateItem
    {
        public override uint Key { get { return 1; } }
        public WireInventory? Value;
        internal override void Check()
        {
            if (!Value.HasValue) return;
            var v = Value.Value;
            Require(v.ActiveSlot < 2, "active slot"); Require(v.PotionSmall<=5 && v.PotionLarge<=5 && v.PotionsHealing<=3,"potion count"); CheckWeapon(v.Slot0); CheckWeapon(v.Slot1);
            // P-WIRE17-HUD-3: server ms, finite and non-negative; refused, never clamped.
            Require(ClockOk(v.HealingUntil) && ClockOk(v.SpeedBoostUntil), "inventory clock");
        }
        static bool ClockOk(double? t) { return !t.HasValue || (Finite(t.Value) && t.Value >= 0); }
        internal override void Write(Writer w)
        {
            w.U8(Value.HasValue ? (byte)1 : (byte)0);
            if (!Value.HasValue) return;
            var v = Value.Value;
            w.U8(v.ActiveSlot); WriteWeapon(w, v.Slot0); WriteWeapon(w, v.Slot1); w.U8(v.PotionSmall); w.U8(v.PotionLarge); w.U8(v.PotionsHealing);
            if (v.HealingUntil.HasValue) { w.U8(1); w.F64(v.HealingUntil.Value); } else w.U8(0);
            if (v.SpeedBoostUntil.HasValue) { w.U8(1); w.F64(v.SpeedBoostUntil.Value); } else w.U8(0);
        }
    }
    public sealed class PropsState : StateItem
    {
        public override uint Key { get { return 2; } }
        public WireProp[] Rows = Array.Empty<WireProp>();
        public WireFocus? Focus;
        internal override void Check()
        {
            Require(Rows != null && Rows.Length <= MaxRows, "props"); uint previous = 0; bool focused = !Focus.HasValue;
            foreach (var row in Rows)
            {
                Require(row.Handle.Value > previous, "prop handles"); previous = row.Handle.Value;
                switch (row.Kind)
                {
                    case PropKind.Ground: CheckWeapon(row.GroundWeapon); break;
                    case PropKind.Chest: break;
                    case PropKind.Body: Require(Encoding.UTF8.GetByteCount(row.BodyLabel ?? "") <= 255, "body label"); break;
                    case PropKind.Corpse: Require(Encoding.UTF8.GetByteCount(row.CorpseLabel ?? "") <= 255, "corpse label"); break;
                    case PropKind.WindEmblem: break;
                    case PropKind.Cannon: break;
                    case PropKind.QuestItem: Require(row.QuestRef.IsValid, "quest prop handle"); break;
                    default: throw new EncodeException("prop kind");
                }
                if (Focus.HasValue && row.Handle.Equals(Focus.Value.Handle))
                {
                    focused = true; CheckWeapon(Focus.Value.BodyHint);
                    Require(!Focus.Value.BodyHint.HasValue || row.Kind == PropKind.Body, "body hint");
                }
            }
            Require(focused, "prop focus");
        }
        internal override void Write(Writer w)
        {
            w.Varint((uint)Rows.Length);
            foreach (var row in Rows)
            {
                w.Varint(row.Handle.Value); w.U16(row.X); w.U16(row.Y); w.U8((byte)row.Kind);
                switch (row.Kind) { case PropKind.Ground: w.U8(row.GroundWeapon); break; case PropKind.Chest: w.U8(row.Open ? (byte)1 : (byte)0); break; case PropKind.Body: w.Str(row.BodyLabel); break; case PropKind.Corpse: w.Str(row.CorpseLabel); break; case PropKind.WindEmblem: break; case PropKind.Cannon: w.Varint(row.ReadyAt); break; case PropKind.QuestItem: w.Varint(row.QuestRef.Value); w.U8(row.QuestFetch ? (byte)1 : (byte)0); break; }
            }
            w.Varint(Focus.HasValue ? Focus.Value.Handle.Value : 0); if (Focus.HasValue) WriteWeapon(w, Focus.Value.BodyHint);
        }
    }
    public sealed class FieldsState : StateItem
    {
        public override uint Key { get { return 3; } }
        /// <summary>P-FROST-WALL-2: field kind codes (rh-protocol <c>FIELD_KIND_*</c>); a wall row carries a tile list.</summary>
        public const byte KindZone = 0, KindCloud = 1, KindTrail = 2, KindWall = 3;
        /// <summary>Kinds at or above this are refused ("field").</summary>
        public const byte KindCount = 4;
        /// <summary>Most tiles one wall row may carry (rh-protocol <c>MAX_WALL_TILES</c>).</summary>
        public const int MaxWallTiles = 64;
        public WireField[] Rows = Array.Empty<WireField>();

        /// <summary>The row's first fault in the Rust decoder's order (rh-protocol <c>WireField::check</c>): an unknown kind or
        /// tiles on a row that is not a wall "field"; a wall's tile count "wall tiles", a tile at or above the map tile cap
        /// "wall tile", tiles not strictly ascending "wall order"; then the common checks "field". Null when the row is valid.</summary>
        static string RowFault(WireField f)
        {
            int n = f.Tiles == null ? 0 : f.Tiles.Length;
            if (f.Kind >= KindCount || (f.Kind != KindWall && n != 0)) return "field";
            if (f.Kind == KindWall)
            {
                if (n == 0 || n > MaxWallTiles) return "wall tiles";
                foreach (var t in f.Tiles) if (t >= (uint)Wire.MaxMapTiles) return "wall tile";
                for (int i = 1; i < n; i++) if (f.Tiles[i - 1] >= f.Tiles[i]) return "wall order";
            }
            bool valid = f.Ability < 5 && f.Owner != 0 && f.Subject != 0
                && Finite(f.X) && Finite(f.Y) && Finite(f.X2) && Finite(f.Y2) && Finite(f.Radius) && Finite(f.Vx) && Finite(f.Vy)
                && f.Radius >= 0 && Finite(f.StartedAt) && Finite(f.EndsAt) && f.EndsAt >= f.StartedAt;
            return valid ? null : "field";
        }

        /// <summary>One key 3 row, refused as the Rust decoder refuses it, row by row: the common part is read whole; an
        /// unknown kind is refused before any tile list; a wall's count before its tiles, the whole list against what the
        /// frame still holds (Truncated) before any tile is read; then the row's checks.</summary>
        internal static WireField ReadRow(ref Reader r)
        {
            var f = new WireField
            {
                Kind = r.U8(), Ability = r.U8(), Owner = ReadActor(ref r), Subject = ReadActor(ref r),
                X = r.F32(), Y = r.F32(), X2 = r.F32(), Y2 = r.F32(), Radius = r.F32(), Vx = r.F32(), Vy = r.F32(),
                StartedAt = r.F64(), EndsAt = r.F64()
            };
            if (f.Kind >= KindCount) throw new DecodeException(DecodeError.BadField, "field");
            if (f.Kind == KindWall)
            {
                int count = r.U8();
                if (count == 0 || count > MaxWallTiles) throw new DecodeException(DecodeError.BadField, "wall tiles");
                if (r.Remaining < count * 4) throw new DecodeException(DecodeError.Truncated);
                f.Tiles = new uint[count];
                for (int i = 0; i < count; i++) f.Tiles[i] = r.U32();
            }
            string fault = RowFault(f);
            if (fault != null) throw new DecodeException(DecodeError.BadField, fault);
            return f;
        }

        internal override void Check()
        {
            Require(Rows != null && Rows.Length <= MaxRows, "fields");
            foreach (var f in Rows) { string fault = RowFault(f); Require(fault == null, fault); }
        }
        internal override void Write(Writer w)
        {
            w.Varint((uint)Rows.Length);
            foreach (var f in Rows)
            {
                w.U8(f.Kind); w.U8(f.Ability); WriteActor(w, f.Owner); WriteActor(w, f.Subject);
                w.F32(f.X); w.F32(f.Y); w.F32(f.X2); w.F32(f.Y2); w.F32(f.Radius); w.F32(f.Vx); w.F32(f.Vy); w.F64(f.StartedAt); w.F64(f.EndsAt);
                // A wall row only: its tile list (checked before writing, so the count fits a byte).
                if (f.Kind == KindWall) { w.U8((byte)f.Tiles.Length); foreach (var t in f.Tiles) w.U32(t); }
            }
        }
    }
    public sealed class RewardChestsState : StateItem
    {
        public override uint Key { get { return 4; } }
        public WireRewardChest[] Rows = Array.Empty<WireRewardChest>();
        internal override void Check()
        {
            Require(Rows != null && Rows.Length <= MaxRows, "reward chests"); uint previous = 0;
            foreach (var row in Rows)
            {
                Require(row != null && row.Handle.Value > previous && Finite(row.ExpiresAt) && row.Options != null && row.Options.Length <= 3, "reward chest");
                previous = row.Handle.Value;
                foreach (var o in row.Options)
                {
                    bool card = o.Kind == 1 && o.Id < 80 && !o.KillKey.HasValue && o.KillGain == 0;
                    bool boost = o.Kind == 2 && o.Id < 8 && !o.KillKey.HasValue && o.KillGain == 0;
                    bool kill = o.Kind == 3 && o.Id == 0 && o.KillKey.HasValue &&
                        (byte)o.KillKey.Value <= (byte)TrophyStatKey.Leech && Finite(o.KillGain) && o.KillGain > 0;
                    Require((card || boost || kill) && o.TakenBy != 0, "reward option");
                }
            }
        }
        internal override void Write(Writer w)
        {
            w.Varint((uint)Rows.Length);
            foreach (var row in Rows)
            {
                w.Varint(row.Handle.Value); w.U16(row.X); w.U16(row.Y); w.F64(row.ExpiresAt); w.U8((byte)row.Options.Length);
                foreach (var o in row.Options)
                {
                    w.U8(o.Kind);
                    if (o.Kind == 3) { w.U8((byte)o.KillKey.Value); w.F64(o.KillGain); }
                    else w.U8(o.Id);
                    w.U8(o.Taken ? (byte)1 : (byte)0); WriteActor(w, o.TakenBy);
                }
                w.U8(row.Picked ? (byte)1 : (byte)0); w.U8(row.CanChoose ? (byte)1 : (byte)0);
            }
        }
    }
    public sealed class BuildState : StateItem
    {
        public override uint Key { get { return 5; } }
        public WireBuild? Value;
        internal override void Check() { if (Value.HasValue) Require(Value.Value.Cards != null && Value.Value.Cards.Length == 80 && Value.Value.Boosts != null && Value.Value.Boosts.Length == 8, "build"); }
        internal override void Write(Writer w) { w.U8(Value.HasValue ? (byte)1 : (byte)0); if (Value.HasValue) { w.Bytes(Value.Value.Cards); w.Bytes(Value.Value.Boosts); } }
    }
    public sealed class CampsState : StateItem
    {
        public override uint Key { get { return 6; } }
        public WireCamp[] Rows = Array.Empty<WireCamp>();
        internal override void Check()
        {
            Require(Rows != null && Rows.Length <= MaxRows,"camps");
            foreach(var c in Rows) Require(c.MobType<30 && c.Elite<=30 && c.Alive<=512 && c.State<=2 && Finite(c.ClearedAt) && c.ClearedAt>=0 && Finite(c.RespawnAt) && c.RespawnAt>=c.ClearedAt
                && (!c.Reward.HasValue || (c.Reward.Value.Stat < Hud.StatCount && c.Reward.Value.Amount > 0))
                && (!c.Ward.HasValue || (Finite(c.Ward.Value.ExpiresAt) && c.Ward.Value.ExpiresAt >= 0)),"camp");
        }
        internal override void Write(Writer w)
        {
            w.Varint((uint)Rows.Length);
            foreach(var c in Rows)
            {
                w.U8(c.MobType);w.U8(c.Elite);w.Varint(c.Alive);w.U8(c.State);w.F64(c.ClearedAt);w.F64(c.RespawnAt);
                if (c.Reward.HasValue) { w.U8((byte)(1 + c.Reward.Value.Stat)); w.U16(c.Reward.Value.Amount); } else w.U8(0);
                if (c.Ward.HasValue) { w.U8(c.Ward.Value.Yours ? (byte)1 : (byte)2); w.F64(c.Ward.Value.ExpiresAt); } else w.U8(0);
            }
        }
        /// <summary>One row: the pre-HUD head, then reward u8 (0 none / 1 + stat code) [+ amount u16], then ward u8
        /// (0 none / 1 yours / 2 another player's) [+ expiry f64].</summary>
        internal static WireCamp ReadRow(ref Reader r)
        {
            var c = new WireCamp { MobType = r.U8(), Elite = r.U8(), Alive = r.Varint(), State = r.U8(), ClearedAt = r.F64(), RespawnAt = r.F64() };
            byte reward = r.U8();
            if (reward > Hud.StatCount) throw new DecodeException(DecodeError.BadField, "camp reward");
            if (reward != 0) c.Reward = new WireCampReward { Stat = (byte)(reward - 1), Amount = r.U16() };
            byte ward = r.U8();
            if (ward > 2) throw new DecodeException(DecodeError.BadField, "camp ward");
            if (ward != 0) c.Ward = new WireWard { Yours = ward == 1, ExpiresAt = r.F64() };
            return c;
        }
    }

    public sealed class ProjectilesState : StateItem
    {
        public override uint Key { get { return 7; } }
        public WireProjectile[] Rows=Array.Empty<WireProjectile>();
        internal override void Check()
        {
            Require(Rows!=null && Rows.Length<=MaxRows,"projectiles");
            foreach(var p in Rows) Require(p.Kind<=1 && p.Owner!=0,"projectile");
        }
        internal override void Write(Writer w)
        {
            w.Varint((uint)Rows.Length);
            foreach(var p in Rows) {w.U8(p.Kind);w.U16(p.X);w.U16(p.Y);w.U16(p.Facing);WriteActor(w,p.Owner);w.U8(p.Height);}
        }
    }

    /// <summary>Key 8: the viewer's own private planning deal; the server resolved every fact.</summary>
    public sealed class PlanState : StateItem
    {
        public override uint Key { get { return 8; } }
        public WirePlan Value;
        internal override void Check()
        {
            if (Value == null) return;
            Require(Finite(Value.EndsAt) && Value.EndsAt >= 0, "plan ends");
            Require(!Value.Pick.HasValue || Value.Pick.Value <= 1, "plan pick");
            Require(!Value.Boon.HasValue || Value.Boon.Value <= 1, "plan boon");
            Require(Value.Boons != null && Value.Boons.Length <= 4, "plan boons");
            foreach (var b in Value.Boons) Require(b != null && b.Length <= 255, "plan boon");
            CheckPlanOption(Value.Option0); CheckPlanOption(Value.Option1);
        }
        internal override void Write(Writer w)
        {
            w.U8(Value == null ? (byte)0 : (byte)1);
            if (Value == null) return;
            w.F64(Value.EndsAt);
            WriteIndex(w, Value.Spawn0); WriteIndex(w, Value.Spawn1);
            w.U8((byte)(Value.Taken0 ? 1 : 0)); w.U8((byte)(Value.Taken1 ? 1 : 0));
            WritePlanCode(w, Value.Pick);
            w.U8((byte)Value.Boons.Length);
            foreach (var b in Value.Boons) w.Str(b);
            WritePlanCode(w, Value.Boon);
            w.U8((byte)(Value.Ready ? 1 : 0));
            WritePlanOption(w, Value.Option0); WritePlanOption(w, Value.Option1);
        }
    }

    /// <summary>Key 9: the public source arena lifecycle view (typed absent deadlines; never Infinity).</summary>
    public sealed class ArenaState : StateItem
    {
        public override uint Key { get { return 9; } }
        public WireArena? Value;
        internal override void Check()
        {
            if (!Value.HasValue) return;
            var v = Value.Value;
            Require(Finite(v.LobbyEndsAt) && Finite(v.PlanEndsAt) && Finite(v.RaidStartedAt) && Finite(v.SuddenDeathAt)
                && v.LobbyEndsAt >= 0 && v.PlanEndsAt >= 0 && v.RaidStartedAt >= 0 && v.SuddenDeathAt >= 0, "arena time");
            Require(!v.PatienceEndsAt.HasValue || (Finite(v.PatienceEndsAt.Value) && v.PatienceEndsAt.Value >= 0), "arena patience");
            Require(v.StartedWith <= 512, "arena starters");
            Require(v.MinPlayers <= WireArena.MaxMinPlayers, "arena min players");
        }
        internal override void Write(Writer w)
        {
            w.U8(Value.HasValue ? (byte)1 : (byte)0);
            if (!Value.HasValue) return;
            var v = Value.Value;
            w.F64(v.LobbyEndsAt); w.F64(v.PlanEndsAt); w.F64(v.RaidStartedAt);
            if (v.PatienceEndsAt.HasValue) { w.U8(1); w.F64(v.PatienceEndsAt.Value); } else w.U8(0);
            w.U8((byte)(v.InColiseum ? 1 : 0)); w.U8((byte)(v.GatesLocked ? 1 : 0));
            w.F64(v.SuddenDeathAt); w.Varint(v.StartedWith); w.U8(v.MinPlayers);
        }
    }

    /// <summary>Key 10: unavailable is distinct from an available but empty owner-scoped quest view.</summary>
    public sealed class QuestsState : StateItem
    {
        public override uint Key { get { return 10; } }
        public bool Available;
        public WireQuestView View;
        internal override void Check()
        {
            Require(Available == (View != null), "quest availability");
            if (!Available) return;
            QuestStateCodec.CheckQuestView(View);
            var bounded = new Writer();
            QuestStateCodec.WriteQuestView(bounded, View);
            Require(bounded.Finish().Length + 1 <= 24576, "quest view too large");
        }
        internal override void Write(Writer w)
        {
            w.U8(Available ? (byte)1 : (byte)0);
            if (Available) QuestStateCodec.WriteQuestView(w, View);
        }
    }

    /// <summary>Key 11: unavailable differs from an available view with empty rows; omitted key retains.</summary>
    public sealed class TradeState : StateItem
    {
        public override uint Key { get { return 11; } }
        public bool Available;
        public WireTradeView Value;
        internal override void Check()
        {
            Require(Available == (Value != null), "trade availability");
            if (Available) TradeStateCodec.Check(Value);
            if (Available)
            {
                var bounded = new Writer(); TradeStateCodec.Write(bounded, Value);
                Require(bounded.Finish().Length + 1 <= 2213, "trade view too large");
            }
        }
        internal override void Write(Writer w)
        {
            w.U8(Available ? (byte)1 : (byte)0);
            if (Available) TradeStateCodec.Write(w, Value);
        }
    }

    /// <summary>One seated player of the roster (State key 12, protocol 16, ADR0026): its actor id, display name and bot flag.</summary>
    public struct WireRosterRow { public uint Id; public bool Bot; public string Name; }

    /// <summary>
    /// Key 12: the match roster, the one match-wide indicator fact (names and bot flags of everyone seated, the same for every
    /// viewer; no position, faction, health or sight fact). Wire: count u8 (at most 32), then rows ascending by id: id varint
    /// (nonzero), flags u8 (bit 0 bot; other values refused), name (u8 length, 1..24 UTF-8 bytes, no control character).
    /// A complete replacement, like every key.
    /// </summary>
    public sealed class RosterState : StateItem
    {
        public const int MaxCount = 32, MaxName = 24;
        public override uint Key { get { return 12; } }
        public WireRosterRow[] Rows = Array.Empty<WireRosterRow>();

        internal static string NameFault(string name)
        {
            if (name == null) return "roster name";
            int n = Encoding.UTF8.GetByteCount(name);
            if (n < 1 || n > MaxName) return "roster name";
            foreach (char c in name) if (char.IsControl(c)) return "roster name";
            return null;
        }

        internal override void Check()
        {
            Require(Rows != null && Rows.Length <= MaxCount, "roster count");
            uint previous = 0;
            for (int i = 0; i < Rows.Length; i++)
            {
                Require(Rows[i].Id != 0, "roster id");
                Require(i == 0 || Rows[i].Id > previous, "roster order");
                previous = Rows[i].Id;
                Require(NameFault(Rows[i].Name) == null, "roster name");
            }
        }

        internal override void Write(Writer w)
        {
            w.U8((byte)Rows.Length);
            foreach (var row in Rows) { w.Varint(row.Id); w.U8(row.Bot ? (byte)1 : (byte)0); w.Str(row.Name); }
        }

        internal static RosterState Read(ref Reader r)
        {
            int n = r.U8();
            if (n > MaxCount) throw new DecodeException(DecodeError.BadField, "roster count");
            var rows = n == 0 ? Array.Empty<WireRosterRow>() : new WireRosterRow[n];
            uint previous = 0;
            for (int i = 0; i < n; i++)
            {
                uint id = r.Varint();
                if (id == 0) throw new DecodeException(DecodeError.BadField, "roster id");
                if (i > 0 && id <= previous) throw new DecodeException(DecodeError.BadField, "roster order");
                previous = id;
                byte flags = r.U8();
                if (flags > 1) throw new DecodeException(DecodeError.BadField, "roster flags");
                string name = r.Str();
                if (NameFault(name) != null) throw new DecodeException(DecodeError.BadField, "roster name");
                rows[i] = new WireRosterRow { Id = id, Bot = flags == 1, Name = name };
            }
            return new RosterState { Rows = rows };
        }
    }

    /// <summary>
    /// Key 13 (P-WIRE17-HUD-1): the owning seat's build summary, never another seat's; Value null when unseated. Wire:
    /// present u8 (0/1); when 1: 9 x i32 gains, count u8 (at most 20), rows of mob u8 (below 30, strictly ascending),
    /// stat u8 (below 9), stacks varint (at least 1), total i32; then (P-WIRE17-HUD-2) the champion panel: count u8 (at
    /// most 23, refused before the rows), rows of code u8 (below 23, strictly ascending) and value i32.
    /// </summary>
    public sealed class BuildSummaryState : StateItem
    {
        public override uint Key { get { return 13; } }
        public WireBuildSummary Value;

        static string Fault(WireBuildSummary v)
        {
            if (v.Gains == null || v.Gains.Length != 9 || v.MobRows == null || v.Panel == null) return "build summary";
            int previous = -1;
            foreach (var row in v.MobRows)
            {
                if (row.MobType >= 30) return "summary mob code";
                if (row.MobType <= previous) return "summary mob order";
                previous = row.MobType;
                if (row.Stat >= Hud.StatCount) return "summary stat code";
                if (row.Stacks == 0) return "summary stacks";
            }
            previous = -1;
            foreach (var row in v.Panel)
            {
                if (row.Code >= Hud.PanelCodeCount) return "summary panel code";
                if (row.Code <= previous) return "summary panel order";
                previous = row.Code;
            }
            return null;
        }

        internal override void Check()
        {
            if (Value == null) return;
            Require(Value.MobRows == null || Value.MobRows.Length <= Hud.MaxSummaryMobRows, "summary mob rows");
            Require(Value.Panel == null || Value.Panel.Length <= Hud.MaxPanelValues, "summary panel values");
            string fault = Fault(Value);
            Require(fault == null, fault);
        }

        internal override void Write(Writer w)
        {
            w.U8(Value != null ? (byte)1 : (byte)0);
            if (Value == null) return;
            foreach (int g in Value.Gains) w.U32(unchecked((uint)g));
            w.U8((byte)Value.MobRows.Length);
            foreach (var row in Value.MobRows) { w.U8(row.MobType); w.U8(row.Stat); w.Varint(row.Stacks); w.U32(unchecked((uint)row.Total)); }
            w.U8((byte)Value.Panel.Length);
            foreach (var row in Value.Panel) { w.U8(row.Code); w.U32(unchecked((uint)row.Value)); }
        }

        internal static BuildSummaryState Read(ref Reader r)
        {
            if (!r.Flag()) return new BuildSummaryState();
            var v = new WireBuildSummary();
            for (int i = 0; i < 9; i++) v.Gains[i] = unchecked((int)r.U32());
            int n = r.U8();
            if (n > Hud.MaxSummaryMobRows) throw new DecodeException(DecodeError.TooMany, n.ToString());
            v.MobRows = n == 0 ? Array.Empty<WireMobBonusRow>() : new WireMobBonusRow[n];
            for (int i = 0; i < n; i++)
                v.MobRows[i] = new WireMobBonusRow { MobType = r.U8(), Stat = r.U8(), Stacks = r.Varint(), Total = unchecked((int)r.U32()) };
            int m = r.U8();
            if (m > Hud.MaxPanelValues) throw new DecodeException(DecodeError.TooMany, m.ToString());
            v.Panel = m == 0 ? Array.Empty<WirePanelValue>() : new WirePanelValue[m];
            for (int i = 0; i < m; i++)
                v.Panel[i] = new WirePanelValue { Code = r.U8(), Value = unchecked((int)r.U32()) };
            string fault = Fault(v);
            if (fault != null) throw new DecodeException(DecodeError.BadField, fault);
            return new BuildSummaryState { Value = v };
        }
    }

    internal static class TradeStateCodec
    {
        static bool Label(string value) => value != null && Encoding.UTF8.GetByteCount(value) <= 255;
        internal static void Check(WireTradeView view)
        {
            StateItem.Require(view != null && view.Offers != null && view.Offers.Length <= 3, "trade offers");
            StateItem.Require(view.Stats != null && view.Stats.Length <= 7, "trade stats");
            StateItem.Require(!view.BarterReadyAt.HasValue || (StateItem.Finite(view.BarterReadyAt.Value) && view.BarterReadyAt.Value >= 0), "trade ready time");
            StateItem.Require(view.Merchants != null && view.Merchants.Length <= 2, "trade merchants");
            StateItem.Require(view.BarterLabels != null && view.BarterLabels.Length == 3, "barter labels");
            foreach (var offer in view.Offers)
                StateItem.Require((byte)offer.Cost <= (byte)TradeStat.Shield && (byte)offer.Gain <= (byte)TradeStat.Shield && offer.Cost != offer.Gain
                    && StateItem.Finite(offer.CostValue) && offer.CostValue > 0 && StateItem.Finite(offer.GainValue)
                    && offer.GainValue > 0 && Label(offer.Label), "trade offer");
            foreach (var stat in view.Stats)
                StateItem.Require((byte)stat.Stat <= (byte)TradeStat.Shield && StateItem.Finite(stat.Value), "trade stat");
            foreach (var merchant in view.Merchants)
                StateItem.Require((byte)merchant.Kind <= (byte)TradeKind.Stats && StateItem.TradePosition(merchant.X)
                    && StateItem.TradePosition(merchant.Y) && Label(merchant.Name), "trade merchant");
            foreach (string label in view.BarterLabels) StateItem.Require(Label(label), "barter label");
        }
        internal static void Write(Writer w, WireTradeView view)
        {
            w.U8(view.TradeUsed ? (byte)1 : (byte)0);
            w.Varint((uint)view.Offers.Length);
            foreach (var offer in view.Offers)
            {
                w.U8((byte)offer.Cost); w.F64(offer.CostValue); w.U8((byte)offer.Gain); w.F64(offer.GainValue); w.Str(offer.Label);
            }
            w.Varint((uint)view.Stats.Length);
            foreach (var stat in view.Stats) { w.U8((byte)stat.Stat); w.F64(stat.Value); }
            if (view.BarterReadyAt.HasValue) { w.U8(1); w.F64(view.BarterReadyAt.Value); } else w.U8(0);
            w.Varint((uint)view.Merchants.Length);
            foreach (var merchant in view.Merchants)
            {
                w.U8((byte)merchant.Kind); w.F64(merchant.X); w.F64(merchant.Y); w.Str(merchant.Name);
            }
            foreach (string label in view.BarterLabels) w.Str(label);
        }
    }

    internal static class QuestStateCodec
    {
    internal static void CheckQuestView(WireQuestView view)
    {
        StateItem.Require(view.UnknownCount <= 20 && view.DisplayUnknownCount <= view.UnknownCount, "quest unknown count");
        StateItem.Require(view.Roster != null && view.Roster.Length <= 8, "quest roster");
        StateItem.Require(view.Rows != null && view.Rows.Length <= 20, "quest rows");
        StateItem.Require(view.Objectives != null && view.Objectives.Length <= 160, "quest objectives");
        var rosterIds = new HashSet<RosterId>();
        foreach (var entry in view.Roster)
        {
            StateItem.Require(entry != null && entry.Id.IsValid && rosterIds.Add(entry.Id), "quest roster id");
            StateItem.Require(entry.Label != null && Encoding.UTF8.GetByteCount(entry.Label) <= 255, "quest roster label");
        }
        StateItem.Require(!view.OwnerRoster.HasValue || (view.OwnerRoster.Value.IsValid && rosterIds.Contains(view.OwnerRoster.Value)), "quest owner roster");
        var handles = new HashSet<QuestHandle>();
        foreach (var row in view.Rows)
        {
            StateItem.Require(row != null && row.Handle.IsValid && handles.Add(row.Handle), "quest handle");
            StateItem.Require(row.Def != null && row.Def.Length != 0 && Encoding.UTF8.GetByteCount(row.Def) <= 16, "quest definition");
            StateItem.Require(Label(row.Name) && Label(row.GiverLabel) && Label(row.Brief)
                && Label(row.Objective) && Label(row.Reward), "quest presentation string");
            StateItem.Require(QuestPositionValid(row.GiverX) && QuestPositionValid(row.GiverY), "quest giver position");
            StateItem.Require((byte)row.State <= (byte)QuestRowState.Expired && StateItem.Finite(row.ExpiresAt) && row.ExpiresAt >= 0, "quest row state/time");
            StateItem.Require(row.Participants != null && row.Participants.Length <= 8, "quest participants");
            var participantIds = new HashSet<RosterId>();
            foreach (var participant in row.Participants)
            {
                StateItem.Require(participant.Id.IsValid && rosterIds.Contains(participant.Id) && participantIds.Add(participant.Id)
                    && (participant.Visited & 0xe0) == 0, "quest participant");
            }
            StateItem.Require(!row.Carrier.HasValue || (row.Carrier.Value.IsValid && rosterIds.Contains(row.Carrier.Value)), "quest carrier");
            StateItem.Require(!row.CarrierActor.HasValue || (row.Carrier.HasValue && row.CarrierActor.Value != 0), "quest carrier actor");
            StateItem.Require(row.DoneBy == null || Encoding.UTF8.GetByteCount(row.DoneBy) <= 255, "quest done by");
            StateItem.Require((row.OwnerVisited & 0xe0) == 0, "quest owner visited");
        }
        var objectiveCounts = new Dictionary<QuestHandle, int>();
        foreach (var objective in view.Objectives)
        {
            StateItem.Require(objective.Quest.IsValid && handles.Contains(objective.Quest)
                && QuestPositionValid(objective.X) && QuestPositionValid(objective.Y), "quest objective");
            objectiveCounts.TryGetValue(objective.Quest, out int count);
            StateItem.Require(count < 8, "quest objectives per row");
            objectiveCounts[objective.Quest] = count + 1;
        }
    }

    static bool QuestPositionValid(double value) => StateItem.Finite(value) && value >= 0 && value <= 8191.875;
    static bool Label(string value) => value != null && Encoding.UTF8.GetByteCount(value) <= 255;

    internal static void WriteQuestView(Writer w, WireQuestView view)
    {
        w.Varint(view.UnknownCount); w.Varint(view.DisplayUnknownCount); w.Varint(view.OwnerRoster.HasValue ? view.OwnerRoster.Value.Value : 0);
        w.Varint((uint)view.Roster.Length);
        foreach (var entry in view.Roster) { w.Varint(entry.Id.Value); w.Str(entry.Label); }
        w.Varint((uint)view.Rows.Length);
        foreach (var row in view.Rows)
        {
            w.Varint(row.Handle.Value); w.Str(row.Def); w.F64(row.GiverX); w.F64(row.GiverY); w.U8((byte)row.State); w.F64(row.ExpiresAt);
            w.Varint((uint)row.Participants.Length);
            foreach (var participant in row.Participants)
            {
                w.Varint(participant.Id.Value); w.U8(participant.Accepted ? (byte)1 : (byte)0); w.Varint(participant.Progress); w.U8(participant.Visited);
            }
            w.Varint(row.Carrier.HasValue ? row.Carrier.Value.Value : 0);
            w.U8(row.DoneBy == null ? (byte)0 : (byte)1); if (row.DoneBy != null) w.Str(row.DoneBy);
            byte flags = (byte)((row.CanAccept ? 1 : 0) | (row.OwnerAccepted ? 2 : 0) | (row.OwnerCompleted ? 4 : 0) | (row.OwnerReady ? 8 : 0)
                | (row.CarrierActor.HasValue ? 0x10 : 0));
            w.U8(flags);
            if (row.CarrierActor.HasValue) w.Varint(row.CarrierActor.Value);
            w.Varint(row.OwnerProgress); w.U8(row.OwnerVisited);
            w.Str(row.Name); w.Str(row.GiverLabel); w.Str(row.Brief); w.Str(row.Objective); w.Str(row.Reward);
        }
        w.Varint((uint)view.Objectives.Length);
        foreach (var objective in view.Objectives) { w.Varint(objective.Quest.Value); w.F64(objective.X); w.F64(objective.Y); }
    }
    }

}
