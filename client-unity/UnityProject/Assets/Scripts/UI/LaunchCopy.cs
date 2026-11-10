using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>One faction as the launch screen shows it. Every field is presentation text; none of it is a game rule.</summary>
    public readonly struct HouseInfo
    {
        public readonly string Name, Region, Weapon;
        public readonly MythicGlyph WeaponGlyph;
        /// <summary>The map-zone shape that carries the faction's identity without colour (same set as the minimap legend).</summary>
        public readonly MapGlyph Shape;

        public HouseInfo(string name, string region, string weapon, MythicGlyph weaponGlyph, MapGlyph shape)
        { Name = name; Region = region; Weapon = weapon; WeaponGlyph = weaponGlyph; Shape = shape; }
    }

    /// <summary>
    /// Player-facing wording for the launch screen. Pure functions of facts the client already holds (the launch targets, the callsign
    /// text, the session state); nothing here decides whether a launch is allowed, it only explains the decision made elsewhere.
    /// </summary>
    public static class LaunchCopy
    {
        /// <summary>Fire, Sentenced, Plague, Frost, Holy: the wire order. Weapons and regions follow docs/VISUAL_DIRECTION.md and the region themes.</summary>
        public static readonly HouseInfo[] Houses =
        {
            new HouseInfo("Fire", "Volcanic wastes", "Axes", MythicGlyph.Axe, MapGlyph.Triangle),
            new HouseInfo("Sentenced", "Gothic graveyard", "Swords", MythicGlyph.Sword, MapGlyph.Diamond),
            new HouseInfo("Plague", "Forgotten city", "Bows", MythicGlyph.Bow, MapGlyph.Trefoil),
            new HouseInfo("Frost", "Frozen plains", "Shields", MythicGlyph.Shield, MapGlyph.Asterisk),
            new HouseInfo("Holy", "Desert oasis", "Wands", MythicGlyph.Wand, MapGlyph.Ring),
        };

        public const string Tagline = "Last one standing wins.";

        /// <summary>Why a destination cannot be used, in a sentence a player can act on. Empty when it is available.</summary>
        public static string UnavailableText(MatchLaunchMode mode, MatchLaunchTarget target)
        {
            if (target == null || target.Available) return "";
            bool training = mode == MatchLaunchMode.Training;
            switch (target.Kind)
            {
                case LaunchUnavailableKind.OtherSite:
                    return "This link points at a game server on another site. Open the game from its main address to play.";
                case LaunchUnavailableKind.NoAccountService:
                    return "Accounts aren't reachable from this page, so a run can't start. Reload, or open the game from its main address.";
                case LaunchUnavailableKind.BadAddress:
                    return "This link's game server address isn't valid. Open the game from its main address.";
                default:
                    return training ? "Training isn't offered on this server." : "No arena server is set up for this page.";
            }
        }

        /// <summary>Null when the text is a usable callsign, otherwise the reason it is not (the same 2 to 16 character rule the account service applies).</summary>
        public static string CallsignProblem(string text)
        {
            string trimmed = string.IsNullOrEmpty(text) ? "" : text.Trim();
            if (trimmed.Length == 0) return "Type a callsign to play.";
            try { AccountEndpoint.NormalizeName(trimmed); }
            catch (System.ArgumentException) { return "Callsigns are 2 to 16 letters, numbers, underscores or hyphens."; }
            return null;
        }

        /// <summary>A launch that never reached a confirmed match, phrased for the player instead of the transport's own error text.</summary>
        public static string SessionFailureText(SessionState state, string rejectReason)
        {
            if (state == SessionState.Rejected)
                return string.IsNullOrWhiteSpace(rejectReason) ? "The server didn't accept that join. Try again in a moment." : "The server didn't accept that join: " + rejectReason.Trim();
            if (state == SessionState.Failed || state == SessionState.Ended)
                return "Couldn't reach the game server. Check your connection and try again.";
            return "";
        }

        public static string PendingText(MatchLaunchMode mode)
        {
            return mode == MatchLaunchMode.Training ? "Opening your training room…" : "Joining the arena…";
        }
    }
}
