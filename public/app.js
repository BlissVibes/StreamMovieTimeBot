import * as core from '/core.js';
import { SAMPLES } from '/demo-movies.js';

// ================================================================ helpers

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const clone = v => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function debounce(fn, ms) {
  let t = null, args = [];
  const run = () => { t = null; return fn(...args); };
  const d = (...a) => { clearTimeout(t); args = a; t = setTimeout(run, ms); };
  d.now = (...a) => { clearTimeout(t); args = a; return run(); };   // run immediately
  d.flush = () => (t !== null ? (clearTimeout(t), run()) : undefined);   // run only if pending
  return d;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied');
}

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ================================================================ backends

const DEMO = new URLSearchParams(location.search).has('demo');

async function call(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (r.status === 401) { location.href = '/'; throw new Error('Logged out'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || (data.errors || []).join(', ') || `Error ${r.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

const serverApi = {
  async me() {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (r.status === 401) return null;
    if (!r.ok) throw new Error('Could not load your channel');
    return r.json();
  },
  action: (action, arg) => call('POST', '/api/action', { action, arg }),
  settings: patch => call('PUT', '/api/settings', patch),
  search: q => call('GET', `/api/search?q=${encodeURIComponent(q)}`),
  movie: body => call('POST', '/api/movie', body),
};

// Demo mode runs the same core logic locally against sample movies.
function makeDemoApi(samples) {
  let state = store.get('mc-demo') || { ...core.defaultState(), movie: { ...samples[0], fetchedAt: Date.now() } };
  state = { ...core.defaultState(), ...state, settings: { ...core.defaultSettings(), ...state.settings } };
  state.profile = { login: 'demo', displayName: 'DemoStreamer' };
  const save = () => store.set('mc-demo', state);
  const user = { id: 'demo', login: 'demo', name: 'DemoStreamer', accounts: [] };
  return {
    async me() { return { user, state: clone(state), now: Date.now(), baseUrl: location.origin }; },
    async action(action, arg) {
      const now = Date.now();
      const r = core.applyAction(state, action, arg, now);
      state.timer = r.timer;
      save();
      return { state: clone(state), reply: core.renderMessage(state, r.reply, now, { user: user.name }), now };
    },
    async settings(patch) {
      const { settings, errors } = core.mergeSettings(state.settings, patch);
      if (errors.length) { const e = new Error(errors.join(', ')); e.data = { errors }; throw e; }
      state.settings = settings;
      save();
      return { settings: clone(settings), errors };
    },
    async search(q) {
      const s = q.trim().toLowerCase();
      return { results: samples.filter(m => !s || m.title.toLowerCase().includes(s))
        .map(m => ({ tmdbId: m.tmdbId, title: m.title, year: m.year, poster: m.poster, overview: m.overview })) };
    },
    async movie(body) {
      if (body.clear) state.movie = null;
      else if (body.tmdbId) state.movie = { ...samples.find(m => m.tmdbId === body.tmdbId), fetchedAt: Date.now() };
      else if (body.custom) state.movie = { source: 'custom', ...body.custom };
      else if (body.overrides && state.movie) {
        const o = { ...state.movie.overrides };
        for (const [k, v] of Object.entries(body.overrides)) { if (v === null) delete o[k]; else o[k] = v; }
        state.movie.overrides = Object.keys(o).length ? o : undefined;
      }
      save();
      return { state: clone(state) };
    },
  };
}

let api = serverApi;

// ================================================================ state

const S = { user: null, state: null, offset: 0, baseUrl: location.origin };
const now = () => Date.now() + S.offset;
const settings = () => S.state.settings;

function apply(state, serverNow) {
  S.state = state;
  if (serverNow) S.offset = serverNow - Date.now();
  renderNow();
  renderMovie();
  renderCommands();
  renderPalette();
  renderPreview();
}

// ================================================================ header

function renderWho() {
  const who = $('#who');
  who.replaceChildren();
  if (DEMO) {
    who.append(h('a', { class: 'btn btn-small', href: '/' }, 'Exit demo'));
    return;
  }
  const others = S.user.accounts.filter(a => a.id !== S.user.id);
  const menu = h('details', { class: 'acct' },
    h('summary', { class: 'btn btn-small' }, S.user.name, ' ▾'),
    h('div', { class: 'acct-menu' },
      others.length ? h('div', { class: 'acct-label' }, 'Switch to') : null,
      others.map(a => h('form', { method: 'post', action: '/auth/switch' },
        h('input', { type: 'hidden', name: 'id', value: a.id }),
        h('button', { class: 'acct-item' }, a.name))),
      h('a', { class: 'acct-item', href: '/auth/login?add' }, '＋ Add another account'),
      h('form', { method: 'post', action: '/auth/logout' },
        h('button', { class: 'acct-item' }, `Log out ${S.user.name}`)),
      others.length ? h('form', { method: 'post', action: '/auth/logout' },
        h('input', { type: 'hidden', name: 'all', value: '1' }),
        h('button', { class: 'acct-item' }, 'Log out of all accounts')) : null,
    ));
  who.append(menu);
  document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.open = false; });
}

// ================================================================ tabs

function showTab(name) {
  if (!$(`[data-panel="${name}"]`)) name = 'now';
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `${location.search}#${name}`);
  if (name === 'messages') renderPreview();
}

// ================================================================ now playing

function movieView() {
  return core.effectiveMovie(S.state.movie);
}

function renderNow() {
  const m = movieView();
  const poster = $('#nowPoster');
  if (m?.poster) poster.src = m.poster; else poster.removeAttribute('src');
  $('#nowTitle').textContent = m ? `${m.title}${m.year ? ` (${m.year})` : ''}` : 'No movie picked yet';
  tick();
  const { status } = core.clockView(S.state, now());
  const enable = {
    start: status !== 'running',
    pause: status === 'running',
    resume: status === 'paused' || status === 'stopped',
    restart: true,
    reset: status !== 'idle',
    end: status === 'running' || status === 'paused' || status === 'stopped',
  };
  $$('#controls button').forEach(b => { b.disabled = !enable[b.dataset.act]; });
}

const STATUS_LABEL = { idle: 'Not started', running: 'Playing', paused: 'Paused', stopped: 'Stopped', ended: 'Ended' };
let lastStatus = null;

function tick() {
  if (!S.state) return;
  const v = core.clockView(S.state, now());
  const style = settings().timeStyle;
  $('#clock').textContent = core.formatDuration(v.elapsed, 'clock');
  $('#barFill').style.width = `${v.percent ?? 0}%`;
  $('#clockStatus').textContent = STATUS_LABEL[v.status] || v.status;
  $('#clockRemain').textContent = v.runtime
    ? `${core.formatDuration(Math.ceil(v.remaining / 1000) * 1000, style)} left of ${core.formatDuration(v.runtime, style)}`
    : '';
  const prev = lastStatus;
  lastStatus = v.status;
  if (prev && prev !== v.status) renderNow();   // e.g. auto-end: refresh the buttons
}

async function runAction(action, arg = '') {
  try {
    const r = await api.action(action, arg);
    apply(r.state, r.now);
    const p = $('#lastReply');
    p.hidden = false;
    p.replaceChildren(h('span', { class: 'fine' }, 'Chat would see: '), r.reply);
  } catch (e) { toast(e.message); }
}

// ================================================================ movie

const MOVIE_FORM = [
  { k: 'title', label: 'Title', wide: true, required: true },
  { k: 'year', label: 'Year', type: 'number' },
  { k: 'runtime', label: 'Runtime (minutes)', type: 'number' },
  { k: 'director', label: 'Director(s)', hint: 'Comma separated' },
  { k: 'rating', label: 'Rating (0–10)', type: 'number', step: '0.1' },
  { k: 'genres', label: 'Genres', hint: 'Comma separated' },
  { k: 'cast', label: 'Cast', hint: 'Comma separated' },
  { k: 'tagline', label: 'Tagline', wide: true },
  { k: 'imdbId', label: 'IMDb link or ID', wide: true, hint: 'e.g. https://www.imdb.com/title/tt0133093/' },
  { k: 'poster', label: 'Poster image URL', wide: true },
];
const asText = v => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));

