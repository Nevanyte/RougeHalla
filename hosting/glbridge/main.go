// glbridge: the only process in the hosting image that links the GameLift Server SDK. It launches and supervises rh-server
// (which never links a cloud SDK) and maps GameLift's callbacks onto rh-server's loopback control API.
// See docs/hosting/CONTROL_API.md and hosting/README.md.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func envInt(k string, d int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return d
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil)) // stdout: container fleets capture it
	cfg := DefaultConfig()
	var (
		serverBin   = flag.String("server-bin", envOr("GLBRIDGE_SERVER_BIN", "/local/game/rh-server"), "rh-server binary")
		controlAddr = flag.String("control-addr", envOr("GLBRIDGE_CONTROL_ADDR", "127.0.0.1:7778"), "loopback control listener (host:port)")
		mapPath     = flag.String("map", envOr("GLBRIDGE_MAP", "/local/game/maps/seed1.map.json"), "map file passed to rh-server")
		tlsCert     = flag.String("tls-cert", envOr("GLBRIDGE_TLS_CERT", ""), "TLS certificate for the game listener")
		tlsKey      = flag.String("tls-key", envOr("GLBRIDGE_TLS_KEY", ""), "TLS key for the game listener")
		noServer    = flag.Bool("no-supervise", false, "do not launch rh-server (it is already running); development only")
	)
	flag.IntVar(&cfg.GamePort, "game-port", envInt("GLBRIDGE_GAME_PORT", 35000), "container port rh-server listens on (reported to ProcessReady)")
	flag.BoolVar(&cfg.AllowNoAdmit, "allow-no-admit", false, "accept an rh-server without --require-admit (development only)")
	flag.DurationVar(&cfg.PollInterval, "poll-interval", cfg.PollInterval, "GET /control/rooms cadence")
	flag.DurationVar(&cfg.AdmitInterval, "admit-interval", cfg.AdmitInterval, "DescribePlayerSessions cadence")
	flag.DurationVar(&cfg.DrainDeadline, "drain-deadline", cfg.DrainDeadline, "maximum wait for rooms during drain")
	flag.DurationVar(&cfg.StartTimeout, "start-timeout", cfg.StartTimeout, "maximum wait for rh-server readiness")
	flag.Parse()
	extra := flag.Args() // everything after `--` goes to rh-server unchanged (e.g. --database-url)

	ctl := NewControl("http://"+*controlAddr, os.Getenv("GLBRIDGE_CONTROL_TOKEN"))

	var exit <-chan error
	var proc *serverProc
	if !*noServer {
		var err error
		proc, err = startServer(*serverBin, serverArgs(cfg.GamePort, *controlAddr, *mapPath, *tlsCert, *tlsKey, extra))
		if err != nil {
			log.Error("cannot start rh-server", "err", err)
			os.Exit(ExitFailed)
		}
		exit = proc.exit
	}

	b := NewBridge(cfg, newSDK(), ctl, log, exit)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM)
	go func() { <-sig; log.Info("SIGTERM: draining"); b.Terminate() }()

	code := b.Run(ctx)
	if proc != nil {
		proc.stop(5 * time.Second)
	}
	log.Info("exit", "code", code)
	os.Exit(code)
}
