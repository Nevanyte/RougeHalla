package main

import (
	"bytes"
	"context"
	"net/http"
	"testing"
)

// These tests pin the contract itself (docs/hosting/CONTROL_API.md sections 3 and 4) as executable cases against the fake.
// They are not tests of the Rust server. The Rust control tests (crates/rh-server/tests/control.rs) reproduce each case
// against the real server; keep the names in sync.

func newClient(t *testing.T) (*fakeControl, *Control) {
	f := newFakeControl(&recorder{})
	t.Cleanup(f.close)
	c := NewControl(f.srv.URL, "")
	c.Retries = 0
	return f, c
}

func wantConflict(t *testing.T, err error, code string) {
	t.Helper()
	if !IsConflict(err, code) {
		t.Fatalf("want 409 %s, got %v", code, err)
	}
}

func TestContractSessionIdempotencyAndConflicts(t *testing.T) {
	f, c := newClient(t)
	ctx := context.Background()
	eight, six := 8, 6
	a, err := c.CreateSession(ctx, "gs-1", SessionProps{MaxPlayers: &eight})
	if err != nil || !a.Created {
		t.Fatalf("create: %+v %v", a, err)
	}
	b, err := c.CreateSession(ctx, "gs-1", SessionProps{MaxPlayers: &eight})
	if err != nil || b.Created || b.RoomID != a.RoomID {
		t.Fatalf("retry must return the same room with created=false: %+v %v", b, err)
	}
	_, err = c.CreateSession(ctx, "gs-1", SessionProps{MaxPlayers: &six})
	wantConflict(t, err, "session_conflict")
	_, err = c.CreateSession(ctx, "gs-2", SessionProps{})
	wantConflict(t, err, "at_capacity")
	f.closeRoom("gs-1", "completed")
	_, err = c.CreateSession(ctx, "gs-1", SessionProps{MaxPlayers: &eight})
	wantConflict(t, err, "session_ended")
	f.mu.Lock()
	f.draining = true
	f.mu.Unlock()
	_, err = c.CreateSession(ctx, "gs-3", SessionProps{})
	wantConflict(t, err, "draining")
}

func TestContractAdmitIdempotencyReplayAndExpiry(t *testing.T) {
	f, c := newClient(t)
	ctx := context.Background()
	if _, err := c.CreateSession(ctx, "gs-1", SessionProps{}); err != nil {
		t.Fatal(err)
	}
	r1, err := c.Admit(ctx, "gs-1", "psess-1", "alice")
	if err != nil || r1.State != "admitted" {
		t.Fatalf("%+v %v", r1, err)
	}
	r2, err := c.Admit(ctx, "gs-1", "psess-1", "alice")
	if err != nil || r2.State != "admitted" {
		t.Fatalf("retry of a pending admit: %+v %v", r2, err)
	}
	if r2.ExpiresInMs > r1.ExpiresInMs {
		t.Fatalf("a retry must not extend the expiry (%d > %d)", r2.ExpiresInMs, r1.ExpiresInMs)
	}
	// Same reservation bound to another callsign, and a callsign holding two reservations, are conflicts.
	_, err = c.Admit(ctx, "gs-1", "psess-1", "mallory")
	wantConflict(t, err, "admit_conflict")
	_, err = c.Admit(ctx, "gs-1", "psess-2", "alice")
	wantConflict(t, err, "admit_conflict")
	// Replay after consumption never re-arms.
	f.seat("gs-1", "psess-1")
	r3, err := c.Admit(ctx, "gs-1", "psess-1", "alice")
	if err != nil || r3.State != "consumed" {
		t.Fatalf("replay after the player seated: %+v %v", r3, err)
	}
	// Replay after leaving and being acknowledged never re-arms either.
	f.setStatus("gs-1", "psess-1", "left", "left")
	if err := c.Leave(ctx, "gs-1", "psess-1", "ack"); err != nil {
		t.Fatal(err)
	}
	r4, err := c.Admit(ctx, "gs-1", "psess-1", "alice")
	if err != nil || r4.State != "left" {
		t.Fatalf("replay after ack: %+v %v", r4, err)
	}
	// Expiry is final.
	if _, err := c.Admit(ctx, "gs-1", "psess-9", "bob"); err != nil {
		t.Fatal(err)
	}
	f.expireNow("gs-1", "psess-9")
	r5, err := c.Admit(ctx, "gs-1", "psess-9", "bob")
	if err != nil || r5.State != "expired" {
		t.Fatalf("admit after expiry must stay expired: %+v %v", r5, err)
	}
	// And the callsign is free again after expiry (a new reservation may be admitted).
	if r, err := c.Admit(ctx, "gs-1", "psess-10", "bob"); err != nil || r.State != "admitted" {
		t.Fatalf("new reservation after expiry: %+v %v", r, err)
	}
}

