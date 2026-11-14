using System;
using System.Text;

namespace Roguehalla.Net.Protocol
{
    /// <summary>Wire constants of rh-protocol v17 (crates/rh-protocol/src/lib.rs).</summary>
    public static class Wire
    {
        public const ushort ProtocolVersion = 17;
        /// <summary>Most ticks a snapshot delta's base may be behind it (a writer that skipped more sends a Full snapshot).</summary>
        public const uint MaxDeltaAge = 64;
        /// <summary>Milliseconds per server tick: a snapshot without a source-time override defaults to Tick * TickMs.</summary>
        public const int TickMs = 50;
        /// <summary>Largest faction and weapon (4 bits each in the kit byte), status and phase (2 bits each) a frame can carry.</summary>
        public const int MaxKitCode = 15, MaxStatusCode = 3, MaxPhaseCode = 3;
        /// <summary>The status and phase a clear mask bit stands for: alive, active (0 lobby, 1 alive, 2 dead, 3 mia / 0 lobby, 1 active, 2 ended).</summary>
        public const byte DefaultStatus = 1, DefaultPhase = 1;
        /// <summary>Longest Hello admission ticket; the largest legal Hello is 992 bytes, under <see cref="MaxClientFrame"/>.</summary>
        public const int MaxTicket = 448;
        public const int MaxClientFrame = 1024;
        public const int MaxServerFrame = 256 * 1024;
        public const int MaxCommandsPerInput = 16;
        public const int MaxActors = 512;
        public const int MaxMapTiles = 1024 * 1024;
        public const int MaxMapRuns = 6 * MaxMapTiles;
        /// <summary>Six decodable planes (collision, terrain, regions, bushes, ground variants, patience), one byte per tile.</summary>
        public const int MaxMapPlanes = 6;
        public const int MaxMapDecodedBytes = MaxMapPlanes * MaxMapTiles;
    }

    public enum DecodeError { Truncated, TooLarge, TooMany, BadTag, BadUtf8, NonFinite, Trailing, BadMap, BadVarint, BadField }

    /// <summary>
    /// Quantization of remote actors and swing effects (rh-protocol quant.rs; error bounds are documented there). The SELF view is
    /// never quantized. Position: u16 at 1/8 world unit, 0..65535 (the encoder refuses a position outside 0..8191.875), ties away from zero. Angle: u16 over 2 pi, read
    /// as a two's complement angle in [-pi, pi). Decoding is the same f32 arithmetic as Rust: q / 8 (exact) and the signed code
    /// times <see cref="FacingStepF"/> (one rounding).
    /// </summary>
    public static class Quant
    {
        public const float PosScale = 8f;
        public static readonly double FacingStep = 2.0 * Math.PI / 65536.0;
        public static readonly float FacingStepF = (float)(2.0 * Math.PI / 65536.0);
        const double FacingClamp = 1099511627776.0; // 2^40

        public static ushort QuantizePos(float v)
        {
            double t = Math.Round((double)v * 8.0, MidpointRounding.AwayFromZero);
            if (!(t > 0.0)) return 0; // negative and NaN
            return t >= 65535.0 ? (ushort)65535 : (ushort)t;
        }

        public static float DequantizePos(ushort q) { return q / PosScale; }

        /// <summary>The largest position the grid carries exactly (65535 / 8 u).</summary>
        public const float PosMax = 65535f / PosScale;

        /// <summary>Whether the encoder can carry <paramref name="v"/>: finite and within 0..<see cref="PosMax"/> (rh-protocol
        /// <c>pos_in_range</c>). The encoders refuse anything else instead of saturating it.</summary>
        public static bool PosInRange(float v) { return v >= 0f && v <= PosMax; }

        public static ushort QuantizeFacing(float a)
        {
            double t = (double)a / FacingStep;
            if (double.IsNaN(t) || double.IsInfinity(t)) return 0;
            if (t > FacingClamp) t = FacingClamp; else if (t < -FacingClamp) t = -FacingClamp;
            long q = (long)Math.Round(t, MidpointRounding.AwayFromZero);
            return (ushort)(q & 0xffff);
        }

