import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDocx, planPatches, readDocx, verifyDocx } from '../src/docx-engine.js';
import { verifyLayout } from '../src/docx-layout.js';
import { makeDocx, paragraph, repeated } from './docx-fixture.mjs';

const section = '<w:sectPr><w:headerReference w:type="default" r:id="h"/><w:footerReference w:type="default" r:id="f"/>' +
  '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1000" w:right="980" w:bottom="1000" w:left="980" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>';
const pageBreak = '<w:pageBreakBefore/>';
const title = '<w:pStyle w:val="ResumeBody"/><w:keepNext/><w:spacing w:before="160" w:after="100"/>';
const numbering = (num) => '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + num + '"/></w:numPr>';
const font = '<w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif"/><w:sz w:val="26"/>';
const north = 'Northanchor remains on this line.';
const south = 'Southanchor remains below the edited line.';
const original = 'Prepared fictional warehouse summaries.';
const replacement = 'Reviewed fictional warehouse summaries.';
const longer = 'Documented a fictional scheduling process while preserving the meaning of the test data. '.repeat(8).trim();
const line = (id, text, opts = {}) => paragraph(text, { ...opts, paraId: id });
const fixtureTarget = (options = {}) => line('F1C71001', original, options);
const edit = { id: 'F1C71001', original, text: replacement };
const anchorStart = paragraph(north, { format: font });
const anchorEnd = paragraph(south, { format: font });
const link = '<w:p><w:hyperlink r:id="link"><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Fictional portfolio</w:t></w:r></w:hyperlink></w:p>';
const field = '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>';
const mixed = line('F1C7A001', ['Fictional ', 'mixed-font line'], { styles: [font, '<w:rFonts w:ascii="Liberation Sans"/><w:sz w:val="32"/><w:i/>'] });
const boxed = '<w:p><w:r><w:pict><w:txbxContent>' + paragraph('Fictional boxed words') + '</w:txbxContent></w:pict></w:r></w:p>';
const tracked = '<w:ins w:id="5" w:author="Fictional reviewer">' + paragraph('Fictional tracked insert') + '</w:ins>';

const cases = [
  { name: 'single-column', body: [anchorStart, fixtureTarget({ format: font }), anchorEnd], pages: 1, visual: true },
  { name: 'two-page', body: [anchorStart, fixtureTarget({ format: font }), anchorEnd,
    paragraph('Secondpage fictional projects', { properties: pageBreak, format: font }), paragraph('Second page proof of layout.')], pages: 2, visual: true },
  { name: 'custom-headings', body: [paragraph('Fictional Technical History', { properties: title, format: '<w:b/>' }), fixtureTarget()] },
  { name: 'mixed-fonts-and-sizes', body: [mixed, fixtureTarget({ format: font })], protected: ['Fictional mixed-font line'] },
  { name: 'paragraph-spacing', body: [anchorStart, fixtureTarget({ properties: '<w:spacing w:before="160" w:after="200" w:line="300" w:lineRule="auto"/><w:ind w:left="360"/>' }), anchorEnd], pages: 1, visual: true },
  { name: 'bullets-and-numbering', body: [anchorStart, fixtureTarget({ properties: numbering(2) }), line('F1C71002', 'Validated another fictional report.', { properties: numbering(1) }), anchorEnd], pages: 1, visual: true },
  { name: 'table', body: ['<w:tbl><w:tblPr><w:tblW w:w="8600" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4300"/><w:gridCol w:w="4300"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:tcW w:w="4300" w:type="dxa"/></w:tcPr>' + paragraph(original) + '</w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="4300" w:type="dxa"/></w:tcPr>' + fixtureTarget() + '</w:tc></w:tr></w:tbl>'] },
  { name: 'hyperlinks', body: [anchorStart, link, fixtureTarget(), anchorEnd], protected: ['Fictional portfolio'], pages: 1, visual: true, links: true },
  { name: 'headers-footers-sections', body: [anchorStart, fixtureTarget(), anchorEnd], pages: 1 },
  { name: 'duplicate-paragraphs', body: [line('F1C71003', original), fixtureTarget(), line('F1C71004', original), paragraph(repeated)] },
  { name: 'multiple-positions', body: [paragraph('Experience'), paragraph('Engineer | Fictional North Operations'),
    line('F1C71004', original, { properties: numbering(2) }), paragraph('Engineer | Fictional South Operations'),
    fixtureTarget({ properties: numbering(2) })] },
  { name: 'long-accomplishment', body: [anchorStart, fixtureTarget(), anchorEnd], edit: { ...edit, text: longer } },
  { name: 'unsupported-features', body: [mixed, field, boxed, tracked, fixtureTarget()],
    protected: ['Fictional mixed-font line', '1', 'Fictional boxed words', 'Fictional tracked insert'] },
];

