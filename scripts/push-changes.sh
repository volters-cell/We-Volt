#!/usr/bin/env bash
# Commit what a workflow changed and push it, whoever else pushed meanwhile.
#
#   scripts/push-changes.sh "Commit message" data/ assets/faces/
#   REBUILD="node scripts/build-index.mjs" scripts/push-changes.sh "…" data/
#
# Several jobs write to this branch on their own schedules — the plenary sync
# every two hours on a sitting day, the portraits, the profiles and the audit
# each month — and a bare `git push` loses to whichever pushed first. On
# 1 October 2026 the profiles job read every member, committed 1,272 files and
# then threw them away on "fetch first", because the portraits job had pushed
# a minute earlier.
#
# So: push; if refused, fetch, replay this commit on top, and try again, up to
# five times with a growing pause. A conflict inside the generated data is
# settled in favour of this job's own files — it has just read them from the
# source — and REBUILD, if given, then regenerates whatever is derived from
# both sides (the index, the member files) so neither job's work is lost. A
# conflict anywhere else stops the job rather than guess.
#
# Writes changed=true|false to $GITHUB_OUTPUT, for a publish job to read.
#
#   SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail

message="$1"; shift
branch="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
output="${GITHUB_OUTPUT:-/dev/null}"

git config user.name "eu-tracker-bot"
git config user.email "actions@github.com"

git add -A -- "$@"
if git diff --cached --quiet; then
  echo "Nothing changed."
  echo "changed=false" >> "$output"
  exit 0
fi
git commit -q -m "$message"

for attempt in 1 2 3 4 5; do
  if git push -q origin "HEAD:$branch"; then
    echo "Pushed on attempt $attempt."
    echo "changed=true" >> "$output"
    exit 0
  fi
  echo "Push refused (attempt $attempt): the branch moved. Replaying this commit on top."
  sleep $((attempt * 7))
  git fetch -q origin "$branch"
  if ! git rebase -q "origin/$branch"; then
    conflicted=$(git diff --name-only --diff-filter=U)
    if echo "$conflicted" | grep -qvE '^(data|assets/faces|assets/groups)/'; then
      echo "::error::Conflict outside the generated data — stopping rather than guessing:"
      echo "$conflicted"
      git rebase --abort
      exit 1
    fi
    # In a rebase, "theirs" is the commit being replayed: this job's own files.
    echo "$conflicted" | xargs git checkout --theirs --
    echo "$conflicted" | xargs git add --
    GIT_EDITOR=true git rebase --continue
  fi
  if [ -n "${REBUILD:-}" ]; then
    bash -c "$REBUILD"
    git add -A -- "$@"
    git diff --cached --quiet || git commit -q --amend --no-edit
  fi
done

echo "::error::Could not push after five attempts."
exit 1
