import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { followUpDate, migrateTracker, samePosting, trackerUrl } from './tracker-schema.js';

import { DATA_DIR, RESUME_DIR, DOCS_DIR, readJSON as read, writeJSON } from './storage.js';
import { loadEvidence, updateDocument } from './evidence-store.js';
import { profileProjection } from './evidence-profile.js';

export { DATA_DIR, RESUME_DIR, DOCS_DIR, writeJSON };
const APPS = path.join(DATA_DIR, 'applications.json');

// Answers to the questions almost every application asks. The user edits these
// once in the side panel; the AI uses them instead of guessing.
export const DEFAULT_ANSWERS = {
  workAuthorization: '',
  needsSponsorship: '',
  willingToRelocate: '',
  noticePeriod: '',
  expectedSalary: '',
  currentSalary: '',
  currentLocation: '',
  earliestStartDate: '',
  yearsOfExperience: '',
  currentlyEmployed: '',
  isFresher: '',
  noticeDays: '',
  expectedSalaryAnnual: '',
  currentSalaryAnnual: '',
  gender: 'Decline to self-identify',
  race: 'Decline to self-identify',
  veteranStatus: 'I am not a protected veteran',
  disabilityStatus: 'I do not wish to answer',
  howDidYouHear: 'Company website',
  jobTypes: '',
  workMode: '',
  targetRoles: '',
  availability: '',
  timezone: '',
  overlapPst: '',
  hourlyRate: '',
  employmentType: '',
  firstLocationPreference: '',
  secondLocationPreference: '',
  thirdLocationPreference: '',
  cgpaScale: '',
  currentCGPA: '',
  activeBacklogs: '',
  computerScienceFundamentals: '',
  governmentEmployee: '',
  extra: '',
};

// Details that forms ask for but resumes don't contain.
export const DEFAULT_PERSONAL = {
  dateOfBirth: '', // YYYY-MM-DD
  gender: '',
  nationality: '',
  fatherName: '',
  motherName: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  // Where you live now, when it differs from the permanent address above (hostel / rented flat in another city).
  currentAddressLine1: '',
  currentCity: '',
  currentState: '',
  currentPostalCode: '',
  graduationYear: '',
  graduationDate: '', // e.g. May 2027
  placeOfBirth: '',
  languages: '',
  pronouns: '',
  maritalStatus: '',
  schooling: [], // [{ level, school, board, year, percentage }]
};

const write = writeJSON;

export function backupData() {
  const root = path.join(DATA_DIR, 'backups');
  const dir = path.join(root, new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['profile.json', 'applications.json', 'skill-gaps.json']) if (fs.existsSync(path.join(DATA_DIR, f))) fs.copyFileSync(path.join(DATA_DIR, f), path.join(dir, f));
  for (const old of fs.readdirSync(root).sort().slice(0, -7)) fs.rmSync(path.join(root, old), { recursive: true, force: true });
}

export function getProfile() {
  const evidence = loadEvidence();
  return evidence.records.length || Object.keys(evidence.documents).length ? profileProjection(evidence) : null;
}

// ---------- application tracker ----------
// The tracker owns application identity and status history.
export const STATUSES = ['saved', 'prepared', 'submission_unverified', 'applied', 'assessment', 'interview1', 'interview2', 'interview3', 'hr', 'offer', 'accepted', 'rejected', 'withdrawn'];

function readApplications() {
  const apps = read(APPS, []);
  if (migrateTracker(apps)) write(APPS, apps);
  return apps;
}

function touch(app, now = new Date().toISOString()) {
  app.updatedAt = now;
  app.revision++;
}

export function upsertApplication(entry) {
  const apps = readApplications();
  const now = new Date().toISOString();
  const status = STATUSES.includes(entry.status) ? entry.status : 'saved';
  let app = entry.id ? apps.find((a) => a.id === entry.id) : !entry.separate && apps.find((a) => samePosting(a, entry));
  if (!app) {
    const id = randomUUID();
    app = { id, applicationId: id, revision: 0, createdAt: now, history: [], notes: '' };
    apps.unshift(app);
  }
  const { id, applicationId, history, separate, ...fields } = entry;
  // Saving a job for later never downgrades one you already applied to.
  const keepStatus = (['saved', 'prepared'].includes(status) && app.status && !['saved', 'prepared'].includes(app.status)) ||
    (status === 'saved' && app.status === 'prepared') || app.status === 'submission_unverified';
  Object.assign(app, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== '')), { status: keepStatus ? app.status : status, updatedAt: now });
  if (!keepStatus && app.history.at(-1)?.status !== app.status) app.history.push({ status: app.status, at: now });
  touch(app, now);
  write(APPS, apps);
  return app;
}

