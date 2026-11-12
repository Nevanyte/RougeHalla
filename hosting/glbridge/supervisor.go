package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// scrubEnv removes what the game process must never see: AWS credentials and configuration (AWS_*, which includes the
// container credential endpoints), the GameLift agent connection (GAMELIFT_*, the SDK websocket and its auth token) and the
// bridge's own settings (GLBRIDGE_*, including GLBRIDGE_CONTROL_TOKEN: the server gets the token from a file).
func scrubEnv(env []string) []string {
	out := make([]string, 0, len(env))
	for _, kv := range env {
		k, _, _ := strings.Cut(kv, "=")
		if strings.HasPrefix(k, "AWS_") || strings.HasPrefix(k, "GAMELIFT_") || strings.HasPrefix(k, "GLBRIDGE_") {
			continue
		}
		out = append(out, kv)
	}
	return out
}

// writeTokenFile stores the control bearer token in a 0600 file (os.CreateTemp creates it 0600) for --control-token-file and
// returns its path and a remover. The token never appears on the command line or in the child's environment.
func writeTokenFile(token string) (string, func(), error) {
	f, err := os.CreateTemp("", "glbridge-control-token-*")
	if err != nil {
		return "", func() {}, err
	}
	name := f.Name()
	rm := func() { _ = os.Remove(name) }
	if err := f.Chmod(0o600); err != nil {
		_ = f.Close()
		rm()
		return "", func() {}, err
	}
	if _, err := f.WriteString(token); err != nil {
		_ = f.Close()
		rm()
		return "", func() {}, err
	}
	if err := f.Close(); err != nil {
		rm()
		return "", func() {}, err
	}
	return name, rm, nil
}

// serverProc is the supervised rh-server child. The bridge is PID 1 of the container: if the bridge dies the container ends
// and the child with it; if the child dies the bridge learns through exit and ends the process (bridge.serverCrashed).
type serverProc struct {
	cmd  *exec.Cmd
	exit chan error    // receives the Wait result once; buffered. The bridge's main loop consumes it.
	done chan struct{} // closed when the child has exited; stop waits on this, never on exit (the main loop may have taken it)
}

func startServer(bin string, args []string) (*serverProc, error) {
	cmd := exec.Command(bin, args...)
	cmd.Env = scrubEnv(os.Environ())
	cmd.Stdout = os.Stdout // container fleets capture stdout/stderr as the log stream
	cmd.Stderr = os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start %s: %w", bin, err)
	}
	p := &serverProc{cmd: cmd, exit: make(chan error, 1), done: make(chan struct{})}
	go func() {
		err := cmd.Wait()
		p.exit <- err
		close(p.done)
	}()
	return p, nil
}

// term sends the child (its whole process group) SIGTERM: rh-server then shuts down gracefully, finishing result writes.
func (p *serverProc) term() {
	if p.cmd.Process != nil {
		_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGTERM)
	}
}

// stop asks the child to drain (SIGTERM) and kills it after grace. Safe to call after it exited.
func (p *serverProc) stop(grace time.Duration) {
	if p.cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGTERM)
	select {
	case <-p.done:
	case <-time.After(grace):
		_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
	}
}

// serverArgs builds the rh-server command line. --max-rooms 1 and --require-admit are not optional in the hosted image:
// the bridge additionally refuses a server that does not report requireAdmit (Bridge.waitReady).
func serverArgs(gamePort int, controlAddr, mapPath, tlsCert, tlsKey, tokenFile string, extra []string) []string {
	a := []string{
		"--bind", fmt.Sprintf("0.0.0.0:%d", gamePort),
		"--control", controlAddr,
		"--max-rooms", "1",
		"--require-admit",
	}
	if tokenFile != "" {
		a = append(a, "--control-token-file", tokenFile)
	} else {
		// rh-server refuses --control without a token unless loopback-only is stated explicitly. With no
		// GLBRIDGE_CONTROL_TOKEN configured this is the pre-existing behaviour, now spelled out; set the token to enforce it.
		a = append(a, "--control-insecure-loopback")
	}
	if mapPath != "" {
		a = append(a, "--map", mapPath)
	}
	if tlsCert != "" {
		a = append(a, "--tls-cert", tlsCert, "--tls-key", tlsKey)
	}
	return append(a, extra...)
}
