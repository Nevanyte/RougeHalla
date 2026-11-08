// Regenerates the original five Flare appearances from their retained Raw definitions and PNGs.
// Output is isolated from Assets/Art/Derived/Flare and Assets/Resources/Showcase/Catalog.asset.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.Audio;
using Roguehalla.Client;

namespace Roguehalla.Editor
{
    public static class FlareFullBaseImporter
    {
        const string SourceRoot = "Assets/Art/ThirdParty/Flare/Raw/";
        const string TemplateCatalogPath = "Assets/Art/Derived/ShowcaseLive/OriginalSourceCatalog.asset";
        const string OutputRoot = "Assets/Art/Derived/FlareFullBase/";
        const string VersionRoot = OutputRoot + "Versions/";
        const string CatalogPath = OutputRoot + "Catalog.asset";
        const string ReceiptPath = OutputRoot + "receipt.json";
        const int Cell = 388;
        const int Columns = 16;
        const int PixelsPerUnit = 128;
        const int AnchorX = 194;
        const int AnchorY = 79;
        const int LegacyCell = 224;
        const int LegacyAnchorX = 112;
        const int LegacyAnchorY = 32;
        const int RequiredClearance = 2;
        const int MaxAtlasSize = 8192;
        static readonly string[] Clips = { "stance", "run", "swing", "block", "hit", "die", "cast", "shoot" };

        sealed class Frame
        {
            public int Index, Direction, X, Y, Width, Height, PivotX, PivotY;
        }

        sealed class Layer
        {
            public string DefinitionPath, ImagePath, DefinitionSha256;
            public readonly Dictionary<string, List<Frame>> Clips = new Dictionary<string, List<Frame>>(StringComparer.Ordinal);
            public readonly Dictionary<string, int> FrameCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            public readonly Dictionary<string, float> Fps = new Dictionary<string, float>(StringComparer.Ordinal);
        }

        struct FrameKey : IEquatable<FrameKey>
        {
            public readonly int Index, Direction;
            public FrameKey(int index, int direction) { Index = index; Direction = direction; }
            public bool Equals(FrameKey other) => Index == other.Index && Direction == other.Direction;
            public override bool Equals(object obj) => obj is FrameKey other && Equals(other);
            public override int GetHashCode() => unchecked(Index * 397 ^ Direction);
        }

        sealed class Slot
        {
            public string Clip;
            public int Index, Direction, AtlasIndex;
            public readonly HashSet<long> LegacyOutsideSites = new HashSet<long>();
            public Sprite Baked;
        }

        sealed class AppearancePlan
        {
            public string Key;
            public Layer[] Layers;
            public readonly List<Slot> Slots = new List<Slot>();
            public readonly Dictionary<string, Sprite[]> SpriteClips = new Dictionary<string, Sprite[]>(StringComparer.Ordinal);
            public readonly Dictionary<string, int> LegacyOutsideSamples = new Dictionary<string, int>(StringComparer.Ordinal);
            public readonly Dictionary<string, int> LegacyOutsideSites = new Dictionary<string, int>(StringComparer.Ordinal);
            public int Rows, Width, Height;
            public string AtlasPath, AtlasSha256;
            public int MinRelativeX = int.MaxValue, MaxRelativeX = int.MinValue;
            public int MinRelativeY = int.MaxValue, MaxRelativeY = int.MinValue;
            public float[] Fps = new float[Clips.Length];
        }

        [Serializable]
        sealed class Receipt
        {
            public string schema = "roguehalla.flare-full-base.v1";
            public string sourceRoot = SourceRoot;
            public string templateCatalog = TemplateCatalogPath;
            public string outputCatalog = CatalogPath;
            public string atlasRunId;
            public int cell = Cell, columns = Columns, anchorX = AnchorX, anchorY = AnchorY, pixelsPerUnit = PixelsPerUnit, clearance = RequiredClearance;
            public InputHash[] sourceHashes;
            public AppearanceReceipt[] appearances;
            public string statement = "Recovered opaque source pixels are those discarded by the previous 224px cell compositor. Input Raw files and source importers were not modified.";
        }

        [Serializable]
        sealed class InputHash
        {
            public string path, sha256;
        }

