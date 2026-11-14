#!/usr/bin/env bash
# Worktree ownership: who may remove which agent worktree. A worktree directory carries no owner, and "clean, merged and
# idle" does not mean finished when several sessions share the repository (2026-11-14). The table is
# .agent-runs/worktrees.csv at the main checkout's root (git-ignored): date,agent,packet,session,state (open|done).
#
#   scripts/agent-worktrees.sh claim <agent-id> <packet> <session>   append a row, state open
#   scripts/agent-worktrees.sh done <agent-id>                       mark the agent's newest row done
#   scripts/agent-worktrees.sh list                                  the table with each worktree's branch, head, size
#   scripts/agent-worktrees.sh clean --session <session>             remove this session's done, clean worktrees only
#
# <agent-id> names a worktree by directory: either its full name or the name without the "agent-" prefix. clean unlocks a
# worktree before removing it; it leaves (and says why) anything without a row, not done, of another session, or with
# uncommitted or untracked files beyond .agent-runs/. It never touches a directory without a row and never deletes a branch.
set -euo pipefail

GITCOMMON="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || { echo "not in a git repository" >&2; exit 1; }
MAIN="$(cd "$GITCOMMON/.." && pwd -P)"
CSV="$MAIN/.agent-runs/worktrees.csv"

usage() { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-2}"; }

worktrees() { # <path>|<branch>|<head> for every worktree except the main checkout
  git -C "$MAIN" worktree list --porcelain | awk -v main="$MAIN" '
    /^worktree /{ if (p != "" && p != main) print p "|" b "|" h; p = substr($0, 10); b = ""; h = ""; next }
    /^HEAD /{ h = substr($0, 6, 9); next }
    /^branch /{ b = substr($0, 8); sub("refs/heads/", "", b); next }
    /^detached/{ b = "(detached)"; next }
    END { if (p != "" && p != main) print p "|" b "|" h }'
}
row_of() { # newest row of an agent id (full name or without "agent-"), or nothing
  [[ -f "$CSV" ]] || return 0
  awk -F, -v id="$1" '$2 == id || "agent-" $2 == id || $2 == "agent-" id { r = $0 } END { if (r != "") print r }' "$CSV"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  claim)
    [[ $# -eq 3 ]] || usage
    mkdir -p "$MAIN/.agent-runs"
    printf '%s,%s,%s,%s,open\n' "$(date +%Y-%m-%d)" "$1" "$2" "$3" >>"$CSV"
    echo "claimed: $1 ($2, session $3)"
    ;;
  done)
    [[ $# -eq 1 ]] || usage
    [[ -n "$(row_of "$1")" ]] || { echo "no row for $1" >&2; exit 1; }
    tmp="$(mktemp)"
    # Mark only the newest row of this agent id.
    awk -F, -v OFS=, -v id="$1" '
      { line[NR] = $0; f2[NR] = $2; if ($2 == id || "agent-" $2 == id || $2 == "agent-" id) last = NR }
      END { for (i = 1; i <= NR; i++) { if (i == last) { split(line[i], a, ","); a[5] = "done"; print a[1], a[2], a[3], a[4], a[5] } else print line[i] } }' "$CSV" >"$tmp"
    mv "$tmp" "$CSV"
    echo "done: $1"
    ;;
  list)
    [[ $# -eq 0 ]] || usage
    printf '%-10s %-24s %-22s %-10s %-6s %-34s %-10s %s\n' DATE AGENT PACKET SESSION STATE BRANCH HEAD SIZE
    if [[ -f "$CSV" ]]; then
      while IFS=, read -r date agent packet session state; do
        wt="" br="-" head="-" size="-"
        while IFS='|' read -r p b h; do
          base="$(basename "$p")"
          if [[ "$base" == "$agent" || "$base" == "agent-$agent" ]]; then wt="$p" br="$b" head="$h"; fi
        done < <(worktrees)
        [[ -z "$wt" ]] || size="$(du -sh "$wt" 2>/dev/null | cut -f1)"
        printf '%-10s %-24s %-22s %-10s %-6s %-34s %-10s %s\n' "$date" "$agent" "$packet" "$session" "$state" "$br" "$head" "$size"
      done <"$CSV"
    fi
    ;;
  clean)
    [[ "${1:-}" == --session && -n "${2:-}" && $# -eq 2 ]] || usage
    session="$2"
    while IFS='|' read -r p b h; do
      [[ -n "$p" ]] || continue
      name="$(basename "$p")"
      row="$(row_of "$name")"
      if [[ -z "$row" ]]; then echo "left $name: no row in worktrees.csv (not claimed by any session)"; continue; fi
      IFS=, read -r _ _ _ rsession rstate <<<"$row"
      if [[ "$rsession" != "$session" ]]; then echo "left $name: claimed by session $rsession, not $session"; continue; fi
      if [[ "$rstate" != done ]]; then echo "left $name: not done (state $rstate)"; continue; fi
      dirty="$(git -C "$p" status --porcelain --untracked-files=all 2>/dev/null | grep -vE '^.. "?\.agent-runs/' || true)"
      if [[ -n "$dirty" ]]; then echo "left $name: uncommitted or untracked files ($(grep -c . <<<"$dirty") paths, first: $(head -n 1 <<<"$dirty" | cut -c4-))"; continue; fi
      git -C "$MAIN" worktree unlock "$p" >/dev/null 2>&1 || true
      if git -C "$MAIN" worktree remove --force "$p" >/dev/null 2>&1; then
        echo "removed $name (branch ${b:-?} kept)"
      else
        echo "left $name: git worktree remove failed"
      fi
    done < <(worktrees)
    ;;
  *) usage ;;
esac
