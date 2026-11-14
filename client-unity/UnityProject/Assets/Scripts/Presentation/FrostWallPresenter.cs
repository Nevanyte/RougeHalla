// P-UNITY-FROST-WALL-1: standing Frost Walls (legacy 78dd8bd4 FieldView.ts drawWall), the cast telegraph (WishFx.ts
// drawWallTelegraph) and the aim preview (AbilityAim.ts). Draws only what it is given: walls from the delivered tiles, the
// preview from FrostWallAim's tiles. Presentation only. STUB: draws nothing; the implementer replaces every body.
using System;
using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;
using UnityEngine;

namespace Roguehalla.Client
{
    public sealed class FrostWallPresenter : IDisposable
    {
        /// <summary>Legacy ice colours (FieldView.ts WALL_TOP, WALL_FRONT, WALL_EDGE) and the preview's invalid tint
        /// (AbilityAim.ts 0xef5350). Dials (docs/unity/DIALS.md).</summary>
        public static readonly Color32 TopColor = new Color32(0xe1, 0xf5, 0xfe, 0xff);
        public static readonly Color32 FaceColor = new Color32(0x4f, 0xc3, 0xf7, 0xff);
        public static readonly Color32 EdgeColor = new Color32(0x02, 0x88, 0xd1, 0xff);
        public static readonly Color32 InvalidTint = new Color32(0xef, 0x53, 0x50, 0xff);
        /// <summary>Legacy top alpha, how much the crack takes off it, and the crack's time (ms before the end).</summary>
        public const float TopAlpha = .85f, CrackFade = .3f;
        public const double CrackMs = 1000;

        public FrostWallPresenter(Transform parent) { }

        // ---- standing walls ----
        /// <summary>The wall rows of <paramref name="fields"/> (Kind Wall) at server render time <paramref name="renderMs"/>.
        /// STUB.</summary>
        public void PresentWalls(IReadOnlyList<AreaView> fields, double renderMs) { }
        /// <summary>Walls drawn.</summary>
        public int WallCount { get { return 0; } }
        /// <summary>Ice blocks drawn, every wall's, in field order then tile order.</summary>
        public int BlockCount { get { return 0; } }
        public MapTile BlockTile(int i) { throw new ArgumentOutOfRangeException(nameof(i)); }
        /// <summary>The block's GameObject (active while drawn).</summary>
        public GameObject BlockObject(int i) { throw new ArgumentOutOfRangeException(nameof(i)); }
        /// <summary>The alpha of the block's top (legacy <c>0.85 - 0.3 * crack</c> times the field fade).</summary>
        public float BlockTopAlpha(int i) { throw new ArgumentOutOfRangeException(nameof(i)); }
        /// <summary>The colour of the block's top, alpha ignored.</summary>
        public Color32 BlockTopColor(int i) { throw new ArgumentOutOfRangeException(nameof(i)); }

        // ---- the cast telegraph ----
        /// <summary>A Wish start under <c>Wall</c>: a line <paramref name="length"/> long across (<paramref name="x"/>,
        /// <paramref name="y"/>), square to the line from the caster, from <paramref name="startMs"/> for
        /// <paramref name="durationMs"/> (server ms). STUB.</summary>
        public void Telegraph(float casterX, float casterY, float x, float y, float length, double startMs, double durationMs) { }
        /// <summary>Advances the telegraph and the walls' looks to server render time <paramref name="renderMs"/>. STUB.</summary>
        public void Tick(double renderMs, float now, bool reducedMotion) { }
        public bool TelegraphVisible { get { return false; } }
        /// <summary>The telegraph's ends in sim units (legacy order: <c>(x - uy*half, y + ux*half)</c>, then the other).</summary>
        public Vector2 TelegraphEndA { get { return default; } }
        public Vector2 TelegraphEndB { get { return default; } }

        // ---- the aim preview ----
        /// <summary>Draws the preview: the reach ring round the caster, a block per tile of <paramref name="cells"/> (row-major
        /// indices on a map <paramref name="mapW"/> wide), the wall's line and centre; red with no tile; hidden when
        /// <paramref name="wish"/> is not Wall. STUB.</summary>
        public void ShowPreview(in FrostWallSegment seg, IReadOnlyList<uint> cells, int mapW, float casterX, float casterY,
            float range, Color32 tint, FrostWishKind wish) { }
        public void HidePreview() { }
        public bool PreviewVisible { get { return false; } }
        public int PreviewBlockCount { get { return 0; } }
        public MapTile PreviewTile(int i) { throw new ArgumentOutOfRangeException(nameof(i)); }
        /// <summary>The tint the preview is drawn in (the given tint, or <see cref="InvalidTint"/> with no tile).</summary>
        public Color32 PreviewTint { get { return default; } }

        /// <summary>Destroys every object the presenter made. STUB.</summary>
        public void Dispose() { }
    }
}
