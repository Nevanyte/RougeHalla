package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"time"
)

// Bridge maps GameLift's server-process lifecycle onto the rh-server control API (docs/hosting/CONTROL_API.md):
//
//	OnStartGameSession -> POST /control/session -> ActivateGameSession
//	reserved player session -> POST /control/admit; room reports `seated` -> AcceptPlayerSession (once)
//	room reports `left` (after the server's reconnect grace) -> RemovePlayerSession -> POST /control/leave ack
//	OnProcessTerminate -> POST /control/drain -> wait for rooms closed -> ProcessEnding -> Destroy -> exit
//	OnHealthCheck -> GET /control/health
//
// GameLift allows one game session per server process, so a Bridge serves at most one session and ends the process when it
// is over (the container group is then replaced by GameLift). Packing is by running many such container groups per
// instance, see docs/hosting/GAMELIFT_VERIFIED.md section 3.
type Config struct {
	GamePort      int
	PollInterval  time.Duration // GET /control/rooms cadence
	AdmitInterval time.Duration // DescribePlayerSessions cadence
	StartTimeout  time.Duration // how long the server may take to become ready
	DrainDeadline time.Duration // upper bound for waiting on rooms during drain
	DrainMargin   time.Duration // kept free before GameLift's termination time
	HealthTimeout time.Duration
	SDKRetries    int
	SDKBackoff    time.Duration
	AllowNoAdmit  bool // tests/dev only: accept a server without --require-admit
	MaxPollFails  int  // consecutive failed polls before the session is abandoned
	// PollBudget and AdmitBudget bound one reconcile / one admit round (all control and SDK calls in it), so a hung call cannot
	// hold the single select loop; a terminate request preempts both.
	PollBudget  time.Duration
	AdmitBudget time.Duration
	// AcceptGiveUp bounds how long AcceptPlayerSession may keep failing transiently for one seated player before the player
	// is kicked (the reservation window is over). Zero: the server's admit TTL, else 60 s.
	AcceptGiveUp time.Duration
	// ServerExitGrace is how long the bridge waits, after drain, for rh-server to exit by itself before ProcessEnding. Its exit
	// means the rooms are empty and result writes are done or spooled; rh-server needs up to 150 s for them. It is capped
	// below GameLift's termination time (minus DrainMargin) when that is known.
	ServerExitGrace time.Duration
}

func DefaultConfig() Config {
	return Config{
		PollInterval:  500 * time.Millisecond,
		AdmitInterval: time.Second,
		StartTimeout:  30 * time.Second,
		DrainDeadline: 4*time.Minute + 30*time.Second,
		DrainMargin:   15 * time.Second,
		HealthTimeout: 5 * time.Second,
		SDKRetries:    3,
		SDKBackoff:    200 * time.Millisecond,
		MaxPollFails:  3,
		PollBudget:    2 * time.Second,
		AdmitBudget:   3 * time.Second,
		// rh-server's own result-write deadline (150 s, crates/rh-server/src/main.rs) plus a margin.
		ServerExitGrace: 180 * time.Second,
	}
}

// Process exit codes.
const (
	ExitOK     = 0
	ExitFailed = 1
)

var callsignRE = regexp.MustCompile(`^[A-Za-z0-9_-]{2,16}$`)

type Bridge struct {
	cfg Config
	sdk SDK
	ctl *Control
	log *slog.Logger
	// serverExit receives the supervised rh-server's exit (nil in tests that do not supervise).
	serverExit <-chan error

	start     chan GameSession
	terminate chan struct{}
	termOnce  sync.Once
	startOnce sync.Once
	draining  bool // owned by the Run goroutine
	// admitTTL is the server's admit TTL, learned from /control/health (zero until known).
	admitTTL time.Duration
	// serverExited: the supervised server's exit was already received from serverExit (Run goroutine only).
	serverExited bool
	// StopServer asks the supervised server to shut down gracefully (SIGTERM); set by main. Used when drain could not be sent.
	StopServer func()
}

func NewBridge(cfg Config, sdk SDK, ctl *Control, log *slog.Logger, serverExit <-chan error) *Bridge {
	return &Bridge{cfg: cfg, sdk: sdk, ctl: ctl, log: log, serverExit: serverExit,
		start: make(chan GameSession, 1), terminate: make(chan struct{})}
}

