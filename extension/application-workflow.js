// Loaded after the existing side panel. The trusted panel owns the API credential
// and the current application's review. Content scripts receive individual permits.
const preferenceFields = { privacy: 'prefPrivacy', legal: 'prefLegal', background: 'prefBackground', signature: 'prefSignature' };

async function loadAutomation() {
  const settings = await api('/api/automation/settings');
  for (const [kind, id] of Object.entries(preferenceFields)) $('#' + id).checked = settings.preferences[kind] === true;
  $('#automationState').textContent = [
    String(settings.rememberedPrivacyCount || 0) + ' remembered privacy notices.',
    settings.hasSignature ? 'Signature stored locally.' : 'No signature stored.',
    settings.profileFactsVerified ? 'Profile facts reviewed.' : 'Review your saved profile before certifying facts.',
  ].join(' ');
}

async function saveAutomation() {
  const preferences = Object.fromEntries(Object.entries(preferenceFields).map(([kind, id]) => [kind, $('#' + id).checked]));
  await api('/api/automation/settings', { method: 'PUT', body: {
    preferences, signature: $('#typedSignature').value, removeSignature: $('#removeSignature').checked,
    verifyProfile: $('#verifyFacts').checked, clearVerification: $('#clearVerification').checked, clearPrivacy: $('#clearPrivacy').checked,
  } });
  $('#typedSignature').value = '';
  for (const id of ['removeSignature', 'verifyFacts', 'clearVerification', 'clearPrivacy']) $('#' + id).checked = false;
  await loadAutomation();
  toast('Automation preferences saved');
}

function scopeFor(tab) {
  const origin = new URL(tab.url).origin;
  if (state.workflow?.tabId !== tab.id || state.workflow.origin !== origin) {
    state.workflow = { id: crypto.randomUUID(), tabId: tab.id, origin, activity: [], attachments: new Map() };
    $('#authorizationQueue').replaceChildren();
    $('#missingAnswers').replaceChildren();
    $('#applicationAudit').replaceChildren();
  }
  if (state.workflow.url !== tab.url) {
    state.workflow.url = tab.url;
    $('#authorizationQueue').replaceChildren();
    $('#missingAnswers').replaceChildren();
  }
  const context = state.answerContext;
  return { run: state.workflow.id, url: tab.url,
    ...(context?.tabId === tab.id && context.url === tab.url ? { context: context.values } : {}),
  };
}

function attachmentApproved(tab, field, doc) {
  const scope = scopeFor(tab);
  const key = JSON.stringify([scope.url, field.key, field.label, doc.filename]);
  if (state.workflow.attachments.get(key) === doc.base64) return true;
  const queue = $('#authorizationQueue');
  if ([...queue.children].some((el) => el.dataset.attachment === key)) return false;
  const button = document.createElement('button');
  button.className = 'btn ghost';
  button.dataset.attachment = key;
  button.textContent = 'Approve attachment: ' + doc.filename;
  button.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    busy(button, async () => {
      const current = await activeTab();
      if (current.id !== tab.id || current.url !== scope.url || scopeFor(current).run !== scope.run) {
        throw new Error('The application changed. Review the attachment again.');
      }
      state.workflow.attachments.set(key, doc.base64);
      button.remove();
      toast('Attachment approved. Choose Continue to resume.');
    })().catch(() => {});
  });
  queue.append(button);
  return false;
}

