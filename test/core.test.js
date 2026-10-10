import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tpl, renderBlocks, renderMessage, parseTimeArg, formatDuration, applyAction,
  clockView, timeMessageKey, defaultState, mergeSettings, pasteBlock, DEFAULT_TEMPLATES,
  MESSAGE_KEYS, clip,
} from '../public/core.js';

const MATRIX = {
  source: 'tmdb', title: 'The Matrix', year: 1999, runtime: 136, director: ['Lana Wachowski', 'Lilly Wachowski'],
  rating: 8.217, genres: ['Action', 'Science Fiction'], cast: ['Keanu Reeves', 'Laurence Fishburne', 'Carrie-Anne Moss', 'Hugo Weaving'],
  tagline: 'Welcome to the Real World.', imdbId: 'tt0133093', tmdbId: 603,
};
const H = 3600e3, M = 60e3;
const T0 = 1_700_000_000_000;

function state(over = {}) {
  return { ...defaultState(), ...over };
}

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65e3), '1:05');
  assert.equal(formatDuration(H + 23 * M + 45e3), '1:23:45');
  assert.equal(formatDuration(H + 23 * M + 45e3, 'words'), '1h 23m');
  assert.equal(formatDuration(2 * H, 'words'), '2h');
  assert.equal(formatDuration(45e3, 'words'), '45s');
  assert.equal(formatDuration(-5), '0:00');
});

test('parseTimeArg absolute', () => {
  assert.equal(parseTimeArg('1:05:00'), H + 5 * M);
  assert.equal(parseTimeArg('65:00'), 65 * M);
  assert.equal(parseTimeArg('5:30'), 5 * M + 30e3);
  assert.equal(parseTimeArg('90m'), 90 * M);
  assert.equal(parseTimeArg('90'), 90 * M);
  assert.equal(parseTimeArg('1h30m'), 90 * M);
  assert.equal(parseTimeArg('1h 30m 10s'), 90 * M + 10e3);
  assert.equal(parseTimeArg('1.5h'), 90 * M);
  assert.equal(parseTimeArg('45 seconds'), 45e3);
});

test('parseTimeArg relative and invalid', () => {
  assert.equal(parseTimeArg('+5m', 10 * M), 15 * M);
  assert.equal(parseTimeArg('-30s', 10 * M), 9.5 * M);
  assert.equal(parseTimeArg('-30m', 10 * M), 0);
  assert.equal(parseTimeArg('+1:00', 0), 60e3);
  for (const bad of ['', 'abc', '1:75', '5x', 'h', '+', '1:2:3:4', '9999h']) {
    assert.equal(parseTimeArg(bad), null, bad);
  }
});

test('timer: start, pause, resume never drift', () => {
  let s = state({ movie: MATRIX });
  let r = applyAction(s, 'start', '', T0);
  assert.equal(r.reply, 'start');
  s = { ...s, timer: r.timer };
  assert.equal(clockView(s, T0 + 10 * M).elapsed, 10 * M);

  r = applyAction(s, 'start', '', T0 + M);
  assert.equal(r.reply, 'already-running');

  r = applyAction(s, 'pause', '', T0 + 10 * M);
  s = { ...s, timer: r.timer };
  assert.equal(s.timer.status, 'paused');
  assert.equal(clockView(s, T0 + 99 * H).elapsed, 10 * M);

  r = applyAction(s, 'pause', '', T0 + 11 * M);
  assert.equal(r.reply, 'not-running');

  r = applyAction(s, 'resume', '', T0 + 20 * M);
  s = { ...s, timer: r.timer };
  assert.equal(clockView(s, T0 + 25 * M).elapsed, 15 * M);
});

