import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildDocx, planPatches, readDocx, verifyDocx } from '../src/docx-engine.js';
import { buildStrategy, jobSnapshot, proposalsFor, reviewEdits } from '../src/docx-strategy.js';
import { makeDocx, paragraph } from './docx-fixture.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gaj-word-transaction-'));
let worker;
try {
  process.env.AUTOJOB_DATA = directory;
  const { importEvidence, loadEvidence, saveEvidenceRecord } = await import('../src/evidence-store.js');
  const { createDocxReview, exportDocxReview, getDocxReview, listDocxReviews } = await import('../src/docx-service.js');
  const { verifyLayout } = await import('../src/docx-layout.js');
  const save = (kind, data, decision = 'approve') =>
    saveEvidenceRecord({ kind, data, decision, revision: loadEvidence().revision }).record;
  const firstRole = save('employment', { title: 'Engineer', company: 'Fictional North Labs', start: '2019', end: '2021' });
  const secondRole = save('employment', { title: 'Engineer', company: 'Fictional South Labs', start: '2022', end: 'Present' });
  const conflict = save('employment', { ...secondRole.data, start: '2020' }, 'draft');
  assert.equal(conflict.status, 'conflict');
  const routine = 'Maintained shared fictional documents.';
  const relevant = 'Used SQL to reduce reporting time by 12.50%.';
  save('accomplishment', { original: routine, refs: [secondRole.id] });
  const result = save('accomplishment', { original: relevant, refs: [secondRole.id], metrics: [{ value: '12.50', unit: '%' }] });
  const rejected = save('accomplishment', { original: 'Improved SQL reporting by 30%.', refs: [secondRole.id] }, 'draft');
  saveEvidenceRecord({ id: rejected.id, kind: 'accomplishment', decision: 'reject', revision: loadEvidence().revision });
  save('skill', { name: 'SQL', refs: [firstRole.id] });
  const sum = 'Prepared routine internal documents.';
  const number = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
  const source = await makeDocx({ body: [
    paragraph('Fictional Candidate'),
    paragraph('Summary'),
    paragraph(sum),
    paragraph(sum),
    paragraph('Experience'),
    paragraph('Engineer | Fictional South Labs'),
    paragraph(routine, { properties: number, paraId: 'F00D0001' }),
    paragraph(relevant, { properties: number, paraId: 'F00D0002' }),
    paragraph('Education'),
    paragraph('Fictional Technical School'),
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
  ].join('') });
  const imported = importEvidence([{ file: { originalname: 'word-atomic-fixture.docx', buffer: source }, text: 'Fictional Candidate\nFictional controlled test.' }], loadEvidence().revision);
  const sourceId = imported.state.sources[0].id;
  const job = jobSnapshot({ title: 'Fictional Engineer', company: 'Fictional Employer',
    description: 'SQL reporting is required. Candidates will reduce reporting time and validate data across internal fictional projects.' });
  const document = await readDocx(source);
  const strategy = buildStrategy(document, loadEvidence(), job);
  const proposals = proposalsFor(strategy);
  const pair = proposals.filter((item) => item.type === 'reorder');
  const removal = proposals.find((item) => item.type === 'remove');
  assert.equal(pair.length, 2);
  assert.equal(pair[0].group, pair[1].group);
  assert.ok(pair.some((edit) => edit.evidenceIds.includes(result.id)));
  assert.ok(!proposals.some((edit) => edit.evidenceIds.includes(rejected.id)));
  assert.ok(!strategy.records.some((record) => record.id === conflict.id));
  for (const role of ['Senior Engineer | Fictional South Labs', 'Engineer | Fictional South Labs Subsidiary', 'Engineer | Fictional South Labs | 2020–Present']) {
    const ambiguous = await readDocx(await makeDocx({ body: [paragraph('Experience'), paragraph(role), paragraph(routine, { properties: number })].join('') }));
    assert.deepEqual(proposalsFor(buildStrategy(ambiguous, loadEvidence(), job)), []);
  }
  assert.ok(removal);
  const cleared = proposals.map((edit) => ({ id: edit.id, action: ['reorder', 'remove'].includes(edit.type) ? 'accept' : 'reject' }));
  const partial = cleared.map((edit) => edit.id === pair[0].id ? { ...edit, action: 'reject' } : edit);
  assert.throws(() => reviewEdits({ proposals }, partial, strategy), { code: 'INCOMPLETE_REVIEW' });
  const { accepted } = reviewEdits({ proposals }, cleared, strategy);
  const plan = planPatches(document, document.sourceHash, accepted);
  const verified = await verifyDocx(document, plan, await buildDocx(document, plan));
  assert.equal(verified.applied.length, 3);
  assert.equal(verified.output.paragraphs.filter((p) => p.text === sum).length, 1);
  assert.equal(verified.output.paragraphs.find((p) => p.anchor.paragraphId === 'F00D0001').text, relevant);
  assert.equal(verified.output.paragraphs.find((p) => p.anchor.paragraphId === 'F00D0002').text, routine);
  assert.ok(verified.extracted.includes('Fictional Technical School'));

  const review = await createDocxReview({ sourceId, job });
  const request = { job, decisions: cleared };
  const staging = path.join(directory, 'docx-tailoring', 'staging');
  const validLayout = { status: 'unavailable', warnings: [] };
  await assert.rejects(exportDocxReview(review.id, request, { renderer: async ({ staging }) => {
    await fs.writeFile(path.join(staging, 'tailored-resume.docx'), 'corrupted during staged layout verification');
    return validLayout;
  } }), { code: 'OUTPUT_INTEGRITY' });
  assert.deepEqual(getDocxReview(review.id).versions, []);
  assert.deepEqual(await fs.readdir(staging), []);
  await assert.rejects(exportDocxReview(review.id, request, { renderer: async () => { throw new Error('Fictional renderer interruption'); } }),
    /Fictional renderer interruption/);
  assert.deepEqual(getDocxReview(review.id).versions, []);
  assert.deepEqual(await fs.readdir(staging), []);

  const marker = path.join(directory, 'started');
  const inline = [
    "import fs from 'node:fs/promises';",
    "import { exportDocxReview } from './server/src/docx-service.js';",
    'const input = JSON.parse(process.argv[1]);',
    "await exportDocxReview(input.id, input.request, { renderer: async () => { await fs.writeFile(input.marker, 'staged'); await new Promise(() => setInterval(() => {}, 1000)); } });",
  ].join('\n');
  worker = spawn(process.execPath, ['--input-type=module', '-e', inline, JSON.stringify({ id: review.id, request, marker })],
    { cwd: new URL('../../', import.meta.url), stdio: 'inherit', env: { ...process.env, AUTOJOB_DATA: directory } });
  for (let count = 0; count < 100; count++) {
    if (await fs.stat(marker).catch(() => null)) break;
    await delay(30);
  }
  assert.ok(await fs.stat(marker));
  const terminated = once(worker, 'exit');
  worker.kill('SIGKILL');
  await terminated;
  assert.deepEqual(getDocxReview(review.id).versions, []);
  const abandoned = await fs.readdir(staging);
  assert.equal(abandoned.length, 1);
  const old = new Date(Date.now() - 31 * 60_000);
  await fs.utimes(path.join(staging, abandoned[0]), old, old);
  listDocxReviews();
  assert.deepEqual(await fs.readdir(staging), []);
  const published = await exportDocxReview(review.id, request, { renderer: async () => validLayout });
  await assert.rejects(exportDocxReview(review.id, { ...request, pagePreference: 'flexible' }, { renderer: async () => {
    save('skill', { name: 'Fictional newly approved skill' });
    return validLayout;
  } }), { code: 'STALE_EVIDENCE' });
  assert.deepEqual(getDocxReview(review.id).versions.map((v) => v.id), [published.id]);

  const overflow = await makeDocx({ overflow: true });
  const layout = await verifyLayout({ staging, source, output: overflow, readable: ['Fictional repeated layout material.'],
    pagePreference: 'preserve', includePdf: false });
  if (layout.status === 'verified') {
    assert.ok(layout.pages > layout.originalPages);
    assert.match(layout.warnings.join(' '), /Layout changed/);
    await assert.rejects(verifyLayout({ staging, source, output: overflow, readable: [], pagePreference: 'one-page', includePdf: false }),
      { code: 'PAGE_LIMIT' });
    await assert.rejects(verifyLayout({ staging, source, output: source, readable: ['Fictional absent rendered words'],
      pagePreference: 'preserve', includePdf: true }), { code: 'LAYOUT_TEXT_LOSS' });
  }
  const { researchPublicJob } = await import('../src/research.js');
  const fetchBefore = globalThis.fetch;
  const origins = [];
  try {
    globalThis.fetch = async (uri, options) => {
      const url = new URL(uri);
      origins.push(url.hostname);
      assert.equal(options.redirect, 'error');
      assert.ok(!url.href.includes('127.0.0.1'));
      if (url.hostname === 'news.google.com') return new Response('<item><title>Fictional public release</title><link>https://news.example.test/demo</link><pubDate>' + new Date().toUTCString() + '</pubDate></item>');
      if (url.pathname.endsWith('api.php')) return Response.json({ search: [{ id: 'Q42', label: 'Fictional Employer', description: 'Fictional company' }] });
      if (url.pathname.endsWith('Q42.json')) return Response.json({ entities: { Q42: { sitelinks: { enwiki: { title: 'Fictional demonstration' } } } } });
      return Response.json({ extract: 'A public fictional company example.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Fictional_demonstration' } } });
    };
    const publicFacts = await researchPublicJob({ ...job, description: job.description + ' See http://127.0.0.1:1/.' });
    assert.equal(publicFacts.observations.length, 2);
    assert.deepEqual([...new Set(origins)].sort(), ['en.wikipedia.org', 'news.google.com', 'www.wikidata.org']);
    const count = origins.length;
    assert.equal((await researchPublicJob(job)).summary, publicFacts.summary);
    assert.equal(origins.length, count);
  } finally {
    globalThis.fetch = fetchBefore;
  }
  console.log('docx transactions: grounded reorder and removal, partial pairs, corrupted staging, forced process interruption, stale evidence, and pagination handling passed');
} finally {
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    worker.kill('SIGKILL');
    await once(worker, 'exit');
  }
  await fs.rm(directory, { recursive: true, force: true });
}
