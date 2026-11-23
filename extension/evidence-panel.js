// Developer-first editor in the existing Profile tab. All review decisions are
// explicit and carry the revision displayed when the user opened the record.
let evidenceView;
let evidenceEditing;

const kindName = {
  contact: 'Personal and contact details', employment: 'Employment', accomplishment: 'Accomplishment',
  skill: 'Skill', education: 'Education', project: 'Project', certification: 'Certification',
  language: 'Language', standard: 'Standard applicant detail', answer: 'Reusable answer',
};
const fieldName = (name) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
const option = (value, label = value) => {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  return item;
};

async function loadEvidencePanel() {
  evidenceView = await api('/api/evidence');
  $('#evidenceKind').replaceChildren(...Object.keys(evidenceView.fields).map((kind) => option(kind, kindName[kind])));
  renderEvidence();
}

function updateEvidenceView(state) {
  evidenceView = { ...evidenceView, ...state };
  renderEvidence();
}

function recordLabel(record) {
  const d = record.data;
  return d.legalName || d.preferredName || (d.company && [d.title, d.company, d.start].filter(Boolean).join(' · ')) ||
    d.original || d.question || d.name || d.school || d.key || kindName[record.kind];
}

function renderEvidence() {
  const filter = $('#evidenceFilter').value;
  const records = evidenceView.records.filter((record) => filter === 'all' ||
    (filter === 'review' ? ['pending', 'conflict', 'ai_suggested'].includes(record.status) : filter === record.kind));
  const list = $('#evidenceRecords');
  list.replaceChildren();
  for (const record of records) {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'btn ghost sm';
    button.dataset.evidenceRecord = record.id;
    button.textContent = recordLabel(record).slice(0, 130);
    const badge = document.createElement('span');
    const source = evidenceView.sources.find((item) => item.id === record.provenance.sourceId);
    badge.className = 'hint';
    badge.textContent = ' ' + kindName[record.kind] + ' · ' + record.status + ' · ' + (source?.name || record.provenance.kind);
    row.append(button, badge);
    list.append(row);
  }
  $('#evidenceStatus').textContent = records.length
    ? String(records.length) + ' visible records'
    : 'Choose a record type and add your first detail, or extract a resume for review.';
  const migration = evidenceView.migration;
  if (migration?.requiresReview) {
    $('#evidenceStatus').textContent += ' · Legacy rows need review. Migration omitted ' + migration.omitted + ' unsupported rows and merged ' + migration.duplicates + ' duplicates.';
  }
  const sources = $('#evidenceSources');
  sources.replaceChildren();
  for (const source of evidenceView.sources) {
    const row = document.createElement('li');
    row.textContent = source.name + ' ';
    for (const [action, name] of [['download', 'Download original'], ['delete', 'Delete source']]) {
      const button = document.createElement('button');
      button.className = 'btn ghost sm';
      button.dataset.sourceId = source.id;
      button.dataset.sourceAction = action;
      button.textContent = name;
      row.append(button);
    }
    sources.append(row);
  }
}

function selectField(values, current) {
  const input = document.createElement('select');
  input.className = 'select';
  input.append(option('', 'Choose…'), ...values.map((value) => Array.isArray(value) ? option(...value) : option(value)));
  input.value = current ?? '';
  return input;
}

