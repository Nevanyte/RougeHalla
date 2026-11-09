using System;

namespace Roguehalla.Net
{
    public enum AccountSettlementStatus { Unknown, Committed }
    public enum AccountSettlementOutcome { Won, Draw, Died, Mia }

    /// <summary>Canonical raw network-order UUID formatting for Welcome.MatchId.</summary>
    public static class AccountSettlementId
    {
        public static bool TryFormatNetworkBytes(byte[] bytes, out string canonical)
        {
            canonical = null;
            if (bytes == null || bytes.Length != 16) return false;
            char[] chars = new char[36];
            int outIndex = 0;
            for (int i = 0; i < bytes.Length; i++)
            {
                if (i == 4 || i == 6 || i == 8 || i == 10) chars[outIndex++] = '-';
                int value = bytes[i];
                chars[outIndex++] = Hex(value >> 4);
                chars[outIndex++] = Hex(value & 15);
            }
            canonical = new string(chars);
            return true;
        }

        public static bool IsCanonicalLower(string value)
        {
            if (value == null || value.Length != 36) return false;
            for (int i = 0; i < value.Length; i++)
            {
                if (i == 8 || i == 13 || i == 18 || i == 23)
                {
                    if (value[i] != '-') return false;
                }
                else if (!IsLowerHex(value[i])) return false;
            }
            return true;
        }

        static char Hex(int value) => (char)(value < 10 ? '0' + value : 'a' + value - 10);
        static bool IsLowerHex(char value) => value >= '0' && value <= '9' || value >= 'a' && value <= 'f';
    }

    /// <summary>An allowlisted, immutable v1 receipt for one exact owned match ID.</summary>
    public sealed class AccountSettlement
    {
        public const long MaxSafeInteger = 9007199254740991L;

        public int Version => 1;
        public string MatchId { get; }
        public AccountSettlementStatus Status { get; }
        /// <summary>Null means a voided committed result; Status distinguishes it from Unknown.</summary>
        public AccountSettlementOutcome? Outcome { get; }
        /// <summary>Null only when Status is Unknown.</summary>
        public long? GvCredited { get; }

        public AccountSettlement(string matchId, AccountSettlementStatus status,
            AccountSettlementOutcome? outcome = null, long? gvCredited = null)
            : this(1, matchId, status, outcome, gvCredited) { }

        public AccountSettlement(int version, string matchId, AccountSettlementStatus status,
            AccountSettlementOutcome? outcome = null, long? gvCredited = null)
        {
            if (version != 1) throw new ArgumentOutOfRangeException(nameof(version));
            if (!AccountSettlementId.IsCanonicalLower(matchId)) throw new ArgumentException("A canonical lowercase match UUID is required.", nameof(matchId));
            if (status != AccountSettlementStatus.Unknown && status != AccountSettlementStatus.Committed)
                throw new ArgumentOutOfRangeException(nameof(status));
            if (outcome.HasValue && !Enum.IsDefined(typeof(AccountSettlementOutcome), outcome.Value))
                throw new ArgumentOutOfRangeException(nameof(outcome));
            if (status == AccountSettlementStatus.Unknown)
            {
                if (outcome.HasValue || gvCredited.HasValue) throw new ArgumentException("Unknown receipts cannot contain settlement details.");
            }
            else if (!gvCredited.HasValue || gvCredited.Value < 0 || gvCredited.Value > MaxSafeInteger)
                throw new ArgumentOutOfRangeException(nameof(gvCredited), "Committed credit must be a safe nonnegative integer.");

            MatchId = matchId;
            Status = status;
            Outcome = outcome;
            GvCredited = gvCredited;
        }
    }
}
