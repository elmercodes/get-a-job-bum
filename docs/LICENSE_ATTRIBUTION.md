# Licensing, fork attribution and provenance policy

## Intended license: MIT

The project should remain available to anyone under the MIT License, **including commercial use** as permitted by MIT. An MIT license is not public domain and does not waive required attribution. Keep the license text from the **forked Auto Job** project and its copyright notice:

- Auto Job: `Copyright (c) 2026 Ayush Upadhyay` — source: https://github.com/batmandevx/Auto-Job/blob/main/LICENSE
- Application Assistant: `Copyright (c) 2026 Application Assistant contributors` — source: https://github.com/duanyiyao/application-assistant/blob/main/LICENSE

The exact original notice content must be reverified against the pinned code revision at Phase 0. When you incorporate substantial donor code, retain the relevant original copyright and permission notice in the distributed project (`NOTICE.md`, appropriate source headers and/or copies of donor `LICENSE` under a `third_party_licenses` directory). Do **not** replace the base license with a new one that falsely removes the upstream author's rights.

If you choose to add a new copyright notice for original contributions, do so accurately without modifying/removing upstream ownership. Contributor license grants and dependency compatibility must be reviewed. This file is a development policy, not legal advice.

## Provenance records (fill after auditing actual source)

| New file or code area | Upstream project | Exact commit SHA and original path | Copied / adapted / original | Notice included | License review status |
|---|---|---|---|---|---|
| (to be filled) | Auto Job / Application Assistant / original | (to be filled) | (to be filled) | (to be filled) | NOT REVIEWED |

Do not claim the Application Assistant source was integrated until it actually has been. Do not create `NOTICE.md` that inaccurately claims nonexistent code contributions.

## AutoApply is GPL-3.0 — inspiration only

Never import, modify, translate, convert, port, retype or distribute `ExxML/AutoApply` source, build scripts, bundled prompts, tests, screenshots or assets into this MIT project. You may describe a functional concept (e.g., “show a user prompt for unknown fields” or “verify before advancing”) and write an independent original implementation based on your own interface specs and synthetic tests. Document a clean-room specification and design decision for any especially distinctive feature.

## Before release

- [ ] Upstream fork relation preserved or accurately explained.
- [ ] Base original MIT license included.
- [ ] Donor copyright and MIT license notices retained for reused code.
- [ ] SPDX/license audit run for direct and transitive dependencies and bundled assets.
- [ ] No GPL AutoApply copied code/asset accidentally introduced.
- [ ] `NOTICE.md` and `README.md` attribution accurate and linked to original projects.
- [ ] Public source/build artifacts use no private real applicant files.
