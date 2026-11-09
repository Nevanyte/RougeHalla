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
        public Appearance Find(string key)
        {
            foreach (var entry in Actors) if (entry != null && entry.Key == key) return entry;
            return null;
        }
    }
}
