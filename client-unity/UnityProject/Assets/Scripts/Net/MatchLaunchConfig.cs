using System;

namespace Roguehalla.Net
{
    public enum MatchLaunchMode { Arena, Training }

    /// <summary>A typed configured destination. Availability is independent per mode; URL strings are never included in errors.</summary>
    public sealed class MatchLaunchTarget
    {
        public MatchLaunchMode Mode { get; }
        public string Url { get; }
        public bool Available { get; }
        public string UnavailableReason { get; }

        internal MatchLaunchTarget(MatchLaunchMode mode, string url, bool available, string unavailableReason)
        {
            Mode = mode;
            Url = url ?? string.Empty;
            Available = available && !string.IsNullOrWhiteSpace(Url);
            UnavailableReason = Available ? string.Empty :
                string.IsNullOrWhiteSpace(unavailableReason) ? "This launch target is unavailable." : unavailableReason;
        }

        /// <summary>Only an actual server fact can confirm a target; a missing snapshot is never treated as Arena.</summary>
        public bool MatchesServer(bool? training)
        {
            if (!Available || !training.HasValue) return false;
            if (Mode == MatchLaunchMode.Arena) return !training.Value;
            if (Mode == MatchLaunchMode.Training) return training.Value;
            return false;
        }
    }

    /// <summary>Validates operator-provided destinations against the fixed account API origin.</summary>
    public sealed class MatchLaunchConfig
    {
        readonly MatchLaunchTarget _arena;
        readonly MatchLaunchTarget _training;

        public MatchLaunchConfig(AccountEndpoint endpoint, string arenaUrl, string trainingUrl)
        {
            _arena = CreateTarget(endpoint, MatchLaunchMode.Arena, arenaUrl);
            _training = CreateTarget(endpoint, MatchLaunchMode.Training, trainingUrl);
        }

        public MatchLaunchTarget Target(MatchLaunchMode mode)
        {
            if (mode == MatchLaunchMode.Arena) return _arena;
            if (mode == MatchLaunchMode.Training) return _training;
            return new MatchLaunchTarget(mode, string.Empty, false, "This launch mode is unavailable.");
        }

        static MatchLaunchTarget CreateTarget(AccountEndpoint endpoint, MatchLaunchMode mode, string url)
        {
            string label = mode == MatchLaunchMode.Training ? "Training" : "Arena";
            string unavailable = label + " is unavailable for this connection.";
            if (string.IsNullOrWhiteSpace(url) || endpoint == null ||
                AccountConnectionPolicy.CheckOwnedTarget(endpoint, url) != AccountConnectionFailure.None)
                return new MatchLaunchTarget(mode, string.Empty, false, unavailable);

            return new MatchLaunchTarget(mode, url, true, string.Empty);
        }
    }
}