function editEvidence(kind, record) {
  evidenceEditing = { kind, id: record?.id, revision: evidenceView.revision };
  const d = record?.data || {};
  const form = $('#evidenceForm');
  form.hidden = false;
  $('#evidenceFormTitle').textContent = (record ? 'Review ' : 'Add ') + kindName[kind];
  $('#evidenceReadout').textContent = record
    ? [record.status, record.provenance.kind, 'ID ' + record.id, 'updated ' + record.updatedAt.slice(0, 10)].join(' · ')
    : 'Save a draft for later review or approve the facts you have verified.';
  const comparisons = $('#evidenceConflicts');
  comparisons.replaceChildren();
  for (const id of record?.conflicts || []) {
    const other = evidenceView.records.find((item) => item.id === id);
    if (!other) continue;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Compare with ' + recordLabel(other).slice(0, 100);
    const data = document.createElement('pre');
    data.textContent = JSON.stringify(other.data, null, 2);
    details.append(summary, data);
    comparisons.append(details);
  }
  $('#replaceEvidence').checked = false;
  const fields = $('#evidenceFields');
  fields.replaceChildren();
  for (const spec of evidenceView.fields[kind]) {
    const label = document.createElement('label');
    label.className = 'field';
    label.textContent = fieldName(spec.key) + (spec.required ? ' *' : '');
    const value = d[spec.key];
    let input;
    if (spec.key === 'scope') input = selectField(['site', 'job', 'employer', 'global'], value);
    else if (spec.key === 'answerType') input = selectField(['text', 'choice', 'boolean', 'number', 'date'], value);
    else if (kind === 'standard' && spec.key === 'key') input = selectField(evidenceView.standardKeys, value);
    else if (spec.type === 'refs') {
      input = document.createElement('select');
      input.multiple = true;
      const allowed = kind === 'skill' ? ['employment', 'education', 'project', 'accomplishment'] : ['employment', 'project'];
      for (const item of evidenceView.records.filter((r) => allowed.includes(r.kind) && !['archived', 'rejected'].includes(r.status))) {
        const opt = option(item.id, recordLabel(item).slice(0, 110) + ' · ' + item.status);
        opt.selected = value?.includes(item.id);
        input.append(opt);
      }
    } else {
      const multiline = ['metrics', 'list', 'urlList', 'emailList'].includes(spec.type) ||
        ['response', 'original', 'context', 'summary', 'description', 'details'].includes(spec.key);
      input = document.createElement(multiline ? 'textarea' : 'input');
      input.value = spec.type === 'metrics' ? (value ? JSON.stringify(value, null, 2) : '') :
        Array.isArray(value) ? value.join('\n') : value ?? '';
      if (spec.type === 'metrics') input.placeholder = '[{"value":"12.50","unit":"%","label":"Time saved"}]';
      if (['list', 'urlList', 'emailList'].includes(spec.type)) input.placeholder = 'One value per line';
      if (spec.key === 'scopeValue') input.placeholder = 'Site origin, exact job URL, or employer name';
      if (spec.key === 'response' && kind === 'answer') input.placeholder = 'For boolean answers, enter true or false';
    }
    input.name = spec.key;
    input.dataset.kind = spec.type;
    label.append(input);
    fields.append(label);
  }
  for (const button of form.querySelectorAll('[data-existing-evidence]')) button.hidden = !record;
  form.scrollIntoView({ block: 'nearest' });
}

function readEvidenceFields() {
  const fields = $('#evidenceFields').querySelectorAll('[name]');
  return Object.fromEntries([...fields].map((input) => {
    let value = input.value.trim();
    if (input.dataset.kind === 'refs') value = [...input.selectedOptions].map((entry) => entry.value);
    else if (['list', 'urlList', 'emailList'].includes(input.dataset.kind)) value = value.split('\n').map((entry) => entry.trim()).filter(Boolean);
    else if (input.dataset.kind === 'metrics') value = value ? JSON.parse(value) : [];
    else if (input.name === 'response' && $('#evidenceFields [name=answerType]').value === 'boolean') {
      if (!['true', 'false'].includes(value.toLowerCase())) throw new Error('Enter true or false');
      value = value.toLowerCase() === 'true';
    }
    return [input.name, value];
  }));
}

async function saveEvidenceEdit(decision) {
  const data = ['reject', 'archive'].includes(decision) ? undefined : readEvidenceFields();
  const response = await api('/api/evidence/records', {
    method: 'POST', body: { ...evidenceEditing, decision, data, replace: $('#replaceEvidence').checked },
  });
  updateEvidenceView(response.state);
  $('#evidenceForm').hidden = true;
  renderProfile(await api('/api/profile'));
  toast(response.record.status === 'conflict' ? 'Conflict saved for review' : 'Applicant evidence saved');
}

