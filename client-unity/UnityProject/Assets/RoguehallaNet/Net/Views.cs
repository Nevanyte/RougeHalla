namespace Roguehalla.Net
{
    // The types gameplay code (HUD, views, abilities) is written against. Everything under Protocol/ (ServerMsg, WireSelf, WireActor,
    // WireEvent, WireFx and their raw byte codes) is the codec layer, internal to the netcode: its objects are recycled and its
    // shape changes with every protocol version. These types are stable copies with typed codes.

    /// <summary>Life-cycle status code (docs/CONTRACTS.md). A value outside the named ones is a newer server's: cast, never assume.</summary>
    public enum ActorStatus : byte { Lobby = 0, Alive = 1, Dead = 2, Mia = 3 }
    /// <summary>Native MobTypeId::ALL order; no gameplay statistics.</summary>
    public enum MobTypeId : byte
    {
        EmberImp = 0,
        CinderHound = 1,
        MagmaBrute = 2,
        FlameCaller = 3,
        Wyrmling = 4,
        AshDrake = 5,
        Bailiff = 6,
        ChainWarden = 7,
        Inquisitor = 8,
        Pardoner = 9,
        Executioner = 10,
        Gaoler = 11,
        PlagueRat = 12,
        Bloatfly = 13,
        RotMonk = 14,
        MiasmaWitch = 15,
        RatOgre = 16,
        PoxBehemoth = 17,
        FrostWisp = 18,
        IceGolem = 19,
        RimeStalker = 20,
        FrostbowSentry = 21,
        GlacialWarden = 22,
        AvalancheTroll = 23,
        Acolyte = 24,
        SeraphShard = 25,
        Penitent = 26,
        Zealot = 27,
        BloodSaint = 28,
        Archon = 29,
    }
    public enum PotionNotice : byte { Stored=1,BagFull=2,Used=3,Blocked=4,Busy=5,Full=6,Empty=7,LargeStored=8,LargeUsed=9,CampBagFull=10 }
    public enum ActorKind : byte { Player = 0, RegionalMob = 1, Zombie = 2, TrainingDummy = 3, QuestGiver = 4 }

    /// <summary>Faction code: <c>FactionId::ALL</c> order (append only). A value outside the named ones is a newer server's.</summary>
    public enum FactionId : byte { Fire = 0, Sentenced = 1, Plague = 2, Frost = 3, Holy = 4 }

    /// <summary>Weapon code: <c>WeaponId::ALL</c> order (append only). A value outside the named ones is a newer server's.</summary>
    public enum WeaponId : byte { Sword = 0, Bow = 1, Wand = 2, Shield = 3, Axe = 4, Fists = 5 }

    public struct WishCastView
    {
        public AbilityId Ability;
        public double StartedAt, LandsAt;
    }

    /// <summary>Owned authoritative display facts. Read charges and deadlines directly; do not derive eligibility.</summary>
    public struct WishView
    {
        public AbilityId Ability;
        public double ReadyAt, RechargeMs;
        public double? FullAt, NextChargeAt;
        public byte MaxCharges, Charges;
        public WishCastView? Cast;

        internal static WishView From(Protocol.WireWishOwner w)
        {
            return new WishView {
                Ability = (AbilityId)w.Ability, ReadyAt = w.ReadyAt, FullAt = w.FullAt,
                MaxCharges = w.MaxCharges, RechargeMs = w.RechargeMs, Charges = w.Charges,
                NextChargeAt = w.NextChargeAt,
                Cast = w.Cast == null ? (WishCastView?)null : new WishCastView {
                    Ability = (AbilityId)w.Cast.Ability, StartedAt = w.Cast.StartedAt, LandsAt = w.Cast.LandsAt }
            };
        }
    }

    public enum OwnerLockKind : byte { Clear = 0, Held = 1 }

    public readonly struct OwnerLockView
    {
        public OwnerLockKind Kind { get; }
        public uint? Target { get; }
        internal OwnerLockView(OwnerLockKind kind, uint? target) { Kind = kind; Target = target; }
    }

    /// <summary>Owned exact server facts. Values are copied from the wire; consumers must not derive readiness or timing.</summary>
    public readonly struct OwnerCombatView
    {
        public OwnerLockView Lock { get; }
        public uint DrawStartedAt { get; }
        public uint ReadyAt { get; }
        public double AsMilli { get; }
        public double WindupMilli { get; }
        public double SpeedMilli { get; }

        internal OwnerCombatView(Protocol.WireOwnerCombat w)
        {
            Lock = new OwnerLockView((OwnerLockKind)w.Lock.Kind, w.Lock.Target);
            DrawStartedAt = w.DrawStartedAt; ReadyAt = w.ReadyAt;
            AsMilli = w.AsMilli; WindupMilli = w.WindupMilli; SpeedMilli = w.SpeedMilli;
        }
    }

    /// <summary>
    /// The local player's state as of the newest applied snapshot: an OWNED copy (<see cref="Session.Me"/> returns the one instance
    /// the session keeps and overwrites per snapshot), never one of the recycled snapshot objects. Copy a value out to keep it past
    /// the frame.
    /// </summary>
    public sealed class SelfView
    {
        public uint Id;
        public FactionId Faction;
        public float X, Y, Facing, Hp, MaxHp;
        public ActorStatus Status;
        public WeaponId Weapon;
        public ushort ReadyInMs, Kills, Bounty, Gv;
        public byte MoveSeq, DisplaceSeq, SelfSig;
        public ushort Effects;
        public uint? HuntTarget;
        public ushort HuntStacks;
        public float Barrier;
        public byte BarrierRingStep;
        public WishView? Wish;
        public OwnerCombatView? OwnerCombat;

        /// <summary>Health as a whole percent, 100 when the maximum is unknown (0).</summary>
        public int HpPct
        {
            get
            {
                if (!(MaxHp > 0f)) return 100;
                float p = 100f * (Hp < 0f ? 0f : Hp) / MaxHp;
                if (float.IsNaN(p)) return 0;
                return p > 100f ? 100 : (int)(p + 0.5f);
            }
        }

        internal void CopyFrom(Protocol.WireSelf w, Protocol.WireOwnerCombat ownerCombat = null)
        {
            Id = w.Id; Faction = (FactionId)w.Faction; X = w.X; Y = w.Y; Facing = w.Facing; Hp = w.Hp; MaxHp = w.MaxHp;
            Status = (ActorStatus)w.Status; Weapon = (WeaponId)w.Weapon; ReadyInMs = w.ReadyInMs; Kills = w.Kills; Bounty = w.Bounty;
            HuntTarget = w.HuntTarget; HuntStacks = w.HuntStacks;
            Gv = w.Gv; MoveSeq = w.MoveSeq; Effects = w.Effects; DisplaceSeq = w.DisplaceSeq; SelfSig=w.Sig;
            Barrier = w.Barrier; BarrierRingStep = w.BarrierRingStep;
            Wish = w.Wish == null ? (WishView?)null : WishView.From(w.Wish);
            OwnerCombat = ownerCombat == null ? (OwnerCombatView?)null : new OwnerCombatView(ownerCombat);
        }
    }
}
