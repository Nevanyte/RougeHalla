using UnityEngine;
using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>
    /// Fixed child-renderer owner for the optional faction/role/elite art overlay. Configure once under a grounded actor;
    /// Present updates cached sprites, visibility and depth without allocating. The actor root owns its lifetime.
    /// </summary>
    public sealed class ShowcaseIdentityOwner : MonoBehaviour
    {
        SpriteRenderer _mantle;
        SpriteRenderer _factionBack, _factionGlyph;
        SpriteRenderer _roleBack, _roleGlyph;
        SpriteRenderer _eliteBack, _eliteGlyph;
        bool _configured;
        int _sortingBase = int.MinValue;
        public bool StandaloneFactionBadge { get; set; } = true;

        /// <summary>Finds or creates a single owner directly below the actor's grounded root.</summary>
        public static ShowcaseIdentityOwner Configure(Transform groundedParent)
        {
            if (groundedParent == null) return null;
            var owner = groundedParent.GetComponent<ShowcaseIdentityOwner>();
            if (owner == null) owner = groundedParent.gameObject.AddComponent<ShowcaseIdentityOwner>();
            owner.EnsureRenderers();
            return owner;
        }

        /// <summary>
        /// Applies already-delivered actor metadata. Regional mob faction/role/elite come only from its canonical MobTypeId;
        /// player faction comes from its public faction field. Zombies, dummies, bad ids and absent facts use neutral art.
        /// </summary>
        public void Present(int faction, ActorKind kind, MobTypeId? mobType, int groundSortingOrder, bool visible)
        {
            EnsureRenderers();
            MobIdentityInfo mobInfo = default;
            bool knownMob = kind == ActorKind.RegionalMob && mobType.HasValue &&
                ShowcaseIdentityAssets.TryGetMobInfo(mobType.Value, out mobInfo) && (int)mobInfo.Faction == faction;
            // A future/unknown mob id must never inherit an enum-parity faction or an unrelated display identity.
            int factionIndex = knownMob ? (int)mobInfo.Faction : kind == ActorKind.Player && faction >= 0 && faction < 5 ? faction : 5;
            ShowcaseMobRole role = knownMob ? mobInfo.Role : ShowcaseMobRole.Grunt;
            bool elite = knownMob && mobInfo.Elite;
            bool show = visible;

            Sprite mantle = ShowcaseIdentityAssets.GetFactionSilhouette(factionIndex);
            Sprite factionGlyph = ShowcaseIdentityAssets.GetFactionGlyph(factionIndex);
            Sprite roleGlyph = knownMob ? ShowcaseIdentityAssets.GetRoleGlyph(role) : ShowcaseIdentityAssets.GetNeutralGlyph();
            Sprite eliteGlyph = elite && mobType.HasValue ? ShowcaseIdentityAssets.GetEliteGlyph(mobType.Value) : ShowcaseIdentityAssets.GetNeutralGlyph();

            Set(_mantle, mantle, show && kind == ActorKind.Player, groundSortingOrder - 2);
            Set(_factionBack, ShowcaseIdentityAssets.GetBadgeBackdrop(), show && StandaloneFactionBadge, groundSortingOrder + 4);
            Set(_factionGlyph, factionGlyph, show && StandaloneFactionBadge, groundSortingOrder + 5);
            Set(_roleBack, ShowcaseIdentityAssets.GetBadgeBackdrop(), show && knownMob, groundSortingOrder + 4);
            Set(_roleGlyph, roleGlyph, show && knownMob, groundSortingOrder + 5);
            Set(_eliteBack, ShowcaseIdentityAssets.GetBadgeBackdrop(), show && elite, groundSortingOrder + 4);
            Set(_eliteGlyph, eliteGlyph, show && elite, groundSortingOrder + 5);
            if (_sortingBase != groundSortingOrder)
            {
                _sortingBase = groundSortingOrder;
                Place(_mantle, new Vector3(0, .72f, -.005f), new Vector3(.9f, .7f, 1));
                Place(_factionBack, new Vector3(-.68f, 1.30f, -.012f), new Vector3(.31f, .31f, 1));
                Place(_factionGlyph, new Vector3(-.68f, 1.30f, -.013f), new Vector3(.205f, .205f, 1));
                Place(_roleBack, new Vector3(0, 1.30f, -.012f), new Vector3(.31f, .31f, 1));
                Place(_roleGlyph, new Vector3(0, 1.30f, -.013f), new Vector3(.205f, .205f, 1));
                Place(_eliteBack, new Vector3(.68f, 1.30f, -.012f), new Vector3(.31f, .31f, 1));
                Place(_eliteGlyph, new Vector3(.68f, 1.30f, -.013f), new Vector3(.205f, .205f, 1));
            }
        }

        /// <summary>Clears visual identities when a root is pooled or the actor leaves observation.</summary>
        public void Clear()
        {
            if (!_configured) return;
            HideAll();
        }

        void EnsureRenderers()
        {
            if (_configured) return;
            ShowcaseSprites.Initialize();
            _mantle = CreatePart("Faction mantle");
            _mantle.sharedMaterial = ShowcaseSprites.Lit;
            _mantle.color = new Color(.48f,.48f,.48f,.92f);
            _factionBack = CreatePart("Faction badge backplate"); _factionGlyph = CreatePart("Faction badge glyph");
            _roleBack = CreatePart("Mob role badge backplate"); _roleGlyph = CreatePart("Mob role badge glyph");
            _eliteBack = CreatePart("Elite emblem backplate"); _eliteGlyph = CreatePart("Elite emblem glyph");
            _configured = true;
        }

        SpriteRenderer CreatePart(string objectName)
        {
            var child = new GameObject(objectName);
            child.transform.SetParent(transform, false);
            var renderer = child.AddComponent<SpriteRenderer>();
            renderer.sharedMaterial = ShowcaseIdentityAssets.UnlitMaterial;
            renderer.color = Color.white;
            renderer.enabled = false;
            return renderer;
        }

        void Set(SpriteRenderer renderer, Sprite sprite, bool enabled, int order)
        {
            if (renderer.sprite != sprite) renderer.sprite = sprite;
            if (renderer.sortingOrder != order) renderer.sortingOrder = order;
            if (renderer.enabled != enabled) renderer.enabled = enabled;
        }

        static void Place(SpriteRenderer renderer, Vector3 position, Vector3 scale)
        {
            renderer.transform.localPosition = position;
            renderer.transform.localScale = scale;
        }

        void HideAll()
        {
            _mantle.enabled = _factionBack.enabled = _factionGlyph.enabled = false;
            _roleBack.enabled = _roleGlyph.enabled = _eliteBack.enabled = _eliteGlyph.enabled = false;
        }

        void OnDisable()
        {
            if (_configured) HideAll();
        }
    }
}
