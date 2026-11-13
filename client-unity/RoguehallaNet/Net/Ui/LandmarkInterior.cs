using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// P-UNITY-LANDMARK-1: which floor tiles of a landmark's footprint are INTERIOR (under its roof), found from the delivered
    /// collision tiles alone, so it is right in every orientation the generator places a blueprint in. Pure, engine-free.
    /// The rule is pinned in docs/backlog/packets/P-UNITY-LANDMARK-1.md section 3 (fact 4). STUB: finds nothing.
    /// </summary>
    public static class LandmarkInterior
    {
        /// <summary>The widest run of floor between two wall tiles (a doorway, a mouth, a gate) that still counts as closed.</summary>
        public const int MaxOpening = 5;

        /// <summary>Row-major flags over the footprint (index (y - footprint.Y) * footprint.W + (x - footprint.X)): true for an
        /// interior floor tile. <paramref name="tiles"/> is the map's collision plane (MapBlob.Floor / Wall / Low), w x h.</summary>
        public static bool[] Find(byte[] tiles, int w, int h, Protocol.MapRect footprint /* Net.Ui has a MapRect of its own (the map screen's): the footprint is the protocol's */, MapTile[] entrance)
        {
            return new bool[footprint.W * footprint.H];
        }

        /// <summary>Number of true flags.</summary>
        public static int Count(bool[] interior)
        {
            int n = 0;
            foreach (bool b in interior) if (b) n++;
            return n;
        }
    }
}
