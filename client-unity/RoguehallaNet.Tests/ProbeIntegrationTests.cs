using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net.Tests
{
    /// <summary>Runs the real probe (ClientWebSocket) against a tiny in-process WebSocket server that speaks rh-protocol v1.</summary>
    public class ProbeIntegrationTests
    {
        static int FreePort() { var l = new TcpListener(IPAddress.Loopback, 0); l.Start(); int p = ((IPEndPoint)l.LocalEndpoint).Port; l.Stop(); return p; }

        static async Task Serve(HttpListener http, bool reject, CancellationToken ct, Action<ClientMsg> onMsg)
        {
            var ctx = await http.GetContextAsync();
            var ws = (await ctx.AcceptWebSocketAsync(null)).WebSocket;
            var buf = new byte[4096];
            async Task Send(ServerMsg m) { await ws.SendAsync(new ArraySegment<byte>(m.Encode()), WebSocketMessageType.Binary, true, ct); }
            async Task<ClientMsg> Recv()
            {
                var r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                if (r.MessageType == WebSocketMessageType.Close) return null;
                var frame = new byte[r.Count]; Array.Copy(buf, frame, r.Count);
                return ClientMsg.Decode(frame);
            }
            var hello = await Recv() as ClientMsg.Hello;
            onMsg(hello);
            if (reject) { await Send(new ServerMsg.Reject { Code = RejectCode.ContentMismatch, Reason = "server content hash 1234" }); return; }
            var map = new MapBlob(8, 8, new byte[64]);
            await Send(new ServerMsg.Welcome { Protocol = 1, MatchId = new byte[16], Session = new byte[16], PlayerId = 1, TickRate = 20, Tick = 1, ServerMs = 50, Map = map });
            uint tick = 1;
            var recvTask = Recv();
            while (!ct.IsCancellationRequested)
            {
                if (recvTask.IsCompleted)
                {
                    var m = await recvTask;
                    if (m == null || m is ClientMsg.Leave) { onMsg(m); break; }
                    onMsg(m);
                    if (m is ClientMsg.Ping p) await Send(new ServerMsg.Pong { Nonce = p.Nonce, ClientMs = p.ClientMs, ServerMs = tick * 50.0 });
                    recvTask = Recv();
                }
                tick++;
                await Send(new ServerMsg.Snapshot { Tick = tick, ServerMs = tick * 50.0, Me = new WireSelf { Id = 1, X = 100, Y = 100, Hp = 50, MaxHp = 50 } });
                await Task.Delay(50, ct);
            }
        }

        [Test]
        public async Task ProbeRunsACleanSessionAndPrintsASummary()
        {
            int port = FreePort();
            var http = new HttpListener(); http.Prefixes.Add($"http://127.0.0.1:{port}/ws/"); http.Start();
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            int moves = 0, pings = 0; bool left = false; ClientMsg.Hello hello = null;
            var server = Serve(http, false, cts.Token, m => { if (m is ClientMsg.Hello h) hello = h; if (m is ClientMsg.Ping) pings++; if (m is ClientMsg.Input i) moves += i.Commands.Count; if (m is ClientMsg.Leave) left = true; });
            var o = new StringWriter();
            int code = await Roguehalla.Probe.Program.Run(new[] { "--url", $"ws://127.0.0.1:{port}/ws", "--profile", "probe1", "--token", "t1", "--seconds", "2.3" }, o, TextWriter.Null);
            // Let the fake server finish reading (it polls every 50 ms) before asserting what it received.
            await Task.WhenAny(server, Task.Delay(3000));
            http.Stop();
            string json = o.ToString().Trim();
            TestContext.Out.WriteLine(json);
            Assert.AreEqual(0, code, json);
            StringAssert.Contains("\"welcome\":true", json);
            StringAssert.Contains("\"rejects\":[]", json);
            StringAssert.Contains("\"errors\":[]", json);
            Assert.AreEqual("probe1", hello.Profile); Assert.AreEqual("t1", hello.Token); Assert.AreEqual(0UL, hello.ContentHash);
            Assert.GreaterOrEqual(pings, 2); Assert.GreaterOrEqual(moves, 3); Assert.IsTrue(left);
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            Assert.Greater(doc.RootElement.GetProperty("snapshots").GetInt32(), 20);
            Assert.Greater(doc.RootElement.GetProperty("rttMsP50").GetDouble(), -1);
        }

        [Test]
        public async Task ProbeReportsAContentMismatchReject()
        {
            int port = FreePort();
            var http = new HttpListener(); http.Prefixes.Add($"http://127.0.0.1:{port}/ws/"); http.Start();
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var server = Serve(http, true, cts.Token, _ => { });
            var o = new StringWriter(); var log = new StringWriter();
            int code = await Roguehalla.Probe.Program.Run(new[] { "--url", $"ws://127.0.0.1:{port}/ws", "--seconds", "5" }, o, log);
            http.Stop();
            Assert.AreEqual(3, code);
            StringAssert.Contains("ContentMismatch", o.ToString());
            StringAssert.Contains("server content hash 1234", log.ToString());
        }
    }
}

namespace Roguehalla.Net.Tests
{
    /// <summary>The Unity project carries a copy of the library sources (sync-net.sh); fail when it drifts.</summary>
    public class UnitySyncTests
    {
        [Test]
        public void UnityCopyOfTheLibraryIsUpToDate()
        {
            string root = System.IO.Path.Combine(Util.RepoRoot(), "client-unity");
            string src = System.IO.Path.Combine(root, "RoguehallaNet"), dst = System.IO.Path.Combine(root, "UnityProject", "Assets", "RoguehallaNet");
            System.Collections.Generic.IEnumerable<string> Rel(string dir) => System.Linq.Enumerable.OrderBy(
                System.Linq.Enumerable.Select(System.Linq.Enumerable.Where(System.IO.Directory.GetFiles(dir, "*.cs", System.IO.SearchOption.AllDirectories), f => !f.Contains("/obj/") && !f.Contains("/bin/")),
                    f => System.IO.Path.GetRelativePath(dir, f)), x => x, System.StringComparer.Ordinal);
            CollectionAssert.AreEqual(Rel(src), Rel(dst), "file lists differ: run client-unity/sync-net.sh");
            foreach (var f in Rel(src)) CollectionAssert.AreEqual(System.IO.File.ReadAllBytes(System.IO.Path.Combine(src, f)), System.IO.File.ReadAllBytes(System.IO.Path.Combine(dst, f)), "out of date: " + f + " (run client-unity/sync-net.sh)");
        }
    }
}
