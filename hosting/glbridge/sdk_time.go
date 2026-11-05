package main

import (
	"fmt"
	"time"
)

func decodeTerminationTime(v int64) (time.Time, error) {
	const ticksPerSecond = 10_000_000
	const unixEpochTicks = 621_355_968_000_000_000 // 1970-01-01 in .NET ticks
	var t time.Time
	switch {
	case v <= 0:
		return time.Time{}, fmt.Errorf("termination time %d not available", v)
	case v > unixEpochTicks:
		t = time.Unix((v-unixEpochTicks)/ticksPerSecond, 0)
	default:
		t = time.Unix(v, 0)
	}
	return t, nil
}
