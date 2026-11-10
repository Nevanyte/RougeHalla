using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// The "Strokes" sorting layer, after "Default". Every adaptive outline (SpriteOutline) draws there, so it sits above the props, walls, plates and other
    /// figures that stand in front of a fighter: a fighter under foliage keeps a readable contour. The 2D renderer's Camera Sorting Layer Texture is grabbed
    /// once, after "Default" (Roguehalla2DRenderer.asset: bound = Default, full resolution), so it holds the whole scene as the stroke will sit on it (ground,
    /// glow, props, walls, bodies, fog) and no stroke. The stroke shader reads it to choose its colour.
    /// </summary>
    public static class StrokeLayer
    {
        public const string Name = "Strokes";
        public static int Id { get { return SortingLayer.NameToID(Name); } }
        public static bool Exists { get { return SortingLayer.IsValid(Id) && Id != 0; } }
    }
}
