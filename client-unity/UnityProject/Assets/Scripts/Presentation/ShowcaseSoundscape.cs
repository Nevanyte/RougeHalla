using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Plays only server-delivered sound cues; it does not predict gameplay actions.</summary>
    public sealed class ShowcaseSoundscape : MonoBehaviour
    {
        const int SfxPoolSize = 8;

        sealed class Voice
        {
            public AudioSource Source;
            public uint Actor;
        }

        MatchClient _client;
        Session _session;
        ShowcaseSettings _settings;
        AudioSource _music, _ambience;
        Voice[] _voices;
        ShowcaseCatalog _catalog;
        ShowcaseAudio _configuredAudio;
        int _swingIndex, _hitIndex;

        /// <summary>Call from bootstrap after adding this component to the match root.</summary>
        public void Initialize(MatchClient client)
        {
            if (_client == client && _voices != null) return;
            DetachSession();
            _client = client;
            EnsureSources();
            ConfigureTracks();
        }

        void OnEnable()
        {
            BindSettings();
            EnsureSources();
            ConfigureTracks();
        }

        void OnDisable()
        {
            DetachSession();
            BindSettings(null);
        }

        void OnDestroy()
        {
            DetachSession();
            BindSettings(null);
        }

        void LateUpdate()
        {
            if (_client == null) _client = GetComponent<MatchClient>();
            EnsureSources();
            ConfigureTracks();
            BindSettings();

            Session current = _client != null ? _client.Session : null;
            if (_session != current)
            {
                DetachSession();
                _session = current;
                if (_session != null)
                {
                    _session.FxReceived += OnFx;
                    _session.EventsReceived += OnEvents;
                }
            }

            if (_voices == null || _client == null || _client.Arena == null) return;
            foreach (var voice in _voices)
            {
                if (voice.Source == null || !voice.Source.isPlaying || voice.Actor == 0) continue;
                if (!_client.Arena.IsObserved(voice.Actor))
                {
                    voice.Source.Stop();
                    voice.Source.clip = null;
                    voice.Actor = 0;
                }
            }
        }

        void EnsureSources()
        {
            if (_voices != null) return;
            _music = MakeSource("Music", true);
            _ambience = MakeSource("Ambience", true);
            _voices = new Voice[SfxPoolSize];
            for (int i = 0; i < _voices.Length; i++)
                _voices[i] = new Voice { Source = MakeSource("SFX " + (i + 1), false) };
        }

        AudioSource MakeSource(string sourceName, bool loop)
        {
            var go = new GameObject(sourceName);
            go.transform.SetParent(transform, false);
            var source = go.AddComponent<AudioSource>();
            source.playOnAwake = false;
            source.loop = loop;
            source.spatialBlend = 0;
            return source;
        }

        void ConfigureTracks()
        {
            if (_music == null || _ambience == null) return;
            var catalog = Resources.Load<ShowcaseCatalog>("Showcase/Catalog");
            if (_catalog != catalog)
            {
                _catalog = catalog;
                _music.clip = catalog != null ? catalog.Music : null;
                _ambience.clip = catalog != null ? catalog.Ambience : null;
                _music.outputAudioMixerGroup = catalog != null ? catalog.MusicGroup : null;
                _ambience.outputAudioMixerGroup = catalog != null ? catalog.AmbienceGroup : null;
                if (_voices != null)
                    foreach (var voice in _voices)
                        if (voice.Source != null) voice.Source.outputAudioMixerGroup = catalog != null ? catalog.SfxGroup : null;
            }
            var audio = ShowcaseAudio.Current;
            if (audio != null && audio != _configuredAudio)
            {
                audio.ConfigureSources(_music, _ambience, _voices != null ? _voices[0].Source : null);
                _configuredAudio = audio;
            }
        }

        void BindSettings()
        {
            BindSettings(ShowcaseSettings.Current);
        }

        void BindSettings(ShowcaseSettings settings)
        {
            if (_settings == settings) return;
            if (_settings != null) _settings.AudioChanged -= ApplyVolumes;
            _settings = settings;
            if (_settings != null) _settings.AudioChanged += ApplyVolumes;
            ApplyVolumes();
        }

        void ApplyVolumes()
        {
            if (_settings == null) return;
            if (_voices != null)
                foreach (var voice in _voices)
                    if (voice.Source != null) voice.Source.volume = _settings.SfxVolume;
        }

        void DetachSession()
        {
            if (_session == null) return;
            _session.FxReceived -= OnFx;
            _session.EventsReceived -= OnEvents;
            _session = null;
        }

        void OnFx(ServerMsg.Fx message)
        {
            if (_client == null || _client.Arena == null || message == null) return;
            foreach (var fx in message.List)
            {
                uint actor = 0;
                AudioClip[] clips = null;
                switch (fx.Kind)
                {
                    case FxKind.Swing:
                        actor = fx.By;
                        clips = Catalog != null ? Catalog.Swings : null;
                        break;
                    case FxKind.Hit:
                        actor = _client.Arena.IsObserved(fx.Victim) ? fx.Victim :
                            (_client.Arena.IsObserved(fx.By) ? fx.By : 0);
                        clips = Catalog != null ? Catalog.Hits : null;
                        break;
                    case FxKind.Block:
                    case FxKind.Stagger:
                        actor = _client.Arena.IsObserved(fx.Id) ? fx.Id :
                            (_client.Arena.IsObserved(fx.By) ? fx.By : 0);
                        clips = Catalog != null ? Catalog.Hits : null;
                        break;
                    default:
                        continue;
                }
                // A cue attached to an actor is played only while that actor is in delivered observer membership.
                if (actor == 0 || !_client.Arena.IsObserved(actor)) continue;
                Play(clips, actor, fx.Kind == FxKind.Swing);
            }
        }

        ShowcaseCatalog Catalog { get { return _catalog; } }

        void OnEvents(ServerMsg.Events message)
        {
            if (message == null) return;
            foreach (var ev in message.List)
            {
                int kind;
                switch (ev.Kind)
                {
                    case EventKind.PotionNotice:
                    case EventKind.CannonNotice:
                    case EventKind.Toast:
                        kind = 0;
                        break;
                    case EventKind.PickupRefused:
                        kind = 1;
                        break;
                    case EventKind.Bounty:
                        kind = 2;
                        break;
                    default:
                        continue;
                }
                var catalog = Catalog;
                if (catalog == null || catalog.Ui == null || kind >= catalog.Ui.Length || catalog.Ui[kind] == null) continue;
                Play(catalog.Ui[kind], 0);
            }
        }

        void Play(AudioClip[] clips, uint actor, bool swing)
        {
            if (clips == null || clips.Length == 0) return;
            int index = swing ? _swingIndex++ : _hitIndex++;
            Play(clips[index % clips.Length], actor);
        }

        void Play(AudioClip clip, uint actor)
        {
            if (clip == null || _voices == null) return;
            for (int i = 0; i < _voices.Length; i++)
            {
                var voice = _voices[i];
                if (voice.Source == null || voice.Source.isPlaying) continue;
                voice.Source.clip = clip;
                voice.Source.volume = _settings != null ? _settings.SfxVolume : .85f;
                voice.Actor = actor;
                voice.Source.Play();
                return;
            }
            // Cosmetic overlaps are capped at eight voices; drop this cue when all are busy.
        }
    }
}
