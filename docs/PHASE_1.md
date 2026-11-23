# Phase 1 setup and behavior

The Phase 1 branch keeps Auto Job's MV3 panel, Express backend, local JSON tracker, and form scanner. Its authorization policy applies before answer rules, answer memory, model calls, and DOM writes. The user-approved Phase 1 workflow supersedes the blueprint's original manual-only submission and acknowledgment policy.

## Install and pair

1. Use Node.js 22 and install with `cd server && npm ci`.
2. Load `extension/` as an unpacked extension. Copy its 32-character ID from `chrome://extensions`.
3. In the server directory, run `cp .env.example .env && chmod 600 .env`. Set `EXTENSION_ID` to the copied ID. Generate a random pairing token with `node -p 'require("node:crypto").randomBytes(32).toString("hex")'` and set it as `AUTOJOB_TOKEN` in this private file. Choose the model settings before starting the server.
4. Run `npm start`. In **Profile → Server**, enter the loopback URL and token, then choose **Pair local server**. Keep model and mail credentials in the backend configuration. Change the secret in both places to revoke existing pairing.
5. For a permitted employer application, choose **Allow access to the current employer site** if browser access is needed. Paste descriptions from LinkedIn and Indeed and open the employer's application yourself.

The default data directory on Linux is `${XDG_DATA_HOME:-~/.local/share}/get-a-job-bum`, with corresponding per-user locations on macOS and Windows. If startup detects legacy `data/`, make a private backup and copy the data to the new user directory, or explicitly set `AUTOJOB_DATA`. On POSIX the app uses a private umask for new files. Existing data and permissions require local review before migration.

## Automation preferences

All four preferences start off. Review the explanations in **Profile → Application automation preferences**, enable the categories you want, and choose **Accept and save**.

| Preference | Behavior once enabled |
|---|---|
| Required privacy acknowledgment | Eligible routine checkboxes can be applied after review of the specific terms. You can remember exact, sufficiently detailed inline terms from the same employer origin for 90 days. Different text and linked policies require review. |
| Factual legal declarations | Automation supports clear required checkboxes certifying a minimum age of 18 or an exact email address. Review the stored profile facts, then approve the exact statement on the application. Changed, missing, or contradictory facts prevent filling. |
| Background-check authorization | The panel asks you to review the specific visible disclosure and any linked document. The authorization expires after 30 minutes and is scoped to the current application run and exact observed field. |
| Typed electronic signature | Provide the signature yourself and enable signature automation. A required text field can be filled on explicit approval when its associated factual declaration is supported, accurate, and verified against the profile. You can remove the signature in Profile. |

Optional marketing stays outside automation. The panel records category, required status, approval state, and whether the value was verified after writing. The activity feed keeps a bounded session history without storing the legal text or entered values. Changed terms, self-identification, sensitive eligibility, ambiguous controls, and unknown declaration formats go to manual review. The signature remains in the private data directory, separate from the normal applicant profile and model requests.

## Application states

1. **Fill application** fills approved facts and stops on unresolved required fields. A file attachment needs its own approval for the selected field, document, and application. The existing scanner can navigate a clear intermediate step when Auto Next is enabled. The native submission guard applies during automated writes and navigation. Choose **Stop filling** to stop issuing further actions and **Continue** to rescan after resolving questions.
2. **Review application** checks supported fields and records `preparedAt`. Assisted submission requires an unambiguous native final control in the top frame with a valid same-origin form. Review captures the document, form action, fields, button, and page as a fingerprint.
3. **Approve and submit this application** is a separate trusted user action. The backend checks and durably consumes the review before a click. The browser checks the same document and fingerprint at execution. A changed form, expired approval, or previous attempt blocks reuse. A native employer-page click remains available for unsupported forms.
4. The tracker initially records `submission_unverified` with `submissionAttemptedAt`. A dispatched click records `submittedAt`. A same-origin confirmation page with a success heading and a recognizable application reference, or explicit confirmation by the user in Tracker, records `verifiedAt` and moves the record to Applied. An ambiguous result stays unverified and the assistant does not retry it.

## Security boundaries and compatibility

- The API binds to loopback, checks the exact host and port, verifies the paired extension and token, and rejects foreign browser origins. Test pages are available only in isolated test mode. The panel sends the token only to the selected loopback server and rejects redirects.
- Chrome requests the loopback host, temporary active-tab access, and optional user-granted employer origins. The debugger permission and standalone auto-submit scripts were removed. Cross-origin frames, ambiguous navigation, file pickers, and unsupported portals require manual action.
- Mail and vision are off by default at the backend. OTPs and verification links require direct action in the browser. Selecting a cloud model or configured fallback can send applicant or job information to that provider. Use local Ollama for local model calls. Full per-provider consent and source-aware research remain later work.
- Multipart uploads have file and count limits. The server checks signatures, rejects unsafe DOCX archive structures, caps expansion and part counts, and blocks obvious active PDF markers. Document validation is bounded and does not provide a general parser sandbox. Sensitive identity uploads and image signatures require handling on the employer page.
- Portal scripts and non-native submission mechanisms can behave outside the extension's native form event guard. Assisted submission covers the stated native form contract. User confirmation is required when the application outcome is ambiguous. A changed or ambiguous attempt can require resolving the portal state manually before proceeding.

## Tests

From the repository root:

```bash
npm ci --prefix server
scripts/test-phase1.sh
npm audit --prefix server
scripts/privacy-preflight.sh
```

