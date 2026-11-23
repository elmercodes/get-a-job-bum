import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.umask(0o077);

const legacyRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const defaultRoot = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Get a Job Bum')
  : process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Get a Job Bum')
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'get-a-job-bum');
export const DATA_DIR = process.env.AUTOJOB_DATA ? path.resolve(process.env.AUTOJOB_DATA) : defaultRoot;

// Resolve existing ancestors so a symlink cannot route applicant data into a
// trackable checkout path. The two explicit local-development roots are ignored.
function effectivePath(dir) {
  const parent = path.dirname(dir);
  if (fs.existsSync(dir) || parent === dir) return fs.realpathSync(dir);
  return path.join(effectivePath(parent), path.basename(dir));
}
const worktree = effectivePath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const relativeData = path.relative(worktree, effectivePath(DATA_DIR));
if (!relativeData || (!path.isAbsolute(relativeData) && relativeData !== '..' &&
    !relativeData.startsWith('..' + path.sep) && !['data', 'private_data'].includes(relativeData.split(path.sep)[0]))) {
  throw new Error('Applicant data requires storage outside the checkout or an ignored data directory');
}

if (!process.env.AUTOJOB_DATA && !fs.existsSync(defaultRoot) && fs.existsSync(legacyRoot)) {
  throw new Error('Legacy data detected. Back it up and copy it into the private application data folder or set AUTOJOB_DATA explicitly.');
}
export const RESUME_DIR = path.join(DATA_DIR, 'resumes');
export const DOCS_DIR = path.join(DATA_DIR, 'documents');
fs.mkdirSync(RESUME_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(DOCS_DIR, { recursive: true, mode: 0o700 });

export function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export function writeJSON(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx', flush: true });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
