package main

import "time"

// The bridge talks to GameLift only through this interface. main uses sdk_real.go (the official Go server SDK); tests use a
// fake. Nothing else in the bridge imports a GameLift type, which keeps the AWS surface to one adapter file.

// GameSession is the part of GameLift's GameSession the bridge needs.
type GameSession struct {
	ID         string
	Name       string
	Data       string // GameSessionData (opaque, up to 256 KiB at GameLift; the bridge reads only JSON "properties")
	MaxPlayers int
	Properties map[string]string
}

// PlayerSession is a reserved or active player session.
type PlayerSession struct {
	ID       string // psess-...
	PlayerID string // the callsign (see docs/hosting/CONTROL_API.md section 2)
}

// Callbacks are the ProcessReady callbacks. They are invoked on SDK goroutines and must return promptly.
type Callbacks struct {
	Port               int
	OnStartGameSession func(GameSession)
	OnProcessTerminate func()
	OnHealthCheck      func() bool
}

type SDK interface {
	InitSDK() error
	ProcessReady(Callbacks) error
	ActivateGameSession() error
	AcceptPlayerSession(playerSessionID string) error
	RemovePlayerSession(playerSessionID string) error
	// ReservedPlayerSessions lists the game session's player sessions in status RESERVED.
	ReservedPlayerSessions(gameSessionID string) ([]PlayerSession, error)
	// TerminationTime reports when GameLift will stop the process after OnProcessTerminate.
	TerminationTime() (time.Time, error)
	ProcessEnding() error
	Destroy() error
}