// Terminate requests the same graceful end as OnProcessTerminate (also used for SIGTERM).
func (b *Bridge) Terminate() { b.termOnce.Do(func() { close(b.terminate) }) }

func (b *Bridge) onStart(gs GameSession) {
	started := false
	b.startOnce.Do(func() { started = true; b.start <- gs })
	if !started {
		// One process, one game session: GameLift should never send a second one; refuse loudly rather than serve it.
		b.log.Error("second OnStartGameSession ignored: one game session per server process", "gameSessionId", gs.ID)
	}
}

func (b *Bridge) onHealth() bool {
	ctx, cancel := context.WithTimeout(context.Background(), b.cfg.HealthTimeout)
	defer cancel()
	h, err := b.ctl.Health(ctx)
	if err != nil {
		b.log.Warn("health: control API unreachable", "err", err)
		return false
	}
	// A draining server answers 503 on purpose; telling GameLift it is unhealthy would invite it to kill matches that are
	// finishing (CONTROL_API.md 6.5).
	return h.Healthy || h.State == "draining"
}

// Run drives the process lifecycle and returns the exit code. It returns only after ProcessEnding (when it was reached).
func (b *Bridge) Run(ctx context.Context) int {
	if err := b.sdk.InitSDK(); err != nil {
		b.log.Error("InitSDK failed", "err", err)
		return ExitFailed
	}
	if err := b.waitReady(ctx); err != nil {
		b.log.Error("server not ready", "err", err)
		_ = b.sdk.Destroy()
		return ExitFailed
	}
	err := b.sdk.ProcessReady(Callbacks{
		Port:               b.cfg.GamePort,
		OnStartGameSession: b.onStart,
		OnProcessTerminate: b.Terminate,
		OnHealthCheck:      b.onHealth,
	})
	if err != nil {
		b.log.Error("ProcessReady failed", "err", err)
		_ = b.sdk.Destroy()
		return ExitFailed
	}
	b.log.Info("process ready", "port", b.cfg.GamePort)

	select {
	case gs := <-b.start:
		return b.runSession(ctx, gs)
	case <-b.terminate:
		b.log.Info("terminate requested while idle")
		return b.endIdle(ctx)
	case err := <-b.serverExit:
		return b.serverCrashed(err)
	case <-ctx.Done():
		return b.cancelled("")
	}
}

