//go:build fakesdk

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"sync"
	"time"
)

// scriptSDK is the local end-to-end harness's stand-in for GameLift (build tag `fakesdk`, never in the production image).
// It implements SDK with no network. GameLift's side is driven over a loopback HTTP script port (GLBRIDGE_FAKE_ADDR, default
// 127.0.0.1:7790), so a test in another language can play GameLift against the real bridge and the real rh-server:
//
//	POST /start     {"id":"gs-1","maxPlayers":4,"properties":{"fillBotsTo":"0"}}   OnStartGameSession
//	POST /reserve   {"id":"psess-1","playerId":"alice"}                            a RESERVED player session appears
//	POST /terminate                                                                OnProcessTerminate
//	GET  /calls                                                                    ["InitSDK","ProcessReady:35000",...]
//
// GLBRIDGE_FAKE_CALLS=<file> additionally appends every SDK call, one per line, to that file.
//
//	GET  /health                                                                   the bridge's OnHealthCheck answer
type scriptSDK struct {
	mu       sync.Mutex
	cb       Callbacks
	calls    []string
	reserved []PlayerSession
	termTime time.Time
}

func newSDK() SDK {
	s := &scriptSDK{}
	addr := envOr("GLBRIDGE_FAKE_ADDR", "127.0.0.1:7790")
	host, _, err := net.SplitHostPort(addr)
	if err != nil || (host != "127.0.0.1" && host != "::1" && host != "localhost") {
		fmt.Fprintln(os.Stderr, "GLBRIDGE_FAKE_ADDR must be a loopback host:port")
		os.Exit(2)
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "fake SDK script port:", err)
		os.Exit(2)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/start", s.start)
	mux.HandleFunc("/reserve", s.reserve)
	mux.HandleFunc("/terminate", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		cb := s.cb
		if cb.OnProcessTerminate != nil {
			s.termTime = time.Now().Add(5 * time.Minute)
		}
		s.mu.Unlock()
		if cb.OnProcessTerminate == nil {
			http.Error(w, "ProcessReady not called yet", http.StatusConflict)
			return
		}
		go cb.OnProcessTerminate()
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/calls", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		_ = json.NewEncoder(w).Encode(s.calls)
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		cb := s.cb
		s.mu.Unlock()
		if cb.OnHealthCheck == nil {
			http.Error(w, "ProcessReady not called yet", http.StatusConflict)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"healthy": cb.OnHealthCheck()})
	})
	go func() { _ = http.Serve(ln, mux) }()
	slog.Info("fake SDK (fakesdk build): scripted GameLift, not for production", "scriptAddr", addr)
	return s
}

// record keeps the call in memory (GET /calls) and, with GLBRIDGE_FAKE_CALLS=<file>, appends it to that file at once, so a
// harness can still read the last calls (ProcessEnding, Destroy) after the bridge process exited.
func (s *scriptSDK) record(format string, a ...any) {
	line := fmt.Sprintf(format, a...)
	s.mu.Lock()
	s.calls = append(s.calls, line)
	if path := os.Getenv("GLBRIDGE_FAKE_CALLS"); path != "" {
		if f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600); err == nil {
			_, _ = f.WriteString(line + "\n")
			_ = f.Close()
		}
	}
	s.mu.Unlock()
}

func (s *scriptSDK) start(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID         string            `json:"id"`
		MaxPlayers int               `json:"maxPlayers"`
		Properties map[string]string `json:"properties"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.ID == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	cb := s.cb
	s.mu.Unlock()
	if cb.OnStartGameSession == nil {
		http.Error(w, "ProcessReady not called yet", http.StatusConflict)
		return
	}
	go cb.OnStartGameSession(GameSession{ID: in.ID, MaxPlayers: in.MaxPlayers, Properties: in.Properties})
	w.WriteHeader(http.StatusOK)
}

func (s *scriptSDK) reserve(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID       string `json:"id"`
		PlayerID string `json:"playerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.ID == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.reserved = append(s.reserved, PlayerSession{ID: in.ID, PlayerID: in.PlayerID})
	s.mu.Unlock()
	w.WriteHeader(http.StatusOK)
}

func (s *scriptSDK) InitSDK() error { s.record("InitSDK"); return nil }

func (s *scriptSDK) ProcessReady(cb Callbacks) error {
	s.mu.Lock()
	s.cb = cb
	s.mu.Unlock()
	s.record("ProcessReady:%d", cb.Port)
	return nil
}

func (s *scriptSDK) ActivateGameSession() error { s.record("Activate"); return nil }

// AcceptPlayerSession moves the session out of RESERVED, as GameLift does.
func (s *scriptSDK) AcceptPlayerSession(id string) error {
	s.record("Accept:%s", id)
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.reserved[:0]
	for _, p := range s.reserved {
		if p.ID != id {
			kept = append(kept, p)
		}
	}
	s.reserved = kept
	return nil
}

func (s *scriptSDK) RemovePlayerSession(id string) error { s.record("Remove:%s", id); return nil }

func (s *scriptSDK) ReservedPlayerSessions(string) ([]PlayerSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]PlayerSession(nil), s.reserved...), nil
}

func (s *scriptSDK) TerminationTime() (time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.termTime.IsZero() {
		return time.Time{}, errors.New("no termination time")
	}
	return s.termTime, nil
}

func (s *scriptSDK) ProcessEnding() error { s.record("ProcessEnding"); return nil }
func (s *scriptSDK) Destroy() error       { s.record("Destroy"); return nil }
