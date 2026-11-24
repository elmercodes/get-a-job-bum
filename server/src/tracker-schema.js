import { createHash, randomUUID } from 'node:crypto';
import { publicUrl } from './public-http.js';

export const APPLICATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const SHEET_HEADERS = ['Application ID', 'Company', 'Position', 'Location', 'Job posting URL', 'Source',
  'Date saved', 'Date prepared', 'Date applied', 'Application status', 'Last updated', 'Resume version', 'Follow-up date', 'Notes'];
export const MANAGED_COLUMNS = SHEET_HEADERS.length - 1;

export function trackerUrl(value, { minimize = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\x00-\x1f]/.test(value) || !URL.canParse(value)) return '';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
  url.hash = '';
  if (minimize) {
    url.search = '';
    try { return publicUrl(url.href).href; } catch { return ''; }
  }
  else for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

const key = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
export function samePosting(a, b) {
  const aUrl = trackerUrl(a.url), bUrl = trackerUrl(b.url);
  const identities = ['company', 'title'];
  if (identities.some((field) => key(a[field]) && key(b[field]) && key(a[field]) !== key(b[field]))) return false;
  if (aUrl && bUrl) return aUrl === bUrl && Boolean(key(a.title)) && key(a.title) === key(b.title);
  return identities.every((field) => key(a[field]) && key(a[field]) === key(b[field]));
}

export function migrateTracker(apps) {
  const ids = new Set(), canonical = new Set();
  let changed = false;
  for (const app of apps) {
    if (typeof app.id !== 'string' || !/^[a-z0-9-]{1,36}$/.test(app.id) || ids.has(app.id)) {
      app.id = randomUUID();
      changed = true;
    }
    ids.add(app.id);
    if (!APPLICATION_UUID.test(app.applicationId || '') || canonical.has(app.applicationId)) {
      app.applicationId = APPLICATION_UUID.test(app.id) && !canonical.has(app.id) ? app.id : randomUUID();
      changed = true;
    }
    canonical.add(app.applicationId);
    if (!Number.isSafeInteger(app.revision) || app.revision < 1) { app.revision = 1; changed = true; }
    if (!Array.isArray(app.history)) {
      if (!app.status && app.at) app.status = 'applied';
      if (!app.createdAt && app.at) app.createdAt = app.at;
      if (!app.appliedAt && app.status === 'applied' && app.at) app.appliedAt = app.at;
      app.history = app.status && app.createdAt ? [{ status: app.status, at: app.createdAt }] : [];
      changed = true;
    }
  }
  return changed;
}

const text = (value, size) => typeof value === 'string' ? value.slice(0, size) : '';
const instant = (value) => typeof value === 'string' && value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
export function followUpDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && instant(value).slice(0, 10) === value ? value : '';
}

export const confirmedDate = (app) => app.status !== 'submission_unverified' &&
  ['user_confirmed', 'portal_receipt'].includes(app.verification) && instant(app.verifiedAt) ? instant(app.appliedAt) : '';

export function trackerRow(app) {
  const applied = confirmedDate(app);
  const source = ['portal', 'email', 'gmail', 'job_board', 'manual'].includes(app.via) ? app.via : 'manual';
  return [app.applicationId, text(app.company, 150), text(app.title, 250), text(app.location, 120),
    trackerUrl(app.url, { minimize: true }), source, instant(app.createdAt), instant(app.preparedAt), applied,
    app.status === 'applied' && !applied ? 'submission_unverified' : text(app.status || 'saved', 50),
    instant(app.updatedAt || app.createdAt), /^[a-f0-9]{64}$/.test(app.resumeVersion || '') ? app.resumeVersion : '',
    followUpDate(app.followUpDate)];
}

export const rowHash = (row) => createHash('sha256').update(JSON.stringify(row)).digest('hex');
export function trackerCsv(apps) {
  const escape = (value) => '"' + String(value ?? '').replace(/^(?:(?=[\t\r\n])|(?=[\s\p{Cf}]*[=+\-@＝＋－＠]))/u, "'").replaceAll('"', '""') + '"';
  return [SHEET_HEADERS, ...apps.map((app) => [...trackerRow(app), ''])].map((row) => row.map(escape).join(',')).join('\r\n') + '\r\n';
}
