package main

import (
	"os"
	"slices"
	"testing"
	"time"
)

func TestServerArgsAreFailClosed(t *testing.T) {
	a := serverArgs(35000, "127.0.0.1:7778", "/m.json", "", "", "", []string{"--database-url", "x"})
	for _, want := range []string{"--require-admit", "--max-rooms", "1", "--control", "127.0.0.1:7778"} {
		if !slices.Contains(a, want) {
			t.Fatalf("%v lacks %s", a, want)
		}
	}
	if slices.Contains(a, "--tls-cert") {
		t.Fatal("no TLS args without a certificate")
	}
	if i := slices.Index(a, "--bind"); a[i+1] != "0.0.0.0:35000" {
		t.Fatalf("bind %v", a)
	}
}

func TestSupervisorReportsChildExit(t *testing.T) {
	p, err := startServer("/bin/sh", []string{"-c", "exit 3"})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-p.exit:
		if err == nil {
			t.Fatal("want a non-nil exit error for status 3")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("child exit not reported")
	}
}

func TestSupervisorStopTerminatesChild(t *testing.T) {
	p, err := startServer("/bin/sh", []string{"-c", "sleep 30"})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	p.stop(2 * time.Second)
	if time.Since(start) > 3*time.Second {
		t.Fatal("stop did not terminate the child")
	}
}

// The main loop consumes `exit` when the child ends while draining; stop must then return at once, not after the grace.
func TestSupervisorStopReturnsAtOnceAfterTheExitWasConsumed(t *testing.T) {
	p, err := startServer("/bin/sh", []string{"-c", "exit 0"})
	if err != nil {
		t.Fatal(err)
	}
	<-p.exit // the bridge's main loop took the exit
	start := time.Now()
	p.stop(5 * time.Second)
	if d := time.Since(start); d > time.Second {
		t.Fatalf("stop waited %s for a child that had already exited", d)
	}
}

func TestDecodeTerminationTime(t *testing.T) {
	if ts, err := decodeTerminationTime(1_800_000_000); err != nil || ts.Unix() != 1_800_000_000 {
		t.Fatalf("epoch seconds: %v %v", ts, err)
	}
	// 2020-09-13 12:26:40 UTC in .NET ticks, the example in AWS's Go SDK documentation.
	if ts, err := decodeTerminationTime(637355968000000000); err != nil || ts.Unix() != 1600000000 {
		t.Fatalf("ticks: %v %v", ts, err)
	}
	if _, err := decodeTerminationTime(0); err == nil {
		t.Fatal("zero is not a termination time")
	}
}

func TestServerArgsPassTheControlTokenFile(t *testing.T) {
	a := serverArgs(35000, "127.0.0.1:7778", "/m.json", "", "", "/tmp/tok", nil)
	if i := slices.Index(a, "--control-token-file"); i < 0 || a[i+1] != "/tmp/tok" {
		t.Fatalf("%v lacks --control-token-file /tmp/tok", a)
	}
	if slices.Contains(serverArgs(35000, "127.0.0.1:7778", "/m.json", "", "", "", nil), "--control-token-file") {
		t.Fatal("no token file argument without a token")
	}
}

func TestWriteTokenFileIs0600AndHoldsTheToken(t *testing.T) {
	p, rm, err := writeTokenFile("s3cret-token")
	if err != nil {
		t.Fatal(err)
	}
	defer rm()
	st, err := os.Stat(p)
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("stat %v mode %v", err, st.Mode())
	}
	if b, _ := os.ReadFile(p); string(b) != "s3cret-token" {
		t.Fatalf("content %q", b)
	}
	rm()
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatal("remover must delete the file")
	}
}

func TestScrubEnvRemovesCredentialsAndBridgeSettings(t *testing.T) {
	in := []string{"PATH=/bin", "AWS_SECRET_ACCESS_KEY=x", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI=/v2", "GAMELIFT_SDK_WEBSOCKET_URL=wss://x",
		"GLBRIDGE_CONTROL_TOKEN=t", "HOME=/h", "MY_AWS_THING=keep", "RUST_LOG=info"}
	out := scrubEnv(in)
	want := []string{"PATH=/bin", "HOME=/h", "MY_AWS_THING=keep", "RUST_LOG=info"}
	if !slices.Equal(out, want) {
		t.Fatalf("scrubEnv = %v, want %v", out, want)
	}
}

// The supervised child must not see AWS credentials, whatever the bridge's own environment holds.
func TestSupervisedChildSeesNoAWSEnvironment(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "AKIAEXAMPLE")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "secret")
	t.Setenv("AWS_SESSION_TOKEN", "tok")
	t.Setenv("GLBRIDGE_CONTROL_TOKEN", "ctl")
	p, err := startServer("/bin/sh", []string{"-c", `[ -z "$AWS_ACCESS_KEY_ID$AWS_SECRET_ACCESS_KEY$AWS_SESSION_TOKEN$GLBRIDGE_CONTROL_TOKEN" ] && [ -n "$PATH" ]`})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-p.exit:
		if err != nil {
			t.Fatalf("the child saw a scrubbed variable (or lost PATH): %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("child did not exit")
	}
}
