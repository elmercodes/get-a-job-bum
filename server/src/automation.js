import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import policy from '../../extension/application-policy.js';
import { DATA_DIR, writeJSON } from './store.js';

export const categories = ['privacy', 'legal', 'background', 'signature'];
const configPath = path.join(DATA_DIR, 'automation.json');
const hash = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const MAX_AGE = 30 * 60 * 1000;
const approvals = new Map();

function config() {
  if (!fs.existsSync(configPath)) return { preferences: {}, signature: '', verified: null };
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function settings() {
  const { preferences, signature, verified, rememberedPrivacy } = config();
  return {
    preferences, hasSignature: !!signature, profileFactsVerified: !!verified,
    rememberedPrivacyCount: Object.values(rememberedPrivacy || {}).filter((expires) => expires > Date.now()).length,
  };
}

const profileFacts = (profile) => ({ birthDate: profile?.personal?.dateOfBirth || '', email: profile?.email || '' });

export function setSettings(body, profile) {
  const current = config();
  const next = { ...current, preferences: Object.fromEntries(categories.map((key) => [key, body.preferences?.[key] === true])) };
  if (body.removeSignature === true) next.signature = '';
  if (typeof body.signature === 'string' && body.signature.trim()) {
    if (!next.preferences.signature || body.signature.length > 160 || /[\x00-\x1f]/.test(body.signature)) {
      throw new TypeError('Enter a valid, user-provided signature with signature automation enabled');
    }
    next.signature = body.signature.trim();
  }
  if (body.verifyProfile === true) next.verified = hash(profileFacts(profile));
  if (body.clearVerification === true) next.verified = null;
  if (!next.preferences.privacy || body.clearPrivacy === true) next.rememberedPrivacy = {};
  approvals.clear();
  writeJSON(configPath, next);
  return settings();
}

function verifiedAssertion(text, profile, saved) {
  const facts = profileFacts(profile);
  if (saved.verified !== hash(facts)) return false;
  if (/^(?:i (?:hereby )?(?:certify|declare|affirm|attest)(?: that) )?i am at least 18 years old[.!]?$/i.test(text)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(facts.birthDate)) return false;
    const born = new Date(facts.birthDate + 'T00:00:00Z');
    if (!Number.isFinite(+born) || born.toISOString().slice(0, 10) !== facts.birthDate) return false;
    const now = new Date();
    return facts.birthDate <= [String(now.getUTCFullYear() - 18), now.toISOString().slice(5, 10)].join('-');
  }
  const email = text.match(/^i (?:hereby )?(?:certify|declare|affirm|attest)(?: that)? my email address is ([^\s<>]+)$/i)?.[1];
  return !!email && email.toLowerCase() === facts.email.toLowerCase();
}

function supported(field, category, profile, saved) {
  const label = policy.normalize(field.label).replace(/\s*\*$/, '');
  const terms = policy.normalize(field.terms);
  if (!saved.preferences[category] || !field.required || field.incompleteTerms) return false;
  if (category === 'signature') {
    return !!saved.signature && saved.preferences.legal && field.type === 'text' && verifiedAssertion(terms, profile, saved);
  }
  if (field.type !== 'checkbox') return false;
  if (category === 'privacy') {
    return /^i (?:have read|acknowledge|have reviewed|understand|agree to|accept)(?: and (?:read|acknowledge|understand|agree to|accept))? (?:the |this )?(?:applicant )?(?:privacy (?:policy|notice|statement|information)|data protection notice)[.!]?$/i.test(label);
  }
  if (category === 'legal') return verifiedAssertion(label, profile, saved) && (!terms || terms === label);
  return category === 'background' && /\b(?:authorize|authorise|consent)\b/i.test(label) &&
    /\b(?:background (?:check|screening|investigation)|consumer report)\b/i.test(label) &&
    (field.links?.length > 0 || terms.length >= 60);
}

export function validScope(scope) {
  return typeof scope?.run === 'string' && /^[a-f0-9-]{36}$/.test(scope.run) &&
    typeof scope.url === 'string' && scope.url.length <= 2048 && /^https?:\/\//i.test(scope.url);
}

function approvalKey(scope, category, field) {
  return hash([scope.run, scope.url, field.contextUrl, category, policy.fieldEvidence(field)]);
}

function rememberKey(field) {
  if (!field.contextUrl || field.links?.length || policy.normalize(field.terms).length < 30) return null;
  const evidence = policy.fieldEvidence({ ...field, contextUrl: '' });
  return hash([new URL(field.contextUrl).origin, evidence]);
}

export function acknowledge({ scope, field, profile, remember }) {
  const category = policy.classify(field);
  const saved = config();
  if (!validScope(scope) || !categories.includes(category) || !supported(field, category, profile, saved)) return false;
  const now = Date.now();
  for (const [key, expires] of approvals) if (expires <= now) approvals.delete(key);
  if (approvals.size >= 500) return false;
  approvals.set(approvalKey(scope, category, field), now + MAX_AGE);
  const key = remember === true && category === 'privacy' ? rememberKey(field) : null;
  if (key) {
    const history = Object.entries(saved.rememberedPrivacy || {}).filter(([id, expires]) => id !== key && expires > now);
    saved.rememberedPrivacy = Object.fromEntries([...history.slice(-49), [key, now + 90 * 24 * 60 * 60 * 1000]]);
    writeJSON(configPath, saved);
  }
  return true;
}

export function disposition({ field, scope, profile, saved = config() }) {
  const category = policy.classify(field);
  if (category === 'ordinary') return null;
  const eligible = validScope(scope) && categories.includes(category) && supported(field, category, profile, saved);
  const expiry = eligible && category === 'privacy' && saved.rememberedPrivacy?.[rememberKey(field)];
  const approved = eligible && ((expiry || 0) > Date.now() || (approvals.get(approvalKey(scope, category, field)) || 0) > Date.now());
  return {
    category,
    state: approved ? 'authorized' : eligible ? 'approval_required' : 'manual',
    ...(approved ? { value: category === 'signature' ? saved.signature : true, evidence: policy.fieldEvidence(field) } : {}),
  };
}

export function partitionFields(fields, scope, profile) {
  const saved = config();
  const ordinary = [];
  const decisions = {};
  const permits = {};
  const values = {};
  for (const field of fields) {
    const decision = disposition({ field, scope, profile, saved });
    if (!decision) {
      ordinary.push(field);
      continue;
    }
    const { value, evidence, ...audit } = decision;
    decisions[field.id] = audit;
    if (evidence) {
      permits[field.id] = { evidence, value };
      values[field.id] = value;
    }
  }
  return { ordinary, decisions, permits, values };
}
