//go:build !fakesdk

package main

import (
	"errors"
	"time"

	"github.com/amazon-gamelift/amazon-gamelift-servers-go-server-sdk/v5/model"
	"github.com/amazon-gamelift/amazon-gamelift-servers-go-server-sdk/v5/model/request"
	"github.com/amazon-gamelift/amazon-gamelift-servers-go-server-sdk/v5/server"
)

// realSDK adapts the official Go server SDK (module .../v5, pinned in go.mod). The SDK keeps package-level state, so there
// is exactly one per OS process, which is also GameLift's rule: one server process hosts one game session.
type realSDK struct{}

func (realSDK) InitSDK() error {
	// Managed fleets (including container fleets) need no parameters: the SDK reads the agent connection from the
	// environment GameLift sets (GAMELIFT_SDK_WEBSOCKET_URL etc.).
	return server.InitSDKFromEnvironment()
}

func (realSDK) ProcessReady(cb Callbacks) error {
	return server.ProcessReady(server.ProcessParameters{
		Port: cb.Port,
		OnStartGameSession: func(gs model.GameSession) {
			cb.OnStartGameSession(GameSession{
				ID:         gs.GameSessionID,
				Name:       gs.Name,
				Data:       gs.GameSessionData,
				MaxPlayers: gs.MaximumPlayerSessionCount,
				Properties: gs.GameProperties,
			})
		},
		OnProcessTerminate: cb.OnProcessTerminate,
		OnHealthCheck:      cb.OnHealthCheck,
	})
}

func (realSDK) ActivateGameSession() error          { return server.ActivateGameSession() }
func (realSDK) AcceptPlayerSession(id string) error { return server.AcceptPlayerSession(id) }
func (realSDK) RemovePlayerSession(id string) error { return server.RemovePlayerSession(id) }
func (realSDK) ProcessEnding() error                { return server.ProcessEnding() }
func (realSDK) Destroy() error                      { return server.Destroy() }

func (realSDK) ReservedPlayerSessions(gameSessionID string) ([]PlayerSession, error) {
	var out []PlayerSession
	next := ""
	for page := 0; page < 10; page++ {
		req := request.NewDescribePlayerSessions()
		req.GameSessionID = gameSessionID
		req.PlayerSessionStatusFilter = "RESERVED"
		req.Limit = 50
		req.NextToken = next
		res, err := server.DescribePlayerSessions(req)
		if err != nil {
			return nil, err
		}
		for _, ps := range res.PlayerSessions {
			out = append(out, PlayerSession{ID: ps.PlayerSessionID, PlayerID: ps.PlayerID})
		}
		if res.NextToken == "" {
			return out, nil
		}
		next = res.NextToken
	}
	return nil, errors.New("DescribePlayerSessions: more than 10 pages")
}

// TerminationTime decodes GetTerminationTime. AWS documents the value both as epoch seconds and as .NET ticks (100 ns since
// 0001-01-01); the SDK source says epoch seconds. Both are accepted and the result is sanity-checked.
func (realSDK) TerminationTime() (time.Time, error) {
	v, err := server.GetTerminationTime()
	if err != nil {
		return time.Time{}, err
	}
	return decodeTerminationTime(v)
}
