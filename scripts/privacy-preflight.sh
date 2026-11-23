#!/usr/bin/env bash
# Check index paths against repository ignore rules. Review contents separately.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"

# Use repository rules rather than a second list of prohibited names. The
# index includes staged additions and excludes paths staged for deletion.
ignored_tracked=$(git ls-files --cached --ignored --exclude-per-directory=.gitignore)
if [[ -n "$ignored_tracked" ]]; then
  printf 'BLOCKED: the index contains paths excluded by repository ignore rules. Review git ls-files --cached --ignored --exclude-per-directory=.gitignore locally.\n' >&2
  exit 1
fi

if ! git check-ignore --quiet --no-index private_data/test.json; then
  printf 'BLOCKED: private_data/ needs an ignore rule.\n' >&2
  exit 1
fi

printf 'Tracked and staged path check passed. Run secret scanning and review content before publishing.\n'
