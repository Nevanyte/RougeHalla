using UnityEngine;
using UnityEngine.Audio;

namespace Roguehalla.Client
{
    [CreateAssetMenu(menuName = "Roguehalla/Presentation Catalog")]
    public sealed class ShowcaseCatalog : ScriptableObject
    {
        [System.Serializable]
        public sealed class Appearance
        {
            public string Key;
            public Sprite[] Idle, Walk, Attack;
            public Sprite[] Block, Hit, Death, Cast, Shoot;
            public float FramesPerSecond = 10;
            public float IdleFPS, WalkFPS, AttackFPS, BlockFPS, HitFPS, DeathFPS, CastFPS, ShootFPS;
            public float WorldHeight = 1.6f;
            public Vector2 GroundPivot = new Vector2(.5f, .16f);
        }
        public Appearance[] Actors = System.Array.Empty<Appearance>();
        public Sprite Chest, Barrel, Statue;
        public AudioClip Music, Ambience;
        public AudioClip[] Hits, Swings, Ui;
        public ShowcaseAudioLibrary AudioLibrary;
        public AudioMixerGroup MusicGroup, AmbienceGroup, SfxGroup;
        /// <summary>The first look with this key (null for none). The actor presenter asks several times per actor per frame, so the
        /// linear string scan is indexed once per <see cref="Actors"/> array (rebuilt if the array is replaced or resized).</summary>
        public Appearance Find(string key)
        {
            if (key == null) return null;
            var actors = Actors;
            if (actors == null) return null;
            if (!ReferenceEquals(_indexed, actors) || _indexedLength != actors.Length) BuildIndex(actors);
            if (_index.TryGetValue(key, out var hit) && hit.Key == key) return hit;   // the key check also catches an entry edited in place
#if UNITY_EDITOR
            foreach (var entry in actors) if (entry != null && entry.Key == key) return entry;   // editor tools may rename entries in place
#endif
            return null;
        }
        [System.NonSerialized] Appearance[] _indexed; [System.NonSerialized] int _indexedLength;
        [System.NonSerialized] System.Collections.Generic.Dictionary<string, Appearance> _index;
        void BuildIndex(Appearance[] actors)
        {
            _index ??= new System.Collections.Generic.Dictionary<string, Appearance>(System.StringComparer.Ordinal); _index.Clear();
            foreach (var entry in actors) if (entry != null && entry.Key != null && !_index.ContainsKey(entry.Key)) _index.Add(entry.Key, entry);
            _indexed = actors; _indexedLength = actors.Length;
        }
    }
}
