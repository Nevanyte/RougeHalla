using System;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// STUB (P-TEST-HARDEN-1): measures with the process-wide counter, so another thread's allocations are charged to the
    /// body. The implementer replaces it with <c>GarbageTests.PerCall</c>'s per-thread worker measurement (moved here), keeping
    /// this API, and writes the "how to write a new allocation test" comment here.
    /// </summary>
    public static class AllocationProbe
    {
        public const int DefaultIterations = 20000;

        /// <summary>Bytes allocated per call of <paramref name="body"/>, after a warm-up.</summary>
        public static double PerCall(Action<int> body, int iterations = DefaultIterations)
        {
            for (int i = 0; i < 200; i++) body(i);
            long before = GC.GetTotalAllocatedBytes(false);
            for (int i = 200; i < 200 + iterations; i++) body(i);
            return (GC.GetTotalAllocatedBytes(false) - before) / (double)iterations;
        }

        /// <summary>The minimum of <paramref name="runs"/> measurements.</summary>
        public static double PerCallMin(Action<int> body, int runs = 5, int iterations = DefaultIterations)
        {
            double best = double.MaxValue;
            for (int r = 0; r < runs; r++) best = Math.Min(best, PerCall(body, iterations));
            return best;
        }
    }
}
