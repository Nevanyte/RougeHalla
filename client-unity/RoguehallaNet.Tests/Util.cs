using System;
using System.IO;
using System.Collections.Generic;
using Roguehalla.Net;

namespace Roguehalla.Net.Tests
{
    static class Util
    {
        public static byte[] FromHex(string h)
        {
            var b = new byte[h.Length / 2];
            for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(h.Substring(i * 2, 2), 16);
            return b;
        }

        public static string ToHex(byte[] b) { return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant(); }

        /// <summary>Walks up from the test assembly to the repo root (the directory holding protocol/fixtures/v2.json).</summary>
        public static string RepoRoot()
        {
            var d = new DirectoryInfo(AppContext.BaseDirectory);
            while (d != null && !File.Exists(Path.Combine(d.FullName, "protocol", "fixtures", "v2.json"))) d = d.Parent;
            if (d == null) throw new FileNotFoundException("protocol/fixtures/v2.json not found above " + AppContext.BaseDirectory);
            return d.FullName;
        }
    }

    sealed class FakeTransport : ITransport
    {
        public event Action Opened;
        public event Action<byte[]> Received;
        public event Action<string> Closed;
        public readonly List<byte[]> Sent = new List<byte[]>();
        public int Connects;
        public string Url;
        public bool CloseCalled;

        public void Connect(string url) { Connects++; Url = url; }
        public void Send(byte[] frame) { Sent.Add(frame); }
        public void Close() { CloseCalled = true; }
        public void Poll() { }
        public void Open() { Opened(); }
        public void Deliver(Protocol.ServerMsg m) { Received(m.Encode()); }
        public void DeliverRaw(byte[] b) { Received(b); }
        public void Drop(string why = "lost") { Closed(why); }
        public T LastSent<T>() where T : Protocol.ClientMsg { return (T)Protocol.ClientMsg.Decode(Sent[Sent.Count - 1]); }
    }
}
