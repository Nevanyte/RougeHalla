package main

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

type harness struct {
	t      *testing.T
	rec    *recorder
	sdk    *fakeSDK
	ctl    *fakeControl
	bridge *Bridge
	cancel context.CancelFunc
	done   chan int
	exit   chan error
}

func testConfig() Config {
	c := DefaultConfig()
	c.GamePort = 35000
	c.PollInterval = 5 * time.Millisecond
	c.AdmitInterval = 5 * time.Millisecond
	c.StartTimeout = 2 * time.Second
	c.DrainDeadline = 400 * time.Millisecond
	c.DrainMargin = 0
	c.HealthTimeout = 300 * time.Millisecond
	c.SDKRetries = 2
	c.SDKBackoff = time.Millisecond
	return c
}

func newHarness(t *testing.T, mut func(*Config, *fakeControl)) *harness {
	t.Helper()
	rec := &recorder{}
	h := &harness{t: t, rec: rec, sdk: newFakeSDK(rec), ctl: newFakeControl(rec), exit: make(chan error, 1), done: make(chan int, 1)}
	t.Cleanup(h.ctl.close)
	cfg := testConfig()
	if mut != nil {
		mut(&cfg, h.ctl)
	}
	c := NewControl(h.ctl.srv.URL, "")
	c.Backoff = time.Millisecond
	c.Retries = 4
	// Like the real rh-server, the fake exits by itself once it is draining with every room closed.
	h.ctl.onDrain = func(allClosed bool) {
		if allClosed {
			select {
			case h.exit <- nil:
			default:
			}
		}
	}
	h.bridge = NewBridge(cfg, h.sdk, c, slog.New(slog.NewTextHandler(io.Discard, nil)), h.exit)
	return h
}

func (h *harness) run() {
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	h.t.Cleanup(cancel)
	go func() { h.done <- h.bridge.Run(ctx) }()
}

