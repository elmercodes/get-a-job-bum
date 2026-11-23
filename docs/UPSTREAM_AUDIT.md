# Phase 0 upstream audit

**Date:** 2026-11-23. **Branch:** `feature/dev-v0.1`. **Environment:** Linux x86-64, Node 22.23.4, npm 10.9.9, Google Chrome 143.0.7499.192, Chrome for Testing 147.0.7727.49, Playwright 1.65.2, LibreOffice 24.2.7.2. Tests used public fictional fixtures and temporary data directories.

## Source and license inventory

| Source | Pinned revision | Verified terms and use |
|---|---|---|
| Get a Job, Bum! and Auto Job `main` | `e32598111cd4dd968a6e8980672a1ed3d1128cd9` | GitHub identifies the fork parent as `batmandevx/Auto-Job`. Both remote heads matched the local baseline during planning. Root MIT license with Ayush Upadhyay's copyright retained verbatim. |
| Application Assistant `main` | `e795a42bfe058c65f1530bbf68c9a1f09dea7f1d` | Full MIT notice names Application Assistant contributors. Reviewed the DOCX routine, approval filter, evidence validator, adapter registry, and test harness. Donor use in Phase 0 consisted of separate baseline tests. |
| AutoApply `main` | `87f58be6a414855fab70f765731ed6b4cb9f4219` | GPL-3.0. Used repository license and concepts only. |

The architecture decision and candidate source boundaries are in [ADR 001](ARCHITECTURE_DECISIONS.md).

## Reproduction and observed baseline

### Auto Job

Use a free port and matching `AUTOJOB_URL`. Port 8787 was occupied here, so the audit used separate loopback ports. Supply `CHROME` for the machine running the suite.

```bash
cd server
npm ci --no-audit
audit_data=$(mktemp -d)
cp test/fixtures/*.json "$audit_data/"
env -i PATH="$PATH" CI=true DOTENV_CONFIG_PATH="$audit_data/missing.env" \
  AUTOJOB_DATA="$audit_data" PORT=18787 LLM_PROVIDER=ollama \
  OLLAMA_URL=http://127.0.0.1:9 OLLAMA_FALLBACK=off node src/index.js &
audit_server_pid=$!
trap 'kill "$audit_server_pid" 2>/dev/null || true' EXIT
curl -fsS http://127.0.0.1:18787/api/health
env -i PATH="$PATH" CI=true CHROME=/usr/bin/google-chrome \
  AUTOJOB_DATA="$audit_data" AUTOJOB_URL=http://127.0.0.1:18787 npm test
```

Wait for health to return `ok` before running tests. The script runs six entries covering HTTP guards, XLSX/CSV export, job checking, Amazon-style answers, panel smoke, and 24 browser fixtures. The panel smoke test stubs Chrome APIs. The fixture runner injects the production content script into local pages.

For the separate unpacked-extension check, launch a clean Chrome for Testing profile with `--disable-extensions-except` and `--load-extension` pointing to `extension/`. From the real extension worker, set `chrome.storage.local.server` to the isolated server URL and disable auto-next, auto-cover, research, vision, and debugger-assisted typing for the test. Open `/test/form.html`, load the extension's `sidepanel.html`, start Fill, and read back name and email. Repeat with `/test/workday.html` and read back the phone and nested source choice.

- **Unpacked extension.** Simple form identity and contact fields filled. The fixture's submit handler did not run during Fill. The privacy-consent box became checked, confirming a release-blocking gap under the proposed policy. Workday-like phone and nested source fields filled. The test used the extension's panel page in a tab and exercised real extension APIs. Docked panel lifecycle and restart recovery are still pending.
- **Synthetic PDF.** With a loopback Ollama stub replying `{"message":{"content":"{}"}}`, posting a fictional description of at least 80 characters to `/api/tailor` generated a 4,239-byte PDF with a valid header and nonempty text extracted by `pdftotext`. This checks integration and rendering with a deterministic response. Model quality and live research remain unverified.

