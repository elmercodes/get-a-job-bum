import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, readJSON, writeJSON } from './storage.js';
import { APPLICATION_UUID, rowHash, trackerRow } from './tracker-schema.js';
import { SheetsError, sheetId } from './sheets-google.js';

const syncFile = path.join(DATA_DIR, 'google-sheets-sync.json');
const maxAttempts = 8;
const transient = new Set(['temporary', 'rate_limit']);
const conflictText = {
  missing: 'The matching application row was removed or its ID was changed.',
  changed: 'Managed cells changed in Google Sheets.',
  duplicate: 'More than one row has this application ID. Remove the duplicates in Sheets first.',
  ownership: 'The row’s ownership marker needs manual review. No row was written.',
};

export function createSheetsSync({ auth, adapter, listApplications, filename = syncFile, now = Date.now, jitter = Math.random }) {
  let state, storageError;
  try { state = readJSON(filename, null); } catch { storageError = true; }
  if (state && (state.version !== 1 || !APPLICATION_UUID.test(state.owner || '') ||
      !state.records || typeof state.records !== 'object' || Array.isArray(state.records))) storageError = true;
  if (!state || storageError) state = { version: 1, owner: randomUUID(), enabled: false, target: null, records: {}, nextAt: 0 };
  let running, control, timer, lock;
  const save = () => writeJSON(filename, state);
  const stamp = () => new Date(now()).toISOString();

  function claim() {
    if (storageError) throw new SheetsError('destination_invalid');
    if (lock) return;
    const name = filename + '.lock';
    const mine = { pid: process.pid, key: randomUUID() };
    try {
      fs.writeFileSync(name, JSON.stringify(mine), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const prior = readJSON(name, null);
      if (!Number.isInteger(prior?.pid) || prior.pid < 1) throw new SheetsError('changed');
      let stale = false;
      try { process.kill(prior.pid, 0); } catch (probe) { stale = probe.code === 'ESRCH'; }
      if (!stale || readJSON(name, null)?.key !== prior.key) throw new SheetsError('changed');
      fs.unlinkSync(name);
      fs.writeFileSync(name, JSON.stringify(mine), { flag: 'wx', mode: 0o600 });
    }
    lock = () => {
      if (readJSON(name, null)?.key === mine.key) fs.rmSync(name, { force: true });
    };
    process.once('exit', release);
    // A backend started while another was running could have read old settings.
    try {
      const durable = readJSON(filename, null);
      if (durable) state = durable;
    } catch (error) {
      release();
      throw error;
    }
  }
  function release() {
    process.removeListener('exit', release);
    try { lock?.(); } catch { /* A stale lock can be recovered after process exit. */ }
    lock = undefined;
  }

  function reconcile() {
    const entries = new Map();
    for (const app of listApplications()) {
      if (!APPLICATION_UUID.test(app.applicationId || '')) continue;
      const row = trackerRow(app);
      const hash = rowHash(row);
      entries.set(app.applicationId, { app, row, hash });
      const slot = state.records[app.applicationId] ||= {};
      if (slot.operation?.hash !== hash) {
        slot.operation = { id: randomUUID(), revision: app.revision, hash, createdAt: stamp(), attempts: 0,
          status: slot.ignored ? 'remote_retained' : slot.conflict ? 'conflict' : 'pending' };
      }
    }
    for (const id of Object.keys(state.records)) if (!entries.has(id)) delete state.records[id];
    return entries;
  }

  function conflict(slot, why, row) {
    slot.operation.status = 'conflict';
    slot.conflict = { why, hash: row?.hash || null };
    delete slot.restore;
  }
  function finished(slot, hash) {
    slot.ack = hash;
    slot.operation.status = 'synchronized';
    if (!slot.operation.completedAt) state.lastVerified = slot.operation.completedAt = stamp();
    delete slot.attempted;
    delete slot.conflict;
    delete slot.restore;
    delete slot.error;
    delete slot.operation.retryAt;
  }
  function classify(grid, uuid, slot, entry) {
    const matches = grid.matches.get(uuid) || [];
    const marker = adapter.marker(grid, uuid);
    if (slot.ignored) { slot.operation.status = 'remote_retained'; return null; }
    if (matches.length > 1) { conflict(slot, 'duplicate'); return null; }
    const row = matches[0];
    if (marker && !adapter.owns(marker, uuid)) { conflict(slot, 'ownership', row); return null; }
    if (row?.hash === entry.hash && marker) { finished(slot, entry.hash); return null; }
    if (slot.restore) {
      if ((row?.hash || null) !== slot.restore.hash) { conflict(slot, row ? 'changed' : 'missing', row); return null; }
      if (row && !marker) { conflict(slot, 'ownership', row); return null; }
      return { row, marker };
    }
    if (slot.conflict) return null;
    if (!row) {
      if (slot.ack || marker) { conflict(slot, 'missing'); return null; }
      return { row, marker };
    }
    if (!marker) { conflict(slot, 'ownership', row); return null; }
    if (row.hash === slot.ack || row.hash === slot.attempted) return { row, marker };
    conflict(slot, 'changed', row);
    return null;
  }
  function delay(error, attempts) {
    const backoff = Math.min(15 * 60_000, 3000 * 2 ** Math.max(0, attempts - 1));
    return Math.max(error.retryAfter || 0, Math.round(backoff * (0.75 + jitter() * 0.5)));
  }
  function fail(error, slot) {
    const code = error.code || 'temporary';
    const op = slot?.operation;
    if (op) {
      op.status = code === 'authentication_required' ? 'authentication_required' : 'error';
      slot.error = code;
    }
    if (transient.has(code) && (op ? op.attempts : state.failures || 0) < maxAttempts) {
      state.failures = (state.failures || 0) + 1;
      const retryAt = now() + delay(error, op?.attempts || state.failures);
      state.nextAt = Math.max(state.nextAt, retryAt);
      state.error = code;
      if (op) { op.status = 'retry_scheduled'; op.retryAt = retryAt; }
    } else if (!op || ['authentication_required', 'permission', 'destination_invalid', 'destination_missing'].includes(code)) {
      state.error = code;
      state.nextAt = Number.MAX_SAFE_INTEGER;
    }
    save();
  }

  async function synchronize(signal) {
    if (!state.enabled || !state.target) return;
    claim();
    if (!state.enabled || !state.target) return;
    const apps = reconcile();
    save();
    if (!auth.info().connected || now() < state.nextAt) return;
    const waiting = (slot) => !['synchronized', 'conflict', 'remote_retained', 'error'].includes(slot.operation.status) &&
      (!slot.operation.retryAt || slot.operation.retryAt <= now());
    const audit = !state.auditedAt || now() - state.auditedAt >= 120_000;
    if (!audit && ![...apps.keys()].some((id) => waiting(state.records[id]))) return;
    const { id, sheet } = state.target;
    let grid;
    const inspect = async () => {
      const snapshot = await adapter.inspect(id, state.owner, signal);
      if (snapshot.sheet !== sheet) throw new SheetsError('destination_invalid');
      return snapshot;
    };
    try { grid = await inspect(); } catch (error) { if (!signal.aborted) fail(error); return; }
    if (signal.aborted) return;
    if (audit) state.auditedAt = now();
    state.nextAt = 0;
    delete state.error;
    let count = 0;
    for (const [uuid, entry] of apps) {
      if (signal.aborted || count >= 4) break;
      const slot = state.records[uuid];
      const candidate = classify(grid, uuid, slot, entry);
      if (!candidate || !waiting(slot)) {
        // A previously verified row that no longer matches and has no pending local update is a conflict.
        if (candidate && slot.operation.status === 'synchronized') conflict(slot, 'changed', candidate.row);
        continue;
      }
      const latest = listApplications().find((app) => app.applicationId === uuid);
      if (!latest || rowHash(trackerRow(latest)) !== entry.hash) continue;
      const { row, marker } = candidate;
      const op = slot.operation;
      op.status = 'synchronizing';
      op.attempts++;
      op.lastAttemptAt = stamp();
      // Keep the observed baseline if another write fails before reaching Sheets.
      if (row) slot.ack = row.hash;
      slot.attempted = entry.hash;
      save();
      try {
        if (row) await adapter.replace(id, sheet, row.index, entry.row, signal);
        else await adapter.append(id, sheet, uuid, entry.row, marker, signal);
        if (signal.aborted) break;
        grid = await inspect();
        const match = (grid.matches.get(uuid) || []);
        const guard = adapter.marker(grid, uuid);
        if (match.length > 1) conflict(slot, 'duplicate');
        else if (match.length !== 1 || match[0].hash !== entry.hash || !adapter.owns(guard, uuid)) throw new SheetsError('temporary');
        else finished(slot, entry.hash);
        state.lastVerified = stamp();
        state.failures = 0;
        save();
      } catch (error) {
        if (!signal.aborted && error.code === 'request_invalid') {
          const fresh = await inspect().catch(() => null);
          const match = fresh?.matches.get(uuid);
          if (match?.length === 1 && match[0].hash === entry.hash && adapter.owns(adapter.marker(fresh, uuid), uuid)) {
            finished(slot, entry.hash);
            save();
            break;
          }
        }
        if (!signal.aborted) fail(error, slot);
        break;
      }
      count++;
    }
    if (!signal.aborted) save();
  }

  function run() {
    if (running) return running;
    control = new AbortController();
    const task = synchronize(control.signal).finally(() => { if (running === task) running = undefined; });
    running = task;
    return task;
  }
  async function stop() {
    control?.abort();
    await running?.catch(() => {});
  }
  function start() {
    if (timer) return;
    const tick = () => run().catch(() => {});
    timer = setInterval(tick, 15_000);
    timer.unref();
    tick();
  }
  async function close() {
    clearInterval(timer);
    timer = undefined;
    await stop();
    release();
  }

  function status() {
    const applications = listApplications();
    const rows = state.target ? applications.map((app) => {
      const slot = state.records[app.applicationId];
      const hash = rowHash(trackerRow(app));
      const label = slot?.ignored ? 'remote_retained' : slot?.conflict ? 'conflict'
        : slot?.operation?.hash === hash ? slot.operation.status : 'pending';
      return { id: app.applicationId, title: typeof app.title === 'string' ? app.title : '', state: label,
        reason: slot?.conflict ? conflictText[slot.conflict.why] : undefined,
        canRestore: slot?.conflict ? ['missing', 'changed'].includes(slot.conflict.why) : Boolean(slot?.ignored),
        ...(slot?.operation?.retryAt ? { retryAt: new Date(slot.operation.retryAt).toISOString() } : {}) };
    }) : [];
    const connection = auth.info();
    return { ...connection, enabled: state.enabled, running: Boolean(running && control && !control.signal.aborted),
      state: storageError ? 'error' : !state.enabled ? 'disabled' : !connection.connected ? 'authentication_required'
        : state.error ? (state.nextAt < Number.MAX_SAFE_INTEGER ? 'retry_scheduled' : 'error') : 'enabled',
      error: storageError ? 'The private Sheets settings file could not be read.' : state.error ? new SheetsError(state.error).message : undefined,
      lastVerified: state.lastVerified, creationPending: Boolean(state.creation?.sent),
      target: state.target && { id: state.target.id, selected: Boolean(state.destinationApproved),
        url: 'https://docs.google.com/spreadsheets/d/' + state.target.id + '/edit#gid=' + state.target.sheet },
      counts: Object.fromEntries([...new Set(rows.map((row) => row.state))].map((label) => [label, rows.filter((row) => row.state === label).length])),
      attention: rows.filter((row) => ['conflict', 'remote_retained', 'error', 'authentication_required'].includes(row.state)).slice(0, 100),
    };
  }

  async function settings(enabled) {
    claim();
    if (enabled && configuring) throw new SheetsError('changed');
    if (enabled && !auth.info().connected) throw new SheetsError('authentication_required');
    if (enabled && (!state.target || !state.destinationApproved)) throw new SheetsError('destination_invalid');
    state.enabled = enabled;
    save();
    if (!enabled) await stop();
    else run().catch(() => {});
    return status();
  }
  async function connect() {
    if (auth.info().connected) throw new SheetsError('changed');
    await settings(false);
    state.destinationApproved = false;
    save();
    return auth.begin();
  }
  async function disconnect() {
    configuring?.abort();
    await settings(false);
    state.destinationApproved = false;
    save();
    return { revoked: await auth.disconnect(), ...status() };
  }

  let configuring;
  async function destination(action, value, confirmed) {
    claim();
    if (state.enabled || !auth.info().connected || configuring) throw new SheetsError(state.enabled || configuring ? 'changed' : 'authentication_required');
    if (action === 'clear_pending') {
      if (!state.creation?.sent || confirmed !== true) throw new SheetsError('changed');
      delete state.creation;
      save();
      return status();
    }
    const operation = new AbortController();
    configuring = operation;
    try {
      let target;
      if (action === 'create') {
        // Repeated initialization clicks return the existing destination.
        if (state.target && state.destinationApproved && !state.creation) return status();
        state.creation ||= { id: randomUUID(), sent: false };
        save();
        target = await adapter.provision(state.creation, state.owner, (sent) => {
          state.creation.sent = sent;
          save();
        }, operation.signal);
      } else {
        const id = sheetId(value);
        target = { id, sheet: (await adapter.inspect(id, state.owner, operation.signal)).sheet };
      }
      if (operation.signal.aborted || !auth.info().connected) throw new SheetsError('authentication_required');
      if (state.target?.id !== target.id) {
        state.records = {};
        delete state.lastVerified;
      }
      state.target = target;
      state.destinationApproved = true;
      state.nextAt = state.auditedAt = 0;
      delete state.error;
      delete state.creation;
      reconcile();
      save();
      return status();
    } finally { configuring = undefined; }
  }
  async function retry() {
    claim();
    if (!state.enabled || !auth.info().connected) throw new SheetsError('authentication_required');
    if (state.nextAt === Number.MAX_SAFE_INTEGER) state.nextAt = 0;
    state.auditedAt = 0;
    state.failures = 0;
    for (const slot of Object.values(state.records)) {
      if (['error', 'authentication_required'].includes(slot.operation?.status)) {
        slot.operation.status = 'pending';
        slot.operation.attempts = 0;
      }
    }
    save();
    run().catch(() => {});
    return status();
  }
  async function resolve(uuid, choice) {
    claim();
    if (!APPLICATION_UUID.test(uuid) || !['restore', 'keep_remote'].includes(choice)) throw new SheetsError('changed');
    await stop();
    const slot = state.records[uuid];
    if (!slot || (!slot.conflict && !slot.ignored)) throw new SheetsError('changed');
    if (choice === 'keep_remote') {
      slot.ignored = true;
      slot.operation.status = 'remote_retained';
    } else {
      if (!['missing', 'changed'].includes(slot.conflict?.why)) throw new SheetsError('changed');
      slot.restore = { hash: slot.conflict.hash };
      delete slot.ignored;
      delete slot.conflict;
      slot.operation.status = 'pending';
      slot.operation.attempts = 0;
      delete slot.operation.retryAt;
    }
    save();
    if (state.enabled) run().catch(() => {});
    return status();
  }
  return { status, start, close, run, settings, connect, disconnect, destination, retry, resolve };
}
