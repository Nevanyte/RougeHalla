using System;
using NUnit.Framework;
using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>P-ENV-RETRO-1 part D: the shared sRGB to linear conversion for mesh vertex colours.</summary>
    public sealed class SrgbMeshColorsEditModeTests
    {
        static readonly Color32[] Samples = {
            new Color32(0, 0, 0, 255), new Color32(255, 255, 255, 255), new Color32(128, 128, 128, 255),
            new Color32(0x45, 0xaa, 0xe6, 255), new Color32(0xd5, 0x32, 0x47, 0x80), new Color32(10, 20, 30, 0),
        };

        static void AssertSame(Color expected, Color actual)
        {
            Assert.AreEqual(expected.r, actual.r, 1e-5f); Assert.AreEqual(expected.g, actual.g, 1e-5f);
            Assert.AreEqual(expected.b, actual.b, 1e-5f); Assert.AreEqual(expected.a, actual.a, 1e-5f);
        }

        [Test]
        public void ToLinearMatchesUnityLinearAndKeepsAlpha()
        {
            foreach (var c in Samples)
            {
                var want = ((Color)c).linear; want.a = c.a / 255f;
                AssertSame(want, SrgbMeshColors.ToLinear(c));
            }
            Assert.Less(SrgbMeshColors.ToLinear(new Color32(128, 128, 128, 255)).r, ((Color)new Color32(128, 128, 128, 255)).r);
        }

        [Test]
        public void FillWritesIntoTheCallersArrayWithoutAllocating()
        {
            var dst = new Color[Samples.Length];
            SrgbMeshColors.Fill(Samples, dst); // warm up
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 100; i++) SrgbMeshColors.Fill(Samples, dst);
            long grown = GC.GetAllocatedBytesForCurrentThread() - before;
            Assert.AreEqual(0, grown, "Fill must not allocate");
            for (int i = 0; i < Samples.Length; i++) AssertSame(((Color)Samples[i]).linear, dst[i] , Samples[i].a);
        }

        static void AssertSame(Color linearRgb, Color actual, byte a)
        {
            linearRgb.a = a / 255f; AssertSame(linearRgb, actual);
        }

        [Test]
        public void UploadMakesTheMeshReadBackLinear()
        {
            var mesh = new Mesh();
            try
            {
                mesh.SetVertices(new Vector3[Samples.Length]);
                var scratch = new Color[Samples.Length];
                SrgbMeshColors.Upload(mesh, Samples, scratch);
                var back = mesh.colors;
                Assert.AreEqual(Samples.Length, back.Length);
                for (int i = 0; i < Samples.Length; i++) AssertSame(((Color)Samples[i]).linear, back[i], Samples[i].a);
            }
            finally { UnityEngine.Object.DestroyImmediate(mesh); }
        }
    }
}
