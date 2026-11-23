import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { localApi } from './local-api.js';
import { acknowledge, partitionFields, setSettings, settings } from './automation.js';
import { UploadError, validateUpload } from './uploads.js';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { chatJSON, describeProvider, describeHeavy, geminiStatus, usedFallbackRecently, aiUsage } from './llm.js';
import { PARSE_SYSTEM, COVER_SYSTEM, EMAIL_SYSTEM, VISION_SYSTEM, UPSKILL_SYSTEM } from './prompts.js';
import { cleanJobText } from './guard.js';
import { atsCheck } from './atscheck.js';
import { researchCompany, researchFor } from './research.js';
import { traceOutcomes } from './outcomes.js';
import { tailorResume, tailorProblems, withoutGradSentences, crisp, cleanRole } from './tailor.js';
import { profileSkillsInJD, makeMatcher, norm, TECH_TERMS } from './keywords.js';
import { listHackathons } from './hackathons.js';
import { exportWorkbook } from './export.js';
import { checkJobs } from './jobcheck.js';
import { listInternships } from './internships.js';
import { mailConfigured, mailStatus, findVerification, sendApplication, smtpCheck } from './mail.js';
import { renderResumePDF, renderCoverLetterPDF } from './pdf.js';
import { answerFields } from './answer.js';
import { followUpDraft, interviewPrep } from './coach.js';
import { saveAppExtra, DATA_DIR, writeJSON, backupData, prepareSubmission, authorizeSubmission, settleSubmission } from './store.js';
import { getProfile, saveProfile, listApplications, upsertApplication, updateApplication, deleteApplication, STATUSES, rememberAnswers, getDocument, saveDocument, removeDocument, DOCUMENT_KINDS, DEFAULT_ANSWERS, RESUME_DIR, recordGaps, listGaps, saveGaps } from './store.js';

const PORT = Number(process.env.PORT || 8787);
const app = express();
const TEST_MODE = process.env.AUTOJOB_TEST === '1';
if (TEST_MODE && !process.env.AUTOJOB_DATA) throw new Error('Test mode requires a disposable AUTOJOB_DATA directory');
const mailEnabled = process.env.AUTOJOB_ENABLE_MAIL === '1';
const visionEnabled = process.env.AUTOJOB_ENABLE_VISION === '1';
const gate = localApi({ port: PORT, token: process.env.AUTOJOB_TOKEN, extensionId: process.env.EXTENSION_ID, test: TEST_MODE });
app.disable('x-powered-by');
app.use(gate.checkHost);
app.use(cors({ origin: (origin, cb) => cb(null, gate.allowedOrigin(origin)) }));
if (TEST_MODE) {
  app.use('/test/ext', express.static(path.resolve(import.meta.dirname, '../../extension')));
  app.use('/test', express.static(path.resolve(import.meta.dirname, '../test')));
}
app.use('/api', gate.checkClient);
app.use(express.json({ limit: '15mb' }));
app.use('/api', (req, res, next) => {
  const disabled = (!mailEnabled && /^\/(?:mail|otp|email\/(?:send|check)|applications\/trace)(?:\/|$)/.test(req.path)) ||
    (!visionEnabled && req.path === '/vision');
  if (disabled) return res.status(403).json({ error: 'This integration is disabled' });
  next();
});

const uploadLimits = { fieldSize: 4096, fields: 2 };
const resumeUpload = multer({ storage: multer.memoryStorage(), limits: { ...uploadLimits, fileSize: 5 * 1024 * 1024, files: 4, parts: 7 } });
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { ...uploadLimits, fileSize: 10 * 1024 * 1024, files: 1, parts: 4 } });
const route = (fn) => (req, res, next) => fn(req, res).catch(next);

app.get('/api/health', (req, res) => res.json({ ok: true, llm: describeProvider(), heavy: describeHeavy(), resting: geminiStatus(), usingLocalAI: usedFallbackRecently(), gmail: mailEnabled && mailConfigured(), vision: visionEnabled, hasProfile: !!getProfile(), ai: aiUsage() }));

// Upload one or more resume versions (PDF / DOCX / TXT) and merge them into one structured profile.
async function resumeText(file) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.pdf')) return (await pdfParse(file.buffer)).text;
  if (!name.endsWith('.docx')) return file.buffer.toString('utf8');
  let text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
  // "LinkedIn", "GitHub"... are usually hyperlinks; raw text loses the URLs.
  const html = (await mammoth.convertToHtml({ buffer: file.buffer })).value;
  const links = [...html.matchAll(/href="([^"]+)"[^>]*>([^<]*)</g)].filter(([, url]) => !url.startsWith('mailto:'));
  if (links.length) text += `\n\nHYPERLINKS (link text -> URL):\n${links.map(([, url, label]) => `${label || '(icon)'} -> ${url}`).join('\n')}`;
  return text;
}

