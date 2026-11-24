# Phase 4. Compatibility, research security and recovery

Phase 3 was verified and committed locally as `61b8487` on `feature/dev-v0.1`. The baseline contains 28 paths and passed the 24 inherited fixtures, unpacked Chrome Phases 1–3, the privacy preflight and a redacted staged scan. The original Auto Job MIT license and the pinned Application Assistant notice are preserved. Phase 4 builds on Auto Job `e32598111cd4dd968a6e8980672a1ed3d1128cd9` and the Phase 2 parser adapted from Application Assistant `e795a42bfe058c65f1530bbf68c9a1f09dea7f1d`. Phase 4 adds no donor implementation or AutoApply code.

## Local developer setup

1. Clone the repository, check out `feature/dev-v0.1`, and run `npm --prefix server ci` with Node 22. Install Chrome or a compatible Chromium build. Use Linux, macOS or Git Bash for the shell examples.
2. Copy `server/.env.example` to `server/.env`. Generate a private `AUTOJOB_TOKEN` with `node -p 'require("node:crypto").randomBytes(32).toString("hex")'`. Load `extension/` unpacked in Chrome developer mode and set `EXTENSION_ID` to the displayed extension ID. Set `AUTOJOB_DATA` to a private directory outside the checkout if you want a separate demo installation.
3. Run `npm --prefix server start`. Open the extension and pair it under **Profile** using the loopback URL and the token. Applicants' data and artifacts use the private local data directory. The fictional workflow can use local extraction and ranking without any provider. Configure Ollama or an expressly authorized cloud provider only if testing optional model ranking.
4. Create a fictional Word source from the repository root using the command below. Under **Profile → Applicant evidence**, add and approve the fictional position **Engineer** at **Fictional South Labs**, and an accomplishment linked to it such as **Utilized SQL to reduce reporting time by 12.50%.** Under **Profile → Resume**, import the fictional source DOCX. Imported facts enter the review queue.
5. Under **Apply → Job**, add **Fictional South Labs**, **Data Engineer**, and paste **SQL reporting experience is required. This fictional role reduces reporting time and validates reporting datasets for internal projects.** Open the Word tailoring section. Generate proposals, accept the approved bullet, reject any other suggestions, and export. The generated master copy remains separate.
6. For a complete portal exercise, run the unpacked Chrome test for Phase 3. It launches its own disposable local fixture server and Chrome profile, fills a fictional application with the reviewed artifact after attachment approval, and leaves it unsubmitted.

```sh
node --input-type=module -e 'import fs from "node:fs/promises"; import os from "node:os"; import path from "node:path"; import {makeDocx} from "./server/test/docx-fixture.mjs"; const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gaj-demo-")); const file = path.join(dir,"fictional-source.docx"); await fs.writeFile(file, await makeDocx()); console.log(file)'
```

If startup refuses pairing, check the exact extension ID, local port and token in the server configuration. Token rotation takes effect after restarting the backend. Pair with the new token in Profile. The extension verifies new settings before replacing a working pairing. Linux optional PDF rendering requires LibreOffice, Poppler and Bubblewrap. If these are absent or disabled, the backend can still validate DOCX structure and extracted text. See the [manual Word procedure](WORD_COMPATIBILITY.md).

## Outbound URL audit and controls

