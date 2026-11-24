import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const base = process.env.AUTOJOB_URL;
const token = process.env.AUTOJOB_TOKEN;
if (!base || !/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Use the isolated fixture server');
const headers = { Authorization: 'Bearer ' + token };
async function request(path, method = 'GET', body, expected = 200) {
  const form = body instanceof FormData;
  const res = await fetch(base + '/api' + path, {
    method,
    headers: form ? headers : { ...headers, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
  });
  assert.equal(res.status, expected, method + ' ' + path);
  return res.json();
}

const scope = { run: randomUUID(), url: 'https://employer.example.test/jobs/fictional' };
const choose = (id, label, extra) => ({ id, label, type: 'checkbox', required: true, contextUrl: scope.url, ...extra });
const privacy = choose('privacy', 'I acknowledge the privacy policy', { terms: 'We retain applications for six months.' });
const legal = choose('legal', 'I certify that I am at least 18 years old');
const background = choose('background', 'I authorize the background check', {
  terms: 'Example Employer will obtain an employment screening report for this application only.',
});
const signature = { id: 'signature', label: 'Electronic signature', required: true, type: 'text', terms: legal.label, contextUrl: scope.url };
const marketing = choose('marketing', 'I consent to marketing and newsletters', { required: false });
const ambiguous = choose('ambiguous', 'Confirm');
const unsupported = choose('unsupported', 'I certify that I have never been convicted of a crime');
const restricted = { id: 'private', type: 'text', label: 'Social security number' };
const fields = [privacy, legal, background, signature, marketing, ambiguous, unsupported, restricted];
const answers = (set = fields, useScope = scope) => request('/answer', 'POST', { fields: set, scope: useScope });
const approve = (field, expected = 200) => request('/automation/acknowledge', 'POST', { field, scope }, expected);
const updateProfile = async (value) => request('/profile', 'PUT', {
  ...value, evidenceRevision: (await request('/profile')).evidenceRevision,
});
const before = await request('/profile');
try {
  assert.equal((await answers()).decisions.privacy.state, 'manual');
  await approve(privacy, 409);
  const fictional = { ...before, personal: { ...before.personal, dateOfBirth: '1990-01-01' } };
  await updateProfile(fictional);
  await request('/automation/settings', 'PUT', {
    preferences: { privacy: true, legal: true, background: true, signature: true },
    signature: 'Fictional Applicant', verifyProfile: true,
  });
  const pending = await answers();
  for (const f of [privacy, legal, background, signature]) assert.equal(pending.decisions[f.id].state, 'approval_required');
  assert.deepEqual(pending.values, {});
  for (const f of [privacy, legal, background, signature]) await approve(f);
  const filled = await answers();
  assert.deepEqual(filled.values, { privacy: true, legal: true, background: true, signature: 'Fictional Applicant' });
  for (const id of ['marketing', 'ambiguous', 'unsupported', 'private']) assert.equal(filled.decisions[id].state, 'manual');
  const protectedQuestions = ['Password', 'One-time code', 'Government ID', 'Credit card number', 'Expected salary',
    'Are you willing to relocate to Fictional City?', 'Will you require sponsorship?'];
  const protectedAnswer = await answers(protectedQuestions.map((label, i) => ({ id: 'protected-' + i, label, type: 'text' })));
  assert.deepEqual(protectedAnswer.values, {});
  for (const [i] of protectedQuestions.entries()) assert.equal(protectedAnswer.decisions['protected-' + i].state, 'manual');
  const revised = await answers([
    { ...privacy, terms: 'Keep applicant information for ten years.' },
    { ...background, terms: 'New screening provider will obtain an unrelated financial report for this applicant.' },
    { ...signature, terms: 'I agree to a new contract' },
  ]);
  assert.deepEqual(revised.values, {});
  assert.deepEqual((await answers(fields, { ...scope, run: randomUUID() })).values, {});
  await request('/automation/acknowledge', 'POST', { field: privacy, scope, remember: true });
  const nextJob = { run: randomUUID(), url: scope.url + '-next' };
  assert.deepEqual((await answers([{ ...privacy, contextUrl: nextJob.url }], nextJob)).values, { privacy: true });
  const other = { run: randomUUID(), url: 'https://other.example.test/jobs/fictional' };
  assert.deepEqual((await answers([{ ...privacy, contextUrl: other.url }], other)).values, {});
  assert.deepEqual((await answers([{ ...privacy, contextUrl: nextJob.url, terms: 'We retain materials beyond the original period.' }], nextJob)).values, {});
  await updateProfile({ ...fictional, personal: { ...fictional.personal, dateOfBirth: '2020-01-01' } });
  const contradictory = await answers();
  assert.equal(contradictory.decisions.legal.state, 'manual');
  assert.equal(contradictory.decisions.signature.state, 'manual');
  await approve(unsupported, 409);
  await updateProfile({ ...fictional, personal: { ...fictional.personal, dateOfBirth: '' } });
  await approve(legal, 409);
} finally {
  await updateProfile(before);
  await request('/automation/settings', 'PUT', { preferences: {}, removeSignature: true, clearVerification: true });
}

const review = { url: scope.url, nonce: randomUUID(), snapshot: 'a'.repeat(64), label: 'Submit Application' };
const prepared = await request('/submissions/review', 'POST', review, 201);
const endpoint = '/submissions/' + prepared.id;
await request(endpoint + '/authorize', 'POST', review, 409);
await request(endpoint + '/authorize', 'POST', { ...review, url: scope.url + '/other', confirmed: true }, 409);
await request(endpoint + '/authorize', 'POST', { ...review, confirmed: true });
await request(endpoint + '/authorize', 'POST', { ...review, confirmed: true }, 409);
await request('/submissions/review', 'POST', { ...review, nonce: randomUUID() }, 409);
const uncertain = await request(endpoint + '/result', 'POST', { clicked: true });
assert.equal(uncertain.status, 'submission_unverified');
assert.ok(uncertain.submittedAt);
assert.equal(uncertain.verifiedAt, undefined);
const verified = await request(endpoint + '/result', 'POST', { clicked: true, receipt: 'DEMO-123456' });
assert.equal(verified.status, 'applied');
assert.ok(verified.verifiedAt);
await request(endpoint + '/result', 'POST', { manuallyConfirmed: true }, 409);
await request('/applications/' + prepared.id, 'DELETE');

const upload = (name, bytes, expected) => {
  const form = new FormData();
  form.append('resume', new Blob([bytes]), name);
  return request('/profile/import', 'POST', form, expected);
};
await upload('invalid.pdf', 'not a PDF', 400);
await upload('active.pdf', '%PDF-1.7 /OpenAction << /S /JavaScript >> %%EOF', 400);
await upload('invalid.docx', 'not a ZIP archive', 400);
await upload('invalid.txt', new Uint8Array([0, 255]), 400);
await upload('oversize.pdf', new Uint8Array(5 * 1024 * 1024 + 1), 413);
const zip = spawnSync('python3', ['-c', "import io,zipfile,sys; f=io.BytesIO(); z=zipfile.ZipFile(f,'w'); z.writestr('word/document.xml','<!DOCTYPE test>'); z.writestr('[Content_Types].xml','<Types/>'); z.close(); sys.stdout.buffer.write(f.getvalue())"]);
assert.equal(zip.status, 0);
await upload('unsafe.docx', zip.stdout, 400);
const pdf = Buffer.from(await readFile(new URL('./sample.b64', import.meta.url), 'utf8'), 'base64');
const attachment = new FormData();
attachment.append('file', new Blob([pdf]), 'fictional-degree.pdf');
await request('/documents/degree', 'POST', attachment);
assert.equal((await request('/documents/degree')).mime, 'application/pdf');
await request('/documents/degree', 'DELETE');
console.log('phase1: scoped authorization, tracking, and upload validation passed');
