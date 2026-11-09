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
    /// <summary>Imports only the 42 pinned review candidates. No world placements, physics or source importer edits.</summary>
    public static class ShowcasePropCatalogImporter
    {
        const string ThirdParty = "Assets/Art/ThirdParty/";
        const string CandidateRoot = ThirdParty + "FlareProps/";
        const string BaseFlare = ThirdParty + "Flare/Raw/";
        const string ExpansionFlare = ThirdParty + "FlareExpansion/Raw/";
        const string PropsOutput = "Assets/Art/Derived/FlareProps/";
        const string TilesOutput = PropsOutput + "Tiles/";
        const string CatalogPath = PropsOutput + "ShowcasePropCatalog.asset";
        const string RequiredCommit = "af6eee6d339ac98011864bfe89da837fe7769c28";
        const int PixelsPerUnit = 128;

        [Serializable]
        sealed class CandidateManifest
        {
            public string upstream_commit;
            public CandidateRecord[] records;
        }

        [Serializable]
        sealed class CandidateRecord
        {
            public string family;
            public int tile_id;
            public string candidate_role;
            public string visual_description;
            public string source_atlas;
            public string source_definition;
            public int[] source_rect_top_left_px;
            public int[] source_offset_px;
        }

        [Serializable]
        sealed class SourceManifest
        {
            public string upstream_commit;
            public SourceRecord[] source_files;
        }

        [Serializable]
        sealed class SourceRecord
        {
            public string family;
            public string type;
            public string upstream_path;
            public string download_url;
            public string commit;
            public string sha256;
            public int bytes;
        }

        sealed class TileDefinition
        {
            public int Id, X, Y, Width, Height, OffsetX, OffsetY;
            public string Animation;
        }

        sealed class FamilySource
        {
            public string Family, AtlasPath, DefinitionPath, AtlasUpstreamPath, DefinitionUpstreamPath;
        }

        static readonly FamilySource[] Families =
        {
            new FamilySource
            {
                Family = "dungeon",
                AtlasPath = BaseFlare + "images/tilesets/tileset_dungeon.png",
                DefinitionPath = BaseFlare + "tilesetdefs/tileset_dungeon.txt",
                AtlasUpstreamPath = "mods/fantasycore/images/tilesets/tileset_dungeon.png",
                DefinitionUpstreamPath = "mods/fantasycore/tilesetdefs/tileset_dungeon.txt"
            },
            new FamilySource
            {
                Family = "cave",
                AtlasPath = ExpansionFlare + "images/tilesets/tileset_cave.png",
                DefinitionPath = ExpansionFlare + "tilesetdefs/tileset_cave.txt",
                AtlasUpstreamPath = "mods/fantasycore/images/tilesets/tileset_cave.png",
                DefinitionUpstreamPath = "mods/fantasycore/tilesetdefs/tileset_cave.txt"
            },
            new FamilySource
            {
                Family = "grassland",
                AtlasPath = CandidateRoot + "Raw/images/tilesets/tileset_grassland.png",
                DefinitionPath = CandidateRoot + "Raw/tilesetdefs/tileset_grassland.txt",
                AtlasUpstreamPath = "mods/fantasycore/images/tilesets/tileset_grassland.png",
                DefinitionUpstreamPath = "mods/fantasycore/tilesetdefs/tileset_grassland.txt"
            }
        };

        [MenuItem("Roguehalla/Art/Import Flare Prop Candidates")]
        public static void Import()
        {
            string candidatesPath = CandidateRoot + "candidate-tiles.json";
            string sourceManifestPath = CandidateRoot + "asset-manifest.json";
            if (!File.Exists(FullAssetPath(candidatesPath)) || !File.Exists(FullAssetPath(sourceManifestPath)))
                throw new FileNotFoundException("Install the staged Flare prop provenance JSON files first.");

            CandidateManifest candidates = JsonUtility.FromJson<CandidateManifest>(File.ReadAllText(FullAssetPath(candidatesPath)));
            SourceManifest sources = JsonUtility.FromJson<SourceManifest>(File.ReadAllText(FullAssetPath(sourceManifestPath)));
            ValidatePinnedManifest(candidates, sources);
            if (candidates.records == null || candidates.records.Length != 42)
                throw new InvalidDataException("Expected the audited 42 candidate tile records.");

            Directory.CreateDirectory(FullAssetPath(PropsOutput));
            Directory.CreateDirectory(FullAssetPath(TilesOutput));
            var imported = new List<ImportedEntry>(candidates.records.Length);
            foreach (FamilySource family in Families)
            {
                CandidateRecord[] records = candidates.records.Where(r => r != null && r.family == family.Family).ToArray();
                if (records.Length == 0) continue;
                Texture2D atlas = LoadPng(family.AtlasPath);
                try
                {
                    Color32[] atlasPixels = atlas.GetPixels32();
                    Dictionary<int, TileDefinition> definitions = ReadDefinitions(family.DefinitionPath, out string declaredImage);
                    string expectedImage = "images/tilesets/tileset_" + family.Family + ".png";
                    if (!string.Equals(declaredImage, expectedImage, StringComparison.Ordinal))
                        throw new InvalidDataException(family.DefinitionPath + ": img= does not match " + expectedImage);
                    SourceRecord atlasSource = FindSource(sources, family.Family, "atlas", family.AtlasUpstreamPath);
                    SourceRecord definitionSource = FindSource(sources, family.Family, "tiledefs", family.DefinitionUpstreamPath);
                    foreach (CandidateRecord record in records)
                    {
                        TileDefinition tile = RequireTile(definitions, record.tile_id, family.DefinitionPath);
                        ValidateCandidateMetadata(record, tile, family);
                        ValidateRect(tile, atlas.width, atlas.height, family.DefinitionPath);
                        imported.Add(ExtractCandidate(record, tile, family, atlas, atlasPixels, atlasSource, definitionSource));
                    }
                    atlasPixels = null;
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(atlas);
                }
            }

            if (imported.Count != candidates.records.Length)
                throw new InvalidDataException("Some candidate families were not imported; expected 42 entries, got " + imported.Count);
            if (imported.Select(x => x.Key).Distinct(StringComparer.Ordinal).Count() != imported.Count)
                throw new InvalidDataException("Candidate key collision; no catalog was written.");

            ShowcasePropCatalog catalog = AssetDatabase.LoadAssetAtPath<ShowcasePropCatalog>(CatalogPath);
            if (catalog == null)
            {
                catalog = ScriptableObject.CreateInstance<ShowcasePropCatalog>();
                catalog.name = "Showcase Prop Candidate Catalog";
                AssetDatabase.CreateAsset(catalog, CatalogPath);
            }
            WriteEntries(catalog, imported);
            EditorUtility.SetDirty(catalog);
            AssetDatabase.SaveAssets();
            Debug.Log("Imported " + imported.Count + " review-only Flare prop samples to " + CatalogPath + ".");
        }

        sealed class ImportedEntry
        {
            public string Key, Family, Role, Description, SourcePath, SourceUrl, SourceSha256;
            public string DefinitionSourcePath, DefinitionSourceUrl, DefinitionSha256, Animation;
            public int TileId, X, Y, Width, Height, OffsetX, OffsetY;
            public bool HasAnimation;
            public Sprite Sprite;
            public Vector2 UnityPivot;
        }

        static ImportedEntry ExtractCandidate(CandidateRecord record, TileDefinition tile, FamilySource family,
            Texture2D atlas, Color32[] atlasPixels, SourceRecord atlasSource, SourceRecord definitionSource)
        {
            int left = Math.Max(2, 2-tile.OffsetX), right = Math.Max(2,tile.OffsetX-tile.Width+2);
            int bottom = Math.Max(2,tile.OffsetY-tile.Height+2), top = Math.Max(2,2-tile.OffsetY);
            int outputWidth = tile.Width+left+right, outputHeight = tile.Height+bottom+top;
            Vector2 pivot = new Vector2((tile.OffsetX+left)/(float)outputWidth,
                (tile.Height-tile.OffsetY+bottom)/(float)outputHeight);
            int area = checked(outputWidth * outputHeight);
            var pixels = new Color32[area];
            for (int y = 0; y < tile.Height; y++)
            {
                // Flare definition Y is top-left origin; GetPixels32() indexes from the bottom row.
                int sourceRow = (atlas.height - tile.Y - tile.Height + y) * atlas.width + tile.X;
                int targetRow = (y+bottom) * outputWidth + left;
                Array.Copy(atlasPixels, sourceRow, pixels, targetRow, tile.Width);
            }
            bool hasVisiblePixel = false;
            for (int i = 0; i < pixels.Length; i++) if (pixels[i].a != 0) { hasVisiblePixel = true; break; }
            if (!hasVisiblePixel) throw new InvalidDataException("Empty alpha crop: " + family.Family + "/" + tile.Id);

            var crop = new Texture2D(outputWidth, outputHeight, TextureFormat.RGBA32, false);
            crop.name = CandidateKey(family.Family, tile.Id);
            crop.SetPixels32(pixels);
            crop.Apply(false, false);
            string outputPath = TilesOutput + family.Family + "-" + tile.Id.ToString("D3", CultureInfo.InvariantCulture) + ".png";
            try { File.WriteAllBytes(FullAssetPath(outputPath), crop.EncodeToPNG()); }
            finally { UnityEngine.Object.DestroyImmediate(crop); }

            AssetDatabase.ImportAsset(outputPath, ImportAssetOptions.ForceSynchronousImport);
            var importer = AssetImporter.GetAtPath(outputPath) as TextureImporter;
            if (importer == null) throw new InvalidDataException("Unity did not create a texture importer for " + outputPath);
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Single;
            importer.spritePixelsPerUnit = PixelsPerUnit;
            importer.alphaIsTransparency = true;
            importer.mipmapEnabled = false;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.filterMode = FilterMode.Bilinear;
            importer.maxTextureSize = 4096;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            var settings = new TextureImporterSettings();
            importer.ReadTextureSettings(settings);
            settings.spriteGenerateFallbackPhysicsShape = false;
            settings.spriteMeshType = SpriteMeshType.FullRect;
            importer.wrapMode = TextureWrapMode.Clamp;
            settings.spriteAlignment = (int)SpriteAlignment.Custom;
            settings.spritePivot = pivot;
            importer.SetTextureSettings(settings);
            importer.SaveAndReimport();
            Sprite sprite = AssetDatabase.LoadAssetAtPath<Sprite>(outputPath);
            if (sprite == null) throw new InvalidDataException("Unity did not import candidate as Sprite: " + outputPath);

            return new ImportedEntry
            {
                Key = CandidateKey(record.family, record.tile_id), Family = record.family,
                Role = record.candidate_role, Description = record.visual_description,
                SourcePath = atlasSource.upstream_path, SourceUrl = atlasSource.download_url,
                SourceSha256 = atlasSource.sha256,
                DefinitionSourcePath = definitionSource.upstream_path, DefinitionSourceUrl = definitionSource.download_url,
                DefinitionSha256 = definitionSource.sha256,
                TileId = tile.Id, X = tile.X, Y = tile.Y, Width = tile.Width, Height = tile.Height,
                OffsetX = tile.OffsetX, OffsetY = tile.OffsetY,
                HasAnimation = !string.IsNullOrEmpty(tile.Animation), Animation = tile.Animation,
                Sprite = sprite, UnityPivot = pivot
            };
        }

        static void WriteEntries(ShowcasePropCatalog catalog, List<ImportedEntry> entries)
        {
            var serialized = new SerializedObject(catalog);
            SerializedProperty array = serialized.FindProperty("entries");
            if (array == null || !array.isArray) throw new InvalidDataException("ShowcasePropCatalog.entries serialization field is missing.");
            array.arraySize = entries.Count;
            for (int i = 0; i < entries.Count; i++)
            {
                ImportedEntry source = entries[i];
                SerializedProperty entry = array.GetArrayElementAtIndex(i);
                Set(entry, "key", source.Key);
                Set(entry, "family", source.Family);
                Set(entry, "tileId", source.TileId);
                Set(entry, "candidateRole", source.Role);
                Set(entry, "visualDescription", source.Description);
                Set(entry, "sourcePath", source.SourcePath);
                Set(entry, "sourceUrl", source.SourceUrl);
                Set(entry, "sourceSha256", source.SourceSha256);
                Set(entry, "definitionSourcePath", source.DefinitionSourcePath);
                Set(entry, "definitionSourceUrl", source.DefinitionSourceUrl);
                Set(entry, "definitionSha256", source.DefinitionSha256);
                Set(entry, "sourceRectTopLeftPixels", new RectInt(source.X, source.Y, source.Width, source.Height));
                Set(entry, "flareOffsetPixels", new Vector2(source.OffsetX, source.OffsetY));
                Set(entry, "unityPivotNormalized", source.UnityPivot);
                Set(entry, "sprite", source.Sprite);
                Set(entry, "hasAuthoredAnimation", source.HasAnimation);
                Set(entry, "animationRecord", source.Animation ?? string.Empty);
            }
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        static void Set(SerializedProperty parent, string field, string value) => parent.FindPropertyRelative(field).stringValue = value;
        static void Set(SerializedProperty parent, string field, int value) => parent.FindPropertyRelative(field).intValue = value;
        static void Set(SerializedProperty parent, string field, Vector2 value) => parent.FindPropertyRelative(field).vector2Value = value;
        static void Set(SerializedProperty parent, string field, RectInt value) => parent.FindPropertyRelative(field).rectIntValue = value;
        static void Set(SerializedProperty parent, string field, UnityEngine.Object value) => parent.FindPropertyRelative(field).objectReferenceValue = value;
        static void Set(SerializedProperty parent, string field, bool value) => parent.FindPropertyRelative(field).boolValue = value;

        static void ValidatePinnedManifest(CandidateManifest candidates, SourceManifest sources)
        {
            if (candidates == null || sources == null || candidates.upstream_commit != RequiredCommit || sources.upstream_commit != RequiredCommit)
                throw new InvalidDataException("Candidate/source manifests do not match pinned Flare commit " + RequiredCommit);
            if (sources.source_files == null) throw new InvalidDataException("Source manifest has no source_files.");
            foreach (FamilySource family in Families)
            {
                VerifySource(sources, family.Family, "atlas", family.AtlasUpstreamPath, family.AtlasPath);
                VerifySource(sources, family.Family, "tiledefs", family.DefinitionUpstreamPath, family.DefinitionPath);
            }
        }

        static void VerifySource(SourceManifest manifest, string family, string type, string upstreamPath, string assetPath)
        {
            SourceRecord source = FindSource(manifest, family, type, upstreamPath);
            string fullPath = FullAssetPath(assetPath);
            if (!File.Exists(fullPath)) throw new FileNotFoundException("Missing pinned prop source file", assetPath);
            var info = new FileInfo(fullPath);
            if (info.Length != source.bytes) throw new InvalidDataException(assetPath + " size differs from pinned manifest.");
            string hash = Sha256(File.ReadAllBytes(fullPath));
            if (!string.Equals(hash, source.sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException(assetPath + " SHA-256 differs from pinned manifest.");
            if (!string.Equals(source.commit, RequiredCommit, StringComparison.Ordinal))
                throw new InvalidDataException(assetPath + " source record has a different upstream pin.");
        }

        static SourceRecord FindSource(SourceManifest manifest, string family, string type, string upstreamPath)
        {
            foreach (SourceRecord source in manifest.source_files)
                if (source != null && source.family == family && source.type == type && source.upstream_path == upstreamPath)
                    return source;
            throw new InvalidDataException("Source manifest is missing " + family + " " + type + " record: " + upstreamPath);
        }

        static Dictionary<int, TileDefinition> ReadDefinitions(string path, out string imagePath)
        {
            string fullPath = FullAssetPath(path);
            if (!File.Exists(fullPath)) throw new FileNotFoundException("Missing Flare tile definition", path);
            var result = new Dictionary<int, TileDefinition>();
            imagePath = null;
            string expectedImage = "images/tilesets/" + Path.GetFileNameWithoutExtension(path) + ".png";
            bool active = false;
            foreach (string raw in File.ReadAllLines(fullPath))
            {
                string line = raw.Trim();
                if (line.StartsWith("img=", StringComparison.Ordinal))
                {
                    string candidateImage = line.Substring(4).Trim();
                    active = candidateImage == expectedImage;
                    if (active)
                    {
                        if (imagePath != null) throw new InvalidDataException(path + ": duplicate selected img= section");
                        imagePath = candidateImage;
                    }
                }
                else if (active && line.StartsWith("tile=", StringComparison.Ordinal))
                {
                    int[] values = line.Substring(5).Split(',').Select(x => int.Parse(x, CultureInfo.InvariantCulture)).ToArray();
                    if (values.Length != 7) throw new InvalidDataException(path + ": malformed tile= row");
                    var tile = new TileDefinition { Id = values[0], X = values[1], Y = values[2], Width = values[3], Height = values[4], OffsetX = values[5], OffsetY = values[6] };
                    if (result.ContainsKey(tile.Id)) throw new InvalidDataException(path + ": duplicate tile ID " + tile.Id);
                    result.Add(tile.Id, tile);
                }
                else if (active && line.StartsWith("animation=", StringComparison.Ordinal))
                {
                    string value = line.Substring("animation=".Length).Trim();
                    int separator = value.IndexOf(';');
                    if (separator <= 0) throw new InvalidDataException(path + ": malformed animation= row");
                    int id = int.Parse(value.Substring(0, separator), CultureInfo.InvariantCulture);
                    if (result.TryGetValue(id, out TileDefinition tile)) tile.Animation = value;
                    else throw new InvalidDataException(path + ": animation references tile before its tile= row " + id);
                }
            }
            if (string.IsNullOrWhiteSpace(imagePath)) throw new InvalidDataException(path + ": missing img= row");
            return result;
        }

        static TileDefinition RequireTile(Dictionary<int, TileDefinition> definitions, int tileId, string path)
        {
            if (!definitions.TryGetValue(tileId, out TileDefinition tile))
                throw new InvalidDataException(path + ": candidate tile ID " + tileId + " is absent.");
            return tile;
        }

        static void ValidateCandidateMetadata(CandidateRecord record, TileDefinition tile, FamilySource family)
        {
            string expectedAtlas = "Raw/images/tilesets/tileset_" + record.family + ".png";
            string expectedDefinition = "Raw/tilesetdefs/tileset_" + record.family + ".txt";
            if (record.source_atlas != expectedAtlas || record.source_definition != expectedDefinition)
                throw new InvalidDataException("Candidate source paths do not match pinned family " + record.family + ".");
            if (record.source_rect_top_left_px == null || record.source_rect_top_left_px.Length != 4 ||
                record.source_offset_px == null || record.source_offset_px.Length != 2)
                throw new InvalidDataException("Candidate metadata arrays are malformed for " + CandidateKey(record.family, record.tile_id));
            if (record.source_rect_top_left_px[0] != tile.X || record.source_rect_top_left_px[1] != tile.Y ||
                record.source_rect_top_left_px[2] != tile.Width || record.source_rect_top_left_px[3] != tile.Height ||
                record.source_offset_px[0] != tile.OffsetX || record.source_offset_px[1] != tile.OffsetY)
                throw new InvalidDataException("Candidate JSON differs from the pinned tile= definition for " + CandidateKey(record.family, record.tile_id));
            if (record.family != family.Family) throw new InvalidDataException("Family source mismatch.");
        }

        static void ValidateRect(TileDefinition tile, int width, int height, string path)
        {
            if (tile.X < 0 || tile.Y < 0 || tile.Width <= 0 || tile.Height <= 0 ||
                (long)tile.X + tile.Width > width || (long)tile.Y + tile.Height > height)
                throw new InvalidDataException(path + ": tile " + tile.Id + " exceeds source image bounds " + width + "x" + height);
        }

        static Texture2D LoadPng(string assetPath)
        {
            string fullPath = FullAssetPath(assetPath);
            if (!File.Exists(fullPath)) throw new FileNotFoundException("Missing prop atlas", assetPath);
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!texture.LoadImage(File.ReadAllBytes(fullPath), false))
            {
                UnityEngine.Object.DestroyImmediate(texture);
                throw new InvalidDataException("Unable to decode PNG source: " + assetPath);
            }
            return texture;
        }

        static string Sha256(byte[] bytes)
        {
            using (SHA256 sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", string.Empty).ToLowerInvariant();
        }

        static string FullAssetPath(string assetPath)
        {
            DirectoryInfo projectRoot = Directory.GetParent(Application.dataPath);
            if (projectRoot == null) throw new InvalidOperationException("Unity project root is not available.");
            return Path.GetFullPath(Path.Combine(projectRoot.FullName, assetPath));
        }

        static string CandidateKey(string family, int tileId) => "flare." + family + "." + tileId.ToString("D3", CultureInfo.InvariantCulture);
    }
}