**Observed:** `npm test` exited 0. All six entries ran successfully. The form runner reported 24 of 24 fixture pages with zero page errors and zero reported misses or scanner problems. Its 204 reported field entries include 23 scan self-test entries. Its skip behavior and aggregate counters do not establish a verified readback rate. Two pages reported zero fields. The separate unpacked-extension check used real Chrome extension APIs.

### Application Assistant

In a separate checkout at the pinned SHA:

```bash
npm ci
npm run typecheck
npm run test:core
npm run prepare:browser-tests
npm run build
npm run verify:manifest
```

All six commands exited successfully. The core runner reports one aggregate result with no assertion count. The build produced MV3 output. The manifest check reports declarative HTTP/HTTPS all-frame content scripts, which are outside the proposed permission model.

Run each of the 49 `tests/*_test.py` scripts with Python Playwright. The audit set `CHROME_PATH` and replaced hard-coded `/usr/bin/chromium` references in 36 files in the disposable donor checkout with the same Chrome for Testing executable path. This adjustment was limited to browser selection. A 65-second timeout applied to each test.

**Observed:** 47 passed, two failed, zero timed out. The comprehensive Workday test failed to complete its step because required education and language controls were still incomplete. The planned Workday execution test changed the language state outside the approved plan. Both failures reproduced when rerun individually. Keep both as investigation cases and retain the base Workday implementation until a targeted port proves a measurable gain.

The DOCX probe used Vite to load the donor's exported `createTailoredResumeArtifact` and JSZip in Chrome. It created four synthetic Word packages with `word/document.xml` and `word/styles.xml`, supplied one accepted and supported change, and reopened the returned archive with JSZip and DOMParser.

| Case | Observed |
|---|---|
| One body paragraph and an independent neighboring paragraph | Correct replacement, unchanged neighbor, and byte-identical styles part. |
| Text split across bold and unformatted runs | Replacement inherited the first run's bold formatting across the full span. |
| Same text in two paragraphs | First occurrence changed. The second was preserved, exposing the need for a reviewed paragraph anchor. |
| Source text absent | Returned DOCX with zero applied edits and one missed edit. |

All four outputs reopened and parsed. These probes qualify the operation for a bounded port. Structural rejection, local visual parity, and round-trip content acceptance remain Phase 4 gates.

## Security and compatibility findings

| Priority | Finding | Phase 1 disposition or later gate |
|---|---|---|
| P0 | `extension/sidepanel.js` calls `clickSubmit` on the second panel confirmation and posts `applied` without a success receipt. The LinkedIn, Naukri, and Wellfound scripts also have submission paths. | Remove supported submission controls and script entry points. Assert zero Submit events on fictional portals, including after retries. Record tracker submission separately on confirmation. |
| P0 | `server/src/answer.js` supplies inferred eligibility and consent values. `store.js` supplies self-ID defaults. A panel review tag can accompany a value that has already been written. | Block sensitive categories before rules, answer memory, and model calls, and enforce again before writing. Check the value readback and manual handoff. |
| P0 | Loopback bind and Host/Origin checks exist, with extension identity optional, broad origin defaults, and no independent credential. Fixture endpoints are mounted during normal startup. | Paired token, pinned extension origin, strict Host validation, typed inputs, isolated fixture hosting, and denial of unauthorized side effects. |
| P0 | Manifest requests all URLs and debugger. Existing flow can read mail, type OTPs, follow verification links, send mail, and send vision screenshots. Some panel actions read pages implicitly. | Default off at execution boundaries. Explicit permitted capture and per-run tab/frame permissions. Restrict content-script payloads to current-field values. |
| P0 | Store defaults to an ignored directory inside the checkout. It supports document kinds including ID proof and PAN cards. Tracker defaults can mark an otherwise unspecified application applied. | Private external data root, removable legacy import, disabled sensitive document entry paths, and confirmed submission transitions. |
| P0 | `npm audit` found high-severity findings on the multipart upload dependency chain. Error handling and CI dump messages or logs that can include supplied content. | Patch the base dependency chain before real-file use. Add redacted logs and replace raw CI log excerpts. Make archival and rendering controls a DOCX gate. |
| P1 | Job filtering strips instruction-shaped lines, with no independent policy guarantee. Provider routing can fall back across providers. Company research fetches remote content. | Typed model proposals and approval checks independent of prompts. Consent per provider and payload. Bounded research destinations and redirect checks. |
| P1 | Upstream 0.17.0 includes cover letters, Excel and CSV exports, job and internship views, interview and follow-up tooling, and Workday/custom widget handling. | Retain the existing modules and test safe paths through the panel and API. Qualify related permission-dependent features individually after the safety changes. |

