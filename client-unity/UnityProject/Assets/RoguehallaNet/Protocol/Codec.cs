using System;
using System.Text;

namespace Roguehalla.Net.Protocol
{
    /// <summary>Wire constants of rh-protocol v1 (crates/rh-protocol/src/lib.rs).</summary>
    public static class Wire
    {
        public const ushort ProtocolVersion = 1;
        public const int MaxClientFrame = 1024;
        public const int MaxServerFrame = 256 * 1024;
        public const int MaxCommandsPerInput = 16;
        public const int MaxActors = 512;
        public const int MaxMapTiles = 1024 * 1024;
    }

    public enum DecodeError { Truncated, TooLarge, TooMany, BadTag, BadUtf8, NonFinite, Trailing, BadMap }

    public sealed class DecodeException : Exception
    {
        public DecodeError Error { get; }
        public DecodeException(DecodeError error, string detail = null) : base(detail == null ? error.ToString() : error + ": " + detail) { Error = error; }
    }

    /// <summary>Little-endian writer built by hand so the bytes never depend on the host's endianness or on BinaryWriter.</summary>
    public sealed class Writer
    {
        byte[] _buf = new byte[64];
        int _len;

        void Ensure(int n)
        {
            if (_len + n <= _buf.Length) return;
            Array.Resize(ref _buf, Math.Max(_buf.Length * 2, _len + n));
        }

        public void U8(byte v) { Ensure(1); _buf[_len++] = v; }
        public void U16(ushort v) { Ensure(2); _buf[_len++] = (byte)v; _buf[_len++] = (byte)(v >> 8); }
        public void U32(uint v) { Ensure(4); for (int i = 0; i < 4; i++) _buf[_len++] = (byte)(v >> (8 * i)); }
        public void U64(ulong v) { Ensure(8); for (int i = 0; i < 8; i++) _buf[_len++] = (byte)(v >> (8 * i)); }
        public void F32(float v) { U32(unchecked((uint)BitConverter.SingleToInt32Bits(v))); }
        public void F64(double v) { U64(unchecked((ulong)BitConverter.DoubleToInt64Bits(v))); }
        public void Bytes(byte[] b) { Ensure(b.Length); Buffer.BlockCopy(b, 0, _buf, _len, b.Length); _len += b.Length; }

        /// <summary>u8 length + UTF-8; longer strings are cut at a character boundary to at most 255 bytes, as the Rust writer does.</summary>
        public void Str(string s)
        {
            byte[] b = Encoding.UTF8.GetBytes(s ?? "");
            int end = Math.Min(b.Length, 255);
            while (end > 0 && end < b.Length && (b[end] & 0xC0) == 0x80) end--;
            U8((byte)end);
            Ensure(end);
            Buffer.BlockCopy(b, 0, _buf, _len, end);
            _len += end;
        }

        public byte[] Finish()
        {
            var r = new byte[_len];
            Buffer.BlockCopy(_buf, 0, r, 0, _len);
            return r;
        }
    }

    /// <summary>Bounds-checked reader for untrusted bytes. Throws DecodeException; never reads past <c>length</c>.</summary>
    public sealed class Reader
    {
        static readonly UTF8Encoding Strict = new UTF8Encoding(false, true);
        readonly byte[] _buf;
        readonly int _end;
        int _pos;
        /// <summary>Reject NaN and infinities (client frames).</summary>
        public bool FiniteOnly;

        public Reader(byte[] buf, int length = -1)
        {
            _buf = buf;
            _end = length < 0 ? buf.Length : length;
        }

        int Take(int n)
        {
            if (n < 0 || n > _end - _pos) throw new DecodeException(DecodeError.Truncated);
            int p = _pos;
            _pos += n;
            return p;
        }

        public byte U8() { return _buf[Take(1)]; }
        public ushort U16() { int p = Take(2); return (ushort)(_buf[p] | (_buf[p + 1] << 8)); }
        public uint U32() { int p = Take(4); return (uint)(_buf[p] | (_buf[p + 1] << 8) | (_buf[p + 2] << 16) | (_buf[p + 3] << 24)); }
        public ulong U64() { int p = Take(8); ulong v = 0; for (int i = 7; i >= 0; i--) v = (v << 8) | _buf[p + i]; return v; }

        public float F32()
        {
            float v = BitConverter.Int32BitsToSingle(unchecked((int)U32()));
            if (FiniteOnly && (float.IsNaN(v) || float.IsInfinity(v))) throw new DecodeException(DecodeError.NonFinite);
            return v;
        }

        public double F64()
        {
            double v = BitConverter.Int64BitsToDouble(unchecked((long)U64()));
            if (FiniteOnly && (double.IsNaN(v) || double.IsInfinity(v))) throw new DecodeException(DecodeError.NonFinite);
            return v;
        }

        public byte[] Array16() { int p = Take(16); var r = new byte[16]; Buffer.BlockCopy(_buf, p, r, 0, 16); return r; }

        public string Str()
        {
            int n = U8();
            int p = Take(n);
            try { return Strict.GetString(_buf, p, n); }
            catch (ArgumentException) { throw new DecodeException(DecodeError.BadUtf8); }
        }

        /// <summary>Option flag: 0 absent, 1 present, anything else is an error.</summary>
        public bool Flag()
        {
            byte f = U8();
            if (f > 1) throw new DecodeException(DecodeError.BadTag, "option flag " + f);
            return f == 1;
        }

        public void End()
        {
            if (_pos != _end) throw new DecodeException(DecodeError.Trailing, (_end - _pos) + " bytes");
        }
    }
}
