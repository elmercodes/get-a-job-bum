# v0.1.0 release verification

## Candidate and scope

This Linux release-readiness pass started from clean `feature/dev-v0.1` at Phase 5 commit `535b2e571de4af3b762c0ecd3bfca0c5b53fb69d`. The Auto Job base is `e32598111cd4dd968a6e8980672a1ed3d1128cd9`. The local resume extraction adapter retains the Application Assistant MIT notice at `e795a42bfe058c65f1530bbf68c9a1f09dea7f1d`. There is no new upstream code or runtime dependency in the release preparation.

Local verification used Pop!_OS 24.04 x86-64, Node 22.23.4, npm 10.9.9, Google Chrome 143.0.7499.192 for the inherited DevTools fixtures, Chrome for Testing 147.0.7727.49 for the unpacked extension, and LibreOffice Writer 24.2.7.2 with Bubblewrap and Poppler. All job, applicant, submission, and non-live service data were fictional. The live Google run is recorded separately in [Phase 5](PHASE_5.md).

## Findings and fixes

- The upstream README described OTP, debugger, vision, and job-board workflows that do not reflect the fork's default permissions or supported v0.1 flow. The replacement guide was checked against the running panel and private setup. The unpacked manifest and panel now identify the v0.1.0 application.
- The integrated browser run exposed a stale-attachment failure when a user saved an unrelated reusable answer on the first page of a multi-step form. New Word reviews fingerprint resume evidence independently of the answer bank. Source, job, and other evidence changes continue to block stale exports and attachments. Earlier reviews still use their original revision guard. Regenerate an older review if it becomes stale.
- The panel disables application review until Fill finishes or stops, so the next action reflects the actual workflow state.
- The inherited DevTools suite previously stalled intermittently on the final widget fixture without a timeout. The harness now waits for the expected loaded URL, bounds DevTools calls, and closes its temporary browser profile. Fixture assertions are unchanged. The added ATS-style fixture exercises four fictional field layouts, validation, restricted fields, and unapproved final-action labels.
- The integrated test uses production-mode pairing and a local portal, test DNS/HTTP responses, and mock Google OAuth and Sheets. The test reached the final page only after resolving a missing answer, approving the reviewed artifact, and approving the exact supported acknowledgments and signature. No real employer or applicant was involved.

## Verification commands and evidence

Run from the repository root unless noted. The [developer guide](DEVELOPER_SETUP.md) describes browser setup and troubleshooting.