function movieForm(form, values, placeholders, submitLabel, onSubmit, extra = []) {
  form.replaceChildren(
    ...MOVIE_FORM.map(f => h('label', { class: f.wide ? 'wide' : '' },
      h('span', { class: 'field-label' }, f.label),
      h('input', {
        name: f.k, type: f.type || 'text', step: f.step, required: f.required,
        value: asText(values[f.k]), placeholder: asText(placeholders[f.k]) || '',
      }),
      f.hint ? h('span', { class: 'hint' }, f.hint) : null)),
    h('div', { class: 'actions' }, h('button', { class: 'btn btn-go' }, submitLabel), ...extra),
  );
  form.onsubmit = e => {
    e.preventDefault();
    onSubmit(Object.fromEntries(new FormData(form)));
  };
}

let movieMode = 'search';

function renderMovie() {
  const m = movieView();
  const card = $('#currentMovie');
  if (m) {
    card.replaceChildren(...[
      m.poster ? h('img', { src: m.poster, alt: '' }) : null,
      h('div', { class: 'meta' },
        h('div', {}, `${m.title}${m.year ? ` (${m.year})` : ''}`),
        h('div', { class: 'fine' }, [m.runtime && `${m.runtime} min`, asText(m.director),
          S.state.movie.source === 'custom' ? 'Custom' : 'TMDB',
          S.state.movie.overrides ? 'edited' : null].filter(Boolean).join(' · '))),
      h('button', { class: 'btn btn-small', onclick: clearMovie }, 'Clear')].filter(Boolean));
  } else {
    card.replaceChildren(h('div', { class: 'meta' }, h('div', {}, 'No movie set'),
      h('div', { class: 'fine' }, 'Search below, or use !setmovie in chat.')));
  }
  $('#editModeBtn').disabled = !m;
  if (!m && movieMode === 'edit') setMovieMode('search');
  if (movieMode === 'edit') renderEditForm();
}

