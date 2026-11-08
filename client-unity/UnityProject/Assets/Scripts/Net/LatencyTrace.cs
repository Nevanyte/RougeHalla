// Optional test observer. The browser harness enables it before loading Unity; ordinary players record nothing.
using System.Runtime.InteropServices;
using UnityEngine;

namespace Roguehalla.Client
{
    static class LatencyTrace
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern int RhLatency_Enabled();
        [DllImport("__Internal")] static extern void RhLatency_Mark(string kind, int frame, uint player, int moveSeq, double x, double y);
        public static bool Enabled { get { return RhLatency_Enabled() != 0; } }
        public static void Mark(string kind, uint player, int moveSeq, double x, double y)
        {
            RhLatency_Mark(kind, Time.frameCount, player, moveSeq, x, y);
        }
#else
        public static bool Enabled { get { return false; } }
        public static void Mark(string kind, uint player, int moveSeq, double x, double y) { }
#endif
    }
}
