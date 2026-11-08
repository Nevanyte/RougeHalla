using System;
using Roguehalla.Net;
using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>Device-local bearer ownership, like the legacy browser token store; never server progression authority.</summary>
    public sealed class PlayerPrefsAccountCredentials : IAccountCredentialStore
    {
        static string Key(string scope, string name) => "rh.account.owner.v1." + Uri.EscapeDataString(scope) + "." + AccountEndpoint.NormalizeName(name);

        public string Read(string endpointScope, string normalizedName)
        {
            try { return PlayerPrefs.GetString(Key(endpointScope, normalizedName), ""); }
            catch { return null; }
        }

        public bool WriteConfirmed(string endpointScope, string normalizedName, string token)
        {
            if (!AccountSession.ValidToken(token)) return false;
            try
            {
                PlayerPrefs.SetString(Key(endpointScope, normalizedName), token);
                PlayerPrefs.Save();
                return true;
            }
            catch { return false; }
        }
    }
}
