#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using Roguehalla.Client;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using UnityEditor;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Roguehalla.Editor.WishProof
{
    /// <summary>
    /// Drives an Editor proof through the existing MatchClient.Update path. InputSystem events are queued
    /// for normal dynamic updates; this utility never calls InputSystem.Update or MatchClient.ReadInput.
    /// </summary>
    public static class WishProof
    {
        const int FactLimit = 8192;
        const double FrameStallSeconds = 3.0;
        static readonly List<OwnerFact> Owners = new List<OwnerFact>();
        static readonly List<ReceivedFxFact> ReceivedFx = new List<ReceivedFxFact>();
        static MatchClient _client;
        static Session _session;
        static ProofResult _result;
        const double ReadinessTimeoutSeconds = 120.0;
        static double _warmupStartedAt, _trialStartedAt, _timeoutSeconds, _lastAdvanceAt;
        static int _lastFrame, _pressQueuedFrame, _trialStartOwnerCount, _lastEvidenceScanFrame = int.MinValue;
        static bool _hasPendingRelease, _targetRequestMade;
        static Mouse _mouse;
        static Keyboard _keyboard;
        static bool _mouseWasPressed;
        static uint? _requestedActor;
        static Vector2 _requestedScreenPoint;
        static OwnerFact _baselineOwner;
        static bool _inputQueued, _requestedTargetWasValid, _matchingInputFound, _matchingLandedFound, _matchingPresentationFound, _ownerChangedAfterInput;
        static byte _baselineAbility;
        static int _sampleFrame = -1, _sampleTraceIndex = -1, _matchedInputTraceIndex = -1, _nextFxOrder;

        [Serializable]
        public sealed class ProofResult
        {
            public string status, reason, inputSource;
            public int startedFrame, lastAdvancedFrame;
            public bool sawSample, sawReceivedFx, sawPresentedFx, sawOwnerWish, sawOwnerUpdateAfterInput, overflow;
            public bool matchedQueuedCast, matchedServerLanded, matchedPresentedLanded;
            public uint matchedPlayer, matchedUnitRef;
            public int matchedSeq, matchedSampleFrame, matchedInputFrame;
            public int matchedFxReceiptFrame, matchedFxReceiptIndex;
            public byte baselineAbility;
            public float matchedX, matchedY;
            public double matchedEventTime, matchedFxReceivedAt;
            public OwnerFact[] ownerFacts;
            public ReceivedFxFact[] receivedWishFx;
            public LatencyTrace.EditorRecord[] trace;
        }

        [Serializable]
        public sealed class OwnerFact
        {
            public uint tick, player;
            public int frame;
            public double serverMs, readyAt, rechargeMs, fullAt, nextChargeAt, castStartedAt, castLandsAt;
            public byte ability, maxCharges, charges, castAbility;
            public bool hasSelf, hasWish, hasFullAt, hasNextChargeAt, hasCast;
        }

        [Serializable]
        public sealed class ReceivedFxFact
        {
            public uint tick, caster, target;
            public int frame, order, messageIndex;
            public byte ability, reason;
            public double eventTime, duration, observerAt, nativeReceivedAt;
            public int observerTraceCount, nativeReceiptFrame, nativeReceiptIndex;
            public bool hasNativeReceipt;
            public float anchorX, anchorY, destinationX, destinationY;
            public bool hasCaster, hasTarget, hasAnchor, hasDestination;
            public string kind;
        }

        /// <summary>Start against the active scene's MatchClient using its ordinary Join flow.</summary>
        public static string Begin(string url, string profile, string ticket, int faction = -1, double timeoutSeconds = 30)
        {
            QueueRelease();
            Detach();
            Owners.Clear();
            ReceivedFx.Clear();
            _result = new ProofResult {
                status = "incomplete",
                reason = "not_started",
                inputSource = "InputSystem events; not OS keyboard hardware"
            };
            // Clear any prior trial's bounded trace before joining, then keep collection off during warm-up.
            LatencyTrace.BeginEditor();
            LatencyTrace.EndEditor();
            if (!EditorApplication.isPlaying || EditorApplication.isPaused)
                return Fail("editor_not_advancing_play_mode");
            if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(profile) || ticket == null)
                return Fail("url_profile_and_ticket_are_required");
            if (!(timeoutSeconds > 0) || double.IsNaN(timeoutSeconds) || double.IsInfinity(timeoutSeconds))
                return Fail("invalid_timeout");

            var activeClients = UnityEngine.Object.FindObjectsOfType<MatchClient>();
            if (activeClients == null || activeClients.Length == 0) return Fail("no_active_match_client");
            if (activeClients.Length != 1) return Fail("proof_requires_one_active_match_client");
            _client = activeClients[0];
            _timeoutSeconds = Math.Min(timeoutSeconds, 180.0);
            _warmupStartedAt = EditorApplication.timeSinceStartup;
            _lastAdvanceAt = _warmupStartedAt;
            _lastFrame = Time.frameCount;
            _result.startedFrame = _lastFrame;
            _result.lastAdvancedFrame = _lastFrame;
            _client.AutoJoin = false;
            _client.Url = url;
            _client.Profile = profile;
            _client.Token = ticket;
            _client.Faction = faction;
            try { _client.Join(profile, faction); }
            catch (Exception e) { return Fail("join_exception:" + e.GetType().Name); }
            _session = _client.Session;
            if (_session == null) return Fail("join_did_not_create_session");
            _session.SnapshotReceived += OnSnapshot;
            _session.FxReceived += OnFx;
            _targetRequestMade = false;
            _hasPendingRelease = false;
            _inputQueued = _requestedTargetWasValid = _matchingInputFound = _matchingLandedFound = _matchingPresentationFound = _ownerChangedAfterInput = false;
            _requestedActor = null;
            _baselineOwner = null;
            _nextFxOrder = 0;
            EditorApplication.update += Tick;
            _result.status = "warming";
            _result.reason = "waiting_for_live_phase_and_alive_owner_before_trace";
            return ExportJson();
        }

        /// <summary>
        /// Queue cursor movement and R at a currently delivered target. The target ref must match the outgoing Cast.
        /// An optional click is available for a proof that intentionally wants the normal left-click side effect.
        /// </summary>
        public static string QueueWishAtTarget(uint actorId, bool clickMouse = false)
        {
            if (!TrySession(out var problem)) return Fail(problem);
            if (actorId == 0) return Fail("target_id_must_be_nonzero");
            if (!FindDeliveredTarget(actorId, out var screen)) return Fail("no_currently_delivered_screen_target");
            if (!WithinLatestViewport(screen)) return Fail("selected_target_outside_latest_viewport");
            return QueueAt(screen, actorId, clickMouse);
        }

        /// <summary>Queue cursor movement and R at an in-viewport ground point without an actor reference or click.</summary>
        public static string QueueWishAtPoint(float screenX, float screenY)
        {
            if (!TrySession(out var problem)) return Fail(problem);
            var screen = new Vector2(screenX, screenY);
            if (!IsFinite(screenX) || !IsFinite(screenY) || !WithinLatestViewport(screen))
                return Fail("point_must_be_finite_and_inside_latest_viewport");
            return QueueAt(screen, null, false);
        }

        /// <summary>Request a fresh delivered screen-target sample through MatchClient's normal one-shot trace hook.</summary>
        public static string RequestTargets()
        {
            if (!IsRunning()) return Fail("proof_not_running");
            if (!IsEditorFrameAdvancing()) return Fail("editor_game_frame_not_advancing");
            if (_session == null || _session.State != SessionState.InMatch || _session.Me == null)
                return Fail("no_active_match_session");
            LatencyTrace.RequestEditorTargets();
            return "requested: next normal MatchClient frame will sample delivered screen targets";
        }

        /// <summary>Read a JSON copy for Editor CLI evaluation. No tickets, resume secrets, or DTO references are exported.</summary>
        public static string ExportJson()
        {
            if (_result == null) return "{\"status\":\"incomplete\",\"reason\":\"not_started\"}";
            _result.ownerFacts = Owners.ToArray();
            _result.receivedWishFx = ReceivedFx.ToArray();
            _result.trace = LatencyTrace.ReadEditor();
            return JsonUtility.ToJson(_result);
        }

        public static string Stop()
        {
            if (_result != null && (_result.status == "running" || _result.status == "warming")) Finish("incomplete", "stopped_by_caller");
            else Detach();
            return ExportJson();
        }

        static void Tick()
        {
            if (_result == null || (_result.status != "running" && _result.status != "warming")) return;
            double now = EditorApplication.timeSinceStartup;
            if (!EditorApplication.isPlaying || EditorApplication.isPaused)
            {
                if (now - _lastAdvanceAt >= FrameStallSeconds) Finish("incomplete", "play_mode_paused_or_stopped");
                return;
            }
            if (Time.frameCount != _lastFrame)
            {
                _lastFrame = Time.frameCount;
                _lastAdvanceAt = now;
                _result.lastAdvancedFrame = _lastFrame;
            }
            if (now - _lastAdvanceAt >= FrameStallSeconds)
            {
                Finish("incomplete", "game_frame_not_advancing");
                return;
            }
            if (_session == null || _client == null || _client.Session != _session)
            {
                Finish("incomplete", "active_session_lost");
                return;
            }
            if (_session.State == SessionState.Rejected || _session.State == SessionState.Failed || _session.State == SessionState.Ended)
            {
                Finish("incomplete", "session_ended_" + _session.State.ToString().ToLowerInvariant());
                return;
            }
            if (_result.status == "running" && _session.State != SessionState.InMatch)
            {
                Finish("incomplete", "active_match_session_lost");
                return;
            }
            if (_result.status == "running" && _session.State == SessionState.InMatch &&
                (_session.Me == null || _session.Me.Status != ActorStatus.Alive))
            {
                Finish("incomplete", "active_owner_lost");
                return;
            }
            if (LatencyTrace.EditorOverflow || _result.overflow)
            {
                _result.overflow = true;
                Finish("incomplete", "trace_overflow");
                return;
            }
            if (_result.status == "warming")
            {
                if (now - _warmupStartedAt >= ReadinessTimeoutSeconds)
                {
                    Finish("incomplete", "server_not_ready_within_timeout");
                    return;
                }
                var me = _session.Me;
                var owner = CurrentOwnerFact();
                if (_session.State == SessionState.InMatch && _session.Latest != null && _session.Latest.Phase == 1 &&
                    me != null && me.Status == ActorStatus.Alive && IsReadyOwner(owner))
                {
                    // Ignore connection, map and server-opening traffic. Only the bounded measured trial is traced.
                    LatencyTrace.BeginEditor();
                    _trialStartedAt = now;
                    _lastAdvanceAt = now;
                    _lastFrame = Time.frameCount;
                    _result.lastAdvancedFrame = _lastFrame;
                    _trialStartOwnerCount = Owners.Count;
                    _targetRequestMade = false;
                    _inputQueued = _requestedTargetWasValid = _matchingInputFound = _matchingLandedFound = _matchingPresentationFound = _ownerChangedAfterInput = false;
                    _requestedActor = null;
                    _baselineOwner = null;
                    _sampleFrame = -1;
                    _sampleTraceIndex = -1;
                    _matchedInputTraceIndex = -1;
                    _baselineAbility = 0;
                    _nextFxOrder = 0;
                    _lastEvidenceScanFrame = int.MinValue;
                    _result.sawSample = _result.sawReceivedFx = _result.sawPresentedFx = _result.sawOwnerWish = _result.sawOwnerUpdateAfterInput = false;
                    _result.status = "running";
                    _result.reason = "awaiting_match_sample_fx_and_presentation";
                }
                else return;
            }
            if (now - _trialStartedAt >= _timeoutSeconds)
            {
                Finish("incomplete", MissingEvidenceReason());
                return;
            }
            if (_session.State == SessionState.InMatch && _session.Me != null && !_targetRequestMade)
            {
                LatencyTrace.RequestEditorTargets();
                _targetRequestMade = true;
            }
            // Keep press and release in separate dynamic input updates even if editor callbacks run before Update.
            if (_hasPendingRelease && Time.frameCount >= _pressQueuedFrame + 2)
            {
                QueueRelease();
                _hasPendingRelease = false;
            }
            UpdateEvidenceFlags();
            if (_matchingInputFound && _matchingLandedFound && _matchingPresentationFound && _ownerChangedAfterInput && HasRequestedInputTarget())
                Finish("complete", "sample_input_landed_render_and_owner_update_matched");
        }

        static void OnSnapshot(ServerMsg.Snapshot snapshot)
        {
            if (_result == null || (_result.status != "running" && _result.status != "warming") || snapshot == null) return;
            var fact = new OwnerFact { tick = snapshot.Tick, frame = Time.frameCount, serverMs = snapshot.ServerMs, hasSelf = snapshot.Me != null };
            if (snapshot.Me != null)
            {
                fact.player = snapshot.Me.Id;
                var wish = snapshot.Me.Wish;
                fact.hasWish = wish != null;
                if (wish != null)
                {
                    fact.ability = wish.Ability;
                    fact.readyAt = wish.ReadyAt;
                    fact.hasFullAt = wish.FullAt.HasValue;
                    fact.fullAt = wish.FullAt.GetValueOrDefault();
                    fact.maxCharges = wish.MaxCharges;
                    fact.rechargeMs = wish.RechargeMs;
                    fact.charges = wish.Charges;
                    fact.hasNextChargeAt = wish.NextChargeAt.HasValue;
                    fact.nextChargeAt = wish.NextChargeAt.GetValueOrDefault();
                    fact.hasCast = wish.Cast != null;
                    if (wish.Cast != null)
                    {
                        var cast = wish.Cast;
                        fact.castAbility = cast.Ability;
                        fact.castStartedAt = cast.StartedAt;
                        fact.castLandsAt = cast.LandsAt;
                    }
                }
            }
            if (Owners.Count >= FactLimit) { _result.overflow = true; return; }
            Owners.Add(fact);
        }

        static void OnFx(ServerMsg.Fx message)
        {
            if (_result == null || _result.status != "running" || message == null) return;
            double observerAt = Time.realtimeSinceStartupAsDouble * 1000.0;
            int observerTraceCount = LatencyTrace.ReadEditor().Length;
            for (int messageIndex = 0; messageIndex < message.List.Count; messageIndex++)
            {
                var fx = message.List[messageIndex];
                if (fx.Kind != FxKind.WishStarted && fx.Kind != FxKind.WishLanded && fx.Kind != FxKind.WishEnded) continue;
                if (ReceivedFx.Count >= FactLimit) { _result.overflow = true; return; }
                ReceivedFx.Add(new ReceivedFxFact {
                    tick = message.Tick, frame = Time.frameCount, order = _nextFxOrder++, messageIndex = messageIndex,
                    observerTraceCount = observerTraceCount, observerAt = observerAt, kind = fx.Kind.ToString(), eventTime = fx.EventTime, duration = fx.Duration,
                    caster = fx.Caster.GetValueOrDefault(), hasCaster = fx.Caster.HasValue,
                    target = fx.Target.GetValueOrDefault(), hasTarget = fx.Target.HasValue, ability = fx.Ability, reason = fx.Reason,
                    hasAnchor = fx.HasAnchor, anchorX = fx.AnchorX, anchorY = fx.AnchorY,
                    hasDestination = fx.HasDestination, destinationX = fx.DestinationX, destinationY = fx.DestinationY
                });
            }
        }

        static void UpdateEvidenceFlags()
        {
            if (Time.frameCount == _lastEvidenceScanFrame) return;
            _lastEvidenceScanFrame = Time.frameCount;
            var trace = LatencyTrace.ReadEditor();
            if (!_matchingInputFound && _inputQueued && _session != null)
            {
                for (int sampleIndex = 0; sampleIndex < trace.Length; sampleIndex++)
                {
                    var sample = trace[sampleIndex];
                    if (sample.kind != "sampleWish") continue;
                    _result.sawSample = true;
                    if (sample.player != _session.PlayerId || sample.frame <= _pressQueuedFrame) continue;
                    for (int inputIndex = 0; inputIndex < trace.Length; inputIndex++)
                    {
                        if (!MatchesEncodedInput(sample, sampleIndex, trace[inputIndex], inputIndex,
                            _session.PlayerId, _requestedActor, out _, out var cast)) continue;
                        var baseline = OwnerBeforeFrame(sample.frame);
                        if (!IsReadyOwner(baseline)) continue;
                        _matchingInputFound = true;
                        _baselineOwner = baseline;
                        _baselineAbility = baseline.ability;
                        _sampleFrame = sample.frame;
                        _sampleTraceIndex = sampleIndex;
                        _matchedInputTraceIndex = inputIndex;
                        _result.matchedQueuedCast = true;
                        _result.matchedPlayer = sample.player;
                        _result.matchedSeq = sample.moveSeq;
                        _result.matchedSampleFrame = sample.frame;
                        _result.matchedInputFrame = trace[inputIndex].frame;
                        _result.matchedX = cast.X;
                        _result.matchedY = cast.Y;
                        _result.matchedUnitRef = cast.ActorRef;
                        _result.baselineAbility = _baselineAbility;
                        break;
                    }
                    if (_matchingInputFound) break;
                }
            }

            ReceivedFxFact landed = null;
            bool allLandedReceiptsMatched = false, allLandedPresentationsMatched = false;
            if (_matchingInputFound && _session != null)
                MatchOwnLandedOccurrences(trace, ReceivedFx, _session.PlayerId, _baselineAbility,
                    _sampleFrame, _sampleTraceIndex, _matchedInputTraceIndex, out landed,
                    out allLandedReceiptsMatched, out allLandedPresentationsMatched);
            _matchingLandedFound = landed != null && allLandedReceiptsMatched;
            _result.sawReceivedFx = _matchingLandedFound;
            _result.matchedServerLanded = _matchingLandedFound;
            if (landed != null && landed.hasNativeReceipt)
            {
                _result.matchedFxReceiptFrame = landed.nativeReceiptFrame;
                _result.matchedFxReceiptIndex = landed.nativeReceiptIndex;
                _result.matchedFxReceivedAt = landed.nativeReceivedAt;
            }
            _matchingPresentationFound = _matchingLandedFound && allLandedPresentationsMatched;
            if (_matchingPresentationFound && landed != null) _result.matchedEventTime = landed.eventTime;
            _result.sawPresentedFx = _matchingPresentationFound;
            _result.matchedPresentedLanded = _matchingPresentationFound;

            _result.sawOwnerWish = false;
            for (int i = _trialStartOwnerCount; i < Owners.Count; i++)
                if (Owners[i].hasWish) { _result.sawOwnerWish = true; break; }
            if (!_ownerChangedAfterInput && _matchingInputFound && _baselineOwner != null)
            {
                for (int i = _trialStartOwnerCount; i < Owners.Count; i++)
                {
                    var fact = Owners[i];
                    if (fact.frame > _sampleFrame && fact.serverMs > _baselineOwner.serverMs && OwnerStateChanged(_baselineOwner, fact))
                    { _ownerChangedAfterInput = true; break; }
                }
            }
            _result.sawOwnerUpdateAfterInput = _ownerChangedAfterInput;
        }

        internal static bool MatchesEncodedInput(LatencyTrace.EditorRecord sample, int sampleIndex,
            LatencyTrace.EditorRecord queuedInput, int queuedInputIndex,
            uint expectedPlayer, uint? expectedActor, out ClientMsg.Input input, out WireCommand cast)
        {
            input = null;
            cast = null;
            if (sample.kind != "sampleWish" || sample.player != expectedPlayer || sample.moveSeq <= 0 || sample.moveSeq > byte.MaxValue ||
                queuedInputIndex <= sampleIndex || queuedInput.kind != "nativeInputQueued" || queuedInput.frame != sample.frame ||
                !IsFinite(sample.at) || !IsFinite(queuedInput.at) || queuedInput.at < sample.at ||
                string.IsNullOrEmpty(queuedInput.wireBase64)) return false;
            try { input = ClientMsg.Decode(Convert.FromBase64String(queuedInput.wireBase64)) as ClientMsg.Input; }
            catch { input = null; }
            if (input == null) return false;
            foreach (var command in input.Commands)
            {
                if (command.Kind != CommandKind.Cast || command.Slot != 0 || command.Seq != (byte)sample.moveSeq ||
                    BitConverter.SingleToInt32Bits(command.X) != BitConverter.SingleToInt32Bits((float)sample.x) ||
                    BitConverter.SingleToInt32Bits(command.Y) != BitConverter.SingleToInt32Bits((float)sample.y)) continue;
                if (expectedActor.HasValue ? command.ActorRef != expectedActor.Value : command.ActorRef != 0) continue;
                cast = command;
                return true;
            }
            input = null;
            return false;
        }

        internal static bool IsReadyOwner(OwnerFact owner)
        {
            return owner != null && owner.hasWish && owner.charges > 0 && !owner.hasCast && owner.serverMs >= owner.readyAt;
        }

        internal static bool MatchesOwnLanded(ReceivedFxFact fx, uint player, byte ability, int sampleFrame, int inputTraceIndex)
        {
            return fx != null && fx.kind == FxKind.WishLanded.ToString() && fx.frame >= sampleFrame &&
                fx.hasCaster && fx.caster == player && fx.ability == ability &&
                fx.hasNativeReceipt && fx.nativeReceiptIndex > inputTraceIndex;
        }

        internal static bool TryMatchNativeFxReceipt(ReceivedFxFact fx, LatencyTrace.EditorRecord receipt, int traceIndex)
        {
            if (fx == null || receipt.kind != "nativeFxReceived" || string.IsNullOrEmpty(receipt.wireBase64)) return false;
            ServerMsg.Fx message;
            try { message = ServerMsg.Decode(Convert.FromBase64String(receipt.wireBase64)) as ServerMsg.Fx; }
            catch { return false; }
            if (message == null || receipt.frame != fx.frame || message.Tick != fx.tick || fx.messageIndex < 0 || fx.messageIndex >= message.List.Count) return false;
            var candidate = message.List[fx.messageIndex];
            if (candidate.Kind != FxKind.WishLanded || candidate.EventTime != fx.eventTime || candidate.Ability != fx.ability ||
                !candidate.Caster.HasValue || !fx.hasCaster || candidate.Caster.Value != fx.caster) return false;
            fx.hasNativeReceipt = true;
            fx.nativeReceivedAt = receipt.at;
            fx.nativeReceiptFrame = receipt.frame;
            fx.nativeReceiptIndex = traceIndex;
            return true;
        }

        internal static bool TryBindNativeFxReceipt(ReceivedFxFact fx, LatencyTrace.EditorRecord[] trace)
        {
            if (fx == null || trace == null || fx.observerTraceCount <= 0) return false;
            int last = Math.Min(fx.observerTraceCount, trace.Length) - 1;
            for (int i = last; i >= 0; i--)
            {
                if (trace[i].kind != "nativeFxReceived") continue;
                // NativeTransport records the packet before the synchronous Session/presentation subscribers.
                // This is the latest FX boundary observed by this copied OnFx callback, even if art appended markers first.
                return TryMatchNativeFxReceipt(fx, trace[i], i);
            }
            return false;
        }

        internal static void MatchOwnLandedOccurrences(LatencyTrace.EditorRecord[] trace,
            List<ReceivedFxFact> receivedFx, uint player, byte primaryAbility, int sampleFrame,
            int sampleTraceIndex, int inputTraceIndex,
            out ReceivedFxFact primary, out bool allReceiptsMatched, out bool allPresentationsMatched)
        {
            primary = null;
            allReceiptsMatched = true;
            allPresentationsMatched = true;
            var landed = new List<ReceivedFxFact>();
            if (trace == null || receivedFx == null) { allReceiptsMatched = allPresentationsMatched = false; return; }

            for (int i = 0; i < receivedFx.Count; i++)
            {
                var fx = receivedFx[i];
                if (fx == null || fx.frame < sampleFrame || fx.kind != FxKind.WishLanded.ToString() || !fx.hasCaster || fx.caster != player)
                    continue;
                if (!TryBindNativeFxReceipt(fx, trace)) { allReceiptsMatched = false; continue; }
                if (fx.nativeReceiptIndex <= inputTraceIndex) continue;
                if (landed.Count != 0)
                {
                    var previous = landed[landed.Count - 1];
                    if (fx.nativeReceiptIndex < previous.nativeReceiptIndex ||
                        (fx.nativeReceiptIndex == previous.nativeReceiptIndex && fx.messageIndex <= previous.messageIndex))
                        allReceiptsMatched = false;
                }
                landed.Add(fx);
                if (primary == null && fx.ability == primaryAbility) primary = fx;
            }

            if (primary == null) { allReceiptsMatched = false; allPresentationsMatched = false; return; }
            var presentationIndices = new List<int>();
            for (int i = sampleTraceIndex + 1; i < trace.Length; i++)
            {
                var record = trace[i];
                if (record.kind == "presentWishLanded" && record.player == player && record.frame >= sampleFrame)
                    presentationIndices.Add(i);
            }
            if (presentationIndices.Count != landed.Count) { allPresentationsMatched = false; return; }
            for (int i = 0; i < landed.Count; i++)
                if (!MatchesPresentedLanded(trace[presentationIndices[i]], landed[i], sampleFrame,
                    sampleTraceIndex, presentationIndices[i])) allPresentationsMatched = false;
        }

        internal static bool MatchesPresentedLanded(LatencyTrace.EditorRecord record, ReceivedFxFact landed,
            int sampleFrame, int sampleTraceIndex, int traceIndex)
        {
            return landed != null && record.kind == "presentWishLanded" && record.player == landed.caster &&
                record.ability == landed.ability && record.hasSourceTime && record.sourceTime == landed.eventTime &&
                landed.hasNativeReceipt && landed.nativeReceiptFrame >= sampleFrame && record.frame >= landed.nativeReceiptFrame && record.frame >= sampleFrame &&
                record.at >= landed.nativeReceivedAt && traceIndex > landed.nativeReceiptIndex && traceIndex > sampleTraceIndex;
        }

        internal static bool OwnerStateChanged(OwnerFact before, OwnerFact after)
        {
            if (!after.hasWish) return false;
            return before.ability != after.ability || before.maxCharges != after.maxCharges ||
                before.charges != after.charges || before.readyAt != after.readyAt || before.rechargeMs != after.rechargeMs ||
                before.hasFullAt != after.hasFullAt || before.fullAt != after.fullAt ||
                before.hasNextChargeAt != after.hasNextChargeAt || before.nextChargeAt != after.nextChargeAt ||
                before.hasCast != after.hasCast || before.castAbility != after.castAbility ||
                before.castStartedAt != after.castStartedAt || before.castLandsAt != after.castLandsAt;
        }

        static OwnerFact OwnerBeforeFrame(int frame)
        {
            OwnerFact found = null;
            for (int i = _trialStartOwnerCount; i < Owners.Count; i++)
            {
                var fact = Owners[i];
                if (fact.hasWish && fact.frame <= frame && (found == null || fact.frame >= found.frame)) found = fact;
            }
            return found ?? _baselineOwner;
        }

        static bool FindDeliveredTarget(uint actorId, out Vector2 point)
        {
            var trace = LatencyTrace.ReadEditor();
            int start = LatestTargetStart(trace);
            for (int i = start + 1; i < trace.Length; i++)
                if (trace[i].kind == "targetActor" && trace[i].player == actorId)
                { point = new Vector2((float)trace[i].x, (float)trace[i].y); return true; }
            point = default;
            return false;
        }

        static int LatestTargetStart(LatencyTrace.EditorRecord[] trace)
        {
            for (int i = trace.Length - 1; i >= 0; i--) if (trace[i].kind == "targetViewport") return i;
            return -1;
        }

        static string MissingEvidenceReason()
        {
            UpdateEvidenceFlags();
            if (_inputQueued && !_requestedTargetWasValid) return "no_active_requested_target";
            if (!_inputQueued) return "no_input_queued";
            if (!_result.sawSample) return "no_sample_marker";
            if (!_matchingInputFound) return "no_matching_encoded_cast_frame";
            if (!_matchingLandedFound) return "no_matching_own_server_landed_fx";
            if (!_matchingPresentationFound) return "no_matching_rendered_landed_marker";
            if (!_ownerChangedAfterInput) return "no_authoritative_owner_stock_deadline_or_cast_update";
            return "proof_timeout";
        }

        static bool QueueRelease()
        {
            if (!_hasPendingRelease && !_mouseWasPressed) return true;
            try
            {
                if (_keyboard != null) InputSystem.QueueDeltaStateEvent(_keyboard.rKey, 0f);
                if (_mouseWasPressed && _mouse != null) InputSystem.QueueDeltaStateEvent(_mouse.leftButton, 0f);
                _mouseWasPressed = false;
                return true;
            }
            catch { if (_result != null) _result.overflow = true; return false; }
        }

        static bool IsRunning() { return _result != null && _result.status == "running"; }

        static string QueueAt(Vector2 screen, uint? actor, bool clickMouse)
        {
            if (_inputQueued) return Fail("one_input_trial_per_begin");
            if (_hasPendingRelease) return Fail("previous_input_still_pressed");
            _mouse = Mouse.current;
            _keyboard = Keyboard.current;
            if (_mouse == null || _keyboard == null) return Fail("mouse_or_keyboard_device_missing");
            if (!WithinLatestViewport(screen)) return Fail("queued_point_outside_latest_viewport");
            _baselineOwner = CurrentOwnerFact();
            if (!IsReadyOwner(_baselineOwner))
                return Fail("authoritative_wish_not_ready");
            if (Owners.Count >= FactLimit) { _result.overflow = true; return Fail("owner_fact_overflow"); }
            Owners.Add(_baselineOwner);
            _baselineAbility = _baselineOwner.ability;
            try
            {
                InputSystem.QueueDeltaStateEvent(_mouse.position, screen);
                if (clickMouse)
                {
                    InputSystem.QueueDeltaStateEvent(_mouse.leftButton, 1f);
                    _mouseWasPressed = true;
                }
                InputSystem.QueueDeltaStateEvent(_keyboard.rKey, 1f);
                _requestedActor = actor;
                _requestedScreenPoint = screen;
                _requestedTargetWasValid = true;
                _result.inputSource = clickMouse
                    ? "InputSystem queued mouse cursor, left-button click, and R-key events; not OS keyboard hardware"
                    : "InputSystem queued mouse cursor and R-key events; not OS keyboard hardware";
                _pressQueuedFrame = Time.frameCount;
                _hasPendingRelease = _inputQueued = true;
                LatencyTrace.Mark("editorQueuedWishInput", _session.PlayerId, 0, screen.x, screen.y);
                return "queued: delivered cursor plus R" + (actor.HasValue ? " for selected actor " + actor.Value : " for ground point") + (clickMouse ? " and left mouse click" : "");
            }
            catch (Exception e)
            {
                _hasPendingRelease = false;
                return Fail("input_queue_exception:" + e.GetType().Name);
            }
        }

        static bool TrySession(out string reason)
        {
            reason = null;
            if (!IsRunning()) { reason = "proof_not_running"; return false; }
            if (!IsEditorFrameAdvancing()) { reason = "editor_game_frame_not_advancing"; return false; }
            if (_session == null || _session.State != SessionState.InMatch || _session.Me == null)
            { reason = "no_active_match_session"; return false; }
            if (_session.Me.Status != ActorStatus.Alive) { reason = "active_owner_lost"; return false; }
            if (_inputQueued) { reason = "one_input_trial_per_begin"; return false; }
            return true;
        }

        static bool IsFinite(float value) { return !float.IsNaN(value) && !float.IsInfinity(value); }
        static bool IsFinite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }

        static bool HasRequestedInputTarget() { return _inputQueued && _requestedTargetWasValid; }

        static bool WithinLatestViewport(Vector2 point)
        {
            if (!IsFinite(point.x) || !IsFinite(point.y)) return false;
            var trace = LatencyTrace.ReadEditor();
            int start = LatestTargetStart(trace);
            if (start < 0) return false;
            var viewport = trace[start];
            return point.x >= 0 && point.y >= 0 && point.x < viewport.x && point.y < viewport.y;
        }

        static OwnerFact CurrentOwnerFact()
        {
            if (_session == null || _session.Me == null || !_session.Me.Wish.HasValue) return null;
            var me = _session.Me;
            var wish = me.Wish.Value;
            return new OwnerFact {
                tick = _session.Latest == null ? 0 : _session.Latest.Tick,
                frame = Time.frameCount,
                serverMs = _session.ServerTimeMs,
                player = me.Id,
                hasSelf = true,
                hasWish = true,
                ability = (byte)wish.Ability,
                readyAt = wish.ReadyAt,
                hasFullAt = wish.FullAt.HasValue,
                fullAt = wish.FullAt.GetValueOrDefault(),
                maxCharges = wish.MaxCharges,
                rechargeMs = wish.RechargeMs,
                charges = wish.Charges,
                hasNextChargeAt = wish.NextChargeAt.HasValue,
                nextChargeAt = wish.NextChargeAt.GetValueOrDefault(),
                hasCast = wish.Cast.HasValue,
                castAbility = wish.Cast.HasValue ? (byte)wish.Cast.Value.Ability : (byte)0,
                castStartedAt = wish.Cast.HasValue ? wish.Cast.Value.StartedAt : 0,
                castLandsAt = wish.Cast.HasValue ? wish.Cast.Value.LandsAt : 0
            };
        }

        static bool IsEditorFrameAdvancing()
        {
            return EditorApplication.isPlaying && !EditorApplication.isPaused &&
                EditorApplication.timeSinceStartup - _lastAdvanceAt < FrameStallSeconds;
        }

        static string Fail(string reason)
        {
            if (_result == null) _result = new ProofResult();
            _result.status = "incomplete";
            _result.reason = reason;
            QueueRelease();
            Detach();
            LatencyTrace.EndEditor();
            return ExportJson();
        }

        static void Finish(string status, string reason)
        {
            bool proofOverflow = _result != null && _result.overflow;
            bool releaseFailed = !QueueRelease();
            SetFinishVerdict(_result, status, reason, proofOverflow,
                LatencyTrace.EditorOverflow, releaseFailed);
            Detach();
            LatencyTrace.EndEditor();
        }

        internal static void SetFinishVerdict(ProofResult result, string status, string reason,
            bool proofOverflow, bool traceOverflow, bool releaseOverflow)
        {
            if (traceOverflow || proofOverflow || releaseOverflow)
            {
                result.status = "incomplete";
                result.reason = traceOverflow ? "trace_overflow" : releaseOverflow ? "input_release_overflow" : "proof_overflow";
                result.overflow = true;
                return;
            }
            result.status = status;
            result.reason = reason;
        }

        static void Detach()
        {
            EditorApplication.update -= Tick;
            if (_session != null)
            {
                _session.SnapshotReceived -= OnSnapshot;
                _session.FxReceived -= OnFx;
            }
            _session = null;
            _client = null;
            _hasPendingRelease = false;
            _mouseWasPressed = false;
        }
    }
}
#endif
