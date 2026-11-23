import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DATA_DIR, DOCS_DIR, readJSON, writeJSON } from './storage.js';
import {
  approvedRecords, emptyEvidence, EvidenceError, inspectDuplicates, newRecord, safeText,
  STANDARD_KEYS, validateRecord, verifyRefs,
} from './evidence-model.js';
import { legacyContact, migrateProfile } from './evidence-profile.js';
import { extractResumeProfile } from './vendor/resume-extraction.js';

const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');
const SOURCE_DIR = path.join(DATA_DIR, 'evidence-sources');
const identifier = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function loadEvidence() {
  const data = readJSON(PROFILE_FILE, null);
  if (!data) return emptyEvidence();
  if (data.schemaVersion === undefined) {
    if (typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.skills)) {
      throw new EvidenceError('The legacy profile is unreadable. Restore it from a private backup.', 409);
    }
    const migrated = migrateProfile(data);
    writeJSON(PROFILE_FILE, migrated);
    return migrated;
  }
  if (data.schemaVersion !== 2 || !Number.isSafeInteger(data.revision) || !Array.isArray(data.records) ||
      !Array.isArray(data.sources) || !data.documents || typeof data.documents !== 'object') {
    throw new EvidenceError('The profile schema is unsupported. Restore a compatible private backup.', 409);
  }
  return data;
}

function checkRevision(state, revision) {
  if (state.revision !== revision) throw new EvidenceError('The profile changed. Reload it and review the latest data.', 409);
}

function persist(state) {
  state.revision++;
  writeJSON(PROFILE_FILE, state);
  return state;
}

function addCandidate(state, candidate) {
  const { duplicate, conflicts } = inspectDuplicates(state.records, candidate);
  if (duplicate) return duplicate;
  if (state.records.length >= 1500) throw new EvidenceError('Archive or delete records before adding more');
  if (conflicts.length) {
    candidate.status = 'conflict';
    candidate.conflicts = conflicts;
  }
  state.records.push(candidate);
  return candidate;
}

export function saveEvidenceRecord({ id, kind, data, revision, decision, replace }) {
  const state = loadEvidence();
  checkRevision(state, revision);
  const old = id && state.records.find((item) => item.id === id);
  if (id && !old) throw new EvidenceError('Record not found', 404);
  if (old && old.kind !== kind) throw new EvidenceError('Record type cannot change');
  if (!['draft', 'approve', 'reject', 'archive'].includes(decision)) throw new EvidenceError('Choose a review decision');
  if (['reject', 'archive'].includes(decision)) {
    if (!old) throw new EvidenceError('Choose a saved record');
    old.status = decision === 'reject' ? 'rejected' : 'archived';
    old.updatedAt = new Date().toISOString();
    delete old.approvedAt;
    return { state: persist(state), record: old };
  }
  const clean = validateRecord(kind, data);
  verifyRefs(state.records, clean, kind, id);
  if (decision === 'approve') {
    const approved = new Set(approvedRecords(state).map((record) => record.id));
    if ((clean.refs || []).some((ref) => !approved.has(ref))) throw new EvidenceError('Approve linked supporting records first', 409);
  }
  if (Object.keys(clean).length === 0) throw new EvidenceError('Enter at least one field');
  const now = new Date().toISOString();
  const changed = old && JSON.stringify(old.data) !== JSON.stringify(clean);
  const next = {
    ...(old || newRecord(kind, clean, { kind: 'user' })),
    data: clean, status: decision === 'approve' ? 'approved' : 'pending',
    updatedAt: now,
  };
  if (changed) next.provenance = { ...next.provenance, correctedByUser: true };
  delete next.conflicts;
  delete next.approvedAt;
  const { duplicate, conflicts } = inspectDuplicates(state.records, next);
  if (duplicate) throw new EvidenceError('An equivalent record already exists', 409);
  if (conflicts.length && decision === 'approve') {
    if (replace !== true) throw new EvidenceError('Review conflicting records and explicitly replace them', 409);
    for (const record of state.records.filter((item) => conflicts.includes(item.id))) {
      record.status = 'archived';
      record.updatedAt = now;
      delete record.approvedAt;
    }
  } else if (conflicts.length) {
    next.status = 'conflict';
    next.conflicts = conflicts;
  }
  if (next.status === 'approved') next.approvedAt = now;
  if (old) state.records[state.records.indexOf(old)] = next;
  else {
    if (state.records.length >= 1500) throw new EvidenceError('Archive or delete records before adding more');
    state.records.push(next);
  }
  return { state: persist(state), record: next };
}