async function downloadEvidence(endpoint, filename) {
  const blob = await api(endpoint, { raw: true });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

on('#evidenceAdd', async () => {
  if (!evidenceView) await loadEvidencePanel();
  editEvidence($('#evidenceKind').value);
});
on('#evidenceReload', loadEvidencePanel);
$('#evidenceFilter').addEventListener('change', () => { if (evidenceView) renderEvidence(); });
$('#evidenceRecords').addEventListener('click', (event) => {
  const id = event.target.closest('[data-evidence-record]')?.dataset.evidenceRecord;
  const record = evidenceView?.records.find((item) => item.id === id);
  if (event.isTrusted && record) editEvidence(record.kind, record);
});
$('#evidenceForm').addEventListener('click', (event) => {
  const button = event.target.closest('[data-evidence-decision]');
  if (!event.isTrusted || !button || !evidenceEditing) return;
  busy(button, async () => {
    const action = button.dataset.evidenceDecision;
    if (action === 'delete') {
      if (!window.confirm('Delete this private record? Linked records may require review.')) return;
      updateEvidenceView(await api('/api/evidence/records/' + evidenceEditing.id, { method: 'DELETE', body: { revision: evidenceEditing.revision } }));
      $('#evidenceForm').hidden = true;
      renderProfile(await api('/api/profile'));
    } else await saveEvidenceEdit(action);
  })().catch(() => {});
});
$('#evidenceSources').addEventListener('click', (event) => {
  const button = event.target.closest('[data-source-id]');
  if (!event.isTrusted || !button) return;
  const source = evidenceView.sources.find((item) => item.id === button.dataset.sourceId);
  if (!source) return;
  busy(button, async () => {
    const endpoint = '/api/evidence/sources/' + source.id;
    if (button.dataset.sourceAction === 'download') return downloadEvidence(endpoint, source.name);
    if (!window.confirm('Delete the original source and reopen linked facts for review?')) return;
    updateEvidenceView(await api(endpoint, { method: 'DELETE', body: { revision: evidenceView.revision } }));
    renderProfile(await api('/api/profile'));
  })().catch(() => {});
});
on('#evidenceExport', () => downloadEvidence('/api/evidence/export', 'applicant-evidence.json'));
on('#evidenceClear', async () => {
  if (!window.confirm('Delete all applicant evidence, stored originals, and profile backups on this installation?')) return;
  const state = await api('/api/evidence', { method: 'DELETE', body: { revision: evidenceView.revision, confirmed: true } });
  updateEvidenceView(state);
  $('#evidenceForm').hidden = true;
  renderProfile(null);
});

function showMissingAnswer(tab, field, scope, suggested, decision) {
  const queue = $('#missingAnswers');
  if ([...queue.children].some((el) => el.dataset.field === field.id)) return;
  const wrapper = document.createElement('div');
  wrapper.dataset.field = field.id;
  const label = document.createElement('p');
  label.textContent = field.label + (suggested === undefined ? ' · Needs your answer' : ' · Previously approved for this context: ' + suggested + '. Enter it directly on the form.');
  wrapper.append(label);
  if (field.help) {
    const help = document.createElement('p');
    help.className = 'hint';
    help.textContent = field.help;
    wrapper.append(help);
  }
  if (decision || field.filled || field.entry) { queue.append(wrapper); return; }

  let type = ['radio', 'dropdown', 'combobox', 'select'].includes(field.type) && field.options?.length ? 'choice' : 'text';
  if (field.type === 'checkbox') type = 'boolean';
  else if (field.type === 'number') type = 'number';
  else if (['date', 'month'].includes(field.type)) type = 'date';
  const input = type === 'choice' ? selectField(field.options, '') : type === 'boolean'
    ? selectField([['true', 'Yes'], ['false', 'No']], '') : document.createElement('input');
  input.setAttribute('aria-label', 'Approved response for ' + field.label.slice(0, 100));
  const scopeChoice = selectField([['site', 'This site'], ['job', 'This page'], ['global', 'Any application']], 'site');
  scopeChoice.setAttribute('aria-label', 'Reuse scope');
  const button = document.createElement('button');
  button.className = 'btn ghost sm';
  button.textContent = 'Approve and save this answer';
  button.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    busy(button, async () => {
      const current = await activeTab();
      if (current.id !== tab.id || current.url !== scope.url || scopeFor(current).run !== scope.run) {
        throw new Error('The application changed. Rescan the form before saving an answer.');
      }
      if (!input.value.trim()) throw new Error('Enter the answer you approve');
      const evidence = await api('/api/evidence');
      const page = new URL(field.contextUrl || scope.url);
      await api('/api/evidence/records', { method: 'POST', body: {
        kind: 'answer', decision: 'approve', revision: evidence.revision,
        data: {
          question: field.label, qualifier: field.help || '', answerType: type,
          response: type === 'boolean' ? input.value === 'true' : input.value,
          scope: scopeChoice.value,
          scopeValue: scopeChoice.value === 'site' ? page.origin : scopeChoice.value === 'job' ? page.href : '',
        },
      } });
      wrapper.remove();
      toast('Approved answer saved. Choose Continue to use it.');
    })().catch(() => {});
  });
  wrapper.append(input, scopeChoice, button);
  queue.append(wrapper);
}

on('#useAnswerContext', async () => {
  const tab = await activeTab();
  state.answerContext = {
    url: tab.url, tabId: tab.id,
    values: { employer: $('#answerEmployer').value.trim(), country: $('#answerCountry').value.trim(), employmentType: $('#answerWorkType').value.trim() },
  };
  toast('Answer context set for this application page');
});

$('#evidenceDetails').addEventListener('toggle', () => {
  if ($('#evidenceDetails').open && !evidenceView) loadEvidencePanel().catch((error) => toast(error.message, true));
});