func (h *harness) wait(timeout time.Duration) int {
	h.t.Helper()
	select {
	case code := <-h.done:
		return code
	case <-time.After(timeout):
		h.t.Fatalf("bridge did not exit; events: %v", h.rec.snapshot())
		return -1
	}
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func (h *harness) ready() {
	waitFor(h.t, "ProcessReady", func() bool { return h.rec.index("ProcessReady:35000") >= 0 })
}

func (h *harness) before(a, b string) {
	h.t.Helper()
	ia, ib := h.rec.index(a), h.rec.index(b)
	if ia < 0 || ib < 0 || ia >= ib {
		h.t.Fatalf("want %q before %q, events: %v", a, b, h.rec.snapshot())
	}
}

func (h *harness) never(prefix string) {
	h.t.Helper()
	if n := h.rec.count(prefix); n != 0 {
		h.t.Fatalf("unexpected %q (%d), events: %v", prefix, n, h.rec.snapshot())
	}
}

const gs = "arn:aws:gamelift:us-west-2::gamesession/fleet-1/gs-1"

func session() GameSession {
	return GameSession{ID: gs, MaxPlayers: 8, Properties: map[string]string{"fillBotsTo": "8"}}
}

func TestLifecycleCreateActivateAcceptRemoveEnd(t *testing.T) {
	h := newHarness(t, nil)
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	h.before("ctl:session", "Activate") // the room exists before GameLift is told the session is ACTIVE

	// GameLift reserves a seat; the bridge discovers it and pre-authorises exactly that player.
	h.sdk.reserve(PlayerSession{ID: "psess-1", PlayerID: "alice"})
	waitFor(t, "admit", func() bool { return h.rec.index("ctl:admit:psess-1") >= 0 })
	h.never("Accept:") // no AcceptPlayerSession until the server actually seats the player
	h.ctl.seat(gs, "psess-1")
	waitFor(t, "Accept", func() bool { return h.rec.index("Accept:psess-1") >= 0 })
	h.before("ctl:admit:psess-1", "Accept:psess-1")

	// A dropped connection inside the reconnect grace and the resume that follows are invisible to GameLift.
	h.ctl.setStatus(gs, "psess-1", "away", "")
	time.Sleep(30 * time.Millisecond)
	h.ctl.setStatus(gs, "psess-1", "seated", "")
	time.Sleep(30 * time.Millisecond)
	h.never("Remove:")
	if n := h.rec.count("Accept:"); n != 1 {
		t.Fatalf("AcceptPlayerSession called %d times, want 1 (resume is not an admission)", n)
	}

	// Only when the server reports the seat gone (after grace) is GameLift told.
	h.ctl.setStatus(gs, "psess-1", "left", "grace_expired")
	waitFor(t, "Remove", func() bool { return h.rec.index("Remove:psess-1") >= 0 })
	waitFor(t, "ack", func() bool { return h.rec.index("ctl:leave:ack:psess-1") >= 0 })
	h.before("Remove:psess-1", "ctl:leave:ack:psess-1")

	h.ctl.closeRoom(gs, "completed")
	if code := h.wait(3 * time.Second); code != ExitOK {
		t.Fatalf("exit %d, events %v", code, h.rec.snapshot())
	}
	h.before("room:closed:completed", "ProcessEnding")
	h.before("ctl:drain", "ProcessEnding") // the server may not take another room
	h.before("ProcessEnding", "Destroy")
	if h.rec.count("ProcessEnding") != 1 {
		t.Fatal("ProcessEnding must be called exactly once")
	}
}

func TestNoSecondAcceptAndNoAdmitReplayForTheSameReservation(t *testing.T) {
	h := newHarness(t, nil)
	h.run()
	h.ready()
	h.sdk.startSession(session())
	// GameLift keeps listing psess-1 as RESERVED for several polls (it flips to ACTIVE only after Accept).
	h.sdk.reserve(PlayerSession{ID: "psess-1", PlayerID: "alice"})
	waitFor(t, "admit", func() bool { return h.rec.index("ctl:admit:psess-1") >= 0 })
	time.Sleep(60 * time.Millisecond)
	if n := h.rec.count("ctl:admit:"); n != 1 {
		t.Fatalf("admit sent %d times for one reservation, want 1", n)
	}
	h.ctl.closeRoom(gs, "completed")
	h.wait(3 * time.Second)
}

func TestIdempotentRetryOfSessionCreation(t *testing.T) {
	// The server applies the create, then the connection dies before the bridge reads the answer; and a plain 500 first.
	h := newHarness(t, func(_ *Config, c *fakeControl) {
		c.failBefore["/control/session"] = 1
		c.dropAfter["/control/session"] = 1
	})
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	if n := h.ctl.roomCount(); n != 1 {
		t.Fatalf("%d rooms after retries, want exactly 1", n)
	}
	if h.rec.count("ctl:session") != 1 {
		t.Fatalf("room created more than once: %v", h.rec.snapshot())
	}
	if h.ctl.hitCount("/control/session") < 3 {
		t.Fatalf("expected at least 3 attempts, got %d", h.ctl.hitCount("/control/session"))
	}
	if h.rec.count("Activate") != 1 {
		t.Fatal("ActivateGameSession must be called once")
	}
	h.ctl.closeRoom(gs, "completed")
	h.wait(3 * time.Second)
}

func TestIdempotentRetryOfAdmitAndLeave(t *testing.T) {
	h := newHarness(t, func(_ *Config, c *fakeControl) {
		c.dropAfter["/control/admit"] = 2
		c.dropAfter["/control/leave"] = 1
	})
	h.run()
	h.ready()
	h.sdk.startSession(session())
	h.sdk.reserve(PlayerSession{ID: "psess-1", PlayerID: "alice"})
	waitFor(t, "admit", func() bool { return h.rec.index("ctl:admit:psess-1") >= 0 })
	h.ctl.seat(gs, "psess-1")
	waitFor(t, "Accept", func() bool { return h.rec.index("Accept:psess-1") >= 0 })
	h.ctl.setStatus(gs, "psess-1", "left", "left")
	waitFor(t, "ack", func() bool { return h.rec.index("ctl:leave:ack:psess-1") >= 0 })
	// Applied-then-dropped admit was retried: still exactly one seat reservation on the server.
	if n := h.rec.count("ctl:admit:"); n != 1 {
		t.Fatalf("server applied %d admits, want 1", n)
	}
	h.ctl.closeRoom(gs, "completed")
	h.wait(3 * time.Second)
}

func TestSessionRefusedAtCapacity(t *testing.T) {
	h := newHarness(t, func(_ *Config, c *fakeControl) { c.maxRooms = 0 })
	h.run()
	h.ready()
	h.sdk.startSession(session())
	if code := h.wait(3 * time.Second); code != ExitFailed {
		t.Fatalf("exit %d, want failure", code)
	}
	h.never("Activate") // never tell GameLift ACTIVE for a session the server refused
	h.never("ctl:session")
	h.before("ProcessEnding", "Destroy")
}

func TestSessionRefusedWhileDraining(t *testing.T) {
	h := newHarness(t, func(_ *Config, c *fakeControl) { c.draining = true })
	h.run()
	// A draining server reports 503 on /control/health, so the bridge will not even become ready: that is the other half
	// of the guarantee. Drive the refusal path directly by letting health succeed first and draining right after.
	waitFor(t, "start attempts", func() bool { return h.ctl.hitCount("/control/health") > 1 })
	h.ctl.mu.Lock()
	h.ctl.draining = false
	h.ctl.mu.Unlock()
	h.ready()
	h.ctl.mu.Lock()
	h.ctl.draining = true
	h.ctl.mu.Unlock()
	h.sdk.startSession(session())
	if code := h.wait(3 * time.Second); code != ExitFailed {
		t.Fatalf("exit %d, want failure", code)
	}
	h.never("Activate")
}

func TestActivationFailureAbortsTheRoom(t *testing.T) {
	h := newHarness(t, nil)
	h.sdk.activateErr = errTest("GameLift unavailable")
	h.run()
	h.ready()
	h.sdk.startSession(session())
	if code := h.wait(3 * time.Second); code != ExitFailed {
		t.Fatalf("exit %d, want failure", code)
	}
	if h.rec.count("Activate") != 3 { // 1 + SDKRetries
		t.Fatalf("Activate attempts = %d, want 3", h.rec.count("Activate"))
	}
	h.before("ctl:end:abort", "ProcessEnding")
	h.ctl.mu.Lock()
	phase := h.ctl.rooms[gs].phase
	h.ctl.mu.Unlock()
	if phase != "closed" {
		t.Fatalf("room phase %q after failed activation, want closed", phase)
	}
}

func TestCancellationCleansUpTheRoom(t *testing.T) {
	h := newHarness(t, nil)
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	h.sdk.reserve(PlayerSession{ID: "psess-1", PlayerID: "alice"})
	waitFor(t, "admit", func() bool { return h.rec.index("ctl:admit:psess-1") >= 0 })
	h.cancel() // hard cancellation of the bridge context
	if code := h.wait(3 * time.Second); code != ExitFailed {
		t.Fatalf("exit %d, want failure", code)
	}
	h.before("ctl:end:abort", "ProcessEnding")
	h.before("ProcessEnding", "Destroy")
	h.never("Accept:")
}

func TestTerminateDrainOrdering(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.DrainDeadline = 5 * time.Second })
	h.run()
	h.ready()
	h.sdk.startSession(session())
	h.sdk.reserve(PlayerSession{ID: "psess-1", PlayerID: "alice"})
	waitFor(t, "admit", func() bool { return h.rec.index("ctl:admit:psess-1") >= 0 })
	h.ctl.seat(gs, "psess-1")
	waitFor(t, "Accept", func() bool { return h.rec.index("Accept:psess-1") >= 0 })

	h.sdk.terminate()
	waitFor(t, "drain", func() bool { return h.rec.index("ctl:drain") >= 0 })
	admitsBefore := h.ctl.hitCount("/control/admit")
	// The match is still running: ProcessEnding must NOT have happened, and no new admits are made while draining.
	time.Sleep(80 * time.Millisecond)
	h.never("ProcessEnding")
	h.sdk.reserve(PlayerSession{ID: "psess-2", PlayerID: "bob"})
	time.Sleep(40 * time.Millisecond)
	if n := h.ctl.hitCount("/control/admit"); n != admitsBefore {
		t.Fatalf("bridge sent %d admit request(s) while draining", n-admitsBefore)
	}
	// The seated player leaves during the drain: GameLift is still kept accurate.
	h.ctl.setStatus(gs, "psess-1", "left", "left")
	waitFor(t, "Remove", func() bool { return h.rec.index("Remove:psess-1") >= 0 })
	h.never("ProcessEnding")

	h.ctl.closeRoom(gs, "completed")
	if code := h.wait(3 * time.Second); code != ExitOK {
		t.Fatalf("exit %d, events %v", code, h.rec.snapshot())
	}
	h.before("ctl:drain", "room:closed:completed")
	h.before("room:closed:completed", "ProcessEnding")
	h.before("ProcessEnding", "Destroy")
	h.never("ctl:end:abort")
}

