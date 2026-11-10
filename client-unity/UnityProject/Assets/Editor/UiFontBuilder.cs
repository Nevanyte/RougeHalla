using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.TextCore.LowLevel;

namespace Roguehalla.Editor
{
    /// <summary>
    /// Builds the HUD body font assets (Nunito Regular and Bold, SIL OFL) from the TTFs under Assets/Art/ThirdParty/Fonts.
    /// Run: Unity -batchmode -quit -projectPath ... -executeMethod Roguehalla.Editor.UiFontBuilder.Build
    /// The assets are dynamic (a missing glyph is rasterised on demand) and pre-populated with Latin text and the HUD's punctuation;
    /// Liberation Sans is the fallback for anything Nunito lacks.
    /// </summary>
    public static class UiFontBuilder
    {
        const string Folder = "Assets/Resources/Showcase";
        const string Characters =
            " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~" +
            " ¡¢£¥§©«®°±·»¿ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖ×ØÙÚÛÜßàáâãäåçèéêëìíîïñòóôõö÷øùúûüÿ" +
            "–—‘’“”•…←↑→↓";

        [MenuItem("Roguehalla/Build UI fonts")]
        public static void Build()
        {
            var regular = Make("Nunito-Regular", "NunitoRegular");
            var bold = Make("Nunito-Bold", "NunitoBold");
            var fallback = Resources.Load<TMP_FontAsset>("Fonts & Materials/LiberationSans SDF");
            foreach (var asset in new[] { regular, bold })
            {
                if (asset.fallbackFontAssetTable == null) asset.fallbackFontAssetTable = new System.Collections.Generic.List<TMP_FontAsset>();
                if (fallback != null && !asset.fallbackFontAssetTable.Contains(fallback)) asset.fallbackFontAssetTable.Add(fallback);
                var weights = asset.fontWeightTable;
                weights[4] = new TMP_FontWeightPair { regularTypeface = regular, italicTypeface = regular };
                weights[7] = new TMP_FontWeightPair { regularTypeface = bold, italicTypeface = bold };
                EditorUtility.SetDirty(asset);
            }
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("UI fonts built: " + regular.name + ", " + bold.name);
        }

        static TMP_FontAsset Make(string ttf, string assetName)
        {
            string path = Folder + "/" + assetName + ".asset";
            if (AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(path) != null) AssetDatabase.DeleteAsset(path);
            var font = AssetDatabase.LoadAssetAtPath<Font>("Assets/Art/ThirdParty/Fonts/" + ttf + ".ttf");
            if (font == null) throw new System.InvalidOperationException("Missing font " + ttf);
            var asset = TMP_FontAsset.CreateFontAsset(font, 90, 9, GlyphRenderMode.SDFAA, 1024, 1024, AtlasPopulationMode.Dynamic, true);
            asset.name = assetName;
            AssetDatabase.CreateAsset(asset, path);
            asset.material.name = assetName + " Material";
            AssetDatabase.AddObjectToAsset(asset.material, asset);
            for (int i = 0; i < asset.atlasTextures.Length; i++)
            {
                asset.atlasTextures[i].name = assetName + " Atlas " + i;
                AssetDatabase.AddObjectToAsset(asset.atlasTextures[i], asset);
            }
            string missing;
            asset.TryAddCharacters(Characters, out missing);
            if (!string.IsNullOrEmpty(missing)) Debug.Log(assetName + " has no glyph for: " + missing);
            EditorUtility.SetDirty(asset);
            return asset;
        }
    }
}
