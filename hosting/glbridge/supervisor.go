package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// serverProc is the supervised rh-server child. The bridge is PID 1 of the container: if the bridge dies the container ends
// and the child with it; if the child dies the bridge learns through exit and ends the process (bridge.serverCrashed).
type serverProc struct {
	cmd  *exec.Cmd
	exit chan error // receives the Wait result once; buffered
}

func startServer(bin string, args []string) (*serverProc, error) {
	cmd := exec.Command(bin, args...)
	cmd.Stdout = os.Stdout // container fleets capture stdout/stderr as the log stream
	cmd.Stderr = os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start %s: %w", bin, err)
	}
	p := &serverProc{cmd: cmd, exit: make(chan error, 1)}
	go func() { p.exit <- cmd.Wait() }()
	return p, nil
}

// stop asks the child to drain (SIGTERM) and kills it after grace. Safe to call after it exited.
func (p *serverProc) stop(grace time.Duration) {
	if p.cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGTERM)
	select {
	case err := <-p.exit:
		p.exit <- err // keep the value for other readers
	case <-time.After(grace):
		_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
	}
}

// serverArgs builds the rh-server command line. --max-rooms 1 and --require-admit are not optional in the hosted image:
// the bridge additionally refuses a server that does not report requireAdmit (Bridge.waitReady).
func serverArgs(gamePort int, controlAddr, mapPath, tlsCert, tlsKey string, extra []string) []string {
	a := []string{
		"--bind", fmt.Sprintf("0.0.0.0:%d", gamePort),
		"--control", controlAddr,
		"--max-rooms", "1",
		"--require-admit",
	}
	if mapPath != "" {
		a = append(a, "--map", mapPath)
	}
	if tlsCert != "" {
		a = append(a, "--tls-cert", tlsCert, "--tls-key", tlsKey)
	}
	return append(a, extra...)
}
