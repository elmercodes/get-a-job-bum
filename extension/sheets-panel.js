const sheetsBase = '/api/sheets';
let sheetStatus;
let sheetsBusy = false;

function sheetsNode(tag, content, parent) {
  const node = document.createElement(tag);
  node.textContent = content;
  parent.append(node);
  return node;
}

function sheetsView(value) {
  sheetStatus = value;
  const labels = { disabled: 'Sync disabled', enabled: 'Sync enabled', retry_scheduled: 'Retry scheduled',
    authentication_required: 'Google authorization required', error: 'Sync needs attention' };
  const counts = Object.entries(value.counts).map(([name, total]) => total + ' ' + name.replaceAll('_', ' '));
  $('#sheetsStatus').textContent = [value.configured ? labels[value.state] : 'Configure a Google Desktop OAuth client on the backend.',
    value.authorizing ? 'Waiting for Google authorization' : value.connected ? 'Google connected' : 'Google disconnected',
    value.running && 'Synchronizing', ...counts, value.error, value.lastVerified && 'Last verified ' + new Date(value.lastVerified).toLocaleString()].filter(Boolean).join(' · ');
  $('#sheetsConnect').disabled = !value.configured || value.connected;
  $('#sheetsDisconnect').disabled = !(value.connected || value.authorizing || value.enabled);
  $('#sheetsCreate').disabled = !value.connected || value.enabled || Boolean(value.target?.selected && !value.creationPending);
  $('#sheetsCreate').textContent = value.creationPending ? 'Find pending tracker' : 'Create tracker spreadsheet';
  $('#sheetsClearPending').hidden = !value.creationPending || !value.connected || value.enabled;
  $('#sheetsSelect').disabled = !value.connected || value.enabled;
  $('#sheetsToggle').textContent = value.enabled ? 'Disable sync' : 'Enable sync';
  $('#sheetsToggle').disabled = !value.enabled && (!value.connected || !value.target?.selected);
  $('#sheetsRetry').disabled = !value.enabled || !value.connected;
  const link = $('#sheetsLink');
  link.hidden = !value.target || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit#gid=\d+$/.test(value.target.url);
  link.href = link.hidden ? '#' : value.target.url;
  link.textContent = value.target?.selected ? 'Open linked spreadsheet' : 'Open previously linked spreadsheet';
  const conflicts = $('#sheetsConflicts');
  conflicts.replaceChildren();
  for (const item of value.attention) {
    const row = sheetsNode('div', '', conflicts);
    sheetsNode('p', [item.title || 'Application', item.state.replaceAll('_', ' '), item.reason].filter(Boolean).join(' · '), row);
    if (item.state !== 'conflict' && item.state !== 'remote_retained') continue;
    for (const [choice, label] of [['restore', 'Restore local values'], ['keep_remote', 'Retain spreadsheet-only values']]) {
      const button = sheetsNode('button', label, row);
      button.type = 'button';
      button.className = 'btn ghost sm';
      button.disabled = choice === 'restore' ? !item.canRestore : item.state === 'remote_retained';
      button.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        sheetsAction(() => sheetsPost('/conflicts/' + encodeURIComponent(item.id), { choice })).catch(() => {});
      });
    }
  }
}

const sheetsPost = (path, body = {}) => api(sheetsBase + path, { method: 'POST', body });
const sheetsRefresh = () => api(sheetsBase + '/status');
async function sheetsAction(fn) {
  if (sheetsBusy) return;
  sheetsBusy = true;
  try {
    const next = await fn();
    if (next) sheetsView(next);
  } catch (error) {
    $('#sheetsStatus').textContent = error.message;
    throw error;
  } finally { sheetsBusy = false; }
}

$('#sheetsPanel').addEventListener('toggle', () => {
  if ($('#sheetsPanel').open) sheetsAction(sheetsRefresh).catch(() => {});
});
on('#sheetsRefresh', () => sheetsAction(sheetsRefresh));
on('#sheetsConnect', () => sheetsAction(async () => {
  const { url } = await sheetsPost('/connect');
  if (!/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/.test(url)) throw new Error('Google did not provide an authorization link.');
  await chrome.tabs.create({ url });
  return sheetsRefresh();
}));
on('#sheetsDisconnect', () => sheetsAction(async () => {
  const result = await sheetsPost('/disconnect');
  if (!result.revoked) toast('Local credentials cleared. Review connected apps in your Google Account.', true);
  return result;
}));
on('#sheetsCreate', () => sheetsAction(() => sheetsPost('/destination', { action: 'create' })));
on('#sheetsClearPending', () => sheetsAction(() => {
  if (!window.confirm('Clear this pending request? If Google already created a spreadsheet, it will stay in Drive.')) return;
  return sheetsPost('/destination', { action: 'clear_pending', confirmed: true });
}));
on('#sheetsSelect', () => sheetsAction(() => sheetsPost('/destination', { action: 'select', spreadsheet: $('#sheetsDestination').value })));
on('#sheetsToggle', () => sheetsAction(() => sheetsPost('/settings', { enabled: !sheetStatus?.enabled })));
on('#sheetsRetry', () => sheetsAction(() => sheetsPost('/retry')));
setInterval(() => {
  if ($('#sheetsPanel').open && $('#tab-tracker').classList.contains('active') && !sheetsBusy) {
    // Refresh automatically while waiting for a consent result or while sync is enabled.
    if (sheetStatus?.authorizing || sheetStatus?.enabled) sheetsAction(sheetsRefresh).catch(() => {});
  }
}, 5000);
