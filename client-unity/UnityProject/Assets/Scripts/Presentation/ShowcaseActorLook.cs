using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>Coherent art reuse for public actor identities; no rules, species claims or gameplay sizes.</summary>
    public static class ShowcaseActorLook
    {
        static readonly string[] MobLooks =
        {
            "goblin", "mob-antlion", "mob-goblin-elite", "mob-skeleton-mage", "mob-goblin-elite", "mob-antlion",
            "skeleton", "mob-goblin-elite", "mob-skeleton-archer", "mob-skeleton-mage", "mob-goblin-elite", "mob-skeleton-mage",
            "mob-antlion", "mob-antlion", "mob-zombie", "mage-female", "mob-goblin-elite", "mob-zombie",
            "mob-skeleton-mage", "mob-goblin-elite", "mob-skeleton-archer", "mob-skeleton-archer", "skeleton", "mob-goblin-elite",
            "mage", "mob-skeleton-mage", "mob-zombie", "hero", "mage-female", "hero-female"
        };

        public static string AppearanceKey(ActorKind kind, FactionId faction, MobTypeId? type)
        {
            if (kind == ActorKind.TrainingDummy) return "knight";
            if (kind == ActorKind.Zombie) return "mob-zombie";
            if (kind == ActorKind.Player)
            {
                switch (faction)
                {
                    case FactionId.Fire: return "hero";
                    case FactionId.Sentenced: return "hero";
                    case FactionId.Plague: return "mage";
                    case FactionId.Frost: return "hero-female";
                    case FactionId.Holy: return "mage-female";
                    default: return "knight";
                }
            }
            if (kind == ActorKind.RegionalMob && type.HasValue &&
                ShowcaseIdentityAssets.TryGetMobInfo(type.Value, out var info) && info.Faction == faction)
                return MobLooks[(int)type.Value];
            return "knight";
        }
    }
}
