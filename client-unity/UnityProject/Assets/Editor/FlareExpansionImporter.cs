// Generates isolated, review-only derivatives of selected Flare source artwork.
// Preserve the source files and CC-BY-SA 3.0+ attribution in Assets/Art/ThirdParty/FlareExpansion.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using Roguehalla.Client;

namespace Roguehalla.Editor
{
    public static class FlareExpansionImporter
    {
        const string Source = "Assets/Art/ThirdParty/FlareExpansion/Raw/";
        const string BaseSource = "Assets/Art/ThirdParty/Flare/Raw/";
        const string Output = "Assets/Art/Derived/FlareExpansion/";
        const string CatalogPath = Output + "AssetReadiness.asset";
        const int Columns = 16;
        const int PixelsPerUnit = 128;
        static readonly string[] Clips = { "stance", "run", "swing", "block", "hit", "die", "cast", "shoot" };

        sealed class Frame
        {
            public int Index, Direction, X, Y, Width, Height, PivotX, PivotY;
        }

        sealed class LayerDefinition
        {
            public string SourceRoot, DefinitionPath, ImagePath;
            public readonly Dictionary<string, List<Frame>> Clips = new Dictionary<string, List<Frame>>();
            public readonly Dictionary<string, float> Fps = new Dictionary<string, float>();
            public readonly Dictionary<string, int> FrameCounts = new Dictionary<string, int>();
        }

        sealed class Slot
        {
            public string Clip;
            public int Direction, Index;
        }

        sealed class TileDefinition
        {
            public int Id, X, Y, Width, Height, PivotX, PivotY;
        }

        sealed class TileSample
        {
            public string Family, Category;
            public int Id;
            public string Key => Family + "-" + Category + "-" + Id.ToString(CultureInfo.InvariantCulture);
        }

        [MenuItem("Roguehalla/Art/Import Flare Expansion")]
        public static void Import()
        {
            Directory.CreateDirectory(Output);
            Directory.CreateDirectory(Output + "Actors/");
            Directory.CreateDirectory(Output + "Environment/");

            var actors = new List<ShowcaseCatalog.Appearance>();
            foreach (string name in new[] { "goblin_elite", "antlion", "skeleton_archer", "skeleton_mage", "zombie" })
            {
                var definition = ReadDefinition(Source + "animations/enemies/" + name + ".txt");
                // Antlion's longest attack reaches the right edge at a centered anchor. A four-pixel
                // anchor shift keeps all authored pixels plus filtering clearance, without changing ground contact.
                int anchorX = name == "antlion" ? 188 : 192;
                actors.Add(Compose("mob-" + name.Replace('_', '-'), new[] { definition }, 384, anchorX, 96));
            }

            foreach (string gender in new[] { "male", "female" })
            {
                string head = gender == "male" ? "head_short" : "head_long";
                var parts = new[]
                {
                    "default_feet", "mage_boots", "default_legs", "mage_skirt",
                    "default_chest", "mage_vest", "default_hands", "mage_sleeves",
                    head, "mage_hood", "staff"
                };
                var layers = parts.Select(part => ReadDefinition(
                    (part.StartsWith("default_", StringComparison.Ordinal) || part == head ? BaseSource : Source) +
                    "animations/avatar/" + gender + "/" + part + ".txt")).ToArray();
                actors.Add(Compose(gender == "male" ? "mage" : "mage-female", layers, 288, 138, 72));
            }

            var tileSamples = BuildTileSamples();
            var environment = new List<Sprite>(tileSamples.Count);
            var environmentKeys = new List<string>(tileSamples.Count);
            foreach (var sample in tileSamples)
            {
                environment.Add(ExtractTile(sample));
                environmentKeys.Add(sample.Key);
            }

            var catalog = AssetDatabase.LoadAssetAtPath<AssetReadinessCatalog>(CatalogPath);
            if (catalog == null)
            {
                catalog = ScriptableObject.CreateInstance<AssetReadinessCatalog>();
                AssetDatabase.CreateAsset(catalog, CatalogPath);
            }
            catalog.Actors = actors.ToArray();
            catalog.Environment = environment.ToArray();
            catalog.EnvironmentKeys = environmentKeys.ToArray();
            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();
            Debug.Log($"Imported {actors.Count} Flare expansion appearances and {environment.Count} cave tile samples to {CatalogPath}");
        }

