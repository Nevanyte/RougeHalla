using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Probe
{
    public static class Program
    {
        public static Task<int> Main(string[] args) { return Run(args, Console.Out, Console.Error); }

        static string Arg(string[] a, string name, string def)
        {
            int i = Array.IndexOf(a, name);
            return i >= 0 && i + 1 < a.Length ? a[i + 1] : def;
        }

        /// <summary>Exit codes: 0 clean, 1 errors/no welcome, 2 usage, 3 rejected.</summary>
        public static async Task<int> Run(string[] args, TextWriter output, TextWriter log)
        {
            if (args.Contains("--help") || args.Contains("-h"))
            {
                log.WriteLine("usage: probe --url ws://127.0.0.1:7777/ws --profile NAME --token T --seconds 10 [--content-hash U64] [--faction N] [--insecure]");
                return 2;
            }
            string url = Arg(args, "--url", "ws://127.0.0.1:7777/ws");
            double seconds;
            ulong hash;
            if (!double.TryParse(Arg(args, "--seconds", "10"), NumberStyles.Float, CultureInfo.InvariantCulture, out seconds) ||
                !ulong.TryParse(Arg(args, "--content-hash", "0"), out hash)) { log.WriteLine("bad numeric argument"); return 2; }
            byte faction;
            var opts = new SessionOptions
            {
                Url = url, Profile = Arg(args, "--profile", "probe1"), Token = Arg(args, "--token", "t1"), ContentHash = hash,
                Faction = byte.TryParse(Arg(args, "--faction", ""), out faction) ? faction : (byte?)null, Build = "probe-0.1.0",
            };
            var clock = Stopwatch.StartNew();
            opts.Now = () => clock.Elapsed.TotalMilliseconds;

            var transport = new ClientWebSocketTransport(args.Contains("--insecure"));
            var session = new Session(transport, opts);
            var rtts = new List<double>();
            var errors = new List<string>();
            bool result = false;
            session.RttSample += r => rtts.Add(r);
            session.EventsReceived += e => { if (e.List.Any(x => x.Kind == EventKind.Result)) result = true; };
            session.Connect();

            double nextOrder = 500, angle = 0;
            while (clock.Elapsed.TotalSeconds < seconds)
            {
                session.Update();
                if (session.State == SessionState.Rejected || session.State == SessionState.Failed) break;
                if (session.State == SessionState.InMatch && clock.Elapsed.TotalMilliseconds >= nextOrder)
                {
                    nextOrder += 500;
                    angle += Math.PI / 2;
                    var me = session.Latest == null ? null : session.Latest.Me;
                    float cx = me != null ? me.X : 400f, cy = me != null ? me.Y : 400f;
                    session.OrderMove(cx + (float)Math.Cos(angle) * 160f, cy + (float)Math.Sin(angle) * 160f);
                }
                await Task.Delay(5);
            }
            if (session.State == SessionState.InMatch) session.Leave();
            session.Update();
            // The Leave must reach the server before the socket closes: flush, then close after the queued sends.
            await Task.WhenAny(transport.FlushAsync(), Task.Delay(2000));
            await Task.WhenAny(transport.CloseAsync(), Task.Delay(2000));

            var rejects = new List<string>();
            if (session.RejectCode.HasValue)
            {
                rejects.Add(session.RejectCode.Value + ": " + session.RejectReason);
                log.WriteLine("rejected: " + session.RejectCode.Value + " (" + session.RejectReason + ")");
            }
            if (session.Error != null) errors.Add(session.Error);
            if (session.DecodeErrors > 0) errors.Add(session.DecodeErrors + " undecodable server frames");
            bool welcome = session.Welcome != null;
            if (!welcome && rejects.Count == 0 && errors.Count == 0) errors.Add("no welcome");

            rtts.Sort();
            string p50 = rtts.Count == 0 ? "null" : rtts[rtts.Count / 2].ToString("0.###", CultureInfo.InvariantCulture);
            var sb = new StringBuilder();
            sb.Append("{\"welcome\":").Append(welcome ? "true" : "false");
            sb.Append(",\"snapshots\":").Append(session.SnapshotsReceived);
            sb.Append(",\"lastTick\":").Append(session.Latest == null ? 0 : session.Latest.Tick);
            sb.Append(",\"rttMsP50\":").Append(p50);
            sb.Append(",\"rejects\":").Append(JsonList(rejects));
            sb.Append(",\"resultSeen\":").Append(result ? "true" : "false");
            sb.Append(",\"errors\":").Append(JsonList(errors)).Append('}');
            output.WriteLine(sb.ToString());
            return rejects.Count > 0 ? 3 : errors.Count > 0 || !welcome ? 1 : 0;
        }

        static string JsonList(List<string> items)
        {
            var sb = new StringBuilder("[");
            for (int i = 0; i < items.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append('"');
                foreach (char c in items[i])
                {
                    if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                    else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                }
                sb.Append('"');
            }
            return sb.Append(']').ToString();
        }
    }
}