// waitReady waits for /control/health 200 and enforces the fail-closed capability check.
func (b *Bridge) waitReady(ctx context.Context) error {
	deadline := time.Now().Add(b.cfg.StartTimeout)
	var last error = errors.New("no answer")
	for {
		hctx, cancel := context.WithTimeout(ctx, b.cfg.HealthTimeout)
		h, err := b.ctl.Health(hctx)
		cancel()
		switch {
		case err != nil:
			last = err
		case h.Healthy:
			if h.Control != nil {
				b.admitTTL = time.Duration(h.Control.AdmitTTLMs) * time.Millisecond
			}
			if !b.cfg.AllowNoAdmit {
				if h.Control == nil || h.Control.V != controlVersion || !h.Control.RequireAdmit {
					return errors.New("rh-server does not report control v1 with requireAdmit=true: refusing to accept game sessions " +
						"(start it with --require-admit, or pass --allow-no-admit for local development only)")
				}
			}
			if b.ctl.Token != "" {
				// The token is only defence in depth if the server enforces it: an unauthenticated probe must be refused.
				pctx, pcancel := context.WithTimeout(ctx, b.cfg.HealthTimeout)
				status, perr := b.ctl.ProbeUnauthenticated(pctx)
				pcancel()
				if perr != nil || status != http.StatusUnauthorized {
					return fmt.Errorf("rh-server does not enforce the control token (unauthenticated /control/health answered %d, err %v): "+
						"refusing to run (start it with --control-token-file)", status, perr)
				}
			}
			return nil
		default:
			last = fmt.Errorf("state %q", h.State)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("server not ready after %s: %w", b.cfg.StartTimeout, last)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-b.serverExit:
			return errors.New("rh-server exited during startup")
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func parseSession(gs GameSession) (SessionProps, error) {
	var p SessionProps
	if gs.MaxPlayers > 0 {
		n := gs.MaxPlayers
		p.MaxPlayers = &n
	}
	if v, ok := gs.Properties["fillBotsTo"]; ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return p, fmt.Errorf("game property fillBotsTo=%q is not a non-negative integer", v)
		}
		p.FillBotsTo = &n
	}
	return p, nil
}

func (b *Bridge) runSession(ctx context.Context, gs GameSession) int {
	log := b.log.With("gameSessionId", gs.ID)
	props, err := parseSession(gs)
	if err != nil {
		log.Error("bad game session properties", "err", err)
		return b.failBeforeActivation(gs.ID, false)
	}
	if _, err := b.ctl.CreateSession(ctx, gs.ID, props); err != nil {
		// 409 draining / at_capacity / session_conflict: the room does not exist, so there is nothing to abort. Never
		// ActivateGameSession for a session we cannot host.
		log.Error("server refused the game session", "err", err)
		return b.failBeforeActivation(gs.ID, false)
	}
	if err := b.retry(ctx, "ActivateGameSession", b.sdk.ActivateGameSession); err != nil {
		log.Error("ActivateGameSession failed; aborting the room", "err", err)
		return b.failBeforeActivation(gs.ID, true)
	}
	log.Info("game session active")
	return b.sessionLoop(ctx, gs.ID)
}

// failBeforeActivation ends the process after a session that never became ACTIVE. The room (if it was created) never ran a
// match, so abort loses nothing.
func (b *Bridge) failBeforeActivation(gsID string, roomExists bool) int {
	cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if roomExists {
		if err := b.ctl.End(cctx, gsID, "abort"); err != nil {
			b.log.Warn("abort of the room failed", "err", err)
		}
	}
	return b.endAfterServer(ExitFailed, b.ctl.Drain(cctx) == nil)
}

type sessionState struct {
	gsID     string
	admitted map[string]bool // playerSessionIds already offered to the server
	accepted map[string]bool // AcceptPlayerSession succeeded
	removed  map[string]bool // reported to GameLift and acknowledged
	kicked   map[string]bool
	fails    int
	// acceptSince: when AcceptPlayerSession first failed transiently for a seated player (bounds the retries).
	acceptSince map[string]time.Time
	// lastPlayers is the player list of the last successful poll; the final report uses it when the server is gone.
	lastPlayers []RoomPlayer
}

func (b *Bridge) sessionLoop(ctx context.Context, gsID string) int {
	st := &sessionState{gsID: gsID, admitted: map[string]bool{}, accepted: map[string]bool{}, removed: map[string]bool{}, kicked: map[string]bool{},
		acceptSince: map[string]time.Time{}}
	poll := time.NewTicker(b.cfg.PollInterval)
	defer poll.Stop()
	admit := time.NewTicker(b.cfg.AdmitInterval)
	defer admit.Stop()
	var drainTimer <-chan time.Time
	terminate := b.terminate

	for {
		select {
		case <-ctx.Done():
			return b.cancelled(gsID)
		case err := <-b.serverExit:
			b.serverExited = true
			if b.draining {
				// A draining server exits by itself when its last room closes: that is the end we asked for, not a crash.
				// Its status still decides the exit code: a non-zero exit (a panic, a kill, a failed shutdown) is a failure.
				// The server is gone, so the control API cannot be reconciled any more; free the seats GameLift still holds
				// from the last poll while GameLift is reachable.
				b.finalReport(st)
				b.processEnding()
				if err != nil {
					b.log.Error("rh-server exited with failure while draining", "err", err)
					return ExitFailed
				}
				b.log.Info("rh-server exited while draining")
				return ExitOK
			}
			return b.serverCrashed(err)
		case <-terminate:
			terminate = nil // handle once
			b.draining = true
			dl := b.drainDeadline()
			b.log.Info("terminate requested: draining", "deadline", dl.String())
			dctx, dcancel := context.WithTimeout(ctx, 10*time.Second)
			err := b.ctl.Drain(dctx)
			dcancel()
			if err != nil {
				b.log.Error("drain request failed; aborting the room", "err", err)
				return b.abortAndEnd(gsID)
			}
			drainTimer = time.After(dl)
		case <-drainTimer:
			b.log.Warn("drain deadline reached: aborting the room")
			return b.abortAndEnd(gsID)
		case <-admit.C:
			if !b.draining {
				octx, ocancel := opCtx(ctx, b.cfg.AdmitBudget, terminate)
				b.admitReserved(octx, st)
				ocancel()
			}
		case <-poll.C:
			octx, ocancel := opCtx(ctx, b.cfg.PollBudget, terminate)
			done, bad := b.reconcile(octx, st)
			ocancel()
			if bad {
				return b.abortAndEnd(gsID)
			}
			if done {
				return b.finish(gsID, st)
			}
		}
	}
}

// drainDeadline: min(--drain-deadline, GameLift's termination time minus margin).
func (b *Bridge) drainDeadline() time.Duration {
	d := b.cfg.DrainDeadline
	if t, err := b.sdk.TerminationTime(); err == nil {
		if left := time.Until(t) - b.cfg.DrainMargin; left < d {
			if left < 0 {
				left = 0
			}
			d = left
		}
	}
	return d
}

func (b *Bridge) admitReserved(ctx context.Context, st *sessionState) {
	list, err := callCtx(ctx, func() ([]PlayerSession, error) { return b.sdk.ReservedPlayerSessions(st.gsID) })
	if err != nil {
		b.log.Warn("DescribePlayerSessions failed", "err", err)
		return
	}
	for _, ps := range list {
		if st.admitted[ps.ID] {
			continue
		}
		if !callsignRE.MatchString(ps.PlayerID) {
			b.log.Warn("player session ignored: PlayerId is not a valid callsign", "playerSessionId", ps.ID)
			st.admitted[ps.ID] = true
			continue
		}
		res, err := b.ctl.Admit(ctx, st.gsID, ps.ID, ps.PlayerID)
		switch {
		case err == nil:
			st.admitted[ps.ID] = true
			b.log.Info("admit sent", "playerSessionId", ps.ID, "callsign", ps.PlayerID, "state", res.State)
		case IsConflict(err, ""):
			// admit_conflict / room_full / draining / session_ended: terminal for this player session; do not hammer.
			st.admitted[ps.ID] = true
			b.log.Warn("admit refused", "playerSessionId", ps.ID, "callsign", ps.PlayerID, "err", err)
		default:
			b.log.Warn("admit failed, will retry next poll", "playerSessionId", ps.ID, "err", err)
		}
	}
}

// reconcile polls the room once. It returns done when the room is closed, bad when the server cannot be trusted any more.
func (b *Bridge) reconcile(ctx context.Context, st *sessionState) (done, bad bool) {
	rr, err := b.ctl.Rooms(ctx)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return false, false // preempted by terminate, or shutting down: not a server fault
		}
		st.fails++
		b.log.Warn("poll failed", "err", err, "consecutive", st.fails)
		return false, st.fails >= b.cfg.MaxPollFails
	}
	st.fails = 0
	st.lastPlayers = nil
	var room *Room
	for i := range rr.Rooms {
		if rr.Rooms[i].GameSessionID == st.gsID {
			room = &rr.Rooms[i]
		}
	}
	if room == nil {
		b.log.Error("room vanished from /control/rooms")
		return false, true
	}
	st.lastPlayers = append(st.lastPlayers, room.Players...)
	for _, p := range room.Players {
		switch p.Status {
		case "seated":
			// First sight only. away -> seated (a resume inside the grace) never reaches here again.
			if !st.accepted[p.PlayerSessionID] && !st.kicked[p.PlayerSessionID] {
				err := b.retry(ctx, "AcceptPlayerSession", func() error { return b.sdk.AcceptPlayerSession(p.PlayerSessionID) })
				switch {
				case err == nil:
					st.accepted[p.PlayerSessionID] = true
				case ctx.Err() != nil:
					// Shutdown or preemption: no verdict was obtained, so do nothing (the player stays unaccepted).
					return false, false
				case IsRejected(err):
					b.log.Warn("GameLift rejected the player session: kicking", "playerSessionId", p.PlayerSessionID, "err", err)
					b.kick(ctx, st, p.PlayerSessionID)
				default:
					// Transient (throttling, service or websocket error): not a verdict. Leave the player unaccepted and retry
					// on the next poll, until the reservation window is over.
					since, ok := st.acceptSince[p.PlayerSessionID]
					if !ok {
						since = time.Now()
						st.acceptSince[p.PlayerSessionID] = since
					}
					if time.Since(since) > b.acceptGiveUp() {
						b.log.Warn("AcceptPlayerSession kept failing past the reservation window: kicking",
							"playerSessionId", p.PlayerSessionID, "err", err)
						b.kick(ctx, st, p.PlayerSessionID)
					} else {
						b.log.Warn("AcceptPlayerSession failed transiently; will retry next poll", "playerSessionId", p.PlayerSessionID, "err", err)
					}
				}
			}
		case "left", "expired":
			b.reportGone(ctx, st, p)
		}
	}
	return room.Phase == "closed", false
}

