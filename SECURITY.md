# Security

## Reporting a vulnerability

Use GitHub’s **Security → Report a vulnerability** on the fork if private reporting is enabled. If that option is unavailable, open a public issue asking for a private contact channel and keep the technical details out of the issue. Send a minimal fictional reproduction and the affected commit through the private channel. Omit credentials, personal data, real application URLs, and applicant documents.

## Data and trust boundaries

The backend binds to loopback and requires its paired installation ID and a local token. Employer-page scripts receive the information needed for the current action. Applicant records, original resumes, rendered exports, and Google tokens are kept in private per-user storage. Local ownership controls protect these files. Backups, manual downloads, and the operating system account have their own access and retention controls.

Internet research is limited to public destinations and treated as untrusted content. External AI providers and Google Sheets require explicit configuration. The extension requires separate approval for assisted final submission. Use a current browser, keep the backend on loopback, and rotate the local pairing token if exposed.

See the [privacy and security model](docs/SECURITY_PRIVACY.md) and the [release verification record](docs/RELEASE_READINESS.md).
