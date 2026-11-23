import { randomUUID } from 'node:crypto';
import policy from '../../extension/application-policy.js';

export class EvidenceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const CONTACT = 'legalName preferredName firstName lastName middleName location headline summary dateOfBirth addressLine1 addressLine2 city state postalCode country currentAddressLine1 currentCity currentState currentPostalCode graduationDate graduationYear pronouns';
export const STANDARD_KEYS = 'workAuthorization needsSponsorship willingToRelocate noticePeriod expectedSalary currentSalary currentLocation earliestStartDate yearsOfExperience currentlyEmployed isFresher noticeDays expectedSalaryAnnual currentSalaryAnnual howDidYouHear jobTypes workMode targetRoles availability timezone overlapPst hourlyRate employmentType firstLocationPreference secondLocationPreference thirdLocationPreference cgpaScale currentCGPA activeBacklogs computerScienceFundamentals governmentEmployee extra'.split(' ');
const field = (key, type = 'text', required = false) => ({ key, type, required });
const textFields = (keys) => keys.split(' ').map((key) => field(key));
export const RECORD_FIELDS = Object.freeze({
  contact: [...textFields(CONTACT), field('emails', 'emailList'), field('phones', 'list'), field('websites', 'urlList'), field('linkedin', 'url'), field('portfolio', 'url'), field('github', 'url')],
  employment: [field('company', 'text', true), field('title', 'text', true), ...textFields('employmentType location start end'), field('responsibilities', 'list'), field('technologies', 'list')],
  accomplishment: [field('original', 'text', true), field('context'), field('skills', 'list'), field('tags', 'list'), field('metrics', 'metrics'), field('refs', 'refs')],
  skill: [field('name', 'text', true), ...textFields('category proficiency'), field('refs', 'refs')],
  education: [field('school', 'text', true), ...textFields('degree field location start end gpa details')],
  project: [field('name', 'text', true), field('description'), field('technologies', 'list'), field('url', 'url')],
  certification: [field('name', 'text', true), ...textFields('issuer issued expires'), field('url', 'url')],
  language: [field('name', 'text', true), field('proficiency')],
  standard: [field('key', 'text', true), field('value', 'text', true)],
  answer: [field('question', 'text', true), field('answerType', 'text', true), field('response', 'response', true),
    field('scope', 'text', true), ...textFields('scopeValue country employmentType expiresOn qualifier')],
});

export const STATUSES = ['pending', 'approved', 'conflict', 'ai_suggested', 'rejected', 'archived'];
export const emptyEvidence = () => ({ schemaVersion: 2, revision: 0, records: [], sources: [], documents: {} });

const privateText = /(?:\b(?:password|passcode|ssn|social security|passport number|national id|government id|identity document number|aadhaar|pan (?:card|number)|driver'?s? license number|credit card|api key|access token)\b\s*(?:is|[:=#])\s*\S)|(?:\b\d{3}-\d{2}-\d{4}\b)|(?:\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{25,})\b)/i;
export function safeText(value, limit = 3000) {
  if (typeof value !== 'string' || value.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) || privateText.test(value)) {
    throw new EvidenceError('A field is invalid, too long, or contains a restricted identifier');
  }
  return value.trim();
}

function urlValue(value) {
  const text = safeText(value, 2048);
  if (!text) return '';
  const url = URL.canParse(text) ? new URL(text) : null;
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      [...url.searchParams.keys()].some((key) => /(?:token|secret|password|api[-_]?key)/i.test(key))) {
    throw new EvidenceError('Enter an HTTP or HTTPS URL without credentials');
  }
  return url.href;
}

function listValue(list, map) {
  if (!Array.isArray(list) || list.length > 60) throw new EvidenceError('Enter a list of up to 60 values');
  return list.map(map).filter(Boolean);
}

function metricsValue(items) {
  return listValue(items, (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['value', 'unit', 'label'].includes(key))) {
      throw new EvidenceError('Use metric objects with value, unit, and label');
    }
    const value = safeText(item.value, 80);
    if (!/^[+-]?\d+(?:[.,]\d+)*$/.test(value)) throw new EvidenceError('Use the original number as text and put units in the unit field');
    return { value, unit: safeText(item.unit || '', 80), label: safeText(item.label || '', 160) };
  });
}

const normal = (value) => policy.normalize(value).toLowerCase().replace(/[?!.]+$/, '').trim();
const months = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
function dateParts(value) {
  const iso = value.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (iso) {
    const [, y, m = '01', d = '01'] = iso;
    const date = new Date(y + '-' + m + '-' + d + 'T00:00:00Z');
    return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === y + '-' + m + '-' + d ? [y, iso[2], iso[3]] : null;
  }
  const month = value.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  const index = month ? months.indexOf(month[1].slice(0, 3).toLowerCase()) : -1;
  return index >= 0 ? [month[2], String(index + 1).padStart(2, '0')] : null;
}

function dateKey(value, edges = 'start') {
  if (/^(?:present|current|ongoing)$/i.test(value)) return '9999-12-31';
  const parts = dateParts(value);
  if (!parts) return '';
  const [year, month, day] = parts;
  return [year, month || (edges === 'start' ? '01' : '12'), day || (edges === 'start' ? '01' : '31')].join('-');
}