// Extra things kept on an application (follow-up draft, prep brief) without touching its status or history.
export function saveAppExtra(id, extra) {
  const apps = readApplications();
  const app = apps.find((a) => a.id === id);
  if (!app) return null;
  Object.assign(app, extra);
  touch(app);
  write(APPS, apps);
  return app;
}

export function updateApplication(id, patch) {
  const apps = readApplications();
  const app = apps.find((a) => a.id === id);
  if (!app) return null;
  const now = new Date().toISOString();
  if (app.status !== 'submission_unverified' && patch.status && STATUSES.includes(patch.status) && patch.status !== app.status) {
    app.status = patch.status;
    app.history.push({ status: patch.status, at: now });
  }
  for (const k of ['notes', 'title', 'company', 'url', 'location', 'contact']) if (k in patch) app[k] = patch[k];
  // An email that moved (or confirmed) this application: kept so it's never applied twice, and shown on the card.
  if (patch.mail?.id && !(app.mail || []).some((m) => m.id === patch.mail.id)) {
    app.mail = [...(app.mail || []), patch.mail].slice(-20);
    if (app.history.at(-1)) app.history.at(-1).source = patch.status ? `email: ${String(patch.mail.subject || '').slice(0, 80)}` : app.history.at(-1).source;
  }
  if (patch.status === 'rejected' && patch.mail) app.rejectedAt = patch.mail.date || now;
  if ('followUpDate' in patch) app.followUpDate = followUpDate(patch.followUpDate);
  touch(app, now);
  write(APPS, apps);
  return app;
}

export function deleteApplication(id) {
  write(APPS, readApplications().filter((app) => app.id !== id));
}

export const listApplications = readApplications;

export function recordPreparedResume({ id, job, createdAt }) {
  if (!job?.title && !job?.company && !job?.url) return null;
  const existing = readApplications().find((app) => samePosting(app, job));
  if (existing?.resumeVersion === id || (existing?.resumePreparedAt && existing.resumePreparedAt >= createdAt)) return existing;
  const { title, company, location, url } = job;
  return upsertApplication({ id: existing?.id, title, company, location, url, status: 'prepared',
    preparedAt: existing?.preparedAt || createdAt, resumePreparedAt: createdAt, resumeVersion: id });
}

export function confirmManualApplication(id) {
  const apps = readApplications();
  const record = apps.find((app) => app.id === id);
  if (!record || record.submissionAttemptedAt || record.verifiedAt) return null;
  const now = new Date().toISOString();
  record.appliedAt ||= now;
  record.verifiedAt = now;
  record.verification = 'user_confirmed';
  if (['saved', 'prepared', 'submission_unverified'].includes(record.status)) {
    record.status = 'applied';
    record.history.push({ status: 'applied', at: now });
  }
  touch(record, now);
  write(APPS, apps);
  return record;
}

export const logApplication = (entry) => upsertApplication({ ...entry, status: entry.status || 'applied' });

// Photo / signature etc. live in data/documents; the profile stores the file name per kind.
export function getDocument(kind) {
  const name = getProfile()?.documents?.[kind];
  if (!name) return null;
  const file = path.join(DOCS_DIR, path.basename(name));
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(file).toLowerCase();
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' }[ext] || 'application/octet-stream';
  return { filename: path.basename(file), mime, base64: fs.readFileSync(file).toString('base64') };
}

export const DOCUMENT_KINDS = ['photo', 'signature', 'marksheet10', 'marksheet12', 'idProof', 'addressProof', 'panCard', 'degree', 'transcript'];

// Store one document (replaces the previous file of that kind).
export function saveDocument(kind, originalName, buffer) {
  if (!DOCUMENT_KINDS.includes(kind)) throw new Error('Unknown document type');
  const ext = (path.extname(originalName || '').toLowerCase().match(/^\.(pdf|png|jpe?g)$/) || [])[0];
  if (!ext) throw new Error('Use a PDF, PNG or JPG file');
  const p = getProfile();
  if (!p) throw new Error('Import your resume first');
  const old = p.documents[kind];
  if (old) fs.rmSync(path.join(DOCS_DIR, path.basename(old)), { force: true });
  const name = `${kind}${ext}`;
  fs.writeFileSync(path.join(DOCS_DIR, name), buffer);
  updateDocument(kind, name);
  return name;
}
export function removeDocument(kind) {
  const p = getProfile();
  if (!p?.documents?.[kind]) return;
  fs.rmSync(path.join(DOCS_DIR, path.basename(p.documents[kind])), { force: true });
  updateDocument(kind, null);
}