test('timer: stop is resumable by start, restart/reset/end', () => {
  let s = state({ movie: MATRIX, timer: { status: 'running', base: T0, frozen: 0 } });
  s = { ...s, timer: applyAction(s, 'stop', '', T0 + 30 * M).timer };
  assert.equal(s.timer.status, 'stopped');
  s = { ...s, timer: applyAction(s, 'start', '', T0 + H).timer };
  assert.equal(clockView(s, T0 + H).elapsed, 30 * M);

  const restarted = applyAction(s, 'restart', '', T0 + 2 * H).timer;
  assert.deepEqual(clockView({ ...s, timer: restarted }, T0 + 2 * H + M).elapsed, M);

  const reset = applyAction(s, 'reset', '', T0 + 2 * H).timer;
  assert.equal(reset.status, 'idle');
  assert.equal(clockView({ ...s, timer: reset }, T0 + 5 * H).elapsed, 0);

  const ended = applyAction(s, 'end', '', T0 + H + 5 * M).timer;
  assert.equal(ended.status, 'ended');
  assert.equal(ended.frozen, 35 * M);
});

test('timer: settime keeps status, idle becomes paused', () => {
  let s = state({ timer: { status: 'running', base: T0, frozen: 0 } });
  let r = applyAction(s, 'settime', '1:05:00', T0 + M);
  assert.equal(r.reply, 'settime');
  assert.equal(clockView({ ...s, timer: r.timer }, T0 + 2 * M).elapsed, H + 6 * M);

  r = applyAction(s, 'settime', 'nonsense', T0 + M);
  assert.equal(r.reply, 'bad-time');
  assert.equal(r.timer, s.timer);

  s = state();
  r = applyAction(s, 'settime', '+5m', T0);
  assert.equal(r.timer.status, 'paused');
  assert.equal(r.timer.frozen, 5 * M);
});

test('auto-end caps at runtime and can be turned off', () => {
  const s = state({ movie: MATRIX, timer: { status: 'running', base: T0, frozen: 0 } });
  const v = clockView(s, T0 + 3 * H);
  assert.equal(v.status, 'ended');
  assert.equal(v.elapsed, 136 * M);
  assert.equal(timeMessageKey(s, T0 + 3 * H), 'time-ended');

  const off = { ...s, settings: { ...s.settings, autoEnd: false } };
  assert.equal(clockView(off, T0 + 3 * H).status, 'running');

  // Starting after an auto-end starts over rather than "already running".
  const r = applyAction(s, 'start', '', T0 + 3 * H);
  assert.equal(r.reply, 'start');
  assert.equal(clockView({ ...s, timer: r.timer }, T0 + 3 * H).elapsed, 0);
});

test('tpl splits separators and brackets into their own blocks', () => {
  assert.deepEqual(tpl('🎬 {title} ({year}) · ⏱️ {cmd:time}'), [
    { t: 'x', v: '🎬' }, { t: 'f', k: 'title' }, { t: 'x', v: '(' }, { t: 'f', k: 'year' },
    { t: 'x', v: ')' }, { t: 'x', v: '·' }, { t: 'x', v: '⏱️' }, { t: 'c', k: 'time' },
  ]);
});

test('smart spacing around brackets and punctuation', () => {
  const v = { title: 'The Matrix', year: '1999', user: 'bob' };
  assert.equal(renderBlocks(tpl('🎬 {title} ({year})'), v), '🎬 The Matrix (1999)');
  assert.equal(renderBlocks(tpl('{user}, hi!'), v), 'bob, hi!');
  assert.equal(renderBlocks([{ t: 'f', k: 'user' }, { t: 'x', v: '!' }], v), 'bob!');
});

test('empty values drop out cleanly', () => {
  const v = { title: 'Drive', year: '', elapsed: '12:00', runtime: '', remaining: '' };
  assert.equal(renderBlocks(tpl('🎬 {title} ({year}) · ⏱️ {elapsed} / {runtime} ({remaining} left)'), v),
    '🎬 Drive · ⏱️ 12:00');
  assert.equal(renderBlocks(tpl('🎬 {title} ({year}) · ⏱️ {elapsed}'), { ...v, title: '' }),
    '⏱️ 12:00');
  assert.equal(renderBlocks(tpl('{title} · Directed by {director} · {year}'), { title: 'X', year: '2001' }),
    'X · 2001');
  // A dropped field in the middle takes one separator, not both.
  assert.equal(renderBlocks(tpl('A · {title} · B'), { title: '' }), 'A · B');
  assert.equal(renderBlocks(tpl('· {title} ·'), { title: '' }), '');
  assert.doesNotMatch(renderBlocks(tpl('{a} {b} ({c}) [{d}]'), {}), /\(\)|\[\]|  /);
});

