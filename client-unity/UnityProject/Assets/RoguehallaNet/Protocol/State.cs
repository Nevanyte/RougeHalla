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
    public struct WireInventory { public byte ActiveSlot, PotionSmall, PotionsHealing; public byte? Slot0, Slot1; }
    public enum PropKind : byte { Ground = 1, Chest = 2, Body = 3 }
    public struct WireProp
    {
        public PickupHandle Handle;
        public ushort X, Y;
        public PropKind Kind;
        public byte GroundWeapon;
        public bool Open;
        public string BodyLabel;
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

    /// <summary>Keys are ascending, unique complete replacements. Missing keys retain their previous values.</summary>
    public abstract class StateItem
    {
        public abstract uint Key { get; }
        internal abstract void Check();
        internal abstract void Write(Writer w);
        internal const int MaxRows = 512, MaxKeys = 7;
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
                        if (r.Flag()) inv.Value = new WireInventory { ActiveSlot = r.U8(), Slot0 = ReadWeapon(ref r), Slot1 = ReadWeapon(ref r), PotionSmall=r.U8(),PotionsHealing=r.U8() };
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
        internal override void Check() { if (Value.HasValue) { Require(Value.Value.ActiveSlot < 2, "active slot"); Require(Value.Value.PotionSmall<=5 && Value.Value.PotionsHealing<=3,"potion count"); CheckWeapon(Value.Value.Slot0); CheckWeapon(Value.Value.Slot1); } }
        internal override void Write(Writer w) { w.U8(Value.HasValue ? (byte)1 : (byte)0); if (Value.HasValue) { w.U8(Value.Value.ActiveSlot); WriteWeapon(w, Value.Value.Slot0); WriteWeapon(w, Value.Value.Slot1); w.U8(Value.Value.PotionSmall); w.U8(Value.Value.PotionsHealing); } }
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
                switch (row.Kind) { case PropKind.Ground: w.U8(row.GroundWeapon); break; case PropKind.Chest: w.U8(row.Open ? (byte)1 : (byte)0); break; case PropKind.Body: w.Str(row.BodyLabel); break; }
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

}