function runTool(name, args, input) {
  const result = spawnSync('/usr/bin/' + name, args, { input, maxBuffer: 5 * 1024 * 1024, timeout: 5000 });
  assert.equal(result.status, 0, name + ' could not inspect the fictional PDF');
  return result.stdout.toString();
}

function geometry(pdf) {
  const xml = runTool('pdftotext', ['-bbox-layout', '-', '-'], pdf);
  const pages = [...xml.matchAll(/<page width="([^"]+)" height="([^"]+)">([^]*?)<\/page>/g)].map(([, width, height, content]) => {
    const words = [...content.matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([^<]+)<\/word>/g)]
      .map(([, left, top, right, bottom, text]) => ({ text, box: [left, top, right, bottom].map(Number) }));
    return { width: Number(width), height: Number(height), words };
  });
  assert.ok(pages.length && pages.every(({ words }) => words.length));
  return pages;
}

function checkGeometry(before, after, sample) {
  assert.equal(before.length, sample.pages);
  assert.equal(after.length, sample.pages);
  const expected = ['Northanchor', 'Southanchor', ...(sample.pages === 2 ? ['Secondpage'] : [])];
  for (const [index, page] of after.entries()) {
    const source = before[index];
    assert.deepEqual([page.width, page.height], [source.width, source.height]);
    for (const word of page.words) {
      const [left, top, right, bottom] = word.box;
      assert.ok(left > 0 && top > 0 && right < page.width && bottom < page.height, 'visible text outside the page');
    }
    for (const anchor of expected) {
      const original = source.words.find((word) => word.text === anchor);
      if (!original) continue;
      const current = page.words.find((word) => word.text === anchor);
      assert.ok(current, 'protected line was lost during rendering');
      assert.ok(current.box.every((position, vertex) => Math.abs(position - original.box[vertex]) < 0.75), 'protected line moved');
    }
  }
  const box = (page, word) => {
    const anchor = page.words.find((item) => item.text === 'Northanchor').box;
    return page.words.find((item) => item.text === word && (word !== 'Prepared' || item.box[1] > anchor[1])).box;
  };
  const gaps = (page, word) => [box(page, word)[1] - box(page, 'Northanchor')[3], box(page, 'Southanchor')[1] - box(page, word)[3]];
  const baseline = box(before[0], 'Prepared');
  const edited = box(after[0], 'Reviewed');
  const beforeGaps = gaps(before[0], 'Prepared');
  const afterGaps = gaps(after[0], 'Reviewed');
  // Poppler's font bounding boxes can touch in the original. Measure whether
  // the edit changed those gaps, and still require distinct ordered baselines.
  assert.ok(afterGaps.every((gap, i) => gap >= beforeGaps[i] - 0.75 && gap > -2), sample.name + ' has overlapping adjacent lines');
  assert.ok(box(after[0], 'Northanchor')[1] < edited[1] && edited[1] < box(after[0], 'Southanchor')[1]);
  assert.ok(Math.abs(baseline[0] - edited[0]) < 0.75, 'the edited indentation or list marker changed');
}

