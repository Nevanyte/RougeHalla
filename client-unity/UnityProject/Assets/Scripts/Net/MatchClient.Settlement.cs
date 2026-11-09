using System;
using System.Threading;
using System.Threading.Tasks;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed partial class MatchClient
    {
        enum SettlementState { None, Checking, Unknown, Committed, Error, Paused }
        Session _settlementSession;
        AccountApiService _settlementApi;
        AccountSettlementAccess _settlementAccess;
        AccountHubFlow _settlementFlow;
        WireResult _settlementResult;
        byte[] _settlementMatchBytes;
        string _settlementMatchId;
        uint _settlementOriginEpoch;
        long _settlementJoinGeneration, _settlementReadGeneration;
        CancellationTokenSource _settlementCancellation;
        AccountSettlement _settlementReceipt;
        string _settlementConfirmedText = "";
        SettlementState _settlementState;
        bool _settlementInFlight;
        double _settlementRetryAfter;
        Action<ServerMsg.Events> _boundSettlementEvents;
        Action _boundSettlementTimeline;
        Action<SessionState> _boundSettlementState;
        Action<AccountHubSnapshot> _boundSettlementOwner;
        // Presentation time only. The server alone determines saved credit.
        Func<double> _settlementNow = NowMs;
        Func<int, CancellationToken, Task> _settlementDelay = Task.Delay;

        bool SettlementOwnerCurrent => _settlementApi != null &&
            ReferenceEquals(AccountOwner?.Api, _settlementApi) && _settlementApi.IsCurrent(_settlementAccess);

        bool SettlementRecordCurrent => !_destroying && !IsDiagnostic && _settlementResult != null &&
            ReferenceEquals(Session, _settlementSession) && _settlementJoinGeneration == _joinGeneration &&
            ReferenceEquals(Session.LastResult, _settlementResult) && SettlementOwnerCurrent &&
            SettlementMatchCurrent();

        bool SettlementMatchCurrent()
        {
            var current = Session?.Welcome?.MatchId;
            if (current == null || current.Length != 16 || _settlementMatchBytes == null) return false;
            for (int i = 0; i < 16; i++) if (current[i] != _settlementMatchBytes[i]) return false;
            return true;
        }

        bool SettlementArenaCurrent => SettlementRecordCurrent && _sessionTarget != null &&
            _sessionTarget.Mode == MatchLaunchMode.Arena && LaunchVerified && !Session.Training &&
            CurrentLaunchTarget(_sessionTarget, _sessionFaction) &&
            (Session.State == SessionState.InMatch || Session.State == SessionState.Ended);

        public string SettlementText
        {
            get
            {
                if (!SettlementRecordCurrent) return "";
                if (!SettlementArenaCurrent) return "Saved credit check paused until the Arena connection is verified.";
                switch (_settlementState)
                {
                    case SettlementState.Checking: return "Checking saved credit…";
                    case SettlementState.Unknown: return "Saved credit not confirmed for this match.";
                    case SettlementState.Committed:
                        return _settlementConfirmedText;
                    case SettlementState.Error: return "Saved credit could not be checked.";
                    default: return "Saved credit check paused. Check again when ready.";
                }
            }
        }
        public bool CanCheckSettlement => SettlementArenaCurrent && !_settlementInFlight &&
            _settlementCancellation == null && _settlementNow() >= _settlementRetryAfter;

        void BindSettlementSession(Session session, AccountSettlementAccess access, long generation)
        {
            UnbindSettlementSession();
            if (access == null || AccountOwner?.Api == null || !AccountOwner.Api.IsCurrent(access)) return;
            _settlementSession = session; _settlementAccess = access;
            _settlementApi = AccountOwner.Api; _settlementFlow = AccountFlow;
            _settlementJoinGeneration = generation;
            _boundSettlementTimeline = () =>
            {
                if (!ReferenceEquals(Session, session)) return;
                PauseSettlementRead();
                // A retained LastResult is not evidence for a different Welcome's match.
                if (_settlementResult != null && (!AccountSettlementId.TryFormatNetworkBytes(session.Welcome?.MatchId, out var id) || id != _settlementMatchId))
                    ClearSettlementResult();
                RotateSettlementEvents();
            };
            _boundSettlementState = state =>
            {
                if (ReferenceEquals(Session, session) && state != SessionState.InMatch && state != SessionState.Ended)
                    PauseSettlementRead();
            };
            _boundSettlementOwner = snapshot =>
            {
                if (ReferenceEquals(Session, session) && !SettlementOwnerCurrent) PauseSettlementRead();
            };
            session.TimelineReset += _boundSettlementTimeline;
            session.StateChanged += _boundSettlementState;
            _settlementFlow.Changed += _boundSettlementOwner;
            RotateSettlementEvents();
        }

        void RotateSettlementEvents()
        {
            var session = _settlementSession;
            if (session == null) return;
            session.EventsReceived -= _boundSettlementEvents;
            uint epoch = session.TimelineEpoch;
            Action<ServerMsg.Events> handler = null;
            handler = batch =>
            {
                if (!CurrentLaunchSession(session, _settlementJoinGeneration) || session.TimelineEpoch != epoch ||
                    !ReferenceEquals(_boundSettlementEvents, handler)) return;
                foreach (var item in batch.List)
                {
                    if (item.Kind != EventKind.Result || item.Result == null || !ReferenceEquals(session.LastResult, item.Result)) continue;
                    if (!SettlementOwnerCurrent || _sessionTarget == null || _sessionTarget.Mode != MatchLaunchMode.Arena ||
                        session.Training || !AccountSettlementId.TryFormatNetworkBytes(session.Welcome?.MatchId, out var id)) continue;
                    if (ReferenceEquals(_settlementResult, item.Result)) continue;
                    bool alreadyHadResult = _settlementResult != null;
                    PauseSettlementRead();
                    _settlementResult = item.Result;
                    _settlementMatchBytes = (byte[])session.Welcome.MatchId.Clone();
                    _settlementMatchId = id; _settlementOriginEpoch = epoch;
                    // A duplicate/new decoded Result never silently replenishes the read budget.
                    // The new identity fences the old completion; the player can check again.
                    // A genuine Result may precede the first mode fact after Welcome.
                    // Retain its exact context, but never query until Arena is verified.
                    // A later snapshot does not silently start a postponed burst.
                    if (!alreadyHadResult && LaunchVerified) StartSettlementBurst();
                }
            };
            _boundSettlementEvents = handler;
            session.EventsReceived += handler;
        }

        public void CheckSettlementAgain()
        {
            if (CanCheckSettlement) StartSettlementBurst();
        }

        void StartSettlementBurst()
        {
            if (!SettlementArenaCurrent || _settlementInFlight || _settlementCancellation != null) return;
            var cancellation = new CancellationTokenSource();
            _settlementCancellation = cancellation;
            long read = ++_settlementReadGeneration;
            uint epoch = Session.TimelineEpoch;
            uint originEpoch = _settlementOriginEpoch;
            var session = _settlementSession; var result = _settlementResult;
            _settlementRetryAfter = _settlementNow() + 5000;
            _settlementReceipt = null; _settlementState = SettlementState.Checking;
            _ = ReadSettlementBurst(session, result, originEpoch, epoch, read, cancellation);
        }

        bool CurrentSettlementRead(Session session, WireResult result, uint originEpoch, uint epoch, long read, CancellationTokenSource cancellation) =>
            read == _settlementReadGeneration && ReferenceEquals(_settlementCancellation, cancellation) &&
            !cancellation.IsCancellationRequested && ReferenceEquals(_settlementSession, session) &&
            ReferenceEquals(_settlementResult, result) && _settlementOriginEpoch == originEpoch &&
            session.TimelineEpoch == epoch && SettlementArenaCurrent;

        async Task ReadSettlementBurst(Session session, WireResult result, uint originEpoch, uint epoch, long read, CancellationTokenSource cancellation)
        {
            try
            {
                for (int attempt = 0; attempt < 3; attempt++)
                {
                    if (attempt > 0) await _settlementDelay(attempt == 1 ? 2000 : 5000, cancellation.Token);
                    if (!CurrentSettlementRead(session, result, originEpoch, epoch, read, cancellation)) return;
                    _settlementInFlight = true;
                    AccountApiResult reply;
                    try { reply = await _settlementApi.ReadSettlementAsync(_settlementAccess, _settlementMatchBytes, cancellation.Token); }
                    finally { _settlementInFlight = false; }
                    // Error completions carry exactly the same fences as successful receipts.
                    if (!CurrentSettlementRead(session, result, originEpoch, epoch, read, cancellation)) return;
                    if (!_settlementApi.IsCurrent(reply) || reply.Failure != AccountApiFailure.None || reply.Settlement == null)
                    { _settlementState = SettlementState.Error; return; }
                    if (reply.Settlement.MatchId != _settlementMatchId)
                    { _settlementState = SettlementState.Error; return; }
                    if (reply.Settlement.Status == AccountSettlementStatus.Committed)
                    {
                        _settlementReceipt = reply.Settlement;
                        _settlementConfirmedText = (_settlementReceipt.Outcome.HasValue ? "" : "Match voided · ") +
                            "Saved credit confirmed: +" + _settlementReceipt.GvCredited.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) + " GV";
                        _settlementState = SettlementState.Committed; return;
                    }
                    _settlementState = SettlementState.Unknown;
                }
            }
            catch (OperationCanceledException) { }
            catch
            {
                if (CurrentSettlementRead(session, result, originEpoch, epoch, read, cancellation)) _settlementState = SettlementState.Error;
            }
            finally
            {
                if (ReferenceEquals(_settlementCancellation, cancellation)) _settlementCancellation = null;
                cancellation.Dispose();
            }
        }

        void PauseSettlementRead()
        {
            ++_settlementReadGeneration;
            var cancellation = _settlementCancellation; _settlementCancellation = null;
            // The worker owns disposal, including transports that finish after cancellation.
            cancellation?.Cancel();
            _settlementReceipt = null;
            _settlementConfirmedText = "";
            _settlementState = _settlementResult == null ? SettlementState.None : SettlementState.Paused;
        }
        void ClearSettlementResult()
        {
            _settlementResult = null; _settlementMatchBytes = null; _settlementMatchId = null;
            _settlementOriginEpoch = 0; _settlementReceipt = null; _settlementState = SettlementState.None;
            _settlementConfirmedText = "";
        }
        void UnbindSettlementSession()
        {
            PauseSettlementRead();
            if (_settlementSession != null)
            {
                _settlementSession.EventsReceived -= _boundSettlementEvents;
                _settlementSession.TimelineReset -= _boundSettlementTimeline;
                _settlementSession.StateChanged -= _boundSettlementState;
            }
            if (_settlementFlow != null) _settlementFlow.Changed -= _boundSettlementOwner;
            _boundSettlementEvents = null; _boundSettlementTimeline = null; _boundSettlementState = null; _boundSettlementOwner = null;
            _settlementSession = null; _settlementFlow = null; _settlementApi = null; _settlementAccess = null;
            ClearSettlementResult();
            _settlementRetryAfter = 0;
        }
    }
}