        static LayerDefinition ReadDefinition(string path)
        {
            if (!File.Exists(path)) throw new FileNotFoundException("Missing Flare animation definition", path);
            string sourceRoot = path.StartsWith(Source, StringComparison.Ordinal) ? Source : BaseSource;
            var layer = new LayerDefinition { SourceRoot = sourceRoot, DefinitionPath = path };
            string clip = null;
            foreach (string raw in File.ReadAllLines(path))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal)) continue;
                if (line.StartsWith("image=", StringComparison.Ordinal))
                    layer.ImagePath = line.Substring(6).Trim();
                else if (line.StartsWith("[", StringComparison.Ordinal) && line.EndsWith("]", StringComparison.Ordinal))
                {
                    clip = line.Substring(1, line.Length - 2);
                    if (!layer.Clips.ContainsKey(clip)) layer.Clips.Add(clip, new List<Frame>());
                }
                else if (line.StartsWith("frames=", StringComparison.Ordinal) && clip != null)
                {
                    if (int.TryParse(line.Substring(7), NumberStyles.Integer, CultureInfo.InvariantCulture, out int count))
                        layer.FrameCounts[clip] = count;
                }
                else if (line.StartsWith("duration=", StringComparison.Ordinal) && clip != null)
                {
                    string duration = line.Substring(9).Trim();
                    if (duration.EndsWith("ms", StringComparison.OrdinalIgnoreCase) &&
                        float.TryParse(duration.Substring(0, duration.Length - 2), NumberStyles.Float,
                            CultureInfo.InvariantCulture, out float milliseconds) && milliseconds > 0)
                    {
                        int count = layer.FrameCounts.TryGetValue(clip, out int frames) ? frames : 1;
                        layer.Fps[clip] = count * 1000f / milliseconds;
                    }
                }
                else if (line.StartsWith("frame=", StringComparison.Ordinal) && clip != null)
                {
                    int[] values = line.Substring(6).Split(',').Select(v => int.Parse(v, CultureInfo.InvariantCulture)).ToArray();
                    if (values.Length != 8) throw new InvalidDataException(path + ": expected 8 frame values");
                    layer.Clips[clip].Add(new Frame
                    {
                        Index = values[0], Direction = values[1], X = values[2], Y = values[3],
                        Width = values[4], Height = values[5], PivotX = values[6], PivotY = values[7]
                    });
                }
            }
            if (string.IsNullOrWhiteSpace(layer.ImagePath)) throw new InvalidDataException(path + ": missing image= entry");
            foreach (string required in Clips)
                if (!layer.Clips.ContainsKey(required)) throw new InvalidDataException(path + ": missing [" + required + "] clip");
            return layer;
        }

        static ShowcaseCatalog.Appearance Compose(string key, LayerDefinition[] layers, int cell, int anchorX, int anchorY)
        {
            if (layers == null || layers.Length == 0) throw new ArgumentException("At least one source layer is required", nameof(layers));
            ValidateLayerAlignment(key, layers);
            var slots = new List<Slot>();
            foreach (string clip in Clips)
            {
                int count = layers[0].Clips[clip].Max(frame => frame.Index) + 1;
                for (int direction = 0; direction < 8; direction++)
                    for (int index = 0; index < count; index++)
                        slots.Add(new Slot { Clip = clip, Direction = direction, Index = index });
            }

            int rows = (slots.Count + Columns - 1) / Columns;
            int width = Columns * cell, height = rows * cell;
            if (width > 8192 || height > 8192)
                throw new InvalidDataException(key + ": composed atlas exceeds Unity's 8192px texture limit");
            var output = new Color32[checked(width * height)];
            foreach (LayerDefinition layer in layers)
                CompositeLayer(layer, slots, cell, anchorX, anchorY, width, height, output);

            var atlas = new Texture2D(width, height, TextureFormat.RGBA32, false);
            atlas.SetPixels32(output);
            atlas.Apply(false, false);
            string assetPath = Output + "Actors/" + key + ".png";
            File.WriteAllBytes(assetPath, atlas.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(atlas);
            AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceSynchronousImport);

            var importer = (TextureImporter)AssetImporter.GetAtPath(assetPath);
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Multiple;
            importer.spritePixelsPerUnit = PixelsPerUnit;
            importer.alphaIsTransparency = true;
            importer.mipmapEnabled = false;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.filterMode = FilterMode.Bilinear;
            importer.maxTextureSize = 8192;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.spritesheet = slots.Select((slot, i) => new SpriteMetaData
            {
                name = SpriteName(slot),
                rect = new Rect((i % Columns) * cell, (i / Columns) * cell, cell, cell),
                alignment = (int)SpriteAlignment.Custom,
                pivot = new Vector2(anchorX / (float)cell, anchorY / (float)cell)
            }).ToArray();
            importer.SaveAndReimport();

            var sprites = AssetDatabase.LoadAllAssetsAtPath(assetPath).OfType<Sprite>().ToDictionary(sprite => sprite.name);
            Sprite[] Get(string clip) => slots.Where(slot => slot.Clip == clip).Select(slot => sprites[SpriteName(slot)]).ToArray();
            float Fps(string clip) => layers[0].Fps.TryGetValue(clip, out float fps) ? fps : 10f;
            return new ShowcaseCatalog.Appearance
            {
                Key = key,
                Idle = Get("stance"), Walk = Get("run"), Attack = Get("swing"),
                Block = Get("block"), Hit = Get("hit"), Death = Get("die"), Cast = Get("cast"), Shoot = Get("shoot"),
                IdleFPS = Fps("stance"), WalkFPS = Fps("run"), AttackFPS = Fps("swing"),
                BlockFPS = Fps("block"), HitFPS = Fps("hit"), DeathFPS = Fps("die"),
                CastFPS = Fps("cast"), ShootFPS = Fps("shoot"),
                FramesPerSecond = 10f, WorldHeight = 1.15f * 224f / cell,
                GroundPivot = new Vector2(anchorX / (float)cell, anchorY / (float)cell)
            };
        }

        static void ValidateLayerAlignment(string key, LayerDefinition[] layers)
        {
            foreach (string clip in Clips)
            {
                var expected = SlotKeys(layers[0].Clips[clip]);
                for (int layerIndex = 0; layerIndex < layers.Length; layerIndex++)
                {
                    var current = SlotKeys(layers[layerIndex].Clips[clip]);
                    if (!expected.SetEquals(current))
                        throw new InvalidDataException(key + ": layer " + layers[layerIndex].DefinitionPath +
                            " does not match clip/direction/index coverage for [" + clip + "]");
                    int count = expected.Select(pair => pair.Index).DefaultIfEmpty(-1).Max() + 1;
                    for (int direction = 0; direction < 8; direction++)
                        for (int index = 0; index < count; index++)
                            if (!expected.Contains((direction, index)))
                                throw new InvalidDataException(key + ": [" + clip + "] lacks direction/index " + direction + "/" + index);
                    if (current.Count != count * 8)
                        throw new InvalidDataException(key + ": duplicate frame records in [" + clip + "]");
                }
            }
        }

        static HashSet<(int Direction, int Index)> SlotKeys(List<Frame> frames)
        {
            var result = new HashSet<(int Direction, int Index)>();
            foreach (Frame frame in frames)
                if (!result.Add((frame.Direction, frame.Index)))
                    throw new InvalidDataException("Duplicate frame direction/index record");
            return result;
        }

        static void CompositeLayer(LayerDefinition layer, List<Slot> slots, int cell, int anchorX, int anchorY,
            int outputWidth, int outputHeight, Color32[] output)
        {
            string imagePath = layer.SourceRoot + layer.ImagePath;
            var source = LoadPng(imagePath);
            Color32[] sourcePixels = source.GetPixels32();
            try
            {
                for (int slotIndex = 0; slotIndex < slots.Count; slotIndex++)
                {
                    Slot slot = slots[slotIndex];
                    Frame frame = layersFrame(layer, slot);
                    if (frame == null) throw new InvalidDataException(layer.DefinitionPath + ": incomplete frame " + SpriteName(slot));
                    if (frame.X < 0 || frame.Y < 0 || frame.Width <= 0 || frame.Height <= 0 ||
                        frame.X + frame.Width > source.width || frame.Y + frame.Height > source.height)
                        throw new InvalidDataException(layer.DefinitionPath + ": source rect outside " + layer.ImagePath);
                    int localX = anchorX - frame.PivotX;
                    int localY = anchorY - frame.Height + frame.PivotY;
                    if (localX < 0 || localY < 0 || localX + frame.Width > cell || localY + frame.Height > cell)
                        throw new InvalidDataException(layer.DefinitionPath + ": frame exceeds " + cell + "px cell at " + SpriteName(slot));
                    int slotColumn = slotIndex % Columns, slotRow = slotIndex / Columns;
                    for (int y = 0; y < frame.Height; y++)
                    {
                        int sourceRow = (source.height - frame.Y - frame.Height + y) * source.width + frame.X;
                        int targetRow = (slotRow * cell + localY + y) * outputWidth + slotColumn * cell + localX;
                        for (int x = 0; x < frame.Width; x++)
                        {
                            Color32 src = sourcePixels[sourceRow + x];
                            if (src.a == 0) continue;
                            int destination = targetRow + x;
                            Color32 dst = output[destination];
                            float alpha = src.a / 255f, destAlpha = dst.a / 255f;
                            float outAlpha = alpha + destAlpha * (1f - alpha);
                            output[destination] = new Color32(
                                (byte)((src.r * alpha + dst.r * destAlpha * (1f - alpha)) / outAlpha),
                                (byte)((src.g * alpha + dst.g * destAlpha * (1f - alpha)) / outAlpha),
                                (byte)((src.b * alpha + dst.b * destAlpha * (1f - alpha)) / outAlpha),
                                (byte)(outAlpha * 255f));
                        }
                    }
                }
            }
            finally
            {
                sourcePixels = null;
                UnityEngine.Object.DestroyImmediate(source);
                GC.Collect();
            }
        }

        static Texture2D LoadPng(string assetPath)
        {
            if (!File.Exists(assetPath)) throw new FileNotFoundException("Missing Flare image source", assetPath);
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!texture.LoadImage(File.ReadAllBytes(assetPath), false))
            {
                UnityEngine.Object.DestroyImmediate(texture);
                throw new InvalidDataException("Unable to decode PNG source: " + assetPath);
            }
            return texture;
        }

        static Frame layersFrame(LayerDefinition layer, Slot slot)
        {
            return layer.Clips[slot.Clip].FirstOrDefault(frame => frame.Direction == slot.Direction && frame.Index == slot.Index);
        }

        static string SpriteName(Slot slot) => slot.Clip + "_" + slot.Direction + "_" + slot.Index;

        static List<TileSample> BuildTileSamples()
        {
            return new List<TileSample>
            {
                new TileSample { Family = "cave", Category = "floor", Id = 16 },
                new TileSample { Family = "cave", Category = "floor", Id = 17 },
                new TileSample { Family = "cave", Category = "floor", Id = 18 },
                new TileSample { Family = "cave", Category = "floor", Id = 19 },
                new TileSample { Family = "cave", Category = "floor", Id = 20 },
                new TileSample { Family = "cave", Category = "floor", Id = 21 },
                new TileSample { Family = "cave", Category = "wall", Id = 64 },
                new TileSample { Family = "cave", Category = "wall", Id = 65 },
                new TileSample { Family = "cave", Category = "wall", Id = 66 },
                new TileSample { Family = "cave", Category = "wall", Id = 67 },
                new TileSample { Family = "cave", Category = "prop", Id = 128 },
                new TileSample { Family = "cave", Category = "prop", Id = 129 }
            };
        }

        static Sprite ExtractTile(TileSample sample)
        {
            string definitionPath = Source + "tilesetdefs/tileset_" + sample.Family + ".txt";
            if (!File.Exists(definitionPath)) throw new FileNotFoundException("Missing Flare tile definition", definitionPath);
            string image = null;
            TileDefinition selected = null;
            foreach (string raw in File.ReadAllLines(definitionPath))
            {
                string line = raw.Trim();
                if (line.StartsWith("img=", StringComparison.Ordinal)) image = line.Substring(4).Trim();
                else if (line.StartsWith("tile=", StringComparison.Ordinal))
                {
                    int[] values = line.Substring(5).Split(',').Select(v => int.Parse(v, CultureInfo.InvariantCulture)).ToArray();
                    if (values.Length != 7) throw new InvalidDataException(definitionPath + ": malformed tile= row");
                    if (values[0] == sample.Id)
                        selected = new TileDefinition
                        {
                            Id = values[0], X = values[1], Y = values[2], Width = values[3], Height = values[4],
                            PivotX = values[5], PivotY = values[6]
                        };
                }
            }
            if (selected == null) throw new InvalidDataException(definitionPath + ": tile ID " + sample.Id + " is absent");
            if (string.IsNullOrWhiteSpace(image)) throw new InvalidDataException(definitionPath + ": missing img=");
            string sourcePath = Source + image;
            var texture = LoadPng(sourcePath);
            if (selected.X < 0 || selected.Y < 0 || selected.Width <= 0 || selected.Height <= 0 ||
                selected.X + selected.Width > texture.width || selected.Y + selected.Height > texture.height)
                throw new InvalidDataException(definitionPath + ": tile " + sample.Id + " rect exceeds source texture");

            var sourcePixels = texture.GetPixels32();
            var tile = new Texture2D(selected.Width, selected.Height, TextureFormat.RGBA32, false);
            var tilePixels = new Color32[selected.Width * selected.Height];
            for (int y = 0; y < selected.Height; y++)
            {
                int sourceRow = (texture.height - selected.Y - selected.Height + y) * texture.width + selected.X;
                int targetRow = y * selected.Width;
                Array.Copy(sourcePixels, sourceRow, tilePixels, targetRow, selected.Width);
            }
            tile.SetPixels32(tilePixels);
            tile.Apply(false, false);
            string outputPath = Output + "Environment/" + sample.Key + ".png";
            File.WriteAllBytes(outputPath, tile.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(tile);
            sourcePixels = null;
            UnityEngine.Object.DestroyImmediate(texture);
            GC.Collect();

            AssetDatabase.ImportAsset(outputPath, ImportAssetOptions.ForceSynchronousImport);
            var outputImporter = AssetImporter.GetAtPath(outputPath) as TextureImporter;
            outputImporter.textureType = TextureImporterType.Sprite;
            outputImporter.spriteImportMode = SpriteImportMode.Single;
            var textureSettings = new TextureImporterSettings();
            outputImporter.ReadTextureSettings(textureSettings);
            textureSettings.spriteAlignment = (int)SpriteAlignment.Custom;
            textureSettings.spritePivot = new Vector2(
                selected.PivotX / (float)selected.Width,
                (selected.Height - selected.PivotY) / (float)selected.Height);
            outputImporter.SetTextureSettings(textureSettings);
            outputImporter.spritePixelsPerUnit = PixelsPerUnit;
            outputImporter.alphaIsTransparency = true;
            outputImporter.mipmapEnabled = false;
            outputImporter.npotScale = TextureImporterNPOTScale.None;
            outputImporter.filterMode = FilterMode.Bilinear;
            outputImporter.maxTextureSize = 8192;
            outputImporter.textureCompression = TextureImporterCompression.CompressedHQ;
            outputImporter.SaveAndReimport();
            var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(outputPath);
            if (sprite == null) throw new InvalidDataException("Unity did not import extracted tile as Sprite: " + outputPath);
            return sprite;
        }
    }
}
