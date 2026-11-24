import assert from 'node:assert/strict';
import { localApi } from '../src/local-api.js';

const base = process.env.AUTOJOB_URL;
const token = process.env.AUTOJOB_TOKEN;
if (!base || !/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Use the isolated fixture server');
const auth = { Authorization: 'Bearer ' + token };
const health = async (headers) => (await fetch(base + '/api/health', { headers })).status;
assert.equal(await health({}), 401);
assert.equal(await health({ Authorization: 'Bearer wrong' }), 401);
assert.equal(await health(auth), 200);
assert.equal(await health({ ...auth, Origin: base }), 200);
assert.equal(await health({ ...auth, Origin: 'https://example.invalid' }), 403);
assert.equal((await fetch(base + '/api/sheets/status')).status, 401);
assert.equal((await fetch(base + '/api/sheets/retry', { method: 'POST', headers: { ...auth, Origin: 'https://example.invalid' } })).status, 403);
const sheets = await (await fetch(base + '/api/sheets/status', { headers: auth })).json();
assert.equal(sheets.enabled, false);
assert.equal(sheets.connected, false);
const restrictedUrls = ['http://127.0.0.1/fictional', 'http://169.254.169.254/fictional', 'http://[::1]/fictional',
  'https://linkedin.com/jobs/view/fictional', 'https://fixture:example@fictional.example.com/'];
const jobCheck = await fetch(base + '/api/jobs/check', { method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: restrictedUrls }) });
assert.equal(jobCheck.status, 200);
assert.deepEqual((await jobCheck.json()).results, Object.fromEntries(restrictedUrls.map((url) => [url, 'unknown'])));
const foreignResearch = await fetch(base + '/api/research', { method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json', Origin: 'https://unrelated.example.invalid' },
  body: JSON.stringify({ company: 'Fictional Employer' }) });
assert.equal(foreignResearch.status, 403);

const extensionId = 'a'.repeat(32);
const gate = localApi({ port: +new URL(base).port, token, extensionId, test: false });
function authorize(headers) {
  let code = 200;
  const response = { status: (value) => { code = value; return response; }, json() {}, set() {} };
  gate.checkClient({ headers }, response, () => {});
  return code;
}
const paired = { authorization: auth.Authorization, 'x-autojob-extension': extensionId };
assert.equal(authorize({ ...paired, origin: 'chrome-extension://' + extensionId }), 200);
assert.equal(authorize({ ...paired, origin: 'chrome-extension://' + 'b'.repeat(32) }), 403);
assert.equal(authorize({ authorization: auth.Authorization }), 403);
assert.equal(authorize({ ...paired, origin: base }), 403);
let hostStatus = 200;
const hostResponse = { status: (code) => { hostStatus = code; return hostResponse; }, json() {} };
gate.checkHost({ headers: { host: 'localhost.example.invalid:' + new URL(base).port } }, hostResponse, () => {});
assert.equal(hostStatus, 403);
console.log('security: local authentication and origin checks passed');