| Boundary | Finding and Phase 4 behavior |
| --- | --- |
| Company research, both panels | The legacy path accepted arbitrary posted links and followed redirects. Both panels now share a bounded public reader. Use an expressly entered employer website or the official website from an exact-name Wikidata company match. Only one related same-domain about or careers page is read. News and encyclopedia APIs have fixed hosts. No job-page link harvesting or LinkedIn/Indeed scraping is needed. |
| Job status and Workday | Inherited hostname checks missed DNS and redirect destinations. All public status requests and the derived same-origin Workday JSON request go through the reader. Blocked, malformed or unavailable results remain unknown. Restricted board hosts are skipped. |
| Public catalogs and GitHub profile expansion | Hackathon and internship sources have bounded content, known hosts and a limited redirect policy. GitHub expansion validates the selected public profile path, encoded as one account segment. Devfolio's fixed POST does not follow redirects. |
| Provider endpoints and mail | Provider URLs and mail credentials come from private installation configuration. Model calls keep the existing authorization and redirect block. Public-source requests never receive the credentials. Gmail background and model categorization each need a distinct opt-in. IMAP and SMTP use fixed Gmail endpoints and are user-controlled integrations. |
| Extension links and messages | Manual job, board and source navigation uses inspected HTTP(S) links. Links reject embedded credentials. Catalog thumbnails no longer initiate third-party requests. Extension CSP confines fetch connections and image loading. The message listener accepts supported messages only from the top-level paired panel document. Content scripts remain isolated and cannot read pairing storage. |
| Local API and browser | The API keeps its loopback binding, exact Host and Origin policy, extension identity, token and cache protections. Existing runner checks restrict same-origin form actions. Both permissions and final submission remain user-controlled. |
| DOCX and exported links | Preserve ordinary hyperlinks as explicit links and reject unsafe relationships. Active fields that can fetch external content are now rejected, including field codes split across runs. Supported local fields remain read-only. The optional renderer has no network. Spreadsheet hyperlinks also reject embedded credentials and unsupported schemes. |

The public reader canonicalizes URLs, permits standard ports only, resolves the complete IPv4 and IPv6 answer, and rejects any unsafe address. Node receives a validated numeric address as the connection destination. TLS still verifies the original name through SNI and the HTTP request retains the corresponding Host header. Redirects have a hop limit, repeat validation for each destination, and cannot downgrade HTTPS. Source-specific allowlists add tighter restrictions where possible. A single deadline covers DNS and the response. Content types are checked, compressed responses are refused, and streaming enforces the byte limit even without Content-Length. Network, model, and parser failures use generic messages. [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) · [IANA IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry) · [IANA IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry)

The research panel labels posting requirements, employer or reference excerpts, reported headlines, possible skill overlap, and unknowns separately. Cited excerpts carry retrieval times. Malicious instructions, markup and inactive script text are not executed. Optional ranking gets only public excerpts and can return existing IDs. Schema failures fall back to source order. Reviewed Word claims still come from approved applicant evidence. Older generated research caches remain historical and do not feed the new grounded workflow.

## Recovery

- Research requests for the same scope share one in-flight operation. An earlier result cannot overwrite a newer cache entry. The sidebar cancels old work on input changes and checks the full posting when a response arrives.
- Word proposal requests accept operation IDs bound to the source, exact posting and model choice. Concurrent retries coalesce. A persisted response can be recovered after restart. A closed panel keeps only an opaque request fingerprint and ID, plus the last review ID in Chrome session storage. Reopen a saved review deliberately. Attachments still need a fresh selection and the existing form-specific approval.
- Export remains transactional. The original source and evidence keep their contents. Staged artifacts survive no incomplete publication, and a retry uses the same verified version for the same decisions. Recovery tests interrupt model generation and kill a process during document staging.
- The submission approval disappears when the reviewed page refreshes or navigates. Reopening the panel requires a fresh form review. A durable attempt authorized just before interruption remains `submission_unverified` after restart. It cannot silently retry or set a verified timestamp. Existing consent tests continue to exercise required authorized boxes and unchecked marketing consent.

## Verification and release state

| Command or environment | Result and evidence |
| --- | --- |
| `npm --prefix server run test:phase4` | Controlled network and research tests plus 13 synthetic OOXML fixtures. Five layout comparisons pass when Linux rendering is available. |
| `npm --prefix server run test:docx` | Exact targeting, rejected edits, protected parts, atomic rollback, matching PDF, interrupted model proposals and restart recovery. |
| `CHROME=/path/to/chrome scripts/test-phase1.sh` | Inherited API, pairing, evidence, workbook, panel and 24 portal fixtures. Run one instance at a time because the inherited harness uses a fixed debugging port. |
| `python server/test/phase{1,2,3,4}-browser.py /path/to/chrome` | Run each script separately with Playwright installed. Phase 4 uses production-mode authentication and a browser-intercepted fictional form. |
| `node scripts/release-check.mjs`, `scripts/privacy-preflight.sh`, `gitleaks git --staged --redact=100`, `gitleaks git --redact=100` | Syntax, whitespace, license metadata, ignored paths and secrets. History has one reviewed inherited false positive in a public job-source list. The exact commit, path, rule and line fingerprint are recorded in `.gitleaksignore`. |
| `npm --prefix server audit --omit=dev` | Zero findings after the narrowly scoped ExcelJS UUID override. The conditional-format writer and reader round-trip exercise the affected library path. |
| Linux Chrome for Testing 147, Node 22, LibreOffice 24.2 | Automated browser, renderer and installation verification performed here. Windows, macOS and Microsoft Word on both platforms are pending. |

