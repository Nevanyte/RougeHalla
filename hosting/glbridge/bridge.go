package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
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
			if !b.cfg.AllowNoAdmit {
				if h.Control == nil || h.Control.V != controlVersion || !h.Control.RequireAdmit {
					return errors.New("rh-server does not report control v1 with requireAdmit=true: refusing to accept game sessions " +
						"(start it with --require-admit, or pass --allow-no-admit for local development only)")
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
	_ = b.ctl.Drain(cctx)
	b.processEnding()
	return ExitFailed
}

type sessionState struct {
	gsID     string
	admitted map[string]bool // playerSessionIds already offered to the server
	accepted map[string]bool // AcceptPlayerSession succeeded
	removed  map[string]bool // reported to GameLift and acknowledged
	kicked   map[string]bool
	fails    int
}

func (b *Bridge) sessionLoop(ctx context.Context, gsID string) int {
	st := &sessionState{gsID: gsID, admitted: map[string]bool{}, accepted: map[string]bool{}, removed: map[string]bool{}, kicked: map[string]bool{}}
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
			if b.draining {
				// A draining server exits by itself when its last room closes: that is the end we asked for, not a crash.
				b.log.Info("rh-server exited while draining", "err", err)
				b.processEnding()
				return ExitOK
			}
			return b.serverCrashed(err)
		case <-terminate:
			terminate = nil // handle once
			b.draining = true
			dl := b.drainDeadline()
			b.log.Info("terminate requested: draining", "deadline", dl.String())
			if err := b.ctl.Drain(ctx); err != nil {
				b.log.Error("drain request failed; aborting the room", "err", err)
				return b.abortAndEnd(gsID)
			}
			drainTimer = time.After(dl)
		case <-drainTimer:
			b.log.Warn("drain deadline reached: aborting the room")
			return b.abortAndEnd(gsID)
		case <-admit.C:
			if !b.draining {
				b.admitReserved(ctx, st)
			}
		case <-poll.C:
			done, bad := b.reconcile(ctx, st)
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
	list, err := b.sdk.ReservedPlayerSessions(st.gsID)
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
		if ctx.Err() != nil {
			return false, false
		}
		st.fails++
		b.log.Warn("poll failed", "err", err, "consecutive", st.fails)
		return false, st.fails >= b.cfg.MaxPollFails
	}
	st.fails = 0
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
	for _, p := range room.Players {
		switch p.Status {
		case "seated":
			// First sight only. away -> seated (a resume inside the grace) never reaches here again.
			if !st.accepted[p.PlayerSessionID] && !st.kicked[p.PlayerSessionID] {
				if err := b.retry(ctx, "AcceptPlayerSession", func() error { return b.sdk.AcceptPlayerSession(p.PlayerSessionID) }); err != nil {
					b.log.Warn("GameLift rejected the player session: kicking", "playerSessionId", p.PlayerSessionID, "err", err)
					st.kicked[p.PlayerSessionID] = true
					if kerr := b.ctl.Leave(ctx, st.gsID, p.PlayerSessionID, "kick"); kerr != nil {
						b.log.Warn("kick failed", "err", kerr)
					}
				} else {
					st.accepted[p.PlayerSessionID] = true
				}
			}
		case "left", "expired":
			b.reportGone(ctx, st, p)
		}
	}
	return room.Phase == "closed", false
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
	if err := b.ctl.Drain(cctx); err != nil {
		b.log.Warn("drain after session end failed", "err", err)
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
	b.processEnding()
	return ExitOK
}

func (b *Bridge) abortAndEnd(gsID string) int {
	cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := b.ctl.End(cctx, gsID, "abort"); err != nil {
		b.log.Warn("abort failed", "err", err)
	}
	_ = b.ctl.Drain(cctx)
	b.processEnding()
	if b.draining {
		return ExitOK // GameLift asked us to go; the match was cut at the deadline, not failed
	}
	return ExitFailed
}

// endIdle handles a terminate with no session: drain and leave.
func (b *Bridge) endIdle(ctx context.Context) int {
	cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := b.ctl.Drain(cctx); err != nil {
		b.log.Warn("drain failed", "err", err)
	}
	b.processEnding()
	return ExitOK
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
	_ = b.ctl.Drain(cctx)
	b.processEnding()
	return ExitFailed
}

func (b *Bridge) serverCrashed(err error) int {
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
		if err = fn(); err == nil {
			return nil
		}
		b.log.Warn("SDK call failed", "call", name, "attempt", attempt+1, "err", err)
	}
	return fmt.Errorf("%s: %w", name, err)
}
