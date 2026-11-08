using System;
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
}

namespace Roguehalla.Net.Protocol
{
    public struct WireInventory { public byte ActiveSlot, PotionSmall, PotionLarge, PotionsHealing; public byte? Slot0, Slot1; }
    public enum PropKind : byte { Ground = 1, Chest = 2, Body = 3, Corpse = 4, WindEmblem = 5, Cannon = 6 }
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
    }
    public struct WireFocus { public PickupHandle Handle; public byte? BodyHint; }
    public struct WireField
    {
        public byte Kind, Ability;
        public uint? Owner, Subject;
        public float X, Y, X2, Y2, Radius, Vx, Vy;
        public double StartedAt, EndsAt;
    }
    public struct WireRewardOption { public byte Kind, Id; public bool Taken; public uint? TakenBy; }
    public sealed class WireRewardChest
    {
        public RewardChestHandle Handle;
        public ushort X, Y;
        public double ExpiresAt;
        public WireRewardOption[] Options = Array.Empty<WireRewardOption>();
        public bool Picked, CanChoose;
    }
    public struct WireProjectile { public byte Kind; public ushort X,Y,Facing; public uint? Owner; }
    public struct WireCamp { public byte MobType, Elite; public uint Alive; public byte State; public double ClearedAt, RespawnAt; }
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
    }

    public enum StateKey : byte { Inventory = 1, Props = 2, Fields = 3, RewardChests = 4, Build = 5, Camps = 6, Projectiles = 7, Plan = 8, Arena = 9 }

    /// <summary>Keys are ascending, unique complete replacements. Missing keys retain their previous values.</summary>
    public abstract class StateItem
    {
        public abstract uint Key { get; }
        internal abstract void Check();
        internal abstract void Write(Writer w);
        internal const int MaxRows = 512, MaxKeys = (int)StateKey.Arena;
        internal static void Require(bool condition, string name) { if (!condition) throw new EncodeException(name); }
        internal static bool Finite(double v) { return !double.IsNaN(v) && !double.IsInfinity(v); }
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
                        if (r.Flag()) inv.Value = new WireInventory { ActiveSlot = r.U8(), Slot0 = ReadWeapon(ref r), Slot1 = ReadWeapon(ref r), PotionSmall=r.U8(),PotionLarge=r.U8(),PotionsHealing=r.U8() };
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
                                default: throw new DecodeException(DecodeError.BadField, "prop kind");
                            }
                            props.Rows[j] = row;
                        }
                        uint focus = r.Varint();
                        if (focus != 0) props.Focus = new WireFocus { Handle = new PickupHandle(focus), BodyHint = ReadWeapon(ref r) };
                        item = props; break;
                    case 3:
                        var fields = new FieldsState { Rows = new WireField[Count(ref r, MaxRows)] };
                        for (int j = 0; j < fields.Rows.Length; j++) fields.Rows[j] = new WireField
                        {
                            Kind = r.U8(), Ability = r.U8(), Owner = ReadActor(ref r), Subject = ReadActor(ref r),
                            X = r.F32(), Y = r.F32(), X2 = r.F32(), Y2 = r.F32(), Radius = r.F32(), Vx = r.F32(), Vy = r.F32(),
                            StartedAt = r.F64(), EndsAt = r.F64()
                        };
                        item = fields; break;
                    case 4:
                        var chests = new RewardChestsState { Rows = new WireRewardChest[Count(ref r, MaxRows)] };
                        for (int j = 0; j < chests.Rows.Length; j++)
                        {
                            var chest = new WireRewardChest { Handle = new RewardChestHandle(Handle(ref r)), X = r.U16(), Y = r.U16(), ExpiresAt = r.F64() };
                            byte n = r.U8(); if (n > 3) throw new DecodeException(DecodeError.TooMany);
                            chest.Options = new WireRewardOption[n];
                            for (int k = 0; k < n; k++) chest.Options[k] = new WireRewardOption { Kind = r.U8(), Id = r.U8(), Taken = r.Flag(), TakenBy = ReadActor(ref r) };
                            chest.Picked = r.Flag(); chest.CanChoose = r.Flag(); chests.Rows[j] = chest;
                        }
                        item = chests; break;
                    case 7:
                        var projectiles = new ProjectilesState { Rows=new WireProjectile[Count(ref r,MaxRows)] };
                        for(int j=0;j<projectiles.Rows.Length;j++) projectiles.Rows[j]=new WireProjectile {Kind=r.U8(),X=r.U16(),Y=r.U16(),Facing=r.U16(),Owner=ReadActor(ref r)};
                        item=projectiles;break;
                    case 6:
                        var camps = new CampsState { Rows = new WireCamp[Count(ref r, MaxRows)] };
                        for(int j=0;j<camps.Rows.Length;j++) camps.Rows[j]=new WireCamp {MobType=r.U8(),Elite=r.U8(),Alive=r.Varint(),State=r.U8(),ClearedAt=r.F64(),RespawnAt=r.F64()};
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
                            SuddenDeathAt = r.F64(), StartedWith = r.Varint() };
                        item = arena; break;
                    default: throw new DecodeException(DecodeError.BadField, "state key");
                }
                try { item.Check(); } catch (EncodeException e) { throw new DecodeException(DecodeError.BadField, e.Message); }
                items[i] = item;
            }
            return items;
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
        internal override void Check() { if (Value.HasValue) { Require(Value.Value.ActiveSlot < 2, "active slot"); Require(Value.Value.PotionSmall<=5 && Value.Value.PotionLarge<=5 && Value.Value.PotionsHealing<=3,"potion count"); CheckWeapon(Value.Value.Slot0); CheckWeapon(Value.Value.Slot1); } }
        internal override void Write(Writer w) { w.U8(Value.HasValue ? (byte)1 : (byte)0); if (Value.HasValue) { w.U8(Value.Value.ActiveSlot); WriteWeapon(w, Value.Value.Slot0); WriteWeapon(w, Value.Value.Slot1); w.U8(Value.Value.PotionSmall); w.U8(Value.Value.PotionLarge); w.U8(Value.Value.PotionsHealing); } }
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
                switch (row.Kind) { case PropKind.Ground: w.U8(row.GroundWeapon); break; case PropKind.Chest: w.U8(row.Open ? (byte)1 : (byte)0); break; case PropKind.Body: w.Str(row.BodyLabel); break; case PropKind.Corpse: w.Str(row.CorpseLabel); break; case PropKind.WindEmblem: break; case PropKind.Cannon: w.Varint(row.ReadyAt); break; }
            }
            w.Varint(Focus.HasValue ? Focus.Value.Handle.Value : 0); if (Focus.HasValue) WriteWeapon(w, Focus.Value.BodyHint);
        }
    }
    public sealed class FieldsState : StateItem
    {
        public override uint Key { get { return 3; } }
        public WireField[] Rows = Array.Empty<WireField>();
        internal override void Check()
        {
            Require(Rows != null && Rows.Length <= MaxRows, "fields");
            foreach (var f in Rows) Require(f.Kind < 3 && f.Ability < 5 && f.Owner != 0 && f.Subject != 0
                && Finite(f.X) && Finite(f.Y) && Finite(f.X2) && Finite(f.Y2) && Finite(f.Radius) && Finite(f.Vx) && Finite(f.Vy)
                && f.Radius >= 0 && Finite(f.StartedAt) && Finite(f.EndsAt) && f.EndsAt >= f.StartedAt, "field");
        }
        internal override void Write(Writer w)
        {
            w.Varint((uint)Rows.Length);
            foreach (var f in Rows)
            {
                w.U8(f.Kind); w.U8(f.Ability); WriteActor(w, f.Owner); WriteActor(w, f.Subject);
                w.F32(f.X); w.F32(f.Y); w.F32(f.X2); w.F32(f.Y2); w.F32(f.Radius); w.F32(f.Vx); w.F32(f.Vy); w.F64(f.StartedAt); w.F64(f.EndsAt);
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
                foreach (var o in row.Options) Require((o.Kind == 1 && o.Id < 3 || o.Kind == 2 && o.Id < 8) && o.TakenBy != 0, "reward option");
            }
        }
        internal override void Write(Writer w)
        {
            w.Varint((uint)Rows.Length);
            foreach (var row in Rows)
            {
                w.Varint(row.Handle.Value); w.U16(row.X); w.U16(row.Y); w.F64(row.ExpiresAt); w.U8((byte)row.Options.Length);
                foreach (var o in row.Options) { w.U8(o.Kind); w.U8(o.Id); w.U8(o.Taken ? (byte)1 : (byte)0); WriteActor(w, o.TakenBy); }
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
            foreach(var c in Rows) Require(c.MobType<30 && c.Elite<=30 && c.Alive<=512 && c.State<=2 && Finite(c.ClearedAt) && c.ClearedAt>=0 && Finite(c.RespawnAt) && c.RespawnAt>=c.ClearedAt,"camp");
        }
        internal override void Write(Writer w)
        {
            w.Varint((uint)Rows.Length);
            foreach(var c in Rows) { w.U8(c.MobType);w.U8(c.Elite);w.Varint(c.Alive);w.U8(c.State);w.F64(c.ClearedAt);w.F64(c.RespawnAt); }
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
            foreach(var p in Rows) {w.U8(p.Kind);w.U16(p.X);w.U16(p.Y);w.U16(p.Facing);WriteActor(w,p.Owner);}
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
        }
        internal override void Write(Writer w)
        {
            w.U8(Value.HasValue ? (byte)1 : (byte)0);
            if (!Value.HasValue) return;
            var v = Value.Value;
            w.F64(v.LobbyEndsAt); w.F64(v.PlanEndsAt); w.F64(v.RaidStartedAt);
            if (v.PatienceEndsAt.HasValue) { w.U8(1); w.F64(v.PatienceEndsAt.Value); } else w.U8(0);
            w.U8((byte)(v.InColiseum ? 1 : 0)); w.U8((byte)(v.GatesLocked ? 1 : 0));
            w.F64(v.SuddenDeathAt); w.Varint(v.StartedWith);
        }
    }

}
