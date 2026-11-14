using System;
using System.IO;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Rendering;
using UnityEngine;
using UnityEngine.Rendering;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// The Web build (WebGL 2, shader platform GLES3x) refuses a fragment stage that references more than 16 sampler states
    /// ("maximum ps_5_0 sampler register index (16) exceeded"), yet Unity still reports "Build Finished, Result: Success" and the
    /// player runs without that variant; only <c>Tools/build-web.sh</c> notices, by reading the log. These tests find the same error
    /// in EditMode, without a graphics device: they ask the editor's shader compiler for the GLES3x fragment program of every shader
    /// under <c>Assets/Resources/Regions/</c> and fail on any Error message.
    ///
    /// The API is <c>UnityEditor.ShaderUtil.CompileShaderVariant</c>, which is internal in Unity 6000.0, so it is called by
    /// reflection. (<c>ShaderUtil.GetShaderMessages(shader, GLES3x)</c> shows the same error but only reads the importer's cached
    /// messages, which depend on what ran before.) Passing <c>outputForExternalTool: true</c> is what makes the GLES3x translation
    /// run; with false the call reports success without compiling anything.
    ///
    /// Worst case only: the sampler count of a 2D lit shader grows with the URP shape light keywords
    /// (<c>USE_SHAPE_LIGHT_TYPE_0..3</c>, each adds a texture and a sampler), so the variant with all four keywords on is the
    /// one that can go over. Every other keyword combination references a subset of its samplers.
    ///
    /// Found by the round 9 Web build of coord/int-29 (1ac2b2a76): the variant of Roguehalla/RegionGround with all four shape light
    /// keywords has 17 sampler states since P-UNITY-DRESS-1 added _VariantTex (round 8, 86806e01, had exactly 16).
    /// </summary>
    public class RegionShaderWebCompileEditModeTests
    {
        const int SamplerLimit = 16;
        static readonly string[] AllShapeLights =
            { "USE_SHAPE_LIGHT_TYPE_0", "USE_SHAPE_LIGHT_TYPE_1", "USE_SHAPE_LIGHT_TYPE_2", "USE_SHAPE_LIGHT_TYPE_3" };

        static readonly MethodInfo Compile = typeof(ShaderUtil).GetMethod(
            "CompileShaderVariant", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
        static readonly MethodInfo PlatformKeywords = typeof(ShaderUtil).GetMethod(
            "GetShaderPlatformKeywordsForBuildTarget", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic,
            null, new[] { typeof(ShaderCompilerPlatform), typeof(BuildTarget), typeof(GraphicsTier) }, null);

        public static string[] RegionShaderNames()
        {
            string dir = Path.Combine(Application.dataPath, "Resources", "Regions");
            return Directory.GetFiles(dir, "*.shader").Select(Path.GetFileNameWithoutExtension).OrderBy(n => n, StringComparer.Ordinal).ToArray();
        }

        /// <summary>Compiles pass 0 of the shader's first subshader, fragment stage, for the Web target with the given keywords.
        /// Returns every Error message as "file:line message"; an empty array is a clean compile.</summary>
        static string[] FragmentErrorsOnWeb(Shader shader, string[] keywords)
        {
            Assert.That(Compile, Is.Not.Null, "UnityEditor.ShaderUtil.CompileShaderVariant is gone in this Editor version: this oracle needs another way to compile for GLES3x");
            Assert.That(PlatformKeywords, Is.Not.Null, "ShaderUtil.GetShaderPlatformKeywordsForBuildTarget is gone in this Editor version");
            object platform = PlatformKeywords.Invoke(null, new object[] { ShaderCompilerPlatform.GLES3x, BuildTarget.WebGL, GraphicsTier.Tier1 });
            Type shaderType = Compile.GetParameters()[3].ParameterType;
            object result = Compile.Invoke(null, new object[]
            {
                shader, 0, 0, Enum.Parse(shaderType, "Fragment"), platform, keywords,
                ShaderCompilerPlatform.GLES3x, BuildTarget.WebGL, GraphicsTier.Tier1, true,
            });
            var messages = ((Array)result.GetType().GetProperty("Messages").GetValue(result)).Cast<ShaderMessage>();
            return messages.Where(m => m.severity == ShaderCompilerMessageSeverity.Error)
                .Select(m => m.file + ":" + m.line + " " + m.message).ToArray();
        }

        [TestCaseSource(nameof(RegionShaderNames))]
        public void EveryRegionShaderCompilesForTheWebWithAllShapeLights(string name)
        {
            string path = "Assets/Resources/Regions/" + name + ".shader";
            var shader = AssetDatabase.LoadAssetAtPath<Shader>(path);
            Assert.That(shader, Is.Not.Null, path);
            string[] errors = FragmentErrorsOnWeb(shader, AllShapeLights);
            Assert.That(errors, Is.Empty,
                path + " does not compile for GLES3x (WebGL) with all four shape light keywords; build-web.sh exits 1 on this and the variant is "
                + "missing from the player. Messages: " + string.Join(" | ", errors)
                + ". The limit is " + SamplerLimit + " sampler states in the fragment stage: share a SamplerState between textures, pack masks "
                + "into channels, or drop a texture.");
        }

        static string SyntheticShader(int samplers)
        {
            var src = new System.Text.StringBuilder();
            src.Append("Shader \"Hidden/RhSamplerProbe").Append(samplers).Append("\" { SubShader { Pass { HLSLPROGRAM\n#pragma vertex vert\n#pragma fragment frag\n");
            for (int i = 0; i < samplers; i++) src.Append("Texture2D t").Append(i).Append("; SamplerState s").Append(i).Append(";\n");
            src.Append("struct A { float4 p : POSITION; };\nfloat4 vert(A a) : SV_POSITION { return a.p; }\nfloat4 frag(float4 p : SV_POSITION) : SV_Target { float4 c = 0;\n");
            for (int i = 0; i < samplers; i++) src.Append("c += t").Append(i).Append(".Sample(s").Append(i).Append(", p.xy);\n");
            src.Append("return c; }\nENDHLSL } } }");
            return src.ToString();
        }

        /// <summary>Proves the check above can fail: the same helper rejects a fragment stage with a 17th sampler state and accepts 16,
        /// so an added texture cannot slip past it.</summary>
        [Test]
        public void TheWebCompileCheckCatchesASeventeenthSamplerAndAcceptsSixteen()
        {
            var sixteen = ShaderUtil.CreateShaderAsset(SyntheticShader(SamplerLimit), false);
            var seventeen = ShaderUtil.CreateShaderAsset(SyntheticShader(SamplerLimit + 1), false);
            try
            {
                string[] ok = FragmentErrorsOnWeb(sixteen, new string[0]);
                Assert.That(ok, Is.Empty, "16 sampler states must compile for GLES3x: " + string.Join(" | ", ok));
                string[] bad = FragmentErrorsOnWeb(seventeen, new string[0]);
                Assert.That(bad.Any(e => e.Contains("sampler register index")), Is.True,
                    "17 sampler states must be reported as an error by the check; got: " + (bad.Length == 0 ? "no message" : string.Join(" | ", bad)));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(sixteen);
                UnityEngine.Object.DestroyImmediate(seventeen);
            }
        }
    }
}