        [Serializable]
        sealed class AppearanceReceipt
        {
            public string key, atlasPath, atlasSha256;
            public int atlasWidth, atlasHeight, minRelativeX, maxRelativeX, minRelativeY, maxRelativeY;
            public int oldCellClippedOpaqueSamples, oldCellClippedUniqueSites;
            public ClipReceipt[] clips;
        }

        [Serializable]
        sealed class ClipReceipt
        {
            public string key;
            public int framesPerDirection, slotCount, oldCellClippedOpaqueSamples, oldCellClippedUniqueSites;
        }

        sealed class CatalogSnapshot
        {
            public ShowcaseCatalog.Appearance[] Actors;
            public Sprite Chest, Barrel, Statue;
            public AudioClip Music, Ambience;
            public AudioClip[] Hits, Swings, Ui;
            public ShowcaseAudioLibrary AudioLibrary;
            public AudioMixerGroup MusicGroup, AmbienceGroup, SfxGroup;
        }

        public static ShowcaseCatalog Import()
        {
            EnsureOutputFolders();
            var template = AssetDatabase.LoadAssetAtPath<ShowcaseCatalog>(TemplateCatalogPath);
            if (template == null)
                throw new FileNotFoundException("Expected preserved original-catalog template", TemplateCatalogPath);

            List<AppearancePlan> plans = ReadPlans();
            string runId = ComputeRunId(plans);
            var runFolder = VersionRoot + runId + "/";
            EnsureAssetFolder(VersionRoot.TrimEnd('/'));
            EnsureAssetFolder(runFolder.TrimEnd('/'));
            EnsureAssetFolder(runFolder + "Actors");

            var createdPngs = new List<string>();
            var sprites = new List<Sprite>();
            ShowcaseCatalog output = null;
            bool outputCreated = false;
            bool outputCommitted = false;
            CatalogSnapshot previous = null;
            string receiptAbsolute = Path.GetFullPath(ReceiptPath);
            bool receiptExisted = File.Exists(receiptAbsolute);
            byte[] previousReceipt = receiptExisted ? File.ReadAllBytes(receiptAbsolute) : null;
            try
            {
                foreach (AppearancePlan plan in plans)
                {
                    Compose(plan, runFolder, createdPngs);
                    ImportAtlasAndCreateSpriteAssets(plan, sprites);
                }

                var bakedActors = plans.Select(BuildAppearance).ToArray();
                output = AssetDatabase.LoadAssetAtPath<ShowcaseCatalog>(CatalogPath);
                if (output == null)
                {
                    output = ScriptableObject.CreateInstance<ShowcaseCatalog>();
                    AssetDatabase.CreateAsset(output, CatalogPath);
                    outputCreated = true;
                }
                else previous = Capture(output);

                foreach (Sprite sprite in sprites) AssetDatabase.AddObjectToAsset(sprite, output);
                ApplyTemplateAndActors(output, template, bakedActors);
                EditorUtility.SetDirty(output);
                AssetDatabase.SaveAssets();
                WriteReceipt(plans, runId);
                outputCommitted = true;
                RemoveOldGeneratedSprites(CatalogPath, new HashSet<Sprite>(sprites));
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();
                Debug.Log("Imported five full-pixel Flare base appearances to isolated " + CatalogPath);
                return output;
            }
            catch
            {
                // Once published, pruning failure must not restore destroyed old subassets.
                if (outputCommitted) throw;
                foreach (Sprite sprite in sprites)
                {
                    if (sprite == null) continue;
                    string path = AssetDatabase.GetAssetPath(sprite);
                    if (path == CatalogPath)
                    {
                        AssetDatabase.RemoveObjectFromAsset(sprite);
                        UnityEngine.Object.DestroyImmediate(sprite, true);
                    }
                    else if (string.IsNullOrEmpty(path)) UnityEngine.Object.DestroyImmediate(sprite);
                }
                if (outputCreated && output != null) AssetDatabase.DeleteAsset(CatalogPath);
                else if (output != null && previous != null)
                {
                    Restore(output, previous);
                    EditorUtility.SetDirty(output);
                }
                foreach (string png in createdPngs) AssetDatabase.DeleteAsset(png);
                if (receiptExisted) File.WriteAllBytes(receiptAbsolute, previousReceipt);
                else if (File.Exists(receiptAbsolute)) File.Delete(receiptAbsolute);
                AssetDatabase.SaveAssets();
                throw;
            }
        }

