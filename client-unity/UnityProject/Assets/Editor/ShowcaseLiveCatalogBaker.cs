// Builds a compact live-only catalog from existing authored Showcase catalogs.
// This helper never edits source sprites, texture importers, or the Resources catalog.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;
using Roguehalla.Client;

namespace Roguehalla.Editor
{
    public static class ShowcaseLiveCatalogBaker
    {
        const string OutputRoot = "Assets/Art/Derived/ShowcaseLive/";
        const string AtlasRoot = OutputRoot + "Atlases/";
        const string CatalogPath = OutputRoot + "Catalog.asset";
        const string ReceiptPath = OutputRoot + "receipt.json";
        const int InitialAtlasWidth = 2048;
        const int MaximumAtlasSize = 8192;
        const int Gutter = 4;
        const int Margin = 2;
        const int PivotClearance = 1;

        /// <summary>Pixels the shadow rule cleared in this bake (reported in the receipt and the batch log).</summary>
        static long ShadowPixelsCleared;

        /// <summary>
        /// Batch entry (<c>-executeMethod Roguehalla.Editor.ShowcaseLiveCatalogBaker.BakeFromBatch</c>): rebakes the live catalog from the two source catalogs the existing receipt names
        /// (FlareFullBase/Catalog.asset and FlareExpansion/AssetReadiness.asset), now with the baked ground shadow stripped from every actor frame.
        /// </summary>
        public static void BakeFromBatch()
        {
            try
            {
                var original = AssetDatabase.LoadAssetAtPath<ShowcaseCatalog>("Assets/Art/Derived/FlareFullBase/Catalog.asset");
                var expansion = AssetDatabase.LoadAssetAtPath<AssetReadinessCatalog>("Assets/Art/Derived/FlareExpansion/AssetReadiness.asset");
                if (original == null || expansion == null) throw new InvalidDataException("source catalogs missing");
                ShadowPixelsCleared = 0;
                var live = Bake(original, expansion);
                SyncResourcesCatalog(live);
                Debug.Log("ShowcaseLiveCatalogBaker: baked " + live.Actors.Length + " appearances; shadow pixels cleared " + ShadowPixelsCleared);
                EditorApplication.Exit(0);
            }
            catch (Exception e) { Debug.LogError("ShowcaseLiveCatalogBaker batch failed: " + e); EditorApplication.Exit(1); }
        }

        /// <summary>Batch entry: only re-points the Resources catalog at the current live catalog (after a bake that did not).</summary>
        public static void SyncResourcesFromBatch()
        {
            try { SyncResourcesCatalog(AssetDatabase.LoadAssetAtPath<ShowcaseCatalog>(CatalogPath)); EditorApplication.Exit(0); }
            catch (Exception e) { Debug.LogError("sync failed: " + e); EditorApplication.Exit(1); }
        }

        [MenuItem("Roguehalla/Art/Rebake Live Catalog (shadow stripped)")]
        static void BakeFromMenu()
        {
            ShadowPixelsCleared = 0;
            SyncResourcesCatalog(Bake(AssetDatabase.LoadAssetAtPath<ShowcaseCatalog>("Assets/Art/Derived/FlareFullBase/Catalog.asset"), AssetDatabase.LoadAssetAtPath<AssetReadinessCatalog>("Assets/Art/Derived/FlareExpansion/AssetReadiness.asset")));
        }

        /// <summary>
        /// The player loads <c>Resources/Showcase/Catalog.asset</c>, whose actor rows point at the live catalog's baked sprite subassets. A rebake replaces those subassets (new fileIDs),
        /// so the Resources catalog's actor rows are re-pointed at the new ones; every other field of the Resources catalog is left as it is.
        /// </summary>
        static void SyncResourcesCatalog(ShowcaseCatalog live)
        {
            const string path = "Assets/Resources/Showcase/Catalog.asset";
            var resources = AssetDatabase.LoadAssetAtPath<ShowcaseCatalog>(path);
            if (resources == null) throw new InvalidDataException("missing " + path);
            if (resources.Actors == null || resources.Actors.Length != live.Actors.Length) throw new InvalidDataException("Resources catalog actor count differs from the live catalog");
            for (int i = 0; i < live.Actors.Length; i++)
                if (resources.Actors[i].Key != live.Actors[i].Key) throw new InvalidDataException("actor key order differs at " + i + ": " + resources.Actors[i].Key + " vs " + live.Actors[i].Key);
            resources.Actors = live.Actors;
            EditorUtility.SetDirty(resources);
            AssetDatabase.SaveAssets();
        }