func TestTerminateDeadlineAbortsThenEnds(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.DrainDeadline = 60 * time.Millisecond })
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	h.sdk.terminate()
	if code := h.wait(3 * time.Second); code != ExitOK {
		t.Fatalf("exit %d", code)
	}
	h.before("ctl:drain", "ctl:end:abort")
	h.before("ctl:end:abort", "ProcessEnding")
}

func TestTerminationTimeShortensTheDrainDeadline(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.DrainDeadline = time.Minute })
	h.sdk.termTime = time.Now().Add(80 * time.Millisecond)
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	start := time.Now()
	h.sdk.terminate()
	h.wait(3 * time.Second)
	if time.Since(start) > 2*time.Second {
		t.Fatal("bridge ignored GetTerminationTime and waited for the full drain deadline")
	}
	h.before("ctl:end:abort", "ProcessEnding")
}

func TestTerminateWhileIdle(t *testing.T) {
	h := newHarness(t, nil)
	h.run()
	h.ready()
	h.sdk.terminate()
	if code := h.wait(3 * time.Second); code != ExitOK {
		t.Fatalf("exit %d", code)
	}
	h.before("ctl:drain", "ProcessEnding")
	h.never("Activate")
}

func TestHealthCallbackMapsControlHealth(t *testing.T) {
	h := newHarness(t, nil)
	h.run()
	h.ready()
	if !h.sdk.health() {
		t.Fatal("ready server must be healthy")
	}
	h.ctl.mu.Lock()
	h.ctl.draining = true
	h.ctl.mu.Unlock()
	if !h.sdk.health() {
		t.Fatal("a draining server is intentionally 503 but must not be reported unhealthy to GameLift")
	}
	h.ctl.mu.Lock()
	h.ctl.draining = false
	h.ctl.healthState = "terminated"
	h.ctl.mu.Unlock()
	if h.sdk.health() {
		t.Fatal("a terminated/unhealthy server must be reported unhealthy")
	}
	h.ctl.close() // unreachable control listener
	if h.sdk.health() {
		t.Fatal("an unreachable control API must be reported unhealthy")
	}
	h.cancel()
	h.wait(3 * time.Second)
}