function setMovieMode(mode) {
  movieMode = mode;
  $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $$('[data-mode-panel]').forEach(p => { p.hidden = p.dataset.modePanel !== mode; });
  if (mode === 'custom') {
    movieForm($('#customForm'), {}, {}, 'Use this movie', async vals => {
      await setMovie({ custom: vals });
      setMovieMode('search');
    });
  }
  if (mode === 'edit') renderEditForm();
  if (mode === 'search') $('#search').focus();
}

function renderEditForm() {
  const base = S.state.movie;
  if (!base) return;
  const custom = base.source === 'custom';
  const eff = movieView();
  movieForm($('#editForm'), eff, custom ? {} : base, 'Save changes', async vals => {
    if (custom) return setMovie({ custom: vals }, 'Saved');
    // Only values that differ from TMDB become overrides; blank = TMDB value.
    const overrides = {};
    for (const f of MOVIE_FORM) {
      const v = vals[f.k].trim();
      overrides[f.k] = !v || v === asText(base[f.k]) ? null : v;
    }
    return setMovie({ overrides }, 'Saved');
  }, custom ? [] : [h('span', { class: 'hint' }, 'Blank fields fall back to TMDB.'),
    base.overrides ? h('button', { type: 'button', class: 'btn', onclick: () => {
      setMovie({ overrides: Object.fromEntries(MOVIE_FORM.map(f => [f.k, null])) }, 'Back to TMDB values');
    } }, 'Undo all edits') : null]);
}

async function setMovie(body, msg) {
  try {
    const r = await api.movie(body);
    apply(r.state);
    const m = movieView();
    toast(msg || (m ? `Now playing: ${m.title}` : 'Movie cleared'));
  } catch (e) { toast(e.message); }
}

function clearMovie() {
  if (confirm('Clear the current movie?')) setMovie({ clear: true });
}

const doSearch = debounce(async q => {
  const list = $('#results');
  if (!q.trim()) { list.replaceChildren(); return; }
  try {
    const { results } = await api.search(q);
    if ($('#search').value !== q) return;   // a newer search is on its way
    list.replaceChildren(...(results.length ? results.map(r => h('li', {
      tabindex: 0,
      onclick: () => setMovie({ tmdbId: r.tmdbId }),
      onkeydown: e => { if (e.key === 'Enter') setMovie({ tmdbId: r.tmdbId }); },
    },
      r.poster ? h('img', { src: r.poster, alt: '', loading: 'lazy' }) : h('div', { class: 'noimg' }),
      h('div', {}, h('div', { class: 'r-title' }, `${r.title}${r.year ? ` (${r.year})` : ''}`),
        h('div', { class: 'r-over' }, r.overview || '')))) : [h('li', { class: 'fine' }, 'No matches.')]));
  } catch (e) { toast(e.message); }
}, 350);

