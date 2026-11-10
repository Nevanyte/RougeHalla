using System;

namespace Roguehalla.Net
{
    public enum MatchLaunchMode { Arena, Training }

    /// <summary>
    /// Why a destination is unavailable, for player-facing wording only. It mirrors the policy's own verdict and never feeds a decision:
    /// availability is still decided solely by <see cref="MatchLaunchTarget.Available"/>.
    /// </summary>
    public enum LaunchUnavailableKind { None, NotConfigured, NoAccountService, BadAddress, OtherSite }

    /// <summary>A typed configured destination. Availability is independent per mode; URL strings are never included in errors.</summary>
    public sealed class MatchLaunchTarget
    {
        public MatchLaunchMode Mode { get; }
        public string Url { get; }
        public bool Available { get; }
        public string UnavailableReason { get; }
        /// <summary>UI-facing: which part of the policy refused this destination (None when it is available).</summary>
        public LaunchUnavailableKind Kind { get; }

        internal MatchLaunchTarget(MatchLaunchMode mode, string url, bool available, string unavailableReason,
            LaunchUnavailableKind kind = LaunchUnavailableKind.NotConfigured)
        {
            Mode = mode;
            Url = url ?? string.Empty;
            Available = available && !string.IsNullOrWhiteSpace(Url);
            Kind = Available ? LaunchUnavailableKind.None : kind;
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
            var kind = LaunchUnavailableKind.None;
            if (string.IsNullOrWhiteSpace(url)) kind = LaunchUnavailableKind.NotConfigured;
            else if (endpoint == null) kind = LaunchUnavailableKind.NoAccountService;
            else
                switch (AccountConnectionPolicy.CheckOwnedTarget(endpoint, url))
                {
                    case AccountConnectionFailure.None: break;
                    case AccountConnectionFailure.OriginMismatch: kind = LaunchUnavailableKind.OtherSite; break;
                    case AccountConnectionFailure.MissingAccountEndpoint: kind = LaunchUnavailableKind.NoAccountService; break;
                    default: kind = LaunchUnavailableKind.BadAddress; break;
                }
            if (kind != LaunchUnavailableKind.None)
                return new MatchLaunchTarget(mode, string.Empty, false, unavailable, kind);

            return new MatchLaunchTarget(mode, url, true, string.Empty);
        }
    }
}
