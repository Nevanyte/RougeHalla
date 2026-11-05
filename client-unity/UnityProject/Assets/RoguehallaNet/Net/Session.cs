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

    public enum SessionState { Idle, Connecting, HelloSent, InMatch, Reconnecting, Ended, Rejected, Failed }

    public sealed class SessionOptions
    {
        public string Url = "ws://127.0.0.1:7777/ws";
        public string Profile = "", Token = "", Build = "web-0.1.0";
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
        bool _resuming;
        int _attempt;
        double _nextAttemptAt, _lastPing = double.NegativeInfinity;
        bool _attemptInFlight;
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
        public uint PlayerId { get { return Welcome == null ? 0 : Welcome.PlayerId; } }
        readonly SelfView _me = new SelfView();
        bool _hasMe;
        /// <summary>
        /// The local player as of the newest applied snapshot, or null before the first one and while spectating (no self). Gameplay
        /// code reads this, not <see cref="Latest"/>: it is one owned object overwritten in place per snapshot (so it makes no garbage
        /// and never aliases a recycled snapshot), with typed codes. Copy values out to keep them past the frame.
        /// </summary>
        public SelfView Me { get { return _hasMe ? _me : null; } }
        /// <summary>
        /// CODEC LAYER (netcode and tests only; gameplay uses <see cref="Me"/> and <see cref="Snapshots"/>.Sample).
        /// The newest snapshot received. Snapshot objects (this one, those raised by SnapshotReceived and those in Snapshots) are
        /// recycled for later frames once they fall out of the 40-snapshot buffer: read them when they arrive or per frame, and
        /// copy what must outlive that.
        /// </summary>
        public ServerMsg.Snapshot Latest { get; private set; }
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
        public LocalMotion Motion { get; private set; }

        public event Action<SessionState> StateChanged;
        public event Action<ServerMsg.Snapshot> SnapshotReceived;
        public event Action<ServerMsg.Events> EventsReceived;
        public event Action<ServerMsg.Fx> FxReceived;
        /// <summary>Round trip of each Pong, in ms.</summary>
        public event Action<double> RttSample;

        public Session(ITransport transport, SessionOptions options)
        {
            _t = transport;
            _o = options;
            _t.Opened += OnOpened;
            _t.Received += OnReceived;
            _t.Closed += OnClosed;
        }

        double Now { get { return _o.Now(); } }

        void Set(SessionState s)
        {
            if (State == s) return;
            State = s;
            if (StateChanged != null) StateChanged(s);
        }

        public void Connect()
        {
            Set(SessionState.Connecting);
            _t.Connect(_o.Url);
        }

        /// <summary>Order a move: sent with the next Update and predicted locally.</summary>
        public void OrderMove(float x, float y)
        {
            byte seq = Input.Move(x, y);
            if (seq != 0 && Motion != null) Motion.Order(x, y, seq, Now);
        }

        public void OrderStop()
        {
            byte seq = Input.Stop();
            if (Motion != null) Motion.StopOrder(seq, Now);
        }

        public void Leave()
        {
            if (State == SessionState.InMatch) Send(new ClientMsg.Leave());
            Set(SessionState.Ended);
            _t.Close();
        }

        /// <summary>Pumps the transport, timers, pings, prediction and queued input. Call once per frame.</summary>
        public void Update()
        {
            _t.Poll();
            double now = Now;
            if (State == SessionState.Reconnecting && !_attemptInFlight && now >= _nextAttemptAt)
            {
                _attemptInFlight = true;
                _t.Connect(_o.Url);
            }
            if (State != SessionState.InMatch) return;
            if (now - _lastPing >= _o.PingIntervalMs) { _lastPing = now; Send(Sync.MakePing(now)); }
            if (Motion != null) Motion.Step(now);
            if (Clock.Ready) Clock.Update(now);
            foreach (var f in Input.Flush(now)) Send(f);
        }

        void Send(ClientMsg m) { _t.Send(m.Encode()); }

        void OnOpened()
        {
            if (State != SessionState.Connecting && State != SessionState.Reconnecting) return;
            _attemptInFlight = false;
            try
            {
                Send(new ClientMsg.Hello
                {
                    Protocol = Wire.ProtocolVersion, ContentHash = _o.ContentHash, Build = _o.Build, Profile = _o.Profile,
                    Token = _o.Token, Faction = _o.Faction, Resume = _resuming ? SessionToken : null,
                });
            }
            catch (EncodeException e)
            {
                // A build, profile or token over 255 bytes cannot be sent (the codec never truncates it): say so, do not retry.
                Fail("cannot send Hello: " + e.Message);
                _t.Close();
                return;
            }
            Set(SessionState.HelloSent);
        }

        void OnClosed(string reason)
        {
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
            if (++_attempt > _o.MaxReconnectAttempts) { Fail("reconnect failed after " + _o.MaxReconnectAttempts + " attempts: " + reason); return; }
            double backoff = Math.Min(_o.ReconnectMaxMs, _o.ReconnectBaseMs * Math.Pow(2, _attempt - 1));
            _nextAttemptAt = Now + backoff;
            Set(SessionState.Reconnecting);
        }

        void Fail(string why) { Error = why; Set(SessionState.Failed); }

        void OnReceived(byte[] frame)
        {
            ServerMsg msg;
            // A snapshot decodes into the one that last left the buffer (two seconds old), so steady play makes no garbage.
            var spare = Snapshots.TakeSpare();
            bool delta = frame.Length > 0 && frame[0] == 0x87;
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
                    _resuming = true;
                    _attempt = 0;
                    ScheduleRetry("too slow");
                    return;
                }
                Set(SessionState.Rejected);
                _t.Close();
                return;
            }
            var welcome = msg as ServerMsg.Welcome;
            if (welcome != null) { OnWelcome(welcome); return; }
            if (State != SessionState.InMatch && State != SessionState.Ended) { Ignored++; return; }

            double now = Now;
            var snap = msg as ServerMsg.Snapshot;
            if (snap != null)
            {
                SnapshotsReceived++;
                Latest = snap;
                if (Snapshots.Add(snap))
                {
                    Clock.OnSnapshot(now, snap.ServerMs);
                    _hasMe = snap.Me != null;
                    if (_hasMe) _me.CopyFrom(snap.Me);
                }
                if (snap.Me != null && Motion != null) Motion.OnSnapshot(snap.Me, now);
                if (SnapshotReceived != null) SnapshotReceived(snap);
                return;
            }
            var pong = msg as ServerMsg.Pong;
            if (pong != null) { Sync.OnPong(pong, now); if (RttSample != null) RttSample(Sync.LastRttMs); return; }
            var events = msg as ServerMsg.Events;
            if (events != null)
            {
                foreach (var e in events.List)
                {
                    if (e.Kind == EventKind.Result) LastResult = e.Result;
                    if (e.Kind == EventKind.MatchEnded) Set(SessionState.Ended);
                }
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
            if (w.Protocol != Wire.ProtocolVersion) { Fail("server protocol " + w.Protocol); _t.Close(); return; }
            Welcome = w;
            SessionToken = w.Session;
            _resuming = false;
            _attempt = 0;
            // A fresh Welcome restarts the timelines: a resume may land after a long gap, with a new map object.
            Snapshots.Clear();
            _hasMe = false;
            _needFull = false;
            Clock.Reset();
            Clock.TickMs = w.TickRate > 0 ? 1000.0 / w.TickRate : 50;
            Motion = new LocalMotion(w.Map);
            _lastPing = double.NegativeInfinity;
            Set(SessionState.InMatch);
        }
    }
}