test('default messages render for every key, with and without a movie', () => {
  const chat = { user: 'viewer1', streamer: 'Streamer' };
  const withMovie = state({ movie: MATRIX, timer: { status: 'running', base: T0, frozen: 0 } });
  const noMovie = state({ timer: { status: 'running', base: T0, frozen: 0 } });
  for (const k of MESSAGE_KEYS) {
    assert.ok(DEFAULT_TEMPLATES[k], k);
    for (const s of [withMovie, noMovie]) {
      if ((k === 'movie' || k === 'setmovie') && s === noMovie) continue;   // never sent without a movie
      const out = renderMessage(s, k, T0 + H + 2 * M + 3e3, chat);
      assert.ok(out.length > 0 && out.length <= 480, `${k}: ${out}`);
      assert.doesNotMatch(out, /\(\)|  |^[·|]|[·|]$|· ·/, `${k}: ${out}`);
    }
  }
  assert.equal(renderMessage(withMovie, 'time', T0 + H + 2 * M + 3e3),
    '🎬 The Matrix (1999) · ⏱️ 1:02:03 / 2:16:00 (1:13:57 left)');
  assert.equal(renderMessage(withMovie, 'movie', T0),
    '🎬 The Matrix (1999) · Lana Wachowski, Lilly Wachowski · 2:16:00 · 8.2/10 · Action, Science Fiction · https://www.imdb.com/title/tt0133093/');
  assert.equal(renderMessage(noMovie, 'time', T0 + 5 * M), '⏱️ 5:00');
  assert.equal(renderMessage(noMovie, 'not-allowed', T0, chat), '🚫 viewer1, only mods can control the movie clock.');
});

test('overrides win over TMDB values', () => {
  const s = state({ movie: { ...MATRIX, overrides: { title: 'The Matrix (4K)', runtime: 140 } } });
  assert.match(renderMessage(s, 'movie', T0), /^🎬 The Matrix \(4K\) \(1999\) · .* · 2:20:00 ·/);
});

test('replies are clipped to the chat limit', () => {
  assert.equal([...clip('x'.repeat(600))].length, 480);
  assert.equal(renderBlocks([{ t: 'x', v: 'y'.repeat(200) }, { t: 'x', v: 'y'.repeat(200) }, { t: 'x', v: 'y'.repeat(200) }], {}).length, 480);
});

test('mergeSettings validates and resets', () => {
  const base = defaultState().settings;
  let { settings, errors } = mergeSettings(base, {
    commands: { time: 'MT', movie: 'bad name!', nope: '!x' },
    templates: { time: [{ t: 'x', v: 'hi' }, { t: 'f', k: 'evil' }, { t: 'f', k: 'elapsed' }], bogus: [] },
    timeStyle: 'words', autoEnd: false,
  });
  assert.equal(settings.commands.time, '!mt');
  assert.equal(settings.commands.movie, '!movie');
  assert.equal(errors.length, 1);
  assert.deepEqual(settings.templates.time, [{ t: 'x', v: 'hi' }, { t: 'f', k: 'elapsed' }]);
  assert.equal(settings.templates.bogus, undefined);
  assert.equal(settings.timeStyle, 'words');
  assert.equal(settings.autoEnd, false);

  ({ settings } = mergeSettings(settings, { templates: { time: null } }));
  assert.equal(settings.templates.time, undefined);

  ({ errors } = mergeSettings(base, { commands: { time: '!movie' } }));
  assert.match(errors.join(), /share a name/);
});

test('paste block follows renames and toggles', () => {
  const { settings } = mergeSettings(defaultState().settings, { commands: { time: 'mt' }, enabled: { end: false } });
  const lines = pasteBlock(settings, 'https://x.example');
  assert.equal(lines[0], '!addcmd !mt $(customapi https://x.example/f/time)');
  assert.ok(!lines.some(l => l.includes('/f/end')));
  assert.equal(lines.length, 10);
});
