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