// Things you corrected by hand (links, CGPA, exact graduation date) win over what the resume files say.
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
function keepManualEdits(parsed, old) {
  // "AYUSH UPADHYAY" in a resume header would become "AYUSH" in every first-name field.
  if (parsed.name && parsed.name === parsed.name.toUpperCase()) parsed.name = titleCase(parsed.name);
  if (!old) return;
  if (old.name && old.name.toLowerCase() === String(parsed.name).toLowerCase()) parsed.name = old.name;
  parsed.links ||= {};
  for (const k of ['linkedin', 'github', 'portfolio']) if (old.links?.[k]) parsed.links[k] = old.links[k];
  parsed.links.other = [...new Set([...(old.links?.other || []), ...(parsed.links.other || [])])].filter((u) => u !== parsed.links.portfolio);
  for (const e of parsed.education || []) {
    const prev = (old.education || []).find((o) => o.school && e.school && o.school.split(',')[0].toLowerCase() === e.school.split(',')[0].toLowerCase());
    if (!prev) continue;
    if (prev.gpa && !e.gpa) e.gpa = prev.gpa;
    if (prev.end && /[a-z]/i.test(prev.end) && String(prev.end).includes(String(e.end))) e.end = prev.end; // "May 2027" over "2027"
    if (prev.start && !e.start) e.start = prev.start;
  }
}

app.post('/api/profile/import', resumeUpload.array('resume', 4), route(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No file uploaded' });
  const seen = new Set();
  const versions = [];
  for (const file of req.files) {
    await validateUpload(file, { resume: true });
    const text = await resumeText(file).then((value) => value.trim()).catch(() => {
      throw new UploadError('Could not read the resume document');
    });
    const key = text.replace(/\s+/g, ' ').slice(0, 4000);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    versions.push({ name: file.originalname, text });
  }
  if (!versions.length) return res.status(400).json({ error: 'Could not read any text from those files (scanned image PDF?)' });

  const sourceText = versions.map((v) => `===== RESUME VERSION: ${v.name} =====\n${v.text}`).join('\n\n');
  const parsed = await chatJSON(PARSE_SYSTEM, sourceText, { heavy: true });
  const old = getProfile();
  keepManualEdits(parsed, old);
  // Re-importing replaces the resume content but keeps personal details, answers, documents and remembered answers.
  const profile = { ...parsed, personal: old?.personal, documents: old?.documents, answerBank: old?.answerBank, answers: old?.answers || DEFAULT_ANSWERS, sourceText, sourceFiles: versions.map((v) => v.name) };
  saveProfile(profile);
  res.json(profile);
}));

app.get('/api/profile', (req, res) => res.json(getProfile()));

// "I have this skill": you confirm a job keyword the resume didn't show; it joins your skills for future tailoring.
app.post('/api/profile/skills', (req, res) => {
  const p = getProfile();
  const skill = String(req.body.skill || '').trim().slice(0, 60);
  if (!p || !skill) return res.status(400).json({ error: 'Nothing to add' });
  let cat = p.skills.find((x) => x.category === 'Additional skills');
  if (!cat) p.skills.push((cat = { category: 'Additional skills', items: [] }));
  if (!cat.items.some((i) => i.toLowerCase() === skill.toLowerCase())) cat.items.push(skill);
  p.sourceText = `${p.sourceText || ''}\nConfirmed skill: ${skill}`;
  saveProfile(p);
  res.json({ ok: true, skill });
});
app.put('/api/profile', (req, res) => {
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b) || !Array.isArray(b.skills) || ['experience', 'education', 'projects'].some((k) => k in b && !Array.isArray(b[k]))) return res.status(400).json({ error: 'Not a profile' });
  saveProfile(b);
  res.json(getProfile());
});

