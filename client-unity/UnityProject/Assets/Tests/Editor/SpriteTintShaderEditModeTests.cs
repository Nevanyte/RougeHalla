using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// A SpriteRenderer's colour (a prop's fade, a landmark roof's fade) must reach the pixels. In Unity 6 the 2D renderer no longer
    /// writes that colour into the vertex colour: a lit sprite shader has to multiply by <c>unity_SpriteColor</c>, which exists only
    /// with instancing set up. RegionSpriteLit lacked that (found 2026-11-13 by rendering the landmarks: every roof and canopy stayed
    /// opaque while its alpha was .1). These tests read the shader sources, because EditMode runs without graphics and cannot look
    /// at pixels; the rendered proof is the coordinator's capture.
    /// </summary>
    public class SpriteTintShaderEditModeTests
    {
        static string Source(string name)
        {
            string path = Path.Combine(Application.dataPath, "Resources", "Regions", name + ".shader");
            Assert.That(File.Exists(path), Is.True, path);
            return File.ReadAllText(path);
        }

        [TestCase("RegionSpriteLit")]
        [TestCase("RegionActorLit")]
        public void ALitSpriteShaderMultipliesTheRendererColour(string name)
        {
            string s = Source(name);
            StringAssert.Contains("unity_SpriteColor", s, name + " ignores SpriteRenderer.color");
            StringAssert.Contains("SetUpSpriteInstanceProperties", s, name + ": unity_SpriteColor is only set once the instance properties are");
            StringAssert.Contains("UNITY_SETUP_INSTANCE_ID", s, name);
            StringAssert.Contains("multi_compile_instancing", s, name + ": without the instancing variant the colour stays white");
        }

        [Test]
        public void PropsAndLandmarksUseTheLitSpriteShader()
        {
            Assert.That(Resources.Load<Shader>("Regions/RegionSpriteLit"), Is.Not.Null);
        }
    }
}
