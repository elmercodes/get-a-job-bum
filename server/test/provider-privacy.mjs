import assert from 'node:assert/strict';
import { chatJSON } from '../src/llm.js';

let calls = 0;
globalThis.fetch = async () => {
  calls++;
  return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
};
process.env.LLM_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'fictional';
process.env.FALLBACK_PROVIDERS = 'openrouter';
process.env.OPENROUTER_API_KEY = 'fictional';
delete process.env.HEAVY_LLM_PROVIDER;
delete process.env.AUTOJOB_AUTHORIZED_PROVIDERS;
await assert.rejects(chatJSON('Fictional task', 'Fictional applicant data'), /Authorize this cloud provider/);
assert.equal(calls, 0);
process.env.AUTOJOB_AUTHORIZED_PROVIDERS = 'openai';
assert.deepEqual(await chatJSON('Fictional task', 'Fictional applicant data'), { ok: true });
assert.equal(calls, 1);
process.env.HEAVY_LLM_PROVIDER = 'anthropic';
await assert.rejects(chatJSON('Fictional task', 'Fictional applicant data', { heavy: true }), /Authorize this cloud provider/);
assert.equal(calls, 1);
process.env.LLM_PROVIDER = 'ollama';
process.env.OLLAMA_URL = 'https://fictional-endpoint.example.test';
await assert.rejects(chatJSON('Fictional task', 'Fictional applicant data'), /loopback/);
assert.equal(calls, 1);
console.log('provider privacy: unauthorized primary, heavy, fallback, and non-loopback paths made zero requests');
