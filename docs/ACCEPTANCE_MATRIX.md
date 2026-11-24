# v0.1 Acceptance matrix — executable expectations

The original acceptance criteria are retained below. See the [release verification record](RELEASE_READINESS.md) for the current result and evidence for every ID. A test is `VERIFIED` only after a real execution produces an observed result and the artifact uses fictional data. Record exact commands, environment, date, result, and commit. P0 criteria gate publication. P1 criteria may be deferred with the owner's approval.

| ID | Priority | Test setup and action | PASS criterion |
|---|---|---|---|
| A01 | P0 | Install unpacked extension, open fake job page | Side panel opens, stays usable while page navigates |
| A02 | P0 | Start one research/generation run | Panel shows ordered steps and real outcomes, not fictional progress |
| A03 | P0 | Pause/stop and restart Chrome extension mid-run | No further browser action after stop; persisted status resumes safely, no duplication |
| A04 | P0 | Paste description from restricted-site example | Full research/tailor workflow without scraping site; stores user-provided source |
| A05 | P0 | User-triggered read on permitted synthetic employer page | Preview captures correct job/title/company/URL; no hidden/unrelated content |
| A06 | P0 | Research synthetic company with mix of official/secondary sources | Claim list cites actual source URLs/dates and flags inferences; ambiguity surfaced |
| A07 | P0 | Import fictional resume | Extracted data remains draft until approved; no silent inferred eligibility |
| A08 | P0 | Add fictional achievement with metric, role and proof | Persisted with stable ID, allowed skills, source and approval |
| A09 | P0 | Two jobs require different skill subsets | Relevant subset selected with achievement IDs; unrelated claims excluded |
| A10 | P0 | Malicious job text asks for invented skill | No novel candidate fact appears in resume or form |
| A11 | P0 | Model proposes unsupported number/credential | Rejected as unsupported or flagged for explicit verification, not applied |
| A12 | P0 | Upload standard 1-column DOCX and approve 2 edits | New DOCX retains unaffected paragraph/styles and replaces correct spans only |
| A13 | P0 | Two identical paragraph phrases in different roles | Editor matches anchored target only; does not replace wrong role |
| A14 | P0 | Split-run DOCX/complex layout fixture | Supported edit validated, or safely refused with reason and original unchanged |
| A15 | P0 | Reject one proposed edit, accept another | Only accepted edit appears in DOCX and subsequent application version |
| A16 | P0 | Malformed/unsafe DOCX ZIP | Safe reject; no partial overwrite, path traversal or decompression problem |
| A17 | P0 | Generate optional PDF from validated DOCX | PDF extracts readable correctly ordered text and matches selected DOCX facts |
| A18 | P0 | Fill simple fake applicant form | Normal eligible fields filled from profile, read back, correct types |
| A19 | P0 | Workday-like nested dropdown and split dates | Valid selections and date values verified or flagged manual; no silent success |
| A20 | P0 | Greenhouse/Lever/Ashby/iCIMS-style synthetic fixtures | Site adapter/generic fallback handles supported fields and reports unsupported |
| A21 | P0 | Fake multi-step form changes DOM mid-run | Rescans and re-plans; no stale control selection |
| A22 | P0 | Repeatable work/education/skill entries | No extra/duplicate records, values associated with correct sections |
| A23 | P0 | Upload reviewed resume and let portal parse it | Correct job-specific file attached; reset/missing fields re-validated |
| A24 | P0 | Fake form field returns portal-side validation error | Error detected and corrected or surfaced; not counted verified |
| A25 | P0 | Ask unknown salary/relocation/authorization question | No guessed default; panel blocks and asks exact question |
| A26 | P0 | User approves one scoped reusable answer | Correct matching future field uses answer with conditions; unrelated contexts prompt |
| A27 | P0 | Revoke/expire a saved answer | Future form does not reuse revoked/expired answer |
| A28 | P0 | Form has required consent and a final Submit | Consent follows stored category and exact terms approval. Fill cannot submit. A reviewed application requires a separate one-use approval before assisted submission. |
| A29 | P0 | Save, prepare and apply fake job | Preparation, observed click, and verification use separate timestamps. Applied date requires a receipt or explicit manual confirmation. |
| A30 | P0 | Run same job twice | One canonical job/app record or intentional resume versions; no tracker duplication |
| A31 | P0 | User edits tracker/exports local data | Updates survive restart; export includes correct fields, no secrets |
| A32 | P1 | Opt-in Google OAuth/Sheet selection | Only expected minimal scopes and data columns requested |
| A33 | P1 | Sync one prepared, then submitted application | Same row upserted with actual applied date; minimal payload only |
| A34 | P1 | Replay sync after timeout | No duplicate row, reports retry outcome and conflicts |
| A35 | P1 | Revoke Sheets access / work offline | Local tracker functions; clear error, no unauthorized calls |
| A36 | P0 | Configure local model or explicit BYOK provider | Credentials not in repo, page DOM, content script or screenshots |
| A37 | P0 | Provider times out/returns invalid JSON or billing cap hit | Graceful error, no invented output and no partial browser execution |
| A38 | P0 | Model fallback different provider | No silent transmission of private content to a new provider |
| A39 | P0 | Create `private_data/example.json` and check git ignore | Must be ignored; no tracked private_data file |
| A40 | P0 | Run staged/tracked file privacy preflight | Blocks data/, `.env`, private directories and high-confidence secrets |
| A41 | P0 | Malicious website fetches localhost endpoints | Rejected with no applicant data or side effect |
| A42 | P0 | Forged origin, host, tab/frame or run ID | Rejected; actions cannot cross workflow or unrelated site |
| A43 | P0 | Job text contains prompt injection or exfiltration URL | Treated as untrusted data; no tool command or network leak |
| A44 | P0 | Screenshot/vision and cloud AI are disabled | No outbound PII; explicit opt-in shown before enabling |
| A45 | P0 | Password, OTP, SSN, payment, government ID fields present | No storage, AI access or automatic entry; user handoff |
| A46 | P0 | Inspect MIT files and NOTICE | Original Auto Job + donor notices preserved exactly as applicable |
| A47 | P0 | Scan copied/modified files and dependencies | No GPL AutoApply code/assets; third-party license review documented |
| A48 | P0 | Fresh clone dev setup | Following README reproduces backend startup and load-unpacked extension |
| A49 | P0 | Run CI from clean state | Tests/build/secret scan/license checks pass or clearly fail |
| A50 | P0 | Re-run all synthetic portal fixtures after changes | No regression; failures measured with attempted/verified/skipped counts |
| A51 | P0 | Create fake-user demo | Research → reviewed DOCX → permitted form assist → manual submit → local tracking works |