## Dependency, asset, and privacy review

- **Base lockfile.** 330 dependency entries. Direct dependencies are cors 2.8.6, dotenv 18.0.9, exceljs 4.4.0, express 4.22.3, imapflow 2.10.0, mailparser 3.14.1, mammoth 1.13.0, multer 1.4.4, nodemailer 10.3.1, pdf-parse 1.1.1, and pdfkit 0.20.2. Their declared licenses are MIT, MIT-0, or BSD-2-Clause. Checked transitive license metadata and identified two missing declarations. The installed png-js license is MIT. The installed buffers package lacks a license notice and needs provenance closure. Some declarations use dual-license expressions. Use the MIT option where applicable and retain distributed notices.
- **Donor lockfile.** 201 dependency entries with license metadata. Direct runtime dependencies are Mammoth 1.12.0 (BSD-2-Clause), PDF.js 6.2.108 (Apache-2.0), and JSZip 3.10.1 (MIT or GPL-3.0-or-later). WXT tooling introduces further licenses including MPL-2.0. The narrow port depends on its own reviewed dependency set. Asset inventory includes base icons, 20 screenshot files and two reel formats, and the donor's four public icons. Distribution license closure applies to these assets before release.
- **Advisory scan.** `npm audit --json` reported five base findings (three high, two moderate) and four high donor findings. Base entries were busboy, dicer, multer, exceljs, and uuid. Donor entries were xmldom, nanoid, source-map-js, and vite. Recheck against the actual shipped dependency graph before release.
- **Path check.** The inherited ignore lines remain intact. The new rules cover `private_data/`, exports, generated files, local overrides, credentials, and local SQLite files and sidecars. Ran `bash -n scripts/privacy-preflight.sh` and the script itself. A disposable index rejected forced additions of applicant data, a nested env file, a local override, a key filename with whitespace, a SQLite database, a SQLite WAL file, and a generic database file. It accepted placeholder env files and a fictional DOCX test fixture. The fork index has no tracked `private_data/` or `data/`.
- **History and media.** Gitleaks 8.24.3 scanned reachable history with full redaction. The one `linkedin-client-id` match resolves to a normalized job-source label in the historical answer table. Inspected the retired tool-state file's provenance and JSON structure. The test profile uses an example email domain and has no source files or attachments. The encoded PDF was decoded and text-extracted locally without publishing its contents. Upstream documents the screenshots and reel as demo material. Independently checked the media inventory, its change history, and stream metadata. Phase 1 preflight reviewed all 20 screenshots and 49 frames sampled every two seconds across the GIF and MP4 with local Tesseract. The scan found fictional demo labels and no recognizable credential patterns or unexpected email domains. There were no local untracked media files outside dependency caches. OCR is limited to visible, recognizable text and sampled frames. Review the original demonstration assets again before redistribution.

The proposed patch was loaded into a disposable Git index for `git diff --cached --check`, `scripts/privacy-preflight.sh`, and `gitleaks git --staged --redact=100`. All passed. A separate `gitleaks dir --redact=100` scan of the index contents reported only the same normalized label identified in history. The real index remains clear of staged changes.

## Acceptance status and handoff

- **Verified for the Phase 0 changes:** A39. The tracked/staged path guard portion of A40 passed. A40 remains in progress pending CI and release content checks.
- **Baseline evidence recorded:** A01, A18, and A19 have unpacked-extension observations. A17, A46–A50 have preliminary evidence from the legacy PDF, license, and test audits. Their complete release cases remain pending. A28 is blocked by the consent and submission paths described above.
- **Pending for v0.1:** Full acceptance run, outbound consent enforcement, real local model and OAuth qualification, docked panel lifecycle, and supported template and portal verification. Start Phase 1 with a synthetic-only safe application flow and the explicit consent and submission policy.
