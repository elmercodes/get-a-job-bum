# Phase 3. Tailor an existing Word resume

## User workflow

1. In **Profile → Resume**, import a DOCX. The original is retained separately from the extracted records. Approve the facts you want to reuse in **Applicant evidence**.
2. In **Apply → Job**, paste a description or select **Read page** on a permitted employer site. Add the employer, role and location if the posting identifies them. The Word workflow also recognizes explicit job information in the posting.
3. Open **Resume & cover letter → Tailor an existing Word resume**. Select the original. **Research employer using public sources** is optional. It saves attributable observations beside the posting, and can optionally use the configured model to rank them.
4. Choose **Analyze posting and propose edits**. The panel shows posting requirements, possible evidence matches, evidence gaps, relevant terminology, and unlinked original lines. An original line without a link remains source text awaiting evidence review.
5. Compare each original and proposed paragraph. Accept, reject or choose an allowed wording variant. Both paragraphs in a reorder need the same decision. Update the underlying approved evidence and generate a fresh review when a fact needs correction.
6. Choose a length preference and optional PDF, then select **Validate and export approved edits**. The original never changes. Open a saved review to recover the last decisions and download versioned artifacts.
7. To use a current export on an application, select the DOCX or PDF for that posting. **Fill application** asks for the existing per-field attachment approval. If the site only accepts one format, select a compatible validated artifact or upload manually. Submission still goes through the separate application review and approval.

The built-in PDF template and cover-letter tools remain available in their existing workflows.

## Content and evidence contract

The local strategy ranks the approved Phase 2 records against the requirements and responsibilities stated in the posting. External research is displayed as a separate set of sourced observations. A keyword match means possible support. It cannot verify a degree, skill, duration, role, or condition by itself. Employment and education headings, source dates and contact lines are protected. A replacement experience bullet requires an exact recognized employer and title context and an accomplishment linked to that approved employment record. Known dates disambiguate repeat roles when present. Unsupported or uncertain contexts remain visible in the original.

A proposal stores the original text, anchor, edit type, candidate wording, approved evidence IDs, job requirement IDs, reason, and validation state. Variants are compiled from approved record text and a short list of meaning-preserving changes such as “utilized” to “used.” The validator allows whole variants only and checks the evidence again at export. It cannot substitute a percentage, change a unit, add certification or infer a longer duration. Selected summaries, approved skills and certification names use the same gate. The limited reorder swaps two adjacent, equally formatted bullets from the same role when both are backed by distinct, exact evidence. Removal clears one plain duplicate summary line while keeping the other copy and the existing paragraph spacing.

Local analysis makes no provider or external research request. If model ranking is selected, the existing authorized provider receives the posting excerpts and a bounded set of applicable evidence snippets with opaque IDs. It returns eligible target, candidate and requirement IDs. Any free-form proposed text, unknown ID, extra field, failed request, or invalid combination returns the review to local ranking. The provider receives no full source document or profile export. There is no automatic provider fallback in this workflow. The public research button sends the employer to fixed WikiData, Wikipedia, and Google News HTTPS origins. Research ranking sends public observations and the employer and role to the configured provider. It receives no applicant records. Cache reuse and the provider request were tested with controlled responses.

## How Word edits are applied

| Layer | Implementation |
| --- | --- |
| Package | Validate the uploaded ZIP and measure actual decompressed size. Recheck CRC, Word MIME type, the main-part relationship, XML encoding and structure, and external or active relationships. |
| Address | A target carries the main-part name, indexed XML path, section and container, optional Word paragraph ID, original paragraph hash, text hash, formatting hash and adjacent text hashes. The entire original DOCX SHA-256 is also required. Resolution uses all those fields and the original text. Duplicate words never trigger a text search fallback. |
| Formatting | Only the contents of direct text nodes are patched. For equivalent visible runs, new text goes in the first previously nonempty run and the other text nodes are cleared. Run properties, paragraph properties, the number and order of tags, styles, lists, margins, dimensions, sections, hyperlinks, and all other package parts are retained. |
| Approval | Resolve the full accepted batch before writing. Reject missing, stale, duplicate, unsupported, or conflicting addresses. Require a decision for every proposal. Only accepted changes are planned. |
| Readback | Write into an owner-only staging directory. Reopen the staged file, check the planned main part and every protected part hash, compare each changed paragraph at its expected position and verify the shape of its markup. Compare untouched paragraph hashes and extract text with Mammoth. |
| Publication | When available, validate the local render and proposed PDF. Verify the staged artifact hashes again and check source and evidence freshness immediately before atomic directory rename. Failure leaves the original and prior validated versions available. Identical requests within one review reuse the same verified version. Downloads recheck hashes. |

The memoized evidence revision makes previously reviewed proposals historical after the evidence changes. Export and upload require the current posting and unchanged source. Each private version keeps the source ID and SHA-256, job fingerprint and posting snapshot, evidence revision and IDs, proposal and decision IDs, approved wording, generation time, provider and model if used, layout results, and artifact hashes. The newest validated version in a review is eligible for attachment. Historical versions are separately labeled and downloadable. Review metadata and artifacts live under the same owner-only application data root as the Phase 2 evidence store. Deleting a source or clearing the evidence store removes the corresponding local Word reviews and versions. Downloads and already-shared copies remain under user control.

## Supported Word features and layout limits