        sealed class FramePlan
        {
            public Sprite Source;
            public string Clip;
            public int FrameIndex;
            public string SourceTexturePath, SourceTextureSha256;
            public int SourceTextureWidth, SourceTextureHeight;
            public RectInt SourceRect;
            public int TrimX, TrimY, TrimWidth, TrimHeight;
            public int ContentX, ContentY, ContentWidth, ContentHeight;
            public Vector2 NewPivot;
            public int AtlasX, AtlasY;
            public Color32[] Pixels;
            public Sprite Baked;
        }

        sealed class AppearancePlan
        {
            public ShowcaseCatalog.Appearance Source;
            public string Key;
            public readonly List<FramePlan> Frames = new List<FramePlan>();
            public readonly Dictionary<string, Sprite[]> Clips = new Dictionary<string, Sprite[]>();
            public int AtlasWidth, AtlasHeight;
            public string AtlasPath, AtlasHash;
            public long SourceSpriteArea, SourceTextureArea, PackedAtlasArea;
        }

        sealed class CatalogSnapshot
        {
            public ShowcaseCatalog.Appearance[] Actors;
            public Sprite Chest, Barrel, Statue;
            public AudioClip Music, Ambience;
            public AudioClip[] Hits, Swings, Ui;
            public ShowcaseAudioLibrary AudioLibrary;
            public UnityEngine.Audio.AudioMixerGroup MusicGroup, AmbienceGroup, SfxGroup;
        }

        sealed class TexturePixels : IDisposable
        {
            public string Path;
            public string Sha256;
            public Texture2D Texture;
            public Color32[] Pixels;
            public void Dispose()
            {
                if (Texture != null) UnityEngine.Object.DestroyImmediate(Texture);
            }
        }

        /// <summary>
        /// Bake the original five-appearance catalog plus the seven-appearance expansion into
        /// Assets/Art/Derived/ShowcaseLive/Catalog.asset. Neither input asset is mutated.
        /// </summary>
        public static ShowcaseCatalog Bake(ShowcaseCatalog originalSource, AssetReadinessCatalog expansion)
        {
            if (originalSource == null) throw new ArgumentNullException(nameof(originalSource));
            if (expansion == null) throw new ArgumentNullException(nameof(expansion));
            EnsureFolders();

            // Read and validate every source pixel before replacing anything in the output catalog.
            var merged = MergeAppearances(originalSource, expansion);
            var textures = new Dictionary<string, TexturePixels>(StringComparer.Ordinal);
            var plans = new List<AppearancePlan>(merged.Count);
            try
            {
                foreach (var appearance in merged)
                {
                    plans.Add(PlanAppearance(appearance, textures));
                    // Frame plans retain their own trimmed pixels and source metrics; full decoded sheets
                    // need not remain alive while the other eleven appearances are planned.
                    foreach (var texture in textures.Values) texture.Dispose();
                    textures.Clear();
                }
            }
            finally
            {
                foreach (var texture in textures.Values) texture.Dispose();
            }

            var createdAtlasPaths = new List<string>();
            var createdSprites = new List<Sprite>();
            ShowcaseCatalog catalog = null;
            bool catalogCreated = false;
            bool outputCommitted = false;
            CatalogSnapshot previousCatalog = null;
            bool receiptExisted = File.Exists(Path.GetFullPath(ReceiptPath));
            byte[] previousReceipt = receiptExisted ? File.ReadAllBytes(Path.GetFullPath(ReceiptPath)) : null;
            try
            {
                foreach (var plan in plans)
                {
                    WriteAndImportAtlas(plan, createdAtlasPaths);
                    CreateBakedSprites(plan, createdSprites);
                }

                catalog = AssetDatabase.LoadAssetAtPath<ShowcaseCatalog>(CatalogPath);
                if (catalog == null)
                {
                    catalog = ScriptableObject.CreateInstance<ShowcaseCatalog>();
                    AssetDatabase.CreateAsset(catalog, CatalogPath);
                    catalogCreated = true;
                }
                else previousCatalog = Capture(catalog);

                // Add new subassets first; old generated sprites stay available if any earlier step fails.
                foreach (var plan in plans)
                    foreach (var frame in plan.Frames)
                        AssetDatabase.AddObjectToAsset(frame.Baked, catalog);

                var newActors = merged.Select(CloneNonAppearanceFields).ToArray();
                for (int i = 0; i < merged.Count; i++)
                {
                    var destination = newActors[i];
                    var plan = plans[i];
                    destination.Idle = plan.Clips["Idle"];
                    destination.Walk = plan.Clips["Walk"];
                    destination.Attack = plan.Clips["Attack"];
                    destination.Block = plan.Clips["Block"];
                    destination.Hit = plan.Clips["Hit"];
                    destination.Death = plan.Clips["Death"];
                    destination.Cast = plan.Clips["Cast"];
                    destination.Shoot = plan.Clips["Shoot"];
                }

                catalog.Actors = newActors;
                catalog.Chest = originalSource.Chest;
                catalog.Barrel = originalSource.Barrel;
                catalog.Statue = originalSource.Statue;
                catalog.AudioLibrary = originalSource.AudioLibrary;
                catalog.Music = originalSource.Music;
                catalog.Ambience = originalSource.Ambience;
                catalog.Hits = CloneArray(originalSource.Hits);
                catalog.Swings = CloneArray(originalSource.Swings);
                catalog.Ui = CloneArray(originalSource.Ui);
                catalog.MusicGroup = originalSource.MusicGroup;
                catalog.AmbienceGroup = originalSource.AmbienceGroup;
                catalog.SfxGroup = originalSource.SfxGroup;
                EditorUtility.SetDirty(catalog);
                AssetDatabase.SaveAssets();
                WriteReceipt(plans, originalSource, expansion);
                outputCommitted = true;

                RemoveSupersededGeneratedSprites(catalogPath: CatalogPath, keep: new HashSet<Sprite>(createdSprites));
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();
                return catalog;
            }
            catch
            {
                // A pruning/import failure after commit must not restore references to old sprites that
                // pruning may already have removed. The new catalog is valid; cleanup can be retried.
                if (outputCommitted) throw;
                // Best-effort rollback is confined to this tool's marked output subassets and fresh atlas files.
                foreach (var sprite in createdSprites)
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
                if (catalogCreated && catalog != null)
                    AssetDatabase.DeleteAsset(CatalogPath);
                else if (catalog != null && previousCatalog != null)
                {
                    Restore(catalog, previousCatalog);
                    EditorUtility.SetDirty(catalog);
                }
                foreach (string path in createdAtlasPaths)
                    if (!string.IsNullOrEmpty(path)) AssetDatabase.DeleteAsset(path);
                if (receiptExisted) File.WriteAllBytes(Path.GetFullPath(ReceiptPath), previousReceipt);
                else if (File.Exists(Path.GetFullPath(ReceiptPath))) File.Delete(Path.GetFullPath(ReceiptPath));
                AssetDatabase.SaveAssets();
                throw;
            }
        }

