#!/bin/bash
# SessionStart: put the Rust toolchain on PATH for every later shell command of the session. The tool shell does not
# read ~/.zshenv, so a rustup install under ~/.cargo/bin is otherwise invisible to `cargo` (scripts/gate.sh finds it by
# itself; a bare `cargo test` does not).
[[ -n "${CLAUDE_ENV_FILE:-}" ]] || exit 0
if [[ -d "$HOME/.cargo/bin" ]]; then
  echo 'case ":$PATH:" in *":$HOME/.cargo/bin:"*) ;; *) export PATH="$HOME/.cargo/bin:$PATH" ;; esac' >>"$CLAUDE_ENV_FILE"
fi
exit 0
