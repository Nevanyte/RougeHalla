using System;
using System.Collections.Generic;
using System.Text;

namespace Roguehalla.Net.Protocol
{
    /// <summary>Keys are ascending, unique complete replacements. Missing keys retain their previous values.</summary>
    public abstract class StateItem
    {
        public abstract uint Key { get; }
        internal abstract void Check();
        internal abstract void Write(Writer w);
        internal const int MaxRows = 512, MaxKeys = (int)StateKey.Marked;
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
                                case PropKind.Heal: row.ReadyAt = r.Varint(); break; // protocol 20: the cannon's layout, kind 8
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
                            chest.Picked = r.Flag(); chest.CanChoose = r.Flag();
                            // P-WIRE19-A: the first-pick window (tag 0|1, then until f64 and mine u8); Check() bounds it.
                            if (r.Flag()) chest.FirstPick = new WireFirstPick { Until = r.F64(), Mine = r.Flag() };
                            chests.Rows[j] = chest;
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
                    case 14:
                        item = ReadoutsState.Read(ref r); break;
                    case 15:
                        item = MarkedState.Read(ref r); break;
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
}
