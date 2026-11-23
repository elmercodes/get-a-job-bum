import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { matchAnswer } from '../src/evidence-model.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gaj-evidence-test-'));
const profileFile = path.join(dir, 'profile.json');
const token = randomBytes(32).toString('hex');
const reservation = net.createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const { port } = reservation.address();
reservation.close();
await once(reservation, 'close');
const base = 'http://127.0.0.1:' + port;
const auth = { Authorization: 'Bearer ' + token };
let child;
let state;

async function api(endpoint, { method = 'GET', body, status = 200, headers = auth } = {}) {
  const form = body instanceof FormData;
  const response = await fetch(base + '/api' + endpoint, {
    method, headers: form ? headers : { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
  });
  assert.equal(response.status, status, method + ' ' + endpoint);
  return response.headers.get('content-type')?.startsWith('application/json') ? response.json() : response.arrayBuffer();
}

async function start() {
  child = spawn(process.execPath, ['src/index.js'], {
    cwd: new URL('../', import.meta.url), stdio: 'ignore',
    env: { PATH: process.env.PATH, CI: 'true', PORT: String(port), AUTOJOB_DATA: dir, AUTOJOB_TOKEN: token,
      AUTOJOB_TEST: '1', DOTENV_CONFIG_PATH: path.join(dir, 'absent.env'), LLM_PROVIDER: 'ollama',
      OLLAMA_URL: 'http://127.0.0.1:9', OLLAMA_FALLBACK: 'off' },
  });
  for (let i = 0; i < 40; i++) {
    const response = await fetch(base + '/api/health', { headers: auth }).catch(() => null);
    if (response?.ok) return;
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Could not start isolated evidence backend');
}

async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await once(child, 'exit');
  }
}

async function save(kind, data, { id, decision = 'approve', status = 200, replace = false, revision = state.revision } = {}) {
  const result = await api('/evidence/records', { method: 'POST', status, body: { id, kind, data, decision, replace, revision } });
  if (status === 200) state = result.state;
  return result.record;
}

const url = 'https://fictional-employer.example.test/jobs/example';
const scope = { url, context: { employer: 'Fictional Employer', country: 'Exampleland', employmentType: 'Permanent' } };
const question = (label, type = 'text', options) => ({ id: 'demo', label, type, required: true, options });
const answer = (field, scopeOverride = scope) => api('/answer', { method: 'POST', body: { fields: [field], scope: scopeOverride } });

