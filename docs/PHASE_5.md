# Phase 5. Local application tracking and optional Google Sheets

Phase 4 baseline `fd3dcbc` was committed locally on `feature/dev-v0.1` after the 42-path review, privacy and license checks, 24 inherited fixtures, and unpacked Chrome Phases 1–4. Phase 5 implements R13 and A30–A35 on the existing tracker. Phase 5 adds no runtime dependencies.

## Tracker audit and migration

The tracker is still the owner-only `applications.json` array in the local data directory. Atomic JSON replacement preserves existing records, timeline statuses, URLs, company and role, timestamps, and local artifact references. Previous short API IDs remain valid. A migration adds a locally generated application UUID and revision. New records use the same UUID for both identifiers. Previously unstructured history is materialized from the existing dates when available. An existing legacy applied date has no automatic proof of submission.

A URL is a posting hint. Local matching removes fragments and known tracking parameters, retains other query parameters, and compares role identity. Automatic saves require matching roles and avoid merging conflicting employers. Explicit separate records let a user track another application to the same posting. The existing browser click lease still prevents triggering duplicate final submissions. Choosing the new tracker option does not grant a second click lease.

Verified DOCX exports record the preparation event and a safe version identifier. A failed tracker write leaves the verified file available. Changing a tracker state or filling a form never provides submission evidence. A portal receipt or explicit confirmation permits the applied date to appear in export. An unverified application remains distinct. A legacy record labeled applied without a verified outcome projects as submission unverified with a blank date. The original local history is retained.

## Google authorization and setup

1. In a Google Cloud project you control, enable **Google Drive API** and **Google Sheets API**.
2. In Google Auth Platform, configure Branding and Audience. For an external app in Testing, add the dedicated smoke-test account under Test users. Configure **Data Access** for `https://www.googleapis.com/auth/drive.file`.
3. Under **Clients**, create a **Desktop app** OAuth client. Copy its client ID and, if issued, its client secret to the private backend config using `AUTOJOB_GOOGLE_CLIENT_ID` and `AUTOJOB_GOOGLE_CLIENT_SECRET`. The client ID identifies the app. The user tokens and issued secret stay in private storage. Do not place a downloaded client JSON in the repository.
4. Keep the running backend paired with the unpacked extension ID in `EXTENSION_ID`. An unpacked ID may change if the extension is moved or installed in a different browser profile. Update the backend pairing if it changes. The separate Desktop client uses the backend loopback URL and is independent of that Chrome ID.
5. Open **Tracker → Google Sheets sync → Connect Google**. Choose the account intentionally. The backend consumes a short-lived state and exchanges the authorization code using PKCE S256 at the standard Google token endpoint. The callback is bound to the numeric loopback host and backend port, typically `http://127.0.0.1:8787/oauth/google-sheets/callback`.
6. Create a tracker or paste the link to an existing app-managed tracker from this installation. Inspect the destination and the disclosure. Select **Enable sync** to start publishing application rows.

Chrome Identity was evaluated. Using the existing backend and the Desktop flow keeps tokens out of Chrome, supports an always-local queue, and requires no new manifest permission or credential embedded in extension code. The owner-only token file contains refresh and access tokens, scope, and expiry. On expiry or a rejected access token the backend attempts renewal. A rejected refresh grant clears the token file and pauses publishing until the user connects again. The browser receives only connection status, an authorization URL, and the spreadsheet link.

Disconnect stops future publishing, clears local credentials, and requests vendor revocation. The application keeps the tracker, queue history and remote spreadsheet. Google may already have processed a write that was in flight at disconnect. If vendor revocation cannot be confirmed, the panel reports it and the user can revoke in Google Account settings. Connecting another account requires reselecting or creating a destination and enabling sync explicitly. [Google Desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app) · [Google Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes) · [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)

## Destination and spreadsheet schema