        static List<ShowcaseCatalog.Appearance> MergeAppearances(ShowcaseCatalog original, AssetReadinessCatalog expansion)
        {
            var result = new List<ShowcaseCatalog.Appearance>();
            var indexByKey = new Dictionary<string, int>(StringComparer.Ordinal);
            AddSource(original.Actors, "original", result, indexByKey, replace: false);
            AddSource(expansion.Actors, "expansion", result, indexByKey, replace: true);
            return result;
        }

        static void AddSource(ShowcaseCatalog.Appearance[] source, string label,
            List<ShowcaseCatalog.Appearance> result, Dictionary<string, int> indexByKey, bool replace)
        {
            if (source == null) throw new InvalidDataException(label + " appearance array is null");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var appearance in source)
            {
                if (appearance == null) throw new InvalidDataException(label + " catalog contains a null appearance");
                if (string.IsNullOrWhiteSpace(appearance.Key)) throw new InvalidDataException(label + " appearance has an empty key");
                if (!seen.Add(appearance.Key)) throw new InvalidDataException(label + " catalog repeats key " + appearance.Key);
                if (indexByKey.TryGetValue(appearance.Key, out int existing))
                {
                    if (!replace) throw new InvalidDataException("Duplicate appearance key " + appearance.Key);
                    result[existing] = appearance;
                }
                else
                {
                    indexByKey.Add(appearance.Key, result.Count);
                    result.Add(appearance);
                }
            }
        }

        static AppearancePlan PlanAppearance(ShowcaseCatalog.Appearance appearance,
            Dictionary<string, TexturePixels> textures)
        {
            var plan = new AppearancePlan { Source = appearance, Key = appearance.Key };
            foreach (string clip in ClipNames)
            {
                Sprite[] sourceFrames = GetClip(appearance, clip) ?? Array.Empty<Sprite>();
                var bakedFrames = new Sprite[sourceFrames.Length];
                plan.Clips.Add(clip, bakedFrames);
                for (int frameIndex = 0; frameIndex < sourceFrames.Length; frameIndex++)
                {
                    Sprite sprite = sourceFrames[frameIndex];
                    if (sprite == null) throw new InvalidDataException(appearance.Key + "/" + clip + " has null frame " + frameIndex);
                    var pixels = GetTexturePixels(sprite, textures);
                    var frame = TrimFrame(sprite, clip, frameIndex, pixels);
                    plan.Frames.Add(frame);
                    plan.SourceSpriteArea += (long)frame.SourceRect.width * frame.SourceRect.height;
                }
            }
            plan.SourceTextureArea = plan.Frames.GroupBy(frame => frame.SourceTexturePath, StringComparer.Ordinal)
                .Sum(group => (long)group.First().SourceTextureWidth * group.First().SourceTextureHeight);
            Pack(plan);
            if (plan.Frames.Count == 0)
                throw new InvalidDataException(appearance.Key + " has no sprite frames across all provided clips");
            return plan;
        }

