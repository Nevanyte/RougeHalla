using System;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Net
{
    /// <summary>The socket under a Session. Implementations queue incoming frames and raise the events from Poll() on the caller's thread.</summary>
    public interface ITransport
    {
        event Action Opened;
        event Action<byte[]> Received;
        /// <summary>Raised once per connection, with a reason, when it ends or fails to open.</summary>
        event Action<string> Closed;
        void Connect(string url);
        void Send(byte[] frame);
        void Close();
        void Poll();
    }

    public enum SessionState { Idle, Connecting, HelloSent, InMatch, Reconnecting, Ended, Rejected, Failed, Detached }

    public sealed class SessionOptions
    {
        public string Url = "ws://127.0.0.1:7777/ws";
        public string Profile = "", Build = "web-0.1.0";
        /// <summary>Opaque admission credential sent in the Hello (at most <see cref="Wire.MaxTicket"/> bytes); the profile stays the display name.</summary>
        public byte[] Ticket = new byte[0];
        /// <summary>Optional live-seat capability for a new Session's first Hello. The owned endpoint remains the caller's responsibility.</summary>
        public SeatResume InitialResume;
        /// <summary>0 means "unknown": the server answers ContentMismatch and its reason names the hash.</summary>
        public ulong ContentHash;
        public byte? Faction;
        public int MaxReconnectAttempts = 5;
        public double ReconnectBaseMs = 500, ReconnectMaxMs = 8000, PingIntervalMs = 1000;
        /// <summary>
        /// A Resync still unanswered after this long is sent again with the next refused delta. The server never drops a Resync
        /// and answers within one second (it spaces forced Full frames by 20 ticks), so this only matters if a request or its
        /// answer is lost; it is longer than that second so a well-behaved server never sees a repeat.
        /// </summary>
        public double ResyncRetryMs = 2000;
        /// <summary>Monotonic clock in ms.</summary>
        public Func<double> Now;
    }

    /// <summary>
    /// Transport-agnostic client state machine: Idle -> Connecting -> HelloSent -> InMatch -> Ended, with Rejected / Failed exits and
    /// Reconnecting (Hello.resume = the Welcome's session token) when a live connection drops. Drive it by calling Update every frame.
    /// </summary>
    public sealed class Session
    {
        readonly ITransport _t;
        readonly SessionOptions _o;
        readonly SeatResume _initialResume;
        bool _resumeTerminated, _detached;
        bool _resuming;
        int _attempt;
        double _nextAttemptAt, _lastPing = double.NegativeInfinity;
        bool _attemptInFlight;
        bool _leaveSent;
        // Snapshots arrive as Full frames and deltas (protocol v3): the tracker holds the last one applied. After a refused delta
        // the session asks for a Full snapshot once and ignores deltas (they all name a base it does not hold) until one arrives;
        // it asks again only if the answer is ResyncRetryMs late.
        readonly SnapshotTracker _track = new SnapshotTracker();
        bool _needFull;
        double _lastResyncAt;

        public SessionState State { get; private set; }
        public RejectCode? RejectCode { get; private set; }
        public string RejectReason { get; private set; }
        public string Error { get; private set; }
        public ServerMsg.Welcome Welcome { get; private set; }
        public byte[] SessionToken { get; private set; }
        public MapBlob Map { get { return Welcome == null ? null : Welcome.Map; } }
        /// <summary>The hitbox archetype table of this server (protocol 16, ADR0024), empty before the Welcome.</summary>
        /// <summary>The own footprint for walls and paths: the self archetype's foot (ADR0024), the 12 u disc with no table.</summary>
        public Footprint OwnFoot { get { return Footprint.For(Archetypes, _me.Archetype); } }

        public Protocol.WireArchetype[] Archetypes { get { return Welcome == null || Welcome.Archetypes == null ? System.Array.Empty<Protocol.WireArchetype>() : Welcome.Archetypes; } }
        public uint PlayerId { get { return Welcome == null ? 0 : Welcome.PlayerId; } }
        readonly SelfView _me = new SelfView();
        bool _hasMe;
        bool _predictionGatesLocked;
        /// <summary>
        /// The local player as of the newest applied snapshot, or null before the first one and while spectating (no self). Gameplay
        /// code reads this, not <see cref="Latest"/>: it is one owned object overwritten in place per snapshot (so it makes no garbage
        /// and never aliases a recycled snapshot), with typed codes. Copy values out to keep them past the frame.
        /// </summary>
        public SelfView Me { get { return _hasMe ? _me : null; } }
        /// <summary>
        /// CODEC LAYER (netcode and tests only; gameplay uses <see cref="Me"/> and <see cref="Snapshots"/>.Sample).
        /// The newest accepted snapshot. Snapshot objects (this one, those raised by SnapshotReceived and those in Snapshots) are
        /// recycled for later frames once they fall out of the 40-snapshot buffer: read them when they arrive or per frame, and
        /// copy what must outlive that.
        /// </summary>
        public ServerMsg.Snapshot Latest { get; private set; }
        /// <summary>The server's public training-room fact from the newest accepted snapshot.</summary>
        public bool Training { get; private set; }
        /// <summary>Owned public phase; UI never retains recycled codec snapshots.</summary>
        public MatchPhase? Phase => Latest == null ? (MatchPhase?)null : (MatchPhase)Latest.Phase;
        /// <summary>Changes on Welcome and an accepted source-clock cut; never a snapshot-ordering key.</summary>
        public uint TimelineEpoch { get; private set; }
        /// <summary>The newest accepted source time, including its per-frame override.</summary>
        public double ServerTimeMs { get { return Latest == null ? 0 : Latest.ServerMs; } }
        public WireResult LastResult { get; private set; }
        public int ReconnectAttempt { get { return _attempt; } }
        public int SnapshotsReceived { get; private set; }
        public int DecodeErrors { get; private set; }
        public int Ignored { get; private set; }
        /// <summary>Snapshot deltas the client refused (it could not apply them); each burst makes it send one Resync.</summary>
        public int DeltasRefused { get; private set; }
        /// <summary>Resync requests sent to the server.</summary>
        public int ResyncsSent { get; private set; }

        public readonly SnapshotBuffer Snapshots = new SnapshotBuffer();
        public readonly RenderClock Clock = new RenderClock();
        public readonly ClockSync Sync = new ClockSync();
        public readonly InputSender Input = new InputSender();
        public readonly CollectionsView Collections = new CollectionsView();
        public LocalMotion Motion { get; private set; }

        public event Action<SessionState> StateChanged;
        public event Action<ServerMsg.Snapshot> SnapshotReceived;
        public event Action<CollectionsView> CollectionsChanged;
        public event Action<ServerMsg.Events> EventsReceived;
        public event Action<ServerMsg.Fx> FxReceived;
        /// <summary>Clear queued/transient presentation cues from the old timeline; canonical state is retained.</summary>
        public event Action TimelineReset;
        /// <summary>Round trip of each Pong, in ms.</summary>
        public event Action<double> RttSample;

        public Session(ITransport transport, SessionOptions options)
        {
            _t = transport;
            _o = options;
            _initialResume = options.InitialResume;
            _resuming = _initialResume != null;
            _t.Opened += OnOpened;
            _t.Received += OnReceived;
            _t.Closed += OnClosed;
            Input.CastQueued += command => { if (Motion != null) Motion.NoteNonMovementOrder(command, Now); };
        }

        double Now { get { return _o.Now(); } }

        void Set(SessionState s)
        {
            if (_detached && s != SessionState.Detached) return;
            if (State == s) return;
            State = s;
            var subscribers = StateChanged;
            if (subscribers != null) foreach (Action<SessionState> subscriber in subscribers.GetInvocationList())
            {
                if (_detached && s != SessionState.Detached) break;
                subscriber(s);
            }
        }

        public void Connect()
        {
            if (_detached || _resumeTerminated) return;
            // An imported capability can only restore its expected seat, never become a fresh admission.
            if (_initialResume != null && State != SessionState.Idle) return;
            _leaveSent = false;
            Set(SessionState.Connecting);
            if (!_detached) _t.Connect(_o.Url);
        }

        /// <summary>Order a move: sent with the next Update; the local view follows accepted server snapshots.</summary>
        public byte OrderMove(float x, float y)
        {
            if (_detached) return 0;
            byte seq = Input.Move(x, y);
            if (seq != 0 && Motion != null) Motion.Order(x, y, seq, Now, Input.LastMovementOrder);
            return seq;
        }

        public byte OrderStop()
        {
            if (_detached) return 0;
            byte seq = Input.Stop();
            if (Motion != null) Motion.StopOrder(seq, Now, Input.LastMovementOrder);
            return seq;
        }

        /// <summary>
        /// Queues a cast without predicting any effect or changing the current walk. Its order echo can acknowledge a
        /// preceding movement order; the authoritative snapshot still owns every position and correction.
        /// </summary>
        public byte Cast(byte slot, float x, float y, uint? actorRef = null, double? renderMs = null)
        {
            if (State != SessionState.InMatch) return 0;
            byte seq = Input.Cast(slot, x, y, actorRef, renderMs);
            return seq;
        }

        /// <summary>
        /// Collects an edge-triggered R press using only UI/lifecycle gates. It never checks stocks or ability eligibility.
        /// The caller supplies its ground cursor point and an optional currently picked delivered actor reference.
        /// </summary>
        public byte CollectWishInput(bool pressed, bool uiOwnsInput, bool hasGroundPoint, float x, float y, uint? actorRef = null)
        {
            if (!pressed || uiOwnsInput || !hasGroundPoint || State != SessionState.InMatch ||
                Latest == null || Latest.Phase != 1 || Me == null || Me.Status != ActorStatus.Alive) return 0;
            return Cast(0, x, y, actorRef, Clock.RenderMs);
        }

        public void Leave()
        {
            if (_detached) return;
            // MatchEnded ends play while the socket can still own its resolved seat.
            if (!_leaveSent && (State == SessionState.InMatch || State == SessionState.Ended && Welcome != null))
            {
                Send(new ClientMsg.Leave());
                _leaveSent = true;
            }
            Set(SessionState.Ended);
            if (!_detached) _t.Close();
        }

        /// <summary>
        /// Retires this connection without relinquishing its live seat. Capture a separate SeatResume first.
        /// Terminal for this instance: a new Session is required to resume. Retains delivered data, without synthesizing an outcome.
        /// The owner still unbinds its public Session events; only this Session's transport subscriptions are removed here.
        /// </summary>
        public void Detach()
        {
            if (_detached) return;
            _detached = true; // Terminal before any subscriber or transport callback can reenter.
            _resuming = _attemptInFlight = false;
            _attempt = 0; _nextAttemptAt = 0;
            Input.ClearPending();
            _t.Opened -= OnOpened;
            _t.Received -= OnReceived;
            _t.Closed -= OnClosed;
            try { Set(SessionState.Detached); }
            finally { _t.Close(); }
        }

        /// <summary>Pumps incoming state and flushes queued input. Call once per frame when input was collected beforehand.</summary>
        public void Update()
        {
            if (_detached) return;
            Poll();
            FlushInput();
        }

        /// <summary>
        /// Pumps incoming state, timers and clocks. A frame-driven client calls this before collecting controls,
        /// then calls FlushInput after collecting them so a new press leaves in the same frame.
        /// </summary>
        public void Poll()
        {
            if (_detached) return;
            _t.Poll();
            if (_detached) return;
            double now = Now;
            if (State == SessionState.Reconnecting && !_attemptInFlight && now >= _nextAttemptAt)
            {
                _attemptInFlight = true;
                _t.Connect(_o.Url);
            }
            if (State != SessionState.InMatch) return;
            if (now - _lastPing >= _o.PingIntervalMs) { _lastPing = now; Send(Sync.MakePing(now)); }
            if (_detached) return;
            if (Clock.Ready) Clock.Update(now);
            // P-NET-1 Phase 2: presentation only. Advance the predicted walk with the same injected clock while the
            // session is polled, so a frame-driven client can poll -> read input -> flush input -> present once per frame.
            // Snapshot callbacks have already advanced/reconciled Motion at this same injected time.
            if (Motion != null) Motion.Step(now);
        }

        /// <summary>Sends collected controls once per frame. It does not poll or advance the session again.</summary>
        public void FlushInput()
        {
            if (_detached) return;
            if (State != SessionState.InMatch) return;
            foreach (var f in Input.Flush(Now))
            {
                Send(f);
                if (_detached) return;
                if (Motion != null) foreach (var command in f.Commands)
                {
                    Motion.MovementOrderSent(command, f.Seq);
                    if (command.Kind == CommandKind.Cast && command.Seq.HasValue)
                        Motion.NonMovementOrderSent(command, f.Seq);
                }
            }
        }

        void Send(ClientMsg m) { if (!_detached) _t.Send(m.Encode()); }

        void OnOpened()
        {
            if (_detached || _resumeTerminated) return;
            if (State != SessionState.Connecting && State != SessionState.Reconnecting) return;
            _attemptInFlight = false;
            try
            {
                Send(new ClientMsg.Hello
                {
                    Protocol = Wire.ProtocolVersion, ContentHash = _o.ContentHash, Build = _o.Build, Profile = _o.Profile,
                    Ticket = _o.Ticket, Faction = _o.Faction,
                    Resume = _resuming ? SessionToken ?? _initialResume?.CopyCapability() : null,
                });
            }
            catch (EncodeException e)
            {
                // A build or profile over 255 bytes, or a ticket over the bound, cannot be sent (the codec never truncates it): say so, do not retry.
                Fail("cannot send Hello: " + e.Message);
                if (!_detached) _t.Close();
                return;
            }
            Set(SessionState.HelloSent);
        }

        void OnClosed(string reason)
        {
            if (_detached || _resumeTerminated) return;
            _attemptInFlight = false;
            switch (State)
            {
                case SessionState.InMatch:
                    _resuming = SessionToken != null;
                    if (_resuming) { _attempt = 0; ScheduleRetry(reason); }
                    else Fail("connection closed: " + reason);
                    break;
                case SessionState.Reconnecting:
                case SessionState.HelloSent when _resuming:
                case SessionState.Connecting when _resuming:
                    ScheduleRetry(reason);
                    break;
                case SessionState.Connecting:
                case SessionState.HelloSent:
                    Fail("closed before welcome: " + reason);
                    break;
            }
        }

        void ScheduleRetry(string reason)
        {
            if (_detached) return;
            if (++_attempt > _o.MaxReconnectAttempts) { Fail("reconnect failed after " + _o.MaxReconnectAttempts + " attempts: " + reason); return; }
            double backoff = Math.Min(_o.ReconnectMaxMs, _o.ReconnectBaseMs * Math.Pow(2, _attempt - 1));
            _nextAttemptAt = Now + backoff;
            Set(SessionState.Reconnecting);
        }

        void Fail(string why) { Error = why; Set(SessionState.Failed); }

        void OnReceived(byte[] frame)
        {
            if (_detached || _resumeTerminated) return;
            // SnapshotTracker resets itself when it decodes a Welcome. Ignore unexpected Welcomes before they can disturb the
            // current connection's delta base; a valid Welcome is handled only during the handshake.
            if (frame.Length > 0 && frame[0] == 0x81 && State != SessionState.HelloSent)
            {
                Ignored++;
                return;
            }

            ServerMsg msg;
            // A snapshot decodes into the one that last left the buffer (two seconds old), so steady play makes no garbage.
            bool delta = frame.Length > 0 && frame[0] == 0x87;
            var spare = delta || frame.Length > 0 && frame[0] == 0x83 ? Snapshots.TakeSpare() : null;
            bool replaceCurrentTick = false;
            // A stale Full frame must not replace the decoder's delta base. Peek at its tick without allocating; fresh Full
            // frames still go through the tracker exactly once. A stale candidate is fully decoded before ignoring it so a
            // malformed old frame is still reported as malformed.
            if (!delta && frame.Length > 0 && frame[0] == 0x83 && (State == SessionState.InMatch || State == SessionState.Ended))
            {
                bool stale = false;
                try
                {
                    var reader = new Reader(frame, frame.Length);
                    reader.U8();
                    uint tick = reader.Varint();
                    var newest = Snapshots.Newest;
                    if (newest != null)
                    {
                        // A requested Full can repair this tick's base without advancing simulation time.
                        replaceCurrentTick = _needFull && tick == newest.Tick;
                        stale = tick <= newest.Tick && !replaceCurrentTick;
                    }
                }
                catch (DecodeException)
                {
                    // Let the normal decoder report malformed headers consistently.
                }
                if (stale)
                {
                    try { ServerMsg.Decode(frame, frame.Length, spare); }
                    catch (DecodeException e)
                    {
                        Snapshots.Recycle(spare);
                        DecodeErrors++; Error = "bad server frame: " + e.Message; return;
                    }
                    SnapshotsReceived++;
                    Snapshots.Recycle(spare);
                    return;
                }
            }
            try { msg = _track.Decode(frame, frame.Length, spare); }
            catch (DeltaException e) { Snapshots.Recycle(spare); RefuseDelta("refused snapshot delta: " + e.Message); return; }
            catch (DecodeException e)
            {
                Snapshots.Recycle(spare);
                // A malformed delta is a delta the client cannot apply: ask for a Full snapshot rather than carry on or disconnect.
                if (delta) { RefuseDelta("bad snapshot delta: " + e.Message); return; }
                DecodeErrors++; Error = "bad server frame: " + e.Message; return;
            }
            if (!ReferenceEquals(msg, spare)) Snapshots.Recycle(spare);
            if (frame.Length > 0 && frame[0] == 0x83) _needFull = false;

            var reject = msg as ServerMsg.Reject;
            if (reject != null)
            {
                RejectCode = reject.Code;
                RejectReason = reject.Reason;
                // The server closed a live seat because this client fell behind: the seat is held for the reconnect grace,
                // so resume it (a fresh Welcome resyncs). Every other reject ends the session.
                if (reject.Code == Protocol.RejectCode.TooSlow && State == SessionState.InMatch && SessionToken != null)
                {
                    _t.Close();
                    if (_detached) return;
                    _resuming = true;
                    _attempt = 0;
                    ScheduleRetry("too slow");
                    return;
                }
                _resumeTerminated = _initialResume != null;
                Set(SessionState.Rejected);
                if (!_detached) _t.Close();
                return;
            }
            var welcome = msg as ServerMsg.Welcome;
            if (welcome != null) { OnWelcome(welcome); return; }
            if (State != SessionState.InMatch && State != SessionState.Ended) { Ignored++; return; }

            var collections = msg as ServerMsg.State;
            if (collections != null)
            {
                try { Collections.Apply(collections); }
                catch (InvalidCollectionStateException e)
                {
                    DecodeErrors++;
                    Error = "bad server collection state: " + e.Message;
                    Set(SessionState.Failed);
                    if (!_detached) _t.Close();
                    return;
                }
                bool locked = Collections.Arena.HasValue && Collections.Arena.Value.GatesLocked;
                if (Motion != null && locked != _predictionGatesLocked)
                {
                    // Welcome contains the open map, not gate geometry. A locked arena must draw authoritative self
                    // positions until the server says it is open again; never infer a second collision model.
                    if (locked) Motion.SuspendPrediction();
                    else Motion.SetCollisionMap(Map);
                }
                _predictionGatesLocked = locked;
                if (CollectionsChanged != null) CollectionsChanged(Collections);
                return;
            }
            double now = Now;
            if (_detached) return;
            var snap = msg as ServerMsg.Snapshot;
            if (snap != null)
            {
                SnapshotsReceived++;
                if (Snapshots.Add(snap, replaceCurrentTick))
                {
                    bool sourceChanged = Latest != null && snap.ServerMs != Latest.ServerMs;
                    bool sourceCut = Latest != null && (snap.Tick > Latest.Tick && snap.ServerMs <= Latest.ServerMs ||
                        replaceCurrentTick && snap.ServerMs < Latest.ServerMs);
                    Latest = snap;
                    Training = snap.Training;
                    if (!replaceCurrentTick || sourceChanged) Clock.OnSnapshot(now, snap.ServerMs);
                    _hasMe = snap.Me != null;
                    if (_hasMe) _me.CopyFrom(snap.Me, snap.OwnerCombat);
                    else _me.OwnerCombat = null;
                    if (Motion != null)
                    {
                        if (sourceCut) Motion.RebasePresentationClock(now);
                        // Source time aligns the sample with the predicted walk; the owner's speed mirror sets the walk speed.
                        // The own foot (disc or box) comes from the Welcome table and the self archetype id.
                        if (_hasMe) Motion.Foot = Footprint.For(Archetypes, _me.Archetype);
                        if (_hasMe) Motion.OnSnapshot(snap.Me, now, snap.AckInput, snap.ServerMs,
                            _me.OwnerCombat.HasValue ? _me.OwnerCombat.Value.SpeedMilli : (double?)null);
                        else Motion.Clear();
                    }
                    if (sourceCut)
                    {
                        Sync.Reset();
                        _lastPing = double.NegativeInfinity;
                        TimelineEpoch++;
                        if (TimelineReset != null) TimelineReset();
                    }
                    if (_detached) return;
                    if (SnapshotReceived != null) SnapshotReceived(snap);
                }
                return;
            }
            var pong = msg as ServerMsg.Pong;
            if (pong != null) { Sync.OnPong(pong, now); if (RttSample != null) RttSample(Sync.LastRttMs); return; }
            var events = msg as ServerMsg.Events;
            if (events != null)
            {
                foreach (var e in events.List)
                {
                    if (_detached) return;
                    if (e.Kind == EventKind.Result) LastResult = e.Result;
                    if (e.Kind == EventKind.MatchEnded) Set(SessionState.Ended);
                }
                if (_detached) return;
                if (EventsReceived != null) EventsReceived(events);
                return;
            }
            var fx = msg as ServerMsg.Fx;
            if (fx != null && FxReceived != null) FxReceived(fx);
        }

        /// <summary>
        /// A delta did not apply: keep the snapshot held, and (once per burst, while in the match or after it ended: snapshots still
        /// arrive) ask for a Full one; a burst that outlasts ResyncRetryMs asks again (defence in depth: the server never drops one).
        /// </summary>
        void RefuseDelta(string why)
        {
            DeltasRefused++;
            Error = why;
            if (State != SessionState.InMatch && State != SessionState.Ended) return;
            double now = Now;
            if (_needFull && now - _lastResyncAt < _o.ResyncRetryMs) return;
            _needFull = true;
            _lastResyncAt = now;
            ResyncsSent++;
            Send(new ClientMsg.Resync());
        }

        void OnWelcome(ServerMsg.Welcome w)
        {
            if (State != SessionState.HelloSent) { Ignored++; return; }
            if (w.Protocol != Wire.ProtocolVersion) { Fail("server protocol " + w.Protocol); if (!_detached) _t.Close(); return; }
            // Validate before exposing Welcome, timelines, input eligibility or this seat's retained Result.
            if (_initialResume != null && !_initialResume.Matches(w))
            {
                _resumeTerminated = true;
                Fail("resumed seat identity mismatch");
                if (!_detached) _t.Close();
                return;
            }
            Welcome = w;
            SessionToken = w.Session;
            _resuming = false;
            _attempt = 0;
            // A fresh Welcome restarts the timelines: a resume may land after a long gap, with a new map object.
            Snapshots.Clear();
            Collections.Reset();
            Input.ClearPending();
            Latest = null;
            Training = false;
            _hasMe = false;
            _me.OwnerCombat = null;
            _needFull = false;
            Clock.Reset();
            Sync.Reset();
            Clock.TickMs = w.TickRate > 0 ? 1000.0 / w.TickRate : 50;
            _predictionGatesLocked = false;
            Motion = new LocalMotion(w.Map);
            _lastPing = double.NegativeInfinity;
            TimelineEpoch++;
            if (TimelineReset != null) TimelineReset();
            Set(SessionState.InMatch);
        }
    }
}
