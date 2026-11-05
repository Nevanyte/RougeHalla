//go:build !fakesdk

package main

import (
	"errors"
	"fmt"
	"testing"

	"github.com/amazon-gamelift/amazon-gamelift-servers-go-server-sdk/v5/common"
)

func TestClassifyAcceptOnlyDefinitiveRejectionsAreRejected(t *testing.T) {
	rejected := []common.GameLiftErrorType{common.ValidationException, common.BadRequestException, common.NotFoundException,
		common.ConflictException, common.ForbiddenException, common.UnexpectedPlayerSession, common.FleetMismatch}
	transient := []common.GameLiftErrorType{common.TooManyRequestsException, common.InternalServiceException,
		common.UnauthorizedException, common.ProcessNotReady, common.GamesessionIDNotSet, common.WebsocketSendMessageFailure,
		common.WebsocketRetriableSendMessageFailure, common.ServiceCallFailed}
	for _, ty := range rejected {
		if err := classifyAccept(common.NewGameLiftError(ty, "", "x")); !IsRejected(err) {
			t.Errorf("type %d must be a rejection", ty)
		}
	}
	for _, ty := range transient {
		if err := classifyAccept(common.NewGameLiftError(ty, "", "x")); IsRejected(err) {
			t.Errorf("type %d must not be a rejection", ty)
		}
	}
	// A status code mapped by the SDK itself: 404 is a rejection, 500 and 429 are not.
	if !IsRejected(classifyAccept(common.NewGameLiftErrorFromStatusCode(404, "no such player session"))) {
		t.Error("404 must be a rejection")
	}
	for _, code := range []int{429, 500, 503} {
		if IsRejected(classifyAccept(common.NewGameLiftErrorFromStatusCode(code, "x"))) {
			t.Errorf("status %d must not be a rejection", code)
		}
	}
	// Non-GameLift errors (timeouts, plain errors) and wrapped ones.
	if IsRejected(classifyAccept(errors.New("i/o timeout"))) || classifyAccept(nil) != nil {
		t.Error("plain errors pass through")
	}
	wrapped := fmt.Errorf("ctx: %w", common.NewGameLiftError(common.NotFoundException, "", ""))
	if !IsRejected(classifyAccept(wrapped)) {
		t.Error("wrapped GameLiftError must still classify")
	}
}
