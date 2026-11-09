using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Text;
using Roguehalla.Net;
using UnityEngine;
using UnityEngine.Networking;

namespace Roguehalla.Client
{
    /// <summary>Main-thread UnityWebRequest transport; WebGL uses Unity's browser Fetch implementation, never HttpClient.</summary>
    public sealed class UnityAccountTransport : MonoBehaviour, IAccountTransport, IAccountApiTransport
    {
        readonly Dictionary<UnityWebRequest, TaskCompletionSource<AccountHttpResponse>> _pending =
            new Dictionary<UnityWebRequest, TaskCompletionSource<AccountHttpResponse>>();
        readonly Dictionary<UnityWebRequest, TaskCompletionSource<AccountApiResponse>> _apiPending =
            new Dictionary<UnityWebRequest, TaskCompletionSource<AccountApiResponse>>();

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
                // Cache-Control is supplied by the server response; adding it here breaks the existing CORS preflight.
                foreach (var header in AccountRequestHeaders.Build(ownerToken, passcode))
                    request.SetRequestHeader(header.Key, header.Value);
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
            {
                string json = request.downloadHandler.text;
                reply = UnityAccountJson.Decode(json);
                // Ownership recovery stays on the admitted minimal contract even when richer maps are unreadable.
                AccountFullJson.AttachProfile(reply, json);
            }
            request.Dispose();
            completion.TrySetResult(new AccountHttpResponse(status, reply));
        }

        public Task<AccountApiResponse> SendAsync(AccountApiRequest operation, CancellationToken cancellation)
        {
            var completion = new TaskCompletionSource<AccountApiResponse>();
            if (!isActiveAndEnabled || operation == null || !operation.HasAllowedTarget())
            { completion.SetResult(new AccountApiResponse(0, error: new AccountApiError(AccountApiFailure.BadRequest))); return completion.Task; }
            if (cancellation.IsCancellationRequested) { completion.SetCanceled(); return completion.Task; }
            UnityWebRequest request = null;
            UnityWebRequestAsyncOperation sending;
            try
            {
                if (operation.Method == "GET") request = UnityWebRequest.Get(operation.Url);
                else if (operation.Method == "POST")
                {
                    byte[] body = Encoding.UTF8.GetBytes(AccountFullJson.EncodeMutation(operation));
                    if (body.Length > 1024) { completion.SetResult(new AccountApiResponse(400, error: new AccountApiError(AccountApiFailure.BadRequest))); return completion.Task; }
                    request = new UnityWebRequest(operation.Url, "POST") { uploadHandler = new UploadHandlerRaw(body), downloadHandler = new DownloadHandlerBuffer() };
                }
                else { completion.SetResult(new AccountApiResponse(400)); return completion.Task; }
                request.redirectLimit = 0; request.timeout = 10;
                foreach (var header in operation.Headers) request.SetRequestHeader(header.Key, header.Value);
                sending = request.SendWebRequest();
            }
            catch { request?.Dispose(); completion.TrySetResult(new AccountApiResponse(0)); return completion.Task; }
            _apiPending.Add(request, completion);
            StartCoroutine(CompleteApi(request, sending, operation, cancellation, completion));
            return completion.Task;
        }

        IEnumerator CompleteApi(UnityWebRequest request, UnityWebRequestAsyncOperation sending, AccountApiRequest operation,
            CancellationToken cancellation, TaskCompletionSource<AccountApiResponse> completion)
        {
            while (!sending.isDone)
            {
                if (cancellation.IsCancellationRequested)
                { request.Abort(); request.Dispose(); _apiPending.Remove(request); completion.TrySetCanceled(); yield break; }
                yield return null;
            }
            _apiPending.Remove(request);
            int status = (int)request.responseCode; string json = request.downloadHandler.text;
            AccountFullProfile profile = null; AccountLeaderboard board = null; AccountSettlement settlement = null;
            if (status == 200 && request.result == UnityWebRequest.Result.Success)
            {
                if (operation.Method == "GET" && operation.ReadKind == AccountApiReadKind.Settlement)
                {
                    AccountFullJson.TryApiRead(operation.ReadKind, json, operation.MatchId, out board, out settlement);
                }
                else if (operation.Method == "GET" && operation.ReadKind == AccountApiReadKind.Leaderboard)
                    AccountFullJson.TryApiRead(operation.ReadKind, json, null, out board, out settlement);
                else if (operation.Method == "POST") AccountFullJson.TryProfile(json, out profile);
            }
            AccountApiError error = status == 200 ? null : AccountFullJson.DecodeError(status, json);
            request.Dispose(); completion.TrySetResult(new AccountApiResponse(status, profile, board, error, settlement));
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
            var apiPending = new List<KeyValuePair<UnityWebRequest, TaskCompletionSource<AccountApiResponse>>>(_apiPending);
            _apiPending.Clear();
            foreach (var entry in apiPending)
            { entry.Key.Abort(); entry.Key.Dispose(); entry.Value.TrySetResult(new AccountApiResponse(0)); }
        }
    }

    public static class UnityAccountJson
    {
        /// <summary>Minimal ownership contract; the separate strict decoder attaches optional complete profile data.</summary>
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
