# AI Job Application Assistant — Public-Repo Development Blueprint

**Status: product and engineering blueprint.**

Get a Job, Bum! builds on a [GitHub fork of Auto Job](https://github.com/elmercodes/get-a-job-bum). Its developer-first v0.1 objective is a local-first Chrome side-panel assistant with job research, evidence-grounded DOCX resume tailoring, permitted multi-step browser autofill, human questions, local tracking, and optional Google Sheets synchronization.

## Core strategy

- **Primary fork:** [Auto Job](https://github.com/batmandevx/Auto-Job) (MIT; preserve Ayush Upadhyay's license notice).
- **Secondary MIT donor:** [Application Assistant](https://github.com/duanyiyao/application-assistant) (source-aware DOCX changes, evidence checks, review UI, adapters; use only compatible, tested modules, and preserve attribution).
- **Ideas only, NOT code:** [AutoApply](https://github.com/ExxML/AutoApply) (GPL-3.0; no copying into this MIT fork).

## Files included

| File | Purpose |
|---|---|
| `MASTER_PLAN.md` | Detailed requirements, architecture, workflows, model, privacy, stages, QA gates |
| `AGENTS.md` | Persistent instructions for AI coding agents that work in the fork |
| `START_HERE_AGENT_PROMPT.md` | Ready-to-paste first coding-agent task (audit only) |
| `docs/UPSTREAM_AUDIT.md` | Phase 0 source/architecture/security/license inventory template |
| `docs/ACCEPTANCE_MATRIX.md` | 51 measurable acceptance criteria and security negatives |
| `docs/SECURITY_PRIVACY.md` | Threat model, data privacy, extension/server security, non-negotiable boundaries |
| `docs/GITHUB_SETUP.md` | Fork-first instructions and integration procedure |
| `docs/LICENSE_ATTRIBUTION.md` | MIT notices, donor provenance, GPL boundary |
| `templates/gitignore-additions.txt` | Append-only ignore rules for user private files and secrets |
| `examples/fictional_applicant.json` | Safe and clearly fictional test profile |
| `scripts/privacy-preflight.sh` | Tracked/staged path guard; **not a comprehensive secret scanner** |

## Working in this fork

The blueprint is integrated into the existing Get a Job, Bum! fork on the Phase 0 branch. See [GitHub setup](docs/GITHUB_SETUP.md) for checkout and privacy checks and the [upstream audit](docs/UPSTREAM_AUDIT.md) for observed results. Continue with the milestone gates in `MASTER_PLAN.md` and record acceptance evidence as it is executed.

## Critical safety expectations

- No unauthorized LinkedIn/Indeed scraping; manual job-description paste flow is first-class.
- No guessed candidate experiences, metrics, relocation/eligibility facts or legal answers.
- Never automatically submit the final application, check binding consent, bypass CAPTCHA, or type passwords/SSNs.
- No private personal data, screenshots or provider keys in public Git or CI.
- Cloud AI and Google Sheets are optional, disclosed integrations.
- No perfect ATS scoring or universal job portal compatibility guarantee.

## What you must supply later

You **do not need to supply anything** to begin the Phase 0 code/quality audit with fictional data. To configure real AI calls, supply a provider key privately or choose local Ollama. To use real resume tailoring, provide your DOCX and approved accomplishments **only in private local storage**. To enable Google Sheets, complete its OAuth consent on your machine.

**Last documentation check:** November 23, 2026. The upstream repositories may change. Pin SHAs and revisit license/dependency details before code reuse.
