import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION, CHANGES } from '../public/version.js';

const semver = /^\d+\.\d+\.\d+$/;
const parse = v => v.split('.').map(Number);
const newer = (a, b) => { const [x, y] = [parse(a), parse(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

test('VERSION, package.json and the newest changelog entry agree', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.match(VERSION, semver);
  assert.equal(pkg.version, VERSION);
  assert.equal(CHANGES[0].version, VERSION);
});

test('changelog entries are complete and newest first', () => {
  CHANGES.forEach((c, i) => {
    assert.match(c.version, semver, c.version);
    assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/, c.version);
    assert.ok(c.sections.length && c.sections.every(s => s.heading && s.items.length), c.version);
    if (i) assert.ok(newer(CHANGES[i - 1].version, c.version), `${CHANGES[i - 1].version} should be newer than ${c.version}`);
  });
});
