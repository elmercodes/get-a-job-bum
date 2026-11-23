import { timingSafeEqual } from 'node:crypto';

export function localApi({ port, token, extensionId, test }) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error('Set AUTOJOB_TOKEN to a random 64-character lowercase hex token. See docs/PHASE_1.md.');
  }
  if (!test && !/^[a-p]{32}$/.test(extensionId || '')) {
    throw new Error('Set EXTENSION_ID to the unpacked extension ID shown in chrome://extensions.');
  }
  const hosts = new Set([port === 80 ? 'localhost' : 'localhost:' + port, port === 80 ? '127.0.0.1' : '127.0.0.1:' + port]);
  const extensionOrigin = 'chrome-extension://' + extensionId;
  const allowedOrigin = (origin) => (
    (!!extensionId && origin === extensionOrigin) ||
    (test && [...hosts].some((host) => origin === 'http://' + host))
  );
  const expected = Buffer.from('Bearer ' + token);

  const checkHost = (req, res, next) => hosts.has(req.headers.host)
    ? next() : res.status(403).json({ error: 'Forbidden host' });

  function checkClient(req, res, next) {
    const origin = req.headers.origin;
    if (origin && !allowedOrigin(origin)) return res.status(403).json({ error: 'Forbidden origin' });
    // Extension GETs can omit Origin. Require the paired installation and secret on every request.
    if (!test && req.headers['x-autojob-extension'] !== extensionId) {
      return res.status(403).json({ error: 'Pair this extension in Profile settings' });
    }
    const presented = Buffer.from(req.headers.authorization || '');
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      return res.status(401).json({ error: 'Local API token required' });
    }
    res.set('Cache-Control', 'no-store');
    next();
  }

  return { allowedOrigin, checkHost, checkClient };
}