The app creates **Get a Job, Bum! — Applications** and a dedicated **Applications** worksheet. A checkpointed Drive app-property marker lets a lost create response be reconciled by searching for the pending file. If Google cannot yet find a file after an uncertain create, the app reports pending creation. Another click searches again. If the file remains missing, check Drive before explicitly clearing the saved creation attempt. That action leaves any remote file intact. Initialization writes the headers and ownership marker in one Sheets batch. If the response is interrupted, the next pass checks for the already initialized tracker.

Select accepts a Google spreadsheet ID or canonical share URL. It validates the scope, spreadsheet ownership marker, dedicated sheet, and exact headers. Existing unrelated spreadsheets and trackers from another installation need their own setup. Arbitrary Picker-based selection is deferred. [Drive file creation](https://developers.google.com/workspace/drive/api/guides/create-file)

| Columns | Values |
| --- | --- |
| A–F | Application UUID, company, position, location, public posting URL, source |
| G–K | Saved time, prepared time, verified or explicitly confirmed applied time, application status, last update time |
| L–M | Opaque verified resume version ID and follow-up date |
| N | Spreadsheet-only notes. Managed row writes preserve it |

Use ISO 8601 UTC timestamps and YYYY-MM-DD for date-only follow-ups. Posting links lose fragments and query parameters and skip private, credentialed or invalid URLs. Public posting links still reveal which opportunities are tracked. The user can inspect destination access and sharing in Google. Applicant evidence, contact details, descriptions, local notes, credentials, signatures, local paths, and resume documents stay out of the projection. CSV uses the same columns and is always available through the local tracker. CSV text is quoted and formula-like prefixes, including leading whitespace and full-width variants, are neutralized. Sheets uses typed string cells rather than formula parsing.

## Outbox, recovery and conflicts

The worker checkpoints each operation ID, application ID, local revision, row hash, creation time, last attempt, attempts, next retry, and result in the private sync file. Outstanding work is derived again from the local authoritative tracker on each pass. A stop between a tracker mutation and the outbox checkpoint cannot lose that mutation. Newer edits replace queued payload hashes while retaining evidence of the last uncertain write. When disconnected or paused, local tracking still operates and the worker skips Google.

Before a row write, the adapter reads current application IDs and a typed cell fingerprint. The atomic append batch creates a deterministic unique developer metadata guard and appends the row. A duplicate guard fails atomically. After a success or uncertain response, the worker locates the ID and checks the actual managed values. Lost acknowledgments recover the same row, including after restart. The durable queue retries temporary failures with bounded exponential backoff and jitter, honors Retry-After, and surfaces persistent auth or validation problems. Read/write limits are conservative and the worker batches its attention to a few rows per cycle. [Atomic batch updates](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate) · [Unique developer metadata IDs](https://developers.google.com/workspace/sheets/api/guides/metadata)

Rows may move between synchronization passes. The worker resolves a fresh row position by UUID and verifies it after writing. Within a pass Sheets does not offer a compare-and-swap guard for edited cells. Finish sorting or editing before resuming sync to avoid the narrow race between lookup and an update. The integration supports one backend writer per installation and sheet. A private process lock and sheet ownership marker enforce the normal single-writer setup. Copies of the same private installation data share an owner identity and must not run concurrently. A worksheet with more than 5,001 grid rows is outside the supported sync size. The local tracker has independent storage.

Unexpected managed edits, missing IDs, deleted rows and duplicate UUIDs are visible conflicts. **Restore local values** compares the observed conflict again before writing. An intentionally restored deleted row gets a new row under its original UUID. **Retain spreadsheet-only values** pauses that row’s projection. No remote edit changes local history or verifies a submission. Duplicate or unowned rows need manual correction in Sheets. Local deletion cancels pending reconciliation for that record and leaves the cloud row available for the user to remove.

## Tests and live verification

| Command | Coverage |
| --- | --- |
| `npm --prefix server run test:sheets` | Controlled HTTP Google double, strict scope and state, UUID migration, concurrent revisions, offline retry, lost create and write responses, malformed acknowledgments, duplicate/moved/deleted rows, conflicts, formula safety, missing/invalid sheets, quotas, credential renewal/revocation and pause |
| `python server/test/phase5-browser.py /path/to/chromium-or-chrome-for-testing` | Save fictional job, mock OAuth redirect, create and enable sync, explicitly submit a fictional application, verify the receipt and exact spreadsheet row, restart Chrome and backend, disable sync and continue locally |
| `scripts/test-phase1.sh` and unpacked browser Phases 1–4 | Existing portal, API, evidence, research-security and document regressions, including prepared tracker state after verified DOCX export |
| `scripts/privacy-preflight.sh`, redacted Gitleaks, `node scripts/release-check.mjs`, and `npm --prefix server audit --omit=dev` | Tracked-data exclusions, staged and historical secrets, syntax and dependency license metadata, security audit |

Local Linux verification passed the controlled HTTP integration, all 24 inherited fixtures, and unpacked Chromium suites for Phases 1–5. The final Phase 5 browser fixture verified the exact remote UUID and applied timestamp. The privacy preflight, redacted scans, and release checks passed. The production dependency audit reported zero vulnerabilities.

The automated browser harness is mock-verified. An early harness let a Chrome-created tab reach Google with a fictional client ID, which returned `invalid_client`. The automated harness now blocks public DNS, substitutes the external response at the Chrome boundary, and exercises the local callback against a controlled token endpoint.

On 2026-11-23, the live smoke run used interactive Google consent in Chrome, the paired HTTP interface of an isolated backend, and independent readback from Google Sheets. After confirming the test account and both APIs in the client’s project, the live run passed spreadsheet creation, repeated creation requests, explicit enable before row upload, update and retry on the original UUID, backend restart with a queued update, and conflict detection and restoration with spreadsheet-only notes intact. Google revocation cleared the local token file. A second interactive grant reopened the original sheet with one row. The test ended disconnected and kept the fictional sheet in Drive.

Lost acknowledgments, rate limits, remotely moved and duplicate rows, and the unpacked extension across Chrome and backend restarts were exercised against the mock service. The live smoke test used normal responses from Google and restarted the backend.

For a live smoke test, use a dedicated OAuth test account and a disposable private data directory. Create a fictional job, connect interactively, create a dedicated tracker, enable sync, and verify one row with the local UUID. Update the fictional follow-up date and verify the same row. Disconnect, reconnect, reselect the same sheet, and verify the row and any spreadsheet-only notes. Confirm the sheet still exists and the row count remains one. Record the Google account setup and results without copying credentials or real applications into any report.

## Changed paths

| Paths | Purpose |
| --- | --- |
| `.gitignore`, `server/.env.example`, `server/package.json` | Ignore local OAuth material, document configuration, and register the mock regression suite. |
| `README.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/PHASE_5.md` | Setup, architecture, acceptance and live test procedure. |
| `server/src/store.js`, `server/src/tracker-schema.js`, `server/src/index.js`, `server/src/docx-routes.js` | Identity and history migration, preparation and manual confirmation, minimal CSV, API authorization and lifecycle. |
| `server/src/sheets-google.js`, `server/src/sheets-sync.js`, `server/src/sheets-routes.js` | Desktop OAuth, guarded Google adapters, durable outbox and paired endpoint controls. |
| `extension/sidepanel.html`, `extension/sidepanel.js`, `extension/sheets-panel.js`, `extension/docx-panel.js` | Tracker controls, opt-in Sheets status, conflicts, local export and preparation feedback. |
| `server/test/sheets.mjs`, `server/test/mock-sheets.mjs`, `server/test/mock-google-fetch.mjs`, `server/test/phase5-browser.py`, `server/test/phase3-browser.py`, `server/test/security.mjs` | Mock network and authenticated Chrome coverage, application lifecycle and existing safeguard regressions. |

**Next milestone.** Run the v0.1 release acceptance checklist from a clean checkout. Evaluate Google Picker separately if general existing-sheet selection is needed.
