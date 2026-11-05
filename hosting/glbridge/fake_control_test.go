package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"time"
)

// fakeControl is an executable reading of docs/hosting/CONTROL_API.md: the session/admit/leave/end/drain/rooms semantics
// the Rust server must implement. The bridge tests run against it; conformance_test.go checks the fake itself against the
// contract's idempotency, replay and expiry rules so the Rust side can port those cases.
type fakeControl struct {
	rec *recorder
	srv *httptest.Server

	mu          sync.Mutex
	maxRooms    int
	requireOK   bool // report control.requireAdmit
	noControl   bool // omit the control object (a server that predates the contract)
	notReady    bool
	draining    bool
	rooms       map[string]*fRoom
	order       []string
	admitOwner  map[string]string // callsign -> playerSessionId (pending or seated)
	failBefore  map[string]int    // path -> times to answer 500 without applying
	dropAfter   map[string]int    // path -> times to apply, then kill the connection (the client sees a transport error)
	hits        map[string]int
	healthState string
}

type fPlayer struct {
	psess, callsign, status, reason string
	expiresAt                       time.Time
}

type fRoom struct {
	gsID, id, phase, endReason string
	props                      SessionProps
	rev                        int
	players                    []*fPlayer
	seen                       map[string]string // psess -> final state for replay protection
}

func newFakeControl(rec *recorder) *fakeControl {
	f := &fakeControl{rec: rec, maxRooms: 1, requireOK: true, rooms: map[string]*fRoom{}, admitOwner: map[string]string{},
		failBefore: map[string]int{}, dropAfter: map[string]int{}, hits: map[string]int{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/control/health", f.health)
	mux.HandleFunc("/control/session", f.wrap(f.session))
	mux.HandleFunc("/control/admit", f.wrap(f.admit))
	mux.HandleFunc("/control/rooms", f.wrap(f.roomsH))
	mux.HandleFunc("/control/leave", f.wrap(f.leave))
	mux.HandleFunc("/control/end", f.wrap(f.end))
	mux.HandleFunc("/control/drain", f.wrap(f.drain))
	f.srv = httptest.NewServer(mux)
	return f
}

func (f *fakeControl) close() { f.srv.Close() }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func errJSON(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]any{"v": 1, "error": map[string]any{"code": code, "message": code}})
}

// wrap injects the transport faults used by the retry tests, around the real handler.
func (f *fakeControl) wrap(h func(http.ResponseWriter, *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.hits[r.URL.Path]++
		if f.failBefore[r.URL.Path] > 0 {
			f.failBefore[r.URL.Path]--
			f.mu.Unlock()
			errJSON(w, 500, "injected")
			return
		}
		drop := f.dropAfter[r.URL.Path] > 0
		if drop {
			f.dropAfter[r.URL.Path]--
		}
		f.mu.Unlock()
		if drop {
			rec := httptest.NewRecorder()
			h(rec, r) // applied
			if hj, ok := w.(http.Hijacker); ok {
				if c, _, err := hj.Hijack(); err == nil {
					_ = c.Close()
				}
			}
			return
		}
		h(w, r)
	}
}

func (f *fakeControl) health(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hits["/control/health"]++
	state, code := "ready", 200
	switch {
	case f.notReady:
		state, code = "starting", 503
	case f.draining:
		state, code = "draining", 503
	}
	if f.healthState != "" {
		state = f.healthState
		code = 503
	}
	body := map[string]any{"v": 1, "state": state, "rooms": len(f.rooms)}
	if !f.noControl {
		body["control"] = map[string]any{"v": 1, "requireAdmit": f.requireOK, "maxRooms": f.maxRooms, "admitTtlMs": 60000}
	}
	writeJSON(w, code, body)
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		errJSON(w, 400, "bad_request")
		return false
	}
	return true
}

