import http from 'node:http';

const mime = 'application/vnd.google-apps.spreadsheet';
const sheetsId = 'fictional-workbook-0001';
const reply = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

export async function startMockGoogle() {
  const remote = { requests: [], creates: 0, writes: 0, refreshes: 0, revoked: 0, spreadsheet: null, issue: '', scope: undefined };
  const fault = (name) => {
    if (remote.issue !== name) return false;
    remote.issue = '';
    return true;
  };
  const server = http.createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const url = new URL(req.url, 'http://fixture.invalid');
      const [kind, ...components] = url.pathname.split('/').filter(Boolean);
      const endpoint = '/' + components.join('/');
      remote.requests.push({ kind, endpoint, method: req.method });
      if (kind === 'fixture-state' && req.method === 'GET') return reply(res, 200, { rows: remote.spreadsheet?.rows || [], writes: remote.writes });
      if (kind === 'oauth2.googleapis.com') {
        const form = new URLSearchParams(raw);
        remote.lastTokenForm = form;
        if (endpoint === '/revoke') { remote.revoked++; return reply(res, 200, {}); }
        const isRefresh = form.get('grant_type') === 'refresh_token';
        if (isRefresh) remote.refreshes++;
        if (remote.revokedAccess && isRefresh) return reply(res, 400, { error: 'invalid_grant' });
        return reply(res, 200, { access_token: 'fictional-access-value', refresh_token: 'fictional-refresh-value',
          token_type: 'Bearer', expires_in: 3600,
          scope: remote.scope || 'https://www.googleapis.com/auth/drive.file' });
      }
      if (!req.headers.authorization || remote.revokedAccess) return reply(res, 401, { error: {} });
      if (fault('offline')) { res.destroy(); return; }
      if (fault('rate')) return reply(res, 429, { error: {} }, { 'Retry-After': '30' });
      if (fault('denied')) return reply(res, 403, { error: {} });
      if (kind === 'www.googleapis.com' && endpoint === '/drive/v3/files') {
        if (req.method === 'GET') return reply(res, 200, { files: remote.spreadsheet ? [{ id: sheetsId, mimeType: mime }] : [] });
        remote.creates++;
        remote.spreadsheet = { title: 'Sheet1', rows: [], metadata: [] };
        if (fault('lost-create')) { res.destroy(); return; }
        return reply(res, 200, { id: sheetsId, mimeType: mime });
      }
      if (url.pathname.includes(sheetsId) && remote.spreadsheet) {
        const book = remote.spreadsheet;
        if (req.method === 'GET') {
          const fields = url.searchParams.get('fields') || '';
          const groups = fields.match(/[()]/g) || [];
          let depth = 0;
          if (groups.some((group) => (depth += group === '(' ? 1 : -1) < 0) || depth !== 0 ||
              !fields.includes('rowData.values.userEnteredValue') || !fields.includes('gridProperties.rowCount')) {
            return reply(res, 400, { error: {} });
          }
          if (fault('bad-read')) return reply(res, 200, { spreadsheetId: sheetsId });
          return reply(res, 200, { spreadsheetId: sheetsId, developerMetadata: book.metadata,
            sheets: [{ properties: { sheetId: 7, title: book.title, gridProperties: { rowCount: 1000 } },
              ...(book.rows.length ? { data: [{ rowData: book.rows.map((values) => ({ values })) }] } : {}) }] });
        }
        const operations = JSON.parse(raw).requests;
        if (fault('lost-before-write')) { res.destroy(); return; }
        if (remote.pauseWrite) await remote.pauseWrite();
        const draft = structuredClone(book);
        for (const op of operations) {
          if (op.updateSheetProperties) draft.title = op.updateSheetProperties.properties.title;
          if (op.deleteDeveloperMetadata) {
            const lookup = op.deleteDeveloperMetadata.dataFilter.developerMetadataLookup;
            draft.metadata = draft.metadata.filter((item) => !Object.entries(lookup).every(([key, value]) => item[key] === value));
          }
          if (op.createDeveloperMetadata) {
            const marker = op.createDeveloperMetadata.developerMetadata;
            if (draft.metadata.some(({ metadataId }) => metadataId === marker.metadataId)) return reply(res, 400, { error: {} });
            draft.metadata.push(marker);
          }
          if (op.appendCells) {
            draft.rows.push(op.appendCells.rows[0].values);
            remote.writes++;
          }
          if (op.updateCells) {
            const index = op.updateCells.start.rowIndex;
            draft.rows[index] ||= [];
            op.updateCells.rows[0].values.forEach((value, col) => { draft.rows[index][col] = value; });
            if (index > 0) remote.writes++;
          }
        }
        remote.spreadsheet = draft;
        if (fault('lost-write')) { res.destroy(); return; }
        if (fault('bad-ack')) return reply(res, 200, { spreadsheetId: sheetsId });
        return reply(res, 200, { spreadsheetId: sheetsId, replies: operations.map(() => ({})) });
      }
      reply(res, 404, { error: {} });
    } catch {
      if (!res.headersSent) reply(res, 500, { error: {} });
      else res.destroy();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const fetcher = (raw, init) => {
    const url = new URL(raw);
    return fetch(origin + '/' + url.hostname + url.pathname + url.search, init);
  };
  return { remote, fetcher, origin, id: sheetsId, stop: () => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }) };
}

// Real HTTP fixture used by the optional browser harness.
if (process.argv.includes('--listen')) {
  const mock = await startMockGoogle();
  console.log(mock.origin);
}
