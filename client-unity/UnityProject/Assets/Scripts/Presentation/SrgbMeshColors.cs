using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// sRGB constants to the linear vertex colours a mesh needs. The project is in Linear colour space and the unlit sprite material reads mesh
    /// vertex colours raw, as linear values, so an sRGB constant (a hex from a palette) written straight into <see cref="Mesh.SetColors(Color[])"/>
    /// renders lifted and washed out. Keep colour constants as sRGB <see cref="Color32"/> and convert here at the upload; alpha is not
    /// gamma-encoded and passes through as a / 255. Fill and Upload take caller-owned arrays so a per-frame upload allocates nothing.
    /// </summary>
    public static class SrgbMeshColors
    {
        /// <summary>The linear colour for one sRGB colour; alpha unchanged.</summary>
        public static Color ToLinear(Color32 c)
        {
            var lin = ((Color)c).linear; lin.a = c.a / 255f;
            return lin;
        }

        /// <summary>Converts src into the preallocated dst (the first src.Length entries). No allocation.</summary>
        public static void Fill(Color32[] src, Color[] dst)
        {
            for (int i = 0; i < src.Length; i++) dst[i] = ToLinear(src[i]);
        }

        /// <summary>Converts src into scratch and sets it as the mesh's vertex colours.</summary>
        public static void Upload(Mesh mesh, Color32[] src, Color[] scratch)
        {
            Fill(src, scratch);
            mesh.SetColors(scratch);
        }
    }
}
