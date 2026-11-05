package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client for the rh-server control API v1 (docs/hosting/CONTROL_API.md). Every call it makes is idempotent by contract, so
// transport errors and 5xx are retried with backoff and no read-before-write.

const controlVersion = 1

type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("control API %d %s: %s", e.Status, e.Code, e.Message)
}

// IsConflict reports a 409 with the given code ("" matches any 409).
func IsConflict(err error, code string) bool {
	var ae *APIError
	return errors.As(err, &ae) && ae.Status == http.StatusConflict && (code == "" || ae.Code == code)
}

type Health struct {
	State   string
	Healthy bool // HTTP 200
	Control *ControlInfo
}

type ControlInfo struct {
	V            int  `json:"v"`
	RequireAdmit bool `json:"requireAdmit"`
	MaxRooms     int  `json:"maxRooms"`
	AdmitTTLMs   int  `json:"admitTtlMs"`
}

type SessionProps struct {
	MaxPlayers *int `json:"maxPlayers,omitempty"`
	FillBotsTo *int `json:"fillBotsTo,omitempty"`
}

type CreateResult struct {
	Created bool   `json:"created"`
	RoomID  string `json:"roomId"`
	Phase   string `json:"phase"`
}

type AdmitResult struct {
	State       string `json:"state"` // admitted | consumed | expired | left
	ExpiresInMs int    `json:"expiresInMs"`
}

type RoomPlayer struct {
	PlayerSessionID  string `json:"playerSessionId"`
	Callsign         string `json:"callsign"`
	Status           string `json:"status"` // admitted | seated | away | left | expired
	Reason           string `json:"reason"`
	GraceRemainingMs *int   `json:"graceRemainingMs"`
}

type Room struct {
	GameSessionID string       `json:"gameSessionId"`
	RoomID        string       `json:"roomId"`
	Phase         string       `json:"phase"` // lobby | active | ended | closed
	Rev           int          `json:"rev"`
	EndReason     string       `json:"endReason"`
	Players       []RoomPlayer `json:"players"`
}

type RoomsResult struct {
	State    string `json:"state"`
	Draining bool   `json:"draining"`
	Rooms    []Room `json:"rooms"`
}

type Control struct {
	Base    string // http://127.0.0.1:7778
	Token   string // optional bearer token
	HTTP    *http.Client
	Retries int           // extra attempts after the first for retryable failures
	Backoff time.Duration // first backoff, doubled each attempt
}

func NewControl(base, token string) *Control {
	return &Control{
		Base:    strings.TrimRight(base, "/"),
		Token:   token,
		HTTP:    &http.Client{Timeout: 5 * time.Second},
		Retries: 4,
		Backoff: 100 * time.Millisecond,
	}
}

func (c *Control) once(ctx context.Context, method, path string, in any) (int, []byte, error) {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.Base+path, body)
	if err != nil {
		return 0, nil, err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, data, err
}

// call performs a request with retry on transport errors and 5xx (except 503 not_ready on health, which callers poll).
func (c *Control) call(ctx context.Context, method, path string, in, out any) error {
	delay := c.Backoff
	var last error
	for attempt := 0; attempt <= c.Retries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}
			delay *= 2
		}
		status, data, err := c.once(ctx, method, path, in)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			last = err
			continue
		}
		if status >= 500 {
			last = apiError(status, data)
			continue
		}
		if status >= 400 {
			return apiError(status, data)
		}
		if out != nil {
			if err := json.Unmarshal(data, out); err != nil {
				return fmt.Errorf("control API %s %s: bad JSON: %w", method, path, err)
			}
		}
		return nil
	}
	return fmt.Errorf("control API %s %s failed after %d attempts: %w", method, path, c.Retries+1, last)
}

func apiError(status int, data []byte) *APIError {
	var e struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(data, &e)
	if e.Error.Code == "" {
		e.Error.Code = "unknown"
	}
	return &APIError{Status: status, Code: e.Error.Code, Message: e.Error.Message}
}

// Health does a single probe (no retry): a health callback must answer within its own deadline.
func (c *Control) Health(ctx context.Context) (Health, error) {
	status, data, err := c.once(ctx, http.MethodGet, "/control/health", nil)
	if err != nil {
		return Health{}, err
	}
	var b struct {
		State   string       `json:"state"`
		Control *ControlInfo `json:"control"`
	}
	if err := json.Unmarshal(data, &b); err != nil {
		return Health{}, fmt.Errorf("control health: bad JSON (status %d): %w", status, err)
	}
	return Health{State: b.State, Healthy: status == http.StatusOK, Control: b.Control}, nil
}

func (c *Control) CreateSession(ctx context.Context, gameSessionID string, p SessionProps) (CreateResult, error) {
	var r CreateResult
	err := c.call(ctx, http.MethodPost, "/control/session", map[string]any{"v": controlVersion, "gameSessionId": gameSessionID, "properties": p}, &r)
	return r, err
}

func (c *Control) Admit(ctx context.Context, gameSessionID, playerSessionID, callsign string) (AdmitResult, error) {
	var r AdmitResult
	err := c.call(ctx, http.MethodPost, "/control/admit", map[string]any{"v": controlVersion, "gameSessionId": gameSessionID, "playerSessionId": playerSessionID, "callsign": callsign}, &r)
	return r, err
}

func (c *Control) Rooms(ctx context.Context) (RoomsResult, error) {
	var r RoomsResult
	err := c.call(ctx, http.MethodGet, "/control/rooms", nil, &r)
	return r, err
}

func (c *Control) Leave(ctx context.Context, gameSessionID, playerSessionID, mode string) error {
	return c.call(ctx, http.MethodPost, "/control/leave", map[string]any{"v": controlVersion, "gameSessionId": gameSessionID, "playerSessionId": playerSessionID, "mode": mode}, nil)
}

func (c *Control) End(ctx context.Context, gameSessionID, mode string) error {
	return c.call(ctx, http.MethodPost, "/control/end", map[string]any{"v": controlVersion, "gameSessionId": gameSessionID, "mode": mode}, nil)
}

func (c *Control) Drain(ctx context.Context) error {
	return c.call(ctx, http.MethodPost, "/control/drain", map[string]any{"v": controlVersion}, nil)
}

// ProbeUnauthenticated sends GET /control/health without the bearer token and returns the HTTP status. A server that enforces
// --control-token-file answers 401.
func (c *Control) ProbeUnauthenticated(ctx context.Context) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.Base+"/control/health", nil)
	if err != nil {
		return 0, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, nil
}