// Tailor the master resume to one job description and return the PDF.
app.post('/api/tailor', route(async (req, res) => {
  const profile = getProfile();
  if (!profile) return res.status(400).json({ error: 'Import your resume first' });
  const { title = '', company = '' } = req.body;
  // Postings are untrusted input: hidden text and instruction-shaped lines never reach the model.
  const { text: description, stripped } = cleanJobText(req.body.description);
  if (stripped.length) console.warn('Posting integrity gate removed instruction-shaped lines', { count: stripped.length });
  if (description.trim().length < 80) return res.status(400).json({ error: 'Job description is missing or too short' });

  const { answers, sourceText, ...resume } = profile;
  const job = { title, company, description };
  let out = await tailorResume(resume, sourceText || '', job, { fillGaps: !!req.body.fillGaps });
  // Quality gate: top keywords in the headline/summary, summary shape, real numbers kept.
  // One fix-up pass with the problems spelled out when it fails (same pattern as the cover letter).
  const problems = tailorProblems(out, resume);
  if (problems.length) {
    const redo = await tailorResume(resume, sourceText || '', job, { fillGaps: !!req.body.fillGaps, fixThese: problems, previous: out.resume }).catch(() => null);
    if (redo) out = { ...redo, changes: [...redo.changes, `Quality pass (${problems.length}): ${problems.join(' | ')}`] };
  }
  const tailored = out.resume;
  const pdf = await renderResumePDF(tailored);
  // What an ATS parser actually sees: contact details in the text layer, no garbled glyphs, keywords present.
  const ats = await atsCheck(pdf, { profile, keywords: out.keywords.covered }).catch(() => null);
  // Journal the gaps this job asked for: the skill-gap heatmap (/api/upskill) is built from these.
  recordGaps({ title, company, covered: out.keywords.covered, missing: out.missingKeywords });

  const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  const filename = `${safe(resume.name || 'Resume')}_${safe(company || 'Resume')}.pdf`;
  fs.writeFileSync(path.join(RESUME_DIR, `${Date.now()}_${filename}`), pdf);

  res.json({
    filename,
    pdfBase64: pdf.toString('base64'),
    resume: tailored,
    changes: out.changes,
    matchScore: out.matchScore,
    missingKeywords: out.missingKeywords,
    keywords: out.keywords,
    ats,
  });
}));

