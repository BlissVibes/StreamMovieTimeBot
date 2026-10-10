import { VERSION, CHANGES } from '/version.js';

const h = (tag, cls, ...kids) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.append(...kids);
  return el;
};

const badge = document.getElementById('version');
badge.textContent = `v${VERSION}`;

const fmtDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

document.getElementById('changelog').replaceChildren(...CHANGES.map(c => {
  const entry = h('section', 'release');
  entry.id = `v${c.version}`;
  entry.append(
    h('h2', 'release-head', h('span', 'release-version', `v${c.version}`), c.title ? ` ${c.title}` : ''),
    h('p', 'fine', fmtDate(c.date)),
    ...c.sections.flatMap(s => [
      h('h3', 'release-section', s.heading),
      h('ul', '', ...s.items.map(i => h('li', '', i))),
    ]),
  );
  return entry;
}));