func (b *Bridge) kick(ctx context.Context, st *sessionState, psid string) {
	st.kicked[psid] = true
	if err := b.ctl.Leave(ctx, st.gsID, psid, "kick"); err != nil {
		b.log.Warn("kick failed", "err", err)
	}
}

func (b *Bridge) acceptGiveUp() time.Duration {
	switch {
	case b.cfg.AcceptGiveUp > 0:
		return b.cfg.AcceptGiveUp
	case b.admitTTL > 0:
		return b.admitTTL
	}
	return 60 * time.Second
}

// finalReport frees, at GameLift, the accepted seats the last successful poll showed as left or expired. It is the SDK-only
// part of the final reconcile, for when the server has already exited and its control API cannot be reached.
func (b *Bridge) finalReport(st *sessionState) {
	cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, p := range st.lastPlayers {
		if (p.Status == "left" || p.Status == "expired") && st.accepted[p.PlayerSessionID] && !st.removed[p.PlayerSessionID] {
			if err := b.retry(cctx, "RemovePlayerSession", func() error { return b.sdk.RemovePlayerSession(p.PlayerSessionID) }); err != nil {
				b.log.Warn("final RemovePlayerSession failed", "playerSessionId", p.PlayerSessionID, "err", err)
				continue
			}
			st.removed[p.PlayerSessionID] = true
		}
	}
}

