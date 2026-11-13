using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    public enum PropAppearance : byte { Ground = 1, Chest = 2, Body = 3, Corpse = 4, WindEmblem = 5, Cannon = 6, QuestItem = 7 }
    public enum AreaKind : byte { Zone, Cloud, Trail }
    public enum AbilityId : byte { Freeze, Swarm, Trial, Blaze, LastStand }
    public enum CardId : byte { SlowBurn, PocketSand, Siphon }
    public enum BoostId : byte { Ad, Ap, Armor, Shield, MaxHp, AttackSpeed, MoveSpeed, Lifesteal }
    public enum ProjectileKind : byte { Arrow=0,Ball=1 }
    public struct NetProjectileView
    {
        public ProjectileKind Kind; public float X,Y,Facing; public uint? Owner;
        /// <summary>Whole sim units the projectile is drawn above its ground position (protocol 16, ADR0024): the shooter's chest at launch, 0 under legacy hitboxes.</summary>
        public float Height;
    }
    public struct CampView
    {
        public MobTypeId MobType; public MobTypeId? Elite; public uint Alive; public byte State; public double ClearedAt,RespawnAt;
        /// <summary>P-WIRE17-HUD-1: the per-kill reward (stat code and quantized amount; Value scales it), or null.</summary>
        public WireCampReward? Reward;
        /// <summary>P-WIRE17-HUD-1: the ward verdict for this viewer; None when no live ward.</summary>
        public WardVerdict Ward;
        /// <summary>The ward's expiry (server ms) when Ward is not None; 0 otherwise.</summary>
        public double WardExpiresAt;
    }

    /// <summary>A camp ward as this viewer sees it (never the owner's id).</summary>
    public enum WardVerdict : byte { None = 0, Yours = 1, Other = 2 }
    public struct InventoryView
    {
        public byte ActiveSlot, PotionSmall, PotionLarge, PotionsHealing; public WeaponId? Slot0, Slot1;
        /// <summary>P-WIRE17-HUD-3: when the owner's healing potions end (server ms); null when none runs.</summary>
        public double? HealingUntil;
        /// <summary>P-WIRE17-HUD-3: when the owner's wind-emblem speed boost ends (server ms); null when none runs.</summary>
        public double? SpeedBoostUntil;
    }
    public struct PropView
    {
        public PickupHandle Handle;
        public float X, Y;
        public PropAppearance Kind;
        public WeaponId? Weapon, BodyHint;
        public QuestHandle QuestRef;
        public bool QuestFetch;
        public bool Open, Focused;
        public string BodyLabel, CorpseLabel;
        /// <summary>Server-time reload deadline, in milliseconds; presentation only.</summary>
        public uint ReadyAt;
    }
    public struct AreaView
    {
        public AreaKind Kind;
        public AbilityId Ability;
        public uint? Owner, Subject;
        public float X, Y, X2, Y2, Radius, Vx, Vy;
        public double StartedAt, EndsAt;
    }
    public struct RewardOptionView
    {
        public CardId? Card;
        public BoostId? Boost;
        public TrophyStatKey? KillKey;
        public double KillGain;
        public bool Taken;
        public uint? TakenBy;
    }
    public sealed class RewardChestView
    {
        public RewardChestHandle Handle { get; internal set; }
        public float X { get; internal set; }
        public float Y { get; internal set; }
        public double ExpiresAt { get; internal set; }
        public bool Picked { get; internal set; }
        public bool CanChoose { get; internal set; }
        public IReadOnlyList<RewardOptionView> Options { get; internal set; }
    }

    public readonly struct PlanOptionView
    {
        public uint Index { get; }
        public float X { get; }
        public float Y { get; }
        public byte Zone { get; }
        public float? WalkSeconds { get; }
        internal PlanOptionView(WirePlanOption v)
        {
            Index = v.Index; X = Quant.DequantizePos(v.X); Y = Quant.DequantizePos(v.Y);
            Zone = v.Zone; WalkSeconds = v.WalkSeconds;
        }
    }
    /// <summary>An owned private deal, copied from the validated reliable State record.</summary>
    public sealed class PlanView
    {
        public double EndsAt { get; }
        public uint? Spawn0 { get; }
        public uint? Spawn1 { get; }
        public bool Taken0 { get; }
        public bool Taken1 { get; }
        public byte? Pick { get; }
        public byte? Boon { get; }
        public bool Ready { get; }
        public IReadOnlyList<string> Boons { get; }
        public PlanOptionView? Option0 { get; }
        public PlanOptionView? Option1 { get; }
        internal PlanView(WirePlan v)
        {
            EndsAt = v.EndsAt; Spawn0 = v.Spawn0; Spawn1 = v.Spawn1; Taken0 = v.Taken0; Taken1 = v.Taken1;
            Pick = v.Pick; Boon = v.Boon; Ready = v.Ready;
            Boons = Array.AsReadOnly((string[])v.Boons.Clone());
            Option0 = v.Option0.HasValue ? new PlanOptionView(v.Option0.Value) : (PlanOptionView?)null;
            Option1 = v.Option1.HasValue ? new PlanOptionView(v.Option1.Value) : (PlanOptionView?)null;
        }
    }
    public struct ArenaView
    {
        public double LobbyEndsAt, PlanEndsAt, RaidStartedAt, SuddenDeathAt;
        public double? PatienceEndsAt;
        public bool InColiseum, GatesLocked;
        public uint StartedWith;
        /// <summary>P-WIRE17-HUD-3: the room's minimum players ("Waiting for players n/min").</summary>
        public byte MinPlayers;
    }
    public sealed class QuestRosterEntryView
    {
        public RosterId Id { get; }
        public string Label { get; }
        internal QuestRosterEntryView(WireQuestRosterEntry source) { Id = source.Id; Label = source.Label; }
    }
    public readonly struct QuestParticipantView
    {
        public RosterId Id { get; }
        public bool Accepted { get; }
        public uint Progress { get; }
        public byte Visited { get; }
        internal QuestParticipantView(WireQuestParticipant source) { Id = source.Id; Accepted = source.Accepted; Progress = source.Progress; Visited = source.Visited; }
    }
    public sealed class QuestRowView
    {
        public QuestHandle Handle { get; }
        public string Def { get; }
        public double GiverX { get; }
        public double GiverY { get; }
        public QuestRowState State { get; }
        public double ExpiresAt { get; }
        public IReadOnlyList<QuestParticipantView> Participants { get; }
        public RosterId? Carrier { get; }
        /// <summary>P-WIRE17-MAP-2: the carrier's public actor id (its snapshot actor id) while this viewer is delivered that
        /// fighter (the local player included); null when unseen or without a carrier.</summary>
        public uint? CarrierActor { get; }
        public string DoneBy { get; }
        public bool CanAccept { get; }
        public bool OwnerAccepted { get; }
        public bool OwnerCompleted { get; }
        public bool OwnerReady { get; }
        public uint OwnerProgress { get; }
        public byte OwnerVisited { get; }
        public string Name { get; }
        public string GiverLabel { get; }
        public string Brief { get; }
        public string Objective { get; }
        public string Reward { get; }
        internal QuestRowView(WireQuestRow source)
        {
            Handle = source.Handle; Def = source.Def; GiverX = source.GiverX; GiverY = source.GiverY; State = source.State; ExpiresAt = source.ExpiresAt;
            var participants = new QuestParticipantView[source.Participants.Length];
            for (int i = 0; i < participants.Length; i++) participants[i] = new QuestParticipantView(source.Participants[i]);
            Participants = Array.AsReadOnly(participants); Carrier = source.Carrier; CarrierActor = source.CarrierActor; DoneBy = source.DoneBy;
            CanAccept = source.CanAccept; OwnerAccepted = source.OwnerAccepted; OwnerCompleted = source.OwnerCompleted; OwnerReady = source.OwnerReady;
            OwnerProgress = source.OwnerProgress; OwnerVisited = source.OwnerVisited;
            Name = source.Name; GiverLabel = source.GiverLabel; Brief = source.Brief; Objective = source.Objective; Reward = source.Reward;
        }
    }

    public readonly struct TradeOfferView
    {
        public Protocol.TradeStat Cost { get; }
        public double CostValue { get; }
        public Protocol.TradeStat Gain { get; }
        public double GainValue { get; }
        public string Label { get; }
        internal TradeOfferView(Protocol.WireTradeOffer value)
        { Cost = value.Cost; CostValue = value.CostValue; Gain = value.Gain; GainValue = value.GainValue; Label = value.Label; }
    }
    public readonly struct TradeDeltaView
    {
        public Protocol.TradeStat Stat { get; }
        public double Value { get; }
        internal TradeDeltaView(Protocol.WireTradeDelta value) { Stat = value.Stat; Value = value.Value; }
    }
    public readonly struct MerchantView
    {
        public Protocol.TradeKind Kind { get; }
        public double X { get; }
        public double Y { get; }
        public string Name { get; }
        internal MerchantView(Protocol.WireMerchant value) { Kind = value.Kind; X = value.X; Y = value.Y; Name = value.Name; }
    }
    /// <summary>Owned copy of one complete Trade replacement; unavailable differs from available-empty.</summary>
    public sealed class TradeView
    {
        public bool Available { get; }
        public bool TradeUsed { get; }
        public IReadOnlyList<TradeOfferView> Offers { get; }
        public IReadOnlyList<TradeDeltaView> Stats { get; }
        public double? BarterReadyAt { get; }
        public IReadOnlyList<MerchantView> Merchants { get; }
        public IReadOnlyList<string> BarterLabels { get; }
        internal TradeView(TradeState source)
        {
            Available = source.Available;
            if (!Available)
            {
                TradeUsed = false; Offers = Array.Empty<TradeOfferView>(); Stats = Array.Empty<TradeDeltaView>();
                BarterReadyAt = null; Merchants = Array.Empty<MerchantView>(); BarterLabels = Array.Empty<string>();
                return;
            }
            var value = source.Value;
            TradeUsed = value.TradeUsed; BarterReadyAt = value.BarterReadyAt;
            var offers = new TradeOfferView[value.Offers.Length];
            for (int i = 0; i < offers.Length; i++) offers[i] = new TradeOfferView(value.Offers[i]);
            Offers = Array.AsReadOnly(offers);
            var stats = new TradeDeltaView[value.Stats.Length];
            for (int i = 0; i < stats.Length; i++) stats[i] = new TradeDeltaView(value.Stats[i]);
            Stats = Array.AsReadOnly(stats);
            var merchants = new MerchantView[value.Merchants.Length];
            for (int i = 0; i < merchants.Length; i++) merchants[i] = new MerchantView(value.Merchants[i]);
            Merchants = Array.AsReadOnly(merchants);
            BarterLabels = Array.AsReadOnly((string[])value.BarterLabels.Clone());
        }
    }
    public readonly struct QuestObjectiveView
    {
        public QuestHandle Quest { get; }
        public double X { get; }
        public double Y { get; }
        internal QuestObjectiveView(WireQuestObjective source) { Quest = source.Quest; X = source.X; Y = source.Y; }
    }
    /// <summary>Owned, presentation-only copy of one reliable quest replacement. Unavailable differs from no replacement yet.</summary>
    public sealed class QuestView
    {
        public bool Available { get; }
        public uint UnknownCount { get; }
        public uint DisplayUnknownCount { get; }
        public RosterId? OwnerRoster { get; }
        public IReadOnlyList<QuestRosterEntryView> Roster { get; }
        public IReadOnlyList<QuestRowView> Rows { get; }
        public IReadOnlyList<QuestObjectiveView> Objectives { get; }
        internal QuestView(QuestsState source)
        {
            Available = source.Available;
            if (!Available)
            {
                UnknownCount = 0; DisplayUnknownCount = 0; OwnerRoster = null;
                Roster = Array.Empty<QuestRosterEntryView>(); Rows = Array.Empty<QuestRowView>(); Objectives = Array.Empty<QuestObjectiveView>();
                return;
            }
            var view = source.View;
            UnknownCount = view.UnknownCount; DisplayUnknownCount = view.DisplayUnknownCount; OwnerRoster = view.OwnerRoster;
            var roster = new QuestRosterEntryView[view.Roster.Length];
            for (int i = 0; i < roster.Length; i++) roster[i] = new QuestRosterEntryView(view.Roster[i]);
            var rows = new QuestRowView[view.Rows.Length];
            for (int i = 0; i < rows.Length; i++) rows[i] = new QuestRowView(view.Rows[i]);
            var objectives = new QuestObjectiveView[view.Objectives.Length];
            for (int i = 0; i < objectives.Length; i++) objectives[i] = new QuestObjectiveView(view.Objectives[i]);
            Roster = Array.AsReadOnly(roster); Rows = Array.AsReadOnly(rows); Objectives = Array.AsReadOnly(objectives);
        }
    }
    internal sealed class InvalidCollectionStateException : Exception
    {
        public InvalidCollectionStateException(string message) : base(message) { }
    }

    /// <summary>
    /// Owned presentation facts from the reliable State channel. Socket order, rather than snapshot age,
    /// controls replacement: a reliable update can precede a newer coalesced snapshot. No gameplay is computed here.
    /// </summary>
    /// <summary>
    /// One seated player of the match roster (State key 12, protocol 16, ADR0026): the native actor id, the display name drawn over
    /// its head and in the kill feed, and whether it is a bot. The same for every viewer; it says nothing about where anyone is.
    /// </summary>
    public sealed class RosterEntry
    {
        public uint Id { get; }
        public string Name { get; }
        public bool Bot { get; }
        internal RosterEntry(uint id, string name, bool bot) { Id = id; Name = name; Bot = bot; }
    }

    public sealed class CollectionsView
    {
        public uint Tick { get; private set; }
        public InventoryView? Inventory { get; private set; }
        public IReadOnlyList<PropView> Props { get; private set; } = Array.Empty<PropView>();
        public PropView? Focus { get; private set; }
        public IReadOnlyList<AreaView> Fields { get; private set; } = Array.Empty<AreaView>();
        public IReadOnlyList<RewardChestView> RewardChests { get; private set; } = Array.Empty<RewardChestView>();
        public IReadOnlyList<byte> Cards { get; private set; } = Array.Empty<byte>();
        public IReadOnlyList<byte> Boosts { get; private set; } = Array.Empty<byte>();
        public IReadOnlyList<CampView> Camps { get; private set; } = Array.Empty<CampView>();
        public IReadOnlyList<NetProjectileView> Projectiles { get; private set; } = Array.Empty<NetProjectileView>();
        public bool HasBuild { get; private set; }
        public PlanView Plan { get; private set; }
        public ArenaView? Arena { get; private set; }
        /// <summary>Null means key 10 has not yet been received; a non-null unavailable view is a received disabled state.</summary>
        public QuestView Quests { get; private set; }
        /// <summary>Null means State key 11 has not arrived; unavailable is an explicit complete replacement.</summary>
        public TradeView Trade { get; private set; }
        /// <summary>The match roster (State key 12), ascending by id; empty before the key arrives. Each key-12 frame replaces it.</summary>
        public IReadOnlyList<RosterEntry> Roster { get; private set; } = Array.Empty<RosterEntry>();
        /// <summary>The owner's own GAINED strip (State key 13), as delivered (quantized; WireBuildSummary.Gain scales);
        /// null when unseated or before the key arrives.</summary>
        public WireBuildSummary Summary { get; private set; }
        const uint KnownStateMask =
            (1u << ((int)StateKey.Inventory - 1)) | (1u << ((int)StateKey.Props - 1)) |
            (1u << ((int)StateKey.Fields - 1)) | (1u << ((int)StateKey.RewardChests - 1)) |
            (1u << ((int)StateKey.Build - 1)) | (1u << ((int)StateKey.Camps - 1)) |
            (1u << ((int)StateKey.Projectiles - 1)) | (1u << ((int)StateKey.Plan - 1)) |
            (1u << ((int)StateKey.Arena - 1)) | (1u << ((int)StateKey.Quests - 1)) |
            (1u << ((int)StateKey.Trade - 1));
        uint _seen;
        /// <summary>Every key 1..11 has arrived (the roster, key 12, is not required).</summary>
        public bool HasFullState { get { return (_seen & KnownStateMask) == KnownStateMask; } }

        /// <summary>The roster name of <paramref name="id"/>, or null when the roster does not hold it.</summary>
        public string RosterName(uint id)
        {
            var roster = Roster;
            int lo = 0, hi = roster.Count;
            while (lo < hi)
            {
                int mid = lo + ((hi - lo) >> 1);
                uint at = roster[mid].Id;
                if (at == id) return roster[mid].Name;
                if (at < id) lo = mid + 1; else hi = mid;
            }
            return null;
        }

        internal void Reset()
        {
            Plan = null; Arena = null; Quests = null; Trade = null; Roster = Array.Empty<RosterEntry>(); Summary = null;
            Tick = 0; _seen = 0; Camps=Array.Empty<CampView>(); Projectiles=Array.Empty<NetProjectileView>(); Inventory = null; Focus = null; HasBuild = false;
            Props = Array.Empty<PropView>(); Fields = Array.Empty<AreaView>();
            RewardChests = Array.Empty<RewardChestView>(); Cards = Array.Empty<byte>(); Boosts = Array.Empty<byte>();
        }
        internal void Apply(ServerMsg.State state)
        {
            // Decode validated the complete frame before this method can mutate the retained view.
            foreach (var item in state.Items)
            {
                if (item.Key < (uint)StateKey.Inventory || item.Key > (uint)StateKey.BuildSummary)
                    throw new ArgumentException("unknown state key");
                if (item is TradeState trade)
                {
                    try { trade.Check(); }
                    catch (EncodeException e) { throw new InvalidCollectionStateException("invalid trade state: " + e.Message); }
                }
            }
            ValidateQuestPropReferences(state);
            foreach (var item in state.Items)
            {
                _seen |= 1u << ((int)item.Key - 1);
                if (item is InventoryState inventory)
                {
                    Inventory = inventory.Value.HasValue ? new InventoryView
                    {
                        ActiveSlot = inventory.Value.Value.ActiveSlot,
                        PotionSmall=inventory.Value.Value.PotionSmall,PotionLarge=inventory.Value.Value.PotionLarge,PotionsHealing=inventory.Value.Value.PotionsHealing,
                        Slot0 = inventory.Value.Value.Slot0.HasValue ? (WeaponId?)inventory.Value.Value.Slot0.Value : null,
                        Slot1 = inventory.Value.Value.Slot1.HasValue ? (WeaponId?)inventory.Value.Value.Slot1.Value : null,
                        HealingUntil = inventory.Value.Value.HealingUntil,
                        SpeedBoostUntil = inventory.Value.Value.SpeedBoostUntil
                    } : (InventoryView?)null;
                }
                else if (item is PropsState props)
                {
                    var rows = new PropView[props.Rows.Length]; Focus = null;
                    for (int i = 0; i < rows.Length; i++)
                    {
                        var source = props.Rows[i]; bool focused = props.Focus.HasValue && props.Focus.Value.Handle.Equals(source.Handle);
                        rows[i] = new PropView
                        {
                            Handle = source.Handle, X = Quant.DequantizePos(source.X), Y = Quant.DequantizePos(source.Y),
                            Kind = (PropAppearance)source.Kind, Open = source.Open, BodyLabel = source.BodyLabel, CorpseLabel = source.CorpseLabel, ReadyAt = source.ReadyAt,
                            Weapon = source.Kind == Protocol.PropKind.Ground ? (WeaponId?)source.GroundWeapon : null,
                            QuestRef = source.Kind == Protocol.PropKind.QuestItem ? source.QuestRef : default,
                            QuestFetch = source.Kind == Protocol.PropKind.QuestItem && source.QuestFetch,
                            Focused = focused, BodyHint = focused && props.Focus.Value.BodyHint.HasValue ? (WeaponId?)props.Focus.Value.BodyHint.Value : null
                        };
                        if (focused) Focus = rows[i];
                    }
                    Props = rows;
                }
                else if (item is FieldsState fields)
                {
                    var rows = new AreaView[fields.Rows.Length];
                    for (int i = 0; i < rows.Length; i++)
                    {
                        var f = fields.Rows[i]; rows[i] = new AreaView
                        {
                            Kind = (AreaKind)f.Kind, Ability = (AbilityId)f.Ability, Owner = f.Owner, Subject = f.Subject,
                            X = f.X, Y = f.Y, X2 = f.X2, Y2 = f.Y2, Radius = f.Radius, Vx = f.Vx, Vy = f.Vy,
                            StartedAt = f.StartedAt, EndsAt = f.EndsAt
                        };
                    }
                    Fields = rows;
                }
                else if (item is RewardChestsState chests)
                {
                    var rows = new RewardChestView[chests.Rows.Length];
                    for (int i = 0; i < rows.Length; i++)
                    {
                        var c = chests.Rows[i]; var options = new RewardOptionView[c.Options.Length];
                        for (int j = 0; j < options.Length; j++)
                        {
                            var o = c.Options[j]; options[j] = new RewardOptionView
                            {
                                Card = o.Kind == 1 ? (CardId?)o.Id : null, Boost = o.Kind == 2 ? (BoostId?)o.Id : null,
                                KillKey = o.Kind == 3 ? o.KillKey : null, KillGain = o.Kind == 3 ? o.KillGain : 0,
                                Taken = o.Taken, TakenBy = o.TakenBy
                            };
                        }
                        rows[i] = new RewardChestView { Handle = c.Handle, X = Quant.DequantizePos(c.X), Y = Quant.DequantizePos(c.Y), ExpiresAt = c.ExpiresAt, Picked = c.Picked, CanChoose = c.CanChoose, Options = options };
                    }
                    RewardChests = rows;
                }
                else if(item is ProjectilesState projectiles)
                {
                    var rows=new NetProjectileView[projectiles.Rows.Length];
                    for(int i=0;i<rows.Length;i++) {var p=projectiles.Rows[i];rows[i]=new NetProjectileView {Kind=(ProjectileKind)p.Kind,X=Quant.DequantizePos(p.X),Y=Quant.DequantizePos(p.Y),Facing=Quant.DequantizeFacing(p.Facing),Owner=p.Owner,Height=p.Height};}
                    Projectiles=rows;
                }
                else if(item is CampsState camps)
                {
                    var rows=new CampView[camps.Rows.Length];
                    for(int i=0;i<rows.Length;i++) {var c=camps.Rows[i];rows[i]=new CampView {MobType=(MobTypeId)c.MobType,Elite=c.Elite==0?(MobTypeId?)null:(MobTypeId)(c.Elite-1),Alive=c.Alive,State=c.State,ClearedAt=c.ClearedAt,RespawnAt=c.RespawnAt,Reward=c.Reward,Ward=c.Ward.HasValue?(c.Ward.Value.Yours?WardVerdict.Yours:WardVerdict.Other):WardVerdict.None,WardExpiresAt=c.Ward.HasValue?c.Ward.Value.ExpiresAt:0};}
                    Camps=rows;
                }
                else if (item is PlanState plan)
                {
                    Plan = plan.Value == null ? null : new PlanView(plan.Value);
                }
                else if (item is ArenaState arena)
                {
                    if (!arena.Value.HasValue) Arena = null;
                    else
                    {
                        var v = arena.Value.Value;
                        Arena = new ArenaView { LobbyEndsAt = v.LobbyEndsAt, PlanEndsAt = v.PlanEndsAt,
                            RaidStartedAt = v.RaidStartedAt, PatienceEndsAt = v.PatienceEndsAt,
                            InColiseum = v.InColiseum, GatesLocked = v.GatesLocked,
                            SuddenDeathAt = v.SuddenDeathAt, StartedWith = v.StartedWith, MinPlayers = v.MinPlayers };
                    }
                }
                else if (item is QuestsState quests)
                {
                    Quests = new QuestView(quests);
                }
                else if (item is TradeState trade)
                {
                    Trade = new TradeView(trade);
                }
                else if (item is BuildSummaryState summary)
                {
                    Summary = summary.Value;
                }
                else if (item is RosterState roster)
                {
                    var rows = roster.Rows.Length == 0 ? Array.Empty<RosterEntry>() : new RosterEntry[roster.Rows.Length];
                    for (int i = 0; i < rows.Length; i++) rows[i] = new RosterEntry(roster.Rows[i].Id, roster.Rows[i].Name, roster.Rows[i].Bot);
                    Roster = rows;
                }
                else if (item is BuildState build)
                {
                    HasBuild = build.Value.HasValue;
                    Cards = HasBuild ? (byte[])build.Value.Value.Cards.Clone() : Array.Empty<byte>();
                    Boosts = HasBuild ? (byte[])build.Value.Value.Boosts.Clone() : Array.Empty<byte>();
                }
            }
            Tick = state.Tick;
        }

        void ValidateQuestPropReferences(ServerMsg.State state)
        {
            PropsState replacementProps = null;
            QuestsState replacementQuests = null;
            foreach (var item in state.Items)
            {
                if (item is PropsState props) replacementProps = props;
                else if (item is QuestsState quests) replacementQuests = quests;
            }

            var handles = new HashSet<QuestHandle>();
            if (replacementQuests != null)
            {
                if (replacementQuests.Available)
                    foreach (var row in replacementQuests.View.Rows) handles.Add(row.Handle);
            }
            else if (Quests != null && Quests.Available)
            {
                foreach (var row in Quests.Rows) handles.Add(row.Handle);
            }

            if (replacementProps != null)
            {
                foreach (var prop in replacementProps.Rows)
                    if (prop.Kind == Protocol.PropKind.QuestItem && (!prop.QuestRef.IsValid || !handles.Contains(prop.QuestRef)))
                        throw new InvalidCollectionStateException("quest prop has no matching row");
            }
            else
            {
                foreach (var prop in Props)
                    if (prop.Kind == PropAppearance.QuestItem && (!prop.QuestRef.IsValid || !handles.Contains(prop.QuestRef)))
                        throw new InvalidCollectionStateException("retained quest prop has no matching row");
            }
        }
    }
}
