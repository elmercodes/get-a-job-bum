# Get a Job, Bum! v0.1.0 release notes

The first developer-focused release brings together public company research, reviewed applicant evidence, source-preserving Word tailoring, assisted form completion, and local application tracking in a Chrome side panel.

- Start with a posting you paste or explicitly read from a permitted employer page. Research sources and review requirements alongside approved accomplishments.
- Accept only the Word edits you want. Download a validated DOCX and, with the supported Linux renderer, a matching PDF.
- Review missing answers and any permitted acknowledgments or signature. Assisted submission needs a separate approval for the reviewed application. Tracker status distinguishes a verified receipt from an unverified attempt.
- Keep tracking local or opt in to an app-managed Google Sheet using Desktop OAuth. CSV is available offline.

## Installation and privacy

Use desktop Chrome, Node.js 22, npm, and the paired loopback backend. Linux is the verified development platform. LibreOffice, Poppler, and Bubblewrap are needed for the tested Linux PDF path. Applicant evidence, generated documents, and tokens live in the private local data directory. AI keys are backend-only, and external AI providers and Google sync require explicit opt-in. [Setup](../README.md) · [Security and privacy](SECURITY_PRIVACY.md)

## Known limitations

Complex Word regions such as text boxes and tracked changes remain read-only. Windows, macOS, and native Microsoft Word checks are pending. Employer portals vary, and logins, CAPTCHA, inaccessible frames, and unsupported identity or payment fields need direct handling. Sheets supports a single writer and app-managed sheets. Pause sync before concurrent sorting or edits to managed cells. [Release verification](RELEASE_READINESS.md)

Future milestones may cover broader Word and portal testing, Google Picker, multi-device sync, and easier installation. Chrome Web Store distribution is outside v0.1.
