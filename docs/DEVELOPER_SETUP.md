# Developer setup and fictional walkthrough

The [README](../README.md) covers cloning, dependency installation, private configuration, and pairing. Use Node 22, npm, a current Chrome build, and Python 3 when running regressions. Bash and curl are used by the full test script. Use Chrome for Testing or a compatible Chromium binary for the Playwright tests. Some regular Chrome builds restrict command-line loading of unpacked extensions.

## Generate a fictional Word resume

After `npm --prefix server ci`, run this command from the repository root. It writes the sample to an OS temporary directory outside the checkout.

```sh
node --input-type=module -e 'import fs from "node:fs/promises"; import os from "node:os"; import path from "node:path"; import {makeDocx} from "./server/test/docx-fixture.mjs"; const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gaj-demo-")); const file = path.join(dir, "fictional-source.docx"); await fs.writeFile(file, await makeDocx()); console.log(file)'
```

Import the sample and leave its extracted facts in review. Add and approve the role **Engineer** at **Fictional South Labs** and the accomplishment **Utilized SQL to reduce reporting time by 12.50%.** Link the accomplishment to the role. For **Data Engineer** at the same company, paste the following description.

> SQL reporting experience is required. Reduce reporting time and use SQL for data validation. AWS certification is preferred.

Analyze the posting, accept the supported SQL bullet, and export. Check that the missing certification is absent from the resume and that the original file remains intact. The browser fixture below demonstrates the full journey with controlled sources, a fictional application receipt, and mock Google Sheets.

## Run the verification locally

From the repository root, use an existing Python virtual environment or create one outside the checkout. Install the test dependency and a compatible browser.

```sh
python -m pip install playwright
python -m playwright install chromium
```

Set `GAJ_CHROMIUM` to the installed Chromium or Chrome for Testing executable. Use `CHROME` for the inherited DevTools harness. On Linux `/usr/bin/google-chrome` can serve the inherited harness even when the unpacked tests require a different binary.

```sh
CHROME=/usr/bin/google-chrome scripts/test-phase1.sh
for phase in 1 2 3 4 5; do
  python "server/test/phase${phase}-browser.py" "$GAJ_CHROMIUM"
done
scripts/privacy-preflight.sh
node scripts/release-check.mjs
npm --prefix server audit --omit=dev
gitleaks git --redact=100
```

The test launchers use fictional data, disposable Chrome profiles, and isolated backend state. Phase 5 runs the integrated workflow in production pairing mode and replaces the external research source and Google transports with controlled responses. No Google or AI credentials are needed. Set `GAJ_REQUIRE_PDF=1` for Phase 5 to require a matching PDF in addition to DOCX. Without the optional Linux renderer, the test verifies DOCX output and reports PDF availability separately.

Run one inherited DevTools harness at a time. It uses port 9337. If the local application API test port is occupied, set `AUTOJOB_TEST_PORT` to an available loopback port. To diagnose a named fixture, run for example `CHROME=/usr/bin/google-chrome scripts/test-phase1.sh scan-widgets`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Pairing fails | Confirm the backend is running, the port and token match, and `EXTENSION_ID` is the ID for the currently loaded checkout. Loading the extension from a different path can change its ID. Restart the server after changing its private configuration. |
| Port is in use | Choose another `PORT` in the backend config and use that loopback address in **Profile → Server**. Keep the other process under its own ownership. |
| A job board cannot be read | Paste the description and open the employer portal directly. Grant site access only for an employer portal you are permitted to use. |
| DOCX is ready and PDF is unavailable | Structural validation still applies. For PDF on Linux check LibreOffice Writer, Poppler, Bubblewrap, and whether the host permits the renderer's sandbox. |
| Provider unavailable | Confirm the local model is installed or the explicitly authorized backend key and model are correct. Check current API budgets. Use reviewed evidence and manual answers while the provider is unavailable. |
| Google access is denied | Confirm the correct account is a test user of the same OAuth project and that both Drive and Sheets APIs are enabled. Reconnect to the intended app-managed spreadsheet. See the [Sheets guide](PHASE_5.md). |

## Verify another platform manually

Use a clean checkout, an isolated Chrome profile, and only fictional data. Record the OS, Node, npm, Chrome, and Word versions. Install dependencies, create a private backend configuration, pair the extension, and check the data directory permissions. Import the sample, export a DOCX, reopen it after a backend restart, and attach it to the local fictional fixture. Check paths with spaces and Unicode. Open the exported pairs in Microsoft Word and follow the [Word comparison procedure](WORD_COMPATIBILITY.md). Record PDF availability separately. On Windows the Bash commands can be run from Git Bash where supported, or follow the README pairing steps manually.

The current release verification was performed on Linux. Windows, macOS, Microsoft Word, and non-Chrome browsers still need direct verification. [Release verification record](RELEASE_READINESS.md)
