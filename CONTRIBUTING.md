# Contributing

Start with the [developer setup](docs/DEVELOPER_SETUP.md) and the [coding contract](AGENTS.md). Keep changes small and respect the local-only defaults and submission approval boundary.

- Report ordinary bugs in the fork with the commit, operating system, browser version, and a minimal fictional fixture. Share expected and observed behavior. Keep resumes, application URLs, account information, credentials, and raw diagnostic logs out of public issues.
- Report vulnerabilities privately using [SECURITY.md](SECURITY.md).
- For a feature proposal, describe the user workflow, permissions, data flow, and acceptance tests. Preserve Auto Job history and [MIT attribution](NOTICE.md). Use original or appropriately licensed code and fixtures.
- Run the relevant suites in the [developer guide](docs/DEVELOPER_SETUP.md), then run the privacy preflight and staged secret scan. Report skipped checks and why they were skipped.
- Create a branch in your fork and make a focused pull request against the intended base in `elmercodes/get-a-job-bum`. Include a short test report with fictional data. Use the repository selector to verify the destination before opening the pull request.