func (f *fakeControl) session(w http.ResponseWriter, r *http.Request) {
	var in struct {
		V             int          `json:"v"`
		GameSessionID string       `json:"gameSessionId"`
		Properties    SessionProps `json:"properties"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.V != 1 {
		errJSON(w, 400, "unsupported_version")
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.notReady {
		errJSON(w, 503, "not_ready")
		return
	}
	if rm, ok := f.rooms[in.GameSessionID]; ok {
		pj, _ := json.Marshal(rm.props)
		nj, _ := json.Marshal(in.Properties)
		switch {
		case rm.phase == "closed" || rm.phase == "ended":
			errJSON(w, 409, "session_ended")
		case string(pj) != string(nj):
			errJSON(w, 409, "session_conflict")
		default:
			writeJSON(w, 200, map[string]any{"v": 1, "created": false, "roomId": rm.id, "phase": rm.phase})
		}
		return
	}
	if f.draining {
		errJSON(w, 409, "draining")
		return
	}
	open := 0
	for _, rm := range f.rooms {
		if rm.phase != "closed" {
			open++
		}
	}
	if open >= f.maxRooms {
		errJSON(w, 409, "at_capacity")
		return
	}
	rm := &fRoom{gsID: in.GameSessionID, id: "00112233445566778899aabbccddeeff", phase: "lobby", props: in.Properties, seen: map[string]string{}}
	f.rooms[rm.gsID] = rm
	f.order = append(f.order, rm.gsID)
	f.rec.add("ctl:session")
	writeJSON(w, 200, map[string]any{"v": 1, "created": true, "roomId": rm.id, "phase": rm.phase})
}

func (f *fakeControl) admit(w http.ResponseWriter, r *http.Request) {
	var in struct {
		V               int    `json:"v"`
		GameSessionID   string `json:"gameSessionId"`
		PlayerSessionID string `json:"playerSessionId"`
		Callsign        string `json:"callsign"`
		TTLMs           int    `json:"ttlMs"`
	}
	if !decode(w, r, &in) {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	rm, ok := f.rooms[in.GameSessionID]
	if !ok {
		errJSON(w, 404, "no_such_session")
		return
	}
	f.expire(rm)
	if rm.phase == "closed" || rm.phase == "ended" {
		errJSON(w, 409, "session_ended")
		return
	}
	if f.draining {
		errJSON(w, 409, "draining")
		return
	}
	for _, p := range rm.players {
		if p.psess == in.PlayerSessionID {
			if p.callsign != in.Callsign {
				errJSON(w, 409, "admit_conflict")
				return
			}
			st := map[string]string{"admitted": "admitted", "seated": "consumed", "away": "consumed", "left": "left", "expired": "expired"}[p.status]
			writeJSON(w, 200, map[string]any{"v": 1, "state": st, "expiresInMs": ms(p.expiresAt)})
			return
		}
	}
	if st, ok := rm.seen[in.PlayerSessionID]; ok { // acknowledged and dropped: a replay never re-arms
		writeJSON(w, 200, map[string]any{"v": 1, "state": st, "expiresInMs": 0})
		return
	}
	if owner, held := f.admitOwner[in.Callsign]; held && owner != in.PlayerSessionID {
		errJSON(w, 409, "admit_conflict")
		return
	}
	live := 0
	for _, p := range rm.players {
		if p.status == "admitted" || p.status == "seated" || p.status == "away" {
			live++
		}
	}
	max := 8
	if rm.props.MaxPlayers != nil {
		max = *rm.props.MaxPlayers
	}
	if live >= max {
		errJSON(w, 409, "room_full")
		return
	}
	ttl := 60 * time.Second
	if in.TTLMs > 0 {
		ttl = time.Duration(in.TTLMs) * time.Millisecond
	}
	p := &fPlayer{psess: in.PlayerSessionID, callsign: in.Callsign, status: "admitted", expiresAt: time.Now().Add(ttl)}
	rm.players = append(rm.players, p)
	rm.rev++
	f.admitOwner[in.Callsign] = in.PlayerSessionID
	f.rec.add("ctl:admit:%s", in.PlayerSessionID)
	writeJSON(w, 200, map[string]any{"v": 1, "state": "admitted", "expiresInMs": ms(p.expiresAt)})
}

func ms(t time.Time) int {
	d := time.Until(t).Milliseconds()
	if d < 0 {
		return 0
	}
	return int(d)
}

// expire turns pending admits whose time ran out into the final state `expired` (never re-armed).
func (f *fakeControl) expire(rm *fRoom) {
	for _, p := range rm.players {
		if p.status == "admitted" && !time.Now().Before(p.expiresAt) {
			p.status = "expired"
			delete(f.admitOwner, p.callsign)
			rm.rev++
		}
	}
}

func (f *fakeControl) roomsH(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rooms := []map[string]any{}
	for _, id := range f.order {
		rm := f.rooms[id]
		f.expire(rm)
		ps := []map[string]any{}
		for _, p := range rm.players {
			ps = append(ps, map[string]any{"playerSessionId": p.psess, "callsign": p.callsign, "status": p.status, "reason": p.reason,
				"expiresInMs": ms(p.expiresAt), "graceRemainingMs": nil})
		}
		rooms = append(rooms, map[string]any{"gameSessionId": rm.gsID, "roomId": rm.id, "phase": rm.phase, "rev": rm.rev,
			"endReason": rm.endReason, "players": ps})
	}
	state := "ready"
	if f.draining {
		state = "draining"
	}
	writeJSON(w, 200, map[string]any{"v": 1, "state": state, "draining": f.draining, "maxRooms": f.maxRooms, "rooms": rooms})
}

func (f *fakeControl) leave(w http.ResponseWriter, r *http.Request) {
	var in struct {
		V               int    `json:"v"`
		GameSessionID   string `json:"gameSessionId"`
		PlayerSessionID string `json:"playerSessionId"`
		Mode            string `json:"mode"`
	}
	if !decode(w, r, &in) {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	rm, ok := f.rooms[in.GameSessionID]
	if !ok {
		errJSON(w, 404, "no_such_session")
		return
	}
	state := "unknown"
	for i, p := range rm.players {
		if p.psess != in.PlayerSessionID {
			continue
		}
		switch in.Mode {
		case "kick":
			if p.status == "seated" || p.status == "away" {
				p.status, p.reason = "left", "kicked"
				delete(f.admitOwner, p.callsign)
			} else if p.status == "admitted" {
				p.status = "expired"
				delete(f.admitOwner, p.callsign)
			}
			rm.rev++
			state = p.status
		case "ack":
			if p.status == "left" || p.status == "expired" {
				// Dropped records keep a replay marker: the player stays listed internally as final.
				rm.seen[p.psess] = p.status
				rm.players = append(rm.players[:i], rm.players[i+1:]...)
				state = "dropped"
			} else {
				errJSON(w, 409, "not_final") // the real server refuses to drop a record that has not ended
				return
			}
		}
		break
	}
	f.rec.add("ctl:leave:%s:%s", in.Mode, in.PlayerSessionID)
	writeJSON(w, 200, map[string]any{"v": 1, "state": state})
}

func (f *fakeControl) end(w http.ResponseWriter, r *http.Request) {
	var in struct {
		V             int    `json:"v"`
		GameSessionID string `json:"gameSessionId"`
		Mode          string `json:"mode"`
	}
	if !decode(w, r, &in) {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	rm, ok := f.rooms[in.GameSessionID]
	if !ok {
		errJSON(w, 404, "no_such_session")
		return
	}
	if in.Mode == "abort" && rm.phase != "closed" {
		f.closeLocked(rm, "ended_by_bridge")
	}
	f.rec.add("ctl:end:%s", in.Mode)
	writeJSON(w, 200, map[string]any{"v": 1, "phase": rm.phase})
}

func (f *fakeControl) drain(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.draining {
		f.rec.add("ctl:drain")
	}
	f.draining = true
	writeJSON(w, 200, map[string]any{"v": 1, "state": "draining"})
}

// closeLocked closes a room and frees its players, as the real server does (seats `left` with reason match_over).
func (f *fakeControl) closeLocked(rm *fRoom, reason string) {
	for _, p := range rm.players {
		if p.status == "seated" || p.status == "away" {
			p.status, p.reason = "left", "match_over"
		}
		if p.status == "admitted" {
			p.status = "expired"
		}
		delete(f.admitOwner, p.callsign)
	}
	rm.phase, rm.endReason = "closed", reason
	rm.rev++
	f.rec.add("room:closed:%s", reason)
}

// Server-side drivers used by tests (what a real match would do).
func (f *fakeControl) seat(gsID, psess string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range f.rooms[gsID].players {
		if p.psess == psess && p.status == "admitted" {
			p.status = "seated"
			f.rooms[gsID].rev++
		}
	}
}

func (f *fakeControl) setStatus(gsID, psess, status, reason string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range f.rooms[gsID].players {
		if p.psess == psess {
			p.status, p.reason = status, reason
			f.rooms[gsID].rev++
			if status == "left" {
				delete(f.admitOwner, p.callsign)
			}
		}
	}
}

func (f *fakeControl) closeRoom(gsID, reason string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closeLocked(f.rooms[gsID], reason)
}

func (f *fakeControl) hitCount(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits[path]
}

func (f *fakeControl) roomCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.rooms)
}

// expireNow forces a pending admit past its deadline (the real server uses its own monotonic clock).
func (f *fakeControl) expireNow(gsID, psess string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range f.rooms[gsID].players {
		if p.psess == psess {
			p.expiresAt = time.Now().Add(-time.Second)
		}
	}
}
