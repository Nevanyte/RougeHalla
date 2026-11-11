using System;
using System.Collections;
using System.Text;
using Roguehalla.Net;
using UnityEngine;
using UnityEngine.Networking;

namespace Roguehalla.Client
{
    /// <summary>
    /// Main-thread UnityWebRequest calls for the public lobby endpoints (GET /api/lobby, POST/DELETE /api/lobby/presence).
    /// Modelled on <see cref="UnityAccountTransport"/>; never HttpClient (WebGL). The callback gets (status, body); status 0 means no answer.
    /// </summary>
    public sealed class LobbyActivityTransport : MonoBehaviour
    {
        const int MaxBody = 512, MaxResponseChars = 65536;

        public void Get(Uri apiBase, string token, Action<int, string> done) { Send("GET", apiBase, "lobby", token, null, done); }
        public void Heartbeat(Uri apiBase, string token, string name, string tabId, Action<int, string> done)
        { Send("POST", apiBase, "lobby/presence", token, PresenceBody(name, tabId), done); }
        public void Withdraw(Uri apiBase, string token, string name, string tabId)
        { Send("DELETE", apiBase, "lobby/presence", token, PresenceBody(name, tabId), null); }

        /// <summary>Both values are limited to [A-Za-z0-9_-] (so no escaping is needed); anything else gives null and nothing is sent.</summary>
        public static string PresenceBody(string name, string tabId)
        {
            if (!Safe(name, 2, 16) || !Safe(tabId, 8, 128)) return null;
            return "{\"name\":\"" + name + "\",\"tabId\":\"" + tabId + "\"}";
        }

        static bool Safe(string s, int min, int max)
        {
            if (s == null || s.Length < min || s.Length > max) return false;
            foreach (char c in s)
                if (!(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-')) return false;
            return true;
        }

        void Send(string method, Uri apiBase, string path, string token, string body, Action<int, string> done)
        {
            if (apiBase == null || !isActiveAndEnabled || method != "GET" && body == null) { done?.Invoke(0, null); return; }
            UnityWebRequest request = null;
            UnityWebRequestAsyncOperation operation;
            try
            {
                string url = new Uri(apiBase, path).AbsoluteUri;
                if (method == "GET") request = UnityWebRequest.Get(url);
                else
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(body);
                    if (bytes.Length > MaxBody) { done?.Invoke(0, null); return; }
                    request = new UnityWebRequest(url, method) { uploadHandler = new UploadHandlerRaw(bytes), downloadHandler = new DownloadHandlerBuffer() };
                    request.SetRequestHeader("Content-Type", "application/json");
                }
                request.redirectLimit = 0; request.timeout = 10;
                foreach (var header in AccountRequestHeaders.Build(token, null)) request.SetRequestHeader(header.Key, header.Value);
                operation = request.SendWebRequest();
            }
            catch { request?.Dispose(); done?.Invoke(0, null); return; }
            StartCoroutine(Complete(request, operation, done));
        }

        static IEnumerator Complete(UnityWebRequest request, UnityWebRequestAsyncOperation operation, Action<int, string> done)
        {
            while (!operation.isDone) yield return null;
            int status = request.result == UnityWebRequest.Result.Success ? (int)request.responseCode : 0;
            string text = null;
            if (status == 200)
            {
                try { text = request.downloadHandler.text; } catch { text = null; }
                if (text != null && text.Length > MaxResponseChars) text = null;
            }
            request.Dispose();
            done?.Invoke(status, text);
        }
    }
}
