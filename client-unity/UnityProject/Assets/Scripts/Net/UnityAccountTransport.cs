using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Roguehalla.Net;
using UnityEngine;
using UnityEngine.Networking;

namespace Roguehalla.Client
{
    /// <summary>Main-thread UnityWebRequest transport; WebGL uses Unity's browser Fetch implementation, never HttpClient.</summary>
    public sealed class UnityAccountTransport : MonoBehaviour, IAccountTransport
    {
        readonly Dictionary<UnityWebRequest, TaskCompletionSource<AccountHttpResponse>> _pending =
            new Dictionary<UnityWebRequest, TaskCompletionSource<AccountHttpResponse>>();

        public Task<AccountHttpResponse> GetProfileAsync(string url, string ownerToken, string passcode, CancellationToken cancellation)
        {
            var completion = new TaskCompletionSource<AccountHttpResponse>();
            if (!isActiveAndEnabled) { completion.SetResult(new AccountHttpResponse(0)); return completion.Task; }
            if (cancellation.IsCancellationRequested) { completion.SetCanceled(); return completion.Task; }
            UnityWebRequest request = null;
            UnityWebRequestAsyncOperation operation;
            try
            {
                request = UnityWebRequest.Get(url);
                request.redirectLimit = 0;
                request.timeout = 10;
                request.SetRequestHeader("Accept", "application/json");
                request.SetRequestHeader("Cache-Control", "no-store");
                if (!string.IsNullOrEmpty(ownerToken)) request.SetRequestHeader("x-profile-token", ownerToken);
                if (!string.IsNullOrEmpty(passcode)) request.SetRequestHeader("x-playtest-passcode", passcode);
                operation = request.SendWebRequest();
            }
            catch
            {
                request?.Dispose();
                completion.TrySetResult(new AccountHttpResponse(0));
                return completion.Task;
            }
            _pending.Add(request, completion);
            StartCoroutine(Complete(request, operation, cancellation, completion));
            return completion.Task;
        }

        IEnumerator Complete(UnityWebRequest request, UnityWebRequestAsyncOperation operation, CancellationToken cancellation,
            TaskCompletionSource<AccountHttpResponse> completion)
        {
            while (!operation.isDone)
            {
                if (cancellation.IsCancellationRequested)
                {
                    request.Abort(); request.Dispose(); _pending.Remove(request); completion.TrySetCanceled(); yield break;
                }
                yield return null;
            }
            _pending.Remove(request);
            int status = (int)request.responseCode;
            AccountReply reply = null;
            if (status == 200 && request.result == UnityWebRequest.Result.Success)
                reply = UnityAccountJson.Decode(request.downloadHandler.text);
            request.Dispose();
            completion.TrySetResult(new AccountHttpResponse(status, reply));
        }
        void OnDisable()
        {
            var pending = new List<KeyValuePair<UnityWebRequest, TaskCompletionSource<AccountHttpResponse>>>(_pending);
            _pending.Clear();
            StopAllCoroutines();
            foreach (var entry in pending)
            {
                entry.Key.Abort();
                entry.Key.Dispose();
                entry.Value.TrySetResult(new AccountHttpResponse(0));
            }
        }
    }

    public static class UnityAccountJson
    {
        /// <summary>Deliberate summary DTO: future cosmetics, achievements, progress and monthly maps are unsupported.</summary>
        public static AccountReply Decode(string json)
        {
            if (string.IsNullOrEmpty(json) || json.Length > 1024 * 1024) return null;
            // Overwrite preconstructed sentinel fields: omitted required counters remain invalid rather than becoming0.
            var reply = new AccountReply { profile = new AccountProfile { stats = new AccountStats() } };
            try { JsonUtility.FromJsonOverwrite(json, reply); return reply; }
            catch (ArgumentException) { return null; }
        }
    }
}
