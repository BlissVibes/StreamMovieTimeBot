// Prints the version and Markdown release notes for the newest changelog
// entry, for the release workflow: `node scripts/release-notes.mjs`.
import { VERSION, CHANGES } from '../public/version.js';

const c = CHANGES[0];
if (c.version !== VERSION) throw new Error(`Newest changelog entry is ${c.version}, VERSION is ${VERSION}`);
const lines = [];
if (c.title) lines.push(`**${c.title}**`, '');
for (const s of c.sections) {
  lines.push(`### ${s.heading}`, '', ...s.items.map(i => `- ${i}`), '');
}
lines.push(`Full changelog: https://movietimer.blissvibes.workers.dev/changelog`);
console.log(lines.join('\n'));
