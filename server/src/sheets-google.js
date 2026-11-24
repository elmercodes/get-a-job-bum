import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DATA_DIR, readJSON, writeJSON } from './storage.js';
import { APPLICATION_UUID, MANAGED_COLUMNS, SHEET_HEADERS, rowHash } from './tracker-schema.js';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN = 'https://oauth2.googleapis.com/token';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const TITLE = 'Get a Job, Bum! — Applications';
const MIME = 'application/vnd.google-apps.spreadsheet';
const OWNER = 'gaj-tracker-owner-v1';
const MARKER = 'gaj-application-v1';
const TAB = 'Applications';
const LIMIT = 5001;
const GRID_FIELDS = [
  'spreadsheetId',
  'developerMetadata(metadataId,metadataKey,metadataValue,location)',
  'sheets.properties(sheetId,title,gridProperties.rowCount)',
  'sheets.data(startRow,startColumn,rowData.values.userEnteredValue)',
].join(',');
const BOOK_ID = /^[A-Za-z0-9_-]{10,128}$/;
const tokensPath = path.join(DATA_DIR, 'google-sheets-tokens.json');

const errors = {
  not_configured: 'Configure a Desktop OAuth client on the local backend.',
  authentication_required: 'Connect Google again to continue.',
  permission: 'Google refused access. Check your authorization and tracker access.',
  rate_limit: 'Google is rate limiting requests. A retry is scheduled.',
  temporary: 'Google is temporarily unavailable. A retry is scheduled.',
  destination_missing: 'The tracker spreadsheet is unavailable. Select an authorized tracker.',
  destination_invalid: 'The spreadsheet does not have this installation’s tracker worksheet and expected headers.',
  request_invalid: 'Google rejected the request. Check the destination before retrying.',
  create_pending: 'The spreadsheet creation result is uncertain. Try finding the pending spreadsheet again.',
  changed: 'The spreadsheet changed. Review the conflict before writing.',
  duplicate: 'Multiple rows contain this application ID. Remove the duplicate IDs in Sheets.',
  ownership: 'The application’s Sheets write marker needs manual review.',
};
export class SheetsError extends Error {
  constructor(code, retryAfter = 0) {
    super(errors[code] || 'Could not synchronize Google Sheets.');
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function retryDelay(value) {
  if (!value) return 0;
  const seconds = Number(value);
  const millis = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(millis) ? Math.max(0, millis) : 0;
}

async function jsonRequest(fetcher, url, { signal, method = 'GET', body, token, form } = {}) {
  try {
    const deadline = AbortSignal.timeout(12000);
    const res = await fetcher(url, { method, redirect: 'error', signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : body ? { 'Content-Type': 'application/json' } : {}) },
      ...(form ? { body: new URLSearchParams(form) } : body ? { body: JSON.stringify(body) } : {}) });
    const chunks = [];
    let length = 0;
    for await (const bytes of res.body || []) {
      length += bytes.byteLength;
      if (length > (res.ok ? 8_000_000 : 32_000)) throw new SheetsError('temporary');
      chunks.push(bytes);
    }
    let reply;
    try { reply = length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null; } catch { /* Status still classifies errors. */ }
    if (res.ok) {
      if (reply && typeof reply === 'object' && !Array.isArray(reply)) return reply;
      if (url === 'https://oauth2.googleapis.com/revoke' && !length) return {};
      throw new SheetsError('temporary');
    }
    const retry = retryDelay(res.headers.get('Retry-After'));
    const reasons = Array.isArray(reply?.error?.errors) ? reply.error.errors : [];
    if (res.status === 429 || reasons.some(({ reason }) => ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(reason))) {
      throw new SheetsError('rate_limit', retry);
    }
    if (res.status >= 500 || res.status === 408) throw new SheetsError('temporary', retry);
    if (res.status === 401 || reply?.error === 'invalid_grant') throw new SheetsError('authentication_required');
    if (res.status === 403) throw new SheetsError('permission');
    if (res.status === 404) throw new SheetsError('destination_missing');
    throw new SheetsError('request_invalid');
  } catch (error) {
    if (error instanceof SheetsError) throw error;
    throw new SheetsError('temporary');
  }
}

