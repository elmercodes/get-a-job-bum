import {
  approvedRecords, answerType, emptyEvidence, inspectDuplicates, newRecord,
  safeText, STANDARD_KEYS, validateRecord,
} from './evidence-model.js';
import { makeMatcher, profileSkillsInJD, techTermsInJD } from './keywords.js';

export function legacyContact(profile) {
  const { personal = {}, links = {} } = profile;
  return {
    ...personal,
    legalName: profile.name || '', preferredName: personal.preferredName || '',
    location: profile.location, headline: profile.headline, summary: profile.summary,
    emails: profile.email ? [profile.email] : [], phones: profile.phone ? [profile.phone] : [],
    linkedin: links.linkedin, portfolio: links.portfolio, github: links.github,
    websites: links.other || [],
  };
}

export function migrateProfile(profile, { approvedFixture = false } = {}) {
  const evidence = emptyEvidence();
  evidence.revision = 1;
  const migration = evidence.migration = { sourceVersion: 1, omitted: 0, duplicates: 0, requiresReview: !approvedFixture, rawSourceRetained: false };
  const provenance = { kind: 'legacy' };
  function insert(kind, data) {
    try {
      const clean = validateRecord(kind, data, { migration: true });
      if (!Object.keys(clean).length) return null;
      const record = newRecord(kind, clean, provenance, approvedFixture ? 'approved' : 'pending');
      const { duplicate, conflicts } = inspectDuplicates(evidence.records, record);
      if (duplicate) { migration.duplicates++; return duplicate; }
      if (conflicts.length) {
        record.status = 'conflict';
        record.conflicts = conflicts;
        delete record.approvedAt;
      }
      evidence.records.push(record);
      return record;
    } catch {
      migration.omitted++;
      return null;
    }
  }
  // Legacy raw resume text has unknown provenance and can contain restricted identifiers.
  // Import the original resume separately if the applicant wants to retain it.
  const contact = legacyContact(profile);
  try { insert('contact', contact); } catch { migration.omitted++; }
  for (const [key, value] of Object.entries(profile.answers || {})) {
    if (typeof value === 'string' && value && STANDARD_KEYS.includes(key)) insert('standard', { key, value });
  }
  for (const role of profile.experience || []) {
    const employment = insert('employment', role);
    for (const bullet of role.bullets || []) insert('accomplishment', { original: bullet, refs: employment ? [employment.id] : [] });
  }
  for (const project of profile.projects || []) {
    const record = insert('project', project);
    for (const bullet of project.bullets || []) insert('accomplishment', { original: bullet, refs: record ? [record.id] : [] });
  }
  for (const item of profile.education || []) insert('education', {
    ...item, details: Array.isArray(item.details) ? item.details.join('\n') : item.details,
  });
  for (const group of profile.skills || []) {
    for (const name of group.items || []) insert('skill', { name, category: group.category });
  }
  for (const original of profile.achievements || []) insert('accomplishment', { original });
  for (const name of profile.certifications || []) insert('certification', { name });
  for (const name of (profile.personal?.languages || '').split(/[,;/]/).map((x) => x.trim()).filter(Boolean)) insert('language', { name });
  for (const [question, item] of Object.entries(profile.answerBank || {})) {
    if (item?.value !== undefined) insert('answer', { question, response: item.value, answerType: answerType(item.type) || 'text', scope: 'global' });
  }
  for (const [kind, name] of Object.entries(profile.documents || {})) {
    if (['photo', 'marksheet10', 'marksheet12', 'degree', 'transcript'].includes(kind) && typeof name === 'string' && /^[\w.-]+\.(pdf|png|jpe?g)$/i.test(name)) evidence.documents[kind] = name;
  }
  return evidence;
}

function groupSkills(records) {
  const groups = new Map();
  for (const { data } of records) {
    const category = data.category || 'Skills';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(data.name);
  }
  return [...groups].map(([category, items]) => ({ category, items }));
}