export function deleteEvidenceRecord(id, revision) {
  const state = loadEvidence();
  checkRevision(state, revision);
  if (!state.records.some((r) => r.id === id)) throw new EvidenceError('Record not found', 404);
  state.records = state.records.filter((record) => record.id !== id);
  for (const record of state.records) {
    if (record.data.refs?.includes(id)) {
      record.data.refs = record.data.refs.filter((ref) => ref !== id);
      if (record.status === 'approved') record.status = 'pending';
      delete record.approvedAt;
      record.updatedAt = new Date().toISOString();
    }
    if (record.conflicts) record.conflicts = record.conflicts.filter((ref) => ref !== id);
  }
  return persist(state);
}

export function updateDocument(kind, value) {
  const state = loadEvidence();
  if (value) state.documents[kind] = value;
  else delete state.documents[kind];
  persist(state);
}

// Compatibility for the explicit "save standard details" action in earlier clients.
// Structured employment, history, answer memory, and imported data use record endpoints.
export function saveLegacyDetails(profile) {
  const state = loadEvidence();
  checkRevision(state, profile.evidenceRevision);
  const stored = state.records.find((record) => record.kind === 'contact' && record.status === 'approved')?.data;
  const input = legacyContact(profile);
  // Legacy clients edit primary contact fields. Preserve alternate values
  // authored through the full evidence editor.
  if (stored && profile.email === (stored.emails?.[0] || '')) input.emails = stored.emails || [];
  if (stored && profile.phone === (stored.phones?.[0] || '')) input.phones = stored.phones || [];
  const changes = [['contact', { ...stored, ...input }]];
  for (const [key, value] of Object.entries(profile.answers || {})) {
    if (STANDARD_KEYS.includes(key) && value !== '') changes.push(['standard', { key, value }]);
  }
  const clean = changes.map(([kind, value]) => [kind, validateRecord(kind, value, { migration: true })]);
  for (const [kind, data] of clean) {
    if (!Object.keys(data).length) continue;
    const active = state.records.find((r) => r.kind === kind && r.status === 'approved' && (kind !== 'standard' || r.data.key === data.key));
    if (!active) {
      const candidate = newRecord(kind, data, { kind: 'user' }, 'approved');
      if (inspectDuplicates(state.records, candidate).conflicts.length) throw new EvidenceError('Review competing records in Applicant evidence first', 409);
      state.records.push(candidate);
    } else if (JSON.stringify(active.data) !== JSON.stringify(data)) {
      active.data = data;
      active.updatedAt = active.approvedAt = new Date().toISOString();
      active.provenance = { ...active.provenance, correctedByUser: true };
    }
  }
  return persist(state);
}

function fileFor(source) {
  if (!identifier.test(source.id) || !['.docx', '.pdf', '.txt'].includes(source.extension)) throw new EvidenceError('Invalid source record');
  return path.join(SOURCE_DIR, source.id + source.extension);
}

export function evidenceSource(id) {
  const source = loadEvidence().sources.find((item) => item.id === id);
  if (!source || !fs.existsSync(fileFor(source))) throw new EvidenceError('Source not found', 404);
  return { source, filename: fileFor(source) };
}