        [MenuItem("Roguehalla/Art/Import Full Flare Base (Isolated)")]
        static void ImportFromMenu() => Import();

        static List<AppearancePlan> ReadPlans()
        {
            var result = new List<AppearancePlan>(5);
            result.Add(ReadAppearance("knight", new[] { "animations/npcs/knight.txt" }, allowEmptyNonIdle: true));
            result.Add(ReadAppearance("goblin", new[] { "animations/enemies/goblin.txt" }, allowEmptyNonIdle: false));
            result.Add(ReadAppearance("skeleton", new[] { "animations/enemies/skeleton.txt" }, allowEmptyNonIdle: false));
            foreach (string gender in new[] { "male", "female" })
            {
                string head = gender == "male" ? "head_short" : "head_long";
                string[] layerNames = { "plate_boots", "plate_greaves", "plate_cuirass", "plate_gauntlets", head, "plate_helm" };
                string[] definitions = layerNames.Select(part => "animations/avatar/" + gender + "/" + part + ".txt").ToArray();
                result.Add(ReadAppearance(gender == "male" ? "hero" : "hero-female", definitions, allowEmptyNonIdle: false));
            }
            return result;
        }

        static AppearancePlan ReadAppearance(string key, string[] relativeDefinitions, bool allowEmptyNonIdle)
        {
            Layer[] layers = relativeDefinitions.Select(ReadDefinition).ToArray();
            ValidateLayers(key, layers, allowEmptyNonIdle);
            var plan = new AppearancePlan { Key = key, Layers = layers };
            int atlasIndex = 0;
            for (int clipIndex = 0; clipIndex < Clips.Length; clipIndex++)
            {
                string clip = Clips[clipIndex];
                plan.Fps[clipIndex] = layers[0].Fps.TryGetValue(clip, out float fps) ? fps : 10f;
                var first = layers[0].Clips.TryGetValue(clip, out List<Frame> baseFrames) ? baseFrames : new List<Frame>();
                int frameCount = first.Count == 0 ? 0 : first.Max(frame => frame.Index) + 1;
                if (allowEmptyNonIdle && clip != "stance" && frameCount != 0)
                    throw new InvalidDataException(key + " is expected to be stance-only, but [" + clip + "] contains frames");
                for (int direction = 0; direction < 8; direction++)
                    for (int index = 0; index < frameCount; index++)
                        plan.Slots.Add(new Slot { Clip = clip, Direction = direction, Index = index, AtlasIndex = atlasIndex++ });
                plan.LegacyOutsideSamples.Add(clip, 0);
                plan.LegacyOutsideSites.Add(clip, 0);
                plan.SpriteClips.Add(clip, new Sprite[frameCount * 8]);
            }
            if (plan.Slots.Count == 0) throw new InvalidDataException(key + " has no authored core animation frames");
            plan.Rows = (plan.Slots.Count + Columns - 1) / Columns;
            plan.Width = Columns * Cell;
            plan.Height = plan.Rows * Cell;
            if (plan.Width > MaxAtlasSize || plan.Height > MaxAtlasSize)
                throw new InvalidDataException(key + " full-source atlas exceeds Unity's 8192px import limit");
            return plan;
        }

