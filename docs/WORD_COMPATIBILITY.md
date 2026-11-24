# Verify fictional resumes in Microsoft Word

The Word editor has automated OOXML verification and Linux LibreOffice rendering tests. Microsoft Word on Windows and macOS needs a separate manual pass.

## Generate the corpus

Run this after installing the server dependencies.

```sh
npm --prefix server run word:samples
```

The command prints a private OS temporary folder. It contains an original and validated DOCX for each of 13 fixtures and an `expected.json` file. Every name, company, result, and relationship in this corpus is fictional. Copy the selected pairs into a temporary folder on the test machine. The numbered markers in the manifest are Word paragraph IDs.

| Fixtures | Inspect in Word |
| --- | --- |
| Single-column, two-page, paragraph-spacing | The single-column fixtures stay on one page. The two-page fixture keeps its page break. Compare the margins, first-line position, paragraph spacing and protected anchor lines. |
| Custom headings, mixed fonts and sizes | Inspect named styles, font family and size, bold and italic text. The mixed run is unchanged. Note any font substitution before comparing. |
| Bullets and numbering, table | Check the bullet glyph, sequence, indentation, cell placement and spacing. Follow the manifest to the intended cell. |
| Hyperlinks, headers/footers/sections | Inspect the hyperlink target through Word's link dialog. Compare header and footer contents, section structure and page dimensions. The fictional hyperlink can be checked without opening it. |
| Duplicate paragraphs, multiple positions | The marked instance changes. The matching original lines and other position remain visible. |
| Long accomplishment, unsupported features | Inspect selectability, wrapping, page overflow and adjacent text. Mixed runs, the page field, the text box and tracked change are preserved as read-only structures. |

## Run the manual check

1. Record the operating system, Word build, installed fonts, and fixture name. Windows and macOS may substitute different fonts for Liberation Serif and Liberation Sans.
2. Open both files normally. Record any repair or unreadable-content prompt as a failure. Use Print Layout and show formatting marks to inspect paragraphs, breaks and lists.
3. Use **Review → Compare** to compare the original and validated files, including formatting. The manifest describes the one accepted replacement. Review any unrelated difference before classifying it.
4. Compare page count, gutter and margins. Look for clipped text, overlap, missing paragraphs, changed indentation, unintended list restarts and lost links. Test long text with the review pane closed to avoid viewing-width differences.
5. Save copies as PDFs using Word. Confirm expected text is present and selectable. Optional Poppler text and bounding boxes can help compare results. Record the Word render separately from the Linux render.
6. Report the fixture name, expected versus actual behavior, and whether the issue reproduces on the original. Attach only fictional screenshots or files.

The automated suite uses the same editor as the local backend and compares non-document parts byte-for-byte. For five LibreOffice/Poppler pairs it also compares page counts, PDF text, dimensions, line geometry, font names, indentation, and hyperlink annotations. Font bounding boxes are compared to the same-renderer source with a 0.75-point tolerance. This does not establish equivalent Microsoft Word layout. Testing in Word on both supported desktop operating systems is pending.