func TestFailsClosedWhenServerDoesNotEnforceAdmit(t *testing.T) {
	for name, mut := range map[string]func(*fakeControl){
		"no control object":  func(c *fakeControl) { c.noControl = true },
		"requireAdmit false": func(c *fakeControl) { c.requireOK = false },
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, func(_ *Config, c *fakeControl) { mut(c) })
			h.run()
			if code := h.wait(3 * time.Second); code != ExitFailed {
				t.Fatalf("exit %d, want failure", code)
			}
			h.never("ProcessReady") // GameLift must never be told this process can take sessions
		})
	}
}

func TestAllowNoAdmitOverrideIsExplicit(t *testing.T) {
	h := newHarness(t, func(c *Config, f *fakeControl) { c.AllowNoAdmit = true; f.noControl = true })
	h.run()
	h.ready()
	h.sdk.terminate()
	h.wait(3 * time.Second)
}

func TestServerCrashEndsTheProcess(t *testing.T) {
	h := newHarness(t, nil)
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	h.exit <- errTest("exit status 101")
	if code := h.wait(3 * time.Second); code != ExitFailed {
		t.Fatalf("exit %d, want failure", code)
	}
	h.before("Activate", "ProcessEnding")
}

func TestServerExitDuringDrainIsNotACrash(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.DrainDeadline = 5 * time.Second })
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	h.sdk.terminate()
	waitFor(t, "drain", func() bool { return h.rec.index("ctl:drain") >= 0 })
	h.exit <- nil // rh-server exits by itself after its last room closed
	if code := h.wait(3 * time.Second); code != ExitOK {
		t.Fatalf("exit %d, want ok", code)
	}
}

