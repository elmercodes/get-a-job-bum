# Licensing, fork attribution and provenance policy

## Intended license: MIT

The project should remain available to anyone under the MIT License, **including commercial use** as permitted by MIT. An MIT license is not public domain and does not waive required attribution. Keep the license text from the **forked Auto Job** project and its copyright notice:

- Auto Job: `Copyright (c) 2026 Ayush Upadhyay` — source: https://github.com/batmandevx/Auto-Job/blob/main/LICENSE
- Application Assistant: `Copyright (c) 2026 Application Assistant contributors` — source: https://github.com/duanyiyao/application-assistant/blob/main/LICENSE

The exact original notice content must be reverified against the pinned code revision at Phase 0. When you incorporate substantial donor code, retain the relevant original copyright and permission notice in the distributed project (`NOTICE.md`, appropriate source headers and/or copies of donor `LICENSE` under a `third_party_licenses` directory). Do **not** replace the base license with a new one that falsely removes the upstream author's rights.

If you choose to add a new copyright notice for original contributions, do so accurately without modifying/removing upstream ownership. Contributor license grants and dependency compatibility must be reviewed. This file is a development policy, not legal advice.

## Provenance records

| New file or code area | Upstream project | Exact commit SHA and original path | Copied / adapted / original | Notice included | License review status |
|---|---|---|---|---|---|
| Base extension, backend, and inherited media | Auto Job | `e32598111cd4dd968a6e8980672a1ed3d1128cd9` | Fork retained, modules adapted in place | Root MIT license and `NOTICE.md` | Verified against pinned upstream |
| `server/src/vendor/resume-extraction.js` | Application Assistant | `e795a42bfe058c65f1530bbf68c9a1f09dea7f1d`, `utils/profile-extraction.ts` | Narrow adaptation of local extraction | `third_party_licenses/Application-Assistant.txt` and `NOTICE.md` | Verified against pinned donor |
| Word editor, Google sync, and release fixtures | Get a Job, Bum! | Fork history and architecture records | Original implementation in this fork | Root MIT license | Reviewed for the candidate |

## AutoApply is GPL-3.0 — inspiration only

Never import, modify, translate, convert, port, retype or distribute `ExxML/AutoApply` source, build scripts, bundled prompts, tests, screenshots or assets into this MIT project. You may describe a functional concept (e.g., “show a user prompt for unknown fields” or “verify before advancing”) and write an independent original implementation based on your own interface specs and synthetic tests. Document a clean-room specification and design decision for any especially distinctive feature.

The release checks compare pinned license content, inspect dependency license metadata and known exceptions, and review the inherited assets and Git history. The current outcomes are in the [release verification record](RELEASE_READINESS.md). The [attribution ledger](../NOTICE.md) documents JSZip's MIT option and the pinned MIT/X11 `buffers` checksum.
