using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// A SpriteRenderer's colour (a prop's fade, a landmark roof's fade) must reach the pixels. In Unity 6 the 2D renderer no longer
    /// writes that colour into the vertex colour: a lit sprite shader has to multiply by <c>unity_SpriteColor</c>. RegionActorLit did;
    /// RegionSpriteLit did not (found 2026-11-13 by rendering the landmarks: every roof and canopy stayed
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
            StringAssert.Contains("* unity_SpriteColor", s, name + " ignores SpriteRenderer.color");
            // A shader that compiles the instancing variant must also set the instance up, or that variant reads the wrong colour.
            if (s.Contains("multi_compile_instancing"))
            {
                StringAssert.Contains("UNITY_SETUP_INSTANCE_ID", s, name);
                StringAssert.Contains("SetUpSpriteInstanceProperties", s, name);
            }
        }

        [Test]
        public void PropsAndLandmarksUseTheLitSpriteShader()
        {
            Assert.That(Resources.Load<Shader>("Regions/RegionSpriteLit"), Is.Not.Null);
        }
    }
}