func TestRejectedPlayerSessionIsKicked(t *testing.T) {
	h := newHarness(t, nil)
	h.sdk.acceptErr["psess-bad"] = &RejectedError{Err: errTest("player session not valid")}
	h.run()
	h.ready()
	h.sdk.startSession(session())
	h.sdk.reserve(PlayerSession{ID: "psess-bad", PlayerID: "mallory"})
	waitFor(t, "admit", func() bool { return h.rec.index("ctl:admit:psess-bad") >= 0 })
	h.ctl.seat(gs, "psess-bad")
	waitFor(t, "kick", func() bool { return h.rec.index("ctl:leave:kick:psess-bad") >= 0 })
	h.ctl.closeRoom(gs, "completed")
	h.wait(3 * time.Second)
}

func TestRemoveIsRetriedAndAckedOnlyAfterSuccess(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.SDKRetries = 0 }) // force the failure to surface to the next poll
	h.sdk.removeFails["psess-1"] = 2
	h.run()
	h.ready()
	h.sdk.startSession(session())
	h.sdk.reserve(PlayerSession{ID: "psess-1", PlayerID: "alice"})
	waitFor(t, "admit", func() bool { return h.rec.index("ctl:admit:psess-1") >= 0 })
	h.ctl.seat(gs, "psess-1")
	waitFor(t, "Accept", func() bool { return h.rec.index("Accept:psess-1") >= 0 })
	h.ctl.setStatus(gs, "psess-1", "left", "grace_expired")
	waitFor(t, "ack", func() bool { return h.rec.index("ctl:leave:ack:psess-1") >= 0 })
	if n := h.rec.count("Remove:psess-1"); n != 3 {
		t.Fatalf("Remove attempts = %d, want 3 (two failures, then success)", n)
	}
	// The ack comes only after the third (successful) Remove.
	ev := h.rec.snapshot()
	last := -1
	for i, e := range ev {
		if e == "Remove:psess-1" {
			last = i
		}
	}
	if h.rec.index("ctl:leave:ack:psess-1") < last {
		t.Fatalf("acked before the final Remove: %v", ev)
	}
	h.ctl.closeRoom(gs, "completed")
	h.wait(3 * time.Second)
}

func TestInvalidPlayerIDIsNeverAdmitted(t *testing.T) {
	h := newHarness(t, nil)
	h.run()
	h.ready()
	h.sdk.startSession(session())
	h.sdk.reserve(PlayerSession{ID: "psess-x", PlayerID: "not a callsign!"})
	time.Sleep(60 * time.Millisecond)
	h.never("ctl:admit:")
	h.ctl.closeRoom(gs, "completed")
	h.wait(3 * time.Second)
}

func TestSecondGameSessionIsRefusedNotServed(t *testing.T) {
	h := newHarness(t, nil)
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	h.sdk.startSession(GameSession{ID: "gs-2", MaxPlayers: 8})
	time.Sleep(50 * time.Millisecond)
	if h.rec.count("ctl:session") != 1 || h.rec.count("Activate") != 1 {
		t.Fatalf("a second session was served: %v", h.rec.snapshot())
	}
	h.ctl.closeRoom(gs, "completed")
	h.wait(3 * time.Second)
}

type errTest string

func (e errTest) Error() string { return string(e) }

func asAPI(err error, target **APIError) bool {
	ae, ok := err.(*APIError)
	if ok {
		*target = ae
	}
	return ok
}

// seatedBridge returns a harness (not running) with a game session created in the fake control server and psess-1 seated.
func seatedBridge(t *testing.T, mut func(*Config, *fakeControl)) (*harness, *sessionState) {
	t.Helper()
	h := newHarness(t, mut)
	ctx := context.Background()
	if _, err := h.bridge.ctl.CreateSession(ctx, gs, SessionProps{}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.bridge.ctl.Admit(ctx, gs, "psess-1", "alice"); err != nil {
		t.Fatal(err)
	}
	h.ctl.seat(gs, "psess-1")
	st := &sessionState{gsID: gs, admitted: map[string]bool{}, accepted: map[string]bool{}, removed: map[string]bool{},
		kicked: map[string]bool{}, acceptSince: map[string]time.Time{}}
	return h, st
}

// B-M3: a transient AWS error is not a verdict. The player must not be kicked; the next poll retries and succeeds.
func TestTransientAcceptErrorDoesNotKickAndIsRetried(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.SDKRetries = 0 })
	h.sdk.acceptFail["psess-1"] = 3 // three whole polls fail, the fourth succeeds
	h.run()
	h.ready()
	h.sdk.startSession(session())
	h.sdk.reserve(PlayerSession{ID: "psess-1", PlayerID: "alice"})
	waitFor(t, "admit", func() bool { return h.rec.index("ctl:admit:psess-1") >= 0 })
	h.ctl.seat(gs, "psess-1")
	waitFor(t, "4 Accept attempts", func() bool { return h.rec.count("Accept:psess-1") >= 4 })
	h.ctl.setStatus(gs, "psess-1", "left", "grace_expired")
	// Only an accepted seat is reported gone to GameLift: proves the retry succeeded.
	waitFor(t, "Remove after the successful accept", func() bool { return h.rec.index("Remove:psess-1") >= 0 })
	h.never("ctl:leave:kick")
	h.ctl.closeRoom(gs, "completed")
	h.wait(3 * time.Second)
}