export function profileProjection(evidence) {
  const approved = approvedRecords(evidence);
  const kind = (name) => approved.filter((r) => r.kind === name);
  const contact = kind('contact')[0]?.data || {};
  const statements = kind('accomplishment');
  const related = (id) => statements.filter((r) => r.data.refs?.includes(id)).map((r) => r.data.original);
  return {
    evidenceRevision: evidence.revision,
    name: contact.legalName || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.preferredName || '',
    email: contact.emails?.[0] || '',
    phone: contact.phones?.[0] || '',
    location: contact.location || [contact.city, contact.state, contact.country].filter(Boolean).join(', '),
    headline: contact.headline || '',
    summary: contact.summary || '',
    links: { linkedin: contact.linkedin || '', github: contact.github || '', portfolio: contact.portfolio || '', other: contact.websites || [] },
    personal: {
      ...Object.fromEntries(['dateOfBirth', 'preferredName', 'middleName', 'firstName', 'lastName', 'addressLine1', 'addressLine2', 'city',
        'state', 'postalCode', 'country', 'currentAddressLine1', 'currentCity', 'currentState', 'currentPostalCode',
        'graduationDate', 'graduationYear', 'pronouns'].map((key) => [key, contact[key] || ''])),
      languages: kind('language').map((r) => r.data.name).join(', '),
    },
    languageEvidence: kind('language').map((r) => ({ ...r.data, evidenceId: r.id })),
    answers: Object.fromEntries(kind('standard').map((r) => [r.data.key, r.data.value])),
    answerBank: {},
    docs: {},
    documents: evidence.documents,
    sourceFiles: evidence.sources.map((source) => source.name),
    experience: kind('employment').map((r) => ({
      ...r.data, bullets: [...(r.data.responsibilities || []), ...related(r.id)], evidenceId: r.id,
    })),
    education: kind('education').map((r) => ({
      ...r.data, details: r.data.details ? r.data.details.split('\n') : [], evidenceId: r.id,
    })),
    projects: kind('project').map((r) => ({ ...r.data, bullets: related(r.id), evidenceId: r.id })),
    certifications: kind('certification').map((r) => r.data.name),
    achievements: statements.filter((r) => !r.data.refs?.length).map((r) => r.data.original),
    skills: groupSkills(kind('skill')),
  };
}

export function selectEvidence(evidence, description, limit = 500) {
  const matches = makeMatcher(description);
  const relevant = approvedRecords(evidence).filter(({ kind }) => !['contact', 'answer', 'standard'].includes(kind));
  const stats = relevant.map((record) => {
    const candidate = [record.data.name, record.data.title, ...(record.data.skills || []),
      ...(record.data.tags || []), ...(record.data.technologies || [])];
    return { record, score: [...new Set(candidate.filter(Boolean))].filter(matches).length };
  });
  stats.sort((a, b) => b.score - a.score);
  return stats.slice(0, limit).map(({ record, score }) => ({ ...record, score }));
}

/** Local extractive variant. Preserve original statements, roles, quantities, and skill names. */
export function tailorFromEvidence(evidence, job) {
  const source = profileProjection(evidence);
  const ranked = selectEvidence(evidence, job.description);
  const selected = new Set();
  const bullets = (id) => ranked.filter((r) => r.kind === 'accomplishment' &&
    (id ? r.data.refs?.includes(id) : !r.data.refs?.length)).slice(0, 5).map((r) => {
    selected.add(r.id);
    return r.data.original;
  });
  const resume = {
    ...source,
    experience: source.experience.map((r) => ({
      ...r, bullets: [...bullets(r.evidenceId), ...(r.responsibilities || [])].slice(0, 5),
    })),
    projects: source.projects.map((r) => ({ ...r, bullets: bullets(r.evidenceId) })),
    achievements: bullets(null),
  };
  delete resume.documents;
  delete resume.personal;
  delete resume.answers;
  delete resume.answerBank;
  delete resume.sourceFiles;
  delete resume.docs;
  const covered = profileSkillsInJD(resume, job.description);
  const has = makeMatcher(JSON.stringify(resume));
  const missing = techTermsInJD(job.description).filter((term) => !has(term));
  const evidenceIds = approvedRecords(evidence).filter((r) =>
    !['answer', 'standard'].includes(r.kind) && (r.kind !== 'accomplishment' || selected.has(r.id))).map((r) => r.id);
  return { resume, evidenceIds, changes: [], keywords: { covered, missing, gapFilled: [], total: covered.length + missing.length },
    matchScore: null, missingKeywords: missing };
}
