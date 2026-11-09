using System;

namespace Roguehalla.Net
{
    public enum OwnedSeatMode { Arena, Training }
    public enum SeatCheckpointReadStatus { Ready, Missing, Invalid, Mismatch, Unavailable }
    public enum SeatCheckpointWriteStatus { Saved, Unsaved, Unavailable, Invalid }
    public enum SeatCheckpointClearStatus { Cleared, Missing, Changed, Unavailable, Unsaved, Invalid }

    /// <summary>One tab-local slot. Implementations must compare and remove atomically, never split that operation across callbacks.</summary>
    public interface IOwnedSeatCheckpointStorage
    {
        SeatCheckpointReadStatus Read(out string canonicalRecord);
        SeatCheckpointWriteStatus Write(string canonicalRecord);
        SeatCheckpointClearStatus CompareAndClear(string expectedCanonicalRecord);
    }

    /// <summary>
    /// Current caller expectations, never populated from saved data. The caller must establish and recheck current
    /// account/generation ownership and the authoritative mode. This object does not authenticate or retain the account bearer.
    /// </summary>
    public sealed class OwnedSeatCheckpointContext
    {
        public string AccountScope { get; }
        public string Callsign { get; }
        public string MatchUrl { get; }
        public OwnedSeatMode Mode { get; }
        public ushort Protocol { get; }
        public ulong ContentHash { get; }

        public OwnedSeatCheckpointContext(OwnedAccount confirmedAccount, AccountEndpoint endpoint, string configuredMatchUrl,
            OwnedSeatMode mode, ushort protocol, ulong contentHash)
        {
            if (confirmedAccount == null) throw new ArgumentNullException(nameof(confirmedAccount));
            if (endpoint == null) throw new ArgumentNullException(nameof(endpoint));
            if (!OwnedSeatCheckpointCodec.ValidRoute(endpoint.StorageScope, configuredMatchUrl) ||
                mode != OwnedSeatMode.Arena && mode != OwnedSeatMode.Training || protocol == 0 || contentHash == 0)
                throw new ArgumentException("Invalid current checkpoint expectations.");
            AccountScope = endpoint.StorageScope;
            Callsign = AccountEndpoint.NormalizeName(confirmedAccount.CanonicalName);
            MatchUrl = configuredMatchUrl; Mode = mode; Protocol = protocol; ContentHash = contentHash;
        }

        internal bool Matches(OwnedSeatCheckpoint record) => record.AccountScope == AccountScope && record.Callsign == Callsign &&
            record.MatchUrl == MatchUrl && record.Mode == Mode && record.Protocol == Protocol && record.ContentHash == ContentHash;
    }

    /// <summary>Contains a secret seat capability. Never log/serialize this object. Metadata is not cryptographic ownership.</summary>
    public sealed class OwnedSeatCheckpoint
    {
        readonly byte[] _capability, _matchId;
        internal string CanonicalRecord;
        public string AccountScope { get; }
        public string Callsign { get; }
        public string MatchUrl { get; }
        public OwnedSeatMode Mode { get; }
        public ushort Protocol { get; }
        public ulong ContentHash { get; }
        public string Revision { get; }
        public uint PlayerId { get; }

        internal OwnedSeatCheckpoint(string scope, string name, string url, OwnedSeatMode mode, ushort protocol, ulong content,
            byte[] capability, byte[] match, uint player, string revision)
        {
            AccountScope = scope; Callsign = name; MatchUrl = url; Mode = mode; Protocol = protocol; ContentHash = content;
            _capability = (byte[])capability.Clone(); _matchId = (byte[])match.Clone(); PlayerId = player; Revision = revision;
        }

        public byte[] CopyMatchId() => (byte[])_matchId.Clone();
        public SeatResume CreateSeed() => new SeatResume(_capability, _matchId, PlayerId);
        internal byte[] CopyCapability() => (byte[])_capability.Clone();
    }

    public sealed class SeatCheckpointReadResult
    {
        public SeatCheckpointReadStatus Status { get; }
        public OwnedSeatCheckpoint Record { get; }
        internal SeatCheckpointReadResult(SeatCheckpointReadStatus status, OwnedSeatCheckpoint record = null)
        { Status = status; Record = record; }
    }