// ================================================================ message editor

let msgKey = 'time';
let draft = [];
const fieldInfo = Object.fromEntries(core.FIELDS.map(f => [f.k, f]));
const actionInfo = Object.fromEntries(core.ACTIONS.map(a => [a.k, a]));

function blockLabel(b) {
  if (b.t === 'f') return fieldInfo[b.k]?.label || b.k;
  if (b.t === 'c') return settings().commands[b.k] || b.k;
  return b.v;
}

function chip(b, { inTemplate = false, idx } = {}) {
  const cls = b.t === 'f' ? `chip f f-${fieldInfo[b.k]?.group}` : `chip ${b.t}`;
  return h('span', { class: cls, dataset: { block: JSON.stringify(b), ...(inTemplate && { idx }) }, title: inTemplate && b.t === 'x' ? 'Tap to edit' : null },
    h('span', { class: 'chip-text' }, blockLabel(b)),
    inTemplate ? h('button', { class: 'x-del', type: 'button', 'aria-label': 'Delete block' }, '✕') : null);
}

function renderTemplate() {
  const t = $('#template');
  t.replaceChildren(...draft.map((b, i) => chip(b, { inTemplate: true, idx: i })));
}

function renderPalette() {
  if (!S.state) return;
  const group = (title, blocks) => h('div', {}, h('h3', {}, title), h('div', { class: 'row palette-row' }, blocks.map(b => chip(b))));
  const fields = g => core.FIELDS.filter(f => f.group === g).map(f => ({ t: 'f', k: f.k }));
  $('#palette').replaceChildren(
    group('Movie', fields('movie')),
    group('Clock', fields('clock')),
    group('Chat', [...fields('chat'), ...core.ACTIONS.map(a => ({ t: 'c', k: a.k }))]),
    group('Text', [{ t: 'x', v: '+ Text', isNew: true }]),
  );
  makePaletteSortable();
}

const EMOJI = '🎬 🍿 🎥 📽️ 🎞️ 🎟️ ⏱️ ⏰ ⌛ ⏳ 🕐 ▶️ ⏸️ ⏹️ ⏩ ⏪ 🔁 ↩️ 🏁 ✅ ⚠️ 🚫 ❗ ❓ ⭐ 🌟 🔥 💯 👀 😂 😱 😭 🥹 😴 🤯 👻 💀 🎉 🎊 ❤️ 💜 🖤 👍 👏 🙌 ✨ 📺 🛋️ 🥤 🍕 🌙 ☕ · | / — •'.split(' ');

function renderEmoji() {
  $('#emojiGrid').replaceChildren(...EMOJI.map(e =>
    h('button', { type: 'button', dataset: { block: JSON.stringify({ t: 'x', v: e }) } }, e)));
}

function renderMessageSelect() {
  const sel = $('#msgSelect');
  const grp = (label, g) => h('optgroup', { label }, core.MESSAGES.filter(m => m.group === g)
    .map(m => h('option', { value: m.k, selected: m.k === msgKey }, m.label)));
  sel.replaceChildren(grp('Viewer replies', 'viewer'), grp('Mod replies', 'mod'));
}

function loadDraft() {
  draft = clone(core.templateFor(settings(), msgKey));
  renderTemplate();
  renderPreview();
  $('#saveState').textContent = settings().templates[msgKey] ? 'Customised' : 'Default';
}

function syncDraftFromDom() {
  draft = [...$('#template').children].map(el => {
    const b = JSON.parse(el.dataset.block);
    delete b.isNew;
    return b;
  });
}

function changed() {
  renderTemplate();
  renderPreview();
  $('#saveState').textContent = 'Saving…';
  saveDraft();
}

const saveDraft = debounce(async () => {
  const key = msgKey;
  const value = same(draft, core.DEFAULT_TEMPLATES[key]) ? null : clone(draft);
  try {
    const r = await api.settings({ templates: { [key]: value } });
    S.state.settings = r.settings;
    if (key === msgKey) $('#saveState').textContent = 'Saved ✓';
  } catch (e) {
    $('#saveState').textContent = 'Not saved';
    toast(e.message);
  }
}, 500);

// --- text block editing, with emoji typed in at the cursor

let lastEdit = null;   // { idx, pos, at } of the text block most recently edited