// B-M3: retries are bounded: past the reservation window a player GameLift never validated is kicked.
func TestTransientAcceptErrorIsBoundedByTheGiveUpWindow(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.SDKRetries = 0; c.AcceptGiveUp = 80 * time.Millisecond })
	h.sdk.acceptErr["psess-1"] = errTest("throttled forever")
	h.run()
	h.ready()
	h.sdk.startSession(session())
	h.sdk.reserve(PlayerSession{ID: "psess-1", PlayerID: "alice"})
	waitFor(t, "admit", func() bool { return h.rec.index("ctl:admit:psess-1") >= 0 })
	h.ctl.seat(gs, "psess-1")
	waitFor(t, "kick after the window", func() bool { return h.rec.index("ctl:leave:kick:psess-1") >= 0 })
	if n := h.rec.count("Accept:psess-1"); n < 2 {
		t.Fatalf("kicked after %d attempts: a transient error must be retried before the window ends", n)
	}
	h.ctl.closeRoom(gs, "completed")
	h.wait(3 * time.Second)
}

// B-M3: cancellation (shutdown) during AcceptPlayerSession is not a rejection: nobody is kicked.
func TestCancelledAcceptIsNotARejection(t *testing.T) {
	h, st := seatedBridge(t, func(c *Config, _ *fakeControl) { c.SDKRetries = 0 })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h.sdk.onAccept = func(string) { cancel() }
	h.sdk.acceptErr["psess-1"] = errTest("connection closed by shutdown")
	h.bridge.reconcile(ctx, st)
	if st.kicked["psess-1"] || st.accepted["psess-1"] {
		t.Fatalf("kicked=%v accepted=%v after a cancelled accept", st.kicked["psess-1"], st.accepted["psess-1"])
	}
	h.never("ctl:leave:kick")
}

// B-M5: with a token configured, a server that does not enforce it is refused (fail closed); one that does is accepted.
func TestControlTokenMustBeEnforcedByTheServer(t *testing.T) {
	h := newHarness(t, nil)
	h.ctl.token, h.ctl.ignoreToken = "s3cret", true
	h.bridge.ctl.Token = "s3cret"
	h.run()
	if code := h.wait(3 * time.Second); code != ExitFailed {
		t.Fatalf("exit %d, want failure for a server that ignores the token", code)
	}
	h.never("ProcessReady")

	h2 := newHarness(t, nil)
	h2.ctl.token = "s3cret"
	h2.bridge.ctl.Token = "s3cret"
	h2.run()
	h2.ready() // enforced: the unauthenticated probe got 401
	h2.sdk.terminate()
	h2.wait(3 * time.Second)
}

// B-L6: a server that exits non-zero while draining is a failure, not a clean end.
func TestServerFailureWhileDrainingIsReportedAsFailure(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.DrainDeadline = 5 * time.Second })
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	h.sdk.terminate()
	waitFor(t, "drain", func() bool { return h.rec.index("ctl:drain") >= 0 })
	h.exit <- errTest("exit status 101")
	if code := h.wait(3 * time.Second); code != ExitFailed {
		t.Fatalf("exit %d, want failure", code)
	}
	if h.rec.index("ProcessEnding") < 0 {
		t.Fatal("ProcessEnding must still be reported")
	}
}

