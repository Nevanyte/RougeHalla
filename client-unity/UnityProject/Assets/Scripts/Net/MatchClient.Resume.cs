using System;
using System.Threading.Tasks;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    public sealed partial class MatchClient
    {
        OwnedSeatCheckpointStore _seatStore;
        OwnedSeatCheckpoint _seatRecord;
        SeatPreparation _resumePreparation;
        SeatBinding _seatBinding;
        string _resumeStatus = "";
        bool _runtimeRetired;

        sealed class SeatPreparation
        {
            public long Generation;
            public AccountCoordinator Owner;
            public AccountHubFlow Flow;
            public MatchLaunchTarget Target;
            public string Name, Page, Api, Scope;
            public int Faction;
            public bool Diagnostic;
            public ulong Content;
            public AccountJoinIntent Intent;
            public OwnedSeatCheckpoint Record;
        }

        sealed class SeatBinding
        {
            public Session Session;
            public SeatPreparation Owner;
            public OwnedSeatCheckpoint Record;
            public ServerMsg.Welcome AttemptedWelcome;
            public bool Imported;
        }

        public bool ResumeBusy => _resumePreparation != null;
        public string ResumeStatus => _resumeStatus;
        public bool CanResumeCurrentRun => this != null && !_destroying && !IsDiagnostic && Session == null && !ResumeBusy &&
            OwnedProfileLoaded(AccountFlow?.Snapshot.SelectedName);
        public bool CanForgetSavedRun => this != null && !_destroying && Session == null && !ResumeBusy && _seatRecord != null;

        void InitializeSeatResume()
        {
            if (_seatStore == null) _seatStore = new OwnedSeatCheckpointStore(new WebGlSeatCheckpointStorage());
        }

        static string SeatName(string value)
        {
            try { return AccountEndpoint.NormalizeName(value); }
            catch (ArgumentException) { return null; }
        }

        bool OwnedProfileLoaded(string name)
        {
            var state = AccountFlow?.Snapshot;
            string normalized = SeatName(name);
            return normalized != null && state?.State == AccountHubState.Owned && !state.Busy &&
                SeatName(state.SelectedName) == normalized && SeatName(state.Profile?.Name) == normalized;
        }

        SeatPreparation CaptureSeatOwner(AccountJoinIntent intent, MatchLaunchTarget target, int faction, long generation)
        {
            return new SeatPreparation
            {
                Generation = generation, Owner = AccountOwner, Flow = AccountFlow, Target = target,
                Name = SeatName(intent?.Account.CanonicalName ?? AccountFlow?.Snapshot.SelectedName),
                Page = PageUrl, Api = AccountApi, Scope = _launchEndpoint?.StorageScope,
                Faction = faction, Content = ContentHash, Intent = intent, Diagnostic = DiagnosticRequested
            };
        }

        bool CurrentSeatOwner(SeatPreparation owner, bool requireIntent)
        {
            if (owner == null || this == null || _destroying || owner.Generation != _joinGeneration ||
                !ReferenceEquals(AccountOwner, owner.Owner) || !ReferenceEquals(AccountFlow, owner.Flow) ||
                PageUrl != owner.Page || AccountApi != owner.Api || ContentHash != owner.Content ||
                DiagnosticRequested != owner.Diagnostic || IsDiagnostic ||
                !CurrentLaunchTarget(owner.Target, owner.Faction) || owner.Name == null ||
                SeatName(AccountFlow?.Snapshot.SelectedName) != owner.Name) return false;
            try
            {
                var configured = AccountEndpoint.FromPage(PageUrl, string.IsNullOrEmpty(AccountApi) ? null : AccountApi);
                if (configured.StorageScope != owner.Scope || _launchEndpoint?.StorageScope != owner.Scope) return false;
            }
            catch (ArgumentException) { return false; }
            return !requireIntent || owner.Intent != null && owner.Flow.CanJoin(owner.Intent) &&
                string.Equals(owner.Intent.MatchUrl, owner.Target.Url, StringComparison.Ordinal);
        }

        OwnedSeatCheckpointContext SeatContext(SeatPreparation owner) => new OwnedSeatCheckpointContext(
            owner.Intent.Account, _launchEndpoint, owner.Target.Url,
            owner.Target.Mode == MatchLaunchMode.Training ? OwnedSeatMode.Training : OwnedSeatMode.Arena,
            Wire.ProtocolVersion, owner.Content);

        public void ResumeCurrentRun(string nickname, int faction, MatchLaunchMode mode)
        {
            if (this == null || _destroying || IsDiagnostic || ResumeBusy || Session != null) return;
            if (!OwnedProfileLoaded(nickname))
            { _resumeStatus = "Load or sign in to your existing profile before resuming."; return; }
            if (!SelectLaunchMode(mode) || !TrySelectFaction(faction) || !OwnedProfileLoaded(nickname)) return;
            var target = LaunchTarget(mode);
            if (!target.Available) { _resumeStatus = target.UnavailableReason; return; }
            var operation = CaptureSeatOwner(null, target, faction, ++_joinGeneration);
            if (!CurrentSeatOwner(operation, false))
            { _resumeStatus = "The profile or connection changed. Load it again before resuming."; return; }
            _resumePreparation = operation;
            _resumeStatus = "Checking your saved run…"; AccountUiError = "";
            _ = ResumeOwned(operation, nickname);
        }

        async Task ResumeOwned(SeatPreparation operation, string nickname)
        {
            try
            {
                // LOAD/sign-in already established this owner. Never use this branch to claim a name.
                var intent = await operation.Flow.PrepareJoinAsync(nickname, operation.Target.Url,
                    passcode: Hud != null ? Hud.PlaytestPasscode : null);
                if (!CurrentSeatPreparation(operation, false)) return;
                operation.Intent = intent;
                if (intent == null || intent.Account.Created || !CurrentSeatOwner(operation, true))
                { _resumeStatus = "The existing profile could not be verified. Sign in before resuming."; return; }
                InitializeSeatResume();
                var read = _seatStore.Read(SeatContext(operation));
                if (!CurrentSeatPreparation(operation, true)) return;
                if (read.Status != SeatCheckpointReadStatus.Ready)
                { _resumeStatus = SeatReadText(read.Status); return; }
                operation.Record = read.Record;
                var access = operation.Target.Mode == MatchLaunchMode.Arena ? AccountOwner.Api?.CaptureSettlementAccess(intent) : null;
                if (!CurrentSeatPreparation(operation, true)) return;
                JoinCore(intent.Account.CanonicalName, operation.Faction, operation.Target, intent.Account.Token,
                    operation.Generation, access, intent, operation.Record);
            }
            catch
            {
                if (ReferenceEquals(_resumePreparation, operation) && CurrentSeatOwner(operation, false))
                    _resumeStatus = "Could not check the saved run. Please try again.";
            }
            finally
            {
                if (ReferenceEquals(_resumePreparation, operation)) _resumePreparation = null;
            }
        }

        bool CurrentSeatPreparation(SeatPreparation operation, bool requireIntent)
        {
            if (!ReferenceEquals(_resumePreparation, operation)) return false;
            if (CurrentSeatOwner(operation, requireIntent)) return true;
            if (this != null && !_destroying && operation.Generation == _joinGeneration)
                _resumeStatus = "The profile or connection changed. Load it again before resuming.";
            return false;
        }

        static string SeatReadText(SeatCheckpointReadStatus status)
        {
            switch (status)
            {
                case SeatCheckpointReadStatus.Missing: return "No saved run is available in this tab. Start a new run separately.";
                case SeatCheckpointReadStatus.Mismatch: return "The saved run does not match this profile, destination or build.";
                case SeatCheckpointReadStatus.Invalid: return "The saved run could not be read. Start a new run separately.";
                default: return "This browser could not access the saved run. Please try again.";
            }
        }

        void BindOwnedSeatSession(Session session, AccountJoinIntent intent, MatchLaunchTarget target, int faction,
            long generation, OwnedSeatCheckpoint imported)
        {
            _seatBinding = intent == null ? null : new SeatBinding
            {
                Session = session, Owner = CaptureSeatOwner(intent, target, faction, generation),
                Record = imported, Imported = imported != null
            };
            if (imported != null) _seatRecord = imported;
            _resumePreparation = null;
        }

        bool CurrentSeatBinding(SeatBinding binding) => binding != null && ReferenceEquals(_seatBinding, binding) &&
            CurrentLaunchSession(binding.Session, binding.Owner.Generation);

        bool SeatResumeConnectAllowed(Session session)
        {
            var binding = _seatBinding;
            if (binding == null || !binding.Imported) return true;
            if (!ReferenceEquals(binding.Session, session) || !CurrentSeatBinding(binding)) return false;
            if (!CurrentSeatOwner(binding.Owner, true))
            { _resumeStatus = "The profile or connection changed. Load it again before resuming."; return false; }
            var read = _seatStore.Read(SeatContext(binding.Owner));
            if (!CurrentSeatBinding(binding) || !CurrentSeatOwner(binding.Owner, true)) return false;
            if (read.Status == SeatCheckpointReadStatus.Ready && read.Record.Revision == binding.Record.Revision)
            { _resumeStatus = "Verifying the saved run with the server…"; return true; }
            _resumeStatus = read.Status == SeatCheckpointReadStatus.Ready ? "The saved run changed. Check again before resuming." : SeatReadText(read.Status);
            return false;
        }

        bool SeatResumeModeAllowed(Session session)
        {
            var binding = _seatBinding;
            return binding == null || !binding.Imported || ReferenceEquals(binding.Session, session) &&
                (ReferenceEquals(binding.AttemptedWelcome, session.Welcome) || CurrentSeatOwner(binding.Owner, true));
        }

        void CaptureConfirmedSeat(Session session)
        {
            var binding = _seatBinding;
            if (!CurrentSeatBinding(binding) || !ReferenceEquals(binding.Session, session) || !LaunchVerified ||
                !CurrentSeatOwner(binding.Owner, true) || session.Welcome == null ||
                ReferenceEquals(binding.AttemptedWelcome, session.Welcome)) return;
            binding.AttemptedWelcome = session.Welcome;
            InitializeSeatResume();
            SeatCheckpointWriteResult saved;
            try { saved = _seatStore.Save(SeatContext(binding.Owner), session.SessionToken, session.Welcome.MatchId, session.PlayerId); }
            catch (ArgumentException) { _resumeStatus = "This run could not be saved for reload."; return; }
            if (!CurrentSeatBinding(binding) || !CurrentSeatOwner(binding.Owner, true)) return;
            if (saved.Status == SeatCheckpointWriteStatus.Saved)
            {
                binding.Record = saved.Record; _seatRecord = saved.Record; _resumeStatus = "";
            }
            else _resumeStatus = saved.Status == SeatCheckpointWriteStatus.Unavailable
                ? "Run recovery is unavailable in this browser. Keep this page open."
                : "This browser could not save this run for reload. Keep this page open.";
        }

        void SeatSessionStateChanged(Session session, long generation, SessionState state)
        {
            var binding = _seatBinding;
            if (!CurrentSeatBinding(binding) || !ReferenceEquals(binding.Session, session) ||
                generation != binding.Owner.Generation || session.State != state) return;
            if (state == SessionState.Rejected)
            {
                var record = binding.Record;
                bool expired = session.RejectCode == RejectCode.NoSuchSession;
                if (expired)
                {
                    if (ReferenceEquals(_seatRecord, record)) _seatRecord = null;
                    binding.Record = null;
                }
                if (binding.Imported) _resumeStatus = expired
                    ? "That saved run is no longer available. Start a new run separately."
                    : "Resume was refused. Your saved run details were kept; try again later or choose Forget.";
                // A draining/rate-limited/version-refused connection does not prove its seat capability expired.
                if (expired) ClearSeatRecord(record);
                if (CurrentSeatBinding(binding) && binding.Imported) CloseCurrentSession(detach: true, keepCheckpoint: true);
            }
            else if (state == SessionState.Failed && binding.Imported)
            {
                // Failed also includes an untyped expected-identity failure. Never parse Error or fall back.
                _resumeStatus = "Could not resume. Your saved run details were kept; try again or choose Forget.";
                CloseCurrentSession(detach: true, keepCheckpoint: true);
            }
        }

        void CancelSeatPreparation(bool clear)
        {
            var operation = _resumePreparation;
            _resumePreparation = null;
            if (clear) ClearSeatRecord(operation?.Record);
        }

        OwnedSeatCheckpoint TakeSeatBinding(bool keepCheckpoint)
        {
            var captured = _seatRecord;
            _seatBinding = null;
            if (!keepCheckpoint) { _seatRecord = null; _resumeStatus = ""; }
            return captured;
        }

        SeatCheckpointClearStatus ClearSeatRecord(OwnedSeatCheckpoint captured)
        {
            return captured == null ? SeatCheckpointClearStatus.Missing :
                _seatStore?.Clear(captured) ?? SeatCheckpointClearStatus.Unavailable;
        }

        public void ForgetSavedRun()
        {
            if (!CanForgetSavedRun) return;
            long generation = ++_joinGeneration;
            var captured = TakeSeatBinding(false);
            var result = ClearSeatRecord(captured);
            if (this == null || _destroying || generation != _joinGeneration) return;
            if (result == SeatCheckpointClearStatus.Changed)
                _resumeStatus = "The saved run changed. The newer saved run was kept.";
            else if (result != SeatCheckpointClearStatus.Cleared && result != SeatCheckpointClearStatus.Missing)
            {
                _seatRecord = captured;
                _resumeStatus = "The saved run could not be removed. Please try again.";
            }
        }

        void RetireRuntime()
        {
            if (_runtimeRetired) return;
            _runtimeRetired = true; _destroying = true;
            ++_joinGeneration; // Revoke before any owned callback, storage or transport can run.
            CancelSeatPreparation(false);
            CloseCurrentSession(detach: true, keepCheckpoint: true);
            AccountFlow?.Cancel();
        }
    }
}
