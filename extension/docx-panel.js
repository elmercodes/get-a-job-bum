let wordReview;
let wordVersions = [];
let wordCurrent = false;
let wordJob;
let wordBusy = false;
const wordBase = '/api/docx/reviews';

function wordNode(tag, content, parent) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (parent) parent.append(element);
  return element;
}

function wordStatus(text) {
  $('#docxStatus').textContent = text;
}

async function wordAction(fn) {
  if (wordBusy) return;
  wordBusy = true;
  try {
    await fn();
  } catch (error) {
    wordStatus('Requires attention. ' + error.message);
    if (error.details?.editId) {
      const edit = [...$('#docxEdits').querySelectorAll('fieldset')].find((item) => item.dataset.editId === error.details.editId);
      edit?.querySelector('textarea')?.focus();
    }
    throw error;
  } finally {
    wordBusy = false;
  }
}

async function loadWordLists() {
  const [evidence, history] = await Promise.all([api('/api/evidence'), api(wordBase)]);
  const source = $('#docxSource');
  const previous = source.value;
  source.replaceChildren(option('', 'Select an original DOCX'));
  for (const item of evidence.sources) {
    if (item.extension === '.docx') source.append(option(item.id, item.name));
  }
  if (previous && [...source.options].some((item) => item.value === previous)) source.value = previous;
  else if (source.options.length === 2) source.selectedIndex = 1;
  const saved = $('#docxSavedReview');
  saved.replaceChildren(option('', 'Select a saved review'));
  for (const review of history.reviews) {
    const label = [review.job.title, review.job.company].filter(Boolean).join(' · ') || 'Untitled posting';
    saved.append(option(review.id, label + ' · ' + new Date(review.createdAt).toLocaleString()));
  }
  saved.value = wordReview?.id || '';
}

function wordList(parent, title, items, render) {
  if (!items.length) return;
  const details = wordNode('details', undefined, parent);
  wordNode('summary', title + ' (' + items.length + ')', details);
  const list = wordNode('ul', undefined, details);
  for (const item of items) render(wordNode('li', undefined, list), item);
}

function renderWordReview({ review, versions = [], current = true }) {
  wordReview = review;
  wordVersions = versions;
  wordCurrent = current;
  const context = $('#docxReviewContext');
  context.replaceChildren();
  wordNode('h3', [review.job.title, review.job.company, review.job.location].filter(Boolean).join(' · ') || 'Job description', context);
  wordNode('p', 'Source ' + review.source.name + ' · ' + (review.model.method === 'model_selection' ? 'Model-ranked approved wording' : 'Local evidence ranking'), context);
  const evidenceById = new Map(review.selectedEvidence.map((item) => [item.id, item]));
  const requirements = new Map(review.requirements.map((item) => [item.id, item]));
  wordList(context, 'Posting requirements', review.requirements, (row, item) => {
    wordNode('span', item.category + ' · ' + item.text, row);
    wordNode('small', item.support === 'possible_support' ? ' Possible evidence matches require review.' : ' No matching approved evidence.', row);
  });
  if (review.terminology.length) wordNode('p', 'Posting terminology · ' + review.terminology.join(', '), context);
  wordList(context, 'Supporting approved evidence', review.selectedEvidence, (row, item) => {
    wordNode('span', item.kind + ' · ' + item.label, row);
    wordNode('small', ' (' + item.id + ')', row);
  });
  if (review.research) {
    wordNode('h4', 'Saved external research', context);
    if (review.research.summary) wordNode('p', review.research.summary, context);
    if (review.research.technologies.length) wordNode('p', review.research.technologies.join(', '), context);
    wordList(context, 'External sources', review.research.sources, (row, item) => {
      const link = wordNode('a', item.title, row);
      link.href = safeUrl(item.url);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });
    wordList(context, 'Sourced observations', review.research.observations || [], (row, item) => wordNode('span', item.text, row));
  }
  wordList(context, 'Existing source lines with no exact evidence link', review.unlinked, (row, item) => wordNode('span', item.text, row));
  wordList(context, 'Read-only paragraph structures', Object.entries(review.readOnly || {}), (row, [issue, count]) =>
    wordNode('span', issue.replaceAll('_', ' ') + ' · ' + count, row));
  wordList(context, 'Template and review notes', review.warnings, (row, text) => wordNode('span', text, row));

  const edits = $('#docxEdits');
  edits.replaceChildren();
  const latest = versions[0];
  for (const edit of review.proposals) {
    const card = wordNode('fieldset', undefined, edits);
    card.dataset.editId = edit.id;
    card.disabled = !current;
    wordNode('legend', 'Paragraph ' + edit.paragraph + ' · ' + edit.type, card);
    wordNode('p', 'Original · ' + edit.originalText, card);
    wordNode('p', edit.reason, card);
    if (edit.evidenceIds.length) {
      wordNode('p', 'Approved evidence · ' + edit.evidenceIds.map((id) => evidenceById.get(id)?.label || id).join(' · '), card);
    }
    for (const id of edit.requirementIds) wordNode('small', requirements.get(id)?.text || '', card);
    const wordingLabel = wordNode('label', 'Proposed wording', card);
    wordingLabel.className = 'field';
    const wording = wordNode('textarea', undefined, wordingLabel);
    const accepted = latest?.accepted.find((item) => item.id === edit.id);
    wording.value = accepted?.text ?? edit.text;
    wording.rows = 3;
    wording.maxLength = 1200;
    wording.className = 'docx-wording';
    if (edit.alternatives.length > 1) {
      const alternativesLabel = wordNode('label', 'Supported variants', card);
      alternativesLabel.className = 'field';
      const alternatives = wordNode('select', undefined, alternativesLabel);
      for (const alternative of edit.alternatives) alternatives.append(option(alternative, alternative || 'Clear paragraph text'));
      alternatives.value = wording.value;
      alternatives.addEventListener('change', () => { wording.value = alternatives.value; invalidateWordAttachment(); });
    }
    const decisionLabel = wordNode('label', 'Decision', card);
    decisionLabel.className = 'field';
    const decision = wordNode('select', undefined, decisionLabel);
    decision.className = 'docx-decision';
    decision.append(option('', 'Choose a decision'), option('accept', 'Accept'), option('reject', 'Reject'));
    if (accepted) decision.value = 'accept';
    if (latest?.rejected.includes(edit.id)) decision.value = 'reject';
  }
  $('#docxReview').hidden = false;
  $('#docxExport').disabled = !current || !review.proposals.length;
  renderWordVersions();
}

