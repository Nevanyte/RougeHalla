package main

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// recorder is one ordered event log shared by the fake SDK and the fake control server, so tests can assert cross-system
// ordering (for example: ProcessEnding only after the room closed).
type recorder struct {
	mu     sync.Mutex
	events []string
}

func (r *recorder) add(format string, a ...any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, fmt.Sprintf(format, a...))
}

func (r *recorder) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.events...)
}

func (r *recorder) count(prefix string) int {
	n := 0
	for _, e := range r.snapshot() {
		if strings.HasPrefix(e, prefix) {
			n++
		}
	}
	return n
}

// index returns the position of the first event equal to e, or -1.
func (r *recorder) index(e string) int {
	for i, x := range r.snapshot() {
		if x == e {
			return i
		}
	}
	return -1
}

// fakeSDK implements SDK with no network. The test drives GameLift's side by calling the captured callbacks.
type fakeSDK struct {
	rec *recorder

	mu            sync.Mutex
	cb            Callbacks
	reserved      []PlayerSession
	activateErr   error
	acceptErr     map[string]error
	removeFails   map[string]int // psess -> number of failures before success
	termTime      time.Time
	initErr       error
	describeErr   error
	processEnding int
}

func newFakeSDK(rec *recorder) *fakeSDK {
	return &fakeSDK{rec: rec, acceptErr: map[string]error{}, removeFails: map[string]int{}}
}

func (f *fakeSDK) InitSDK() error {
	f.rec.add("InitSDK")
	return f.initErr
}

func (f *fakeSDK) ProcessReady(cb Callbacks) error {
	f.mu.Lock()
	f.cb = cb
	f.mu.Unlock()
	f.rec.add("ProcessReady:%d", cb.Port)
	return nil
}

func (f *fakeSDK) ActivateGameSession() error {
	f.rec.add("Activate")
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.activateErr
}

func (f *fakeSDK) AcceptPlayerSession(id string) error {
	f.rec.add("Accept:%s", id)
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.acceptErr[id]
}

func (f *fakeSDK) RemovePlayerSession(id string) error {
	f.rec.add("Remove:%s", id)
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.removeFails[id] > 0 {
		f.removeFails[id]--
		return errors.New("transient GameLift error")
	}
	return nil
}

func (f *fakeSDK) ReservedPlayerSessions(string) ([]PlayerSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.describeErr != nil {
		return nil, f.describeErr
	}
	return append([]PlayerSession(nil), f.reserved...), nil
}

func (f *fakeSDK) TerminationTime() (time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.termTime.IsZero() {
		return time.Time{}, errors.New("no termination time")
	}
	return f.termTime, nil
}

func (f *fakeSDK) ProcessEnding() error {
	f.rec.add("ProcessEnding")
	f.mu.Lock()
	f.processEnding++
	f.mu.Unlock()
	return nil
}

func (f *fakeSDK) Destroy() error {
	f.rec.add("Destroy")
	return nil
}

// GameLift-side drivers.
func (f *fakeSDK) startSession(gs GameSession) {
	f.mu.Lock()
	cb := f.cb
	f.mu.Unlock()
	cb.OnStartGameSession(gs)
}

func (f *fakeSDK) terminate() {
	f.mu.Lock()
	cb := f.cb
	f.mu.Unlock()
	cb.OnProcessTerminate()
}

func (f *fakeSDK) health() bool {
	f.mu.Lock()
	cb := f.cb
	f.mu.Unlock()
	return cb.OnHealthCheck()
}

func (f *fakeSDK) reserve(ps ...PlayerSession) {
	f.mu.Lock()
	f.reserved = append(f.reserved, ps...)
	f.mu.Unlock()
}
