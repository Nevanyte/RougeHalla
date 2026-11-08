package main

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A definitive rejection must remain a kick decision across failed/ambiguous control delivery, including reconnect grace.
func TestRejectedPlayerKickSurvivesControlFailure(t *testing.T) {
	for _, mode := range []string{"before", "after", "away"} {
		t.Run(mode, func(t *testing.T) {
			h := newHarness(t, nil)
			h.bridge.ctl.Retries = 0
			h.bridge.cfg.SDKRetries = 0
			ctx := context.Background()
			if _, err := h.bridge.ctl.CreateSession(ctx, gs, SessionProps{}); err != nil {
				t.Fatal(err)
			}
			if _, err := h.bridge.ctl.Admit(ctx, gs, "psess-reject", "alice"); err != nil {
				t.Fatal(err)
			}
			h.ctl.seat(gs, "psess-reject")
			h.sdk.acceptErr["psess-reject"] = &RejectedError{Err: errors.New("definitive refusal")}
			if mode == "after" {
				h.ctl.dropAfter["/control/leave"] = 1
			} else {
				h.ctl.failBefore["/control/leave"] = 1
			}
			st := &sessionState{gsID: gs, admitted: map[string]bool{}, accepted: map[string]bool{}, removed: map[string]bool{}, kicked: map[string]bool{}, acceptSince: map[string]time.Time{}}
			h.bridge.reconcile(ctx, st)
			if !st.kicked["psess-reject"] {
				t.Fatal("rejection decision was lost")
			}
			if mode == "away" {
				h.ctl.setStatus(gs, "psess-reject", "away", "")
			}
			// A later SDK success must not undo a definitive rejection. Only the idempotent kick is retried.
			h.sdk.acceptErr["psess-reject"] = nil
			for i := 0; i < 3; i++ {
				h.bridge.reconcile(ctx, st)
			}
			if got := h.rec.count("Accept:psess-reject"); got != 1 {
				t.Fatalf("accept retried after definitive rejection: %d", got)
			}
			if !st.removed["psess-reject"] {
				t.Fatal("rejected seat never reached the acknowledged final state")
			}
			rr, err := h.bridge.ctl.Rooms(ctx)
			if err != nil {
				t.Fatal(err)
			}
			for _, r := range rr.Rooms {
				for _, p := range r.Players {
					if p.PlayerSessionID == "psess-reject" && (p.Status == "seated" || p.Status == "away") {
						t.Fatal("SDK-rejected player still holds seat")
					}
				}
			}
		})
	}
}
