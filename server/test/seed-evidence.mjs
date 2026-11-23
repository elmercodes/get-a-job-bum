// Converts the known fictional regression profile into explicitly reviewed fixtures.
import fs from 'node:fs';
import { migrateProfile } from '../src/evidence-profile.js';

const filename = process.argv[2];
if (!filename) throw new Error('Supply the disposable fictional fixture path');
const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
fs.writeFileSync(filename, JSON.stringify(migrateProfile(data, { approvedFixture: true })), { mode: 0o600 });