export function importEvidence(files, revision) {
  const state = loadEvidence();
  checkRevision(state, revision);
  const written = [];
  const stats = { imported: 0, proposals: 0, conflicts: 0, skipped: 0, incomplete: 0 };
  fs.mkdirSync(SOURCE_DIR, { recursive: true, mode: 0o700 });
  try {
    for (const { file, text } of files) {
      const hash = createHash('sha256').update(file.buffer).digest('hex');
      if (state.sources.some((source) => source.sha256 === hash)) { stats.skipped++; continue; }
      if (state.sources.length >= 50) throw new EvidenceError('Delete an old source before importing another');
      const source = {
        id: randomUUID(), name: safeText(path.basename(file.originalname), 255),
        extension: path.extname(file.originalname).toLowerCase(), sha256: hash,
        createdAt: new Date().toISOString(),
      };
      // Documents are never sent to a parser service. Refuse detectable
      // identifiers before creating either an asset or a fact proposal.
      safeText(text.replaceAll('\f', '\n'), 150000);
      const result = extractResumeProfile(text);
      const provenance = { kind: 'import', sourceId: source.id };
      const candidate = (kind, data) => {
        try {
          const before = state.records.length;
          const record = addCandidate(state, newRecord(kind, validateRecord(kind, data, { migration: true }), provenance));
          if (state.records.length > before) {
            stats.proposals++;
            if (record.status === 'conflict') stats.conflicts++;
          }
          return record;
        } catch (error) {
          if (!(error instanceof EvidenceError) || state.records.length >= 1500) throw error;
          stats.incomplete++;
          return null;
        }
      };
      const header = Object.fromEntries(result.candidates.map(({ key, value }) => [key, value]));
      const contact = {
        ...header, legalName: header.fullName, emails: header.email ? [header.email] : [],
        phones: header.phone ? [header.phone] : [],
      };
      if (result.candidates.length) candidate('contact', contact);
      for (const role of result.structured.experiences) {
        const a = candidate('employment', { ...role, start: role.startDate, end: role.endDate });
        for (const original of role.bullets || []) candidate('accomplishment', { original, refs: a ? [a.id] : [] });
      }
      for (const entry of result.structured.education) candidate('education', {
        school: entry.institution, degree: entry.degree, field: entry.field, location: entry.location,
        start: entry.startDate, end: entry.endDate, gpa: entry.gpa, details: entry.description,
      });
      for (const name of result.structured.skills) candidate('skill', { name, category: 'Skills' });
      if (!result.structured.experiences.length && !result.structured.education.length && !result.structured.skills.length) stats.incomplete++;
      const filename = fileFor(source);
      fs.writeFileSync(filename, file.buffer, { flag: 'wx', mode: 0o600, flush: true });
      written.push(filename);
      state.sources.push(source);
      stats.imported++;
    }
    if (written.length) persist(state);
    return { state, stats };
  } catch (error) {
    for (const filename of written) fs.rmSync(filename, { force: true });
    throw error;
  }
}

export function deleteEvidenceSource(id, revision) {
  const state = loadEvidence();
  checkRevision(state, revision);
  const source = state.sources.find((item) => item.id === id);
  if (!source) throw new EvidenceError('Source not found', 404);
  state.sources = state.sources.filter((item) => item.id !== id);
  for (const record of state.records.filter((r) => r.provenance.sourceId === id)) {
    record.provenance = { kind: 'source_removed' };
    if (record.status === 'approved') record.status = 'pending';
    delete record.approvedAt;
    record.updatedAt = new Date().toISOString();
  }
  persist(state);
  fs.rmSync(fileFor(source), { force: true });
  return state;
}

export function clearEvidence(revision) {
  const state = loadEvidence();
  checkRevision(state, revision);
  const next = persist({ ...emptyEvidence(), revision });
  fs.rmSync(SOURCE_DIR, { recursive: true, force: true });
  for (const item of Object.values(state.documents)) fs.rmSync(path.join(DOCS_DIR, path.basename(item)), { force: true });
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (/^profile\.json\.[a-f0-9-]{36}\.tmp$/i.test(name)) fs.rmSync(path.join(DATA_DIR, name), { force: true });
  }
  const backups = path.join(DATA_DIR, 'backups');
  if (fs.existsSync(backups)) {
    for (const dir of fs.readdirSync(backups)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dir)) fs.rmSync(path.join(backups, dir, 'profile.json'), { force: true });
    }
  }
  return next;
}