// reportGone tells GameLift a seat is free (only for seats it accepted) and acknowledges the record to the server only after
// that succeeded, so a failure is retried on the next poll.
func (b *Bridge) reportGone(ctx context.Context, st *sessionState, p RoomPlayer) {
	if st.removed[p.PlayerSessionID] {
		return
	}
	if st.accepted[p.PlayerSessionID] {
		if err := b.retry(ctx, "RemovePlayerSession", func() error { return b.sdk.RemovePlayerSession(p.PlayerSessionID) }); err != nil {
			b.log.Warn("RemovePlayerSession failed; will retry next poll", "playerSessionId", p.PlayerSessionID, "err", err)
			return
		}
	}
	if err := b.ctl.Leave(ctx, st.gsID, p.PlayerSessionID, "ack"); err != nil {
		b.log.Warn("leave ack failed; will retry next poll", "err", err)
		return
	}
	st.removed[p.PlayerSessionID] = true
}

// finish ends the process after the room closed: nothing may run after ProcessEnding.
func (b *Bridge) finish(gsID string, st *sessionState) int {
	cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Stop the server from taking another room, then free any seat GameLift still holds.
	drainErr := b.ctl.Drain(cctx)
	if drainErr != nil {
		b.log.Warn("drain after session end failed", "err", drainErr)
	}
	if rr, err := b.ctl.Rooms(cctx); err == nil {
		for _, r := range rr.Rooms {
			if r.GameSessionID == gsID {
				for _, p := range r.Players {
					if p.Status == "left" || p.Status == "expired" {
						b.reportGone(cctx, st, p)
					}
				}
			}
		}
	}
	return b.endAfterServer(ExitOK, drainErr == nil)
}

func (b *Bridge) abortAndEnd(gsID string) int {
	cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := b.ctl.End(cctx, gsID, "abort"); err != nil {
		b.log.Warn("abort failed", "err", err)
	}
	drained := b.ctl.Drain(cctx) == nil
	if b.draining {
		return b.endAfterServer(ExitOK, drained) // GameLift asked us to go; the match was cut at the deadline, not failed
	}
	return b.endAfterServer(ExitFailed, drained)
}

// endIdle handles a terminate with no session: drain and leave.
func (b *Bridge) endIdle(ctx context.Context) int {
	cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := b.ctl.Drain(cctx)
	if err != nil {
		b.log.Warn("drain failed", "err", err)
	}
	return b.endAfterServer(ExitOK, err == nil)
}

