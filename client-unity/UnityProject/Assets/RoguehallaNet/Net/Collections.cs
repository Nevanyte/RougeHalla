using System;
using System.Collections.Generic;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    public enum PropAppearance : byte { Ground = 1, Chest = 2, Body = 3 }
    public enum AreaKind : byte { Zone, Cloud, Trail }
    public enum AbilityId : byte { Freeze, Swarm, Trial, Blaze, LastStand }
    public enum CardId : byte { SlowBurn, PocketSand, Siphon }
    public enum BoostId : byte { Ad, Ap, Armor, Shield, MaxHp, AttackSpeed, MoveSpeed, Lifesteal }
    public enum ProjectileKind : byte { Arrow=0,Ball=1 }
    public struct NetProjectileView { public ProjectileKind Kind; public float X,Y,Facing; public uint? Owner; }
    public struct CampView { public MobTypeId MobType; public MobTypeId? Elite; public uint Alive; public byte State; public double ClearedAt,RespawnAt; }
    public struct InventoryView { public byte ActiveSlot, PotionSmall, PotionsHealing; public WeaponId? Slot0, Slot1; }
    public struct PropView
    {
        public PickupHandle Handle;
        public float X, Y;
        public PropAppearance Kind;
        public WeaponId? Weapon, BodyHint;
        public bool Open, Focused;
        public string BodyLabel;
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

    /// <summary>
    /// Owned presentation facts from the reliable State channel. Socket order, rather than snapshot age,
    /// controls replacement: a reliable update can precede a newer coalesced snapshot. No gameplay is computed here.
    /// </summary>
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
        uint _seen;
        public bool HasFullState { get { return _seen == 127; } }

        internal void Reset()
        {
            Tick = 0; _seen = 0; Camps=Array.Empty<CampView>(); Projectiles=Array.Empty<NetProjectileView>(); Inventory = null; Focus = null; HasBuild = false;
            Props = Array.Empty<PropView>(); Fields = Array.Empty<AreaView>();
            RewardChests = Array.Empty<RewardChestView>(); Cards = Array.Empty<byte>(); Boosts = Array.Empty<byte>();
        }
        internal void Apply(ServerMsg.State state)
        {
            // Decode validated the complete frame before this method can mutate the retained view.
            foreach (var item in state.Items)
            {
                _seen |= 1u << ((int)item.Key - 1);
                if (item is InventoryState inventory)
                {
                    Inventory = inventory.Value.HasValue ? new InventoryView
                    {
                        ActiveSlot = inventory.Value.Value.ActiveSlot,
                        PotionSmall=inventory.Value.Value.PotionSmall,PotionsHealing=inventory.Value.Value.PotionsHealing,
                        Slot0 = inventory.Value.Value.Slot0.HasValue ? (WeaponId?)inventory.Value.Value.Slot0.Value : null,
                        Slot1 = inventory.Value.Value.Slot1.HasValue ? (WeaponId?)inventory.Value.Value.Slot1.Value : null
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
                            Kind = (PropAppearance)source.Kind, Open = source.Open, BodyLabel = source.BodyLabel,
                            Weapon = source.Kind == Protocol.PropKind.Ground ? (WeaponId?)source.GroundWeapon : null,
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
                    for(int i=0;i<rows.Length;i++) {var p=projectiles.Rows[i];rows[i]=new NetProjectileView {Kind=(ProjectileKind)p.Kind,X=Quant.DequantizePos(p.X),Y=Quant.DequantizePos(p.Y),Facing=Quant.DequantizeFacing(p.Facing),Owner=p.Owner};}
                    Projectiles=rows;
                }
                else if(item is CampsState camps)
                {
                    var rows=new CampView[camps.Rows.Length];
                    for(int i=0;i<rows.Length;i++) {var c=camps.Rows[i];rows[i]=new CampView {MobType=(MobTypeId)c.MobType,Elite=c.Elite==0?(MobTypeId?)null:(MobTypeId)(c.Elite-1),Alive=c.Alive,State=c.State,ClearedAt=c.ClearedAt,RespawnAt=c.RespawnAt};}
                    Camps=rows;
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
    }
}
