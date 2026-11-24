import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const ipv4 = new BlockList();
for (const [network, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) ipv4.addSubnet(network, bits, 'ipv4');
ipv4.addAddress('168.63.129.16', 'ipv4'); // Azure platform service address

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const ipv6 = new BlockList();
for (const [network, bits] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20], ['2620:4f:8000::', 48],
]) ipv6.addSubnet(network, bits, 'ipv6');

export const publicAddress = (address) => {
  const family = isIP(address);
  return family === 4 ? !ipv4.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !ipv6.check(address, 'ipv6');
};

export class PublicRequestError extends Error {
  constructor(code) {
    super('Public request refused or unavailable (' + code + ').');
    this.code = code;
  }
}

const hostOf = (url) => url.hostname.replace(/^\[|\]$/g, '');

export function publicUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048 || !/^https?:\/\//i.test(raw) ||
      /[\s\\\u0000-\u001f\u007f]/u.test(raw) || !URL.canParse(raw)) throw new PublicRequestError('URL');
  const url = new URL(raw);
  const host = hostOf(url);
  const authority = raw.split('/')[2]?.split(/[?#]/)[0];
  if (url.username || url.password || authority?.includes('@') || url.port) throw new PublicRequestError('URL');
  const ip = isIP(host);
  if (ip ? !publicAddress(host) : !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) ||
      /\.(?:localhost|local|internal|home|lan|invalid|test|example|onion|arpa)$/i.test(host)) {
    throw new PublicRequestError('ADDRESS');
  }
  url.hash = '';
  return url;
}

async function underDeadline(work, signal) {
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      abort = () => reject(new PublicRequestError('TIMEOUT'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

function defaultRequest(protocol, options, receive) {
  return (protocol === 'https:' ? https : http).request(options, receive);
}

const redirects = new Set([301, 302, 303, 307, 308]);
const html = 'text/html';
const json = 'application/json';
const defaultTypes = [html, 'application/xhtml+xml', json, 'text/plain'];

function readResponse(request, url, address, options) {
  const { types, method, body, maxBytes, signal, userAgent } = options;
  const host = hostOf(url);
  const headers = { Host: url.host, 'User-Agent': userAgent, Accept: types.join(', '), 'Accept-Encoding': 'identity' };
  if (body !== undefined) {
    headers['Content-Type'] = json;
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const req = request(url.protocol, {
      hostname: address, family: isIP(address), port: url.protocol === 'https:' ? 443 : 80,
      ...(url.protocol === 'https:' && !isIP(host) ? { servername: host } : {}),
      method, path: url.pathname + url.search, headers, signal, agent: false, maxHeaderSize: 16384,
    }, (res) => {
      const status = res.statusCode || 0;
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const answer = { status, ok: status >= 200 && status < 300, url: url.href, type, text: '' };
      res.on('error', reject);
      if (redirects.has(status) || !answer.ok) {
        resolve({ ...answer, location: res.headers.location });
        res.destroy();
        return;
      }
      if (!types.includes(type) && !(types.includes(json) && /^application\/[a-z0-9.+-]+\+json$/.test(type))) {
        reject(new PublicRequestError('CONTENT_TYPE'));
        res.destroy();
        return;
      }
      const encoding = res.headers['content-encoding'];
      const length = Number(res.headers['content-length']);
      if ((encoding && encoding !== 'identity') || length > maxBytes) {
        reject(new PublicRequestError(encoding && encoding !== 'identity' ? 'ENCODING' : 'SIZE'));
        res.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          reject(new PublicRequestError('SIZE'));
          res.destroy();
        } else chunks.push(chunk);
      });
      res.on('end', () => resolve({ ...answer, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

// The request receives a numeric destination. Node never resolves the original
// hostname again, and HTTPS receives that hostname separately for SNI and trust.
export function createPublicReader({ resolve = lookup, request = defaultRequest } = {}) {
  return async (raw, {
    types = defaultTypes, method = 'GET', body, maxBytes = 1024 * 1024, timeoutMs = 8000,
    maxRedirects = 2, allow = () => true, userAgent = 'Auto Job public source reader',
  } = {}) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let url = publicUrl(raw);
    for (let hop = 0; ; hop++) {
      if (!allow(url)) throw new PublicRequestError('HOST_POLICY');
      const host = hostOf(url);
      const candidate = isIP(host) ? [{ address: host }] : await underDeadline(() => resolve(host, { all: true }), signal);
      if (!candidate.length || candidate.some(({ address }) => !publicAddress(address))) throw new PublicRequestError('DNS_ADDRESS');
      const response = await underDeadline(() => readResponse(request, url, candidate[0].address,
        { types, method, body, maxBytes, signal, userAgent }), signal);
      if (!redirects.has(response.status)) return response;
      if (hop >= maxRedirects || method !== 'GET' || typeof response.location !== 'string' ||
          /[\s\\\u0000-\u001f\u007f]/u.test(response.location)) throw new PublicRequestError('REDIRECT');
      const next = publicUrl(new URL(response.location, url).href);
      if (url.protocol === 'https:' && next.protocol !== 'https:') throw new PublicRequestError('REDIRECT');
      url = next;
    }
  };
}

export const readPublic = createPublicReader();
