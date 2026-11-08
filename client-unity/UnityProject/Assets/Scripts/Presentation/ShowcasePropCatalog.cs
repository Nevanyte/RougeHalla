using System;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Imported Flare prop samples for opt-in art review. It contains no placement or gameplay rules.</summary>
    [CreateAssetMenu(menuName = "Roguehalla/Showcase Prop Catalog")]
    public sealed class ShowcasePropCatalog : ScriptableObject
    {
        [Serializable]
        public sealed class Entry
        {
            [SerializeField] string key;
            [SerializeField] string family;
            [SerializeField] int tileId;
            [SerializeField] string candidateRole;
            [SerializeField] string visualDescription;
            [SerializeField] string sourcePath;
            [SerializeField] string sourceUrl;
            [SerializeField] string sourceSha256;
            [SerializeField] string definitionSourcePath;
            [SerializeField] string definitionSourceUrl;
            [SerializeField] string definitionSha256;
            [SerializeField] RectInt sourceRectTopLeftPixels;
            [SerializeField] Vector2 flareOffsetPixels;
            [SerializeField] Vector2 unityPivotNormalized;
            [SerializeField] Sprite sprite;
            [SerializeField] bool hasAuthoredAnimation;
            [SerializeField] string animationRecord;

            public string Key { get { return key; } }
            public string Family { get { return family; } }
            public int TileId { get { return tileId; } }
            public string CandidateRole { get { return candidateRole; } }
            public string VisualDescription { get { return visualDescription; } }
            public string SourcePath { get { return sourcePath; } }
            public string SourceUrl { get { return sourceUrl; } }
            public string SourceSha256 { get { return sourceSha256; } }
            public string DefinitionSourcePath { get { return definitionSourcePath; } }
            public string DefinitionSourceUrl { get { return definitionSourceUrl; } }
            public string DefinitionSha256 { get { return definitionSha256; } }
            /// <summary>Source atlas rectangle, with origin at top-left, copied from the pinned tile definition.</summary>
            public RectInt SourceRectTopLeftPixels { get { return sourceRectTopLeftPixels; } }
            /// <summary>Flare draw offset from the same pinned tile definition, in source pixels.</summary>
            public Vector2 FlareOffsetPixels { get { return flareOffsetPixels; } }
            /// <summary>Normalized pivot using the existing Flare import conversion; it is data, not a world anchor rule.</summary>
            public Vector2 UnityPivotNormalized { get { return unityPivotNormalized; } }
            public Sprite Sprite { get { return sprite; } }
            public bool HasAuthoredAnimation { get { return hasAuthoredAnimation; } }
            /// <summary>Raw Flare animation line. The catalog Sprite is only the tile= base rectangle.</summary>
            public string AnimationRecord { get { return animationRecord; } }
        }

        [SerializeField] Entry[] entries = Array.Empty<Entry>();

        public int Count { get { return entries == null ? 0 : entries.Length; } }

        public Entry GetEntry(int index)
        {
            if (entries == null || (uint)index >= (uint)entries.Length) return null;
            return entries[index];
        }

        public bool TryGetEntry(string key, out Entry entry)
        {
            if (entries != null && !string.IsNullOrEmpty(key))
            {
                for (int i = 0; i < entries.Length; i++)
                {
                    Entry candidate = entries[i];
                    if (candidate != null && string.Equals(candidate.Key, key, StringComparison.Ordinal))
                    {
                        entry = candidate;
                        return true;
                    }
                }
            }
            entry = null;
            return false;
        }

        public Sprite GetSprite(string key)
        {
            return TryGetEntry(key, out Entry entry) ? entry.Sprite : null;
        }
    }
}
