# Architecture decisions

## ADR 001. Extend Auto Job and port narrow document operations

Phase 0 decision for developer-first v0.1, pending review. The base is Auto Job `e32598111cd4dd968a6e8980672a1ed3d1128cd9`. The sole secondary code donor is Application Assistant `e795a42bfe058c65f1530bbf68c9a1f09dea7f1d`. See the [upstream audit](UPSTREAM_AUDIT.md) for the baseline, failures, and release blockers.

### Application and storage

- Retain the existing MV3 side panel, Node/Express API, JSON store, PDF renderer, and scan/fill/readback engine. Preserve regression coverage for tracker, exports, job boards, and ancillary tools. Test integrations that touch personal data only after the relevant Phase 1 safeguards pass.
- Use one versioned JSON store with atomic writes, a single writer, and backup-first migration. Default to a user-owned OS application-data path. Keep `AUTOJOB_DATA` as an explicit override. Report unreadable or invalid stores before writing. Preserve legacy application timestamps and provenance without promoting them to confirmed submissions.
- Pair the extension to the loopback API with a per-install bearer token and pinned extension origin. Keep the token in trusted extension contexts and backend configuration. Restrict tab and frame access to explicitly started runs. Serve fixture routes only in the test environment.
- Persist workflow state and ordered events with stable run and job IDs. Validate the current run, tab, frame, control, and allowed action before each write. Stop on ambiguous navigation and binding or final controls. Record submission only after user confirmation.

### DOCX and donor boundary

- Adapt the DOCX paragraph operation from `utils/source-tailoring.ts` and the accepted-change filter from `utils/resume-tailoring.ts` into the Node resume service. Adapt eligible evidence validation from `utils/truth-gate.ts` against stable, user-approved achievement IDs. Keep original side-panel review controls and define an anchored edit contract shared by the UI and server.
- Use JSZip under its MIT option after dependency review and a maintained XML parser that reports malformed input and disables external resolution. Limit archive size, decompression, part count, and XML size before editing. Preserve the original ZIP parts and modify only validated spans of `word/document.xml`. Apply all accepted edits to a copy or return a reasoned error.
- Support ordinary single-column body paragraphs, including same-format split runs. Require exact template hash, a unique paragraph and text span, and matching original text. Reject edits crossing mixed formatting or unsupported constructs such as fields, text boxes, tracked changes, and hyperlinks. Keep untouched headers, footers, styles, numbering, and layout parts intact. Render in local LibreOffice with an isolated profile and time limit. Verify extracted DOCX/PDF text and compare output with a fictional preview reference.
- Treat donor Workday and iCIMS adapter behavior as candidates for targeted regression fixes. Port a specific operation when it improves an existing fictional failure and satisfies the run boundary. Exclude the donor's WXT framework, provider storage, permissions, and distribution assets. Consider AutoApply concepts from its public feature descriptions only, with independent specifications and tests.
- Keep the full Auto Job MIT license in the root. When the first donor implementation lands, record the precise upstream source and revisions in `NOTICE.md` and include its full MIT notice with distributed artifacts. Dependency and asset license closure remains a release gate.

### Rollout

Land the Phase 1 safety and synthetic-browser changes in small commits before adding applicant evidence and document features. Review each milestone against the pinned baseline and the acceptance matrix. For a release rollback, return to the prior safe application build and compatible data snapshot. The upstream baseline is suitable as a comparison target only with fictional data.


## ADR 002. Application-specific authority for consent and submission

The owner approved configurable acknowledgments and a separate final submission action for Phase 1. The local server resolves protected answer categories before generic answering and creates exact-evidence permits. The content script rechecks the live field and enforces native submit guards. The backend consumes a durable review once and the extension verifies the resulting receipt. Scope, setup, and limitations are in the [Phase 1 guide](PHASE_1.md).
