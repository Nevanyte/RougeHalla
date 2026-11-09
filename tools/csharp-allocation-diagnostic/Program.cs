// DIAGNOSTIC ONLY: actual decoder and original test factory; no root-cause or gate-clearance claim.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Tests;

class Program
{
    const int Warmup = 200, Iterations = 20000;
    static object sink, extra;
    static readonly JsonSerializerOptions Json = new JsonSerializerOptions { WriteIndented = true };
    static string output;
    static readonly List<object> records = new List<object>();

    static int Main(string[] args)
    {
        if (args.Length != 2 || args[0] != "--output" || Directory.Exists(args[1]) || File.Exists(args[1]))
            throw new ArgumentException("supply --output NEW-owned-directory");
        output = Path.GetFullPath(args[1]); Directory.CreateDirectory(output);
        var factory = typeof(GarbageTests).GetMethod("Snap", BindingFlags.NonPublic | BindingFlags.Static);
        var candidate = (Func<Action<int>, double>)typeof(GarbageTests)
            .GetMethod("PerCall", BindingFlags.NonPublic | BindingFlags.Static)
            .CreateDelegate(typeof(Func<Action<int>, double>));
        // Reflection, frame encoding, delegates, arrays and file/console output stay outside allocation windows.
        foreach (int actors in new[] { 14, 1, 68 }) foreach (bool self in new[] { false, true })
        {
            var snapshot = (ServerMsg.Snapshot)factory.Invoke(null, new object[] { 20000u, actors, self });
            byte[] frame = snapshot.Encode();
            string name = "decode-" + actors + (self ? "-self" : "-spectator");
            int budget = 32 * actors + (self ? 176 : 88);
            Record(new { kind = "frame", name, actors, self, budget, bytes = frame.Length,
                sha256 = Convert.ToHexString(SHA256.HashData(frame)).ToLowerInvariant() });
            Action<int> body = i => sink = ServerMsg.Decode(frame, frame.Length);
            Compare(name, body, budget, candidate);
            Compare(name + "-extra-object", i => { body(i); extra = new object(); }, budget, candidate);
        }
        Compare("empty", i => { }, 0, candidate);
        Compare("object-every-call", i => extra = new object(), 0, candidate);
        Compare("object-only-measured-index200", i => { if (i == 200) extra = new object(); }, 0, candidate);
        GC.KeepAlive(sink); GC.KeepAlive(extra);
        var runtime = new {
            framework = RuntimeInformation.FrameworkDescription, runtime = Environment.Version.ToString(),
            os = RuntimeInformation.OSDescription, arch = RuntimeInformation.ProcessArchitecture.ToString(),
            serverGC = System.Runtime.GCSettings.IsServerGC, warmup = Warmup, iterations = Iterations,
            environment = new Dictionary<string, string> {
                ["DOTNET_TieredCompilation"] = Environment.GetEnvironmentVariable("DOTNET_TieredCompilation"),
                ["DOTNET_TieredPGO"] = Environment.GetEnvironmentVariable("DOTNET_TieredPGO"),
                ["DOTNET_TC_QuickJitForLoops"] = Environment.GetEnvironmentVariable("DOTNET_TC_QuickJitForLoops") },
            role = "DIAGNOSTIC ONLY; original CI red remains open; no result is selected, subtracted or retried",
            originalSource = "986f44dfd9a61eb769700adc476fc8b9e9aa8011:GarbageTests.PerCall", records };
        WriteNew("summary.json", runtime);
        return 0;
    }

