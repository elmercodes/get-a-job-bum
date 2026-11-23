# GitHub integration

[Get a Job, Bum!](https://github.com/elmercodes/get-a-job-bum) is an existing public fork of [Auto Job](https://github.com/batmandevx/Auto-Job). Use its existing history and the `feature/dev-v0.1` branch for the blueprint integration.

For a fresh local checkout:

```bash
git clone https://github.com/elmercodes/get-a-job-bum.git
cd get-a-job-bum
git remote add upstream https://github.com/batmandevx/Auto-Job.git
git remote -v
```

Add `upstream` only if the checkout lacks it. See the [Phase 0 audit](UPSTREAM_AUDIT.md) for the pinned revisions, setup commands, test results, and open findings.

## Before a commit or push

1. Keep applicant documents and secrets in private storage outside the worktree. Use fictional examples and a disposable `AUTOJOB_DATA` directory for testing.
2. Run `scripts/privacy-preflight.sh` from the checkout. It checks the index, including staged additions, against repository ignore rules.
3. Review the staged diff for personal data, including documents, screenshots, reports, and logs. Run a redacted secret scan against the staged changes and repository history. Inspect any findings privately.
4. Preserve the root MIT license. When incorporating donor code, record its pinned revision and include its MIT notice as described in [license attribution](LICENSE_ATTRIBUTION.md).
