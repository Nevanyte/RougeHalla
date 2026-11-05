//go:build !fakesdk

package main

// newSDK is the production adapter: the official GameLift Server SDK. The `fakesdk` build tag swaps it for a scripted fake
// (sdk_script.go) used only by the local end-to-end harness; the production image is built without the tag.
func newSDK() SDK { return realSDK{} }