function renderWordVersions() {
  const select = $('#docxVersion');
  select.replaceChildren();
  for (const version of wordVersions) select.append(option(version.id, new Date(version.createdAt).toLocaleString() + ' · ' + version.id.slice(0, 10)));
  $('#docxArtifacts').hidden = !wordVersions.length;
  showWordVersion();
}

function currentWordVersion() {
  return wordVersions.find((version) => version.id === $('#docxVersion').value);
}

function showWordVersion() {
  const version = currentWordVersion();
  if (!version) return;
  const validation = $('#docxValidation');
  validation.replaceChildren();
  const latest = version.id === wordVersions[0]?.id && wordCurrent;
  wordNode('p', (latest ? 'Latest validated version' : 'Historical version') + ' · ' +
    version.validation.applied.length + ' applied · ' + version.rejected.length + ' rejected', validation);
  const layout = version.validation.layout;
  if (layout.status === 'verified') {
    wordNode('p', 'Local render · original ' + layout.originalPages + ' page(s), exported ' + layout.pages + ' page(s)', validation);
  }
  wordList(validation, 'Export notes', version.validation.warnings, (row, text) => wordNode('span', text, row));
  $('#docxDownloadPdf').hidden = !version.artifacts.pdf;
  $('#docxAttach').disabled = !latest;
  $('#docxAttachPdf').hidden = !version.artifacts.pdf;
  $('#docxAttachPdf').disabled = !latest;
}

function clearWordAttachment() {
  state.docxAttachment = null;
  $('#docxUploadSelection').textContent = '';
  $('#docxClearAttachment').hidden = true;
}

function invalidateWordAttachment() {
  if (!state.docxAttachment) return;
  state.docxAttachment.stale = true;
  $('#docxUploadSelection').textContent = 'The selected application resume needs review. Select a validated version before filling.';
}

function wordVersionPath() {
  const version = currentWordVersion();
  if (!version) throw new Error('Choose a validated version first.');
  return wordBase + '/' + wordReview.id + '/versions/' + version.id;
}

function selectWordAttachment(kind) {
  const endpoint = wordVersionPath();
  const version = currentWordVersion();
  if (!wordCurrent || version.id !== wordVersions[0]?.id || !version.artifacts[kind]) throw new Error('Select the latest validated artifact.');
  if (JSON.stringify(currentJob()) !== wordJob) throw new Error('The posting changed. Open its saved review or generate new proposals.');
  state.docxAttachment = { endpoint, kind, job: JSON.stringify(currentJob()) };
  $('#docxUploadSelection').textContent = 'Selected ' + kind.toUpperCase() + ' version ' + version.id.slice(0, 10) + ' for this application. Review the upload separately during Fill.';
  $('#docxClearAttachment').hidden = false;
}