const keep = process.argv.includes('--samples');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gaj-word-compatibility-'));
const manifest = [];
let rendered = 0;
try {
  for (const sample of cases) {
    const originalFile = await makeDocx({ body: sample.body.join('') + section });
    const source = await readDocx(originalFile);
    const change = sample.edit || edit;
    const target = source.paragraphs.find(({ anchor }) => anchor.paragraphId === change.id);
    assert.equal(target?.text, change.original, sample.name);
    for (const text of sample.protected || []) {
      const protectedParagraph = source.paragraphs.find((item) => item.text === text);
      assert.ok(protectedParagraph?.issue, text);
      assert.throws(() => planPatches(source, source.sourceHash, [{
        id: 'forbidden', anchor: protectedParagraph.anchor, originalText: text, text: 'Fictional forbidden replacement',
      }]), { code: 'UNSUPPORTED_REGION' });
    }
    const plan = planPatches(source, source.sourceHash, [{ id: 'approved', anchor: target.anchor, originalText: change.original, text: change.text }]);
    const output = await buildDocx(source, plan);
    const verified = await verifyDocx(source, plan, output);
    assert.deepEqual(verified.applied, ['approved']);
    assert.equal(verified.output.paragraphs.find(({ anchor }) => anchor.paragraphId === change.id).text, change.text);
    const duplicates = source.paragraphs.filter((item) => item.text === change.original).length;
    assert.equal(verified.output.paragraphs.filter((item) => item.text === change.original).length, duplicates - 1);
    for (const part of Object.keys(source.partHashes).filter((name) => name !== 'word/document.xml')) {
      assert.equal(source.partHashes[part], verified.output.partHashes[part]);
    }
    assert.match(verified.output.xml, /w:pgMar w:top="1000"/);
    assert.match(verified.output.xml, /w:headerReference/);
    assert.match(verified.output.xml, /w:footerReference/);
    manifest.push({ fixture: sample.name, acceptedChange: change, manualPageExpectation: sample.pages || 'same for original and edited when layout allows',
      protected: sample.protected || [] });

    if (sample.visual && !keep) {
      const args = { staging: directory, source: originalFile, pagePreference: 'preserve', includePdf: true };
      const after = await verifyLayout({ ...args, output, readable: [north, change.text, south] });
      if (after.status === 'verified') {
        const before = await verifyLayout({ ...args, output: originalFile, readable: [north, change.original, south] });
        checkGeometry(geometry(before.pdf), geometry(after.pdf), sample);
        assert.equal(after.originalPages, after.pages);
        assert.deepEqual(after.warnings, []);
        if (existsSync('/usr/bin/pdffonts')) {
          const names = (pdf) => runTool('pdffonts', ['-'], pdf).trim().split('\n').slice(2)
            .map((line) => line.trim().split(/\s+/)[0].replace(/^[A-Z]{6}\+/, '')).sort();
          assert.deepEqual(names(before.pdf), names(after.pdf));
        }
        if (sample.links) assert.match(runTool('pdfinfo', ['-url', '-'], after.pdf), /https:\/\/fictional\.example\.test/);
        rendered++;
      }
    }
    if (keep) {
      await fs.writeFile(path.join(directory, sample.name + '-original.docx'), originalFile);
      await fs.writeFile(path.join(directory, sample.name + '-validated.docx'), output);
    }
  }
  const fieldPart = '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>INCLUDE</w:instrText></w:r>' +
    '<w:r><w:instrText>TEXT "https://fictional.example.test/document"</w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  await assert.rejects(readDocx(await makeDocx({ body: fieldPart + section })), { code: 'ACTIVE_FIELD' });
  const activeSimple = '<w:p><w:fldSimple w:instr="DDEAUTO example"><w:r><w:t>Fictional result</w:t></w:r></w:fldSimple></w:p>';
  await assert.rejects(readDocx(await makeDocx({ body: activeSimple + section })), { code: 'ACTIVE_FIELD' });
  if (keep) {
    await fs.writeFile(path.join(directory, 'expected.json'), JSON.stringify(manifest, null, 2));
    console.log('Fictional Word verification pairs and expected outcomes: ' + directory);
  } else console.log('DOCX compatibility: ' + cases.length + ' package fixtures passed, ' + rendered + ' LibreOffice/Poppler visual comparisons passed');
} finally {
  if (!keep) await fs.rm(directory, { recursive: true, force: true });
}