    public sealed class SeatCheckpointWriteResult
    {
        public SeatCheckpointWriteStatus Status { get; }
        public OwnedSeatCheckpoint Record { get; }
        internal SeatCheckpointWriteResult(SeatCheckpointWriteStatus status, OwnedSeatCheckpoint record = null)
        { Status = status; Record = record; }
    }

    /// <summary>No joins, credentials, results or fallback storage. A saved URL is only compared, never used as a destination.</summary>
    public sealed class OwnedSeatCheckpointStore
    {
        public const int MaxRecordChars = 8192;
        public const int MaxAddressChars = 2048;
        readonly IOwnedSeatCheckpointStorage _storage;
        public OwnedSeatCheckpointStore(IOwnedSeatCheckpointStorage storage)
        { _storage = storage ?? throw new ArgumentNullException(nameof(storage)); }

        public SeatCheckpointReadResult Read(OwnedSeatCheckpointContext current)
        {
            if (current == null) return new SeatCheckpointReadResult(SeatCheckpointReadStatus.Mismatch);
            try
            {
                var status = _storage.Read(out string text);
                if (status == SeatCheckpointReadStatus.Missing || status == SeatCheckpointReadStatus.Unavailable || status == SeatCheckpointReadStatus.Invalid)
                    return new SeatCheckpointReadResult(status);
                if (status != SeatCheckpointReadStatus.Ready) return new SeatCheckpointReadResult(SeatCheckpointReadStatus.Unavailable);
                if (!OwnedSeatCheckpointCodec.TryDecode(text, out var record)) return new SeatCheckpointReadResult(SeatCheckpointReadStatus.Invalid);
                return current.Matches(record) ? new SeatCheckpointReadResult(SeatCheckpointReadStatus.Ready, record)
                    : new SeatCheckpointReadResult(SeatCheckpointReadStatus.Mismatch);
            }
            catch { return new SeatCheckpointReadResult(SeatCheckpointReadStatus.Unavailable); }
        }

        /// <summary>Caller supplies a delivered, currently owned and mode-confirmed seat. Saved requires exact readback.</summary>
        public SeatCheckpointWriteResult Save(OwnedSeatCheckpointContext current, byte[] capability, byte[] rawMatchId, uint playerId)
        {
            if (current == null || capability == null || capability.Length != 16 || rawMatchId == null || rawMatchId.Length != 16 || playerId == 0)
                return new SeatCheckpointWriteResult(SeatCheckpointWriteStatus.Invalid);
            try
            {
                var record = new OwnedSeatCheckpoint(current.AccountScope, current.Callsign, current.MatchUrl, current.Mode,
                    current.Protocol, current.ContentHash, capability, rawMatchId, playerId, Guid.NewGuid().ToString("N"));
                string text = OwnedSeatCheckpointCodec.Encode(record);
                if (text.Length > MaxRecordChars) return new SeatCheckpointWriteResult(SeatCheckpointWriteStatus.Invalid);
                record.CanonicalRecord = text;
                var status = _storage.Write(text);
                if (status != SeatCheckpointWriteStatus.Saved)
                    return new SeatCheckpointWriteResult(status == SeatCheckpointWriteStatus.Unavailable || status == SeatCheckpointWriteStatus.Invalid
                        ? status : SeatCheckpointWriteStatus.Unsaved);
                if (_storage.Read(out string actual) != SeatCheckpointReadStatus.Ready || !string.Equals(text, actual, StringComparison.Ordinal))
                    return new SeatCheckpointWriteResult(SeatCheckpointWriteStatus.Unsaved);
                return new SeatCheckpointWriteResult(SeatCheckpointWriteStatus.Saved, record);
            }
            catch { return new SeatCheckpointWriteResult(SeatCheckpointWriteStatus.Unsaved); }
        }

        /// <summary>An old completion can clear only the exact record it captured; a newer revision remains untouched.</summary>
        public SeatCheckpointClearStatus Clear(OwnedSeatCheckpoint captured)
        {
            if (captured?.CanonicalRecord == null) return SeatCheckpointClearStatus.Invalid;
            try
            {
                var status = _storage.CompareAndClear(captured.CanonicalRecord);
                return (int)status >= (int)SeatCheckpointClearStatus.Cleared && (int)status <= (int)SeatCheckpointClearStatus.Invalid
                    ? status : SeatCheckpointClearStatus.Unsaved;
            }
            catch { return SeatCheckpointClearStatus.Unsaved; }
        }
    }
}
