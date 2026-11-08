using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Routes presentation volume preferences to audio sources supplied by the audio setup.</summary>
    public sealed class ShowcaseAudio : MonoBehaviour
    {
        static ShowcaseAudio _current;
        AudioSource _music, _ambience, _sfx;
        bool _gestureUnlocked;

        public static ShowcaseAudio Current { get { return _current; } }

        void Awake()
        {
            if (_current != null && _current != this) { Destroy(this); return; }
            _current = this;
        }

        void OnEnable()
        {
            var settings = ShowcaseSettings.Current;
            if (settings != null) settings.AudioChanged += ApplyVolumes;
            ApplyVolumes();
        }

        void OnDisable()
        {
            var settings = ShowcaseSettings.Current;
            if (settings != null) settings.AudioChanged -= ApplyVolumes;
        }

        void OnDestroy()
        {
            if (_current == this) _current = null;
        }

        public void ConfigureSources(AudioSource music, AudioSource ambience, AudioSource sfx)
        {
            _music = music; _ambience = ambience; _sfx = sfx;
            if (_music != null) _music.loop = true;
            if (_ambience != null) _ambience.loop = true;
            ApplyVolumes();
            if (_gestureUnlocked) StartTracks();
        }

        /// <summary>Call directly from Join/settings button input to satisfy browser audio activation rules.</summary>
        public void UnlockFromUserGesture()
        {
            _gestureUnlocked = true;
            StartTracks();
        }

        public void ApplyVolumes()
        {
            var settings = ShowcaseSettings.Current;
            if (settings == null) return;
            if (_music != null) _music.volume = settings.MusicVolume;
            if (_ambience != null) _ambience.volume = settings.AmbienceVolume;
            if (_sfx != null) _sfx.volume = settings.SfxVolume;
        }

        void StartTracks()
        {
            if (_music != null && _music.clip != null && !_music.isPlaying) _music.Play();
            if (_ambience != null && _ambience.clip != null && !_ambience.isPlaying) _ambience.Play();
        }
    }
}