func TestContractAdmitRoomFullDrainingAndUnknown(t *testing.T) {
	f, c := newClient(t)
	ctx := context.Background()
	_, err := c.Admit(ctx, "nope", "psess-1", "alice")
	var ae *APIError
	if !asAPI(err, &ae) || ae.Status != http.StatusNotFound || ae.Code != "no_such_session" {
		t.Fatalf("unknown room: %v", err)
	}
	one := 1
	if _, err := c.CreateSession(ctx, "gs-1", SessionProps{MaxPlayers: &one}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Admit(ctx, "gs-1", "psess-1", "alice"); err != nil {
		t.Fatal(err)
	}
	_, err = c.Admit(ctx, "gs-1", "psess-2", "bob")
	wantConflict(t, err, "room_full")
	f.mu.Lock()
	f.draining = true
	f.mu.Unlock()
	_, err = c.Admit(ctx, "gs-1", "psess-3", "carol")
	wantConflict(t, err, "draining")
}

func TestContractLeaveKickAckAndEndAbort(t *testing.T) {
	f, c := newClient(t)
	ctx := context.Background()
	if _, err := c.CreateSession(ctx, "gs-1", SessionProps{}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Admit(ctx, "gs-1", "psess-1", "alice"); err != nil {
		t.Fatal(err)
	}
	f.seat("gs-1", "psess-1")
	if err := c.Leave(ctx, "gs-1", "psess-1", "kick"); err != nil {
		t.Fatal(err)
	}
	rr, _ := c.Rooms(ctx)
	if p := rr.Rooms[0].Players[0]; p.Status != "left" || p.Reason != "kicked" {
		t.Fatalf("after kick: %+v", p)
	}
	if err := c.Leave(ctx, "gs-1", "psess-404", "ack"); err != nil { // an unknown record is a 200
		t.Fatalf("ack of unknown: %v", err)
	}
	// Idempotent: kick again, ack twice, ack of unknown.
	for _, mode := range []string{"kick", "ack", "ack"} {
		if err := c.Leave(ctx, "gs-1", "psess-1", mode); err != nil {
			t.Fatalf("%s: %v", mode, err)
		}
	}
	if err := c.End(ctx, "gs-1", "abort"); err != nil {
		t.Fatal(err)
	}
	if err := c.End(ctx, "gs-1", "abort"); err != nil { // idempotent, and a closed tombstone still answers 200
		t.Fatal(err)
	}
	rr, _ = c.Rooms(ctx)
	if rr.Rooms[0].Phase != "closed" || rr.Rooms[0].EndReason != "ended_by_bridge" {
		t.Fatalf("after abort: %+v", rr.Rooms[0])
	}
}

func TestContractRejectsUnknownFieldsAndVersions(t *testing.T) {
	f, _ := newClient(t)
	post := func(path, body string) int {
		resp, err := http.Post(f.srv.URL+path, "application/json", bytes.NewBufferString(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}
	if got := post("/control/session", `{"v":1,"gameSessionId":"g","properties":{"mapSeed":7}}`); got != 400 {
		t.Fatalf("unknown property: %d, want 400", got)
	}
	if got := post("/control/session", `{"v":2,"gameSessionId":"g"}`); got != 400 {
		t.Fatalf("wrong version: %d, want 400", got)
	}
	if got := post("/control/admit", `{"v":1,"gameSessionId":"g","playerSessionId":"p","callsign":"a","extra":1}`); got != 400 {
		t.Fatalf("unknown field: %d, want 400", got)
	}
}
