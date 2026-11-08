using System;

namespace Roguehalla.Net
{
    public enum AccountConnectionFailure { None, MissingAccountEndpoint, InvalidPage, InvalidMatchUrl, OriginMismatch }

    /// <summary>Credential routing policy only. It grants neither hosted placement nor training admission.</summary>
    public static class AccountConnectionPolicy
    {
        static bool Page(string value, out Uri uri) => Uri.TryCreate(value, UriKind.Absolute, out uri) &&
            (uri.Scheme == "http" || uri.Scheme == "https") && uri.UserInfo.Length == 0;

        static bool Match(string value, out Uri uri) => Uri.TryCreate(value, UriKind.Absolute, out uri) &&
            (uri.Scheme == "ws" || uri.Scheme == "wss") && uri.UserInfo.Length == 0 &&
            uri.Query.Length == 0 && uri.Fragment.Length == 0 && uri.AbsolutePath.EndsWith("/ws", StringComparison.Ordinal);

        /// <summary>The page determines the default match origin. An explicit remote account API never changes it silently.</summary>
        public static string DefaultMatchUrl(string pageUrl)
        {
            if (!Page(pageUrl, out var page)) throw new ArgumentException("A valid HTTP(S) page is required for a default match endpoint.");
            var target = new UriBuilder(page.GetLeftPart(UriPartial.Authority))
            {
                Scheme = page.Scheme == "https" ? "wss" : "ws",
                Port = page.Port,
                Path = "/ws",
            };
            return target.Uri.AbsoluteUri;
        }

        public static AccountConnectionFailure CheckOwnedTarget(AccountEndpoint endpoint, string matchUrl)
        {
            if (endpoint == null) return AccountConnectionFailure.MissingAccountEndpoint;
            if (!Match(matchUrl, out var match)) return AccountConnectionFailure.InvalidMatchUrl;
            Uri api = endpoint.ApiBase;
            return match.Scheme == (api.Scheme == "https" ? "wss" : "ws") && match.Port == api.Port &&
                string.Equals(match.IdnHost, api.IdnHost, StringComparison.OrdinalIgnoreCase)
                ? AccountConnectionFailure.None : AccountConnectionFailure.OriginMismatch;
        }

        /// <summary>Explicit local diagnostics only, in every build. Editor may lack a page, but may never use a remote WS.</summary>
        public static bool AllowsDiagnostic(string pageUrl, string matchUrl, bool requested, bool isEditor)
        {
            if (!requested || !Match(matchUrl, out var match) || !match.IsLoopback) return false;
            if (string.IsNullOrEmpty(pageUrl)) return isEditor;
            return Page(pageUrl, out var page) && page.IsLoopback;
        }
    }
}