function noteAuthorization(field, decision, scope, result) {
  const entry = { category: decision.category, required: !!field.required, authorization: decision.state, handled: result === 'filled', alreadyChecked: !!field.filled };
  state.workflow.activity.push(entry);
  state.workflow.activity = state.workflow.activity.slice(-80);
  chrome.storage.session.set({ applicationActivity: state.workflow.activity }).catch(() => {});
  renderActivity(state.workflow.activity);
  if (decision.state !== 'approval_required' || field.filled) return;
  const queue = $('#authorizationQueue');
  if ([...queue.children].some((el) => el.dataset.field === field.id)) return;
  const detail = document.createElement('details');
  detail.dataset.field = field.id;
  detail.open = true;
  const title = document.createElement('summary');
  title.textContent = field.label;
  detail.append(title);
  const copy = document.createElement('p');
  copy.textContent = field.terms || 'Review the disclosure on the application page.';
  detail.append(copy);
  for (const url of field.links || []) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open employer disclosure';
    detail.append(link, document.createElement('br'));
  }
  const remember = document.createElement('input');
  remember.type = 'checkbox';
  if (decision.category === 'privacy' && field.terms?.length >= 30 && !field.links?.length) {
    const label = document.createElement('label');
    label.append(remember, ' Remember these exact inline terms on this employer origin for 90 days');
    detail.append(label);
  }
  const approve = document.createElement('button');
  approve.className = 'btn ghost';
  approve.textContent = 'I reviewed these terms and approve this field';
  approve.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    busy(approve, async () => {
      const tab = await activeTab();
      if (tab.url !== scope.url || scopeFor(tab).run !== scope.run) throw new Error('The application changed. Start Fill again.');
      await api('/api/automation/acknowledge', { method: 'POST', body: { field, scope, remember: remember.checked } });
      detail.remove();
      toast('Authorization saved for this application. Choose Continue to resume.');
    })().catch(() => {});
  });
  detail.append(approve);
  queue.append(detail);
}

function renderActivity(activity) {
  $('#applicationAudit').replaceChildren(...activity.map((entry) => {
    const row = document.createElement('p');
    row.className = 'hint';
    row.textContent = [
      entry.category, entry.required ? 'required' : 'optional',
      entry.handled ? 'completed with stored authorization' :
        entry.authorization === 'approval_required' ? 'approval requested' :
        entry.category === 'marketing' ? (entry.alreadyChecked ? 'already checked on the portal, review it' : 'left unchecked by the assistant') : 'review on application page',
    ].join(' · ');
    return row;
  }));
}

function clearSubmissionReview() {
  state.submission = null;
  $('#submit').hidden = true;
  $('#submit').disabled = true;
}

async function reviewApplication() {
  if (state.fillActive) throw new Error('Finish or stop filling before review');
  clearSubmissionReview();
  const tab = await activeTab();
  const frames = await callAll(tab.id, 'prepareSubmit');
  const target = frames.find((frame) => frame.frameId === 0 && frame.result);
  if (!target || !target.documentId || target.result.url !== tab.url) {
    throw new Error('Review the form on the application page. Assisted submission requires a validated, same-origin final button.');
  }
  const review = target.result;
  const job = state.job?.url === tab.url
    ? { ...currentJob(), url: state.job.url } : { url: tab.url };
  const entry = await api('/api/submissions/review', { method: 'POST', body: { ...review, job } });
  state.submission = { tabId: tab.id, documentId: target.documentId, review, id: entry.id };
  $('#submitOut').textContent = 'Prepared for ' + new URL(review.url).hostname + '. Review the filled fields and any alerts. Approval clicks “' + review.label + '” once.';
  $('#submit').hidden = false;
  $('#submit').disabled = false;
}