const aliases = new Map([
  ['when can you start', 'earliest start date'],
  ['what is your earliest start date', 'earliest start date'],
  ['earliest start date', 'earliest start date'],
  ['how should we contact you', 'preferred contact method'],
  ['what is your preferred contact method', 'preferred contact method'],
  ['preferred contact method', 'preferred contact method'],
]);

export const questionKey = (value) => {
  const key = normal(value).replace(/\s*[*✱]+\s*$/, '').replace(/[?!.]+$/, '').trim();
  return aliases.get(key) || key;
};

export function answerType(type) {
  if (['select', 'dropdown', 'radio', 'combobox'].includes(type)) return 'choice';
  if (['text', 'textarea', 'email', 'tel', 'url'].includes(type)) return 'text';
  if (['number', 'range'].includes(type)) return 'number';
  if (['checkbox', 'switch'].includes(type)) return 'boolean';
  if (['date', 'month'].includes(type)) return 'date';
  return '';
}

export function rememberable(question, type = 'text') {
  const semantic = policy.classify({ label: question, type });
  if (/password|government identifier|identity document|passport number|driver'?s? license number|national insurance number|verification code|social security|national id|access token|api key/i.test(question)) return false;
  return semantic === 'ordinary' || (semantic === 'sensitive' && /\b(relocat\w*|salary|compensation)\b/i.test(question));
}

function validateAnswer(data) {
  if (!['text', 'choice', 'number', 'boolean', 'date'].includes(data.answerType) || !rememberable(data.question, data.answerType === 'boolean' ? 'checkbox' : data.answerType === 'choice' ? 'select' : data.answerType)) {
    throw new EvidenceError('This question requires direct entry on the application page');
  }
  if (!['global', 'site', 'employer', 'job'].includes(data.scope)) throw new EvidenceError('Choose global, site, employer, or job scope');
  const conditional = /\b(relocat\w*|salary|compensation|notice|availability|sponsor\w*|this (?:job|role|company|employer)|here)\b/i.test(data.question);
  if (conditional && data.scope === 'global') throw new EvidenceError('Choose a narrower scope for a context-dependent answer');
  if (data.scope !== 'global' && !data.scopeValue) throw new EvidenceError('Set the scope value');
  if (data.scope === 'site') data.scopeValue = new URL(urlValue(data.scopeValue)).origin;
  if (data.scope === 'job') data.scopeValue = urlValue(data.scopeValue).split('#')[0];
  if (data.expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(data.expiresOn) || !dateParts(data.expiresOn))) throw new EvidenceError('Use a valid expiration date');
  if (data.answerType === 'boolean' && typeof data.response !== 'boolean') throw new EvidenceError('Choose true or false');
  if (data.answerType !== 'boolean' && typeof data.response !== 'string') throw new EvidenceError('Enter the response as text');
  if (data.answerType === 'number' && !/^-?\d+(?:\.\d+)?$/.test(data.response)) throw new EvidenceError('Enter a numeric response');
  if (data.answerType === 'date' && (!/^\d{4}-(?:0[1-9]|1[0-2])(?:-\d{2})?$/.test(data.response) || !dateParts(data.response))) throw new EvidenceError('Use an ISO date or month');
  return data;
}

export function validateRecord(kind, input, { migration = false } = {}) {
  const fields = RECORD_FIELDS[kind];
  if (!Object.hasOwn(RECORD_FIELDS, kind) || !input || typeof input !== 'object' || Array.isArray(input)) throw new EvidenceError('Unknown record type or invalid fields');
  if (!migration && Object.keys(input).some((key) => !fields.some((spec) => spec.key === key))) throw new EvidenceError('An unsupported field was supplied');
  const data = {};
  for (const spec of fields) {
    let value = input[spec.key];
    if (value === undefined || value === '' || value === null) {
      if (spec.required) throw new EvidenceError('Complete the required fields');
      continue;
    }
    switch (spec.type) {
      case 'metrics': value = metricsValue(value); break;
      case 'refs':
      case 'list': value = listValue(value, (entry) => safeText(entry, spec.type === 'refs' ? 36 : 3000)); break;
      case 'urlList': value = listValue(value, urlValue); break;
      case 'emailList':
        value = listValue(value, (entry) => safeText(entry, 254));
        if (value.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(email))) throw new EvidenceError('Enter a valid email address');
        break;
      case 'url': value = urlValue(value); break;
      case 'response': value = typeof value === 'boolean' ? value : safeText(value, 1600); break;
      default: value = safeText(value);
    }
    if (spec.required && value === '') throw new EvidenceError('Complete the required fields');
    data[spec.key] = value;
  }
  if (kind === 'contact' && data.dateOfBirth && (!/^\d{4}-\d{2}-\d{2}$/.test(data.dateOfBirth) || !dateParts(data.dateOfBirth))) throw new EvidenceError('Enter a valid date of birth');
  if (kind === 'employment' || kind === 'education') {
    const start = dateKey(data.start || '');
    const end = dateKey(data.end || '', 'end');
    if (start > end && end) throw new EvidenceError('End date precedes start date', 409);
    if (!migration && ((data.start && (!start || start === '9999-12-31')) || (data.end && !end))) {
      throw new EvidenceError('Use a year, a month and year, an ISO date, or Present as an end date');
    }
  }
  if (kind === 'standard' && !STANDARD_KEYS.includes(data.key)) throw new EvidenceError('Unknown standard applicant field');
  if (kind === 'answer') return validateAnswer(data);
  return data;
}

