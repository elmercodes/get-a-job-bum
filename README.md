# Get a Job, Bum!

Get a Job, Bum! helps you turn a job posting into a reviewed resume and application. It runs as a Chrome side panel paired with a backend on your own computer. You approve the facts, the resume edits, and any assisted final submission.

## What you can do

- Paste a job description or explicitly capture a posting from a permitted employer page. Research public company sources and see which claims came from those sources or from the posting.
- Build a local library of approved employment, accomplishments, skills, and reusable answers. Imported resume facts wait for review.
- Tailor a supported Word resume with approved evidence. Review each change, then download a validated DOCX and an optional PDF. The original remains intact.
- Fill supported employer forms, review missing information, approve the attachment and sensitive actions, and inspect the application before a separate submit approval.
- Track saved, prepared, verified, and unverified applications locally. Export CSV or opt in to one-way Google Sheets sync.

## Install and pair

You need Git, **Node.js 22** with npm, and a current desktop Chrome. The developer workflow is verified on Linux. LibreOffice Writer, Poppler (`pdftotext`, `pdfinfo`), and Bubblewrap provide optional PDF rendering on supported Linux installations. Word editing and local tracking work without an AI key or Google account.

1. Clone the development branch and install the pinned dependencies.

   ```sh
   git clone --branch feature/dev-v0.1 https://github.com/elmercodes/get-a-job-bum.git
   cd get-a-job-bum
   npm --prefix server ci
   ```

2. Open `chrome://extensions`, turn on **Developer mode**, and choose **Load unpacked**. Select this checkout’s **extension/** directory. Copy the 32-character extension ID shown by Chrome.
3. Create the ignored backend configuration and restrict access to it. If you already have a local configuration, edit that file.

   ```sh
   cp server/.env.example server/.env
   chmod 600 server/.env
   node -p 'require("node:crypto").randomBytes(32).toString("hex")'
   ```

   Edit `server/.env` and add uncommented settings for `EXTENSION_ID` (from Chrome) and `AUTOJOB_TOKEN` (the generated value). Keep the token private. The backend defaults to `http://127.0.0.1:8787`. Add `AUTOJOB_DATA` with an absolute path to a private directory outside the checkout if you want an isolated installation. Use a local text editor to configure these values on Windows.
4. Start the backend from the repository root.

   ```sh
   npm --prefix server start
   ```

5. Open the extension and choose **Dock as sidebar** if it opens as a popup. In **Profile → Server**, enter `http://127.0.0.1:8787` and the pairing token. Choose **Pair local server**. The status pill should show the server is connected.

### Configure an optional AI provider

The setup defaults to Ollama on loopback. For AI-assisted fields and optional source or wording ranking, run Ollama and set `OLLAMA_URL` and `OLLAMA_MODEL` to a model you have installed. With Ollama stopped, approved evidence, scoped saved answers, public research, and supported Word editing remain usable. Missing answers may require manual entry.

For an external provider, set `LLM_PROVIDER` and the provider's backend-only key as shown in [server/.env.example](server/.env.example). Explicitly authorize each external provider you intend to use in `AUTOJOB_AUTHORIZED_PROVIDERS`. Check the provider’s data and billing terms before enabling it. Enter keys in your backend config and keep them out of the extension and Git. [Provider and privacy details](docs/SECURITY_PRIVACY.md)

## Try the workflow

1. Open **Profile → Applicant evidence**. Add and approve fictional contact details, a role, and an accomplishment linked to that role. Add an approved skill if applicable. Keep imported facts in **Needs review** until you confirm them.
2. Under **Profile → Resume**, choose a DOCX and **Extract resume for review**. You can generate a fictional original using the command in the [developer walkthrough](docs/DEVELOPER_SETUP.md).
3. In **Apply → Job**, paste the description and enter the company and role. Use **Read job from page** only on permitted pages. Paste descriptions from LinkedIn and Indeed and open the employer portal yourself.
4. In **Company research**, enter an employer URL if known. Choose **Research this company** and inspect the sources, posting requirements, and unknowns.
5. Open **Resume & cover letter → Tailor an existing Word resume**, select the original, and choose **Analyze posting and propose edits**. Inspect the linked evidence. Accept or reject edits and choose or edit supported wording. Export, read the validation result, and download the DOCX or available PDF.
6. Open a permitted employer application. Grant site access when prompted. Choose **Select DOCX for application** or **Select PDF for application**, then **Fill application**. Resolve questions and approve the exact attachment. If you enabled consent or signature automation in **Profile**, read the specific terms before approving. Enter unsupported sensitive fields directly on the employer’s page.
7. Review the completed application. Choose **Review application**, then use the separate submission action only if you intend to send it. Check **Tracker** for the verified receipt status or an unverified attempt. A button click alone never counts as a verified application.

For a controlled walkthrough, run the unpacked browser test described in the [developer setup guide](docs/DEVELOPER_SETUP.md). It uses a fictional portal and mock external services.

## Optional Google Sheets

The tracker is local and CSV export works offline. To sync, set up a Desktop OAuth client in a Google Cloud project with the Sheets and Drive APIs enabled. Set `AUTOJOB_GOOGLE_CLIENT_ID` and the issued `AUTOJOB_GOOGLE_CLIENT_SECRET` in private backend configuration. Then open **Tracker → Google Sheets sync**, connect, choose or create an app-managed sheet, and explicitly enable sync. The app uses the `drive.file` scope and sends a minimal application projection. [Google Sheets setup and verification](docs/PHASE_5.md)

## Privacy and supported limits

- Profile data, OAuth tokens, and generated documents live in a private per-user directory. Git ignore and preflight checks cover development artifacts. Use fictional data in issues, tests, and screenshots.
- Required acknowledgments require approval under the configured policy. Optional marketing stays unchecked. Credentials, one-time codes, payment data, and unsupported identity fields require direct entry.
- The Word editor supports bounded paragraph edits. Mixed-format runs, text boxes, fields, and other unsupported structures remain read-only. Linux LibreOffice rendering is tested. Microsoft Word, Windows, and macOS require the [manual compatibility checks](docs/WORD_COMPATIBILITY.md).
- Employer pages vary. Sign-in, CAPTCHA, inaccessible frames, and unsupported widgets are manual steps. Use the panel only where the employer allows it.
- Sheets supports one backend writer and app-managed spreadsheets. Pause sync while sorting or editing managed cells. Google Picker and multi-device sync are deferred.

See [security and privacy](docs/SECURITY_PRIVACY.md) for retention and external data flows. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Develop and contribute

See [developer setup and troubleshooting](docs/DEVELOPER_SETUP.md), the [acceptance matrix](docs/ACCEPTANCE_MATRIX.md), and [CONTRIBUTING.md](CONTRIBUTING.md). The [changelog](CHANGELOG.md) describes v0.1.0.

## License and attribution

MIT. Built on Auto Job by Ayush Upadhyay. The local resume extractor adapts a narrowly scoped MIT-licensed Application Assistant helper. [License](LICENSE) · [Attribution and revisions](NOTICE.md)
