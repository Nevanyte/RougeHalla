// DIAGNOSTIC ONLY: real PerCall, no decoder, fixed finite controls. Never forces a collection or changes a budget.
using System;
using System.IO;
using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using Roguehalla.Net.Tests;

class Program
{
    static object anchor, extra;

    static void Main(string[] args)
    {
        if (args.Length != 1 || Directory.Exists(args[0]) || File.Exists(args[0]))
            throw new ArgumentException("one NEW task-owned output directory required");
        string output = Path.GetFullPath(args[0]); Directory.CreateDirectory(output);
        Environment.SetEnvironmentVariable("RH_ALLOCATION_TRACE_DIRECTORY", Path.Combine(output, "windows"));
        var measure = (Func<Action<int>, double>)typeof(GarbageTests).GetMethod("PerCall", BindingFlags.NonPublic | BindingFlags.Static)
            .CreateDelegate(typeof(Func<Action<int>, double>));
        var rows = new object[4];
        for (int c = 0; c < 4; c++)
        {
            bool pressure = c != 0, every = c == 2, single = c == 3;
            ExceptionDispatchInfo failure = null;
            using var ready = new ManualResetEventSlim(!pressure);
            Thread allocator = null;
            if (pressure)
            {
                allocator = new Thread(() =>
                {
                    try
                    {
                        // 128MiB total, at most nine 1MiB arrays live; ordinary allocations only.
                        var ring = new byte[8][];
                        for (int j = 0; j < 128; j++)
                        {
                            ring[j % ring.Length] = new byte[1024 * 1024];
                            if (j == 7) ready.Set();
                            Thread.Sleep(1);
                        }
                        GC.KeepAlive(ring);
                    }
                    catch (Exception error) { failure = ExceptionDispatchInfo.Capture(error); ready.Set(); }
                });
                allocator.Start();
            }
            try
            {
                if (!ready.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException("allocator startup");
                failure?.Throw();
                double mean = measure(i =>
                {
                    // The anchor is an actual warmup allocation on the measured worker, outside indices200..20199.
                    if (i == 0) anchor = new object();
                    if (i >= 200 && (every || (single && i == 200))) extra = new object();
                    Thread.SpinWait(64);
                });
                if (every && mean < 24 || single && mean < 24.0 / 20000)
                    throw new InvalidOperationException("a real allocation disappeared");
                rows[c] = new { ordinal = c+1, name = every ? "every-call-object" : single ? "index200-object" : "warm-anchor-spin-only",
                    pressure, allocatedPressureBytes = pressure ? 128L*1024*1024 : 0,
                    measuredNewObjectSites = every ? 20000 : single ? 1 : 0,
                    bytesPerCall = mean, observedTotalBytes = mean*20000,
                    interpretation = "Reported in full, not adjusted. Positive spin-only count is runtime/counter behavior without any decoder call; historical CI cause remains unproven." };
            }
            finally
            {
                if (allocator != null && !allocator.Join(TimeSpan.FromSeconds(10))) throw new TimeoutException("allocator shutdown");
            }
            failure?.Throw();
        }
        GC.KeepAlive(anchor); GC.KeepAlive(extra);
        using var stream = new FileStream(Path.Combine(output,"controls.json"),FileMode.CreateNew,FileAccess.Write);
        JsonSerializer.Serialize(stream, new { runtime = RuntimeInformation.FrameworkDescription, arch = RuntimeInformation.ProcessArchitecture.ToString(),
            os = RuntimeInformation.OSDescription, rows, scope = "Four finite diagnostic cases, no retry/window selection/GC forcing or decoder calls" });
    }
}
