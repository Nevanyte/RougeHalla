using System.Diagnostics;

namespace Roguehalla.Client
{
    /// <summary>
    /// Opt-in (<c>?perf=1</c>) per-system CPU sections for the frame-time recorder. Release WebGL players compile Unity's profiler
    /// markers out, so the few systems worth attributing are bracketed here with a Stopwatch timestamp instead. When the
    /// recorder is off (every normal session) <see cref="Begin"/> is one static bool test and <see cref="End"/> returns at once.
    /// No allocation: fixed arrays, indexed by <see cref="Sec"/>.
    /// </summary>
    public static class PerfMarks
    {
        public enum Sec
        {
            // engine phases (PlayerLoop brackets, PerfRecorder)
            Frame, PreUpdate, Scripts, Render, UiRebuild,
            // scripts we own
            NetPoll, Hud, Camera, Present, Actors, Collections, SurfaceFx, Vision, Props, WishFx, Effects, Atmosphere, Soundscape, MapUi,
            HudAccount, HudFlows, HudMap, HudEdge, HudDrawer, HudOwner, FxCues, Count
        }

        public static readonly string[] Names =
        {
            "frame", "preUpdate", "scripts", "render", "uiRebuild",
            "netPoll", "hud", "camera", "present", "actors", "collections", "surfaceFx", "vision", "props", "wishFx", "effects", "atmosphere", "soundscape", "mapUi",
            "hudAccount", "hudFlows", "hudMap", "hudEdge", "hudDrawer", "hudOwner", "fxCues",
        };

        public static bool On;
        static readonly double TickMs = 1000.0 / Stopwatch.Frequency;
        static readonly double[] _sum = new double[(int)Sec.Count];
        static readonly double[] _max = new double[(int)Sec.Count];
        static readonly double[] _frame = new double[(int)Sec.Count];
        static readonly int[] _calls = new int[(int)Sec.Count];
        static readonly double[] _alloc = new double[(int)Sec.Count];
        static int _frames;

        /// <summary>A section start: timestamp and managed heap size (allocation inside the section is the heap growth; a GC never runs mid-frame on WebGL).</summary>
        public struct Mark { public long T; public long Heap; }

        public static Mark Begin() { return On ? new Mark { T = Stopwatch.GetTimestamp(), Heap = System.GC.GetTotalMemory(false) } : default(Mark); }

        public static void End(Sec s, Mark start)
        {
            if (!On || start.T == 0L) return;
            double ms = (Stopwatch.GetTimestamp() - start.T) * TickMs;
            long grew = System.GC.GetTotalMemory(false) - start.Heap;
            int i = (int)s; _frame[i] += ms; _calls[i]++; if (grew > 0) _alloc[i] += grew;
        }

        /// <summary>Closes one frame: per-section frame totals go into the window sums and maxima.</summary>
        public static void EndFrame()
        {
            if (!On) return;
            _frames++;
            for (int i = 0; i < _frame.Length; i++)
            {
                double v = _frame[i]; _sum[i] += v; if (v > _max[i]) _max[i] = v; _frame[i] = 0;
            }
        }

        public static void Reset()
        {
            _frames = 0;
            for (int i = 0; i < _sum.Length; i++) { _sum[i] = 0; _max[i] = 0; _frame[i] = 0; _calls[i] = 0; _alloc[i] = 0; }
        }

        public static int Frames { get { return _frames; } }
        public static double MeanMs(int i) { return _frames > 0 ? _sum[i] / _frames : 0; }
        public static double MaxMs(int i) { return _max[i]; }
        public static int Calls(int i) { return _calls[i]; }
        /// <summary>Managed bytes allocated inside the section, per frame.</summary>
        public static double AllocPerFrame(int i) { return _frames > 0 ? _alloc[i] / _frames : 0; }
    }
}