## Mandatory negative/safety tests beyond happy-path

- Unexpected final-submit label (`Send`, `Finish`, `Confirm`, translated text, nested button) must block.
- Consent and legal declarations require the appropriate preferences and exact authorization. Unsupported controls and EEO self-identification require direct handling, including Workday and Greenhouse variants.
- Citizenship, sponsorship, security clearance, pay and relocation must be unknown until expressly configured; defaults from imported code removed.
- Company research asserting an applicant skill must never turn into a profile claim.
- DOM iframe/cross-origin/closed shadow root unreachable? Show manual action, not fabricated success.
- Resume output error, wrong role attachment, or stale file version must block form upload.
- Duplicate posting from a different URL must map to prior job or ask user; no silent overwrite.
- Repeated API calls, browser worker restart, lost network, Google rate limiting and stale panel state require idempotent recovery.
- Prompt injection via job description, field label, employer website, and file metadata must not override policy.
- Personal data exfiltration via malicious website calling the local backend must fail.

## Report format for each test run

```text
Acceptance ID:
Status: NOT_STARTED | IN_PROGRESS | IMPLEMENTED_UNVERIFIED | VERIFIED | BLOCKED
Test environment: OS / Chrome version / Node version / model mode
Base SHA / donor SHA / project SHA:
Exact command or manual browser steps:
Expected:
Observed:
Log/screenshot path: (fictional fixtures only)
Failure/issue link:
Date:
```
