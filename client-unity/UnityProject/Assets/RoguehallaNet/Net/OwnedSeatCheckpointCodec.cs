using System;
using System.Globalization;
using System.Text;

namespace Roguehalla.Net
{
    // Local canonical record, not a network protocol. Fixed ordered fields reject duplicates/unknown fields by construction.
    internal static class OwnedSeatCheckpointCodec
    {
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        static readonly string[] Keys = { "version", "scope", "name", "url", "mode", "protocol", "content", "match", "player", "capability", "revision" };
        static string Number(ulong value) => value.ToString(CultureInfo.InvariantCulture);
        static string Text(string value) => Convert.ToBase64String(Utf8.GetBytes(value));
        static string FromText(string value)
        {
            var bytes = Convert.FromBase64String(value);
            string text = Utf8.GetString(bytes);
            if (Text(text) != value) throw new FormatException();
            return text;
        }
        static string Hex(byte[] bytes)
        {
            var chars = new char[bytes.Length * 2]; const string digits = "0123456789abcdef";
            for (int i = 0; i < bytes.Length; i++) { chars[i*2] = digits[bytes[i] >> 4]; chars[i*2+1] = digits[bytes[i] & 15]; }
            return new string(chars);
        }
        static int Digit(char c) => c >= '0' && c <= '9' ? c-'0' : c >= 'a' && c <= 'f' ? c-'a'+10 : -1;
        static byte[] FromHex(string text)
        {
            if (text.Length != 32) throw new FormatException();
            var bytes = new byte[16];
            for (int i = 0; i < 16; i++)
            {
                int a = Digit(text[i*2]), b = Digit(text[i*2+1]);
                if (a < 0 || b < 0) throw new FormatException();
                bytes[i] = (byte)((a << 4) | b);
            }
            return bytes;
        }

        internal static bool ValidRoute(string scope, string url)
        {
            if (scope == null || url == null || scope.Length > OwnedSeatCheckpointStore.MaxAddressChars || url.Length > OwnedSeatCheckpointStore.MaxAddressChars) return false;
            foreach (char c in scope) if (char.IsControl(c) || char.IsWhiteSpace(c)) return false;
            foreach (char c in url) if (char.IsControl(c) || char.IsWhiteSpace(c)) return false;
            try
            {
                var endpoint = AccountEndpoint.FromPage(null, scope);
                return endpoint.StorageScope == scope && Uri.TryCreate(url, UriKind.Absolute, out var match) && match.IsWellFormedOriginalString() &&
                    AccountConnectionPolicy.CheckOwnedTarget(endpoint, url) == AccountConnectionFailure.None;
            }
            catch (ArgumentException) { return false; }
        }

        internal static string Encode(OwnedSeatCheckpoint r) =>
            "version=1\nscope=" + Text(r.AccountScope) + "\nname=" + r.Callsign + "\nurl=" + Text(r.MatchUrl) +
            "\nmode=" + (r.Mode == OwnedSeatMode.Arena ? "arena" : "training") + "\nprotocol=" + Number(r.Protocol) +
            "\ncontent=" + r.ContentHash.ToString("x16", CultureInfo.InvariantCulture) + "\nmatch=" + Hex(r.CopyMatchId()) +
            "\nplayer=" + Number(r.PlayerId) + "\ncapability=" + Hex(r.CopyCapability()) + "\nrevision=" + r.Revision + "\n";

        internal static bool TryDecode(string text, out OwnedSeatCheckpoint record)
        {
            record = null;
            if (text == null || text.Length == 0 || text.Length > OwnedSeatCheckpointStore.MaxRecordChars) return false;
            try
            {
                var lines = text.Split('\n');
                if (lines.Length != Keys.Length+1 || lines[Keys.Length] != "") return false;
                var values = new string[Keys.Length];
                for (int i = 0; i < Keys.Length; i++)
                {
                    string prefix = Keys[i] + "=";
                    if (!lines[i].StartsWith(prefix, StringComparison.Ordinal)) return false;
                    values[i] = lines[i].Substring(prefix.Length);
                }
                if (values[0] != "1") return false;
                string scope = FromText(values[1]), name = values[2], url = FromText(values[3]);
                if (!ValidRoute(scope, url) || AccountEndpoint.NormalizeName(name) != name) return false;
                OwnedSeatMode mode;
                if (values[4] == "arena") mode = OwnedSeatMode.Arena;
                else if (values[4] == "training") mode = OwnedSeatMode.Training;
                else return false;
                if (!ushort.TryParse(values[5], NumberStyles.None, CultureInfo.InvariantCulture, out ushort protocol) || protocol == 0 || Number(protocol) != values[5]) return false;
                if (values[6].Length != 16 || !ulong.TryParse(values[6], NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out ulong content) ||
                    content == 0 || content.ToString("x16", CultureInfo.InvariantCulture) != values[6]) return false;
                var match = FromHex(values[7]);
                if (!uint.TryParse(values[8], NumberStyles.None, CultureInfo.InvariantCulture, out uint player) || player == 0 || Number(player) != values[8]) return false;
                var capability = FromHex(values[9]);
                if (!Guid.TryParseExact(values[10], "N", out var revision) || revision == Guid.Empty || revision.ToString("N") != values[10]) return false;
                var parsed = new OwnedSeatCheckpoint(scope, name, url, mode, protocol, content, capability, match, player, values[10]);
                if (Encode(parsed) != text) return false;
                parsed.CanonicalRecord = text; record = parsed; return true;
            }
            catch (ArgumentException) { return false; }
            catch (FormatException) { return false; }
        }
    }
}
