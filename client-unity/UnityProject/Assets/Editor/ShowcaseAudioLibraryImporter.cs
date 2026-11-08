using System;
using System.Collections.Generic;
using Roguehalla.Client;
using UnityEditor;
using UnityEngine;

namespace Roguehalla.Editor
{
    /// <summary>Builds a separate, opt-in cue library from the pinned Flare audio expansion sources.</summary>
    public static class ShowcaseAudioLibraryImporter
    {
        const string SourceRoot = "Assets/Art/ThirdParty/FlareAudioExpansion/Raw/";
        const string OutputFolder = "Assets/Art/Derived/FlareAudioExpansion";
        const string OutputPath = OutputFolder + "/ShowcaseAudioLibrary.asset";

        sealed class CueSpec
        {
            public readonly string Key;
            public readonly string[] Paths;

            public CueSpec(string key, params string[] paths) { Key = key; Paths = paths; }
        }

        static readonly CueSpec[] CueSpecs =
        {
            new CueSpec("combat.melee.swing", "soundfx/melee_attack_2.ogg", "soundfx/melee_attack_3.ogg"),
            new CueSpec("combat.block", "soundfx/powers/block.ogg"),
            new CueSpec("combat.ranged.launch", "soundfx/powers/shoot.ogg"),
            new CueSpec("combat.magic.shock", "soundfx/powers/shock.ogg"),
            new CueSpec("combat.magic.heal", "soundfx/powers/heal.ogg"),
            new CueSpec("wish.freeze", "soundfx/powers/freeze.ogg"),
            new CueSpec("wish.swarm", "soundfx/powers/arrow_wall.ogg"),
            new CueSpec("wish.trial", "soundfx/powers/quake.ogg"),
            new CueSpec("wish.blaze", "soundfx/powers/fireball.ogg", "soundfx/powers/burn.ogg"),
            new CueSpec("wish.last-stand", "soundfx/powers/shield.ogg"),
            new CueSpec("mob.skeleton.hit", "soundfx/enemies/skeleton_hit.ogg"),
            new CueSpec("mob.skeleton.death", "soundfx/enemies/skeleton_die.ogg"),
            new CueSpec("mob.antlion.hit", "soundfx/enemies/antlion_hit.ogg"),
            new CueSpec("mob.antlion.death", "soundfx/enemies/antlion_die.ogg"),
            new CueSpec("mob.zombie.death", "soundfx/enemies/zombie_die.ogg", "soundfx/enemies/zombie_critdie.ogg"),
            new CueSpec("mob.goblin.hit", "soundfx/enemies/goblin_hit.ogg"),
            new CueSpec("mob.goblin.death", "soundfx/enemies/goblin_die.ogg"),
            new CueSpec("reward.pickup", "soundfx/flying_loot.ogg"),
            new CueSpec("reward.levelup", "soundfx/level_up.ogg"),
            new CueSpec("ui.potion", "soundfx/inventory/inventory_potion.ogg"),
            new CueSpec("ambience.cave.loop", "soundfx/environment/cave_wind_loop.ogg"),
        };

        [MenuItem("Roguehalla/Audio/Import Flare Audio Library")]
        public static void Import()
        {
            var entries = new ShowcaseAudioLibrary.CueEntry[CueSpecs.Length];
            var missing = new List<string>();
            for (int i = 0; i < CueSpecs.Length; i++)
            {
                CueSpec spec = CueSpecs[i];
                var clips = new List<AudioClip>(spec.Paths.Length);
                for (int j = 0; j < spec.Paths.Length; j++)
                {
                    string assetPath = SourceRoot + spec.Paths[j];
                    var clip = AssetDatabase.LoadAssetAtPath<AudioClip>(assetPath);
                    if (clip == null) missing.Add(assetPath);
                    else clips.Add(clip);
                }
                entries[i] = new ShowcaseAudioLibrary.CueEntry { CueKey = spec.Key, Variants = clips.ToArray() };
            }

            if (missing.Count != 0)
            {
                Debug.LogError("Flare audio import stopped; missing or not-yet-imported clips:\n" + string.Join("\n", missing));
                return;
            }

            EnsureFolder(OutputFolder);
            var library = AssetDatabase.LoadAssetAtPath<ShowcaseAudioLibrary>(OutputPath);
            if (library == null)
            {
                library = ScriptableObject.CreateInstance<ShowcaseAudioLibrary>();
                AssetDatabase.CreateAsset(library, OutputPath);
            }
            library.Cues = entries;
            EditorUtility.SetDirty(library);
            AssetDatabase.SaveAssets();
            Debug.Log("Imported " + entries.Length + " Flare audio cue groups to " + OutputPath + ". The library is outside Resources and is not loaded automatically.");
        }

        static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            int slash = path.LastIndexOf('/');
            if (slash <= 0) throw new InvalidOperationException("Expected an Assets subfolder: " + path);
            string parent = path.Substring(0, slash);
            string leaf = path.Substring(slash + 1);
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, leaf);
        }
    }
}
