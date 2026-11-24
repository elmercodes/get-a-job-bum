import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DocxError } from './docx-engine.js';

const exec = promisify(execFile);
const commands = ['/usr/bin/bwrap', '/usr/bin/libreoffice', '/usr/bin/pdftotext', '/usr/bin/pdfinfo'];
const unavailable = (reason) => ({ status: 'unavailable', warnings: [reason] });

async function sandbox(directory, command, args) {
  return exec(commands[0], [
    '--unshare-all', '--die-with-parent', '--clearenv',
    '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'LANG', 'C.UTF-8',
    '--setenv', 'XDG_CACHE_HOME', '/tmp/cache',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--ro-bind', '/usr', '/usr', '--ro-bind-try', '/bin', '/bin',
    '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
    '--ro-bind-try', '/etc/fonts', '/etc/fonts',
    '--ro-bind-try', '/etc/ld.so.cache', '/etc/ld.so.cache',
    '--ro-bind-try', '/var/cache/fontconfig', '/var/cache/fontconfig',
    '--ro-bind-try', '/etc/libreoffice', '/etc/libreoffice',
    '--ro-bind-try', '/var/lib/libreoffice', '/var/lib/libreoffice',
    '--ro-bind', path.join(directory, 'passwd'), '/etc/passwd',
    '--ro-bind', path.join(directory, 'group'), '/etc/group',
    '--bind', directory, '/work', '--chdir', '/work',
    command, ...args,
  ], { timeout: 30000, maxBuffer: 2 * 1024 * 1024, killSignal: 'SIGKILL' });
}

async function convert(directory, name) {
  const conversion = await sandbox(directory, commands[1], [
    '--headless', '--nologo', '--nodefault', '--norestore',
    '-env:UserInstallation=file:///work/lo-profile',
    '--convert-to', 'pdf:writer_pdf_Export', '--outdir', '/work', '/work/' + name + '.docx',
  ]);
  const filename = path.join(directory, name + '.pdf');
  const stat = await fs.stat(filename).catch((error) => {
    throw Object.assign(error, { stdout: conversion.stdout, stderr: conversion.stderr });
  });
  if (!stat.isFile() || stat.size > 15 * 1024 * 1024) throw new DocxError('LAYOUT_INVALID', 'The PDF does not meet the file-size limit.');
  const pdf = await fs.readFile(filename);
  const [info, text] = await Promise.all([
    sandbox(directory, commands[3], ['/work/' + name + '.pdf']),
    sandbox(directory, commands[2], ['-raw', '/work/' + name + '.pdf', '-']),
  ]);
  const pages = Number(info.stdout.match(/^Pages:\s+(\d+)$/m)?.[1]);
  if (pdf.subarray(0, 5).toString() !== '%PDF-' || !Number.isInteger(pages) || pages < 1 || !text.stdout.trim()) {
    throw new DocxError('LAYOUT_INVALID', 'The converter did not produce a readable PDF.');
  }
  return { pdf, pages, text: text.stdout, size: info.stdout.match(/^Page size:\s+(.+)$/m)?.[1] || null };
}

const compact = (value) => value.normalize('NFKC').replace(/[\s\u00ad]/gu, '');

function hasAllText(text, paragraphs) {
  const counts = new Map();
  for (const value of paragraphs.map(compact).filter(Boolean)) counts.set(value, 1 + (counts.get(value) || 0));
  for (const [value, expected] of counts) {
    let next = 0;
    for (let index = 0; index < expected; index++) {
      const found = text.indexOf(value, next);
      if (found < 0) return false;
      next = found + value.length;
    }
  }
  return true;
}

export async function verifyLayout({ staging, source, output, readable, pagePreference, includePdf }) {
  if (process.env.AUTOJOB_DOCX_DISABLE_RENDER === '1' || process.platform !== 'linux' || !commands.every(existsSync)) {
    return unavailable('PDF and pagination checks require the local Linux LibreOffice, Poppler, and Bubblewrap tools.');
  }
  const directory = await fs.mkdtemp(path.join(staging, 'layout-'));
  try {
    const uid = process.getuid();
    const gid = process.getgid();
    await Promise.all([
      fs.writeFile(path.join(directory, 'passwd'), 'renderer:x:' + uid + ':' + gid + '::/work:/bin/false\n'),
      fs.writeFile(path.join(directory, 'group'), 'renderer:x:' + gid + ':\n'),
    ]);
    try {
      await sandbox(directory, '/usr/bin/true', []);
    } catch {
      return unavailable('The local renderer sandbox could not start. DOCX validation used structure and extracted text.');
    }
    await Promise.all([
      fs.writeFile(path.join(directory, 'source.docx'), source),
      fs.writeFile(path.join(directory, 'customized.docx'), output),
    ]);
    const before = await convert(directory, 'source');
    const after = await convert(directory, 'customized');
    const text = compact(after.text);
    if (!hasAllText(text, readable)) {
      throw new DocxError('LAYOUT_TEXT_LOSS', 'Some expected resume text is missing from the rendered document. Shorten edits or review this template.');
    }
    if (pagePreference === 'one-page' && after.pages !== 1) {
      throw new DocxError('PAGE_LIMIT', 'The one-page preference was exceeded. Shorten an accepted edit or choose a flexible length.',
        { originalPages: before.pages, pages: after.pages });
    }
    const warnings = [];
    if (before.pages !== after.pages) warnings.push('Layout changed from ' + before.pages + ' to ' + after.pages + ' pages. Review the output or shorten the proposed wording.');
    if (before.size && after.size && before.size !== after.size) {
      throw new DocxError('LAYOUT_GEOMETRY', 'The renderer reported different page dimensions.');
    }
    return { status: 'verified', renderer: 'LibreOffice Writer + Poppler', originalPages: before.pages, pages: after.pages,
      originalPageSize: before.size, pageSize: after.size, warnings, ...(includePdf ? { pdf: after.pdf } : {}) };
  } catch (error) {
    if (error instanceof DocxError) throw error;
    throw Object.assign(new DocxError('LAYOUT_FAILED', 'The isolated renderer could not validate this document. Review the source layout or try a different template.'), { cause: error });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
