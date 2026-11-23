# Applicant Evidence Store

The **Applicant evidence** card in the existing Profile tab is the source of applicant facts. Add records directly or extract a resume for review. AutoFill and the PDF renderer consume approved facts. The local tracker, pairing, and consent settings retain their Phase 1 behavior. [Storage decision](ARCHITECTURE_DECISIONS.md)

## Use the panel

1. Pair the backend using the [Phase 1 setup](PHASE_1.md). Open **Profile → Applicant evidence**.
2. Add personal details, roles, projects, accomplishments, skills, education, certifications, languages, and standard applicant details. Review the draft before choosing **Approve and save**. A source file or a manually supplied accomplishment can have its own record.
3. Link accomplishments to roles or projects. Link skills to any supporting employment, education, project, or accomplishment. Enter proficiency only when you can support it. Keep historical roles and dates distinct, including concurrent roles.
4. Choose **Extract resume for review** for a DOCX, text-based PDF, or UTF-8 text resume. Use **Needs review** and compare conflicts before approving. Open the retained original to inspect sections the parser could not classify.
5. On an application, **Fill** uses approved facts and surfaces missing answers. Enter unsupported sensitive values directly on the employer's page. For an ordinary missing question, choose a reuse scope and explicitly approve the answer in the panel. Open **Answer context for this application** when a saved answer depends on employer, job country, or employment type. That context applies to the current page.
6. Review and edit saved answers under **Applicant evidence → Reusable answers**. Archive or delete obsolete facts. Use the private export controls when moving between installations.

A saved answer matches a normalized question and a compatible control, available choice, unchanged qualifier, scope, conditions, and expiration. A short explicit alias list covers identical meanings such as “How should we contact you?” and “What is your preferred contact method?” Repeated employment-row answers use structured facts. If a sensitive preference such as relocation matches its approved conditions, the panel can show it for manual entry. It cannot change the Phase 1 legal or consent policy.

## Data model and interfaces

`profile.json` stores schema version 2, an incrementing revision, records, source descriptors, and supporting document references. Record types carry:

| Record | Main fields |
|---|---|
| Personal and contact | Legal, preferred and component names, email and phone lists, addresses, location, professional URLs, and approved personal details |
| Employment | Employer, title, employment type, dates, location, responsibilities, technologies |
| Accomplishment | Original text, optional context, associated role or project IDs, skills, tags, and metrics with original numeric text and explicit units |
| Qualification | Skill, education, project, certification, and language fields. Skills can reference supporting records |
| Standard detail | A supported key and its approved value |
| Reusable answer | Original question, normalized lookup key derived at read time, typed response, qualifier, scope and scope value, country or employment condition, expiration |

Each record has a stable UUID, provenance, review status, creation and update timestamps, and an approval timestamp when applicable. Imports start pending or conflicting. An explicit review can approve, reject, or archive them. The schema reserves `ai_suggested` for future draft suggestions. The current local extractor never writes approved facts. A conflicting edit can replace existing records only after an explicit choice. Removing a supporting record withdraws linked facts from the approved projection.

- `GET /api/evidence` returns records, sources, supported fields, and current revision.
- `POST /api/evidence/records` creates or edits a record and records the review decision. `DELETE /api/evidence/records/:id` deletes one record. Mutations require the current revision.
- `POST /api/profile/import` accepts multipart `resume` and `revision`. The source endpoints download or remove original bytes. `GET /api/evidence/export` returns a private JSON export. Originals have separate downloads.
- `POST /api/evidence/select` accepts `description` and optional `limit` and returns ranked approved career records and their IDs. `GET /api/profile` provides the read projection for existing Auto Job components. `POST /api/tailor` renders a local, extractive PDF from approved facts and reports evidence IDs. Job-specific variants remain separate from the original accomplishment records.

Legacy `profile.json` is migrated when first accessed. Supported structured fields enter the review queue and active document references are retained. Unknown fields, prohibited identifiers, and old aggregated resume text stay out of the new schema. Make a private backup of a legacy profile before first opening this build if you need access to those original fields. Reimport the original resumes for source provenance. Legacy keys and unscoped remembered answers get no automatic approval.

## Storage, privacy, and limits

The app keeps the existing per-user data directory and retains one authoritative profile. It rejects trackable worktree storage paths, including symlink aliases. Only the existing ignored development data roots are allowed inside the checkout. The staged-path guard and export ignore rules are defense in depth. Save exports outside Git and inspect staged files before publishing.

Writes use unique owner-only temporary files, flush contents, then rename atomically. An interrupted temporary write leaves the prior data readable. A corrupt profile fails closed. Run one server process per data root. Directory permissions and the local API token protect ordinary access. Other processes running as the same OS user can read private files. Full-disk or per-user disk encryption can protect offline data. This version uses no app-managed encryption key.

The importer validates and parses documents locally. Originals are immutable private assets. The Phase 1 size and archive checks still apply. A content guard refuses common credential and identifier patterns. It cannot identify every format of identifier in free text, so keep secrets and identity numbers out of source resumes and applicant fields. Scanned PDFs, image-only documents, and complicated layouts may need manual entry. The donor parser is heuristic and includes some English-language and regional assumptions. Review every proposal.

