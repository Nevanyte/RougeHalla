// DIAGNOSTIC ONLY. Every counter delta remains in the original full-window result; no correction or retry.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Newtonsoft.Json;
using NUnit.Framework;

namespace Roguehalla.Net.Tests
{
    internal sealed class AllocationWindowTrace
    {
        const int Warmup = 200, Iterations = 20000;
        static int sequence;
        readonly string output, test;
        readonly int ordinal, caller = Environment.CurrentManagedThreadId;
        readonly long backgroundIndexBefore;
        readonly long[] before = new long[Iterations], after = new long[Iterations];
        readonly long[] started = new long[Iterations], ended = new long[Iterations];
        readonly int[] threads = new int[Iterations], indices = new int[Iterations];
        readonly int[] gen0Before = new int[Iterations], gen0After = new int[Iterations];
        readonly int[] gen1Before = new int[Iterations], gen1After = new int[Iterations];
        readonly int[] gen2Before = new int[Iterations], gen2After = new int[Iterations];
        int invocations, captured;
        long windowBefore, windowAfter;
        bool windowCompleted;

        AllocationWindowTrace(string directory)
        {
            output = Path.GetFullPath(directory);
            Directory.CreateDirectory(output);
            ordinal = Interlocked.Increment(ref sequence);
            test = TestContext.CurrentContext.Test.FullName;
            // This API can allocate; run it on the caller, never inside the measurement worker/window.
            backgroundIndexBefore = GC.GetGCMemoryInfo(GCKind.Background).Index;
        }

        internal static AllocationWindowTrace TryCreate()
        {
            string output = Environment.GetEnvironmentVariable("RH_ALLOCATION_TRACE_DIRECTORY");
            return output == null ? null : new AllocationWindowTrace(output);
        }

        internal Action<int> Observe(Action<int> body)
        {
            return i =>
            {
                invocations++;
                // Prime diagnostic APIs during the existing 200 body warmups; no additional body invocation.
                if (i < Warmup)
                {
                    _ = Environment.CurrentManagedThreadId;
                    GC.CollectionCount(0); GC.CollectionCount(1); GC.CollectionCount(2);
                    Stopwatch.GetTimestamp();
                    body(i);
                    return;
                }
                int j = i - Warmup;
                if (j < 0 || j >= Iterations) throw new InvalidOperationException("unexpected diagnostic body index");
                indices[j] = i;
                threads[j] = Environment.CurrentManagedThreadId;
                gen0Before[j] = GC.CollectionCount(0);
                gen1Before[j] = GC.CollectionCount(1);
                gen2Before[j] = GC.CollectionCount(2);
                started[j] = Stopwatch.GetTimestamp();
                before[j] = GC.GetAllocatedBytesForCurrentThread();
                try { body(i); }
                finally
                {
                    after[j] = GC.GetAllocatedBytesForCurrentThread();
                    ended[j] = Stopwatch.GetTimestamp();
                    gen0After[j] = GC.CollectionCount(0);
                    gen1After[j] = GC.CollectionCount(1);
                    gen2After[j] = GC.CollectionCount(2);
                    captured = j + 1;
                }
            };
        }

        internal void SetWindow(long before, long after)
        {
            windowBefore = before; windowAfter = after; windowCompleted = true;
        }

        internal void Complete(Exception failure)
        {
            long sum = 0;
            for (int i = 0; i < captured; i++) sum += after[i] - before[i];
            var report = new
            {
                format = "rh-allocation-full-context/1", test, ordinal, callerThread = caller,
                runtime = RuntimeInformation.FrameworkDescription, runtimeVersion = Environment.Version.ToString(),
                os = RuntimeInformation.OSDescription, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
                serverGC = System.Runtime.GCSettings.IsServerGC, stopwatchFrequency = Stopwatch.Frequency,
                warmup = Warmup, iterations = Iterations, invocations, captured, windowCompleted,
                windowBefore, windowAfter, totalBytes = windowCompleted ? (long?)(windowAfter-windowBefore) : null,
                bodyCounterDeltaSum = sum,
                outsideBodyCounterDelta = windowCompleted ? (long?)(windowAfter-windowBefore-sum) : null,
                backgroundIndexBefore, backgroundIndexAfter = GC.GetGCMemoryInfo(GCKind.Background).Index,
                failureType = failure?.GetType().FullName, failureMessage = failure?.Message,
                before, after, started, ended, threads, indices,
                gen0Before, gen0After, gen1Before, gen1After, gen2Before, gen2After,
                interpretation = "Diagnostic APIs can perturb timing/GC. All measured bytes remain counted; GC correlation alone is not causal attribution. Partial arrays use captured only."
            };
            string path = Path.Combine(output, Environment.ProcessId + "-" + ordinal + ".json");
            using (var file = new StreamWriter(new FileStream(path, FileMode.CreateNew, FileAccess.Write)))
                file.Write(JsonConvert.SerializeObject(report));
        }
    }
}
