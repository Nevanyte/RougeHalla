using System;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Opt-in catalog of additional presentation audio clips. It contains no mixer or gameplay policy.</summary>
    [CreateAssetMenu(menuName = "Roguehalla/Audio/Showcase Audio Library", fileName = "ShowcaseAudioLibrary")]
    public sealed class ShowcaseAudioLibrary : ScriptableObject
    {
        [Serializable]
        public sealed class CueEntry
        {
            [Tooltip("Stable semantic key, for example combat.melee.swing or mob.goblin.hit.")]
            public string CueKey;
            public AudioClip[] Variants = Array.Empty<AudioClip>();
        }

        public CueEntry[] Cues = Array.Empty<CueEntry>();

        /// <summary>Returns all clips registered for a cue, or an empty array when the key is absent.</summary>
        public AudioClip[] FindVariants(string cueKey)
        {
            if (string.IsNullOrEmpty(cueKey) || Cues == null) return Array.Empty<AudioClip>();
            for (int i = 0; i < Cues.Length; i++)
            {
                CueEntry entry = Cues[i];
                if (entry != null && string.Equals(entry.CueKey, cueKey, StringComparison.Ordinal))
                    return entry.Variants ?? Array.Empty<AudioClip>();
            }
            return Array.Empty<AudioClip>();
        }

        /// <summary>Returns the first registered clip for a cue, or null when the key is absent.</summary>
        public AudioClip Find(string cueKey)
        {
            AudioClip[] variants = FindVariants(cueKey);
            return variants.Length > 0 ? variants[0] : null;
        }
    }
}
