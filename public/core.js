// Shared by the Worker (real chat replies) and the dashboard (live preview),
// so the preview always matches what chat sees. No imports, no globals.

export const MAX_REPLY = 480;

// ---------------------------------------------------------------- actions

export const ACTIONS = [
  { k: 'time',     cmd: '!movietime',    mod: false, label: 'Show the clock' },
  { k: 'movie',    cmd: '!movie',        mod: false, label: 'Show movie info' },
  { k: 'start',    cmd: '!startmovie',   mod: true,  label: 'Start / resume' },
  { k: 'pause',    cmd: '!pausemovie',   mod: true,  label: 'Pause' },
  { k: 'stop',     cmd: '!stopmovie',    mod: true,  label: 'Stop (resumable)' },
  { k: 'resume',   cmd: '!resumemovie',  mod: true,  label: 'Resume' },
  { k: 'restart',  cmd: '!restartmovie', mod: true,  label: 'Restart from 0:00' },
  { k: 'reset',    cmd: '!resetmovie',   mod: true,  label: 'Reset to 0:00' },
  { k: 'end',      cmd: '!endmovie',     mod: true,  label: 'End the movie' },
  { k: 'settime',  cmd: '!settime',      mod: true,  label: 'Set the time' },
  { k: 'setmovie', cmd: '!setmovie',     mod: true,  label: 'Set the movie' },
];
export const ACTION_KEYS = ACTIONS.map(a => a.k);
export const MOD_ACTIONS = new Set(ACTIONS.filter(a => a.mod).map(a => a.k));
export const TIMER_ACTIONS = new Set(['start', 'pause', 'stop', 'resume', 'restart', 'reset', 'end', 'settime']);

// ---------------------------------------------------------------- messages

export const MESSAGES = [
  { k: 'time',            group: 'viewer', label: 'Time (running)' },
  { k: 'time-paused',     group: 'viewer', label: 'Time (paused / stopped)' },
  { k: 'time-ended',      group: 'viewer', label: 'Time (ended)' },
  { k: 'not-started',     group: 'viewer', label: 'Not started yet' },
  { k: 'movie',           group: 'viewer', label: 'Movie info' },
  { k: 'no-movie',        group: 'viewer', label: 'No movie set' },
  { k: 'start',           group: 'mod', label: 'Started' },
  { k: 'pause',           group: 'mod', label: 'Paused' },
  { k: 'stop',            group: 'mod', label: 'Stopped' },
  { k: 'resume',          group: 'mod', label: 'Resumed' },
  { k: 'restart',         group: 'mod', label: 'Restarted' },
  { k: 'reset',           group: 'mod', label: 'Reset' },
  { k: 'end',             group: 'mod', label: 'Ended' },
  { k: 'settime',         group: 'mod', label: 'Time set' },
  { k: 'setmovie',        group: 'mod', label: 'Movie set' },
  { k: 'already-running', group: 'mod', label: 'Already running' },
  { k: 'not-running',     group: 'mod', label: 'Not running' },
  { k: 'bad-time',        group: 'mod', label: 'Couldn\'t read the time' },
  { k: 'movie-not-found', group: 'mod', label: 'Movie not found' },
  { k: 'not-allowed',     group: 'mod', label: 'Not allowed (non-mod)' },
];
export const MESSAGE_KEYS = MESSAGES.map(m => m.k);

// Which command a message is a reply to, for the chat preview.
export function commandForMessage(k) {
  if (k.startsWith('time') || k === 'not-started') return 'time';
  if (k === 'movie' || k === 'no-movie') return 'movie';
  if (k === 'already-running') return 'start';
  if (k === 'not-running') return 'pause';
  if (k === 'bad-time') return 'settime';
  if (k === 'movie-not-found') return 'setmovie';
  if (k === 'not-allowed') return 'start';
  return k;
}

// ---------------------------------------------------------------- fields

