import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createPublicReader, publicAddress, publicUrl } from '../src/public-http.js';

for (const url of [
  'http://localhost/', 'http://sub.localhost/', 'http://169.254.169.254/', 'http://168.63.129.16/',
  'http://127.0.0.1/', 'http://127.1/', 'http://0x7f000001/', 'http://2130706433/', 'http://0177.0.0.1/',
  'http://10.0.0.10/', 'http://172.16.0.12/', 'http://192.168.1.5/', 'http://100.64.0.1/',
  'http://192.0.2.4/', 'http://224.1.1.1/', 'http://240.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
  'http://[fc00::1]/', 'http://[fe80::1]/', 'http://[ff02::1]/', 'http://[2001:db8::1]/', 'http://[2002:7f00:1::]/',
  'file:///fixture', 'ftp://fixture.example.com/', 'https://user:fictional@fixture.example.com/',
  'https://@fixture.example.com/', 'http://fixture.example.com:8080/', 'http://fixture.example.com./',
  'http://private.example.internal/', 'http://fixture.example.com\\other.invalid/',
]) assert.throws(() => publicUrl(url), { name: 'Error' }, url);
assert.ok(publicAddress('93.184.216.34'));
assert.ok(publicAddress('2606:4700::1111'));
assert.equal(publicUrl('https://fixture.example.com:443/page#anchor').href, 'https://fixture.example.com/page');

const requests = [];
const endpoints = new Map([
  ['/redirect', { status: 302, location: 'https://other.example.com/page' }],
  ['/private', { status: 302, location: 'http://169.254.169.254/' }],
  ['/dns-change', { status: 302, location: '/after-dns' }],
  ['/long', { status: 302, location: '/long' }],
  ['/unsafe-scheme', { status: 302, location: 'file:///fixture' }],
  ['/type', { type: 'image/png' }],
  ['/encoded', { encoding: 'gzip' }],
  ['/large', { body: 'x'.repeat(500), length: true }],
  ['/chunked', { body: 'x'.repeat(500) }],
  ['/stall', { stall: true }],
  ['/closed', { status: 410, type: 'application/octet-stream' }],
]);
const fixture = http.createServer((request, response) => {
  requests.push({ path: request.url, host: request.headers.host, authorization: request.headers.authorization,
    cookie: request.headers.cookie, accepts: request.headers['accept-encoding'] });
  const record = endpoints.get(request.url) || {};
  const body = record.body || 'Fictional public page';
  response.writeHead(record.status || 200, {
    'Content-Type': record.type || 'text/html',
    ...(record.location ? { Location: record.location } : {}),
    ...(record.length ? { 'Content-Length': Buffer.byteLength(body) } : {}),
    ...(record.encoding ? { 'Content-Encoding': record.encoding } : {}),
  });
  if (record.stall) response.write('Fictional ');
  else if (!record.length) { response.write(body); response.end(); }
  else response.end(body);
});

fixture.listen(0, '127.0.0.1');
await once(fixture, 'listening');
try {
  const wire = [];
  const resolved = [];
  let rebind = false;
  const reader = createPublicReader({
    resolve: async (host, options) => {
      assert.deepEqual(options, { all: true });
      resolved.push(host);
      if (host === 'mixed.example.com') return [{ address: '93.184.216.34' }, { address: 'fd00::1' }];
      if (host === 'rebind.example.com') return [{ address: rebind ? '127.0.0.1' : '93.184.216.34' }];
      if (host === 'stall-dns.example.com') return new Promise(() => {});
      return [{ address: host === 'ipv6.example.com' ? '2606:4700::1111' : '93.184.216.34' }];
    },
    request: (scheme, options, receive) => {
      wire.push({ scheme, options });
      if (options.headers.Host === 'rebind.example.com') rebind = true;
      // Route the network double to localhost only after checking the actual production transport options.
      assert.equal(options.agent, false);
      assert.ok(publicAddress(options.hostname));
      assert.equal(options.lookup, undefined);
      return http.request({ ...options, hostname: '127.0.0.1', family: 4, port: fixture.address().port }, receive);
    },
  });
  const host = 'http://fixture.example.com';
  assert.equal((await reader(host + '/page')).text, 'Fictional public page');
  assert.equal(resolved.length, 1, 'the socket cannot resolve the hostname again');
  assert.equal(wire[0].options.hostname, '93.184.216.34');
  assert.equal(requests[0].host, 'fixture.example.com');
  assert.equal(requests[0].authorization, undefined);
  assert.equal(requests[0].cookie, undefined);
  assert.equal(requests[0].accepts, 'identity');
  assert.equal((await reader('https://ipv6.example.com/page')).status, 200);
  assert.equal(wire.at(-1).options.hostname, '2606:4700::1111');
  assert.equal(wire.at(-1).options.servername, 'ipv6.example.com');
  assert.equal((await reader(host + '/redirect')).url, 'https://other.example.com/page');
  assert.equal((await reader(host + '/closed')).status, 410);
  for (const [url, code] of [
    [host + '/private', 'ADDRESS'],
    ['http://mixed.example.com/', 'DNS_ADDRESS'],
    ['http://rebind.example.com/dns-change', 'DNS_ADDRESS'],
    [host + '/long', 'REDIRECT'],
    ['https://fixture.example.com/private', 'ADDRESS'],
    [host + '/unsafe-scheme', 'URL'],
    [host + '/type', 'CONTENT_TYPE'],
    [host + '/encoded', 'ENCODING'],
    [host + '/large', 'SIZE'],
    [host + '/chunked', 'SIZE'],
    [host + '/stall', 'TIMEOUT'],
    ['http://stall-dns.example.com/', 'TIMEOUT'],
  ]) {
    // A referenced timer keeps the process alive while the fake DNS promise never settles.
    const clock = setTimeout(() => {}, 200);
    try { await assert.rejects(reader(url, { maxBytes: 200, maxRedirects: 1, timeoutMs: 80 }), { code }); }
    finally { clearTimeout(clock); }
  }
  await assert.rejects(reader(host + '/redirect', { allow: (url) => url.hostname === 'fixture.example.com' }), { code: 'HOST_POLICY' });
  assert.ok(!requests.some((request) => request.path === '/after-dns'));
  assert.equal(requests.filter((request) => request.path === '/long').length, 2);
  console.log('public HTTP: address and DNS validation, pinned socket options, redirect policy, credential isolation, type, size, and deadlines passed');
} finally {
  fixture.closeAllConnections();
  fixture.close();
  await once(fixture, 'close');
}
