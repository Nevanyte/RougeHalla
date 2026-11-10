using System;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Plays only server-delivered sound cues; it does not predict gameplay actions.</summary>
    public sealed class ShowcaseSoundscape : MonoBehaviour
    {
        const int SfxPoolSize = 8;
        const int PendingFxCapacity = 64;
        const int PendingEventCapacity = 64;

        struct PendingFxCue
        {
            public FxKind Kind;
            public uint Actor;
            public byte Weapon, Ability;
            public bool AnonymousAnchor;
        }

        struct PendingEventCue
        {
            public EventKind Kind;
            public uint Actor;
        }

        sealed class Voice
        {
            public AudioSource Source;
            public uint Actor;
        }

        /// <summary>Set by the region atmosphere audio once streamed beds are audible: the old catalog beds stay silent from then on.</summary>
        public static bool LegacyMusicMuted, LegacyAmbienceMuted;
        MatchClient _client;
        Session _session;
        ShowcaseSettings _settings;
        AudioSource _music, _ambience;
        Voice[] _voices;
        readonly PendingFxCue[] _pendingFx = new PendingFxCue[PendingFxCapacity];
        readonly PendingEventCue[] _pendingEvents = new PendingEventCue[PendingEventCapacity];
        int _pendingFxCount;
        int _pendingEventCount;
        ShowcaseCatalog _catalog;
        ShowcaseAudio _configuredAudio;
        int _swingIndex, _hitIndex, _blockIndex, _wishIndex, _eventIndex, _deathIndex;

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
            if (LegacyMusicMuted && _music != null && (_music.clip != null || _music.isPlaying)) { _music.Stop(); _music.clip = null; }
            if (LegacyAmbienceMuted && _ambience != null && (_ambience.clip != null || _ambience.isPlaying)) { _ambience.Stop(); _ambience.clip = null; }

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

            if (_voices == null || _client == null || _client.Arena == null)
            {
                _pendingFxCount = 0;
                _pendingEventCount = 0;
                StopAllVoices();
                return;
            }
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
            ProcessPendingFx();
            ProcessPendingEvents();
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

        public void ResetTransientCues()
        {
            _pendingFxCount = 0;
            _pendingEventCount = 0;
            StopAllVoices();
        }

        void DetachSession()
        {
            _pendingFxCount = 0;
            _pendingEventCount = 0;
            StopAllVoices();
            if (_session != null)
            {
                _session.FxReceived -= OnFx;
                _session.EventsReceived -= OnEvents;
            }
            _session = null;
        }

        void StopAllVoices()
        {
            if (_voices == null) return;
            foreach (var voice in _voices)
            {
                if (voice.Source != null)
                {
                    voice.Source.Stop();
                    voice.Source.clip = null;
                }
                voice.Actor = 0;
            }
        }

        void OnFx(ServerMsg.Fx message)
        {
            if (_client == null || _client.Arena == null || message == null) return;
            foreach (var fx in message.List)
            {
                uint actor = 0;
                switch (fx.Kind)
                {
                    case FxKind.Swing:
                        actor = fx.By;
                        break;
                    case FxKind.Hit:
                        actor = fx.Victim;
                        break;
                    case FxKind.Block:
                        actor = fx.Id;
                        break;
                    case FxKind.WishLanded:
                        if (fx.Caster.HasValue)
                        {
                            actor = fx.Caster.Value;
                            if (actor == 0) continue;
                        }
                        else
                        {
                            if (!fx.HasAnchor) continue;
                            actor = 0;
                        }
                        break;
                    default:
                        continue;
                }
                // Fx callbacks can run during Poll before Arena has refreshed membership.
                // Copy only scalars; WireFx instances belong to the decoded message.
                if ((actor == 0 && fx.Kind != FxKind.WishLanded) || _pendingFxCount == _pendingFx.Length) continue;
                _pendingFx[_pendingFxCount++] = new PendingFxCue
                {
                    Kind = fx.Kind, Actor = actor, Weapon = fx.Weapon, Ability = fx.Ability,
                    AnonymousAnchor = fx.Kind == FxKind.WishLanded && !fx.Caster.HasValue && fx.HasAnchor
                };
            }
        }

        void ProcessPendingFx()
        {
            int count = _pendingFxCount;
            _pendingFxCount = 0;
            if (_client == null || _client.Arena == null) return;
            for (int i = 0; i < count; i++)
            {
                var cue = _pendingFx[i];
                switch (cue.Kind)
                {
                    case FxKind.Swing:
                        if (!_client.Arena.IsObserved(cue.Actor)) continue;
                        PlayCue(SwingCue(cue.Weapon), Catalog != null ? Catalog.Swings : null, cue.Actor, _swingIndex++);
                        break;
                    case FxKind.Hit:
                        if (!TryObservedSoundContext(cue.Actor, out _, out FactionId faction, out ActorKind kind, out MobTypeId? mob)) continue;
                        PlayCue(MobCue(kind, faction, mob, false), Catalog != null ? Catalog.Hits : null, cue.Actor, _hitIndex++);
                        break;
                    case FxKind.Block:
                        if (!TryObservedSoundContext(cue.Actor, out _, out _, out _, out _)) continue;
                        // The starter had no block voice. Keep that silent fallback if this library entry is absent.
                        PlayCue("combat.block", null, cue.Actor, _blockIndex++);
                        break;
                    case FxKind.WishLanded:
                        if (cue.Actor != 0 && !_client.Arena.IsObserved(cue.Actor)) continue;
                        if (cue.Actor == 0 && !cue.AnonymousAnchor) continue;
                        PlayCue(WishCue(cue.Ability), null, cue.Actor, _wishIndex++);
                        break;
                }
            }
        }

        ShowcaseCatalog Catalog { get { return _catalog; } }

        void OnEvents(ServerMsg.Events message)
        {
            if (message == null) return;
            foreach (var ev in message.List)
            {
                if (ev.Kind == EventKind.Death)
                {
                    if (ev.Id != 0 && _pendingEventCount < _pendingEvents.Length)
                        _pendingEvents[_pendingEventCount++] = new PendingEventCue { Kind = ev.Kind, Actor = ev.Id };
                    continue;
                }

                if (ev.Kind == EventKind.PotionNotice)
                {
                    if (ev.PotionNotice == (byte)PotionNotice.Used || ev.PotionNotice == (byte)PotionNotice.LargeUsed)
                        PlayCue("ui.potion", null, 0, _eventIndex++);
                    else if (ev.PotionNotice == (byte)PotionNotice.Stored || ev.PotionNotice == (byte)PotionNotice.LargeStored)
                        PlayCue("reward.pickup", null, 0, _eventIndex++);
                    else PlayIndexedUi(0, _eventIndex++);
                    continue;
                }

                int kind;
                switch (ev.Kind)
                {
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
                PlayIndexedUi(kind, _eventIndex++);
            }
        }

        void ProcessPendingEvents()
        {
            int count = _pendingEventCount;
            _pendingEventCount = 0;
            if (_client == null || _client.Arena == null) return;
            for (int i = 0; i < count; i++)
            {
                var cue = _pendingEvents[i];
                if (cue.Kind != EventKind.Death ||
                    !TryObservedSoundContext(cue.Actor, out _, out FactionId faction, out ActorKind kind, out MobTypeId? mob)) continue;
                // There was no death voice in the starter. Unknown and currently uncovered species stay silent.
                PlayCue(MobCue(kind, faction, mob, true), null, cue.Actor, _deathIndex++);
            }
        }

        bool TryObservedSoundContext(uint actor, out WeaponId weapon, out FactionId faction,
            out ActorKind kind, out MobTypeId? mob)
        {
            if (_client != null && _client.Arena != null && actor != 0 && _client.Arena.IsObserved(actor))
                return _client.Arena.TrySoundContext(actor, out weapon, out faction, out kind, out mob);
            weapon = default; faction = default; kind = default; mob = null;
            return false;
        }

        void PlayCue(string cueKey, AudioClip[] fallback, uint actor, int variantIndex)
        {
            if (string.IsNullOrEmpty(cueKey))
            {
                PlayFallback(fallback, actor, variantIndex);
                return;
            }
            var library = Catalog != null ? Catalog.AudioLibrary : null;
            if (library != null)
            {
                AudioClip[] variants = library.FindVariants(cueKey);
                int available = CountClips(variants);
                if (available > 0)
                {
                    int wanted = PositiveModulo(variantIndex, available);
                    for (int i = 0; i < variants.Length; i++)
                    {
                        if (variants[i] == null) continue;
                        if (wanted-- == 0) { Play(variants[i], actor); return; }
                    }
                }
            }
            PlayFallback(fallback, actor, variantIndex);
        }

        void PlayIndexedUi(int index, int variantIndex)
        {
            var catalog = Catalog;
            if (catalog != null && catalog.Ui != null && index >= 0 && index < catalog.Ui.Length)
                Play(catalog.Ui[index], 0);
        }

        void PlayFallback(AudioClip[] clips, uint actor, int variantIndex)
        {
            int available = CountClips(clips);
            if (available == 0) return;
            int wanted = PositiveModulo(variantIndex, available);
            for (int i = 0; i < clips.Length; i++)
            {
                if (clips[i] == null) continue;
                if (wanted-- == 0) { Play(clips[i], actor); return; }
            }
        }

        static int CountClips(AudioClip[] clips)
        {
            if (clips == null) return 0;
            int count = 0;
            for (int i = 0; i < clips.Length; i++) if (clips[i] != null) count++;
            return count;
        }

        static int PositiveModulo(int value, int modulus) => modulus == 0 ? 0 : (value % modulus + modulus) % modulus;

        static string SwingCue(byte weapon)
        {
            switch ((WeaponId)weapon)
            {
                case WeaponId.Sword:
                case WeaponId.Axe:
                case WeaponId.Fists: return "combat.melee.swing";
                case WeaponId.Bow: return "combat.ranged.launch";
                case WeaponId.Wand: return "combat.magic.shock";
                // A swing carrying Shield is outside the supplied semantic audio coverage.
                default: return null;
            }
        }

        static string WishCue(byte ability)
        {
            switch ((AbilityId)ability)
            {
                case AbilityId.Freeze: return "wish.freeze";
                case AbilityId.Swarm: return "wish.swarm";
                case AbilityId.Trial: return "wish.trial";
                case AbilityId.Blaze: return "wish.blaze";
                case AbilityId.LastStand: return "wish.last-stand";
                default: return null;
            }
        }

        static string MobCue(ActorKind kind, FactionId faction, MobTypeId? mob, bool death)
        {
            // Explicit sound-family reuse follows the authored public appearance mapping. It does
            // not assert that a canonical mob is a goblin/skeleton or create any gameplay fact.
            string family;
            if (kind == ActorKind.Zombie) family = "zombie";
            else if (kind == ActorKind.RegionalMob && mob.HasValue &&
                ShowcaseIdentityAssets.TryGetMobInfo(mob.Value, out var info) && info.Faction == faction)
            {
                string look = ShowcaseActorLook.AppearanceKey(kind, faction, mob);
                switch (look)
                {
                    case "skeleton": case "mob-skeleton-mage": case "mob-skeleton-archer": family = "skeleton"; break;
                    case "goblin": case "mob-goblin-elite": family = "goblin"; break;
                    case "mob-antlion": family = "antlion"; break;
                    case "mob-zombie": family = "zombie"; break;
                    default: return null;
                }
            }
            else return null;
            if (family == "zombie" && !death) return null;
            return "mob." + family + (death ? ".death" : ".hit");
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
