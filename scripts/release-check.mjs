import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (program, args) => execFileSync(program, args, { cwd: root, encoding: 'utf8' });
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

for (const args of [['diff', '--check'], ['diff', '--cached', '--check']]) run('git', args);
const paths = run('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z']).split('\0');
const sources = [...new Set(paths)].filter((item) => /^(extension|server\/src|server\/test|scripts)\/.+\.(js|mjs)$/.test(item) && fs.existsSync(path.join(root, item)));
for (const filename of sources) run(process.execPath, ['--check', filename]);
assert.match(read('LICENSE'), /Permission is hereby granted, free of charge/);
assert.match(read('third_party_licenses/Application-Assistant.txt'), /Permission is hereby granted, free of charge/);
assert.match(read('NOTICE.md'), /e795a42bfe058c65f1530bbf68c9a1f09dea7f1d/);

const compatible = new Set(['(MIT AND Zlib)', '(MIT OR EUPL-1.1+)', '(MIT OR GPL-3.0-or-later)',
  '0BSD', 'Apache-2.0', 'BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT', 'MIT-0', 'MIT/X11', 'Unlicense']);
const packages = JSON.parse(read('server/package-lock.json')).packages;
for (const [name, details] of Object.entries(packages)) {
  if (details.license) {
    assert.ok(compatible.has(details.license), 'Review the license for ' + name);
    continue;
  }
  const installed = path.join(root, 'server', name);
  // The npm tarball predates the author's MIT/X11 declaration for 0.1.1.
  // Require the installed source to match that exact reviewed upstream revision.
  if (name === 'node_modules/buffers' && details.version === '0.1.1') {
    const checksum = createHash('sha256').update(fs.readFileSync(path.join(installed, 'index.js'))).digest('hex');
    assert.equal(checksum, '97801e296ba5f3c32242f647e1daac5917e300367fed7935ab1e62f40adb1b8a');
    continue;
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
  const licenseNames = [metadata.license, ...(metadata.licenses || [])].filter(Boolean)
    .map((entry) => typeof entry === 'string' ? entry : entry.type);
  if (licenseNames.length) assert.ok(licenseNames.every((name) => compatible.has(name)), 'Review the license for ' + name);
  else {
    const license = fs.readdirSync(installed).find((item) => /^licen[cs]e(?:\.|$)/i.test(item));
    assert.ok(license && /Permission is hereby granted, free of charge/.test(fs.readFileSync(path.join(installed, license), 'utf8')),
      'Review the missing license metadata for ' + name);
  }
}
console.log('Release checks: ' + sources.length + ' JS syntax checks, whitespace, upstream notices and dependency license metadata passed');