        public static float DequantizeFacing(ushort q) { return unchecked((short)q) * FacingStepF; }
    }

    public sealed class DecodeException : Exception
    {
        public DecodeError Error { get; }
        public DecodeException(DecodeError error, string detail = null) : base(detail == null ? error.ToString() : error + ": " + detail) { Error = error; }
    }

    /// <summary>A message the wire cannot carry (a string over 255 bytes). The encoder never truncates or repairs.</summary>
    public sealed class EncodeException : Exception
    {
        public EncodeException(string message) : base(message) { }
    }

    /// <summary>Little-endian writer built by hand so the bytes never depend on the host's endianness or on BinaryWriter.</summary>
    public sealed class Writer
    {
        byte[] _buf;
        int _len;

        public Writer() : this(64) { }

        /// <summary>A writer for a frame of <paramref name="capacity"/> bytes: when that is the exact size, the buffer never
        /// grows and <see cref="Finish"/> returns it without a copy.</summary>
        public Writer(int capacity) { _buf = new byte[Math.Max(capacity, 1)]; }

        void Ensure(int n)
        {
            if (_len + n <= _buf.Length) return;
            Array.Resize(ref _buf, Math.Max(_buf.Length * 2, _len + n));
        }

        public void U8(byte v) { Ensure(1); _buf[_len++] = v; }
        public void U16(ushort v) { Ensure(2); _buf[_len++] = (byte)v; _buf[_len++] = (byte)(v >> 8); }
        public void U32(uint v) { Ensure(4); for (int i = 0; i < 4; i++) _buf[_len++] = (byte)(v >> (8 * i)); }

        /// <summary>Canonical unsigned LEB128 (1 to 5 bytes for a u32).</summary>
        public void Varint(uint v)
        {
            Ensure(5);
            while (v >= 0x80) { _buf[_len++] = (byte)(v | 0x80); v >>= 7; }
            _buf[_len++] = (byte)v;
        }

        /// <summary>Encoded size of <see cref="Varint"/>.</summary>
        public static int VarintLength(uint v)
        {
            int n = 1;
            while (v >= 0x80) { n++; v >>= 7; }
            return n;
        }
        public void U64(ulong v) { Ensure(8); for (int i = 0; i < 8; i++) _buf[_len++] = (byte)(v >> (8 * i)); }
        public void F32(float v) { U32(unchecked((uint)BitConverter.SingleToInt32Bits(v))); }
        public void F64(double v) { U64(unchecked((ulong)BitConverter.DoubleToInt64Bits(v))); }
        public void Bytes(byte[] b) { Ensure(b.Length); Buffer.BlockCopy(b, 0, _buf, _len, b.Length); _len += b.Length; }

        /// <summary>u8 length + UTF-8. A string over 255 bytes throws <see cref="EncodeException"/>: it is never cut (the Rust writer refuses too).</summary>
        public void Str(string s)
        {
            byte[] b = Encoding.UTF8.GetBytes(s ?? "");
            if (b.Length > 255) throw new EncodeException("string of " + b.Length + " bytes does not fit the wire (max 255)");
            U8((byte)b.Length);
            Bytes(b);
        }

        /// <summary>u16 length + bytes (an opaque blob such as the admission ticket); over 65535 bytes throws <see cref="EncodeException"/>.</summary>
        public void Blob(byte[] b)
        {
            b = b ?? new byte[0];
            if (b.Length > ushort.MaxValue) throw new EncodeException("blob of " + b.Length + " bytes does not fit the wire");
            U16((ushort)b.Length);
            Bytes(b);
        }

        /// <summary>The frame. Returns the writer's own buffer when it is exactly full (no copy), so do not write after this.</summary>
        public byte[] Finish()
        {
            if (_len == _buf.Length) return _buf;
            var r = new byte[_len];
            Buffer.BlockCopy(_buf, 0, r, 0, _len);
            return r;
        }
    }