async function submit() {
  if (state.fillActive) throw new Error('Finish or stop filling before submission');
  const pending = state.submission;
  clearSubmissionReview();
  if (!pending) return;
  const tab = await activeTab();
  if (tab.id !== pending.tabId || tab.url !== pending.review.url) throw new Error('The application changed. Review it again.');
  const endpoint = '/api/submissions/' + pending.id;
  const approval = await api(endpoint + '/authorize', { method: 'POST', body: { ...pending.review, confirmed: true } });
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id, documentIds: [pending.documentId] },
    func: (permit) => window.__jobfill?.clickSubmit(permit),
    args: [approval],
  }).then((responses) => responses[0]?.result).catch(() => null);
  let receipt;
  // Native navigation can tear down the script before Chrome returns a result.
  for (let attempt = 0; attempt < 8 && !receipt; attempt++) {
    await sleep(700);
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    if (!current?.url || new URL(current.url).origin !== new URL(pending.review.url).origin) break;
    await inject(tab.id);
    receipt = await callFrame(tab.id, 0, 'submissionReceipt').catch(() => null);
  }
  await api(endpoint + '/result', { method: 'POST', body: { clicked: !!result?.ok || !!receipt, receipt } });
  $('#submitOut').textContent = receipt ? 'Submission verified by the employer confirmation page.'
    : 'Submission unverified. Check the employer portal and confirm the result from Tracker. The assistant will not retry this application.';
  await loadTracker();
}

on('#reviewApplication', reviewApplication);
$('#stopApplication').addEventListener('click', () => {
  state.fillStopped = true;
  clearSubmissionReview();
  progress('Stopping at the current step. Use Continue to resume.', 'bad');
});
function checkFill(tab) {
  if (state.fillStopped || (state.fillTab && (state.fillTab.id !== tab.id || new URL(state.fillTab.url).origin !== new URL(tab.url).origin))) {
    throw new Error('Filling paused. Use Continue from the intended application tab.');
  }
}
on('#saveAutomation', saveAutomation);
$('#submit').addEventListener('click', (event) => {
  if (event.isTrusted) busy(event.currentTarget, submit)().catch(() => {});
});
on('#pairServer', async () => {
  const server = $('#serverUrl').value.trim().replace(/\/$/, '');
  const token = $('#apiToken').value.trim();
  if (!loopback(server) || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Enter a loopback URL and the token from your private backend configuration');
  SERVER = server;
  API_TOKEN = token;
  await chrome.storage.local.set({ server, apiToken: token });
  $('#apiToken').value = '';
  await checkServer();
});

let pendingSite = '';
async function updateSitePermission() {
  const tab = await browserTab().catch(() => null);
  const url = tab?.url;
  pendingSite = '';
  if (url && /^https?:/.test(url) && !restrictedSite(url)) {
    const site = new URL(url);
    pendingSite = site.protocol + '//' + site.hostname + '/*';
    $('#grantSite').textContent = 'Allow access to ' + site.hostname;
  }
  $('#grantSite').disabled = !pendingSite;
  if (!pendingSite) $('#grantSite').textContent = 'Allow access to the current employer site';
}
$('#grantSite').addEventListener('click', () => {
  if (pendingSite) chrome.permissions.request({ origins: [pendingSite] }).then((granted) => {
    toast(granted ? 'Site access granted' : 'Site access declined');
  }).catch(() => toast('Open a permitted employer page and try again', true));
});
chrome.tabs.onActivated.addListener(updateSitePermission);
chrome.tabs.onUpdated.addListener(updateSitePermission);
updateSitePermission();
chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
chrome.storage.session.get('applicationActivity').then((stored) => {
  if (Array.isArray(stored.applicationActivity)) renderActivity(stored.applicationActivity);
});

$('#trackList').addEventListener('click', async (event) => {
  if (!event.isTrusted) return;
  const confirm = event.target.closest('[data-confirm-submission]');
  const artifact = event.target.closest('[data-artifact]');
  if (confirm) {
    busy(confirm, async () => {
      await api('/api/submissions/' + encodeURIComponent(confirm.dataset.confirmSubmission) + '/result',
        { method: 'POST', body: { manuallyConfirmed: true } });
      await loadTracker();
    })().catch(() => {});
  }
  if (artifact) {
    busy(artifact, async () => {
      const blob = await api('/api/resumes/' + encodeURIComponent(artifact.dataset.artifact), { raw: true });
      const url = URL.createObjectURL(blob);
      try { await chrome.tabs.create({ url }); } finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    })().catch(() => {});
  }
});