| Reference | Executed evidence |
| --- | --- |
| Setup | Independently cloned the branch into a temporary checkout with Git object copying disabled, then ran `npm --prefix server ci`. A fresh owner-only configuration loaded through the documented `npm --prefix server start` command. Authenticated health, empty applicant storage, and mode 0700 storage passed. Candidate test files were applied to that checkout with the installed, unchanged lockfile. |
| API and portals | `CHROME=/usr/bin/google-chrome scripts/test-phase1.sh` in the separately installed checkout passed the API, provider denial, evidence, DOCX, research, Sheets, Excel, jobs, panel, and browser regressions. The baseline passed 24 fixtures. The candidate passed 25. `CHROME=/usr/bin/google-chrome scripts/test-phase1.sh scan-ats-styles` passed the final 28 checks in the ATS-style fixture, including unexpected submission labels. DOCX compatibility passed 13 package fixtures and five LibreOffice/Poppler comparisons. |
| Unpacked Chrome | `python server/test/phase1-browser.py "$GAJ_CHROMIUM"` through `phase4-browser.py`, with one script per invocation. Phase 1 verified guarded consent and submission. Phase 2 verified reviewed facts and scoped answer reuse. Phase 3 verified exact Word outputs and recovery. Phase 4 verified production pairing, rejected browser messages, stale research, and interrupted submission. |
| Native Chrome dock | A separate headed run on candidate implementation commit `1a3736f` opened the panel through its popout menu. Chrome reported a native `SIDE_PANEL` context before and after navigating a fictional web tab, and the extension recorded the new tab URL. |
| Integrated Chrome | `GAJ_REQUIRE_PDF=1 python server/test/phase5-browser.py "$GAJ_CHROMIUM"`. This uses a fresh profile. It pairs the panel, approves evidence, leaves imported facts in review, captures and pastes a posting, renders sourced research, downloads matching DOCX/PDF, stops and restarts Chrome, reopens the saved review, fills a multi-step form, approves the attachment and terms, submits once with explicit approval, checks the receipt and the same tracker UUID in mock Sheets, and exercises restart and disconnect. |
| Google live | Recorded at Phase 5. Chrome Desktop OAuth and direct Sheets readback verified sheet creation, repeated requests updating one UUID, queued work after backend restart, a detected conflict, preservation of a manual note, revocation, and reauthorization to the same sheet. The live row was a saved fictional job. The submitted-status projection is verified separately against the mock. |
| Privacy and release | `scripts/privacy-preflight.sh`, `git diff --check`, `node scripts/release-check.mjs`, Gitleaks 8.24.3 redacted history and staged scans, and `npm --prefix server audit --omit=dev` passed. Release checks covered 67 JavaScript files and license metadata. The dependency audit reported zero vulnerabilities. The path guard rejected six deliberately forced private paths in a disposable Git index. The inherited screenshot and reel assets match the upstream baseline. Offline OCR rechecked 20 screenshots and 49 sampled frames. Six recognized email-like strings used example domains, and there were zero high-confidence credential or government-ID patterns. An earlier private audio review is recorded in [Phase 1](PHASE_1.md). OCR and sampling do not establish exhaustive absence of visual text. |
| Hosted CI | The existing Test forms workflow passed on Phase 5 baseline `535b2e5`. The same checks were exercised locally on the candidate. A hosted result for the final release candidate is pending an authorized push. [Baseline Actions run](https://github.com/elmercodes/get-a-job-bum/actions/runs/45314987519) |

## Acceptance results

The [original matrix](ACCEPTANCE_MATRIX.md) defines each case and priority. The verification column names the exact fixture or command group above. A pass applies to the stated scope. External conditions and unsupported cases are kept visible.

| ID | Status | Verification and observed result | Release effect or limit |
| --- | --- | --- | --- |
| A01 | VERIFIED | Native Chrome dock, Integrated Chrome and Phase 4 browser. The native dock stayed open across navigation. The unpacked panel paired and reopened after restart. | Linux Chrome. |
| A02 | VERIFIED | Integrated Chrome. Research showed sources, Word generation entered review before an export, and download appeared after validation. | Panel state observed on a fictional run. |
| A03 | VERIFIED | Integrated Chrome and Phase 4 browser. Stop during a pending answer prevented the write. Restart replayed no form action, and review reopened with the same record. An interrupted submission remained unverified. | Restart resumes only from explicit user action. |
| A04 | VERIFIED | Integrated Chrome and `research-security.mjs`. Pasted text drove research and a saved Word review without accessing a job board. | Manual paste is the restricted-board path. |
| A05 | VERIFIED | Integrated Chrome and Phase 3 browser. Company, role, text, and permitted posting URL came from the fixture. Hidden unrelated text was excluded. | Controlled page and supported metadata. |
| A06 | VERIFIED | `research-security.mjs` and Integrated Chrome. Employer and secondary evidence carried source URLs and retrieval dates. Posting requirements and inferences were separated. | Controlled sources, with live websites outside this test. |
| A07 | VERIFIED | `evidence.mjs` and Integrated Chrome. Imported DOCX facts waited for review and had no effect on eligibility. | Supported local extraction. |
| A08 | VERIFIED | `evidence.mjs` and Phase 2 browser. Approved achievement kept its ID, exact decimal metric, role links, and provenance across restart. | Fictional profile. |
| A09 | VERIFIED | `evidence.mjs`. SQL and firmware postings yielded different top evidence IDs. Rejected facts were excluded. | Deterministic shortlist fixtures. |
| A10 | VERIFIED | `research-security.mjs`, `docx-api.mjs`, and Integrated Chrome. Injected instructions produced no invented credential in the document. | External content treated as data. |
| A11 | VERIFIED | `docx-api.mjs` and Phase 3 browser. Model and manual wording changed a protected metric and were rejected. | Approved factual wording only. |
| A12 | VERIFIED | `docx-engine.mjs` and `docx-compatibility.mjs`. Multiple accepted edits applied and unaffected styles and parts survived. | Tested template classes. |
| A13 | VERIFIED | `docx-engine.mjs` and `docx-compatibility.mjs`. Duplicate text resolved by structural anchors for the selected paragraph. | Supported regions. |
| A14 | VERIFIED | `docx-engine.mjs` and `docx-compatibility.mjs`. Mixed runs and unsupported structures were preserved or rejected with a reason. | Native Microsoft Word pending. |
| A15 | VERIFIED | Phase 3 browser and Integrated Chrome. Rejected edits were absent and the approved variant was the selected artifact. | Fixture Word records. |
| A16 | VERIFIED | `phase1.mjs`, `docx-engine.mjs`, and `docx-transaction.mjs`. Unsafe ZIP/XML, corrupt output and interrupted publication failed closed. | Private originals retained. |
| A17 | VERIFIED | `docx-api.mjs`, `docx-compatibility.mjs`, and Integrated Chrome with `GAJ_REQUIRE_PDF=1`. The same-version render and readable text were verified. | Optional Linux renderer. |
| A18 | VERIFIED | `run-all.mjs form` and Integrated Chrome. Eligible values were filled and read back. | Fictional ordinary fields. |
| A19 | VERIFIED | `run-all.mjs workday wdexp wdstate wdreal` via the full suite. Selected values, state choices and split employment fields were read back or handed off. | Local Workday-like fixtures. |
| A20 | VERIFIED | `run-all.mjs scan-ats-styles`. Four Greenhouse-, Lever-, Ashby- and iCIMS-style fictional layouts exercised generic fill and restricted handoff. | Representative markup only. Live platform-specific coverage is outside the claim. |
| A21 | VERIFIED | Phase 1 browser, `hard` fixture, and Integrated Chrome. Changing controls triggered a fresh scan. | Synthetic multi-step form. |
| A22 | VERIFIED | `run-all.mjs scan-entries sections harman pwc`. Count and section readbacks passed. | Featured structures only. |
| A23 | VERIFIED | Integrated Chrome. Exact reviewed DOCX required attachment approval. The simulated portal parse exposed a new field, which was rescanned and filled. | Fictional parse; stale artifacts still rejected. |
| A24 | VERIFIED | `scan-ats-styles` and `hard` fixtures. The validation message was surfaced and blocked successful classification. | Supported browser error metadata. |
| A25 | VERIFIED | `phase1.mjs`, `evidence.mjs`, and Integrated Chrome. Unknown salary, relocation and sponsorship stayed manual. The panel displayed the unresolved fictional question. | Unsupported sensitive answers entered directly. |
| A26 | VERIFIED | `evidence.mjs`, Phase 2 browser, and Integrated Chrome. Explicitly approved scoped answer reused when eligible. | Scope and conditions apply. |
| A27 | VERIFIED | `evidence.mjs`. Expiration, correction and removal stopped stale answer reuse. | Local lifecycle. |
| A28 | VERIFIED | Phase 1 browser, `phase1.mjs`, `scan-ats-styles`, and Integrated Chrome. Terms, signature and final submit required their respective approvals. Marketing, unexpected labels and synthetic events did not submit. | One approved assisted click. |
| A29 | VERIFIED | `phase1.mjs`, Phase 4 browser and Integrated Chrome. Preparation, observed click and submission verification stayed distinct. Ambiguous receipt left the application unverified. | Portal receipt or explicit manual confirmation. |
| A30 | VERIFIED | `sheets.mjs` and Google live. Repeated application save retained one UUID. An explicit repeat remains a separate record. | Stable app ID. |
| A31 | VERIFIED | `sheets.mjs`, Integrated Chrome, and Google live. Local edits and identity survived restart. CSV excluded sensitive data and escaped formula-like values. | Local authority. |
| A32 | VERIFIED | Google live, `sheets.mjs`, and Integrated Chrome. User authorized `drive.file`, created an app-managed sheet, and separately enabled writes. | Arbitrary-file Google Picker deferred. |
| A33 | VERIFIED | `sheets.mjs` and Integrated Chrome mock. The same row advanced to applied with the portal-confirmed date. Google live verified the same-UUID saved-row update. | Live submission projection was not exercised. |
| A34 | VERIFIED | `sheets.mjs` mock verified lost acknowledgments and rate limits without duplicates. Google live verified ordinary replay and a managed-cell conflict. | Loss and rate limiting scoped to controlled mocks. |
| A35 | VERIFIED | Google live, `sheets.mjs`, and Integrated Chrome. Revocation removed tokens and kept history. Mock outage and replay retained local operation. | Local operation verified during sync disable and mock outage. |
| A36 | VERIFIED | `docx-api.mjs`, `provider-privacy.mjs`, and privacy/release checks. Controlled local provider calls worked. Unapproved external providers received no request. | No live paid provider credentials were used. |
| A37 | VERIFIED | `docx-api.mjs`, `docx-transaction.mjs`, `provider-privacy.mjs`, and `research-security.mjs`. Malformed, absent or interrupted responses failed over safely or surfaced errors without fabricated results. | Actual billing behavior belongs to the configured provider. |
| A38 | VERIFIED | `provider-privacy.mjs`. Unauthorized primary, heavy and fallback providers received zero requests. | Configured consent still controls allowed external calls. |
| A39 | VERIFIED | `git check-ignore --no-index private_data/example.json` and the disposable-index negative test. The path matched and was rejected when forced into the index. | Default private storage is outside Git. |
| A40 | VERIFIED | Private path checks, staged and history Gitleaks scans, and the media review. Six excluded paths were rejected in a disposable index. | Repository rule and scanner results are complementary. |
| A41 | VERIFIED | `security.mjs` and Phase 4 browser. Unauthorized localhost requests and forbidden origins received no applicant data. | Production pairing and origin checks. |
| A42 | VERIFIED | Phase 4 browser, `phase1.mjs` and `security.mjs`. Wrong host/origin, unpaired messages, altered page scope and consumed approval were rejected. | Unreachable frame controls are manual. |
| A43 | VERIFIED | `public-http.mjs`, `research-security.mjs`, and Integrated Chrome. Unsafe destination and prompt-like strings could not produce extra tool requests or claims. | Network policy and fixed browser controls. |
| A44 | VERIFIED | `security.mjs`, `provider-privacy.mjs` and manifest review. Vision and unauthorized model destinations were denied in the default configuration. | Optional integration opt-ins remain explicit. |
| A45 | VERIFIED | `phase1.mjs`, `evidence.mjs`, and `scan-ats-styles`. Password, OTP, SSN, ID and payment fields were held for direct entry. The evidence store rejected restricted input. | Recognized supported labels in fictional fixtures. |
| A46 | VERIFIED | Byte comparison with the pinned upstream root license and the donor license. `NOTICE.md` retains the exact paths and revisions. | Notices intact. |
| A47 | VERIFIED | `scripts/release-check.mjs`, lockfile audit, and provenance review. No GPL AutoApply material was introduced. | Reviewed MIT option retained for JSZip. |
| A48 | VERIFIED | Setup and Integrated Chrome. Independent install and a fresh backend paired from the panel without copying private credentials. | Linux only. |
| A49 | IMPLEMENTED_UNVERIFIED | Baseline Actions run passed. Local candidate equivalents exercised syntax, dependency audit, licensing, history scan and regressions. Hosted execution for the exact candidate is pending. | Hold publication for the final hosted run. |
| A50 | VERIFIED | Candidate Linux portal suite plus the integrated browser checks. The 24 inherited fixtures and the additional synthetic ATS-style fixture are exercised. | One inherited DevTools harness at a time. |
| A51 | VERIFIED | Integrated Chrome with controlled sources, fixture receipt and mock Sheets. All stages ran in one paired application workflow. | Synthetic only, with the separate live Sheets checks recorded above. |

## Platform and publication

Linux is the verified development platform. Native Microsoft Word, Windows and macOS checks remain pending. The [manual setup checklist](DEVELOPER_SETUP.md#verify-another-platform-manually) and [Word comparison procedure](WORD_COMPATIBILITY.md) provide the verification steps. Unsupported Word structures remain read-only. Real employer websites, live paid providers, complex iframe support, and general Google Picker selection are outside the claimed coverage.

The candidate is suitable for maintainer review. Wait for the final hosted workflow before publication. After explicit approval, push the local release-readiness commit to the fork's development branch and verify **Test forms** for that exact SHA. If the owner chooses to merge into the fork's `main`, verify the resulting release commit and its checks. Create the annotated `v0.1.0` tag on the approved commit, push that tag to the fork, and publish using [the prepared release notes](RELEASE_NOTES_0.1.0.md). The upstream Auto Job repository is outside this release sequence.
