using System;
using System.Runtime.ExceptionServices;
using System.Threading;

namespace Roguehalla.Net.Tests
{
    /// <summary>
    /// Allocation measurement for tests (P-TEST-HARDEN-1). Counts the calling worker thread only
    /// (<c>GC.GetAllocatedBytesForCurrentThread</c>), so other threads cannot add to a reading.
    ///
    /// How to write an allocation test: put the steady-state work in a body <c>i =&gt; ...</c> (keep results in a field or
    /// local that the body writes, so the work is not elided), call <see cref="PerCall"/> for an exact figure or
    /// <see cref="PerCallMin"/> when asserting a bound, and assert on the result (<c>Assert.AreEqual(0.0, ...)</c> for
    /// "allocates nothing"). Warm-up (JIT, first-use statics) is done here; do not allocate setup data inside the body.
    /// </summary>
    public static class AllocationProbe
    {
        public const int DefaultIterations = 20000;

        /// <summary>Leaves the calling thread holding no allocation block, so a measured window counts only what its body allocates.
        /// The per-thread counter is "bytes handed to the thread minus the unused rest of its current block". When the collector
        /// considers memory load high it can void a thread's block between collections, and the unused rest is then charged to the
        /// thread: one jump of a few kilobytes at a random call, with nothing allocated by the body. After a collection the
        /// thread holds no block, so there is no rest to charge; a real allocation is still counted in full.</summary>
        static void RetireAllocationBlock() => GC.Collect();

        /// <summary>Bytes allocated per call of <paramref name="body"/>, after 200 warm-up calls, on one dedicated worker thread.</summary>
        public static double PerCall(Action<int> body, int iterations = DefaultIterations)
        {
            double result = 0;
            ExceptionDispatchInfo failure = null;
            var worker = new Thread(() =>
            {
                try
                {
                    // Counter first-use and caller/NUnit execution context are outside the measured work.
                    GC.GetAllocatedBytesForCurrentThread();
                    for (int i = 0; i < 200; i++) body(i);
                    RetireAllocationBlock();
                    long before = GC.GetAllocatedBytesForCurrentThread();
                    for (int i = 200; i < 200 + iterations; i++) body(i);
                    result = (GC.GetAllocatedBytesForCurrentThread() - before) / (double)iterations;
                }
                catch (Exception error)
                {
                    failure = ExceptionDispatchInfo.Capture(error);
                }
            });
            if (ExecutionContext.IsFlowSuppressed()) worker.Start();
            else
            {
                using (ExecutionContext.SuppressFlow()) worker.Start();
            }
            worker.Join();
            failure?.Throw();
            return result;
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
