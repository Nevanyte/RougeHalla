using System;
using System.Collections.Generic;
using System.Text;

namespace Roguehalla.Net.Protocol
{
    /// <summary>Key 1: the receiving player's inventory. The state items of keys 1 to 9 (inventory to arena) are in this file.</summary>
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
                    case PropKind.Heal: break;
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
                switch (row.Kind) { case PropKind.Ground: w.U8(row.GroundWeapon); break; case PropKind.Chest: w.U8(row.Open ? (byte)1 : (byte)0); break; case PropKind.Body: w.Str(row.BodyLabel); break; case PropKind.Corpse: w.Str(row.CorpseLabel); break; case PropKind.WindEmblem: break; case PropKind.Cannon: w.Varint(row.ReadyAt); break; case PropKind.QuestItem: w.Varint(row.QuestRef.Value); w.U8(row.QuestFetch ? (byte)1 : (byte)0); break; case PropKind.Heal: w.Varint(row.ReadyAt); break; }
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
        /// <summary>Card ids an option may carry: the 80 catalog cards, then the 14 native cards (80..=93, P-WIRE19-A).</summary>
        internal const byte MaxCardId = 94;
        internal override void Check()
        {
            Require(Rows != null && Rows.Length <= MaxRows, "reward chests"); uint previous = 0;
            foreach (var row in Rows)
            {
                Require(row != null && row.Handle.Value > previous && Finite(row.ExpiresAt) && row.Options != null && row.Options.Length <= 3, "reward chest");
                // P-WIRE19-A: a window is finite and ends by the chest's expiry.
                Require(!row.FirstPick.HasValue || (Finite(row.FirstPick.Value.Until) && row.FirstPick.Value.Until <= row.ExpiresAt), "reward chest first pick");
                previous = row.Handle.Value;
                foreach (var o in row.Options)
                {
                    bool card = o.Kind == 1 && o.Id < MaxCardId && !o.KillKey.HasValue && o.KillGain == 0;
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
                if (row.FirstPick.HasValue) { w.U8(1); w.F64(row.FirstPick.Value.Until); w.U8(row.FirstPick.Value.Mine ? (byte)1 : (byte)0); }
                else w.U8(0);
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
}
