// Loaded only by the isolated browser harness. Refuse cloud requests outside the fixture.
const original = globalThis.fetch;
const port = Number(process.env.GAJ_FIXTURE_GOOGLE_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || process.env.CI !== 'true') throw new Error('Use the isolated Google fixture.');
globalThis.fetch = (raw, init) => {
  const url = new URL(raw);
  if (['oauth2.googleapis.com', 'sheets.googleapis.com', 'www.googleapis.com'].includes(url.hostname)) {
    return original('http://127.0.0.1:' + port + '/' + url.hostname + url.pathname + url.search, init);
  }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Network denied in fixture');
  return original(raw, init);
};
