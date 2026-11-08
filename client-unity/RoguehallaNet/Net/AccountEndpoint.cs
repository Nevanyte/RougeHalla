using System;

namespace Roguehalla.Net
{
    /// <summary>Account REST origin, deliberately independent of a match WebSocket or operator listener.</summary>
    public sealed class AccountEndpoint
    {
        public Uri ApiBase { get; }
        public string StorageScope => ApiBase.AbsoluteUri;

        AccountEndpoint(Uri apiBase) { ApiBase = apiBase; }

        /// <summary>Ordinary Web visits use their own origin. Editor/development callers may explicitly supply /api.</summary>
        public static AccountEndpoint FromPage(string pageUrl, string explicitApiBase = null)
        {
            Uri page;
            bool pageOk = Uri.TryCreate(pageUrl, UriKind.Absolute, out page) && Http(page) && page.UserInfo.Length == 0;
            Uri api;
            if (string.IsNullOrEmpty(explicitApiBase))
            {
                if (!pageOk) throw new ArgumentException("An HTTP page or explicit account API endpoint is required.");
                api = new Uri(page.GetLeftPart(UriPartial.Authority) + "/api/");
            }
            else
            {
                if (!Uri.TryCreate(explicitApiBase, UriKind.Absolute, out api) || !Http(api) ||
                    api.UserInfo.Length != 0 || api.Query.Length != 0 || api.Fragment.Length != 0 ||
                    !api.AbsolutePath.TrimEnd('/').EndsWith("/api", StringComparison.Ordinal))
                    throw new ArgumentException("Account API override must be an HTTP(S) /api endpoint without credentials, query or fragment.");
                if (pageOk && page.Scheme == "https" && api.Scheme != "https")
                    throw new ArgumentException("An HTTPS page requires an HTTPS account endpoint.");
                api = new Uri(api.GetLeftPart(UriPartial.Authority) + api.AbsolutePath.TrimEnd('/') + "/");
            }
            return new AccountEndpoint(api);
        }

        static bool Http(Uri uri) => uri.Scheme == "https" || uri.Scheme == "http";

        public static string NormalizeName(string name)
        {
            if (name == null || name.Length < 2 || name.Length > 16) throw new ArgumentException("Callsign must contain 2–16 letters, numbers, underscores or hyphens.");
            foreach (char c in name)
                if (!(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-'))
                    throw new ArgumentException("Callsign must contain 2–16 letters, numbers, underscores or hyphens.");
            return name.ToLowerInvariant();
        }

        public string ProfileUrl(string name)
        {
            NormalizeName(name); // Validate before forming the URL; preserve the requested display spelling on first claim.
            return new Uri(ApiBase, "profile/" + name).AbsoluteUri;
        }
    }
}
