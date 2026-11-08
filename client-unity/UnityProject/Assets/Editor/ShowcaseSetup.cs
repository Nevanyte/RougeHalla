// Reproducible editor authoring; invoke through the running Editor.
namespace Roguehalla.Editor
{
    public static class ShowcaseSetup
    {
        [UnityEditor.MenuItem("Roguehalla/Art/Configure Torch Presets")]
        public static void ConfigureTorchPresets()
        {
            const string source = "Assets/Resources/Showcase/Torch.prefab";
            if (UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.GameObject>(source) == null)
                throw new System.InvalidOperationException("The tracked Disabled Torch authoring source is required.");
            foreach (bool accurate in new[] { false, true })
            {
                var root = UnityEditor.PrefabUtility.LoadPrefabContents(source);
                try
                {
                    root.name = accurate ? "TorchAccurate" : "Torch";
                    var light = root.GetComponent<UnityEngine.Rendering.Universal.Light2D>();
                    var serialized = new UnityEditor.SerializedObject(light);
                    // URP declares Disabled first, but its numeric value is 2. enumValueIndex is not the wire value.
                    serialized.FindProperty("m_NormalMapQuality").intValue = accurate ? 1 : 2;
                    serialized.FindProperty("m_NormalMapDistance").floatValue = .4f;
                    serialized.FindProperty("m_UseNormalMap").boolValue = accurate;
                    serialized.ApplyModifiedPropertiesWithoutUndo();
                    light.enabled = false; // The owner configures both variants before choosing either.
                    UnityEditor.PrefabUtility.SaveAsPrefabAsset(root, accurate ? "Assets/Resources/Showcase/TorchAccurate.prefab" : source);
                }
                finally { UnityEditor.PrefabUtility.UnloadPrefabContents(root); }
            }
            UnityEditor.AssetDatabase.SaveAssets();
            ValidateTorchPresets();
        }

        public static void ValidateTorchPresets()
        {
            var low = UnityEngine.Resources.Load<UnityEngine.GameObject>("Showcase/Torch");
            var high = UnityEngine.Resources.Load<UnityEngine.GameObject>("Showcase/TorchAccurate");
            if (!Roguehalla.Client.ShowcasePointLight.ValidatePresets(low, high, out string reason))
                throw new UnityEditor.Build.BuildFailedException("Invalid showcase light presets: " + reason);
        }

        [UnityEditor.MenuItem("Roguehalla/Art/Play Presentation Study")]
        public static void PlayStudy()
        {
            if(UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode) return;
            UnityEditor.SceneManagement.EditorSceneManager.OpenScene("Assets/Scenes/Main.unity");
            UnityEditor.SessionState.SetString("Roguehalla.ArtPreviewQuery","?preview=1");
            UnityEditor.EditorApplication.isPlaying=true;
        }
        [UnityEditor.MenuItem("Roguehalla/Art/Configure 2D Showcase")]
        public static void Configure()
        {
            System.IO.Directory.CreateDirectory("Assets/Resources/Showcase");
            ConfigureTorchPresets();
            var renderer = UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.Universal.Renderer2DData>("Assets/Settings/Roguehalla2DRenderer.asset");
            if (renderer == null) { renderer = UnityEngine.ScriptableObject.CreateInstance<UnityEngine.Rendering.Universal.Renderer2DData>(); UnityEditor.AssetDatabase.CreateAsset(renderer, "Assets/Settings/Roguehalla2DRenderer.asset"); }
            var rs = new UnityEditor.SerializedObject(renderer);
            rs.FindProperty("m_PostProcessData").objectReferenceValue = UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.Universal.PostProcessData>("Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset");
            rs.FindProperty("m_TransparencySortMode").enumValueIndex = 3;
            rs.FindProperty("m_TransparencySortAxis").vector3Value = UnityEngine.Vector3.up;
            rs.FindProperty("m_LightRenderTextureScale").floatValue = .5f;
            rs.FindProperty("m_HDREmulationScale").floatValue = 4;
            rs.ApplyModifiedPropertiesWithoutUndo();
            var pipeline = UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset>("Assets/Settings/RoguehallaPipeline.asset");
            var ps = new UnityEditor.SerializedObject(pipeline);
            var renderers = ps.FindProperty("m_RendererDataList"); renderers.arraySize = 1; renderers.GetArrayElementAtIndex(0).objectReferenceValue = renderer;
            ps.FindProperty("m_DefaultRendererIndex").intValue = 0;
            ps.ApplyModifiedPropertiesWithoutUndo();
            pipeline.supportsHDR = true; pipeline.msaaSampleCount = 1; pipeline.renderScale = 1;
            UnityEngine.Rendering.GraphicsSettings.defaultRenderPipeline = pipeline;
            UnityEngine.QualitySettings.renderPipeline = pipeline;
            UnityEditor.PlayerSettings.colorSpace = UnityEngine.ColorSpace.Linear;
            UnityEditor.PlayerSettings.enableFrameTimingStats = true;
            var profile = UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Rendering.VolumeProfile>("Assets/Resources/Showcase/Atmosphere.asset");
            if (profile == null) { profile = UnityEngine.ScriptableObject.CreateInstance<UnityEngine.Rendering.VolumeProfile>(); UnityEditor.AssetDatabase.CreateAsset(profile, "Assets/Resources/Showcase/Atmosphere.asset"); }
            UnityEngine.Rendering.Universal.Bloom bloom;
            if (!profile.TryGet(out bloom)) { bloom = profile.Add<UnityEngine.Rendering.Universal.Bloom>(true); UnityEditor.AssetDatabase.AddObjectToAsset(bloom, profile); }
            bloom.threshold.Override(1); bloom.intensity.Override(.45f); bloom.scatter.Override(.6f); bloom.highQualityFiltering.Override(false);
            UnityEngine.Rendering.Universal.ColorAdjustments grade;
            if (!profile.TryGet(out grade)) { grade = profile.Add<UnityEngine.Rendering.Universal.ColorAdjustments>(true); UnityEditor.AssetDatabase.AddObjectToAsset(grade, profile); }
            grade.contrast.Override(10); grade.saturation.Override(-5); grade.postExposure.Override(.12f);
            UnityEngine.Rendering.Universal.Tonemapping tone;
            if (!profile.TryGet(out tone)) { tone = profile.Add<UnityEngine.Rendering.Universal.Tonemapping>(true); UnityEditor.AssetDatabase.AddObjectToAsset(tone, profile); }
            tone.mode.Override(UnityEngine.Rendering.Universal.TonemappingMode.Neutral);
            foreach(var name in new[]{"Sprite-Lit-Default", "Sprite-Unlit-Default"}) {
             var path = "Assets/Resources/Showcase/" + name + ".mat";
             if(UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Material>(path)==null) UnityEditor.AssetDatabase.CreateAsset(new UnityEngine.Material(UnityEngine.Shader.Find("Universal Render Pipeline/2D/"+name)),path);
            }
            UnityEditor.EditorUtility.SetDirty(renderer); UnityEditor.EditorUtility.SetDirty(pipeline); UnityEditor.EditorUtility.SetDirty(profile);
            UnityEditor.AssetDatabase.SaveAssets();
            UnityEngine.Debug.Log("Showcase 2D setup complete");
        }
    }

    public sealed class ShowcaseLightBuildValidation : UnityEditor.Build.IPreprocessBuildWithReport
    {
        public int callbackOrder { get { return 0; } }
        public void OnPreprocessBuild(UnityEditor.Build.Reporting.BuildReport report) { ShowcaseSetup.ValidateTorchPresets(); }
    }
}