Individual record deletion takes effect immediately in active reuse. Historical backups can retain old values until retention expires. The full evidence deletion action also removes managed source documents, attachments referenced by the profile, and managed profile backups. Separately downloaded files, generated PDFs, tracker history, and Phase 1 settings such as the stored signature have their own lifecycles.

Import, form answering, evidence selection, and extractive PDF generation make no model requests. Optional tasks such as cover-letter drafting can use a configured model. Put each authorized cloud provider in `AUTOJOB_AUTHORIZED_PROVIDERS` in private server configuration. Heavy and fallback providers require their own authorization. Ollama must use loopback. Approved facts are the candidate input for models, and raw sources and unapproved records stay out of those prompts. Generated drafts remain subject to user review.

## Verification commands

```bash
npm ci --prefix server
scripts/test-phase1.sh
python3 server/test/phase1-browser.py /path/to/chrome-for-testing
python3 server/test/phase2-browser.py /path/to/chrome-for-testing
scripts/privacy-preflight.sh
npm audit --prefix server
```

The regression script uses disposable fictional data. Its test fixture bootstrap marks only those fixtures as explicitly reviewed. The production migration always creates unreviewed rows. The browser commands require Python Playwright and a Chrome for Testing executable.

## Phase 3 integration

1. Pass the selected source ID, immutable original DOCX, and approved record IDs to the future document service.
2. Bind each proposed edit to exactly one paragraph and span. Verify its claims against those specific evidence IDs, including entities, numbers, and units, and keep user acceptance separate from the master accomplishment.
3. Apply accepted changes to a copy. Reject ambiguous anchors and unsupported formatting. Reopen the complete archive and compare paragraph text, untouched parts, and approved facts before exporting.
4. Derive PDF from the validated DOCX and verify layout and extractable text. Keep the existing local extractive PDF action available for legacy templates.

## Changed paths

| Area | Paths and purpose |
|---|---|
| Evidence schema and storage | `server/src/evidence-model.js` defines record validation, scope matching and status rules. `evidence-store.js` handles revisioned persistence, import and deletion. `evidence-profile.js` migrates legacy rows and projects approved facts. `storage.js` implements the shared private data root and atomic writes. `store.js` retains application and document interfaces. |
| Application and provider integration | `server/src/index.js` routes authenticated evidence requests and connects approved facts to import, answers, and PDF tailoring. `answer.js` uses reviewed facts in the active form path. `llm.js` enforces provider authorization and loopback for Ollama. `server/.env.example` documents the new opt-in. |
| Chrome panel | `extension/evidence-panel.js` adds the editor, import review, and answer prompts. `sidepanel.html`, `sidepanel.css`, and `sidepanel.js` integrate those controls. `application-workflow.js` scopes answer context and keeps explicit Phase 1 approvals. |
| Attribution | `server/src/vendor/resume-extraction.js` adapts the pinned donor parser. `NOTICE.md` records source and revision. `third_party_licenses/Application-Assistant.txt` preserves the donor's full MIT notice. |
| Verification and Git privacy | `server/test/evidence.mjs` covers CRUD, trust state, DOCX, matching, migration, write failure, and backend restart. `provider-privacy.mjs` covers outbound authorization. `phase2-browser.py` and `phase2-form.html` exercise the editor and restart in Chrome. `seed-evidence.mjs`, `phase1.mjs`, `phase1-browser.py`, `server/package.json`, and `scripts/test-phase1.sh` run the inherited regressions against reviewed fictional records. `.gitignore` protects default export names. |
| Documentation | `README.md`, this guide, and `docs/ARCHITECTURE_DECISIONS.md` explain setup, provenance and the Phase 3 integration boundary. |

## Observed results

- Node 22 and a clean dependency install passed the evidence integration and provider tests. The API suite exercised migration into review, incompatible dates, duplicates, approved and rejected claims, numerical precision, source download and deletion, typed scoped answers, stale revisions, failed rename cleanup, and backend restart.
- The full regression command passed its nine entries and all 24 inherited Chrome fixtures. The original Workday-like and multi-page fixture checks remained in the suite. The two Application Assistant Workday failures remain recorded in the Phase 0 audit.
- In unpacked Chrome, the Phase 1 suite passed attachment, exact disclosure approvals, submission approval, receipt verification, repeat refusal, and stale-form checks. The Phase 2 suite added profile, employment, accomplishment, and skill records, saved a missing scoped answer, restarted Chrome and the backend, and reused that answer and unchanged remembered privacy terms. It also edited the retained accomplishment.
- The Git ignore and runtime path checks rejected a trackable data location. The index path guard and redacted staged secret scan passed. The root MIT license and exact donor notice were verified. The dependency audit reports zero high or critical findings and two moderate inherited findings.
- A07 and A08 have verified draft, approval, and stable-ID coverage. A09 has approved-evidence ranking coverage. A10 and A11 have exclusion coverage for unapproved claims and extractive PDF generation. Rewrite validation and document layout belong to the next milestone. A26 and A27 cover scoped reuse, expiration, correction, and deletion. A28, A29, A39–A41, A46, and A50 retained local verification. Hosted CI and the complete product release remain pending.
