import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, readJSON, writeJSON } from './storage.js';
import { evidenceSource, loadEvidence } from './evidence-store.js';
import { chatJSON, describeProvider } from './llm.js';
import { sourcedResearchFor } from './research.js';
import { buildDocx, DocxError, hash, planPatches, readDocx, verifyDocx } from './docx-engine.js';
import {
  buildStrategy, jobFingerprint, jobSnapshot, modelInput, proposalsFor, reviewEdits,
  strategyPrompt, validateModelSelections,
} from './docx-strategy.js';
import { verifyLayout } from './docx-layout.js';

const root = path.join(DATA_DIR, 'docx-tailoring');
const stagingRoot = path.join(root, 'staging');
const reviewPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const variantPattern = /^[a-f0-9]{64}$/;
const pending = new Map();
const pendingReviews = new Map();
const engineVersion = '1';

function initialize() {
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(stagingRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^stage-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
    const dir = path.join(stagingRoot, entry.name);
    if (Date.now() - fs.statSync(dir).mtimeMs > 30 * 60_000) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function checkedReview(id) {
  if (!reviewPattern.test(id)) throw notFound();
  return path.join(root, id);
}

function notFound() {
  const error = new DocxError('NOT_FOUND', 'The private review or artifact could not be found.');
  error.status = 404;
  return error;
}

function readReview(id) {
  const dir = checkedReview(id);
  const review = readJSON(path.join(dir, 'review.json'), null);
  if (!review || review.id !== id) throw notFound();
  return { dir, review };
}

function checkedArtifact(dir, id, kind) {
  if (!variantPattern.test(id) || !['docx', 'pdf'].includes(kind)) throw notFound();
  const version = path.join(dir, id);
  const meta = readJSON(path.join(version, 'manifest.json'), null);
  if (!meta || meta.id !== id || !meta.artifacts?.[kind]) throw notFound();
  const filename = path.join(version, 'tailored-resume.' + kind);
  let data;
  try { data = fs.readFileSync(filename); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new DocxError('OUTPUT_INTEGRITY', 'A verified artifact is missing from private storage. Generate a new version.');
  }
  if (hash(data) !== meta.artifacts[kind]) throw new DocxError('OUTPUT_INTEGRITY', 'The stored artifact no longer matches its verified checksum.');
  return { data, filename: 'tailored-resume-' + id.slice(0, 10) + '.' + kind, meta };
}

function readSource(sourceId) {
  let saved;
  try { saved = evidenceSource(sourceId); } catch {
    throw new DocxError('STALE_SOURCE', 'Select an existing original DOCX source in Applicant evidence.');
  }
  if (saved.source.extension !== '.docx') throw new DocxError('NOT_WORD', 'Select a DOCX original to preserve Word formatting.');
  const bytes = fs.readFileSync(saved.filename);
  if (hash(bytes) !== saved.source.sha256) throw new DocxError('STALE_SOURCE', 'The retained original no longer matches its recorded checksum.');
  return { ...saved, bytes };
}

function resumeEvidenceFingerprint(evidence) {
  return hash(JSON.stringify(evidence.records.filter((record) => record.kind !== 'answer')));
}

function freshness(review, job) {
  const evidence = loadEvidence();
  const current = review.evidenceFingerprint
    ? resumeEvidenceFingerprint(evidence) === review.evidenceFingerprint
    : evidence.revision === review.evidenceRevision;
  if (!current) throw new DocxError('STALE_EVIDENCE', 'Applicant evidence changed. Generate a new review.');
  if (job && jobFingerprint(jobSnapshot(job)) !== review.jobKey) throw new DocxError('STALE_JOB', 'The current job differs from this review.');
  const original = readSource(review.source.id);
  if (original.source.sha256 !== review.source.sha256) throw new DocxError('STALE_SOURCE', 'The source document differs from the review.');
  return { evidence, original };
}

function evidenceBrief(strategy, proposals) {
  const ids = new Set([...proposals.flatMap((edit) => edit.evidenceIds),
    ...strategy.requirements.flatMap((item) => item.evidenceIds)]);
  return strategy.records.filter((r) => ids.has(r.id)).map(({ id, kind, data }) => ({
    id, kind, label: data.original || data.name || data.title || data.degree || data.summary || kind,
  }));
}

export async function createDocxReview(input) {
  if (!input || typeof input.sourceId !== 'string') throw new DocxError('INVALID_REVIEW', 'Select an original DOCX and supply the posting.');
  const job = jobSnapshot(input.job);
  const { sourceId, requestId, useModel } = input;
  if (requestId !== undefined && (typeof requestId !== 'string' || !reviewPattern.test(requestId))) {
    throw new DocxError('INVALID_REVIEW', 'Start a new Word review with a valid request identifier.');
  }
  const id = requestId || randomUUID();
  const scope = hash(JSON.stringify([sourceId, jobFingerprint(job), useModel === true]));
  const active = pendingReviews.get(id);
  const saved = readJSON(path.join(checkedReview(id), 'review.json'), null);
  if ((active && active.scope !== scope) || (saved && saved.requestScope !== scope)) {
    throw new DocxError('REQUEST_CONFLICT', 'This review request belongs to another source, posting, or model selection. Start a fresh review.');
  }
  if (active) return active.work;
  if (saved) {
    freshness(saved, job);
    return saved;
  }
  const work = generateReview({ id, scope, sourceId, useModel, job }).finally(() => pendingReviews.delete(id));
  pendingReviews.set(id, { scope, work });
  return work;
}

async function generateReview({ id, scope, sourceId, useModel, job }) {
  const original = readSource(sourceId);
  const doc = await readDocx(original.bytes);
  const evidence = loadEvidence();
  const strategy = buildStrategy(doc, evidence, job);
  let selections;
  let model = { method: 'local_selection' };
  if (useModel === true && strategy.targets.length) {
    const provider = describeProvider();
    try {
      const result = await chatJSON(strategyPrompt, JSON.stringify(modelInput(strategy)),
        { temperature: 0.1, budgetMs: 35000, fallback: false });
      selections = validateModelSelections(result, strategy);
      if (selections) model = { method: 'model_selection', ...provider };
      else strategy.warnings.push('The model response failed validation. The review uses local selection.');
    } catch {
      strategy.warnings.push('The configured model was unavailable. The review uses local selection.');
    }
  }
  const proposals = proposalsFor(strategy, selections);
  const readOnly = {};
  for (const { issue } of doc.paragraphs) {
    if (issue && issue !== 'empty_paragraph') readOnly[issue] = (readOnly[issue] || 0) + 1;
  }
  const review = {
    id, requestScope: scope, engineVersion, job, jobKey: jobFingerprint(job), evidenceRevision: evidence.revision,
    evidenceFingerprint: resumeEvidenceFingerprint(evidence),
    source: { id: original.source.id, name: original.source.name, sha256: original.source.sha256 },
    createdAt: new Date().toISOString(), model,
    requirements: strategy.requirements, terminology: strategy.terminology,
    research: sourcedResearchFor(job), proposals, selectedEvidence: evidenceBrief(strategy, proposals),
    unlinked: strategy.linked.filter((p) => !p.evidenceIds.length), readOnly,
    warnings: [...strategy.warnings, ...(!proposals.length ? ['No safely editable supported paragraph matched the approved evidence.'] : [])],
  };
  freshness(review);
  initialize();
  const dir = checkedReview(review.id);
  fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  writeJSON(path.join(dir, 'review.json'), review);
  return review;
}

export function listDocxReviews() {
  initialize();
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && reviewPattern.test(entry.name))
    .flatMap((entry) => {
      const data = readJSON(path.join(root, entry.name, 'review.json'), null);
      if (!data) return [];
      return [{ id: data.id, job: { title: data.job.title, company: data.job.company },
        source: data.source.name, createdAt: data.createdAt }];
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 80);
}

function versionsIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && variantPattern.test(entry.name))
    .map((entry) => readJSON(path.join(dir, entry.name, 'manifest.json'), null)).filter(Boolean)
    .sort((a, b) => (b.sequence || 0) - (a.sequence || 0) || b.createdAt.localeCompare(a.createdAt));
}