export function createSheetsAuth({ port, clientId = process.env.AUTOJOB_GOOGLE_CLIENT_ID, clientSecret = process.env.AUTOJOB_GOOGLE_CLIENT_SECRET,
  fetcher = fetch, tokenFile = tokensPath } = {}) {
  const configured = typeof clientId === 'string' && /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId);
  const redirect = 'http://127.0.0.1' + (port === 80 ? '' : ':' + port) + '/oauth/google-sheets/callback';
  let grant, renewal, epoch = 0;
  let credentials;
  try {
    const saved = readJSON(tokenFile, null);
    if (configured && saved?.clientId === clientId && saved.scope === GOOGLE_SCOPE && typeof saved.refreshToken === 'string') credentials = saved;
  } catch { /* The tracker still works if its optional token file is unreadable. */ }
  const info = () => ({ configured, connected: !!credentials, authorizing: Boolean(grant && grant.until > Date.now()) });
  const exchange = (fields, signal) => jsonRequest(fetcher, TOKEN, { method: 'POST', signal,
    form: { client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}), ...fields } });
  function accept(reply, previous, revision) {
    if (revision !== epoch) throw new SheetsError('authentication_required');
    const scope = reply.scope ?? previous?.scope;
    const refreshToken = reply.refresh_token ?? previous?.refreshToken;
    if (scope !== GOOGLE_SCOPE || !/^bearer$/i.test(reply.token_type || '') || typeof reply.access_token !== 'string' ||
        !/^[^\s\x00-\x1f]{10,4096}$/.test(reply.access_token) || typeof refreshToken !== 'string' ||
        !/^[^\s\x00-\x1f]{10,4096}$/.test(refreshToken) || !Number.isFinite(reply.expires_in) || reply.expires_in <= 0) {
      throw new SheetsError(scope !== GOOGLE_SCOPE ? 'permission' : 'authentication_required');
    }
    const fresh = { clientId, scope, accessToken: reply.access_token, refreshToken, expiresAt: Date.now() + reply.expires_in * 1000 };
    writeJSON(tokenFile, fresh);
    credentials = fresh;
    return fresh.accessToken;
  }
  function forget() {
    epoch++;
    grant = renewal = credentials = undefined;
    fs.rmSync(tokenFile, { force: true });
  }
  function begin() {
    if (!configured) throw new SheetsError('not_configured');
    if (credentials) throw new SheetsError('changed');
    const verifier = randomBytes(48).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    grant = { state, verifier, until: Date.now() + 8 * 60_000, epoch: ++epoch };
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code',
      scope: GOOGLE_SCOPE, access_type: 'offline', prompt: 'consent select_account', state,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    return url.href;
  }
  async function callback({ state, code, error }) {
    const attempt = grant;
    if (!attempt || Date.now() >= attempt.until || typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state) ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(attempt.state))) throw new SheetsError('authentication_required');
    grant = undefined;
    if (error || typeof code !== 'string' || !code || code.length > 2048) throw new SheetsError('authentication_required');
    accept(await exchange({ grant_type: 'authorization_code', redirect_uri: redirect, code, code_verifier: attempt.verifier }), null, attempt.epoch);
  }
  async function access(signal, forced = false) {
    if (!credentials) throw new SheetsError('authentication_required');
    if (!forced && credentials.expiresAt > Date.now() + 60_000) return credentials.accessToken;
    if (!renewal) {
      const previous = credentials, revision = epoch;
      const task = exchange({ grant_type: 'refresh_token', refresh_token: previous.refreshToken }, signal)
        .then((reply) => accept(reply, previous, revision)).catch((error) => {
          if (revision === epoch && ['authentication_required', 'permission'].includes(error.code)) forget();
          throw error;
        }).finally(() => { if (renewal === task) renewal = undefined; });
      renewal = task;
    }
    return renewal;
  }
  async function request(url, options = {}) {
    const revision = epoch;
    const send = async (forced) => {
      const token = await access(options.signal, forced);
      if (revision !== epoch || options.signal?.aborted) throw new SheetsError('authentication_required');
      return jsonRequest(fetcher, url, { ...options, token });
    };
    try { return await send(false); } catch (error) {
      if (error.code !== 'authentication_required' || revision !== epoch || !credentials) throw error;
      try { return await send(true); } catch (retry) {
        if (retry.code === 'authentication_required' && revision === epoch) forget();
        throw retry;
      }
    }
  }
  async function disconnect() {
    const token = credentials?.refreshToken;
    forget();
    if (!token) return true;
    try {
      await jsonRequest(fetcher, 'https://oauth2.googleapis.com/revoke', { method: 'POST', form: { token } });
      return true;
    } catch { return false; }
  }
  return { info, begin, callback, request, disconnect };
}

