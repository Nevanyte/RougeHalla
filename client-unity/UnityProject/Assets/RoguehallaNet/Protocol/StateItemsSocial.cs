using System;
using System.Collections.Generic;
using System.Text;

namespace Roguehalla.Net.Protocol
{
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
    /// Key 14 (P-WIRE19-B): the viewer's own native readout rows, in native order (brief docs/backlog/packets/P-WIRE19-B.md,
    /// "Wire layout"): count u8 (at most 28, refused before the rows), rows of card u8 (80..93), kind u8 (0..2), value f64,
    /// max f64. Checked per row in this order: card, kind, value and max (finite, 0 &lt;= value &lt;= max), then order (a card
    /// never decreases). Sent only when the rows change, so it is never required for a full state.
    /// </summary>
    public sealed class ReadoutsState : StateItem
    {
        public const int MaxCount = 28;
        public const byte FirstCard = 80, LastCard = 93, KindCount = 3;
        public override uint Key { get { return 14; } }
        public WireReadout[] Rows = Array.Empty<WireReadout>();

        static string Fault(WireReadout row, int previous)
        {
            if (row.Card < FirstCard || row.Card > LastCard) return "readout card";
            if (row.Kind >= KindCount) return "readout kind";
            if (!Finite(row.Value) || !Finite(row.Max) || !(row.Value >= 0) || !(row.Value <= row.Max)) return "readout value";
            if (row.Card < previous) return "readout order";
            return null;
        }

        internal override void Check()
        {
            Require(Rows != null && Rows.Length <= MaxCount, "readout count");
            int previous = 0;
            foreach (var row in Rows)
            {
                string fault = Fault(row, previous);
                Require(fault == null, fault);
                previous = row.Card;
            }
        }

        internal override void Write(Writer w)
        {
            w.U8((byte)Rows.Length);
            foreach (var row in Rows) { w.U8(row.Card); w.U8(row.Kind); w.F64(row.Value); w.F64(row.Max); }
        }

        internal static ReadoutsState Read(ref Reader r)
        {
            int n = r.U8();
            if (n > MaxCount) throw new DecodeException(DecodeError.BadField, "readout count");
            var rows = n == 0 ? Array.Empty<WireReadout>() : new WireReadout[n];
            int previous = 0;
            for (int i = 0; i < n; i++)
            {
                var row = new WireReadout { Card = r.U8(), Kind = r.U8() };
                row.Value = r.F64();
                row.Max = r.F64();
                string fault = Fault(row, previous);
                if (fault != null) throw new DecodeException(DecodeError.BadField, fault);
                previous = row.Card;
                rows[i] = row;
            }
            return new ReadoutsState { Rows = rows };
        }
    }

    /// <summary>P-AUG-NATIVE-5 (State key 15): one Marked Man holder on every minimap: its actor id and position (world
    /// units at the actor quantization, 1/8 u). Public and the same for every viewer.</summary>
    public struct WireMarked { public uint Id; public float X; public float Y; }

    /// <summary>
    /// Key 15 (P-AUG-NATIVE-5): every <c>Alive</c> Marked Man holder's position, by strictly ascending nonzero id. Wire: count
    /// u8 (at most 32, refused before the rows), rows of id varint, x u16, y u16 (actor quantization). Checked per row: id
    /// nonzero, then order; the encoder refuses a position outside 0..=8191.875 (NaN included). Sent only when the rows
    /// change, so it is never required for a full state.
    /// </summary>
    public sealed class MarkedState : StateItem
    {
        public const int MaxCount = 32;
        public override uint Key { get { return 15; } }
        public WireMarked[] Rows = Array.Empty<WireMarked>();

        static string IdFault(uint id, uint previous)
        {
            if (id == 0) return "marked id";
            if (id <= previous) return "marked order";
            return null;
        }

        internal override void Check()
        {
            Require(Rows != null && Rows.Length <= MaxCount, "marked count");
            uint previous = 0;
            foreach (var row in Rows)
            {
                string fault = IdFault(row.Id, previous);
                Require(fault == null, fault);
                previous = row.Id;
                Require(Quant.PosInRange(row.X) && Quant.PosInRange(row.Y), "position");
            }
        }

        internal override void Write(Writer w)
        {
            w.U8((byte)Rows.Length);
            foreach (var row in Rows) { w.Varint(row.Id); w.U16(Quant.QuantizePos(row.X)); w.U16(Quant.QuantizePos(row.Y)); }
        }

        internal static MarkedState Read(ref Reader r)
        {
            int n = r.U8();
            if (n > MaxCount) throw new DecodeException(DecodeError.BadField, "marked count");
            var rows = n == 0 ? Array.Empty<WireMarked>() : new WireMarked[n];
            uint previous = 0;
            for (int i = 0; i < n; i++)
            {
                uint id = r.Varint();
                string fault = IdFault(id, previous);
                if (fault != null) throw new DecodeException(DecodeError.BadField, fault);
                previous = id;
                rows[i] = new WireMarked { Id = id, X = Quant.DequantizePos(r.U16()), Y = Quant.DequantizePos(r.U16()) };
            }
            return new MarkedState { Rows = rows };
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