export function getDocxReview(id) {
  const { dir, review } = readReview(id);
  const versions = versionsIn(dir);
  let current = true;
  try { freshness(review); } catch { current = false; }
  return { review, versions, current };
}

export function deleteDocxReviews(sourceId) {
  if (!sourceId) {
    fs.rmSync(root, { recursive: true, force: true });
    return;
  }
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !reviewPattern.test(entry.name)) continue;
    const dir = checkedReview(entry.name);
    if (readJSON(path.join(dir, 'review.json'), null)?.source.id === sourceId) fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function publish(dir, target, id, context, renderer) {
  initialize();
  const { review, original, doc, plan, accepted, rejected, includePdf, pagePreference } = context;
  const stage = await fsp.mkdtemp(path.join(stagingRoot, 'stage-'));
  try {
    const output = await buildDocx(doc, plan);
    const candidate = path.join(stage, 'tailored-resume.docx');
    await fsp.writeFile(candidate, output, { mode: 0o600, flag: 'wx', flush: true });
    const savedBytes = await fsp.readFile(candidate);
    const validation = await verifyDocx(doc, plan, savedBytes);
    const layout = await renderer({ staging: stage, source: original.bytes, output: savedBytes,
      readable: validation.output.paragraphs.filter((paragraph) => !paragraph.issue).map((paragraph) => paragraph.text),
      includePdf, pagePreference });
    if (pagePreference === 'one-page' && layout.status !== 'verified') {
      throw new DocxError('PAGE_LIMIT_UNVERIFIED', 'A local renderer is required to enforce the one-page preference.');
    }
    const { pdf, ...layoutReport } = layout;
    const artifacts = { docx: hash(savedBytes) };
    if (pdf && includePdf) {
      await fsp.writeFile(path.join(stage, 'tailored-resume.pdf'), pdf, { mode: 0o600, flag: 'wx', flush: true });
      const reopened = await fsp.readFile(path.join(stage, 'tailored-resume.pdf'));
      if (!reopened.equals(pdf)) throw new DocxError('OUTPUT_INTEGRITY', 'The saved PDF differs from the verified render.');
      artifacts.pdf = hash(reopened);
    }
    const policyWarnings = [...review.warnings, ...(layoutReport.warnings || [])];
    if (includePdf && !artifacts.pdf) policyWarnings.push('PDF is unavailable for this version. The validated DOCX is ready.');
    const meta = {
      id, reviewId: review.id, engineVersion,
      source: review.source, jobKey: review.jobKey, job: review.job,
      model: review.model, evidenceRevision: review.evidenceRevision, evidenceFingerprint: review.evidenceFingerprint,
      proposedEditIds: review.proposals.map((edit) => edit.id),
      accepted: accepted.map((edit) => ({ id: edit.id, evidenceIds: edit.evidenceIds, text: edit.text })),
      rejected, evidenceIds: [...new Set(accepted.flatMap((edit) => edit.evidenceIds))],
      pagePreference, artifacts,
      validation: { status: 'verified', applied: validation.applied, rejected,
        protectedPartsUnchanged: true, formattedParagraphsUnchanged: true,
        extractedCharacters: validation.extracted.length, readOnly: review.readOnly, layout: layoutReport, warnings: policyWarnings },
    };
    const staged = await Promise.all(Object.entries(artifacts).map(async ([kind, checksum]) =>
      hash(await fsp.readFile(path.join(stage, 'tailored-resume.' + kind))) === checksum));
    if (staged.some((matches) => !matches)) {
      throw new DocxError('OUTPUT_INTEGRITY', 'A staged artifact changed before publication.');
    }
    // Check again synchronously after the last await. Only a complete directory is published.
    freshness(review);
    meta.sequence = (versionsIn(dir)[0]?.sequence || 0) + 1;
    meta.createdAt = new Date().toISOString();
    writeJSON(path.join(stage, 'manifest.json'), meta);
    try {
      fs.renameSync(stage, target);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      return checkedArtifact(dir, id, 'docx').meta;
    }
    return meta;
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
}

export async function exportDocxReview(reviewId, input, { renderer = verifyLayout } = {}) {
  const { dir, review } = readReview(reviewId);
  if (!input || review.engineVersion !== engineVersion) throw new DocxError('INVALID_REVIEW', 'Create a new review for this version of the editor.');
  if (!input.job) throw new DocxError('STALE_JOB', 'Supply the current job for this export.');
  const pagePreference = input.pagePreference || 'preserve';
  if (!['preserve', 'one-page', 'flexible'].includes(pagePreference)) throw new DocxError('INVALID_REVIEW', 'Choose a supported page-count preference.');
  const includePdf = input.includePdf === true;
  const { original, evidence } = freshness(review, input.job);
  const doc = await readDocx(original.bytes);
  const strategy = buildStrategy(doc, evidence, review.job);
  const { accepted, rejected } = reviewEdits(review, input.decisions, strategy);
  const plan = planPatches(doc, review.source.sha256, accepted);
  const id = hash(JSON.stringify([review.id, review.jobKey, review.evidenceRevision, review.source.sha256,
    accepted.map(({ id, text }) => [id, text]).sort(), [...rejected].sort(), includePdf, pagePreference, engineVersion]));
  const target = path.join(dir, id);
  freshness(review, input.job);
  if (fs.existsSync(target)) {
    const { meta } = checkedArtifact(dir, id, 'docx');
    if (meta.artifacts.pdf) checkedArtifact(dir, id, 'pdf');
    return meta;
  }
  if (!pending.has(id)) {
    const work = publish(dir, target, id, { review, original, doc, plan, accepted, rejected, includePdf, pagePreference }, renderer)
      .finally(() => pending.delete(id));
    pending.set(id, work);
  }
  return pending.get(id);
}

export function downloadDocxArtifact(reviewId, versionId, kind) {
  return checkedArtifact(readReview(reviewId).dir, versionId, kind);
}

export function attachmentForDocx(reviewId, versionId, { job, kind = 'docx' } = {}) {
  const { dir, review } = readReview(reviewId);
  if (!job) throw new DocxError('STALE_JOB', 'Supply the current job to attach a validated document.');
  freshness(review, job);
  const { data, filename, meta } = checkedArtifact(dir, versionId, kind);
  if (meta.reviewId !== review.id || meta.jobKey !== review.jobKey || meta.evidenceRevision !== review.evidenceRevision ||
      meta.evidenceFingerprint !== review.evidenceFingerprint) {
    throw new DocxError('STALE_JOB', 'The selected document is not current for this job.');
  }
  const current = getDocxReview(reviewId).versions[0];
  if (current?.id !== versionId) throw new DocxError('VERSION_CONFLICT', 'Choose the latest validated version or generate a new review.');
  return {
    base64: data.toString('base64'), filename,
    mime: kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf',
  };
}