    /// <summary>
    /// Bounds-checked reader for untrusted bytes. Throws DecodeException; never reads past <c>length</c>. A stack-only value
    /// (decoding allocates no reader object): keep it in a local and pass it on by <c>ref</c>.
    /// </summary>
    public ref struct Reader
    {
        static readonly UTF8Encoding Strict = new UTF8Encoding(false, true);
        readonly byte[] _buf;
        readonly int _end;
        int _pos;
        /// <summary>Reject NaN and infinities (client frames).</summary>
        public bool FiniteOnly;

        /// <summary>Bytes consumed from this reader's bounded input.</summary>
        public int Position { get { return _pos; } }

        /// <summary>Bytes remaining in this reader's bounded input.</summary>
        public int Remaining { get { return _end - _pos; } }

        public Reader(byte[] buf, int length = -1)
        {
            _buf = buf;
            _end = length < 0 ? buf.Length : length;
            _pos = 0;
            FiniteOnly = false;
        }

        Reader(byte[] buf, int start, int end, bool finiteOnly)
        {
            _buf = buf;
            _end = end;
            _pos = start;
            FiniteOnly = finiteOnly;
        }

        int Take(int n)
        {
            if (n < 0 || n > _end - _pos) throw new DecodeException(DecodeError.Truncated);
            int p = _pos;
            _pos += n;
            return p;
        }

        /// <summary>
        /// Advances this reader by exactly <paramref name="length"/> and returns a reader bounded to those bytes. The child
        /// shares the input buffer and cannot read into a following field or frame.
        /// </summary>
        public Reader TakeReader(int length)
        {
            int start = Take(length);
            return new Reader(_buf, start, start + length, FiniteOnly);
        }

        public byte U8() { return _buf[Take(1)]; }
        public ushort U16() { int p = Take(2); return (ushort)(_buf[p] | (_buf[p + 1] << 8)); }
        public uint U32() { int p = Take(4); return (uint)(_buf[p] | (_buf[p + 1] << 8) | (_buf[p + 2] << 16) | (_buf[p + 3] << 24)); }
        /// <summary>Unsigned LEB128 into a u32; rejects a value past 5 bytes or past u32, and any non-canonical form.</summary>
        public uint Varint()
        {
            uint v = 0;
            for (int i = 0; i < 5; i++)
            {
                byte b = U8();
                uint g = (uint)(b & 0x7f);
                if (i == 4 && g > 0x0f) throw new DecodeException(DecodeError.BadVarint);
                v |= g << (7 * i);
                if ((b & 0x80) == 0)
                {
                    if (i > 0 && g == 0) throw new DecodeException(DecodeError.BadVarint);
                    return v;
                }
            }
            throw new DecodeException(DecodeError.BadVarint);
        }

        /// <summary>A varint that must fit a u16 (kills, bounty, gv, max hp); <paramref name="what"/> names the field in the error.</summary>
        public ushort VarintU16(string what)
        {
            uint v = Varint();
            if (v > ushort.MaxValue) throw new DecodeException(DecodeError.BadField, what);
            return (ushort)v;
        }

        /// <summary>A byte that must be at most <paramref name="max"/> (a status or phase code); <paramref name="what"/> names the field in the error.</summary>
        public byte Code(int max, string what)
        {
            byte v = U8();
            if (v > max) throw new DecodeException(DecodeError.BadField, what);
            return v;
        }

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

        /// <summary>u16 length + bytes, at most <paramref name="max"/> (checked before anything is copied).</summary>
        public byte[] Blob(int max)
        {
            int n = U16();
            if (n > max) throw new DecodeException(DecodeError.TooMany, n.ToString());
            int p = Take(n);
            var r = new byte[n];
            Buffer.BlockCopy(_buf, p, r, 0, n);
            return r;
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
