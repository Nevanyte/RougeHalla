package main

import (
	"slices"
	"testing"
	"time"
)

func TestServerArgsAreFailClosed(t *testing.T) {
	a := serverArgs(35000, "127.0.0.1:7778", "/m.json", "", "", []string{"--database-url", "x"})
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