function editText(idx, caret) {
  const el = $('#template').children[idx];
  if (!el || draft[idx]?.t !== 'x') return;
  const input = h('input', { value: draft[idx].v, size: Math.max(2, [...draft[idx].v].length + 1), 'aria-label': 'Text block' });
  el.querySelector('.chip-text').replaceWith(input);
  input.focus();
  const pos = caret ?? input.value.length;
  input.setSelectionRange(pos, pos);
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    lastEdit = { idx, pos: input.selectionStart ?? input.value.length, at: Date.now() };
    const v = input.value;
    if (!v.trim()) draft.splice(idx, 1);
    else draft[idx] = { t: 'x', v };
    changed();
  };
  input.addEventListener('input', () => { input.size = Math.max(2, [...input.value].length + 1); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = draft[idx].v; input.blur(); }
  });
  input.addEventListener('blur', commit);
  // Stop Sortable from treating text selection as a drag.
  input.addEventListener('pointerdown', e => e.stopPropagation());
}

function addBlock(b) {
  const isNew = b.isNew;
  draft.push(isNew ? { t: 'x', v: '' } : b);
  if (isNew) {
    renderTemplate();
    editText(draft.length - 1);
  } else {
    changed();
  }
}

function onEmoji(e) {
  const btn = e.target.closest('button[data-block]');
  if (!btn) return;
  const v = JSON.parse(btn.dataset.block).v;
  // Tapped right after editing a text block: type it in at the cursor.
  if (lastEdit && Date.now() - lastEdit.at < 1500 && draft[lastEdit.idx]?.t === 'x') {
    const b = draft[lastEdit.idx];
    const chars = [...b.v];
    const posChars = [...b.v.slice(0, lastEdit.pos)].length;
    chars.splice(posChars, 0, v);
    b.v = chars.join('');
    const idx = lastEdit.idx;
    const caret = b.v.slice(0, lastEdit.pos).length + v.length;
    lastEdit = null;
    renderTemplate();
    renderPreview();
    saveDraft();
    editText(idx, caret);
    return;
  }
  addBlock({ t: 'x', v });
}

// --- drag and drop

let sortables = [];
function makePaletteSortable() {
  if (!window.Sortable) return;
  sortables.forEach(s => s.destroy());
  sortables = [...$$('.palette-row'), $('#emojiGrid')].map(el => Sortable.create(el, {
    group: { name: 'tpl', pull: 'clone', put: false },
    sort: false,
    animation: 120,
    onStart: () => $('#trash').classList.add('active'),
    onEnd: () => $('#trash').classList.remove('active'),
  }));
}

function setupSortable() {
  if (!window.Sortable) return;
  Sortable.create($('#template'), {
    group: { name: 'tpl', pull: true, put: true },
    animation: 150,
    filter: 'input, .x-del',
    preventOnFilter: false,
    onStart: () => $('#trash').classList.add('active'),
    onEnd: () => $('#trash').classList.remove('active'),
    onUpdate: () => { syncDraftFromDom(); changed(); },
    onAdd: evt => {
      const b = JSON.parse(evt.item.dataset.block);
      if (b.isNew) {
        syncDraftFromDom();
        draft[evt.newIndex] = { t: 'x', v: '' };
        renderTemplate();
        editText(evt.newIndex);
        return;
      }
      syncDraftFromDom();
      changed();
      renderPalette();   // put fresh, listener-free clones back
    },
    onRemove: () => { syncDraftFromDom(); changed(); },
  });
  Sortable.create($('#trash'), {
    group: { name: 'tpl', pull: false, put: true },
    onAdd: evt => { evt.item.remove(); $('#trash').classList.remove('hover'); },
    onMove: () => $('#trash').classList.add('hover'),
  });
  $('#trash').addEventListener('dragleave', () => $('#trash').classList.remove('hover'));
  makePaletteSortable();
}

// --- live chat preview

const ARGS = { settime: ' 1:05:00', setmovie: ' the matrix' };
let previewSample = 0;      // which sample movie previews use until one is picked
let previewNoteFor = null;  // what the note currently describes, to avoid rebuilding the picker every tick