ExcelJS 4.4.0 uses UUID's CommonJS v4 export. The inherited advisory affects the v3, v5 and v6 buffer-writing interfaces. The version 11.1.1 override retains the CommonJS export and resolves the advisory without changing ExcelJS. JSZip continues under its MIT option. The release checker records the verified MIT/X11 source checksum of the inherited `buffers` tarball, which lacks an SPDX field. The upstream project notices are retained. [UUID advisory and affected interfaces](https://github.com/advisories/GHSA-w5hq-g745-h8pq)

The existing Linux Actions workflow now runs the same fictional regression suite and adds syntax, staged-path, dependency, license and redacted history checks. It needs no production keys and has no deployment or artifact upload steps. The workflow configuration is local and hosted CI has not been run for this phase. `npm --prefix server run test:portable` exercises the native-security and Word package tests where supported, skipping only actual render comparisons when Linux tools are unavailable.

**Verified on local fixtures** includes the Phase 4 portions of A01, A03, A05–A06, A12–A17, A23, A28–A30, A36–A44, A46–A47 and A50. A48 was exercised across a clean dependency install, controlled backend and unpacked Chrome on Linux. A49 has local equivalents and hosted execution remains pending. Direct Microsoft Word fidelity and Windows/macOS application runs remain pending. The older donor Workday cases are outside this fork's verification. Live employer retrieval and live paid-provider ranking were not part of this test pass.

## Modified paths

| Paths | Purpose |
| --- | --- |
| `.github/workflows/test.yml`, `.gitleaksignore`, `scripts/release-check.mjs` | Local workflow hardening, exact historical scanner exception and build checks. |
| `README.md`, `NOTICE.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/PHASE_3.md`, `docs/PHASE_4.md`, `docs/SECURITY_PRIVACY.md`, `docs/WORD_COMPATIBILITY.md` | Developer setup, provenance, network policy, manual checks and verification. |
| `extension/application-workflow.js`, `extension/background.js`, `extension/content.js`, `extension/docx-panel.js`, `extension/manifest.json`, `extension/sidepanel.html`, `extension/sidepanel.js` | Paired messages and storage, protected links and rendering, current research, review retries and navigation recovery. |
| `server/.env.example`, `server/package.json`, `server/package-lock.json` | Documented opt-ins, test commands and patched UUID override. |
| `server/src/public-http.js`, `server/src/research.js`, `server/src/guard.js`, `server/src/prompts.js`, `server/src/index.js` | Pinned network policy, grounded research, safe model inputs and integration. |
| `server/src/jobcheck.js`, `server/src/hackathons.js`, `server/src/internships.js`, `server/src/export.js` | Guard existing outbound reads and serialized spreadsheet links. |
| `server/src/mail.js`, `server/src/outcomes.js` | Explicit mail scheduling and provider usage. |
| `server/src/docx-engine.js`, `server/src/docx-routes.js`, `server/src/docx-service.js` | Protect active fields, reuse grounded research and recover idempotent proposal requests. |
| `server/test/docx-api.mjs`, `server/test/docx-compatibility.mjs`, `server/test/docx-transaction.mjs`, `server/test/export.mjs`, `server/test/phase4-browser.py`, `server/test/public-http.mjs`, `server/test/research-security.mjs`, `server/test/security.mjs` | Controlled fixtures for parsing, render fidelity, workbook lifecycle, paired network policy and real Chrome recovery. |

## Phase 5 plan

Keep the local tracker authoritative. Define the spreadsheet columns and stable application ID first, then implement opt-in, least-scope OAuth for a sheet the user selects. Stage queued upserts locally before sending. Replay by stable ID after failures, track sync revisions and surface conflicts for review. Permit offline edits and revocation while keeping private answers, attachments and resume content out of the sync payload. Test reconciliation, backoff, duplicate prevention, scope and revocation against fictional data and a mock Sheets service before any live integration.
