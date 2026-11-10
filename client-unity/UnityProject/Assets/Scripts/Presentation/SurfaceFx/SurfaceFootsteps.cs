using System;
using Roguehalla.Net;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Plays the procedural footstep clips (FootstepSynth) on a small fixed set of AudioSources: clips are made lazily on first use,
    /// variants never repeat back to back, pitch and volume are jittered, and the nearest steps win when the voices are busy. Never throws.
    /// </summary>
    public sealed class SurfaceFootsteps
    {
        readonly AudioClip[,] _clips = new AudioClip[11, FootstepSynth.Variants];
        readonly int[] _last = new int[11];
        readonly AudioSource[] _sources;
        readonly VoicePicker _picker;
        readonly System.Random _rng = new System.Random(1234);
        public int Played { get; private set; }
        public int Dropped { get; private set; }

        public SurfaceFootsteps(Transform parent, int voices, UnityEngine.Audio.AudioMixerGroup group)
        {
            _picker = new VoicePicker(voices); _sources = new AudioSource[voices];
            for (int i = 0; i < voices; i++)
            {
                var go = new GameObject("Footstep voice " + (i + 1)); go.transform.SetParent(parent, false);
                var s = go.AddComponent<AudioSource>(); s.playOnAwake = false; s.loop = false; s.spatialBlend = 0f;
                if (group != null) s.outputAudioMixerGroup = group;
                _sources[i] = s;
            }
            for (int i = 0; i < _last.Length; i++) _last[i] = -1;
        }

        AudioClip Clip(StepSound sound, int variant)
        {
            var c = _clips[(int)sound, variant];
            if (c != null) return c;
            var data = FootstepSynth.Render(sound, variant);
            c = AudioClip.Create("step_" + sound + "_" + variant, data.Length, 1, FootstepSynth.SampleRate, false);
            c.SetData(data, 0);
            return _clips[(int)sound, variant] = c;
        }

        /// <summary>Returns the voice used, or -1 when dropped (too many nearer steps) or on any audio failure.</summary>
        public int Play(StepSound sound, float gain, float pan, float distanceTiles, float sfxVolume, float now)
        {
            if (sound == StepSound.None || gain <= 0f || sfxVolume <= 0f) return -1;
            try
            {
                int variant = _rng.Next(FootstepSynth.Variants);
                if (variant == _last[(int)sound]) variant = (variant + 1) % FootstepSynth.Variants;
                _last[(int)sound] = variant;
                var clip = Clip(sound, variant);
                int voice = _picker.Acquire(now, distanceTiles, clip.length);
                if (voice < 0) { Dropped++; return -1; }
                var s = _sources[voice];
                s.clip = clip;
                s.pitch = 0.92f + (float)_rng.NextDouble() * 0.16f;
                s.volume = Mathf.Clamp01(gain * sfxVolume * (0.85f + (float)_rng.NextDouble() * 0.15f));
                s.panStereo = Mathf.Clamp(pan, -1f, 1f);
                s.Play();
                Played++;
                return voice;
            }
            catch (Exception) { return -1; }   // autoplay blocked or no audio device: stay silent, never throw
        }
    }
}