export const FIELDS = [
  { k: 'title',     group: 'movie', label: 'Title' },
  { k: 'year',      group: 'movie', label: 'Year' },
  { k: 'director',  group: 'movie', label: 'Director' },
  { k: 'runtime',   group: 'movie', label: 'Runtime' },
  { k: 'rating',    group: 'movie', label: 'Rating' },
  { k: 'genres',    group: 'movie', label: 'Genres' },
  { k: 'cast',      group: 'movie', label: 'Cast' },
  { k: 'tagline',   group: 'movie', label: 'Tagline' },
  { k: 'imdb',      group: 'movie', label: 'IMDb link' },
  { k: 'tmdb',      group: 'movie', label: 'TMDB link' },
  { k: 'elapsed',   group: 'clock', label: 'Elapsed' },
  { k: 'remaining', group: 'clock', label: 'Remaining' },
  { k: 'percent',   group: 'clock', label: 'Percent' },
  { k: 'bar',       group: 'clock', label: 'Progress bar' },
  { k: 'status',    group: 'clock', label: 'Status' },
  { k: 'user',      group: 'chat',  label: 'Who ran it' },
  { k: 'streamer',  group: 'chat',  label: 'Streamer name' },
];
export const FIELD_KEYS = new Set(FIELDS.map(f => f.k));

// ---------------------------------------------------------------- defaults

export function defaultSettings() {
  return {
    commands: Object.fromEntries(ACTIONS.map(a => [a.k, a.cmd])),
    enabled: Object.fromEntries(ACTIONS.map(a => [a.k, true])),
    templates: {},            // overrides only; missing key = default
    timeStyle: 'clock',       // 'clock' 1:23:45 | 'words' 1h 23m
    autoEnd: true,
  };
}

export function defaultState() {
  return {
    timer: { status: 'idle', base: 0, frozen: 0 },
    movie: null,
    settings: defaultSettings(),
    profile: null,
  };
}