func (b *Bridge) cancelled(gsID string) int {
	b.log.Warn("cancelled: cleaning up", "gameSessionId", gsID)
	cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if gsID != "" {
		if err := b.ctl.End(cctx, gsID, "abort"); err != nil {
			b.log.Warn("abort failed", "err", err)
		}
	}
	return b.endAfterServer(ExitFailed, b.ctl.Drain(cctx) == nil)
}

// awaitServerExit waits, after drain, for the supervised rh-server to exit by itself: its exit means the rooms are empty and
// the result writes are done or spooled, so killing the container afterwards loses nothing. Bounded by ServerExitGrace and by
// GameLift's termination time. exited is false when the bound was hit; err is the server's exit status.
func (b *Bridge) awaitServerExit(drained bool) (exited bool, err error) {
	if b.serverExit == nil || b.serverExited {
		return true, nil
	}
	if !drained {
		// The server was never told to drain, so it will not exit by itself. Ask it to shut down (SIGTERM starts its own
		// graceful shutdown, which finishes result writes); without a way to do that there is nothing to wait for.
		if b.StopServer == nil {
			return false, nil
		}
		b.StopServer()
	}
	grace := b.cfg.ServerExitGrace
	if t, terr := b.sdk.TerminationTime(); terr == nil {
		left := time.Until(t) - b.cfg.DrainMargin
		if left < 0 {
			left = 0
		}
		if left < grace {
			grace = left
		}
	}
	select {
	case err := <-b.serverExit:
		b.serverExited = true
		return true, err
	case <-time.After(grace):
		return false, nil
	}
}

// endAfterServer calls ProcessEnding only after the server has exited, or once the grace (or GameLift's deadline) forces it.
// A forced end and a failing server exit both turn the exit code into a failure.
func (b *Bridge) endAfterServer(code int, drained bool) int {
	exited, err := b.awaitServerExit(drained)
	switch {
	case !exited:
		b.log.Error("rh-server did not exit within the grace: ending the process anyway; in-flight result writes may be LOST",
			"grace", b.cfg.ServerExitGrace.String())
		code = ExitFailed
	case err != nil:
		b.log.Error("rh-server exited with failure", "err", err)
		code = ExitFailed
	}
	b.processEnding()
	return code
}

func (b *Bridge) serverCrashed(err error) int {
	b.serverExited = true
	b.log.Error("rh-server exited unexpectedly", "err", err)
	b.processEnding() // best effort: tell GameLift this process is gone
	return ExitFailed
}

func (b *Bridge) processEnding() {
	if err := b.sdk.ProcessEnding(); err != nil {
		b.log.Error("ProcessEnding failed", "err", err)
	}
	if err := b.sdk.Destroy(); err != nil {
		b.log.Warn("Destroy failed", "err", err)
	}
}

// retry runs fn with the SDK retry policy (SDKRetries extra attempts, doubling backoff).
func (b *Bridge) retry(ctx context.Context, name string, fn func() error) error {
	delay := b.cfg.SDKBackoff
	var err error
	for attempt := 0; attempt <= b.cfg.SDKRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}
			delay *= 2
		}
		// fn is an SDK call that cannot be interrupted: bound the wait by ctx so a hung call cannot hold the caller.
		_, err = callCtx(ctx, func() (struct{}, error) { return struct{}{}, fn() })
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		b.log.Warn("SDK call failed", "call", name, "attempt", attempt+1, "err", err)
	}
	return fmt.Errorf("%s: %w", name, err)
}

// callCtx runs fn and returns its result, or ctx's error if ctx ends first (fn then finishes in the background).
func callCtx[T any](ctx context.Context, fn func() (T, error)) (T, error) {
	type result struct {
		v   T
		err error
	}
	ch := make(chan result, 1)
	go func() { v, err := fn(); ch <- result{v, err} }()
	select {
	case r := <-ch:
		return r.v, r.err
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	}
}

// opCtx derives the context of one reconcile/admit round: it ends after budget, with parent, or as soon as preempt closes
// (the terminate request; nil once terminate was handled, so draining polls are not preempted).
func opCtx(parent context.Context, budget time.Duration, preempt <-chan struct{}) (context.Context, context.CancelFunc) {
	c, cancel := context.WithTimeout(parent, budget)
	if preempt == nil {
		return c, cancel
	}
	stop := make(chan struct{})
	go func() {
		select {
		case <-preempt:
			cancel()
		case <-stop:
		case <-c.Done():
		}
	}()
	return c, func() { close(stop); cancel() }
}