The regression script starts a disposable server with fictional data and a randomly generated token. It uses port 18787 by default and reads `AUTOJOB_TEST_PORT` and `CHROME` overrides. The unpacked-extension scenario uses Python Playwright and Chrome for Testing:

```bash
python3 server/test/phase1-browser.py /path/to/chrome-for-testing
```

See the [Phase 0 audit](UPSTREAM_AUDIT.md) for the two reproducible donor Workday failures. Phase 1 contains no donor code.


## Changed files

| Area | Paths and purpose |
|---|---|
| Extension permissions and enforcement | `extension/manifest.json` scopes site access. `extension/application-policy.js` classifies fields and captures exact evidence. `extension/content.js` guards form writes and navigation, checks submission snapshots, and reads confirmation pages. |
| Side panel | `extension/application-workflow.js` manages the application review, approvals, pairing, and receipt flow. `extension/sidepanel.js`, `extension/sidepanel.html`, and `extension/sidepanel.css` integrate the flow with the existing UI and tracker. The three standalone auto-submit scripts under `extension/scripts/` were removed from this branch. |
| Backend | `server/src/local-api.js` checks pairing and origins. `server/src/automation.js` persists preferences and evaluates scoped authorization. `server/src/store.js` manages private data and durable submission state. `server/src/index.js` integrates the gates and endpoints. `server/src/answer.js` removes inherited auto-consent and minimizes model context. `server/src/uploads.js` validates document inputs. |
| Configuration and dependency updates | `server/.env.example` documents pairing. `server/package.json` and `server/package-lock.json` pin Multer 2.5.0 and yauzl 3.4.0. Both packages declare MIT. |
| Regression and security tests | `server/test/security.mjs` and `server/test/phase1.mjs` cover API and policy behavior. `server/test/phase1-browser.py` and `server/test/phase1-form.html` exercise the unpacked Chrome extension. `server/test/run-all.mjs` and `server/test/harness.js` use isolated fixture credentials. `server/test/scan-versatile.html` and `server/test/scan-widgets.html` retain their widget assertions with ordinary fictional prompts. `scripts/test-phase1.sh` and `.github/workflows/test.yml` run with disposable data. |
| Project documentation | `README.md`, `AGENTS.md`, `MASTER_PLAN.md`, `docs/SECURITY_PRIVACY.md`, `docs/ACCEPTANCE_MATRIX.md`, and `docs/ARCHITECTURE_DECISIONS.md` describe the owner-approved policy and changed setup. |


## Verification record

- Node 22 on Linux. The server suite exercised the browser fixtures in Google Chrome 143. The unpacked extension ran in Chrome for Testing 147 with Playwright 1.65.2.
- A clean install with npm ci passed. The server suite passed its seven commands and all 24 inherited fixtures. The two scanner fixtures that previously requested an automated relocation answer now exercise the same widgets with an ordinary mentoring question. API tests cover protected-field refusal separately.
- The unpacked extension exercised intermediate Continue, disabled and enabled consent, explicit legal and background approvals, signature entry, a reviewed attachment, and unchecked marketing and ambiguous controls. Fill, synthetic form submission, Enter in the signature field, and a programmatic panel click did not send the form. A trusted separate confirmation clicked once and the tracker verified the receipt. The ambiguous outcome stayed unverified, and a changed final form invalidated the click.
- A separate production-mode run paired the unpacked extension successfully and confirmed that the runtime server returned 404 for a test fixture URL.
- The API tests exercised default-off preferences, contradictory and missing applicant facts, changed disclosures, exact remembered privacy terms, one-use application authorization, foreign origins, and invalid or oversized document rejection. The base dependency audit reported zero critical or high findings. The remaining moderate findings are ExcelJS and its UUID dependency.
- Phase 0 remains in local commit `326c0c1`. The index path guard and redacted staged-content scan passed during both milestones. The original MIT license is intact, and the implementation uses the existing Auto Job codebase and MIT-compatible dependencies. Local media review covered all 20 screenshots, 49 sampled GIF and MP4 frames, and the reel audio. Offline OCR and speech recognition found no recognizable credential patterns. Speech recognition found no spoken email address or long number sequence. Hosted CI and publication remain pending.

### Acceptance status

| Status | Acceptance IDs and boundary |
|---|---|
| Verified in the Phase 1 scope | A18, A25, revised A28, A29, A39–A41, applicable A46, and A50. These cover fictional filling, manual escalation, exact approvals, one-use submission, evidence-based tracking, local API and privacy checks, and the inherited fixtures. |
| Partial evidence | A01–A03 have evidence from a working unpacked panel. Stop and resume controls are implemented. Docked panel, cancellation, and restart recovery tests remain pending. A19 has Workday-like baseline evidence. A21, A23, and A30 cover intermediate change, a reviewed PDF attachment, and repeat-attempt refusal. Portal-specific reparsing, broader deduplication, and restart cases remain pending. A42 covers origin, host, run scope, and changed form rejection. A broader forged frame suite remains pending. A45 covers protected fields and manual OTP handoffs, with wider credential and payment fixture coverage pending. A49 has a local CI-equivalent run, with hosted CI pending. |
| Later milestones | The remaining matrix cases, including canonical applicant evidence, broad portal qualification, per-provider data consent, source-aware DOCX and derived PDF, Sheets, and the complete release demo. Phase 1 uses Auto Job and contains zero donor imports. |