const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set(Object.values(OPEN));
const SEPARATOR = /^[·|/\-—–•:~]+$/;
const NO_SPACE_BEFORE = /^[)\]},.!?:;%…]/;
const NO_SPACE_AFTER = /[([{]$/;

// Compact template notation, used only to write the defaults below:
// {field}, {cmd:action}, brackets as their own blocks, everything else text.
export function tpl(s) {
  const out = [];
  for (const m of s.matchAll(/\{([^}]+)\}|[()[\]]|[^{}()[\]]+/g)) {
    if (m[1]) {
      out.push(m[1].startsWith('cmd:') ? { t: 'c', k: m[1].slice(4) } : { t: 'f', k: m[1] });
    } else {
      // Separators become their own blocks so they can drop out with a
      // missing neighbour; runs of ordinary words stay one block.
      for (const w of m[0].trim().split(/\s+/).filter(Boolean)) {
        const last = out[out.length - 1];
        const plain = v => !SEPARATOR.test(v) && !OPEN[v] && !CLOSE.has(v);
        if (plain(w) && last?.t === 'x' && plain(last.v)) last.v += ' ' + w;
        else out.push({ t: 'x', v: w });
      }
    }
  }
  return out;
}

const DEFAULT_SOURCE = {
  'time':            '🎬 {title} ({year}) · ⏱️ {elapsed} / {runtime} ({remaining} left)',
  'time-paused':     '⏸️ Paused at {elapsed} / {runtime} · {title}',
  'time-ended':      '🏁 The movie is over · {title} · final time {elapsed}',
  'not-started':     '🍿 The movie hasn\'t started yet · {title} ({runtime})',
  'movie':           '🎬 {title} ({year}) · {director} · {runtime} · {rating} · {genres} · {imdb}',
  'no-movie':        '🎬 No movie has been set yet.',
  'start':           '▶️ Clock started at {elapsed} · {title}',
  'pause':           '⏸️ Paused at {elapsed}',
  'stop':            '⏹️ Stopped at {elapsed}',
  'resume':          '▶️ Resumed at {elapsed}',
  'restart':         '🔁 Restarted from {elapsed} · {title}',
  'reset':           '↩️ Clock reset to {elapsed}',
  'end':             '🏁 Movie ended at {elapsed} · {title}',
  'settime':         '⏩ Clock set to {elapsed} / {runtime}',
  'setmovie':        '🎬 Now playing: {title} ({year}) · {runtime}',
  'already-running': '⏱️ Already running at {elapsed}',
  'not-running':     '⏱️ The clock isn\'t running right now.',
  'bad-time':        '⚠️ Couldn\'t read that time. Try 1:05:00, 90m, +5m or -30s',
  'movie-not-found': '⚠️ No movie found for that search.',
  'not-allowed':     '🚫 {user}, only mods can control the movie clock.',
};
export const DEFAULT_TEMPLATES = Object.fromEntries(
  Object.entries(DEFAULT_SOURCE).map(([k, s]) => [k, tpl(s)]));

export function templateFor(settings, key) {
  return settings?.templates?.[key] || DEFAULT_TEMPLATES[key] || [];
}

// ---------------------------------------------------------------- time

export function formatDuration(ms, style = 'clock') {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  if (style === 'words') {
    if (total < 60) return `${s}s`;
    if (!h) return `${m}m`;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// "1:05:00", "65:00", "90m", "1h30m", "1h 30m 10s", "90" (minutes),
// and relative "+5m", "-30s", "+1:00". Returns ms, or null if unreadable.
export function parseTimeArg(input, currentMs = 0) {
  let s = String(input ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  let sign = 0;
  if (s[0] === '+' || s[0] === '-') { sign = s[0] === '+' ? 1 : -1; s = s.slice(1); }
  let ms = null;
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
    const p = s.split(':').map(Number);
    if (p.slice(1).some(n => n >= 60)) return null;
    const [h, m, sec] = p.length === 3 ? p : [0, p[0], p[1]];
    ms = ((h * 60 + m) * 60 + sec) * 1000;
  } else if (/^\d+(\.\d+)?$/.test(s)) {
    ms = Number(s) * 60000;
  } else {
    const m = s.match(/^(?:(\d+(?:\.\d+)?)h(?:rs?|ours?)?)?(?:(\d+(?:\.\d+)?)m(?:ins?|inutes?)?)?(?:(\d+(?:\.\d+)?)s(?:ecs?|econds?)?)?$/);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    ms = ((Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 1000;
  }
  ms = Math.round(ms);
  if (!Number.isFinite(ms) || ms > 100 * 3600e3) return null;
  return sign ? Math.max(0, currentMs + sign * ms) : ms;
}

// ---------------------------------------------------------------- timer

export function runtimeMs(movie) {
  const r = Number(effectiveMovie(movie)?.runtime);
  return r > 0 ? r * 60000 : 0;
}

// What the clock shows right now, with auto-end applied.
export function clockView(state, now) {
  const t = state.timer || { status: 'idle', frozen: 0 };
  const runtime = runtimeMs(state.movie);
  let status = t.status;
  let elapsed = status === 'running' ? Math.max(0, now - t.base) : (t.frozen || 0);
  if (state.settings?.autoEnd && runtime && status === 'running' && elapsed >= runtime) {
    status = 'ended';
    elapsed = runtime;
  }
  return {
    status, elapsed, runtime,
    remaining: runtime ? Math.max(0, runtime - elapsed) : null,
    percent: runtime ? Math.min(100, Math.floor((elapsed / runtime) * 100)) : null,
  };
}

const running = (elapsed, now) => ({ status: 'running', base: now - elapsed, frozen: 0 });
const frozen = (status, elapsed) => ({ status, base: 0, frozen: elapsed });

// Returns { timer, reply } where reply is a message key. `timer` is the new
// timer (unchanged when the action was refused).
export function applyAction(state, action, arg, now) {
  const v = clockView(state, now);
  // Settle an auto-ended clock so the stored state matches what chat saw.
  const timer = v.status === 'ended' && state.timer.status === 'running'
    ? frozen('ended', v.elapsed) : state.timer;
  const live = v.status === 'running';
  switch (action) {
    case 'start':
      if (live) return { timer, reply: 'already-running' };
      return { timer: running(v.status === 'ended' ? 0 : v.elapsed, now), reply: 'start' };
    case 'resume':
      if (live) return { timer, reply: 'already-running' };
      return { timer: running(v.elapsed, now), reply: 'resume' };
    case 'pause':
    case 'stop':
      if (!live) return { timer, reply: 'not-running' };
      return { timer: frozen(action === 'pause' ? 'paused' : 'stopped', v.elapsed), reply: action };
    case 'restart':
      return { timer: running(0, now), reply: 'restart' };
    case 'reset':
      return { timer: frozen('idle', 0), reply: 'reset' };
    case 'end':
      return { timer: frozen('ended', v.elapsed), reply: 'end' };
    case 'settime': {
      const ms = parseTimeArg(arg, v.elapsed);
      if (ms == null) return { timer, reply: 'bad-time' };
      if (live) return { timer: running(ms, now), reply: 'settime' };
      return { timer: frozen(v.status === 'idle' ? 'paused' : v.status, ms), reply: 'settime' };
    }
    default:
      return { timer, reply: null };
  }
}

// Which message a viewer's !movietime shows.
export function timeMessageKey(state, now) {
  const { status } = clockView(state, now);
  if (status === 'running') return 'time';
  if (status === 'ended') return 'time-ended';
  if (status === 'idle') return 'not-started';
  return 'time-paused';
}

// ---------------------------------------------------------------- values

export function effectiveMovie(movie) {
  if (!movie) return null;
  const { overrides, ...base } = movie;
  return overrides ? { ...base, ...overrides } : base;
}

const STATUS_WORDS = { idle: 'not started', running: 'playing', paused: 'paused', stopped: 'stopped', ended: 'ended' };
const list = (v, n = 3) => Array.isArray(v) ? v.slice(0, n).join(', ') : (v || '');

export function fieldValues(state, now, chat = {}) {
  const m = effectiveMovie(state.movie) || {};
  const style = state.settings?.timeStyle || 'clock';
  const v = clockView(state, now);
  const imdbId = String(m.imdbId || '').trim();
  return {
    title: m.title || '',
    year: m.year ? String(m.year) : '',
    director: list(m.director, 2),
    runtime: v.runtime ? formatDuration(v.runtime, style) : '',
    rating: m.rating ? `${Number(m.rating).toFixed(1)}/10` : '',
    genres: list(m.genres),
    cast: list(m.cast),
    tagline: m.tagline || '',
    imdb: m.imdbUrl || (/^tt\d+$/.test(imdbId) ? `https://www.imdb.com/title/${imdbId}/` : ''),
    tmdb: m.tmdbId ? `https://www.themoviedb.org/movie/${m.tmdbId}` : '',
    elapsed: formatDuration(v.elapsed, style),
    remaining: v.remaining == null ? '' : formatDuration(v.remaining, style),
    percent: v.percent == null ? '' : `${v.percent}%`,
    bar: v.percent == null ? '' : progressBar(v.percent),
    status: STATUS_WORDS[v.status] || v.status,
    user: chat.user || '',
    streamer: chat.streamer || state.profile?.displayName || '',
  };
}

export function progressBar(pct, width = 10) {
  const n = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return '▓'.repeat(n) + '░'.repeat(width - n);
}

// ---------------------------------------------------------------- render

export function blockText(b, values, commands) {
  if (!b) return '';
  if (b.t === 'x') return String(b.v ?? '').trim();
  if (b.t === 'f') return values[b.k] ?? '';
  if (b.t === 'c') return commands?.[b.k] || '';
  return '';
}

// Turns blocks into one chat line. Missing values drop out cleanly:
//  - a bracket group with an empty field inside goes entirely;
//  - separators (·, |, /, —) split the line into segments, and a segment
//    whose fields all came up empty goes with its text ("Directed by",
//    an emoji), so labels never dangle;
//  - leading, trailing and doubled separators are removed.
export function renderBlocks(blocks, values, commands) {
  const items = (blocks || []).map(b => {
    const text = blockText(b, values, commands);
    const dynamic = b.t === 'f' || b.t === 'c';
    return { text, dynamic, empty: dynamic && !text, sep: b.t === 'x' && SEPARATOR.test(text), drop: !text };
  });

  // 1. Bracket groups containing an empty field.
  const stack = [];
  items.forEach((it, i) => {
    if (OPEN[it.text]) stack.push(i);
    else if (CLOSE.has(it.text) && stack.length) {
      const start = stack.pop();
      if (items.slice(start, i + 1).some(x => x.empty)) {
        for (let j = start; j <= i; j++) items[j].drop = true;
      }
    }
  });
  // 2. Segments whose fields all dropped.
  let seg = [];
  const flush = () => {
    if (seg.some(x => x.dynamic) && seg.every(x => !x.dynamic || x.drop)) seg.forEach(x => { x.drop = true; });
    seg = [];
  };
  for (const it of items) { if (it.sep) flush(); else seg.push(it); }
  flush();
  // 3. Leading, trailing and doubled separators.
  let kept = items.filter(it => !it.drop);
  kept = kept.filter((it, i) => !(it.sep && (i === 0 || kept[i - 1].sep)));
  while (kept.length && kept[kept.length - 1].sep) kept.pop();

  // 4. Smart join.
  let out = '';
  for (const it of kept) {
    if (out && !NO_SPACE_AFTER.test(out) && !NO_SPACE_BEFORE.test(it.text)) out += ' ';
    out += it.text;
  }
  out = out.replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, '').replace(/\s{2,}/g, ' ').trim();
  return clip(out);
}

export function clip(s, max = MAX_REPLY) {
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : s;
}

export function renderMessage(state, key, now, chat = {}) {
  return renderBlocks(templateFor(state.settings, key), fieldValues(state, now, chat), state.settings?.commands);
}

// ---------------------------------------------------------------- settings

const MAX_BLOCKS = 60;
const MAX_TEXT = 200;

export function normalizeCommand(name) {
  const n = String(name || '').trim().toLowerCase().replace(/^!+/, '');
  return /^[a-z0-9_]{1,30}$/.test(n) ? '!' + n : null;
}

export function cleanTemplate(blocks) {
  if (!Array.isArray(blocks)) return null;
  const out = [];
  for (const b of blocks.slice(0, MAX_BLOCKS)) {
    if (b?.t === 'x' && typeof b.v === 'string' && b.v.trim()) out.push({ t: 'x', v: b.v.slice(0, MAX_TEXT) });
    else if (b?.t === 'f' && FIELD_KEYS.has(b.k)) out.push({ t: 'f', k: b.k });
    else if (b?.t === 'c' && ACTION_KEYS.includes(b.k)) out.push({ t: 'c', k: b.k });
  }
  return out;
}

// Merges a partial settings update into existing settings, dropping
// anything invalid. Returns { settings, errors }.
export function mergeSettings(current, patch) {
  const s = structuredClone(current || defaultSettings());
  const errors = [];
  if (patch?.commands) {
    for (const [k, v] of Object.entries(patch.commands)) {
      if (!ACTION_KEYS.includes(k)) continue;
      const n = normalizeCommand(v);
      if (n) s.commands[k] = n; else errors.push(`Invalid command name for ${k}`);
    }
    const names = Object.values(s.commands);
    if (new Set(names).size !== names.length) errors.push('Two commands share a name');
  }
  if (patch?.enabled) {
    for (const [k, v] of Object.entries(patch.enabled)) if (ACTION_KEYS.includes(k)) s.enabled[k] = !!v;
  }
  if (patch?.templates) {
    for (const [k, v] of Object.entries(patch.templates)) {
      if (!MESSAGE_KEYS.includes(k)) continue;
      if (v === null) { delete s.templates[k]; continue; }   // reset to default
      const t = cleanTemplate(v);
      if (t) s.templates[k] = t;
    }
  }
  if (patch?.timeStyle === 'clock' || patch?.timeStyle === 'words') s.timeStyle = patch.timeStyle;
  if (typeof patch?.autoEnd === 'boolean') s.autoEnd = patch.autoEnd;
  return { settings: s, errors };
}

export function pasteBlock(settings, baseUrl) {
  return ACTIONS
    .filter(a => settings.enabled?.[a.k] !== false)
    .map(a => `!addcmd ${settings.commands[a.k]} $(customapi ${baseUrl}/f/${a.k})`);
}
