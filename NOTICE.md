# Attribution

Get a Job, Bum! is built on [Auto Job](https://github.com/batmandevx/Auto-Job), copyright (c) 2026 Ayush Upadhyay, under the MIT license in [LICENSE](LICENSE).

The local resume extraction helper in [server/src/vendor/resume-extraction.js](server/src/vendor/resume-extraction.js) adapts the extraction portion of Application Assistant's [utils/profile-extraction.ts](https://github.com/duanyiyao/application-assistant/blob/e795a42bfe058c65f1530bbf68c9a1f09dea7f1d/utils/profile-extraction.ts) at revision e795a42bfe058c65f1530bbf68c9a1f09dea7f1d. The port removes TypeScript-only syntax and the unused profile merge routine. The original copyright and MIT terms are in [third_party_licenses/Application-Assistant.txt](third_party_licenses/Application-Assistant.txt).

The Phase 3 Word editor was implemented independently after reviewing the DOCX editing and approval design at that same Application Assistant revision. It uses JSZip 3.10.2 under its MIT option and Saxes 5.0.1 under ISC. The installed packages include their license notices.

ExcelJS uses UUID 11.1.1 under MIT through a pinned transitive override. Its older transitive `buffers` 0.1.1 tarball predates the author's MIT/X11 metadata. The installed main source matches the archived upstream licensing revision. [Upstream buffers licensing revision](https://github.com/bitpay/node-buffers/commit/1b745ee35d33eb166e15ef1866073a07c6d7de87)

AutoApply provided conceptual inspiration only. The project includes no AutoApply implementation.