function renderPreviewNote() {
  const key = S.state.movie ? 'movie' : 'sample';
  if (previewNoteFor === key) return;
  previewNoteFor = key;
  const note = $('#previewNote');
  if (S.state.movie) { note.replaceChildren('Clock is simulated for this message'); return; }
  note.replaceChildren('Preview with ',
    h('select', { class: 'sample-pick', 'aria-label': 'Sample movie for the preview',
      onchange: e => { previewSample = Number(e.target.value); renderPreview(); } },
      SAMPLES.map((m, i) => h('option', { value: String(i), selected: i === previewSample }, m.title))),
    ' until you pick a movie');
}

const PREVIEW_AT = 62 * 60e3 + 3e3;   // 1:02:03 into the movie
const previewStart = Date.now();

// The clock each message is shown with, so every field has something to
// show: a paused message previews a paused clock, and so on. It ticks.
function previewTimer(key, movie, t) {
  const rt = core.runtimeMs(movie);
  const at = rt ? Math.min(PREVIEW_AT, rt / 2) : PREVIEW_AT;
  const ticking = at + (Date.now() - previewStart);
  if (key === 'not-started' || key === 'reset') return { status: 'idle', base: 0, frozen: 0 };
  if (key === 'time-paused' || key === 'pause' || key === 'not-running') return { status: 'paused', base: 0, frozen: at };
  if (key === 'stop') return { status: 'stopped', base: 0, frozen: at };
  if (key === 'time-ended' || key === 'end') return { status: 'ended', base: 0, frozen: rt || at };
  if (key === 'restart') return { status: 'running', base: t - (Date.now() - previewStart) % 60e3, frozen: 0 };
  if (key === 'settime') return { status: 'running', base: t - 65 * 60e3, frozen: 0 };
  return { status: 'running', base: t - ticking, frozen: 0 };
}

function renderPreview() {
  if (!S.state || $('[data-panel="messages"]').hidden) return;
  const info = core.MESSAGES.find(m => m.k === msgKey);
  const isMod = info.group === 'mod' && msgKey !== 'not-allowed';
  const viewer = isMod ? 'ModMax' : 'popcorn_pal';
  const cmdKey = core.commandForMessage(msgKey);
  const typed = `${settings().commands[cmdKey]}${ARGS[cmdKey] || ''}`;
  const t = now();
  const movie = S.state.movie || { ...SAMPLES[previewSample], fetchedAt: t };
  const previewState = {
    ...S.state,
    movie,
    timer: previewTimer(msgKey, movie, t),
    settings: { ...settings(), templates: { ...settings().templates, [msgKey]: draft } },
  };
  const reply = core.renderMessage(previewState, msgKey, t, { user: viewer });
  renderPreviewNote();
  $('#chatPreview').replaceChildren(
    h('div', { class: 'chat-line' },
      isMod ? h('span', { class: 'chat-badge mod', title: 'Moderator' }, '⚔') : null,
      h('span', { class: 'chat-name', style: `color:${isMod ? '#00ad03' : '#ff7f50'}` }, viewer), ': ', typed),
    h('div', { class: 'chat-line' },
      h('span', { class: 'chat-badge bot', title: 'Bot' }, '🤖'),
      h('span', { class: 'chat-name', style: 'color:#1e90ff' }, 'Fossabot'), ': ', reply || h('em', { class: 'fine' }, '(empty, nothing will be posted)')));
  const n = [...reply].length;
  const count = $('#chatCount');
  count.textContent = n >= core.MAX_REPLY ? `${n}/${core.MAX_REPLY}: too long, the end gets cut off` : `${n}/${core.MAX_REPLY}`;
  count.classList.toggle('over', n >= core.MAX_REPLY);
}

// ================================================================ commands