- **Editable** includes ordinary transitional DOCX body paragraphs and simple table-cell paragraphs with visible text and uniform inline format. The strategy looks for conventional section headings and exact employment context. Direct styling and a run split across the same style are supported.
- **Preserved read-only** includes headers, footers, comments, footnotes, endnotes, hyperlinks, fields, text boxes, drawings, shapes, content controls, tracked changes, nested tables, mixed-format paragraphs, hidden text and unusual containers. Main-part and layout warnings help flag tables, columns and dynamic features. The file is rejected if its package is corrupt, macro-enabled, protected, signed, or contains unsafe relationships or embedded active content.
- **Layout and PDF** use local Linux LibreOffice Writer, Poppler and Bubblewrap. The converter sees a private temporary filesystem, an isolated profile and no network. A verified render checks readability, expected paragraph text, page dimensions and page count. A changed page count produces a warning. The one-page preference requires a verified one-page render. If the tools or sandbox are unavailable or explicitly disabled with `AUTOJOB_DOCX_DISABLE_RENDER=1`, a structurally verified DOCX is still available under the other length preferences. A failed render or missing verified text blocks export when supported tooling is active.
- **Limits** include scanner-specific ATS behavior, exact Word pagination, full visual overflow detection, and arbitrary multi-column or complex-template editing. Font substitution and different layout engines can move content between pages. Review a real resume in the application in which it will be shared. No margins, fonts, or line spacing are compressed to meet a page preference.

## Reuse and attribution

Auto Job at `e32598111cd4dd968a6e8980672a1ed3d1128cd9` provides the posting input and extraction, company research infrastructure, provider adapters, ZIP upload checks, local storage, application upload approval, and built-in PDF workflow. Phase 2 provides the approved evidence interface, resume import, retained originals and Mammoth text extraction.

Application Assistant at `e795a42bfe058c65f1530bbf68c9a1f09dea7f1d` provided the existing Phase 2 resume parser and the Phase 3 design reference for patching the source package and reviewing edits. The donor `utils/source-tailoring.ts` can locate the first duplicate match and can finish with a missing edit. The Phase 3 editor, review gate and transactional exporter are independent implementations. The pinned donor notice and root Auto Job MIT license are retained. JSZip is used under its MIT option and Saxes under ISC. AutoApply was a conceptual reference only. The two inherited donor Workday test failures remain outside the Word pipeline. See [upstream audit](UPSTREAM_AUDIT.md) and [notices](../NOTICE.md).

## Verification

Run with fictional data and ignored or external application storage.

```bash
npm --prefix server run test:docx
CHROME=/path/to/chrome scripts/test-phase1.sh
python server/test/phase1-browser.py /path/to/chrome
python server/test/phase2-browser.py /path/to/chrome
python server/test/phase3-browser.py /path/to/chrome
scripts/privacy-preflight.sh
npm --prefix server audit --omit=dev
```

The Python tests require Playwright and an unpacked-compatible Chrome build. The DOCX fixture tests cover duplicate body and table content, duplicate titles, separate header content, stale anchors, multiple edits, unsupported structures, approved versus unsupported evidence, fabricated metrics and units, output corruption, process interruption, transactional cleanup, private downloads, duplicate exports, and stale uploads. When the renderer is available they verify PDF text, pagination, dimensions, and a visual comparison of unchanged top and bottom bands with changed body pixels. The Chrome workflow covers page capture and manual paste, source upload, proposal review, the unsupported wording gate, DOCX/PDF download, separately approved upload, and saved review recovery after restarting Chrome and the backend. Inherited Chrome tests exercise separate submission approval and verified or unverified outcomes.

The dependency audit on this branch reports two inherited moderate findings in ExcelJS and its UUID dependency. It reports zero high or critical findings. The optional local renderer is maintained by the OS package manager. The application uses filesystem permissions and does not manage an encryption key. Continue to use a private storage location and heed the [security and privacy notes](SECURITY_PRIVACY.md).

The older Company research card still accepts links from the posting. Its URL-fetching policy needs a separate network-boundary review before public release. The new Word research route contacts only fixed public origins.

## Changed files

| Files | Purpose |
| --- | --- |
| `.gitignore`, `README.md`, `NOTICE.md` | Ignore default artifact names, document the entry point and record licensing. |
| `docs/ARCHITECTURE_DECISIONS.md`, `docs/PHASE_3.md`, `docs/SECURITY_PRIVACY.md` | Describe the implementation, privacy controls, supported structures and validation limits. |
| `extension/docx-panel.js`, `extension/sidepanel.html`, `extension/sidepanel.css` | Add Word inputs, progress, review, version display, downloads and attachment selection. |
| `extension/sidepanel.js`, `extension/evidence-panel.js` | Use the validated Word artifact through the existing authorization flow and disclose source deletion effects. |
| `server/src/docx-engine.js`, `server/src/docx-layout.js` | Validate, address, patch, reread and render Word packages. |
| `server/src/docx-strategy.js`, `server/src/research.js`, `server/src/llm.js` | Build evidence-linked proposals and isolated research, validate model selections and apply provider budgets. |
| `server/src/docx-service.js`, `server/src/docx-routes.js`, `server/src/index.js` | Store reviews privately, enforce atomic exports and serve paired API endpoints, downloads and attachments. |
| `server/src/uploads.js`, `server/package.json`, `server/package-lock.json` | Verify decoded archive sizes, pin existing ZIP/XML dependencies directly and register the Word suite. |
| `server/test/docx-fixture.mjs`, `server/test/docx-engine.mjs`, `server/test/docx-api.mjs`, `server/test/docx-transaction.mjs` | Generate fictional DOCX inputs and exercise package, API, layout, model and transactional behavior. |
| `server/test/phase3-browser.py`, `server/test/phase3-form.html` | Exercise the Word workflow and real Chrome attachments using a fictional employer portal. |

## Recommended next milestone

Build a larger fictional template and renderer compatibility suite, including Microsoft Word, before extending edits to mixed-format regions. Add explicit region mapping only where validated formatting anchors can preserve the original runs, and keep publication atomic across every supported template.
