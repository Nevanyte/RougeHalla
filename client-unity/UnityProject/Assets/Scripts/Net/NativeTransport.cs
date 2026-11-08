// NOT COMPILED in Stage 1 (no Unity). Editor / desktop transport over System.Net.WebSockets. Excluded from WebGL players, where
// ClientWebSocket does not work: WebGLTransport (browser WebSocket via the jslib) is used there.
#if !(UNITY_WEBGL && !UNITY_EDITOR)
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using Roguehalla.Net;

namespace Roguehalla.Client
{
    public sealed class NativeTransport : ITransport
    {
        readonly ConcurrentQueue<Action> _events = new ConcurrentQueue<Action>();
        ClientWebSocket _ws;
        CancellationTokenSource _cts;
        Task _sendChain = Task.CompletedTask;
        int _generation;

        public event Action Opened;
        public event Action<byte[]> Received;
        public event Action<string> Closed;

        public void Connect(string url)
        {
            Close();
            int gen = Interlocked.Increment(ref _generation);
            var ws = new ClientWebSocket();
            var cts = new CancellationTokenSource();
            _ws = ws; _cts = cts; _sendChain = Task.CompletedTask;
            Run(ws, cts.Token, url, gen);
        }

        async void Run(ClientWebSocket ws, CancellationToken ct, string url, int gen)
        {
            string reason = "closed";
            try
            {
                await ws.ConnectAsync(new Uri(url), ct);
                _events.Enqueue(() => { if (gen == _generation && Opened != null) Opened(); });
                var buf = new byte[16 * 1024];
                var ms = new MemoryStream();
                while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
                {
                    var r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                    if (r.MessageType == WebSocketMessageType.Close) { reason = "server closed: " + r.CloseStatus; break; }
                    if (r.MessageType != WebSocketMessageType.Binary) { reason = "text frame received"; break; }
                    ms.Write(buf, 0, r.Count);
                    if (!r.EndOfMessage) continue;
                    byte[] frame = ms.ToArray();
                    ms.SetLength(0);
                    _events.Enqueue(() =>
                    {
                        if (gen != _generation || Received == null) return;
                        // Capture the FX receive boundary before Session and presentation subscribers run.
                        LatencyTrace.NativeFxReceived(frame);
                        Received(frame);
                    });
                }
            }
            catch (Exception e) { reason = e.GetType().Name + ": " + e.Message; }
            _events.Enqueue(() => { if (gen == _generation && Closed != null) Closed(reason); });
        }

        public void Send(byte[] frame)
        {
            var ws = _ws;
            if (ws == null || ws.State != WebSocketState.Open) return;
            _sendChain = _sendChain.ContinueWith(_ => ws.State == WebSocketState.Open
                ? ws.SendAsync(new ArraySegment<byte>(frame), WebSocketMessageType.Binary, true, CancellationToken.None)
                : Task.CompletedTask, TaskScheduler.Default).Unwrap();
            // This marks only the encoded input queued on the open native transport. It is not proof of a completed socket write.
            LatencyTrace.NativeInputQueued(frame);
        }

        public void Close()
        {
            var ws = _ws; var cts = _cts;
            _ws = null; _cts = null;
            if (ws == null) return;
            Interlocked.Increment(ref _generation);
            Task.Run(async () =>
            {
                try { await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None); } catch { }
                try { cts.Cancel(); ws.Dispose(); } catch { }
            });
        }

        public void Poll()
        {
            Action a;
            while (_events.TryDequeue(out a)) a();
        }
    }
}
#endif