// B-L6: the final report frees accepted seats from the last poll when the server is already gone.
func TestFinalReportRemovesAcceptedGoneSeats(t *testing.T) {
	h, st := seatedBridge(t, nil)
	st.accepted["psess-1"] = true
	st.lastPlayers = []RoomPlayer{{PlayerSessionID: "psess-1", Status: "left"}, {PlayerSessionID: "psess-2", Status: "left"}}
	h.bridge.finalReport(st)
	if h.rec.index("Remove:psess-1") < 0 || h.rec.index("Remove:psess-2") >= 0 {
		t.Fatalf("want only the accepted seat removed: %v", h.rec.snapshot())
	}
}

// B-L9: a hung control call must not delay terminate: the drain request goes out while /control/rooms is still hanging.
func TestTerminatePreemptsAHungPoll(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.PollBudget = 30 * time.Second; c.DrainDeadline = 5 * time.Second })
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	hang := make(chan struct{})
	h.ctl.mu.Lock()
	h.ctl.hangRooms = hang
	h.ctl.mu.Unlock()
	defer func() {
		select {
		case <-hang:
		default:
			close(hang)
		}
	}()
	waitFor(t, "a poll to hang", func() bool { return h.ctl.hitCount("/control/rooms") > 0 })
	start := time.Now()
	h.sdk.terminate()
	waitFor(t, "drain while rooms hangs", func() bool { return h.rec.index("ctl:drain") >= 0 })
	if d := time.Since(start); d > 1500*time.Millisecond {
		t.Fatalf("drain took %s after terminate", d)
	}
	close(hang)
	h.ctl.closeRoom(gs, "completed")
	h.wait(3 * time.Second)
}

// Data loss path: ProcessEnding only after rh-server exited. This fake server needs 6 s to exit (longer than the old 5 s
// kill), and the bridge must wait for it.
func TestProcessEndingWaitsForASlowServerExit(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.ServerExitGrace = 20 * time.Second })
	h.ctl.onDrain = func(allClosed bool) {
		if allClosed {
			time.AfterFunc(6*time.Second, func() { h.rec.add("server:exit"); h.exit <- nil })
		}
	}
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	start := time.Now()
	h.ctl.closeRoom(gs, "completed")
	if code := h.wait(15 * time.Second); code != ExitOK {
		t.Fatalf("exit %d, want ok", code)
	}
	if d := time.Since(start); d < 6*time.Second {
		t.Fatalf("ended after %s, before the server exited", d)
	}
	h.before("server:exit", "ProcessEnding")
}

// A server that never exits is cut at the grace: loud, non-zero, ProcessEnding still reported.
func TestForcedEndWhenServerDoesNotExit(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.ServerExitGrace = 150 * time.Millisecond })
	h.ctl.onDrain = nil // the server never exits
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	h.ctl.closeRoom(gs, "completed")
	if code := h.wait(3 * time.Second); code != ExitFailed {
		t.Fatalf("exit %d, want failure for a forced end", code)
	}
	if h.rec.index("ProcessEnding") < 0 {
		t.Fatal("ProcessEnding must be called once the grace forces it")
	}
}

// The wait is capped below GameLift's termination time even when the configured grace is much longer.
func TestServerExitGraceIsCappedByTerminationTime(t *testing.T) {
	h := newHarness(t, func(c *Config, _ *fakeControl) { c.ServerExitGrace = time.Hour })
	h.sdk.termTime = time.Now().Add(400 * time.Millisecond)
	h.ctl.onDrain = nil
	h.run()
	h.ready()
	h.sdk.startSession(session())
	waitFor(t, "Activate", func() bool { return h.rec.index("Activate") >= 0 })
	h.ctl.closeRoom(gs, "completed")
	if code := h.wait(3 * time.Second); code != ExitFailed {
		t.Fatalf("exit %d, want failure", code)
	}
}

// When drain cannot be sent the server will not exit by itself: the bridge asks it to stop and still waits for the exit.
func TestFailedDrainAsksTheServerToStopThenWaitsForItsExit(t *testing.T) {
	h := newHarness(t, nil)
	h.ctl.failBefore["/control/drain"] = 1000
	h.bridge.StopServer = func() { h.rec.add("stopServer"); h.exit <- nil }
	h.run()
	h.ready()
	h.sdk.terminate()
	if code := h.wait(3 * time.Second); code != ExitOK {
		t.Fatalf("exit %d", code)
	}
	h.before("stopServer", "ProcessEnding")
}
