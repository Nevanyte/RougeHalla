using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>The dashed patience outline and "PATIENCE RANGE" label of every living camp (W11), as legacy CampPatience.ts. Edges are built once per
    /// map (per MapBlob instance) from <see cref="MapBlob.Patience"/>; a frame changes visibility only. Pooled; a steady frame allocates nothing.
    /// Presentation only.</summary>
    public sealed class CampPatienceOutlines
    {
        public CampPatienceOutlines(Transform root) { }

        /// <summary>Per frame. <paramref name="map"/> may be null or carry no patience plane (nothing is drawn). <paramref name="camps"/> are the live camp rows
        /// (index i is map camp i).</summary>
        public void Update(MapBlob map, IReadOnlyList<CampView> camps, MatchPhase? phase, bool training) { }

        /// <summary>Edge lists built since construction: one per camp that has tiles, per distinct map. Unchanged by a frame where only visibility moved.</summary>
        public int Builds { get { return 0; } }
        /// <summary>Camps whose outline and label are visible now.</summary>
        public int Shown { get { return 0; } }
        public bool IsShown(int campIndex) { return false; }
        /// <summary>The label text of camp <paramref name="campIndex"/> when shown, else null.</summary>
        public string LabelAt(int campIndex) { return null; }
        /// <summary>Segments in camp <paramref name="campIndex"/>'s outline (0 when it has none).</summary>
        public int EdgeCount(int campIndex) { return 0; }
        /// <summary>World position of the label: the camp centre, 25 screen px (25 / 32 world units) lower.</summary>
        public Vector3 LabelPosition(int campIndex) { return Vector3.zero; }
    }
}
