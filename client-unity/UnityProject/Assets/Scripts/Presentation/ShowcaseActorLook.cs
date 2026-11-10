using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>Coherent art reuse for public actor identities; no rules, species claims or gameplay sizes.</summary>
    public static class ShowcaseActorLook
    {
        /// <summary>The key of archetype 0 in the Welcome table: legacy circle hulls carry no art, so the key names no look.</summary>
        public const string LegacyArchetypeKey = "legacy_circle";

        /// <summary>
        /// Legacy-only fallback (ADR0024): with <c>--hitboxes archetypes</c> the server sends every actor's archetype key, which is the
        /// catalog key, and <see cref="AppearanceKey"/> uses it. Under <c>legacy_circle</c> every actor is archetype 0 and a server that
        /// sends no table says nothing about the look, so mobs still need this per-type mapping (rh-sim archetype.rs keeps the same
        /// mapping for the live mode; a test pins the two together).
        /// </summary>
        public static readonly string[] MobLooks =
        {
            "goblin", "mob-antlion", "mob-goblin-elite", "mob-skeleton-mage", "mob-goblin-elite", "mob-antlion",
            "skeleton", "mob-goblin-elite", "mob-skeleton-archer", "mob-skeleton-mage", "mob-goblin-elite", "mob-skeleton-mage",
            "mob-antlion", "mob-antlion", "mob-zombie", "mage-female", "mob-goblin-elite", "mob-zombie",
            "mob-skeleton-mage", "mob-goblin-elite", "mob-skeleton-archer", "mob-skeleton-archer", "skeleton", "mob-goblin-elite",
            "mage", "mob-skeleton-mage", "mob-zombie", "hero", "mage-female", "hero-female"
        };

        /// <summary>True for a key the server chose for a drawn fighter: present and not the legacy circle row.</summary>
        public static bool IsArchetypeLook(string archetypeKey)
        {
            return !string.IsNullOrEmpty(archetypeKey) && archetypeKey != LegacyArchetypeKey;
        }

        /// <summary>
        /// The catalog key to draw. The server's archetype key (table key = catalog key) wins whenever it names a look; a quest giver
        /// always uses the neutral silhouette (the giver's server archetype is only a hero-sized box). Without a key (no table, or the
        /// legacy row) the faction and mob-type mapping below decides, exactly as before protocol 16.
        /// </summary>
        public static string AppearanceKey(ActorKind kind, FactionId? faction, MobTypeId? type, string archetypeKey)
        {
            if (kind == ActorKind.QuestGiver) return null;
            if (IsArchetypeLook(archetypeKey)) return archetypeKey;
            return AppearanceKey(kind, faction, type);
        }

        public static string AppearanceKey(ActorKind kind, FactionId? faction, MobTypeId? type)
        {
            // The giver uses the existing neutral silhouette, without a fighter catalog fallback.
            if (kind == ActorKind.QuestGiver) return null;
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
