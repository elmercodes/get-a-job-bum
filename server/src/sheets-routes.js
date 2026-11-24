import { Router } from 'express';
import { createSheetsAdapter, createSheetsAuth, SheetsError } from './sheets-google.js';
import { createSheetsSync } from './sheets-sync.js';
import { listApplications } from './store.js';

export function sheetsRoutes(port) {
  const auth = createSheetsAuth({ port });
  const sync = createSheetsSync({ auth, adapter: createSheetsAdapter(auth), listApplications });
  const router = Router();
  const handle = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch((error) => {
    if (error instanceof SheetsError) res.status(error.code === 'permission' ? 403 : 409).json({ error: error.message, code: error.code });
    else next(error);
  });
  router.get('/status', handle((req, res) => res.json(sync.status())));
  router.post('/connect', handle(async (req, res) => res.json({ url: await sync.connect() })));
  router.post('/disconnect', handle(async (req, res) => res.json(await sync.disconnect())));
  router.post('/destination', handle(async (req, res) => {
    const { action, spreadsheet, confirmed } = req.body || {};
    if (!['create', 'select', 'clear_pending'].includes(action)) return res.status(400).json({ error: 'Choose a spreadsheet action.' });
    res.json(await sync.destination(action, spreadsheet, confirmed));
  }));
  router.post('/settings', handle(async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Choose whether to enable sync.' });
    res.json(await sync.settings(req.body.enabled));
  }));
  router.post('/retry', handle(async (req, res) => res.json(await sync.retry())));
  router.post('/conflicts/:id', handle(async (req, res) => res.json(await sync.resolve(req.params.id, req.body?.choice))));
  const callback = async (req, res) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    }).type('text/plain');
    try {
      if (req.hostname !== '127.0.0.1') throw new SheetsError('authentication_required');
      await auth.callback(req.query);
      res.send('Google authorization completed. Return to the extension to choose a tracker and enable sync.');
    } catch {
      res.status(400).send('Google authorization did not complete. Return to the extension to start a new attempt.');
    }
  };
  return { router, callback, start: sync.start };
}
