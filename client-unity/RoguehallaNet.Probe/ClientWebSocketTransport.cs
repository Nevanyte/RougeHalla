using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using Roguehalla.Net;

namespace Roguehalla.Probe
{
    /// <summary>ITransport over ClientWebSocket (desktop/Editor/probe only: a browser build uses the jslib bridge). Events fire from Poll().</summary>
    public sealed class ClientWebSocketTransport : ITransport
    {
        readonly bool _insecure;
        readonly ConcurrentQueue<Action> _events = new ConcurrentQueue<Action>();
        ClientWebSocket _ws;
        CancellationTokenSource _cts;
        Task _sendChain = Task.CompletedTask;
        int _generation;

        public event Action Opened;
        public event Action<byte[]> Received;
        public event Action<string> Closed;

        public ClientWebSocketTransport(bool insecure) { _insecure = insecure; }

        public void Connect(string url)
        {
            Close();
            int gen = Interlocked.Increment(ref _generation);
            var ws = new ClientWebSocket();
            if (_insecure) ws.Options.RemoteCertificateValidationCallback = (a, b, c, d) => true; // local self-signed testing only
            var cts = new CancellationTokenSource();
            _ws = ws; _cts = cts; _sendChain = Task.CompletedTask;
            _ = Run(ws, cts.Token, url, gen);
        }

        async Task Run(ClientWebSocket ws, CancellationToken ct, string url, int gen)
        {
            string reason = "closed";
            try
            {
                await ws.ConnectAsync(new Uri(url), ct).ConfigureAwait(false);
                _events.Enqueue(() => { if (gen == _generation && Opened != null) Opened(); });
                var buf = new byte[16 * 1024];
                var ms = new MemoryStream();
                while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
                {
                    var r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct).ConfigureAwait(false);
                    if (r.MessageType == WebSocketMessageType.Close) { reason = "server closed: " + r.CloseStatus + " " + r.CloseStatusDescription; break; }
                    if (r.MessageType != WebSocketMessageType.Binary) { reason = "text frame received"; break; }
                    ms.Write(buf, 0, r.Count);
                    if (!r.EndOfMessage) continue;
                    byte[] frame = ms.ToArray();
                    ms.SetLength(0);
                    _events.Enqueue(() => { if (gen == _generation && Received != null) Received(frame); });
                }
            }
            catch (Exception e) { reason = e.GetType().Name + ": " + e.Message; }
            _events.Enqueue(() => { if (gen == _generation && Closed != null) Closed(reason); });
        }

        public void Send(byte[] frame)
        {
            var ws = _ws;
            if (ws == null || ws.State != WebSocketState.Open) return;
            // One SendAsync at a time; chain them so frames keep their order.
            _sendChain = _sendChain.ContinueWith(_ => ws.State == WebSocketState.Open
                ? ws.SendAsync(new ArraySegment<byte>(frame), WebSocketMessageType.Binary, true, CancellationToken.None)
                : Task.CompletedTask, TaskScheduler.Default).Unwrap();
        }

        /// <summary>Completes when every frame queued so far has been handed to the socket (e.g. a Leave before Close).</summary>
        public Task FlushAsync() => _sendChain;

        public void Close() { _ = CloseAsync(); }

        /// <summary>Closes after the queued sends: a close frame must not overtake (or run concurrently with) a pending send.</summary>
        public Task CloseAsync()
        {
            var ws = _ws; var cts = _cts; var chain = _sendChain;
            _ws = null; _cts = null;
            if (ws == null) return Task.CompletedTask;
            Interlocked.Increment(ref _generation); // late events of this socket are dropped
            return Task.Run(async () =>
            {
                try { await chain.ConfigureAwait(false); } catch { }
                try { await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None).ConfigureAwait(false); } catch { }
                try { cts.Cancel(); ws.Dispose(); } catch { }
            });
        }

        public void Poll()
        {
            while (_events.TryDequeue(out var a)) a();
        }
    }
}