const saveCommands = debounce(async patch => {
  const err = $('#cmdError');
  try {
    const r = await api.settings(patch);
    S.state.settings = r.settings;
    err.hidden = true;
    renderPaste();
    renderPalette();
    renderPreview();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}, 600);

function renderCommands() {
  const st = settings();
  const table = $('#cmdTable');
  if (!table.contains(document.activeElement)) {
    table.replaceChildren(...core.ACTIONS.flatMap(a => [
      h('input', { type: 'checkbox', checked: st.enabled[a.k] !== false, 'aria-label': `Include ${a.k}`,
        onchange: e => saveCommands({ enabled: { [a.k]: e.target.checked } }) }),
      h('input', { value: st.commands[a.k], 'aria-label': `${a.label} command`, autocapitalize: 'off', spellcheck: 'false',
        oninput: () => {
          const commands = {};
          table.querySelectorAll('input:not([type])').forEach((inp, i) => { commands[core.ACTIONS[i].k] = inp.value; });
          saveCommands({ commands });
        } }),
      h('span', { class: 'desc' }, a.label, a.mod ? h('span', { class: 'mod' }, 'MOD') : null),
    ]));
  }
  $$('input[name=timeStyle]').forEach(r => { r.checked = r.value === st.timeStyle; });
  $('#autoEnd').checked = !!st.autoEnd;
  renderPaste();
}

function renderPaste() {
  const lines = core.pasteBlock(settings(), S.baseUrl);
  $('#paste').replaceChildren(...lines.map(l => h('div', { class: 'paste-line' },
    h('code', {}, l), h('button', { class: 'btn btn-small', onclick: () => copy(l) }, 'Copy'))));
}

// ================================================================ boot

async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get('login_error')) {
    $('#loginError').textContent = q.get('login_error');
    $('#loginError').hidden = false;
  }
  if (DEMO) {
    api = makeDemoApi(SAMPLES);
    $('#demoBadge').hidden = false;
  }
  let me;
  try {
    me = await api.me();
  } catch (e) {
    $('#login').hidden = false;
    $('#loginError').textContent = e.message;
    $('#loginError').hidden = false;
    return;
  }
  if (!me) { $('#login').hidden = false; return; }

  S.user = me.user;
  S.baseUrl = me.baseUrl;
  $('#dash').hidden = false;
  renderWho();
  renderMessageSelect();
  renderEmoji();
  apply(me.state, me.now);
  loadDraft();

  // wiring
  $('#tabs').addEventListener('click', e => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); });
  $('#controls').addEventListener('click', e => { const a = e.target.closest('[data-act]')?.dataset.act; if (a) runAction(a); });
  $('#setTimeForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#setTimeInput').value.trim();
    if (v) runAction('settime', v).then(() => { $('#setTimeInput').value = ''; });
  });
  $('.seg').addEventListener('click', e => { const m = e.target.closest('[data-mode]'); if (m && !m.disabled) setMovieMode(m.dataset.mode); });
  $('#search').addEventListener('input', e => doSearch(e.target.value));
  $('#msgSelect').addEventListener('change', e => {
    saveDraft.flush();
    msgKey = e.target.value;
    loadDraft();
  });
  $('#resetMsg').addEventListener('click', () => {
    draft = clone(core.DEFAULT_TEMPLATES[msgKey]);
    changed();
  });
  $('#template').addEventListener('click', e => {
    const el = e.target.closest('.chip');
    if (!el) return;
    const idx = Number(el.dataset.idx);
    if (e.target.closest('.x-del')) { draft.splice(idx, 1); changed(); return; }
    if (draft[idx]?.t === 'x' && e.target.closest('.chip-text')) editText(idx);
  });
  $('#palette').addEventListener('click', e => {
    const el = e.target.closest('.chip');
    if (el) addBlock(JSON.parse(el.dataset.block));
  });
  $('#emojiGrid').addEventListener('click', onEmoji);
  $$('input[name=timeStyle]').forEach(r => r.addEventListener('change', () => saveCommands.now({ timeStyle: r.value })));
  $('#autoEnd').addEventListener('change', e => saveCommands.now({ autoEnd: e.target.checked }));
  $('#copyAll').addEventListener('click', () => copy(core.pasteBlock(settings(), S.baseUrl).join('\n')));
  window.addEventListener('beforeunload', () => saveDraft.flush());

  if (window.Sortable) setupSortable();
  else window.addEventListener('load', setupSortable, { once: true });

  showTab(location.hash.slice(1) || 'now');
  setInterval(() => { tick(); renderPreview(); }, 500);

  // Pick up changes made from chat while the dashboard is open.
  if (!DEMO) {
    setInterval(async () => {
      if (document.hidden) return;
      try {
        const fresh = await api.me();
        if (fresh && !same(fresh.state.timer, S.state.timer)) apply({ ...fresh.state, settings: S.state.settings }, fresh.now);
        else if (fresh && !same(fresh.state.movie, S.state.movie)) apply({ ...fresh.state, settings: S.state.settings }, fresh.now);
      } catch { /* offline: try again next time */ }
    }, 10000);
  }
}

boot();
