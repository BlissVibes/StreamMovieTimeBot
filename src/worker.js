import {
  ACTION_KEYS, MOD_ACTIONS, TIMER_ACTIONS, renderMessage, timeMessageKey, effectiveMovie, clip,
} from '../public/core.js';
import { searchMovies, movieDetails, isStale } from './tmdb.js';
import { login, callback, logout, readSession, devLogin, switchAccount } from './auth.js';

export { Channel } from './channel.js';

const FOSSABOT_API = 'https://api.fossabot.com/v2/customapi';

const text = body => new Response(clip(String(body)), {
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
});
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const channel = (env, id) => env.CHANNEL.get(env.CHANNEL.idFromName(String(id)));

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith('/f/')) return await fossabot(req, env, ctx, p.slice(3).replace(/\/+$/, ''));
      if (p === '/auth/login') return login(req, env);
      if (p === '/auth/dev-login' && env.DEV_MODE === 'true') return devLogin(req, env);
      if (p === '/auth/callback') {
        const r = await callback(req, env);
        if (r.user) await channel(env, r.user.id).setProfile({ login: r.user.login, displayName: r.user.name });
        return r.response;
      }
      if ((p === '/auth/logout' || p === '/auth/switch') && req.method === 'POST') {
        if (!sameOrigin(req, url)) return json({ error: 'Bad origin' }, 403);
        return p === '/auth/logout' ? logout(req, env) : switchAccount(req, env);
      }
      if (p.startsWith('/api/')) return await api(req, env, ctx, url);
      return env.ASSETS.fetch(req);
    } catch (err) {
      console.error(err?.stack || err);
      if (p.startsWith('/f/')) return text('⚠️ Movie clock hit an error, try again in a moment.');
      return json({ error: 'Something went wrong.' }, 500);
    }
  },
};

// ---------------------------------------------------------------- Fossabot

// Fossabot ignores status codes and posts whatever body comes back, so every
// path here answers 200 with a chat-ready line.
async function fossabot(req, env, ctx, action) {
  if (!ACTION_KEYS.includes(action)) return text('⚠️ Unknown movie clock command.');

  const who = await identify(req, env, MOD_ACTIONS.has(action));
  if (who.error) return text(who.error);
  const stub = channel(env, who.channelId);
  const chat = { user: who.user, streamer: who.streamer };

  if (MOD_ACTIONS.has(action) && !who.isMod) {
    return text(renderMessage(await stub.getState(), 'not-allowed', Date.now(), chat));
  }

  if (TIMER_ACTIONS.has(action)) {
    const r = await stub.runAction(action, who.args, chat);
    return text(r.reply || '✅');
  }

  if (action === 'setmovie') {
    const state = await stub.getState();
    const now = Date.now();
    if (!who.args) return text(renderMessage(state, 'movie-not-found', now, chat));
    const [hit] = await searchMovies(env, who.args, 1);
    const movie = hit && await movieDetails(env, hit.tmdbId);
    if (!movie) return text(renderMessage(state, 'movie-not-found', now, chat));
    const saved = await stub.setMovie(movie);
    return text(renderMessage(saved, 'setmovie', now, chat));
  }

  // Viewer commands: read-only.
  const state = await stub.getState();
  const now = Date.now();
  refreshIfStale(env, ctx, stub, state);
  if (action === 'movie') {
    return text(renderMessage(state, effectiveMovie(state.movie) ? 'movie' : 'no-movie', now, chat));
  }
  return text(renderMessage(state, timeMessageKey(state, now), now, chat));
}

// Works out the channel, the user, and (for mod commands) whether they are
// allowed. Viewer commands trust the headers: they only read public state.
// Mod commands re-check everything with Fossabot using the single-use token,
// and take the channel from Fossabot's answer rather than the headers.
async function identify(req, env, needMod) {
  const h = req.headers;
  if (env.DEV_MODE === 'true' && (h.get('x-dev-roles') !== null || new URL(req.url).searchParams.has('dev'))) {
    return devIdentity(req);
  }
  const headerChannel = h.get('x-fossabot-channelproviderid');
  if (!headerChannel) return { error: '⚠️ This link only works from a Fossabot command.' };
  const base = {
    channelId: headerChannel,
    user: h.get('x-fossabot-message-userdisplayname') || '',
    streamer: h.get('x-fossabot-channeldisplayname') || '',
    args: '',
    isMod: false,
  };
  if (!needMod) return base;

  const token = h.get('x-fossabot-customapitoken');
  if (!token) return { error: '⚠️ Fossabot did not send a token for this command.' };
  const t = encodeURIComponent(token);
  const v = await fetch(`${FOSSABOT_API}/validate/${t}`);
  if (!v.ok) return { error: '⚠️ Could not verify this command with Fossabot. Try again.' };
  const c = await fetch(`${FOSSABOT_API}/context/${t}`);
  if (!c.ok) return { error: '⚠️ Could not verify this command with Fossabot. Try again.' };
  const context = await c.json();
  const user = context?.message?.user;
  const roles = (user?.roles || []).map(r => String(r?.type || '').toLowerCase());
  return {
    channelId: String(context?.channel?.provider_id || ''),
    user: user?.display_name || user?.login || base.user,
    streamer: context?.channel?.display_name || base.streamer,
    args: argsOf(context?.message?.content),
    isMod: roles.includes('broadcaster') || roles.includes('moderator'),
    ...(!context?.channel?.provider_id && { error: '⚠️ Fossabot did not say which channel this is.' }),
  };
}

