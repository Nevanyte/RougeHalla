using System;
using System.Collections.Generic;
using UnityEngine;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>
    /// P-UNITY-LANDMARK-1: builds each anchor's landmark art once per map from the anchor and the delivered tiles in its footprint,
    /// and fades the roof while an actor the client may see (C-OBS: ArenaView passes only those) stands on an interior tile.
    /// STUB: builds nothing.
    /// </summary>
    public sealed class LandmarkView : IDisposable
    {
        /// <summary>Roof alpha with nobody inside, and while an actor is inside (reached at LandmarkView's fade rate, PropFade.FadeRate).</summary>
        public const float RoofOpaqueAlpha = 1f, RoofFadedAlpha = .1f;

        readonly List<Landmark> _landmarks = new List<Landmark>();

        /// <summary>Landmarks built (anchors whose kind has art registered).</summary>
        public int Count { get { return _landmarks.Count; } }
        public Landmark Get(int index) { return _landmarks[index]; }

        /// <summary>Builds from map.Anchors under <paramref name="parent"/>. A map without anchors builds nothing.</summary>
        public static LandmarkView Build(Transform parent, MapBlob map) { return Build(parent, map, map.Anchors); }

        /// <summary>As <see cref="Build(Transform, MapBlob)"/> with the anchors given. An unknown kind code logs
        /// "LandmarkView: unknown kind N", a known kind without art "LandmarkView: no art for kind N"; each once per build, and
        /// draws nothing.</summary>
        public static LandmarkView Build(Transform parent, MapBlob map, MapAnchor[] anchors) { return new LandmarkView(); }

        /// <summary>Call once per frame for each actor drawn (the same callers as RegionProps.NoteActor); feet in world space.</summary>
        public void NoteActor(Vector3 feet) { }

        /// <summary>Moves each roof toward its target (faded when an actor was noted inside since the last Tick, else opaque), then
        /// forgets the notes. No allocation.</summary>
        public void Tick(float dt) { }

        public void Dispose() { }
    }
}
