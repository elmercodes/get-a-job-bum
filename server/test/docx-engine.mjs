import assert from 'node:assert/strict';
import { buildDocx, hash, planPatches, readDocx, verifyDocx } from '../src/docx-engine.js';
import { makeDocx, paragraph, repeated } from './docx-fixture.mjs';

const input = await makeDocx({ complex: true });
const sourceHash = hash(input);
const doc = await readDocx(input);
const duplicates = doc.paragraphs.filter((p) => p.text === repeated && p.anchor.container === 'document/body/p');
assert.equal(duplicates.length, 2);
assert.notEqual(duplicates[0].anchor.id, duplicates[1].anchor.id);
assert.deepEqual(doc.preserved.sort(), ['word/footer1.xml', 'word/header1.xml']);
assert.equal(doc.paragraphs.find((p) => p.text === 'Mixed bold').issue, 'mixed_run_formatting');
for (const readonly of ['Fictional site', 'Tracked example', 'Content control example', 'Nested cell', 'Fictional boxed text']) {
  assert.ok(doc.paragraphs.find((p) => p.text === readonly).issue, readonly);
}
assert.equal(doc.paragraphs.find((p) => p.text === 'Simple cell text').issue, '');
assert.ok(doc.layoutsAtRisk);
const edit = (p, text, id = 'first') => ({ id, anchor: p.anchor, originalText: p.text, text });
const second = edit(duplicates[1], 'Verified & precise – 12.50% improvement in Montréal.');
const skill = edit(doc.paragraphs.find((p) => p.text === 'General office tools'), 'SQL and C++', 'second');
const cell = doc.paragraphs.find((p) => p.text === repeated && p.anchor.container !== 'document/body/p');
assert.ok(cell.numbered);
const long = 'Verified fictional word wrapping '.repeat(32).trim() + '.';
const plan = planPatches(doc, sourceHash, [second, skill, edit(cell, long, 'cell')]);
const bytes = await buildDocx(doc, plan);
const result = await verifyDocx(doc, plan, bytes);
assert.deepEqual(result.applied, ['first', 'second', 'cell']);
assert.equal(result.output.paragraphs.filter((p) => p.text === repeated).length, 1);
assert.equal(result.output.paragraphs.find((p) => p.anchor.paragraphId === 'AAAA0001').text, repeated);
assert.equal(result.output.paragraphs.find((p) => p.anchor.paragraphId === 'BBBB0002').text, second.text);
assert.equal(hash(input), sourceHash);
assert.ok(result.output.xml.includes('&amp; precise'));
assert.ok(result.output.xml.includes('<w:i/><w:u w:val="single"/>'));
assert.equal(result.output.paragraphs.find((p) => p.anchor.container === cell.anchor.container && p.text === long).text, long);
assert.equal(result.output.partHashes['word/numbering.xml'], doc.partHashes['word/numbering.xml']);
assert.equal(result.output.partHashes['word/styles.xml'], doc.partHashes['word/styles.xml']);
assert.equal(result.output.partHashes['word/header1.xml'], doc.partHashes['word/header1.xml']);

const rejected = await buildDocx(doc, planPatches(doc, sourceHash, [second]));
assert.equal((await readDocx(rejected)).paragraphs.find((p) => p.style === 'ResumeBody' && p.text === 'General office tools').text, 'General office tools');

assert.throws(() => planPatches(doc, 'invalid', [second]), { code: 'STALE_SOURCE' });
assert.throws(() => planPatches(doc, sourceHash, [second, { ...skill, anchor: { ...skill.anchor, id: 'missing' } }]), { code: 'MISSING_TARGET' });
assert.throws(() => planPatches(doc, sourceHash, [second, { ...second, id: 'again' }]), { code: 'CONFLICTING_TARGET' });
assert.throws(() => planPatches(doc, sourceHash, [{ ...second, anchor: { ...second.anchor, path: duplicates[0].anchor.path } }]), { code: 'MISSING_TARGET' });
assert.throws(() => planPatches(doc, sourceHash, [edit(doc.paragraphs.find((p) => p.text === 'Mixed bold'), 'Edited')]), { code: 'UNSUPPORTED_REGION' });
assert.throws(() => planPatches(doc, sourceHash, [edit(duplicates[1], 'hidden\u200bword')]), { code: 'INVALID_EDIT' });
assert.throws(() => planPatches(doc, sourceHash, [edit(duplicates[1], 'A'.repeat(1201))]), { code: 'INVALID_EDIT' });
const moved = await readDocx(await makeDocx({ complex: true, reversed: true }));
assert.throws(() => planPatches(moved, sourceHash, [second]), { code: 'STALE_SOURCE' });
assert.throws(() => planPatches(moved, moved.sourceHash, [second]), { code: 'MISSING_TARGET' });
await assert.rejects(verifyDocx(doc, plan, rejected), { code: 'OUTPUT_INTEGRITY' });
await assert.rejects(verifyDocx(doc, plan, Buffer.from('damaged saved file')), { code: 'INVALID_PACKAGE' });
await assert.rejects(readDocx(await makeDocx({ unsafe: true })), { code: 'INVALID_PACKAGE' });
await assert.rejects(readDocx(await makeDocx({ xml: '<test><broken></test>' })), { code: 'INVALID_XML' });
await assert.rejects(readDocx(Buffer.from('not a Word ZIP')), { code: 'INVALID_PACKAGE' });
const hidden = await readDocx(await makeDocx({ body: paragraph('Hidden via a Word style', { format: '<w:rStyle w:val="PrivateRun"/>' }) }));
assert.equal(hidden.paragraphs[0].issue, 'hidden_text');
console.log('docx engine: exact duplicate targeting, preserved formatting and parts, rejected edits, damaged output, and unsupported regions passed');