    // Exact original aggregate counter loop from public986; no counter prime/context isolation.
    static double Original(Action<int> body)
    {
        for (int i = 0; i < 200; i++) body(i);
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 200; i < 200 + Iterations; i++) body(i);
        return (GC.GetAllocatedBytesForCurrentThread() - before) / (double)Iterations;
    }

    static void Compare(string name, Action<int> body, int unchangedBudget, Func<Action<int>, double> candidate)
    {
        Aggregate(name, "original", body, unchangedBudget, Original);
        Aggregate(name, "candidate", body, unchangedBudget, candidate);
        Trace(name, "original", body, unchangedBudget, false);
        Trace(name, "candidate", body, unchangedBudget, true);
    }

    static void Aggregate(string name, string setup, Action<int> body, int budget, Func<Action<int>, double> measure)
    {
        int calls = 0, firstThread = 0; bool differentThread = false;
        Action<int> observed = i => {
            int thread = Environment.CurrentManagedThreadId;
            if (firstThread == 0) firstThread = thread;
            if (thread != firstThread) differentThread = true;
            calls++; body(i);
        };
        double bytes = measure(observed);
        if (calls != Warmup + Iterations || differentThread) throw new InvalidOperationException("aggregate call/thread contract");
        Record(new { kind = "aggregate", name, setup, calls, workerThread = firstThread,
            callerThread = Environment.CurrentManagedThreadId, differentThread, bytesPerCall = bytes,
            unchangedBudget = budget, withinUnchangedBudget = bytes <= budget });
        if ((name.EndsWith("-extra-object") || name == "object-every-call" || name == "object-only-measured-index200")
            && bytes <= budget) throw new InvalidOperationException("extra-object control failed to exceed unchanged budget");
        if (setup == "candidate" && firstThread == Environment.CurrentManagedThreadId)
            throw new InvalidOperationException("candidate did not isolate the worker");
    }

    static void Trace(string name, string setup, Action<int> body, int budget, bool dedicated)
    {
        var deltas = new long[Iterations]; var threads = new int[Iterations];
        long total = 0; int warmupThread = 0; bool changedWarmupThread = false;
        ExceptionDispatchInfo failure = null;
        Action trace = () => {
            try {
                if (dedicated) GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < Warmup; i++) {
                    int id = Environment.CurrentManagedThreadId;
                    if (warmupThread == 0) warmupThread = id;
                    if (warmupThread != id) changedWarmupThread = true;
                    body(i);
                }
                long before = GC.GetAllocatedBytesForCurrentThread();
                for (int i = 0; i < Iterations; i++) {
                    long start = GC.GetAllocatedBytesForCurrentThread();
                    body(i + Warmup);
                    deltas[i] = GC.GetAllocatedBytesForCurrentThread() - start;
                    threads[i] = Environment.CurrentManagedThreadId;
                }
                total = GC.GetAllocatedBytesForCurrentThread() - before;
            } catch (Exception error) { failure = ExceptionDispatchInfo.Capture(error); }
        };
        if (dedicated) {
            var worker = new Thread(() => trace());
            if (ExecutionContext.IsFlowSuppressed()) worker.Start();
            else { using (ExecutionContext.SuppressFlow()) worker.Start(); }
            worker.Join();
        } else trace();
        failure?.Throw();
        string file = name + "-" + setup + "-trace.json";
        WriteNew(file, new { name, setup, firstMeasuredIndex = Warmup, deltas, threads });
        Record(new { kind = "per-call-trace", name, setup, warmupThread, changedWarmupThread,
            callerThread = Environment.CurrentManagedThreadId, totalBytes = total,
            bodyCounterDeltaSum = deltas.Sum(), measuredCounterWindowOverhead = total - deltas.Sum(),
            bytesPerCall = total / (double)Iterations, unchangedBudget = budget,
            withinUnchangedBudget = total <= (long)budget * Iterations,
            histogram = deltas.GroupBy(x => x).OrderBy(g => g.Key).Select(g => new { bytes = g.Key, count = g.Count() }),
            threadCounts = threads.GroupBy(x => x).Select(g => new { thread = g.Key, count = g.Count() }), raw = file });
    }

    static void Record(object row) { records.Add(row); Console.WriteLine(JsonSerializer.Serialize(row)); }
    static void WriteNew(string name, object value) {
        using var file = new FileStream(Path.Combine(output, name), FileMode.CreateNew, FileAccess.Write);
        JsonSerializer.Serialize(file, value, Json);
    }
}