function identity(record) {
  const { kind, data } = record;
  if (kind === 'contact') return kind;
  if (kind === 'employment') return [kind, normal(data.company), normal(data.title)].join('|');
  if (kind === 'education') return [kind, normal(data.school), normal(data.degree), normal(data.field)].join('|');
  if (kind === 'answer') return [kind, questionKey(data.question), data.answerType, data.scope, normal(data.scopeValue), normal(data.country), normal(data.employmentType), normal(data.qualifier), data.expiresOn || ''].join('|');
  return [kind, normal(data.key || data.name || data.original), ...(kind === 'accomplishment' ? [...(data.refs || [])].sort() : [])].join('|');
}

const active = (record) => record.status !== 'rejected' && record.status !== 'archived';

export function inspectDuplicates(records, candidate) {
  const possible = records.filter((record) => record.id !== candidate.id && active(record) && identity(record) === identity(candidate));
  const duplicates = possible.filter((record) => {
    if (candidate.kind === 'answer') return record.data.response === candidate.data.response;
    return JSON.stringify(record.data) === JSON.stringify(candidate.data);
  });
  const conflicts = possible.filter((record) => {
    if (duplicates.includes(record)) return false;
    if (!['employment', 'education'].includes(candidate.kind)) return true;
    const first = dateKey(record.data.start || '');
    const second = dateKey(candidate.data.start || '');
    if (!first || !second || first === second) return true;
    const firstEnd = dateKey(record.data.end || '', 'end') || '9999-12-31';
    const secondEnd = dateKey(candidate.data.end || '', 'end') || '9999-12-31';
    return first <= secondEnd && second <= firstEnd;
  });
  return { duplicate: duplicates[0], conflicts: conflicts.map((record) => record.id) };
}

export function verifyRefs(records, data, kind, id) {
  const refs = data.refs || [];
  if (new Set(refs).size !== refs.length) throw new EvidenceError('Remove duplicate evidence links');
  const allowed = kind === 'skill' ? ['employment', 'education', 'project', 'accomplishment'] : ['employment', 'project'];
  if (refs.some((ref) => ref === id || !records.some((r) => r.id === ref && allowed.includes(r.kind) && active(r)))) {
    throw new EvidenceError('Select valid supporting records');
  }
}

export function newRecord(kind, data, provenance, status = 'pending') {
  const now = new Date().toISOString();
  return { id: randomUUID(), kind, data, provenance, status, createdAt: now, updatedAt: now, ...(status === 'approved' ? { approvedAt: now } : {}) };
}

export function approvedRecords(evidence) {
  let approved = evidence.records.filter((record) => record.status === 'approved');
  // A retired parent also withdraws facts associated with it.
  for (;;) {
    const ids = new Set(approved.map((record) => record.id));
    const next = approved.filter((record) => (record.data.refs || []).every((id) => ids.has(id)));
    if (next.length === approved.length) return next;
    approved = next;
  }
}

export function matchAnswer(records, field, context, today = new Date().toISOString().slice(0, 10)) {
  const type = answerType(field.type);
  if (!type || field.entry || !rememberable(field.label, field.type)) return null;
  const label = questionKey(field.label);
  const url = URL.canParse(context?.url || '') ? new URL(context.url) : null;
  const matching = records.filter(({ kind, data, status }) => {
    if (kind !== 'answer' || status !== 'approved' || data.answerType !== type || questionKey(data.question) !== label ||
        normal(data.qualifier) !== normal(field.help) ||
        (data.expiresOn && data.expiresOn < today) ||
        (data.country && normal(data.country) !== normal(context?.country)) ||
        (data.employmentType && normal(data.employmentType) !== normal(context?.employmentType))) return false;
    if (type === 'choice' && !field.options?.some((option) => normal(option) === normal(data.response))) return false;
    if (type === 'date' && (field.type === 'month' ? data.response.length !== 7 : data.response.length !== 10)) return false;
    return data.scope === 'global' ||
      (data.scope === 'site' && data.scopeValue === url?.origin) ||
      (data.scope === 'job' && data.scopeValue === url?.href.split('#')[0]) ||
      (data.scope === 'employer' && !!context?.employer && normal(data.scopeValue) === normal(context.employer));
  });
  if (!matching.length) return null;
  if (new Set(matching.map((record) => record.data.response)).size > 1) return { conflict: true };
  const record = matching[0];
  const value = type === 'choice' ? field.options.find((option) => normal(option) === normal(record.data.response)) : record.data.response;
  return { id: record.id, value };
}
