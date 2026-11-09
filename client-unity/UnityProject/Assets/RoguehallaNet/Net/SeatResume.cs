using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>
    /// A live seat's secret bearer capability and expected identity, not account ownership or a durable game result.
    /// Contains no storage or endpoint policy. Never log or serialize this object; its caller must validate the owned target.
    /// </summary>
    public sealed class SeatResume
    {
        readonly byte[] _capability, _matchId;
        public uint PlayerId { get; }

        public SeatResume(byte[] capability, byte[] matchId, uint playerId)
        {
            if (capability == null) throw new ArgumentNullException(nameof(capability));
            if (matchId == null) throw new ArgumentNullException(nameof(matchId));
            if (capability.Length != 16) throw new ArgumentException("A seat capability must contain 16 bytes.", nameof(capability));
            if (matchId.Length != 16) throw new ArgumentException("A match identity must contain 16 raw bytes.", nameof(matchId));
            if (playerId == 0) throw new ArgumentOutOfRangeException(nameof(playerId), "A player identity must be positive.");
            _capability = (byte[])capability.Clone();
            _matchId = (byte[])matchId.Clone();
            PlayerId = playerId;
        }

        internal byte[] CopyCapability() => (byte[])_capability.Clone();

        internal bool Matches(ServerMsg.Welcome welcome)
        {
            if (welcome.PlayerId != PlayerId || welcome.MatchId == null || welcome.MatchId.Length != 16) return false;
            for (int i = 0; i < 16; i++) if (welcome.MatchId[i] != _matchId[i]) return false;
            return true;
        }
    }
}
