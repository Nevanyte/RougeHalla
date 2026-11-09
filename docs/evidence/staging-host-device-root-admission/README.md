# Readonly Linux host-device collector admission

Root merges source/evidence `51285bb60cae84bc0bfec4fab14a5efc37d5daf5` at `299c878af8d0b339b407a94cd435a8d984c2d992` after [independent source review](independent-review.md). The author records 20 synthetic tests passing. The collector uses kernel mount/device identity, all mapped/partition ancestors and a second stable snapshot; supplied volume labels alone cannot authorize a data device. Existing installer foundation files are unchanged.

This is readonly preparation. No actual Linux host probe, mount/format, privileged installer, cloud attachment validation or account call occurred. The existing installer still stops before installation. Actual expiry/egress/provisioning, offhost restore, cloud credentials and budgeted deployment remain open. See [author evidence](../staging-host-device-collector/README.md) for its exact scope.