const argsOf = content => String(content || '').trim().split(/\s+/).slice(1).join(' ');

// DEV_MODE only (wrangler dev): simulate a Fossabot call from the browser or
// curl, e.g. /f/start?dev&channel=123&user=bob&roles=moderator&msg=!startmovie
function devIdentity(req) {
  const h = req.headers, q = new URL(req.url).searchParams;
  const get = (header, param, fallback = '') => h.get(header) ?? q.get(param) ?? fallback;
  const roles = get('x-dev-roles', 'roles', 'broadcaster').toLowerCase().split(',').map(s => s.trim());
  return {
    channelId: get('x-fossabot-channelproviderid', 'channel', 'dev-channel'),
    user: get('x-fossabot-message-userdisplayname', 'user', 'DevUser'),
    streamer: get('x-fossabot-channeldisplayname', 'streamer', 'DevStreamer'),
    args: argsOf(get('x-dev-message', 'msg')),
    isMod: roles.includes('broadcaster') || roles.includes('moderator'),
  };
}

function refreshIfStale(env, ctx, stub, state) {
  if (!isStale(state.movie)) return;
  ctx.waitUntil(movieDetails(env, state.movie.tmdbId)
    .then(fresh => fresh && stub.refreshMovie(fresh))
    .catch(err => console.error('refresh failed', err)));
}

// ---------------------------------------------------------------- dashboard API

function sameOrigin(req, url) {
  return req.headers.get('origin') === url.origin;
}

async function api(req, env, ctx, url) {
  const p = url.pathname;
  if (req.method !== 'GET' && !sameOrigin(req, url)) return json({ error: 'Bad origin' }, 403);

  const session = await readSession(req, env);
  if (!session) return json({ error: 'Not logged in' }, 401);
  const stub = channel(env, session.id);
  const body = req.method === 'GET' ? null : await req.json().catch(() => ({}));

  if (p === '/api/me' && req.method === 'GET') {
    const state = await stub.getState();
    refreshIfStale(env, ctx, stub, state);
    return json({ user: session, state, now: Date.now(), baseUrl: env.PUBLIC_URL || url.origin });
  }

  if (p === '/api/settings' && req.method === 'PUT') {
    const r = await stub.updateSettings(body || {});
    return json(r, r.errors.length ? 400 : 200);
  }

  if (p === '/api/search' && req.method === 'GET') {
    return json({ results: await searchMovies(env, url.searchParams.get('q')) });
  }

  if (p === '/api/movie' && req.method === 'POST') {
    if (body.clear) return json({ state: await stub.setMovie(null) });
    if (body.tmdbId) {
      const movie = await movieDetails(env, body.tmdbId);
      if (!movie) return json({ error: 'Movie not found on TMDB' }, 404);
      return json({ state: await stub.setMovie(movie) });
    }
    if (body.custom) {
      const m = cleanMovie(body.custom);
      if (!m.title) return json({ error: 'A custom movie needs a title' }, 400);
      return json({ state: await stub.setMovie({ source: 'custom', ...m }) });
    }
    if (body.overrides) {
      const o = cleanMovie(body.overrides, true);
      return json({ state: await stub.setOverrides(o) });
    }
    return json({ error: 'Nothing to do' }, 400);
  }

  if (p === '/api/action' && req.method === 'POST') {
    if (!TIMER_ACTIONS.has(body.action)) return json({ error: 'Unknown action' }, 400);
    const r = await stub.runAction(body.action, String(body.arg || ''), { user: session.name, streamer: session.name });
    return json({ state: r.state, reply: r.reply, key: r.key, now: r.now });
  }

  return json({ error: 'Not found' }, 404);
}

// Custom movies and overrides: same fields as TMDB data. With `partial`,
// only fields present are returned, and null means "remove the override".
const MOVIE_FIELDS = ['title', 'year', 'runtime', 'director', 'rating', 'genres', 'cast', 'tagline', 'imdbId', 'poster'];

export function cleanMovie(input, partial = false) {
  const out = {};
  const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
  const listOf = v => (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map(s => str(s, 80)).filter(Boolean).slice(0, 8);
  const num = (v, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
  };
  for (const k of MOVIE_FIELDS) {
    if (!(k in (input || {}))) continue;
    const v = input[k];
    if (partial && (v === null || v === '')) { out[k] = null; continue; }
    switch (k) {
      case 'year': out[k] = num(v, 1870, 2100) && Math.round(v); break;
      case 'runtime': out[k] = num(v, 1, 1000) && Math.round(v); break;
      case 'rating': out[k] = num(v, 0, 10); break;
      case 'director': case 'genres': case 'cast': out[k] = listOf(v); break;
      case 'imdbId': out[k] = (String(v).match(/tt\d{5,10}/) || [''])[0]; break;
      case 'poster': out[k] = /^https:\/\//.test(str(v, 500)) ? str(v, 500) : ''; break;
      default: out[k] = str(v);
    }
  }
  return out;
}
