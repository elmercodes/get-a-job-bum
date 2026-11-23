# Security, privacy, trust boundaries, and public repository policy

**Blocking policy for v0.1.** Local-first is not equal to invulnerable. Public code can still leak data through logs, broad browser permissions, the local backend, external AI providers, Git history or diagnostic uploads. This document governs the design and release review.

## 1. Data classification

| Level | Data | Default policy |
|---|---|---|
| Public | Source code, fictional fixtures, safe documentation | May be committed after review |
| Applicant private | resumes, contact details, experience, accomplishment records, answers, application links/history, documents, generated DOCX/PDF | Local storage only by default; never in Git, test screenshots, CI, public issues |
| High sensitivity | citizenship/work authorization, disability/veteran/demographic disclosures, criminal-history answers, private financial details | Explicit per-field permission, minimize retention, redacted logs; no inference |
| Secrets / prohibited storage | API keys, OAuth tokens, passwords, session cookies, SSNs, tax IDs, government ID numbers, payment credentials, OTPs | Secrets in secured local environment/keychain, **never** Git; sensitive identifiers/OTPs not recorded or sent to AI; user handles restricted inputs |

## 2. Trust boundaries

- **Web page → content script:** hostile/untrusted. Field labels and descriptions are data, not instructions. Block page-to-extension command injection; only allow messages with internal validated run context.
- **Content script → extension/UI/backend:** structured schema, size limits, allowlisted calls, active tab/frame origin verification. Do not send whole profile to page DOM.
- **Browser → local Node API:** authenticating token + extension identity + strict Origin/Host validation + anti-CSRF/DNS-rebinding safeguards. Bind to loopback only. Never assume CORS prevents malicious local requests.
- **Backend → AI provider:** requires provider consent and bounded payload; send only necessary candidate evidence/job content. Treat responses as untrusted proposals, not executable commands.
- **Backend → public company research:** URLs and web text are untrusted; SSRF protections (no localhost/private IP or redirect to private), host/path restrictions, timeouts and payload limits, rate limits. No login cookies or private-site API calls.
- **Backend → Google Sheets:** explicit user authorization, minimum scopes/data and idempotent upserts; OAuth tokens protected and independently revocable.
- **Document parser/renderer:** uploaded DOCX/ZIP files are untrusted. Guard against ZIP bombs, XML entities/external references, malicious relationships, macro formats and renderer exploit surfaces; use limits/sandbox if feasible.

## 3. Local files and Git protections

**Preferred real data path:** OS application data directory outside the repository (e.g., under a project-specific local user-data root). Add a configurable override for development. If used, `private_data/` must be ignored and contain **no tracked files whatsoever**. Keep existing Auto Job `data/` exclusion. Do not put `.gitkeep` or README inside the private directory. Only fictional `examples/` belong to Git.

Append `templates/gitignore-additions.txt` to the actual fork `.gitignore` without deleting any upstream entries. Run:

```bash
git check-ignore -v private_data/test.json
# expected: a matching ignore rule

git ls-files private_data data
# expected: NO output

git status --short --ignored
# ensure only expected fictional/source material is staged

# Before push, use a secret scanner such as gitleaks on tracked changes/history.
# `gitignore` is not retroactive and won't erase pushed history.
```

If a real secret or personal file was ever committed or pushed: **stop publication**, rotate/revoke credentials, remove tracking and clean history as appropriate, notify affected collaborators, verify cached/forked copies, and assume public exposure if it reached a remote. Do not simply add an ignore rule and declare it safe.

## 4. Conservative answer policy

**Known field** → approved applicant record and scope match → fill and verify. **Unknown factual/conditional field** → ask user. **Legally binding/sensitive disclosure** → hand off or explicit per-field confirmation, no automatic click. **Prohibited secret field** → do not store/fill/send. No defaults for immigration, relocation, salary, work authorization, criminal history, company relationships, consent, disability or race. Do not deduce identity traits from a résumé.

AI narratives must cite candidate evidence IDs; the model cannot invent hard facts. The reviewer must be able to see source and explanation before approving changes. Have deletion/expiry options for saved answers.

## 5. Browser site policy

Use manual paste for LinkedIn and Indeed descriptions. Do not implement unauthorized extraction, automated clicking on those websites, scraping hidden APIs or anti-bot bypass. For employer portals, action only after user starts a run, site policy allows it, and technical access permits it. CAPTCHA, login, 2FA, restricted iframe, native file picker and inaccessible controls are user handoffs. No unattended mass applying. Even permitted intermediate automation must never click final Submit.

## 6. AI privacy and costs

Support local models where practical. For cloud providers show: service identity, what data will be sent (job text, selected user facts, approved evidence), whether screenshots are included, and potential API cost. Consumer subscriptions may not include API usage. Never silently switch providers or share more data through fallback. Audit provider retention policies separately, and document that sending a resume to cloud AI is a deliberate privacy tradeoff.

## 7. Logging and diagnostics

Use structured logs with event IDs, timings, categories, reason codes—not raw names, email, resume text, scraped form contents, credentials or screenshots. Mask URLs if they contain personal query parameters. Diagnostics export must have an explicit preview/redaction screen. Consent required before including real snapshots; never upload as GitHub issue by default. CI fixtures must be synthetic and visibly labeled fictional.

## 8. Release-blocking security tests

- Other website cannot access localhost API or invoke actions; forged origins and local DNS alias blocked.
- Sensitive data does not appear in AI prompts, logs, exception traces, telemetry, CI artifacts or the extension's publicly readable static assets.
- Stored credentials are not in page-accessible DOM, content scripts, URLs, screenshots or Web Store package.
- No unauthorized broad browser permissions; consent for optional host/vision/email/Google abilities.
- No model output can click final Submit or approve binding agreement; repeated retries cannot bypass boundary.
- No prompt injection in posting, form field, remote page or text document changes system behavior.
- No third-party developer-owned servers receive applicant data without explicit opt-in.

## 9. MIT and dependency boundaries

Retain copyright and permission notices from Auto Job and any donor Application Assistant code. Document the exact donor revisions and changed files in `NOTICE.md` and source headers where appropriate. No GPL-3.0 AutoApply implementation in this MIT codebase. Confirm licenses for all transitive dependencies and assets before distribution. This is an engineering policy, not a substitute for legal advice.