try {
  await fs.writeFile(profileFile, JSON.stringify({
    name: 'Morgan Example', email: 'morgan@example.invalid', skills: [],
    experience: [{ company: 'Fictional Employer', title: 'Engineer', start: '2020', end: '2021', bullets: ['Saved 12.50 hours per month.'] }],
    answerBank: { 'preferred contact method': { value: 'Email', type: 'text' } },
    sourceText: 'Example unsupported legacy raw text',
  }), { mode: 0o600 });
  await start();
  await api('/evidence', { status: 401, headers: {} });
  await api('/evidence', { status: 403, headers: { ...auth, Origin: 'https://unrelated.example.test' } });
  state = await api('/evidence');
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.migration.sourceVersion, 1);
  assert.ok(state.records.every((record) => record.status === 'pending'));
  assert.equal((await api('/profile')).experience.length, 0);
  assert.equal((await api('/profile')).email, '');
  const oldRole = state.records.find((record) => record.kind === 'employment');
  const oldClaim = state.records.find((record) => record.kind === 'accomplishment');
  await save('accomplishment', oldClaim.data, { id: oldClaim.id, status: 409 });
  await save('employment', oldRole.data, { id: oldRole.id });
  await save('accomplishment', oldClaim.data, { id: oldClaim.id });
  const contact = state.records.find((record) => record.kind === 'contact');
  await save('contact', { ...contact.data, preferredName: 'Mo' }, { id: contact.id });
  const second = await save('employment', { ...oldRole.data, title: 'Senior Engineer', start: '2021', end: 'Present' });
  assert.equal((await api('/profile')).experience.length, 2);
  await save('employment', second.data, { status: 409 });
  const conflict = await save('employment', { ...second.data, start: '2020' }, { decision: 'draft' });
  assert.equal(conflict.status, 'conflict');
  await save('employment', conflict.data, { id: conflict.id, status: 409 });
  await save('employment', { ...second.data, start: '2026', end: '2020' }, { status: 409 });
  await save('employment', conflict.data, { id: conflict.id, decision: 'reject' });
  const skill = await save('skill', { name: 'SQL', category: 'Technical', refs: [second.id] });
  const claim = await save('accomplishment', { original: 'Reduced reconciliation time by 12.50%.', metrics: [{ value: '12.50', unit: '%', label: 'Time' }],
    skills: ['SQL'], refs: [second.id], tags: ['data'] });
  const unsupported = await save('accomplishment', { original: 'Fictional unverified expansion by 90%', refs: [second.id] }, { decision: 'draft' });
  await save('accomplishment', unsupported.data, { id: unsupported.id, decision: 'reject' });
  await save('contact', { ssn: '000-00-0000' }, { status: 400 });
  await save('accomplishment', { original: 'password: fake-demo-value' }, { status: 400 });
  await save('skill', { name: 'No reference', refs: ['fictional-id'] }, { status: 400 });
  await save('skill', { name: 'Stale edit' }, { revision: state.revision - 1, status: 409 });

  const selected = await api('/evidence/select', { method: 'POST', body: { description: 'Seeking SQL and data experience' } });
  assert.ok(selected.records.some((r) => r.id === claim.id && r.data.metrics[0].value === '12.50' && r.data.metrics[0].unit === '%'));
  assert.ok(selected.records.some((r) => r.id === skill.id && r.data.refs[0] === second.id));
  assert.ok(!selected.records.some((r) => [unsupported.id, contact.id].includes(r.id)));

  await save('education', { school: 'Fictional Graduate School', degree: 'Master of Science', start: '2024', end: '2025' });
  const degreeQuestion = question('Highest degree', 'select', ["Bachelor's Degree", "Master's Degree"]);
  assert.equal((await answer(degreeQuestion)).values.demo, "Master's Degree");
  assert.deepEqual((await answer({ ...degreeQuestion, options: ["Bachelor's Degree"] })).values, {});
  const unanswered = await answer(question('How should we contact you'));
  assert.deepEqual(unanswered.values, {});
  assert.ok(unanswered.needsReview.includes('demo'));
  const approved = await save('answer', { question: 'What is your preferred contact method?', answerType: 'choice',
    response: 'Email', scope: 'site', scopeValue: new URL(url).origin, country: 'Exampleland', employmentType: 'Permanent' });
  assert.equal((await answer(question('How should we contact you?', 'select', ['Email', 'Phone']))).values.demo, 'Email');
  assert.deepEqual((await answer(question('How should we contact you?', 'select', ['Email', 'Phone']))).evidenceIds.demo, [approved.id]);
  assert.deepEqual((await answer(question('How should we not contact you?', 'select', ['Email', 'Phone']))).values, {});
  assert.deepEqual((await answer(question('How should we contact you?', 'select', ['Phone']))).values, {});
  assert.deepEqual((await answer({ ...question('How should we contact you?', 'select', ['Email', 'Phone']),
    help: 'For a different contact person covering weekends', entry: 2 })).values, {});
  assert.deepEqual((await answer(question('How should we contact you?', 'select', ['Email']), { ...scope,
    context: { ...scope.context, country: 'Otherland' } })).values, {});
  assert.deepEqual((await answer(question('How should we contact you?', 'select', ['Email']), { ...scope,
    url: 'https://another-example.example.test/jobs/2' })).values, {});
  assert.equal(matchAnswer([{ ...approved, data: { ...approved.data, expiresOn: '2020-01-01' } }], question('How should we contact you', 'select', ['Email']),
    { url, ...scope.context }), null);

  await save('answer', { question: 'Are you willing to relocate to Exampleland?', answerType: 'choice', response: 'Yes', scope: 'global' }, { status: 400 });
  await save('answer', { question: 'Are you willing to relocate to Exampleland?', answerType: 'choice',
    response: 'Yes', scope: 'job', scopeValue: url, country: 'Exampleland' });
  const relocation = await answer(question('Are you willing to relocate to Exampleland?', 'radio', ['Yes', 'No']));
  assert.deepEqual(relocation.values, {}, 'Phase 1 protects the actual sensitive field');
  assert.equal(relocation.suggested.demo, 'Yes');
  assert.equal(relocation.decisions.demo.category, 'sensitive');
  await api('/answer-bank', { method: 'POST', body: { entries: [{ label: 'Question', value: 'Unapproved' }] }, status: 410 });

  const resumeText = 'Fiction Example\nfiction@example.invalid\nExperience\nSoftware Engineer | Fictional Import Labs | Jan 2022 - Feb 2024\n• Improved the test pipeline by 15 percent.\nEducation\nFictional Example University | Bachelor of Science | 2020\nTechnical Skills\nSQL, Python';
  const archive = spawnSync('python3', ['-c', [
    'import io,zipfile,sys,html',
    'out=io.BytesIO()',
    'parts="".join("<w:p><w:r><w:t>"+html.escape(line)+"</w:t></w:r></w:p>" for line in sys.argv[1].splitlines())',
    'z=zipfile.ZipFile(out,"w")',
    'z.writestr("[Content_Types].xml","<Types/>")',
    'z.writestr("word/document.xml",\'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>\'+parts+"</w:body></w:document>")',
    'z.close()',
    'sys.stdout.buffer.write(out.getvalue())',
  ].join('\n'), resumeText]);
  assert.equal(archive.status, 0);
  const upload = () => {
    const data = new FormData();
    data.append('revision', String(state.revision));
    data.append('resume', new Blob([archive.stdout]), 'fictional.docx');
    return api('/profile/import', { method: 'POST', body: data });
  };
  const restricted = new FormData();
  restricted.append('revision', String(state.revision));
  restricted.append('resume', new Blob(['Password: fictional-import-value']), 'fictional-sensitive.txt');
  await api('/profile/import', { method: 'POST', body: restricted, status: 400 });
  assert.equal((await api('/evidence')).sources.length, 0);
  const imported = await upload();
  assert.equal(imported.stats.imported, 1);
  assert.ok(imported.stats.proposals >= 3);
  assert.ok(imported.stats.conflicts >= 1);
  state = imported.state;
  assert.ok(state.records.filter((r) => r.provenance.kind === 'import').every((r) => ['pending', 'conflict'].includes(r.status)));
  assert.equal((await api('/profile')).experience.length, 2);
  const sourceId = state.sources[0].id;
  const original = await api('/evidence/sources/' + sourceId);
  assert.deepEqual(Buffer.from(original), archive.stdout);
  assert.equal((await upload()).stats.skipped, 1);

  const tailored = await api('/tailor', { method: 'POST', body: { title: 'Fictional data engineer',
    company: 'Fictional Employer', description: 'Looking for SQL experience to help maintain data services, validate reports, and support internal reconciliation projects.' } });
  assert.ok(tailored.evidenceIds.includes(claim.id));
  assert.ok(!tailored.evidenceIds.includes(unsupported.id));
  assert.equal(Buffer.from(tailored.pdfBase64, 'base64').subarray(0, 5).toString(), '%PDF-');

  const snapshot = await fs.readFile(profileFile);
  const failedWrite = spawnSync(process.execPath, ['--input-type=module', '-e', [
    "import assert from 'node:assert/strict'",
    "import fs from 'node:fs'",
    "import path from 'node:path'",
    "import { writeJSON } from './src/storage.js'",
    "const blocked = path.join(process.env.AUTOJOB_DATA, 'cannot-replace-directory')",
    "fs.mkdirSync(blocked)",
    "assert.throws(() => writeJSON(blocked, { fictional: true }))",
    "assert.ok(fs.statSync(blocked).isDirectory())",
    "assert.ok(!fs.readdirSync(process.env.AUTOJOB_DATA).some(name => name.startsWith('cannot-replace-directory.')))",
  ].join(';')], { cwd: new URL('../', import.meta.url), env: { ...process.env, AUTOJOB_DATA: dir } });
  assert.equal(failedWrite.status, 0);
  assert.deepEqual(await fs.readFile(profileFile), snapshot);
  await fs.writeFile(profileFile + '.partial.tmp', '{"interrupted":');
  await stop();
  await start();
  state = await api('/evidence');
  assert.deepEqual(await fs.readFile(profileFile), snapshot);
  assert.equal((await answer(question('How should we contact you?', 'select', ['Email', 'Phone']))).values.demo, 'Email');
  await save('answer', { ...approved.data, response: 'Phone' }, { id: approved.id });
  assert.equal((await answer(question('How should we contact you?', 'select', ['Email', 'Phone']))).values.demo, 'Phone');
  state = await api('/evidence/records/' + approved.id, { method: 'DELETE', body: { revision: state.revision } });
  assert.deepEqual((await answer(question('How should we contact you?', 'select', ['Email', 'Phone']))).values, {});
  state = await api('/evidence/records/' + second.id, { method: 'DELETE', body: { revision: state.revision } });
  assert.equal(state.records.find((r) => r.id === claim.id).status, 'pending');
  assert.equal(state.records.find((r) => r.id === skill.id).status, 'pending');
  const exported = await api('/evidence/export');
  assert.ok(exported.records.some((r) => r.id === claim.id));

  await fs.writeFile(profileFile, '{');
  await api('/evidence/records', { method: 'POST', body: { kind: 'skill', data: { name: 'Unknown' }, decision: 'approve', revision: state.revision }, status: 500 });
  assert.equal(await fs.readFile(profileFile, 'utf8'), '{');
  await fs.writeFile(profileFile, JSON.stringify(state), { mode: 0o600 });
  state = await api('/evidence/sources/' + sourceId, { method: 'DELETE', body: { revision: state.revision } });
  await api('/evidence/sources/' + sourceId, { status: 404 });
  await api('/evidence', { method: 'DELETE', body: { revision: state.revision, confirmed: true } });
  assert.deepEqual((await api('/evidence')).records, []);
  assert.equal(await api('/profile'), null);
} finally {
  await stop();
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('evidence: migration, authorization, CRUD, conflicts, DOCX, verified facts, atomic recovery, and API restart passed');