// ---------- skill-gap journal ----------
// Every tailored job records the keywords the candidate doesn't have yet: the raw material for the
// skill-gap heatmap and the learning plan (/api/upskill).
const GAPS = path.join(DATA_DIR, 'skill-gaps.json');
export function recordGaps(entry) {
  const list = read(GAPS, []);
  const key = `${entry.company || ''}|${entry.title || ''}`.toLowerCase();
  const rec = { ...entry, at: new Date().toISOString() };
  const i = list.findIndex((g) => `${g.company || ''}|${g.title || ''}`.toLowerCase() === key);
  if (i >= 0) list[i] = { ...list[i], ...rec };
  else list.unshift(rec);
  write(GAPS, list.slice(0, 300));
}
export const listGaps = () => read(GAPS, []);
export const saveGaps = (list) => write(GAPS, list);

// Remembered answers, keyed by the normalised question text.
export const bankKey = (label) =>
  String(label || '')
    .toLowerCase()
    .replace(/\*|\(required\)|\(optional\)/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

// A click lease is consumed before the extension interacts with the employer page.
// The recorded attempt survives process restarts and ambiguous browser outcomes.
export function prepareSubmission({ nonce, url, snapshot, label, job }) {
  const submitted = readApplications();
  const identity = trackerUrl(job?.url || url);
  const portal = trackerUrl(url);
  if (!identity || !portal) return null;
  const matches = submitted.filter((item) => trackerUrl(item.url) === identity || trackerUrl(item.portalUrl) === portal);
  if (matches.some((item) => item.submissionAttemptedAt || item.appliedAt || item.status === 'applied')) return null;
  const existing = matches.find((item) => samePosting(item, { ...job, url: identity }) || item.portalUrl === url) ||
    (!job?.title && !job?.company && matches.length === 1 ? matches[0] : undefined);
  if (!existing && !job?.title && matches.length > 1) return null;
  const record = upsertApplication({
    id: existing?.id, url: identity, title: job?.title, company: job?.company, status: 'prepared', via: 'portal',
    portalUrl: url, preparedAt: new Date().toISOString(),
    submissionReview: { nonce, snapshot, label, expires: Date.now() + 10 * 60_000 },
  });
  return { id: record.id, preparedAt: record.preparedAt };
}

export function authorizeSubmission(id, details) {
  const applications = readApplications();
  const record = applications.find((item) => item.id === id);
  const review = record?.submissionReview;
  if (!record || record.submissionAttemptedAt || record.status !== 'prepared' ||
      !review || review.expires < Date.now() || record.portalUrl !== details.url ||
      review.nonce !== details.nonce || review.snapshot !== details.snapshot) return null;
  delete record.submissionReview;
  record.submissionAttemptedAt = record.updatedAt = new Date().toISOString();
  record.status = 'submission_unverified';
  touch(record);
  record.history.push({ status: record.status, at: record.updatedAt });
  write(APPS, applications);
  return { nonce: review.nonce, snapshot: review.snapshot, url: record.portalUrl, expires: Date.now() + 10_000 };
}

export function settleSubmission(id, evidence) {
  const applications = readApplications();
  const record = applications.find((item) => item.id === id);
  if (!record?.submissionAttemptedAt || record.status !== 'submission_unverified') return null;
  const now = new Date().toISOString();
  if (evidence.clicked) record.submittedAt ||= now;
  if (evidence.receipt || evidence.manuallyConfirmed) {
    record.submittedAt ||= now;
    record.verifiedAt = now;
    record.appliedAt = record.submittedAt;
    record.status = 'applied';
    record.verification = evidence.receipt ? 'portal_receipt' : 'user_confirmed';
    record.history.push({ status: record.status, at: now });
  }
  touch(record, now);
  write(APPS, applications);
  return { status: record.status, submittedAt: record.submittedAt, verifiedAt: record.verifiedAt };
}