        static TexturePixels GetTexturePixels(Sprite sprite, Dictionary<string, TexturePixels> cache)
        {
            string assetPath = AssetDatabase.GetAssetPath(sprite.texture);
            if (string.IsNullOrEmpty(assetPath) || !assetPath.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Expected a source PNG for sprite " + sprite.name + "; got " + assetPath);
            if (cache.TryGetValue(assetPath, out var existing)) return existing;
            string absolutePath = Path.GetFullPath(assetPath);
            if (!File.Exists(absolutePath)) throw new FileNotFoundException("Missing source texture PNG", absolutePath);
            byte[] bytes = File.ReadAllBytes(absolutePath);
            var decoded = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
            if (!decoded.LoadImage(bytes, false))
            {
                UnityEngine.Object.DestroyImmediate(decoded);
                throw new InvalidDataException("Could not decode source PNG " + assetPath);
            }
            var value = new TexturePixels
            {
                Path = assetPath,
                Sha256 = Sha256Hex(bytes),
                Texture = decoded,
                Pixels = decoded.GetPixels32()
            };
            cache.Add(assetPath, value);
            return value;
        }

        static FramePlan TrimFrame(Sprite sprite, string clip, int frameIndex, TexturePixels texture)
        {
            Rect rect = sprite.rect;
            int x = RoundIntegral(rect.x, "sprite rect x", sprite);
            int y = RoundIntegral(rect.y, "sprite rect y", sprite);
            int width = RoundIntegral(rect.width, "sprite rect width", sprite);
            int height = RoundIntegral(rect.height, "sprite rect height", sprite);
            if (width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > texture.Texture.width || y + height > texture.Texture.height)
                throw new InvalidDataException("Invalid sprite rect for " + sprite.name + " in " + texture.Path);

            // The baked ground shadow is removed first (ActorShadowStrip: owner decision 2026-11-10, our own lighting supplies the shadow), on the sprite's own rectangle, so the
            // trim below and the packed atlas only ever see the figure.
            var frameBytes = new byte[checked(width * height * 4)];
            for (int localY = 0; localY < height; localY++)
            {
                int row = (y + localY) * texture.Texture.width + x;
                for (int localX = 0; localX < width; localX++)
                {
                    var p = texture.Pixels[row + localX]; int o = (localY * width + localX) * 4;
                    frameBytes[o] = p.r; frameBytes[o + 1] = p.g; frameBytes[o + 2] = p.b; frameBytes[o + 3] = p.a;
                }
            }
            ShadowPixelsCleared += ActorShadowStrip.Strip(frameBytes, width, height);
            var frameRect = new Color32[width * height];
            for (int i = 0; i < frameRect.Length; i++) frameRect[i] = new Color32(frameBytes[i * 4], frameBytes[i * 4 + 1], frameBytes[i * 4 + 2], frameBytes[i * 4 + 3]);

            int minX = width, minY = height, maxX = -1, maxY = -1;
            for (int localY = 0; localY < height; localY++)
            {
                int row = localY * width;
                for (int localX = 0; localX < width; localX++)
                {
                    if (frameRect[row + localX].a == 0) continue;
                    if (localX < minX) minX = localX;
                    if (localY < minY) minY = localY;
                    if (localX > maxX) maxX = localX;
                    if (localY > maxY) maxY = localY;
                }
            }
            if (maxX < 0) throw new InvalidDataException("Fully transparent source frame " + sprite.name + " in " + texture.Path);

            Vector2 pivot = sprite.pivot;
            if (pivot.x < 0 || pivot.y < 0 || pivot.x > width || pivot.y > height)
                throw new InvalidDataException("Pivot outside source frame " + sprite.name);
            minX = Mathf.Min(minX, Mathf.FloorToInt(pivot.x) - PivotClearance);
            minY = Mathf.Min(minY, Mathf.FloorToInt(pivot.y) - PivotClearance);
            maxX = Mathf.Max(maxX, Mathf.CeilToInt(pivot.x) + PivotClearance - 1);
            maxY = Mathf.Max(maxY, Mathf.CeilToInt(pivot.y) + PivotClearance - 1);
            minX = Mathf.Max(0, minX - Margin);
            minY = Mathf.Max(0, minY - Margin);
            maxX = Mathf.Min(width - 1, maxX + Margin);
            maxY = Mathf.Min(height - 1, maxY + Margin);

            int trimWidth = maxX - minX + 1, trimHeight = maxY - minY + 1;
            var copied = new Color32[checked(trimWidth * trimHeight)];
            for (int row = 0; row < trimHeight; row++)
                Array.Copy(frameRect, (minY + row) * width + minX,
                    copied, row * trimWidth, trimWidth);

            // Unity sprite pivots are local pixel coordinates from the rectangle's lower-left.
            Vector2 newPivot = new Vector2((pivot.x - minX) / trimWidth, (pivot.y - minY) / trimHeight);
            return new FramePlan
            {
                Source = sprite, Clip = clip, FrameIndex = frameIndex,
                SourceTexturePath = texture.Path, SourceTextureSha256 = texture.Sha256,
                SourceTextureWidth = texture.Texture.width, SourceTextureHeight = texture.Texture.height,
                SourceRect = new RectInt(x, y, width, height),
                TrimX = minX, TrimY = minY, TrimWidth = trimWidth, TrimHeight = trimHeight,
                ContentX = minX, ContentY = minY, ContentWidth = maxX - minX + 1, ContentHeight = maxY - minY + 1,
                NewPivot = newPivot, Pixels = copied
            };
        }

        static void Pack(AppearancePlan plan)
        {
            var ordered = plan.Frames.OrderByDescending(frame => frame.TrimHeight + Gutter)
                .ThenByDescending(frame => frame.TrimWidth + Gutter)
                .ThenBy(frame => frame.Clip, StringComparer.Ordinal)
                .ThenBy(frame => frame.FrameIndex).ToList();
            int width = InitialAtlasWidth;
            while (true)
            {
                int x = Gutter, y = Gutter, shelfHeight = 0, maxY = 0;
                bool failed = false;
                foreach (var frame in ordered)
                {
                    int outerWidth = frame.TrimWidth + Gutter;
                    int outerHeight = frame.TrimHeight + Gutter;
                    if (outerWidth + Gutter > width) { failed = true; break; }
                    if (x + outerWidth > width - Gutter)
                    {
                        y += shelfHeight;
                        x = Gutter;
                        shelfHeight = 0;
                    }
                    frame.AtlasX = x;
                    frame.AtlasY = y;
                    x += outerWidth;
                    shelfHeight = Math.Max(shelfHeight, outerHeight);
                    maxY = Math.Max(maxY, y + outerHeight + Gutter);
                }
                int height = RoundUp4(maxY);
                if (!failed && height <= MaximumAtlasSize)
                {
                    plan.AtlasWidth = width;
                    plan.AtlasHeight = Math.Max(4, height);
                    plan.PackedAtlasArea = (long)plan.AtlasWidth * plan.AtlasHeight;
                    return;
                }
                if (width >= MaximumAtlasSize)
                    throw new InvalidDataException(plan.Key + " cannot fit into a non-rotated 8192x8192 atlas");
                width = Math.Min(MaximumAtlasSize, width * 2);
            }
        }

        static void WriteAndImportAtlas(AppearancePlan plan, List<string> createdAtlasPaths)
        {
            var pixels = new Color32[checked(plan.AtlasWidth * plan.AtlasHeight)];
            foreach (var frame in plan.Frames)
            {
                // Rect row 0 is bottom-to-top in Unity's pixel array; source pixels used the same convention.
                for (int row = 0; row < frame.TrimHeight; row++)
                    Array.Copy(frame.Pixels, row * frame.TrimWidth,
                        pixels, (frame.AtlasY + row) * plan.AtlasWidth + frame.AtlasX, frame.TrimWidth);
            }
            var texture = new Texture2D(plan.AtlasWidth, plan.AtlasHeight, TextureFormat.RGBA32, false, false);
            texture.SetPixels32(pixels);
            texture.Apply(false, false);
            byte[] png = texture.EncodeToPNG();
            UnityEngine.Object.DestroyImmediate(texture);
            plan.AtlasHash = Sha256Hex(png);
            string version = plan.AtlasHash.Substring(0, 16);
            string safeKey = SafeFileName(plan.Key);
            string folder = AtlasRoot + version + "/";
            EnsureAssetFolder(folder.TrimEnd('/'));
            plan.AtlasPath = folder + safeKey + ".png";
            string absolutePath = Path.GetFullPath(plan.AtlasPath);
            bool existed = File.Exists(absolutePath);
            if (existed)
            {
                if (FileSha256(absolutePath) != plan.AtlasHash)
                    throw new InvalidDataException("Content-addressed atlas hash mismatch: " + plan.AtlasPath);
            }
            else
            {
                createdAtlasPaths.Add(plan.AtlasPath); // Includes a partial write if the write itself fails.
                File.WriteAllBytes(absolutePath, png);
            }
            AssetDatabase.ImportAsset(plan.AtlasPath, ImportAssetOptions.ForceSynchronousImport);
            var importer = AssetImporter.GetAtPath(plan.AtlasPath) as TextureImporter;
            if (importer == null) throw new InvalidDataException("Atlas PNG did not get a TextureImporter: " + plan.AtlasPath);
            importer.textureType = TextureImporterType.Default;
            importer.sRGBTexture = true;
            importer.alphaSource = TextureImporterAlphaSource.FromInput;
            importer.alphaIsTransparency = true;
            importer.mipmapEnabled = false;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.filterMode = FilterMode.Bilinear;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.maxTextureSize = MaximumAtlasSize;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.compressionQuality = 100;
            importer.SaveAndReimport();
        }

        static void CreateBakedSprites(AppearancePlan plan, List<Sprite> created)
        {
            var atlas = AssetDatabase.LoadAssetAtPath<Texture2D>(plan.AtlasPath);
            if (atlas == null) throw new InvalidDataException("Could not load imported live atlas " + plan.AtlasPath);
            foreach (var frame in plan.Frames)
            {
                var rect = new Rect(frame.AtlasX, frame.AtlasY, frame.TrimWidth, frame.TrimHeight);
                var sprite = Sprite.Create(atlas, rect, frame.NewPivot, frame.Source.pixelsPerUnit, 0,
                    SpriteMeshType.FullRect, Vector4.zero, false);
                sprite.name = "__ShowcaseLive_" + SafeFileName(plan.Key) + "_" + frame.Clip + "_" + frame.FrameIndex.ToString("D4", CultureInfo.InvariantCulture);
                frame.Baked = sprite;
                created.Add(sprite);
                plan.Clips[frame.Clip][frame.FrameIndex] = sprite;
            }
        }

        static ShowcaseCatalog.Appearance CloneNonAppearanceFields(ShowcaseCatalog.Appearance source)
        {
            return new ShowcaseCatalog.Appearance
            {
                Key = source.Key,
                FramesPerSecond = source.FramesPerSecond,
                IdleFPS = source.IdleFPS, WalkFPS = source.WalkFPS, AttackFPS = source.AttackFPS,
                BlockFPS = source.BlockFPS, HitFPS = source.HitFPS, DeathFPS = source.DeathFPS,
                CastFPS = source.CastFPS, ShootFPS = source.ShootFPS,
                WorldHeight = source.WorldHeight,
                GroundPivot = source.GroundPivot,
                Idle = Array.Empty<Sprite>(), Walk = Array.Empty<Sprite>(), Attack = Array.Empty<Sprite>(),
                Block = Array.Empty<Sprite>(), Hit = Array.Empty<Sprite>(), Death = Array.Empty<Sprite>(),
                Cast = Array.Empty<Sprite>(), Shoot = Array.Empty<Sprite>()
            };
        }

        static CatalogSnapshot Capture(ShowcaseCatalog catalog) => new CatalogSnapshot
        {
            Actors = catalog.Actors, Chest = catalog.Chest, Barrel = catalog.Barrel, Statue = catalog.Statue,
            Music = catalog.Music, Ambience = catalog.Ambience, Hits = catalog.Hits, Swings = catalog.Swings,
            Ui = catalog.Ui, AudioLibrary = catalog.AudioLibrary, MusicGroup = catalog.MusicGroup, AmbienceGroup = catalog.AmbienceGroup, SfxGroup = catalog.SfxGroup
        };

        static void Restore(ShowcaseCatalog catalog, CatalogSnapshot snapshot)
        {
            catalog.Actors = snapshot.Actors; catalog.Chest = snapshot.Chest; catalog.Barrel = snapshot.Barrel; catalog.Statue = snapshot.Statue;
            catalog.Music = snapshot.Music; catalog.Ambience = snapshot.Ambience; catalog.Hits = snapshot.Hits;
            catalog.Swings = snapshot.Swings; catalog.Ui = snapshot.Ui; catalog.AudioLibrary = snapshot.AudioLibrary;
            catalog.MusicGroup = snapshot.MusicGroup; catalog.AmbienceGroup = snapshot.AmbienceGroup; catalog.SfxGroup = snapshot.SfxGroup;
        }

        static void RemoveSupersededGeneratedSprites(string catalogPath, HashSet<Sprite> keep)
        {
            foreach (var old in AssetDatabase.LoadAllAssetsAtPath(catalogPath).OfType<Sprite>().ToArray())
            {
                if (keep.Contains(old) || !old.name.StartsWith("__ShowcaseLive_", StringComparison.Ordinal)) continue;
                AssetDatabase.RemoveObjectFromAsset(old);
                UnityEngine.Object.DestroyImmediate(old, true);
            }
        }

        static string BuildReceiptJson(List<AppearancePlan> plans, ShowcaseCatalog original, AssetReadinessCatalog expansion)
        {
            // Intentionally implemented separately from JsonUtility to retain stable, complete nested records.
            var b = new StringBuilder(64 * 1024);
            b.Append("{\n  \"schema\": \"roguehalla.showcase-live-bake.v1\",\n");
            b.Append("  \"shadowStrip\": { \"rule\": \"ActorShadowStrip: clear every pixel with 0 < alpha < 204 that has no neighbour (8-neighbourhood) with alpha >= 204\", \"pixelsCleared\": ").Append(ShadowPixelsCleared.ToString(CultureInfo.InvariantCulture)).Append(" },\n");
            WriteJsonString(b, "sourceCatalog", AssetDatabase.GetAssetPath(original), true);
            WriteJsonString(b, "expansionCatalog", AssetDatabase.GetAssetPath(expansion), true);
            WriteJsonString(b, "outputCatalog", CatalogPath, true);
            b.Append("  \"sourcePngHashes\": [\n");
            var hashes = plans.SelectMany(p => p.Frames).Select(f => AssetDatabase.GetAssetPath(f.Source.texture))
                .Distinct(StringComparer.Ordinal).OrderBy(p => p, StringComparer.Ordinal).ToArray();
            for (int i = 0; i < hashes.Length; i++)
            {
                b.Append("    { \"path\": "); AppendJson(b, hashes[i]); b.Append(", \"sha256\": ");
                AppendJson(b, FileSha256(Path.GetFullPath(hashes[i]))); b.Append(" }");
                b.Append(i + 1 == hashes.Length ? "\n" : ",\n");
            }
            b.Append("  ],\n  \"appearances\": [\n");
            for (int i = 0; i < plans.Count; i++)
            {
                var p = plans[i];
                b.Append("    {\n      \"key\": "); AppendJson(b, p.Key); b.Append(",\n      \"atlasPath\": "); AppendJson(b, p.AtlasPath);
                b.Append(",\n      \"atlasSha256\": "); AppendJson(b, p.AtlasHash);
                b.AppendFormat(CultureInfo.InvariantCulture, ",\n      \"packedWidth\": {0}, \"packedHeight\": {1},\n", p.AtlasWidth, p.AtlasHeight);
                b.AppendFormat(CultureInfo.InvariantCulture, "      \"sourceUniqueTextureRgbaArea\": {0}, \"sourceSpriteRectArea\": {1}, \"packedAtlasArea\": {2}, \"rgbaAreaReductionPercent\": {3:F2},\n",
                    p.SourceTextureArea, p.SourceSpriteArea, p.PackedAtlasArea, PercentReduction(p.SourceTextureArea, p.PackedAtlasArea));
                b.Append("      \"frameCounts\": {");
                for (int c = 0; c < ClipNames.Length; c++)
                {
                    string clip = ClipNames[c]; if (c > 0) b.Append(", ");
                    AppendJson(b, clip); b.Append(": ").Append(p.Clips[clip].Length);
                }
                b.Append("},\n      \"frames\": [\n");
                for (int f = 0; f < p.Frames.Count; f++)
                {
                    var frame = p.Frames[f];
                    b.Append("        { \"clip\": "); AppendJson(b, frame.Clip);
                    b.AppendFormat(CultureInfo.InvariantCulture, ", \"index\": {0}, \"sourcePath\": ", frame.FrameIndex);
                    AppendJson(b, AssetDatabase.GetAssetPath(frame.Source.texture)); b.Append(", \"sourceName\": "); AppendJson(b, frame.Source.name);
                    b.AppendFormat(CultureInfo.InvariantCulture, ", \"sourceRect\": [{0},{1},{2},{3}], \"sourcePivotPixels\": [{4:R},{5:R}], \"sourcePixelsPerUnit\": {6:R}",
                        frame.SourceRect.x, frame.SourceRect.y, frame.SourceRect.width, frame.SourceRect.height,
                        frame.Source.pivot.x, frame.Source.pivot.y, frame.Source.pixelsPerUnit);
                    b.AppendFormat(CultureInfo.InvariantCulture, ", \"trimOffset\": [{0},{1}], \"trimSize\": [{2},{3}], \"atlasRect\": [{4},{5},{2},{3}], \"newPivotNormalized\": [{6:R},{7:R}] }}",
                        frame.TrimX, frame.TrimY, frame.TrimWidth, frame.TrimHeight, frame.AtlasX, frame.AtlasY, frame.NewPivot.x, frame.NewPivot.y);
                    b.Append(f + 1 == p.Frames.Count ? "\n" : ",\n");
                }
                b.Append("      ]\n    }"); b.Append(i + 1 == plans.Count ? "\n" : ",\n");
            }
            b.Append("  ],\n  \"areaNote\": \"Packed atlas RGBA area before platform compression; runtime memory varies by import/platform.\"\n}\n");
            return b.ToString();
        }

        static void WriteJsonString(StringBuilder b, string key, string value, bool comma)
        {
            b.Append("  "); AppendJson(b, key); b.Append(": "); AppendJson(b, value); b.Append(comma ? ",\n" : "\n");
        }

        static void AppendJson(StringBuilder b, string value)
        {
            b.Append('"');
            foreach (char ch in value ?? string.Empty)
            {
                switch (ch)
                {
                    case '"': b.Append("\\\""); break;
                    case '\\': b.Append("\\\\"); break;
                    case '\n': b.Append("\\n"); break;
                    case '\r': b.Append("\\r"); break;
                    case '\t': b.Append("\\t"); break;
                    default: if (ch < 32) b.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture)); else b.Append(ch); break;
                }
            }
            b.Append('"');
        }

        static int RoundIntegral(float value, string field, Sprite sprite)
        {
            int rounded = Mathf.RoundToInt(value);
            if (Mathf.Abs(value - rounded) > .001f) throw new InvalidDataException(field + " is not pixel-aligned for " + sprite.name);
            return rounded;
        }

        static int RoundUp4(int value) => (value + 3) & ~3;
        static float PercentReduction(long sourceArea, long packedArea) => sourceArea <= 0 ? 0 : (1f - packedArea / (float)sourceArea) * 100f;
        static string Sha256Hex(byte[] bytes)
        {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", string.Empty).ToLowerInvariant();
        }
        static string FileSha256(string path) => Sha256Hex(File.ReadAllBytes(path));
        static string SafeFileName(string key)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var chars = key.Select(ch => invalid.Contains(ch) || ch == '/' || ch == '\\' ? '_' : ch).ToArray();
            return new string(chars);
        }

        static void EnsureFolders()
        {
            EnsureAssetFolder("Assets/Art");
            EnsureAssetFolder("Assets/Art/Derived");
            EnsureAssetFolder("Assets/Art/Derived/ShowcaseLive");
            EnsureAssetFolder(AtlasRoot.TrimEnd('/'));
        }

        static void EnsureAssetFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            string parent = Path.GetDirectoryName(path)?.Replace('\\', '/');
            string name = Path.GetFileName(path);
            if (string.IsNullOrEmpty(parent) || !AssetDatabase.IsValidFolder(parent))
                throw new DirectoryNotFoundException("Unity asset parent folder is missing: " + parent);
            AssetDatabase.CreateFolder(parent, name);
        }

        static void WriteReceipt(List<AppearancePlan> plans, ShowcaseCatalog original, AssetReadinessCatalog expansion)
        {
            File.WriteAllText(Path.GetFullPath(ReceiptPath), BuildReceiptJson(plans, original, expansion));
            AssetDatabase.ImportAsset(ReceiptPath, ImportAssetOptions.ForceSynchronousImport);
        }

        static readonly string[] ClipNames = { "Idle", "Walk", "Attack", "Block", "Hit", "Death", "Cast", "Shoot" };
        static Sprite[] GetClip(ShowcaseCatalog.Appearance value, string clip)
        {
            switch (clip)
            {
                case "Idle": return value.Idle;
                case "Walk": return value.Walk;
                case "Attack": return value.Attack;
                case "Block": return value.Block;
                case "Hit": return value.Hit;
                case "Death": return value.Death;
                case "Cast": return value.Cast;
                case "Shoot": return value.Shoot;
                default: throw new ArgumentOutOfRangeException(nameof(clip), clip, null);
            }
        }

        static T[] CloneArray<T>(T[] value) => value == null ? Array.Empty<T>() : (T[])value.Clone();
    }
}