export function sheetId(value) {
  if (typeof value !== 'string' || value.length > 512) throw new SheetsError('destination_invalid');
  const input = value.trim();
  const id = BOOK_ID.test(input) ? input : input.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{10,128})(?:\/[^\s]*)?$/)?.[1];
  if (!id) throw new SheetsError('destination_invalid');
  return id;
}

export const writeMarkerId = (uuid) => 2 + (createHash('sha256').update(uuid).digest().readUInt32BE(0) % 2147483645);
const metadata = (metadataId, metadataKey, metadataValue) => ({
  createDeveloperMetadata: { developerMetadata: { metadataId, metadataKey, metadataValue, visibility: 'DOCUMENT', location: { spreadsheet: true } } },
});
const cells = (values) => values.map((value) => ({ userEnteredValue: { stringValue: value } }));
const update = (sheetId, rowIndex, values) => ({ updateCells: {
  start: { sheetId, rowIndex, columnIndex: 0 }, rows: [{ values: cells(values) }], fields: 'userEnteredValue',
} });
const bookUrl = (id) => SHEETS + '/' + sheetId(id);
const validMetadata = (entry, key, value) => entry?.metadataKey === key && entry.metadataValue === value && entry.location?.spreadsheet === true;

function readGrid(response, id, owner) {
  const sheets = response.sheets;
  if (response.spreadsheetId !== id || !Array.isArray(sheets) || !Array.isArray(response.developerMetadata) ||
      !response.developerMetadata.some((entry) => entry.metadataId === 1 && validMetadata(entry, OWNER, owner))) {
    throw new SheetsError('destination_invalid');
  }
  const tab = sheets.find(({ properties }) => properties?.title === TAB);
  const grid = tab?.data?.[0], rows = grid?.rowData;
  const count = tab?.properties?.gridProperties?.rowCount;
  if (!Array.isArray(rows) || !Number.isSafeInteger(tab.properties.sheetId) || !Number.isInteger(count) ||
      count < 1 || count > LIMIT || rows.length > LIMIT || (grid.startRow || 0) !== 0 || (grid.startColumn || 0) !== 0 ||
      !SHEET_HEADERS.every((header, index) => rows[0]?.values?.[index]?.userEnteredValue?.stringValue === header)) {
    throw new SheetsError('destination_invalid');
  }
  const matches = new Map();
  for (const [index, row] of rows.entries()) {
    if (index === 0) continue;
    const uuid = row.values?.[0]?.userEnteredValue?.stringValue;
    if (!APPLICATION_UUID.test(uuid || '')) continue;
    const values = Array.from({ length: MANAGED_COLUMNS }, (_, col) => {
      const value = row.values?.[col]?.userEnteredValue;
      return value === undefined ? '' : typeof value.stringValue === 'string' ? value.stringValue : value;
    });
    const found = matches.get(uuid) || [];
    found.push({ index, hash: rowHash(values) });
    matches.set(uuid, found);
  }
  return { sheet: tab.properties.sheetId, matches,
    markers: new Map(response.developerMetadata.map((entry) => [entry.metadataId, entry])) };
}

