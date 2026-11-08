# Flare audio source audit

Audited the 24 Ogg Vorbis clips under `FlareAudioExpansion/Raw/soundfx`. Source files were read only. `ffprobe`/`ffmpeg` were not installed, so metadata came from macOS `afinfo`; audio was decoded with `afconvert` to external float32 PCM WAVs and analyzed with NumPy. Peak and RMS values are sample-domain dBFS, not EBU integrated loudness. WAVs, per-source `afinfo` output, source SHA-256, JSON, and CSV are preserved alongside this report.

## Findings

- No decoded samples reached -0.01 dBFS and no samples exceeded 0 dBFS in any of the 24 sources. No clipping found.
- The cave wind loop boundary itself is smooth: max last-to-first sample jump `0.000366` (`-68.72 dBFS`), lower than the within-file 99.9th percentile adjacent-sample delta in both channels. First/last 50 ms RMS differs by +1.18 dB left and -3.17 dB right. This is not evidence of a material click or seam discontinuity.
- The cave wind loop is exceptionally quiet overall (`-33.69 dBFS` sample peak, `-50.30 dBFS` RMS), roughly 15–25 dB below most short effects by RMS. If it is intended to be audible as ambience, raise its asset/mixer gain during preview; do not alter the source until verified in context.
- `powers/shock.ogg` is mono 88.2 kHz and very quiet (`-23.37 dBFS` peak, `-43.24 dBFS` RMS). Its sample rate is 4x 22.05 kHz and 2x 44.1 kHz peers, with no obvious high-frequency content need established here. It is a candidate for import-time downsampling and contextual gain review.
- `powers/quake.ogg` is the loudest sustained clip (`-2.78 dBFS` peak, `-15.74 dBFS` RMS); check it against other cues in a mix. No clipping is present.
- No batch normalization recommendation: source dynamic range and intended cue role differ. Compare the low cave/shock levels and quake level in the actual mixer before changing gain.

See `audio-source-audit.csv` for the compact per-file table and `audio-source-audit.json` for per-channel metrics, durations, source hashes, loop-seam measurements, and decoded file references.