async function wordResumeForUpload(field) {
  const attachment = state.docxAttachment;
  const job = currentJob();
  if (attachment.stale || JSON.stringify(job) !== attachment.job) throw new Error('Select a validated resume again for the current application.');
  const accept = String(field?.accept || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const mime = attachment.kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
  if (accept.length && !accept.some((value) => [mime, '.' + attachment.kind, 'application/*', '*/*'].includes(value))) {
    throw new Error('The selected format is unsupported by this field. Select a validated compatible artifact or attach a document manually.');
  }
  return api(attachment.endpoint + '/attachment', { method: 'POST', body: { job, kind: attachment.kind } });
}

$('#docxPanel').addEventListener('toggle', () => {
  if ($('#docxPanel').open) wordAction(loadWordLists).catch(() => {});
});
$('#docxVersion').addEventListener('change', showWordVersion);
$('#docxEdits').addEventListener('input', invalidateWordAttachment);
$('#docxClearAttachment').addEventListener('click', clearWordAttachment);
on('#docxLoadLists', () => wordAction(loadWordLists));
on('#docxResearch', () => wordAction(async () => {
  wordStatus('Researching the employer using public sources…');
  const { research } = await api('/api/docx/research', { method: 'POST', body: { job: currentJob(), useModel: $('#docxUseModel').checked } });
  wordStatus(research ? 'Public sources saved for this job. Analyze the posting to review them beside the requirements.' : 'No attributable company information was found. You can analyze the posting now.');
}));
on('#docxAnalyze', () => wordAction(async () => {
  const sourceId = $('#docxSource').value;
  if (!sourceId) throw new Error('Import and select a Word resume under Profile.');
  invalidateWordAttachment();
  $('#docxReview').hidden = true;
  $('#docxArtifacts').hidden = true;
  wordStatus('Analyzing the posting and generating evidence-linked proposals…');
  const job = currentJob();
  const review = await api(wordBase, { method: 'POST', body: { sourceId, job, useModel: $('#docxUseModel').checked } });
  wordJob = JSON.stringify(job);
  renderWordReview({ review });
  wordStatus(review.proposals.length ? 'Awaiting review. Accept or reject every proposal.' : 'Review complete. No supported changes were found.');
  await loadWordLists();
}));
on('#docxOpenReview', () => wordAction(async () => {
  const id = $('#docxSavedReview').value;
  if (!id) throw new Error('Choose a saved review.');
  const saved = await api(wordBase + '/' + id);
  invalidateWordAttachment();
  for (const field of ['title', 'company', 'location', 'description']) {
    const selector = field === 'description' ? '#jobDesc' : '#job' + field[0].toUpperCase() + field.slice(1);
    $(selector).value = saved.review.job[field];
  }
  state.job = { ...saved.review.job };
  wordJob = JSON.stringify(currentJob());
  $('#jobMeta').textContent = [saved.review.job.company, saved.review.job.title].filter(Boolean).join(' · ');
  renderWordReview(saved);
  wordStatus(saved.current ? 'Saved review opened. Review edits or choose a validated version.' : 'Saved review is historical. Generate new proposals for the current evidence and source.');
}));
on('#docxExport', () => wordAction(async () => {
  const cards = [...$('#docxEdits').querySelectorAll('fieldset')];
  const decisions = cards.map((card) => ({
    id: card.dataset.editId, action: card.querySelector('.docx-decision').value, text: card.querySelector('.docx-wording').value,
  }));
  if (decisions.some((edit) => !edit.action)) throw new Error('Accept or reject every proposal before exporting.');
  invalidateWordAttachment();
  wordStatus('Applying approved edits and validating the saved DOCX and local layout…');
  cards.forEach((card) => { card.disabled = true; });
  let version;
  try {
    version = await api(wordBase + '/' + wordReview.id + '/exports', { method: 'POST', body: {
      job: currentJob(), decisions, includePdf: $('#docxIncludePdf').checked, pagePreference: $('#docxLength').value,
    } });
  } finally {
    cards.forEach((card) => { card.disabled = !wordCurrent; });
  }
  if (!wordVersions.some((item) => item.id === version.id)) wordVersions.unshift(version);
  renderWordVersions();
  $('#docxVersion').value = version.id;
  showWordVersion();
  wordStatus('Ready for download. Every accepted edit passed DOCX validation.');
}));
for (const [suffix, kind] of [['', 'docx'], ['Pdf', 'pdf']]) {
  on('#docxDownload' + suffix, () => wordAction(() => downloadEvidence(wordVersionPath() + '/file/' + kind,
    'tailored-resume-' + currentWordVersion().id.slice(0, 10) + '.' + kind)));
  on('#docxAttach' + suffix, () => wordAction(async () => selectWordAttachment(kind)));
}