export function createSheetsAdapter(auth) {
  const batch = async (id, requests, signal) => {
    const response = await auth.request(bookUrl(id) + ':batchUpdate', { method: 'POST', body: { requests }, signal });
    if (response.spreadsheetId !== id || response.replies?.length !== requests.length) throw new SheetsError('temporary');
  };
  async function inspect(id, owner, signal) {
    const query = new URLSearchParams({ ranges: TAB + '!A:N', fields: GRID_FIELDS });
    return readGrid(await auth.request(bookUrl(id) + '?' + query, { signal }), id, owner);
  }
  async function provision(intent, owner, markSent, signal) {
    const q = new URLSearchParams({ q: "trashed = false and appProperties has { key='gajTracker' and value='" + intent.id + "' }",
      fields: 'nextPageToken,files(id,mimeType)', pageSize: '10' });
    const listed = await auth.request(DRIVE + '?' + q, { signal });
    if (!Array.isArray(listed.files) || listed.files.length > 1 || listed.nextPageToken) throw new SheetsError('create_pending');
    let found = listed.files[0];
    if (!found) {
      if (intent.sent) throw new SheetsError('create_pending');
      markSent(true);
      try {
        found = await auth.request(DRIVE + '?fields=id,mimeType', {
          method: 'POST', body: { name: TITLE, mimeType: MIME, appProperties: { gajTracker: intent.id } }, signal,
        });
      } catch (error) {
        if (['authentication_required', 'permission', 'rate_limit', 'request_invalid'].includes(error.code)) markSent(false);
        throw error;
      }
    }
    if (found.mimeType !== MIME || !BOOK_ID.test(found.id || '')) throw new SheetsError('destination_invalid');
    const id = found.id;
    const query = new URLSearchParams({ fields: GRID_FIELDS });
    const snapshot = await auth.request(bookUrl(id) + '?' + query, { signal });
    if (snapshot.developerMetadata?.some((entry) => entry.metadataId === 1 && validMetadata(entry, OWNER, owner))) {
      return { id, sheet: (await inspect(id, owner, signal)).sheet };
    }
    const tab = snapshot.sheets?.[0];
    const sheet = tab?.properties?.sheetId;
    if (snapshot.spreadsheetId !== id || snapshot.sheets?.length !== 1 || !Number.isSafeInteger(sheet) ||
        snapshot.developerMetadata?.length || tab.data?.some((data) => data.rowData?.some((row) => row.values?.some((cell) => cell.userEnteredValue)))) {
      throw new SheetsError('destination_invalid');
    }
    await batch(id, [
      { updateSheetProperties: { properties: { sheetId: sheet, title: TAB, gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } },
      update(sheet, 0, SHEET_HEADERS), metadata(1, OWNER, owner),
    ], signal);
    return { id, sheet: (await inspect(id, owner, signal)).sheet };
  }
  async function append(id, sheet, uuid, values, marker, signal) {
    const operations = [];
    if (marker) {
      if (!validMetadata(marker, MARKER, uuid)) throw new SheetsError('ownership');
      operations.push({ deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: {
        metadataId: writeMarkerId(uuid), metadataKey: MARKER, metadataValue: uuid,
      } } } });
    }
    operations.push(metadata(writeMarkerId(uuid), MARKER, uuid));
    operations.push({ appendCells: { sheetId: sheet, rows: [{ values: cells(values) }], fields: 'userEnteredValue' } });
    await batch(id, operations, signal);
  }
  return { inspect, provision, append, replace: (id, sheet, index, row, signal) => batch(id, [update(sheet, index, row)], signal),
    marker: (grid, uuid) => grid.markers.get(writeMarkerId(uuid)), owns: (marker, uuid) => validMetadata(marker, MARKER, uuid) };
}
