// STUB (P-UNITY-LOOK-TOOLS-1): the compile-only surface the oracle tests call. The implementer replaces every body; the
// signatures, names and the namespace are the contract (docs/backlog/packets/P-UNITY-LOOK-TOOLS-1.md, Established facts).
// Editor-only: this file sits in Assets/Editor/Look, assembly Roguehalla.Editor (includePlatforms: Editor).
using System;
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Editor
{
    public static class LookCapture
    {
        /// <summary>Every scene name, in the order look-capture.sh --list prints them (the pinned list).</summary>
        public static readonly IReadOnlyList<string> SceneNames = new string[0];

        /// <summary>The non-public members of the client assembly the capture reaches by reflection: "ArenaView.Awake",
        /// "ArenaView._landmarks", "Landmark.Fades".</summary>
        public static readonly IReadOnlyList<string> ReflectionTargets = new string[0];

        /// <summary>The reflection targets that cannot be resolved today (empty when all resolve).</summary>
        public static IReadOnlyList<string> MissingReflectionTargets() { return new[] { "not implemented" }; }

        /// <summary>The map a scene renders: built through the client's validation (MapBlob.WithPublic), no rendering.</summary>
        public static MapBlob BuildMap(string scene) { return null; }

        /// <summary>The landmark anchor stamped into the scene's map; null for a zone scene.</summary>
        public static MapAnchor AnchorOf(string scene) { return null; }

        /// <summary>The zone (RegionId value 1..5) the scene is in.</summary>
        public static byte ZoneOf(string scene) { return 0; }

        /// <summary>The render target every shot is drawn into: 1920 x 1080, 24-bit depth, ARGB32, sRGB.</summary>
        public static RenderTextureDescriptor TargetDescriptor()
        {
            var d = new RenderTextureDescriptor(1, 1, RenderTextureFormat.ARGB32, 0);
            d.sRGB = false;
            return d;
        }

        /// <summary>Batch entry: -executeMethod Roguehalla.Editor.LookCapture.Run -lookScenes a,b -lookOut dir [-lookGroundOnly 1] [-lookQuality q].</summary>
        public static void Run() { throw new NotImplementedException("LookCapture.Run"); }
    }
}