        static Layer ReadDefinition(string relativePath)
        {
            string path = SourceRoot + relativePath;
            if (!File.Exists(Path.GetFullPath(path))) throw new FileNotFoundException("Missing original Flare animation definition", path);
            var layer = new Layer { DefinitionPath = path, DefinitionSha256 = HashFile(path) };
            string clip = null;
            foreach (string raw in File.ReadAllLines(Path.GetFullPath(path)))
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
                    if (!int.TryParse(line.Substring(7), NumberStyles.Integer, CultureInfo.InvariantCulture, out int count) || count < 0)
                        throw new InvalidDataException(path + ": invalid frame count in [" + clip + "]");
                    layer.FrameCounts[clip] = count;
                }
                else if (line.StartsWith("duration=", StringComparison.Ordinal) && clip != null)
                {
                    string value = line.Substring(9).Trim();
                    if (value.EndsWith("ms", StringComparison.OrdinalIgnoreCase) &&
                        float.TryParse(value.Substring(0, value.Length - 2), NumberStyles.Float, CultureInfo.InvariantCulture, out float milliseconds) && milliseconds > 0f)
                    {
                        int count = layer.FrameCounts.TryGetValue(clip, out int declared) ? declared : 1;
                        layer.Fps[clip] = count * 1000f / milliseconds;
                    }
                }
                else if (line.StartsWith("frame=", StringComparison.Ordinal) && clip != null)
                {
                    int[] values = line.Substring(6).Split(',').Select(value => int.Parse(value, CultureInfo.InvariantCulture)).ToArray();
                    if (values.Length != 8) throw new InvalidDataException(path + ": expected eight frame values");
                    layer.Clips[clip].Add(new Frame
                    {
                        Index = values[0], Direction = values[1], X = values[2], Y = values[3],
                        Width = values[4], Height = values[5], PivotX = values[6], PivotY = values[7]
                    });
                }
            }
            if (string.IsNullOrWhiteSpace(layer.ImagePath)) throw new InvalidDataException(path + ": missing image= entry");
            layer.ImagePath = NormalizeRawPath(layer.ImagePath, path);
            return layer;
        }

        static string NormalizeRawPath(string image, string definitionPath)
        {
            image = image.Replace('\\', '/');
            if (Path.IsPathRooted(image) || image.Split('/').Any(part => part == ".."))
                throw new InvalidDataException(definitionPath + ": image path escapes the pinned Raw subtree");
            string path = SourceRoot + image;
            if (!File.Exists(Path.GetFullPath(path))) throw new FileNotFoundException("Missing original Flare source PNG", path);
            return path;
        }

        static void ValidateLayers(string key, Layer[] layers, bool allowEmptyNonIdle)
        {
            if (layers.Length == 0) throw new InvalidDataException(key + " has no source layers");
            foreach (string clip in Clips)
            {
                bool emptyAllowed = allowEmptyNonIdle && clip != "stance";
                Dictionary<FrameKey, Frame> expected = GetFrameMap(layers[0], clip, key, emptyAllowed);
                if (!emptyAllowed && expected.Count == 0)
                    throw new InvalidDataException(key + " is missing required core clip [" + clip + "]");
                int count = expected.Count == 0 ? 0 : expected.Keys.Max(slot => slot.Index) + 1;
                if (count > 0)
                    for (int direction = 0; direction < 8; direction++)
                        for (int index = 0; index < count; index++)
                            if (!expected.ContainsKey(new FrameKey(index, direction)))
                                throw new InvalidDataException(key + "/[" + clip + "] lacks direction/index " + direction + "/" + index);

                for (int layerIndex = 0; layerIndex < layers.Length; layerIndex++)
                {
                    Layer layer = layers[layerIndex];
                    Dictionary<FrameKey, Frame> current = GetFrameMap(layer, clip, key + " layer " + layer.DefinitionPath, emptyAllowed);
                    if (current.Count != expected.Count || expected.Keys.Any(slot => !current.ContainsKey(slot)))
                        throw new InvalidDataException(key + ": layer " + layer.DefinitionPath + " does not align in [" + clip + "]");
                    if (layerIndex > 0 && layers[0].Fps.TryGetValue(clip, out float firstFps) &&
                        layer.Fps.TryGetValue(clip, out float layerFps) && Mathf.Abs(firstFps - layerFps) > .001f)
                        throw new InvalidDataException(key + ": layer animation rate differs in [" + clip + "]");
                }
            }
        }

        static Dictionary<FrameKey, Frame> GetFrameMap(Layer layer, string clip, string label, bool emptyAllowed)
        {
            if (!layer.Clips.TryGetValue(clip, out List<Frame> list))
            {
                if (emptyAllowed) return new Dictionary<FrameKey, Frame>();
                throw new InvalidDataException(label + " has no section [" + clip + "]");
            }
            var map = new Dictionary<FrameKey, Frame>();
            foreach (Frame frame in list)
            {
                if (frame.Index < 0 || frame.Direction < 0 || frame.Direction > 7 || frame.Width <= 0 || frame.Height <= 0)
                    throw new InvalidDataException(label + "/[" + clip + "] has invalid frame metadata");
                var slot = new FrameKey(frame.Index, frame.Direction);
                if (map.ContainsKey(slot)) throw new InvalidDataException(label + "/[" + clip + "] has duplicate direction/index");
                map.Add(slot, frame);
            }
            int maxIndex = map.Count == 0 ? -1 : map.Keys.Max(slot => slot.Index);
            int declared = layer.FrameCounts.TryGetValue(clip, out int frames) ? frames : maxIndex + 1;
            if (map.Count == 0 && emptyAllowed && declared == 0) return map;
            if (declared != maxIndex + 1 || map.Count != declared * 8)
                throw new InvalidDataException(label + "/[" + clip + "] declared frame count does not match eight-direction records");
            return map;
        }

        static void Compose(AppearancePlan plan, string runFolder, List<string> createdPngs)
        {
            var output = new Color32[checked(plan.Width * plan.Height)];
            foreach (Layer layer in plan.Layers)
            {
                string imageAbsolute = Path.GetFullPath(layer.ImagePath);
                byte[] pngBytes = File.ReadAllBytes(imageAbsolute);
                Texture2D source = new Texture2D(2, 2, TextureFormat.RGBA32, false, false);
                try
                {
                    if (!source.LoadImage(pngBytes, false)) throw new InvalidDataException("Could not decode source PNG " + layer.ImagePath);
                    int sourceWidth = source.width, sourceHeight = source.height;
                    Color32[] sourcePixels = source.GetPixels32();
                    foreach (string clip in Clips)
                    {
                        if (!layer.Clips.TryGetValue(clip, out List<Frame> sourceFrames)) continue;
                        foreach (Frame frame in sourceFrames)
                        {
                            if (frame.X < 0 || frame.Y < 0 || frame.X + frame.Width > sourceWidth || frame.Y + frame.Height > sourceHeight)
                                throw new InvalidDataException(layer.DefinitionPath + "/[" + clip + "] rect escapes image " + layer.ImagePath);
                            var slot = FindSlot(plan, clip, frame.Index, frame.Direction);
                            for (int localYFromBottom = 0; localYFromBottom < frame.Height; localYFromBottom++)
                            {
                                int sourceRow = (sourceHeight - frame.Y - frame.Height + localYFromBottom) * sourceWidth + frame.X;
                                for (int localX = 0; localX < frame.Width; localX++)
                                {
                                    Color32 src = sourcePixels[sourceRow + localX];
                                    if (src.a == 0) continue;
                                    int relativeX = localX - frame.PivotX;
                                    int relativeY = localYFromBottom - frame.Height + frame.PivotY;
                                    int cellX = AnchorX + relativeX;
                                    int cellY = AnchorY + relativeY;
                                    if (cellX < RequiredClearance || cellX >= Cell - RequiredClearance ||
                                        cellY < RequiredClearance || cellY >= Cell - RequiredClearance)
                                        throw new InvalidDataException(keyMessage(plan, layer, clip, frame, relativeX, relativeY, cellX, cellY));
                                    plan.MinRelativeX = Math.Min(plan.MinRelativeX, relativeX);
                                    plan.MaxRelativeX = Math.Max(plan.MaxRelativeX, relativeX);
                                    plan.MinRelativeY = Math.Min(plan.MinRelativeY, relativeY);
                                    plan.MaxRelativeY = Math.Max(plan.MaxRelativeY, relativeY);
                                    int oldX = LegacyAnchorX + relativeX;
                                    int oldY = LegacyAnchorY + relativeY;
                                    if (oldX < 0 || oldX >= LegacyCell || oldY < 0 || oldY >= LegacyCell)
                                    {
                                        plan.LegacyOutsideSamples[clip]++;
                                        slot.LegacyOutsideSites.Add(EncodeSite(oldX, oldY));
                                    }

                                    int atlasX = (slot.AtlasIndex % Columns) * Cell + cellX;
                                    int atlasY = (slot.AtlasIndex / Columns) * Cell + cellY;
                                    int at = atlasY * plan.Width + atlasX;
                                    Color32 dst = output[at];
                                    float alpha = src.a / 255f, destinationAlpha = dst.a / 255f;
                                    float outAlpha = alpha + destinationAlpha * (1f - alpha);
                                    output[at] = new Color32(
                                        (byte)((src.r * alpha + dst.r * destinationAlpha * (1f - alpha)) / outAlpha),
                                        (byte)((src.g * alpha + dst.g * destinationAlpha * (1f - alpha)) / outAlpha),
                                        (byte)((src.b * alpha + dst.b * destinationAlpha * (1f - alpha)) / outAlpha),
                                        (byte)(outAlpha * 255f));
                                }
                            }
                        }
                    }
                }
                finally { UnityEngine.Object.DestroyImmediate(source); }
            }

            foreach (Slot slot in plan.Slots)
                plan.LegacyOutsideSites[slot.Clip] += slot.LegacyOutsideSites.Count;

            var texture = new Texture2D(plan.Width, plan.Height, TextureFormat.RGBA32, false, false);
            texture.SetPixels32(output);
            texture.Apply(false, false);
            byte[] atlasPng = texture.EncodeToPNG();
            UnityEngine.Object.DestroyImmediate(texture);
            plan.AtlasSha256 = HashBytes(atlasPng);
            plan.AtlasPath = runFolder + "Actors/" + plan.Key + ".png";
            string absolute = Path.GetFullPath(plan.AtlasPath);
            bool existed = File.Exists(absolute);
            if (existed)
            {
                if (HashFile(plan.AtlasPath) != plan.AtlasSha256)
                    throw new InvalidDataException("Existing content-addressed atlas differs: " + plan.AtlasPath);
            }
            else
            {
                createdPngs.Add(plan.AtlasPath);
                File.WriteAllBytes(absolute, atlasPng);
            }
            AssetDatabase.ImportAsset(plan.AtlasPath, ImportAssetOptions.ForceSynchronousImport);
        }

        static string keyMessage(AppearancePlan plan, Layer layer, string clip, Frame frame,
            int relativeX, int relativeY, int cellX, int cellY)
        {
            return string.Format(CultureInfo.InvariantCulture,
                "{0}/[{1}] frame {2}/direction {3} has opaque source pixel at pivot-relative ({4},{5}), cell ({6},{7}); requires {8}px transparent border",
                plan.Key, clip, frame.Index, frame.Direction, relativeX, relativeY, cellX, cellY, RequiredClearance);
        }

        static long EncodeSite(int x, int y) => ((long)y << 32) ^ (uint)x;

        static Slot FindSlot(AppearancePlan plan, string clip, int index, int direction)
        {
            int clipIndex = Array.IndexOf(Clips, clip);
            if (clipIndex < 0) throw new InvalidDataException(plan.Key + " contains unrecognized clip [" + clip + "]");
            int first = 0;
            for (int i = 0; i < clipIndex; i++) first += plan.SpriteClips[Clips[i]].Length;
            int clipFrames = plan.SpriteClips[clip].Length / 8;
            if (index < 0 || index >= clipFrames || direction < 0 || direction > 7)
                throw new InvalidDataException(plan.Key + "/[" + clip + "] has frame slot outside validated coverage");
            return plan.Slots[first + direction * clipFrames + index];
        }

        static void ImportAtlasAndCreateSpriteAssets(AppearancePlan plan, List<Sprite> sprites)
        {
            var importer = AssetImporter.GetAtPath(plan.AtlasPath) as TextureImporter;
            if (importer == null) throw new InvalidDataException("Output atlas has no TextureImporter: " + plan.AtlasPath);
            importer.textureType = TextureImporterType.Default;
            importer.sRGBTexture = true;
            importer.alphaSource = TextureImporterAlphaSource.FromInput;
            importer.alphaIsTransparency = true;
            importer.mipmapEnabled = false;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.filterMode = FilterMode.Bilinear;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.maxTextureSize = MaxAtlasSize;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.compressionQuality = 100;
            importer.SaveAndReimport();

            Texture2D atlas = AssetDatabase.LoadAssetAtPath<Texture2D>(plan.AtlasPath);
            if (atlas == null) throw new InvalidDataException("Could not load persistent atlas texture " + plan.AtlasPath);
            if (atlas.width != plan.Width || atlas.height != plan.Height)
                throw new InvalidDataException("Imported atlas dimensions differ from its PNG: " + plan.AtlasPath);
            foreach (Slot slot in plan.Slots)
            {
                Rect rect = new Rect((slot.AtlasIndex % Columns) * Cell, (slot.AtlasIndex / Columns) * Cell, Cell, Cell);
                var sprite = Sprite.Create(atlas, rect, new Vector2(AnchorX / (float)Cell, AnchorY / (float)Cell),
                    PixelsPerUnit, 0, SpriteMeshType.FullRect, Vector4.zero, false);
                sprite.name = SpriteName(plan.Key, slot);
                slot.Baked = sprite;
                sprites.Add(sprite);
                int frameCount = plan.SpriteClips[slot.Clip].Length / 8;
                plan.SpriteClips[slot.Clip][slot.Direction * frameCount + slot.Index] = sprite;
            }
        }

        static ShowcaseCatalog.Appearance BuildAppearance(AppearancePlan plan)
        {
            var appearance = new ShowcaseCatalog.Appearance
            {
                Key = plan.Key,
                Idle = plan.SpriteClips["stance"], Walk = plan.SpriteClips["run"], Attack = plan.SpriteClips["swing"],
                Block = plan.SpriteClips["block"], Hit = plan.SpriteClips["hit"], Death = plan.SpriteClips["die"],
                Cast = plan.SpriteClips["cast"], Shoot = plan.SpriteClips["shoot"],
                FramesPerSecond = 10f,
                IdleFPS = plan.Fps[0], WalkFPS = plan.Fps[1], AttackFPS = plan.Fps[2], BlockFPS = plan.Fps[3],
                HitFPS = plan.Fps[4], DeathFPS = plan.Fps[5], CastFPS = plan.Fps[6], ShootFPS = plan.Fps[7],
                WorldHeight = 1.15f,
                GroundPivot = new Vector2(AnchorX / (float)Cell, AnchorY / (float)Cell)
            };
            return appearance;
        }

        static string SpriteName(string key, Slot slot) => "__FlareFullBase_" + key + "_" + slot.Clip + "_d" + slot.Direction + "_f" + slot.Index.ToString("D4", CultureInfo.InvariantCulture);

        static void ApplyTemplateAndActors(ShowcaseCatalog output, ShowcaseCatalog template, ShowcaseCatalog.Appearance[] actors)
        {
            output.Actors = actors;
            output.Chest = template.Chest; output.Barrel = template.Barrel; output.Statue = template.Statue;
            output.Music = template.Music; output.Ambience = template.Ambience;
            output.Hits = Copy(template.Hits); output.Swings = Copy(template.Swings); output.Ui = Copy(template.Ui);
            output.AudioLibrary = template.AudioLibrary;
            output.MusicGroup = template.MusicGroup; output.AmbienceGroup = template.AmbienceGroup; output.SfxGroup = template.SfxGroup;
        }

        static Receipt BuildReceipt(List<AppearancePlan> plans, string runId)
        {
            var inputs = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (Layer layer in plans.SelectMany(plan => plan.Layers))
            {
                inputs[layer.DefinitionPath] = layer.DefinitionSha256;
                inputs[layer.ImagePath] = HashFile(layer.ImagePath);
            }
            inputs[TemplateCatalogPath] = HashFile(TemplateCatalogPath);
            var appearances = new List<AppearanceReceipt>(plans.Count);
            foreach (AppearancePlan plan in plans)
            {
                var clips = new ClipReceipt[Clips.Length];
                int totalSlots = 0, totalSamples = 0, totalSites = 0;
                for (int i = 0; i < Clips.Length; i++)
                {
                    string clip = Clips[i];
                    int count = plan.SpriteClips[clip].Length / 8;
                    int samples = plan.LegacyOutsideSamples[clip], sites = plan.LegacyOutsideSites[clip];
                    clips[i] = new ClipReceipt
                    {
                        key = clip, framesPerDirection = count, slotCount = count * 8,
                        oldCellClippedOpaqueSamples = samples, oldCellClippedUniqueSites = sites
                    };
                    totalSlots += count * 8; totalSamples += samples; totalSites += sites;
                }
                appearances.Add(new AppearanceReceipt
                {
                    key = plan.Key, atlasPath = plan.AtlasPath, atlasSha256 = plan.AtlasSha256,
                    atlasWidth = plan.Width, atlasHeight = plan.Height,
                    minRelativeX = plan.MinRelativeX, maxRelativeX = plan.MaxRelativeX,
                    minRelativeY = plan.MinRelativeY, maxRelativeY = plan.MaxRelativeY,
                    oldCellClippedOpaqueSamples = totalSamples, oldCellClippedUniqueSites = totalSites,
                    clips = clips
                });
            }
            return new Receipt
            {
                atlasRunId = runId,
                sourceHashes = inputs.OrderBy(pair => pair.Key, StringComparer.Ordinal)
                    .Select(pair => new InputHash { path = pair.Key, sha256 = pair.Value }).ToArray(),
                appearances = appearances.ToArray()
            };
        }

        static void WriteReceipt(List<AppearancePlan> plans, string runId)
        {
            Receipt receipt = BuildReceipt(plans, runId);
            File.WriteAllText(Path.GetFullPath(ReceiptPath), JsonUtility.ToJson(receipt, true));
            AssetDatabase.ImportAsset(ReceiptPath, ImportAssetOptions.ForceSynchronousImport);
        }

        static string ComputeRunId(List<AppearancePlan> plans)
        {
            var assets = plans.SelectMany(plan => plan.Layers)
                .SelectMany(layer => new[] { layer.DefinitionPath, layer.ImagePath })
                .Distinct(StringComparer.Ordinal).OrderBy(path => path, StringComparer.Ordinal);
            var builder = new StringBuilder();
            foreach (string path in assets) builder.Append(path).Append(':').Append(HashFile(path)).Append('\n');
            return HashString(builder.ToString()).Substring(0, 16);
        }

        static string HashFile(string assetPath) => HashBytes(File.ReadAllBytes(Path.GetFullPath(assetPath)));
        static string HashBytes(byte[] bytes)
        {
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", string.Empty).ToLowerInvariant();
        }
        static string HashString(string value) => HashBytes(Encoding.UTF8.GetBytes(value));

        static CatalogSnapshot Capture(ShowcaseCatalog catalog) => new CatalogSnapshot
        {
            Actors = catalog.Actors, Chest = catalog.Chest, Barrel = catalog.Barrel, Statue = catalog.Statue,
            Music = catalog.Music, Ambience = catalog.Ambience, Hits = catalog.Hits, Swings = catalog.Swings,
            Ui = catalog.Ui, AudioLibrary = catalog.AudioLibrary,
            MusicGroup = catalog.MusicGroup, AmbienceGroup = catalog.AmbienceGroup, SfxGroup = catalog.SfxGroup
        };

        static void Restore(ShowcaseCatalog catalog, CatalogSnapshot snapshot)
        {
            catalog.Actors = snapshot.Actors; catalog.Chest = snapshot.Chest; catalog.Barrel = snapshot.Barrel; catalog.Statue = snapshot.Statue;
            catalog.Music = snapshot.Music; catalog.Ambience = snapshot.Ambience; catalog.Hits = snapshot.Hits;
            catalog.Swings = snapshot.Swings; catalog.Ui = snapshot.Ui; catalog.AudioLibrary = snapshot.AudioLibrary;
            catalog.MusicGroup = snapshot.MusicGroup; catalog.AmbienceGroup = snapshot.AmbienceGroup; catalog.SfxGroup = snapshot.SfxGroup;
        }

        static void RemoveOldGeneratedSprites(string path, HashSet<Sprite> keep)
        {
            foreach (Sprite old in AssetDatabase.LoadAllAssetsAtPath(path).OfType<Sprite>().ToArray())
            {
                if (keep.Contains(old) || !old.name.StartsWith("__FlareFullBase_", StringComparison.Ordinal)) continue;
                AssetDatabase.RemoveObjectFromAsset(old);
                UnityEngine.Object.DestroyImmediate(old, true);
            }
        }

        static void EnsureOutputFolders()
        {
            EnsureAssetFolder("Assets/Art");
            EnsureAssetFolder("Assets/Art/Derived");
            EnsureAssetFolder(OutputRoot.TrimEnd('/'));
            EnsureAssetFolder(VersionRoot.TrimEnd('/'));
        }

        static void EnsureAssetFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            string parent = Path.GetDirectoryName(path)?.Replace('\\', '/');
            string leaf = Path.GetFileName(path);
            if (string.IsNullOrEmpty(parent) || !AssetDatabase.IsValidFolder(parent))
                throw new DirectoryNotFoundException("Missing Unity asset parent folder " + parent);
            AssetDatabase.CreateFolder(parent, leaf);
        }

        static AudioClip[] Copy(AudioClip[] value) => value == null ? Array.Empty<AudioClip>() : (AudioClip[])value.Clone();
    }
}