app.get('/api/automation/settings', (req, res) => res.json(settings()));
app.put('/api/automation/settings', (req, res) => {
  try {
    res.json(setSettings(req.body || {}, getProfile()));
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    res.status(400).json({ error: error.message });
  }
});
const validField = (f) => f && typeof f.id === 'string' && /^[\w:-]{1,80}$/.test(f.id) &&
  typeof f.label === 'string' && f.label.length <= 2000 && typeof f.type === 'string' &&
  !['__proto__', 'constructor', 'prototype'].includes(f.id) &&
  (f.contextUrl === undefined || !!webUrl(f.contextUrl)) &&
  (f.options === undefined || (Array.isArray(f.options) && f.options.length <= 500 && f.options.every((v) => typeof v === 'string'))) &&
  (f.terms === undefined || (typeof f.terms === 'string' && f.terms.length <= 4000)) &&
  (f.links === undefined || (Array.isArray(f.links) && f.links.length <= 12 && f.links.every((v) => typeof v === 'string' && /^https?:\/\//.test(v))));
app.post('/api/automation/acknowledge', (req, res) => {
  const { scope, field, remember } = req.body || {};
  if (!validField(field) || !acknowledge({ scope, field, remember, profile: getProfile() })) {
    return res.status(409).json({ error: 'This disclosure needs direct review on the application page' });
  }
  res.json({ ok: true });
});

// Apply the authorization policy before rules, memory, repair, or model use.
app.post('/api/answer', route(async (req, res) => {
  const profile = getProfile();
  if (!profile) return res.status(400).json({ error: 'Import your resume first' });
  const { fields, scope, errors = {} } = req.body || {};
  if (!Array.isArray(fields) || fields.length > 400 || !fields.every(validField)) return res.status(400).json({ error: 'Invalid fields' });
  const { ordinary, decisions, permits, values } = partitionFields(fields, scope, profile);
  const safeFields = ordinary.map(({ terms, links, incompleteTerms, ...field }) => field);
  const safeErrors = Object.fromEntries(safeFields.filter((field) => Object.hasOwn(errors || {}, field.id)).map((field) => [field.id, errors[field.id]]));
  const { sourceText, documents, answerBank, personal, answers, ...resume } = profile;
  const job = req.body.job ? { ...req.body.job, description: cleanJobText(req.body.job.description).text } : undefined;
  const result = await answerFields({
    fields: safeFields, profile: { ...resume, answerBank, personal, answers }, job,
    coverLetter: req.body.coverLetter, errors: safeErrors, pageErrors: [],
  });
  res.json({ ...result, values: { ...result.values, ...values }, decisions, permits });
}));

const STOCK = /I am (writing|applying)|validates? my|my capacity|leverag\w+|proves? my (ability|capability)|demonstrates? my|showcas\w+|my technical foundation|beyond these tools|passionate|excited|thrilled|perfect fit|I believe|I am confident|dream job|esteemed|leverage my|hit the ground running|from day one/gi;
function coverProblems(t) {
  const body = t.replace(/\n\s*(sincerely|regards|best regards)[\s\S]*$/i, '').replace(/^dear[^\n]*\n/i, '');
  const words = body.split(/\s+/).filter(Boolean).length;
  const paras = body.split(/\n\s*\n/).filter((x) => x.trim()).length;
  const stock = [...new Set((body.match(STOCK) || []).map((x) => x.toLowerCase()))];
  return [
    words > 340 && `${words} words: cut to 250-330`,
    words < 220 && `${words} words: expand to 250-330`,
    paras !== 4 && `${paras} paragraphs: use exactly 4`,
    stock.length && `remove these phrases: ${stock.join(', ')}`,
  ].filter(Boolean);
}

// Cover letter for one job: text (for text boxes) and a PDF (for upload fields).
// Company research before applying (Google-Search-grounded, cached a week).
app.post('/api/research', route(async (req, res) => {
  const profile = getProfile();
  if (!profile) return res.status(400).json({ error: 'Import your resume first' });
  res.json(await researchCompany({ ...req.body, description: cleanJobText(req.body?.description).text }, profile, { refresh: !!req.body?.refresh }));
}));

app.post('/api/cover-letter', route(async (req, res) => {
  const profile = getProfile();
  if (!profile) return res.status(400).json({ error: 'Import your resume first' });
  const { title = '', company = '', location = '' } = req.body;
  const description = cleanJobText(req.body.description).text;
  if (description.trim().length < 80) return res.status(400).json({ error: 'Job description is missing or too short' });
  const { sourceText, answerBank, documents, personal, ...rest } = profile;
  const keywords = [...new Set([...(req.body.keywords || []), ...profileSkillsInJD(rest, description)])].slice(0, 16);
  const companyFacts = researchFor({ company, title });
  const input = { PROFILE: rest, KEYWORDS_TO_USE: keywords, JOB: { title: cleanRole(title) || title, postedTitle: title, company, location, description: description.slice(0, 12000) }, ...(companyFacts ? { COMPANY_FACTS: companyFacts } : {}) };
  let out = await chatJSON(COVER_SYSTEM, JSON.stringify(input), { temperature: 0.5, heavy: true });
  // Quality gate: length, four paragraphs, no stock phrases. One rewrite with the problems spelled out.
  const problems = coverProblems(String(out.text || ''));
  if (problems.length) out = await chatJSON(COVER_SYSTEM, JSON.stringify({ ...input, PREVIOUS_DRAFT: out.text, FIX_THESE: problems }), { temperature: 0.4, heavy: true }).catch(() => out);
  const text = crisp(String(out.text || '').trim()).replace(/ (?=\n)/g, '');
  if (text.length < 200) throw new Error('The AI returned an empty cover letter, try again');
  const pdf = await renderCoverLetterPDF(profile, text, { title: cleanRole(title) || title, company, location });
  const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  const filename = `${safe(profile.name || 'Cover')}_Cover_Letter_${safe(company || 'Job')}.pdf`;
  fs.writeFileSync(path.join(RESUME_DIR, `${Date.now()}_${filename}`), pdf);
  const lower = text.toLowerCase();
  res.json({ text, filename, pdfBase64: pdf.toString('base64'), keywordsUsed: keywords.filter((k) => lower.includes(k.toLowerCase().split(' (')[0])) });
}));

// Your documents (photo, signature, marksheets, ID / address proof…): kept in data/documents on this Mac.
app.get('/api/documents', (req, res) => {
  const docs = getProfile()?.documents || {};
  res.json({ kinds: DOCUMENT_KINDS, saved: Object.fromEntries(DOCUMENT_KINDS.filter((k) => docs[k]).map((k) => [k, docs[k]])) });
});
app.post('/api/documents/:kind', documentUpload.single('file'), route(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!['photo', 'marksheet10', 'marksheet12', 'degree', 'transcript'].includes(req.params.kind)) {
    return res.status(400).json({ error: 'Unsupported document type. Attach sensitive documents directly on the application page.' });
  }
  await validateUpload(req.file);
  res.json({ ok: true, name: saveDocument(req.params.kind, req.file.originalname, req.file.buffer) });
}));
app.delete('/api/documents/:kind', (req, res) => {
  removeDocument(req.params.kind);
  res.json({ ok: true });
});

app.get('/api/documents/:kind', (req, res) => {
  if (!['photo', 'marksheet10', 'marksheet12', 'degree', 'transcript'].includes(req.params.kind)) {
    return res.status(404).json({ error: 'Document unavailable' });
  }
  const doc = getDocument(req.params.kind);
  if (!doc) return res.status(404).json({ error: `No ${req.params.kind} saved in your profile` });
  res.json(doc);
});

// Remember the answers on a page (including your corrections) for the next application.
// Visual check: the panel sends screenshots of the filled page; Gemini says what looks wrong on screen.
app.post('/api/vision', route(async (req, res) => {
  const images = (req.body.images || []).filter((x) => typeof x === 'string' && x.length > 1000).slice(0, 4);
  if (!images.length) return res.json({ problems: [], summary: 'no screenshot' });
  const fields = (req.body.fields || []).slice(0, 150).map(({ n, label, type, required, filled }) => ({ n, label: String(label || '').slice(0, 140), type, required, filled }));
  const out = await chatJSON(VISION_SYSTEM, JSON.stringify({ URL: req.body.url || '', FIELDS: fields }), { temperature: 0.1, images, budgetMs: 70000 });
  const problems = (Array.isArray(out.problems) ? out.problems : []).filter((p) => p && p.problem).slice(0, 15).map((p) => ({ field: Number(p.field) || 0, label: String(p.label || ''), problem: String(p.problem), fix: String(p.fix || '') }));
  res.json({ problems, summary: String(out.summary || '') });
}));

app.post('/api/answer-bank', (req, res) => res.json({ saved: rememberAnswers(req.body.entries) }));

// Apply by email: draft (AI) → you review/edit in the panel → send (only on your confirm).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
app.post('/api/email/draft', route(async (req, res) => {
  const profile = getProfile();
  if (!profile) return res.status(400).json({ error: 'Import your resume first' });
  const { job = {}, recruiterName = '', keywords = [] } = req.body;
  const { sourceText, answerBank, documents, personal, ...rest } = profile;
  const kws = [...new Set([...keywords, ...profileSkillsInJD(rest, job.description || '')])].slice(0, 14);
  const out = await chatJSON(EMAIL_SYSTEM, JSON.stringify({ PROFILE: rest, RECRUITER_NAME: recruiterName, KEYWORDS_TO_USE: kws, JOB: { ...job, description: cleanJobText(job.description).text.slice(0, 10000) } }), { temperature: 0.5 });
  const body = String(out.body || '').split('\n').map((line) => withoutGradSentences(line) || (line.trim() ? '' : line)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!out.subject || body.length < 80) throw new Error('The AI returned an empty email, try again');
  res.json({ subject: String(out.subject).trim(), body });
}));

app.post('/api/email/send', route(async (req, res) => {
  const { to, cc, subject, body, attachments, job = {} } = req.body;
  const list = String(to || '').split(/[,;\s]+/).filter(Boolean);
  if (!list.length || !list.every((e) => EMAIL_RE.test(e))) return res.status(400).json({ error: 'Check the recipient email address' });
  if (!subject || !body) return res.status(400).json({ error: 'Subject and message are required' });
  const sent = await sendApplication({ to: list.join(', '), cc, subject, body, attachments });
  const tracked = upsertApplication({ title: job.title, company: job.company, url: job.url, location: job.location, status: 'applied', via: 'email', contact: list.join(', '), resume: attachments?.[0]?.filename });
  res.json({ ok: true, ...sent, application: tracked });
}));
app.get('/api/email/check', route(async (req, res) => res.json(await smtpCheck())));

// Gmail (read-only): find a verification code or link that arrived after `since`, waiting up to `wait` seconds.
app.get('/api/mail/status', route(async (req, res) => res.json(await mailStatus())));
app.get('/api/otp', route(async (req, res) => {
  const since = Number(req.query.since) || Date.now() - 10 * 60_000;
  const wait = Math.min(Number(req.query.wait) || 90, 180) * 1000;
  const end = Date.now() + wait;
  while (true) {
    const hit = await findVerification({ since, hint: String(req.query.hint || ''), want: String(req.query.want || 'any') });
    if (hit || Date.now() > end) return res.json(hit || { none: true });
    await new Promise((r) => setTimeout(r, 6000));
  }
}));

// Hackathons from 8 platforms, normalised and cached.
app.get('/api/hackathons', route(async (req, res) => res.json(await listHackathons({ refresh: req.query.refresh === '1' }))));

// Internships 2027 (github.com/zapplyjobs): a curated internship list, parsed from the repo's README.
app.get('/api/internships', route(async (req, res) => res.json(await listInternships({ refresh: req.query.refresh === '1' }))));

// Skill-gap heatmap: every tailored job's missing keywords, aggregated (data/skill-gaps.json journal).
app.get('/api/upskill', (req, res) => {
  const gaps = listGaps();
  const byTerm = new Map();
  for (const g of gaps) {
    for (const m of g.missing || []) {
      const k = norm(m);
      if (!k) continue;
      const e = byTerm.get(k) || { term: m, jobs: [] };
      const who = g.company || g.title || 'a job';
      if (!e.jobs.includes(who)) e.jobs.push(who);
      byTerm.set(k, e);
    }
  }
  const ranked = [...byTerm.values()].sort((a, b) => b.jobs.length - a.jobs.length).slice(0, 20);
  res.json({ jobs: gaps.length, gaps: ranked, plan: gaps.plan || null });
});

// Learning plan for the top gaps (heavy model; cached until the next tailor).
app.post('/api/upskill', route(async (req, res) => {
  const profile = getProfile();
  if (!profile) return res.status(400).json({ error: 'Import your resume first' });
  const gaps = listGaps();
  if (!gaps.length) return res.status(400).json({ error: 'No tracked jobs yet — tailor a resume first' });
  const byTerm = new Map();
  for (const g of gaps) for (const m of g.missing || []) {
    const k = norm(m);
    const e = byTerm.get(k) || { term: m, jobs: new Set() };
    e.jobs.add(g.company || g.title || 'a job');
    byTerm.set(k, e);
  }
  const top = [...byTerm.values()].sort((a, b) => b.jobs.size - a.jobs.size).slice(0, 12).map((e) => ({ term: e.term, askedBy: [...e.jobs].slice(0, 5) }));
  const { sourceText, answerBank, documents, personal, ...rest } = profile;
  const plan = await chatJSON(
    UPSKILL_SYSTEM,
    JSON.stringify({ GAPS: top, PROFILE: { education: rest.education, skills: rest.skills }, TARGET_ROLES: rest.headline }),
    { temperature: 0.4, heavy: true },
  );
  gaps.plan = { ...plan, at: new Date().toISOString() };
  saveGaps(gaps);
  res.json(gaps.plan);
}));

// Profile expansion: scan the GitHub account in the profile's links for tools the resume never listed.
// Suggestions only — each one is added only when you confirm it (+ chip → /api/profile/skills).
app.get('/api/expand', route(async (req, res) => {
  const profile = getProfile();
  if (!profile) return res.status(400).json({ error: 'Import your resume first' });
  const user = (String(profile.links?.github || '').match(/github\.com\/([^/\s?#]+)/) || [])[1];
  if (!user) return res.status(400).json({ error: 'Add your GitHub link to your profile first' });
  const r = await fetch(`https://api.github.com/users/${user}/repos?per_page=100&sort=updated`, {
    headers: { 'User-Agent': 'AutoJob (local tool)', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json()).message || ''}`);
  const repos = (await r.json()).filter((x) => !x.fork);
  const inProfile = makeMatcher(JSON.stringify(profile));
  const NOISE = /hacktoberfest|awesome|tutorial|course|learn(ing)?|beginner|interview|portfolio|resume|cv\b|dotfiles|config|notes|100day|365day/i;
  const suggestions = new Map();
  const counts = new Map();
  for (const repo of repos) {
    for (const t of [...(repo.topics || []), repo.language].filter(Boolean)) {
      const term = String(t).replace(/-/g, ' ').trim();
      if (term.length < 2 || term.length > 30 || NOISE.test(term)) continue;
      counts.set(term, (counts.get(term) || 0) + 1);
      if (!suggestions.has(term)) suggestions.set(term, repo.name);
    }
  }
  // Keep topics that show up in 2+ repos, or that are known tech terms: one-off topics are usually noise.
  const tech = makeMatcher(TECH_TERMS.join(', '));
  const kept = [...suggestions].filter(([term]) => ((counts.get(term) || 0) >= 2 || tech(term)) && !inProfile(term));
  res.json({ user, repos: repos.length, suggestions: kept.slice(0, 25).map(([skill, source]) => ({ skill, source })) });
}));


// Which job links are still open: { urls: [...] } (up to 100 per call) -> { results: { url: 'open' | 'closed' | 'unknown' } }.
app.post('/api/jobs/check', route(async (req, res) => res.json({ results: await checkJobs(Array.isArray(req.body?.urls) ? req.body.urls : []) })));

// Excel workbook: your Jobs list (sent by the panel, which holds it), open hackathons and the tracker; `only` picks one sheet.
app.post('/api/export', route(async (req, res) => {
  const only = ['jobs', 'hackathons', 'tracker'].includes(req.body?.only) ? req.body.only : undefined;
  const hackathons = !only || only === 'hackathons' ? (await listHackathons().catch(() => ({ items: [] }))).items || [] : [];
  const buf = await exportWorkbook({ jobs: Array.isArray(req.body?.jobs) ? req.body.jobs : [], hackathons, applications: listApplications(), only });
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buf));
}));

// Pending reviews and review nonces are internal workflow records.
app.get('/api/applications', (req, res) => res.json({
  statuses: STATUSES,
  items: listApplications().map(({ submissionReview, ...item }) => item),
}));
const trackerEntry = (entry) => Object.fromEntries(
  ['id', 'title', 'company', 'location', 'url', 'notes', 'contact', 'status', 'description', 'resume', 'coverLetter'].map((key) => [key, entry?.[key]]),
);
app.post('/api/applications', (req, res) => res.json(upsertApplication(trackerEntry(req.body))));
app.post('/api/applications/bulk', (req, res) => res.json((req.body.items || []).map((a) => upsertApplication(trackerEntry(a)))));
function webUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}
app.post('/api/submissions/review', (req, res) => {
  const { url, nonce, snapshot, label, job } = req.body || {};
  if (!webUrl(url) || typeof nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(nonce) ||
      typeof snapshot !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot) || typeof label !== 'string' || !label || label.length > 60) {
    return res.status(400).json({ error: 'Invalid review' });
  }
  const review = prepareSubmission({ url, nonce, snapshot, label, job: {
    url: webUrl(job?.url), title: String(job?.title || '').slice(0, 250), company: String(job?.company || '').slice(0, 150),
  } });
  if (!review) return res.status(409).json({ error: 'An application with a previous attempt already exists' });
  res.status(201).json(review);
});
app.post('/api/submissions/:id/authorize', (req, res) => {
  const approval = req.body?.confirmed === true && authorizeSubmission(req.params.id, req.body);
  if (!approval) return res.status(409).json({ error: 'Review expired, changed, or was already used' });
  res.json(approval);
});
app.post('/api/submissions/:id/result', (req, res) => {
  const { clicked, receipt, manuallyConfirmed } = req.body || {};
  const result = settleSubmission(req.params.id, {
    clicked: clicked === true,
    receipt: clicked === true && typeof receipt === 'string' && /^[a-z0-9][a-z0-9-]{3,63}$/i.test(receipt),
    manuallyConfirmed: manuallyConfirmed === true,
  });
  if (!result) return res.status(409).json({ error: 'No unresolved submission attempt' });
  res.json(result);
});
// The exact resume / cover letter PDF you sent with an application (newest copy with that name).
app.get('/api/resumes/:name', (req, res) => {
  const name = path.basename(String(req.params.name));
  const hit = fs.readdirSync(RESUME_DIR).filter((f) => f === name || f.endsWith(`_${name}`)).sort().pop();
  if (!hit) return res.status(404).json({ error: 'Not found' });
  res.type('application/pdf').sendFile(path.join(RESUME_DIR, hit));
});

// "Report this form": a scrubbed copy of a form that didn't fill well, saved as a test page, plus what failed.
app.post('/api/report-form', (req, res) => {
  const { html = '', host = 'site', failures = [], errors = [] } = req.body || {};
  if (!/^<!doctype html>/i.test(html) || html.length > 1_200_000) return res.status(400).json({ error: 'Not a form snapshot' });
  const dir = path.join(DATA_DIR, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${String(host).replace(/[^a-z0-9.-]+/gi, '-').replace(/^www\./, '')}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  const notes = `<!-- What Auto Job saw fail:\n${[...failures.map((f) => `  field: ${String(f.label).slice(0, 120)} -> ${String(f.error).slice(0, 160)}`), ...errors.map((e) => `  page: ${String(e).slice(0, 160)}`)].join('\n').replace(/--/g, '-')}\n-->\n`;
  fs.writeFileSync(path.join(dir, `${name}.html`), html.replace(/<\/head>/i, `${notes}</head>`));
  res.json({ ok: true, file: 'reports/' + name + '.html' });
});

// Trace outcomes from Gmail: rejections, interviews, assessments, offers, confirmations. apply=true moves the
// confident ones (company and role matched); the rest come back for you to confirm.
// Drafts for you to read: a follow-up email for a quiet application, an interview prep brief.
for (const [kind, make] of [['followup', followUpDraft], ['prep', interviewPrep]]) {
  app.post(`/api/applications/:id/${kind}`, route(async (req, res) => {
    const a = listApplications().find((x) => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: 'No such application' });
    const profile = getProfile();
    if (!profile) return res.status(400).json({ error: 'Import your resume first' });
    const out = await make(a, profile);
    saveAppExtra(a.id, { [kind]: { ...out, at: new Date().toISOString() } });
    res.json(out);
  }));
}

// Read your Gmail for your job search: every email in the window is sorted (rules, then the AI for unclear ones),
// tracked applications move forward, and applications you didn't track are added from the emails about them.
const DAY_MS = 86400_000;
const TRACE_FILE = path.join(DATA_DIR, 'last-trace.json');
// Emails of applications you deleted: never turned back into an application by the next mail check.
const IGNORED_FILE = path.join(DATA_DIR, 'ignored-mail.json');
const ignoredMail = () => { try { return JSON.parse(fs.readFileSync(IGNORED_FILE, 'utf8')); } catch { return []; } };
let tracing = null;
function runTrace({ apply = true, autoAdd = true, days } = {}) {
  tracing ||= (async () => {
    const apps = listApplications().filter((a) => a.status !== 'saved');
    const window = Math.min(365, Math.max(7, Number(days) || Number(process.env.MAIL_SCAN_DAYS) || 90));
    const oldest = Math.min(Infinity, ...apps.map((a) => new Date(a.appliedAt || a.createdAt).getTime()).filter(Boolean));
    const since = Math.max(Math.min(Date.now() - window * DAY_MS, oldest - 2 * DAY_MS), Date.now() - 365 * DAY_MS);
    const out = await traceOutcomes(apps, { since, ignore: ignoredMail() });
    const applied = [];
    for (const u of out.updates) {
      const mail = { id: u.mailId, kind: u.kind, subject: u.subject, from: u.from, date: u.date, evidence: u.evidence };
      if (apply && u.confident && u.change) {
        updateApplication(u.appId, { status: u.to_status, mail });
        applied.push(u);
      } else if (apply && u.confident) updateApplication(u.appId, { mail }); // same status: just keep the email on the timeline
    }
    const added = [];
    if (apply && autoAdd) {
      for (const a of out.created) {
        const app = upsertApplication({ company: a.company, title: a.title || '(role from email)', status: a.status, via: 'gmail', notes: `Found in Gmail: ${a.mail[0].subject}` });
        saveAppExtra(app.id, { appliedAt: a.appliedAt, createdAt: a.appliedAt });
        for (const m of a.mail) updateApplication(app.id, { mail: { id: m.mailId, kind: m.kind, subject: m.subject, from: m.from, date: m.date, evidence: m.evidence } });
        added.push({ ...a, appId: app.id });
      }
    }
    const result = { ...out, applied, added, at: new Date().toISOString() };
    writeJSON(TRACE_FILE, result);
    return result;
  })().finally(() => (tracing = null));
  return tracing;
}
app.post('/api/applications/trace', route(async (req, res) => res.json(await runTrace({ apply: !!req.body?.apply, autoAdd: req.body?.autoAdd !== false, days: req.body?.days }))));
app.get('/api/applications/trace/last', (req, res) => res.json(fs.existsSync(TRACE_FILE) ? JSON.parse(fs.readFileSync(TRACE_FILE, 'utf8')) : null));
// While the server runs it checks your mail on its own (MAIL_SCAN_HOURS, default 3; 0 turns it off).
const SCAN_HOURS = Number(process.env.MAIL_SCAN_HOURS ?? 3);
if (SCAN_HOURS > 0 && mailConfigured() && !process.env.CI) {
  const scan = () => runTrace().then((r) => console.log(`Gmail: ${r.jobEmails} job emails, ${r.applied.length} updated, ${r.added.length} added`)).catch((e) => console.log('Gmail check failed:', e.message));
  setTimeout(scan, 2 * 60_000).unref();
  setInterval(scan, SCAN_HOURS * 3600_000).unref();
}

app.patch('/api/applications/:id', (req, res) => {
  const a = updateApplication(req.params.id, req.body);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});
app.delete('/api/applications/:id', (req, res) => {
  const gone = listApplications().find((a) => a.id === req.params.id);
  if (gone?.mail?.length) writeJSON(IGNORED_FILE, [...new Set([...ignoredMail(), ...gone.mail.map((m) => m.id)])].slice(-5000));
  deleteApplication(req.params.id);
  res.json({ ok: true });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof UploadError) return res.status(400).json({ error: error.message });
  if (error instanceof multer.MulterError) {
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Upload exceeds the permitted size or file count' });
  }
  if (error.status === 413) return res.status(413).json({ error: 'Request too large' });
  if (error.status === 400) return res.status(400).json({ error: 'Invalid request' });
  console.error('Local API request failed', { method: req.method, status: 500 });
  res.status(500).json({ error: 'Local request failed' });
});

// A dated copy of your profile and tracker each day (data/backups, last 7 kept).
if (!process.env.CI) {
  const daily = () => { try { backupData(); } catch (e) { console.log('Backup failed:', e.message); } };
  daily();
  setInterval(daily, 24 * 3600_000).unref();
}

const server = app.listen(PORT, '127.0.0.1', () => {
  const { provider, model } = describeProvider();
  console.log(`Auto Job server on http://localhost:${PORT}  (LLM: ${provider} / ${model})`);
});
server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`Auto Job is already running on http://localhost:${PORT}. Nothing to do: the extension will use that one.`);
  console.log(`To restart it, stop the other one first:  lsof -ti tcp:${PORT} | xargs kill`);
  process.exit(0);
});
