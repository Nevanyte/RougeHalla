using System;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Isolated review catalog for the bounded Flare expansion set.
    /// This is presentation artwork metadata, not match or actor authority.
    /// </summary>
    [CreateAssetMenu(menuName = "Roguehalla/Asset Readiness Catalog")]
    public sealed class AssetReadinessCatalog : ScriptableObject
    {
        public ShowcaseCatalog.Appearance[] Actors = Array.Empty<ShowcaseCatalog.Appearance>();
        public Sprite[] Environment = Array.Empty<Sprite>();
        public string[] EnvironmentKeys = Array.Empty<string>();

        public ShowcaseCatalog.Appearance FindActor(string key)
        {
            if (Actors == null || string.IsNullOrEmpty(key)) return null;
            foreach (var actor in Actors)
                if (actor != null && actor.Key == key) return actor;
            return null;
        }

        public Sprite FindEnvironment(string key)
        {
            if (Environment == null || EnvironmentKeys == null || string.IsNullOrEmpty(key)) return null;
            int count = Math.Min(Environment.Length, EnvironmentKeys.Length);
            for (int i = 0; i < count; i++)
                if (EnvironmentKeys[i] == key) return Environment[i];
            return null;
        }
    }
}
