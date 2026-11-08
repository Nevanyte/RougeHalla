using System.Collections.Generic;

namespace Roguehalla.Net
{
    /// <summary>The complete application-supplied GET header contract, compatible with the server's existing CORS allowlist.</summary>
    public static class AccountRequestHeaders
    {
        public static IEnumerable<KeyValuePair<string, string>> Build(string ownerToken, string passcode)
        {
            yield return new KeyValuePair<string, string>("Accept", "application/json");
            if (!string.IsNullOrEmpty(ownerToken)) yield return new KeyValuePair<string, string>("x-profile-token", ownerToken);
            if (!string.IsNullOrEmpty(passcode)) yield return new KeyValuePair<string, string>("x-playtest-passcode", passcode);
        }
    }
}
