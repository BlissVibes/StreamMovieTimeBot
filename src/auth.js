// Twitch login with zero scopes, and HMAC-signed session cookies.
// No Twitch token is ever stored: it is used once to read the user's ID and
// name, then revoked.
//
// Several accounts can be signed in on one browser. Each one is its own
// signed token; the `mc_accounts` cookie holds them all (newest first) and
// `mc_active` says which one the dashboard is showing.

const ACCOUNTS_COOKIE = 'mc_accounts';
const ACTIVE_COOKIE = 'mc_active';
const STATE_COOKIE = 'mc_state';
const SESSION_DAYS = 30;
const MAX_ACCOUNTS = 5;

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

function randomToken(n = 24) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

async function hmacKey(secret) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function cookie(name, value, { maxAge, path = '/' } = {}) {
  return `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=Lax${maxAge != null ? `; Max-Age=${maxAge}` : ''}`;
}

async function signToken(env, user, days = SESSION_DAYS) {
  const payload = b64url(enc.encode(JSON.stringify({ ...user, exp: Date.now() + days * 86400e3 })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

async function verifyToken(env, key, token) {
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  try {
    if (!await crypto.subtle.verify('HMAC', key, unb64url(sig), enc.encode(payload))) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    return s.exp > Date.now() && s.id ? s : null;
  } catch {
    return null;
  }
}

// All valid signed-in accounts, as [{ token, user }], newest first.
async function readAccounts(req, env) {
  const raw = parseCookies(req)[ACCOUNTS_COOKIE];
  if (!raw) return [];
  const key = await hmacKey(env.SESSION_SECRET);
  const out = [];
  for (const token of raw.split('~').slice(0, MAX_ACCOUNTS)) {
    const user = await verifyToken(env, key, token);
    if (user && !out.some(a => a.user.id === user.id)) out.push({ token, user });
  }
  return out;
}

// The account the dashboard is acting as, plus the others for the switcher.
export async function readSession(req, env) {
  const accounts = await readAccounts(req, env);
  if (!accounts.length) return null;
  const active = parseCookies(req)[ACTIVE_COOKIE];
  const current = accounts.find(a => a.user.id === active) || accounts[0];
  return {
    ...current.user,
    accounts: accounts.map(a => ({ id: a.user.id, login: a.user.login, name: a.user.name })),
  };
}

function sessionCookies(accounts, activeId) {
  if (!accounts.length) {
    return [cookie(ACCOUNTS_COOKIE, '', { maxAge: 0 }), cookie(ACTIVE_COOKIE, '', { maxAge: 0 })];
  }
  const maxAge = SESSION_DAYS * 86400;
  return [
    cookie(ACCOUNTS_COOKIE, accounts.map(a => a.token).join('~'), { maxAge }),
    cookie(ACTIVE_COOKIE, activeId || accounts[0].user.id, { maxAge }),
  ];
}

async function addAccount(req, env, user, days) {
  const token = await signToken(env, user, days);
  const others = (await readAccounts(req, env)).filter(a => a.user.id !== user.id);
  return sessionCookies([{ token, user }, ...others].slice(0, MAX_ACCOUNTS), user.id);
}

function redirect(location, cookies = []) {
  const h = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status: 302, headers: h });
}

const callbackUrl = (env, url) => `${env.PUBLIC_URL || url.origin}/auth/callback`;

// ?add asks Twitch to show its account prompt instead of silently reusing
// whoever is logged in to twitch.tv, so a second account can be added.
export function login(req, env) {
  const url = new URL(req.url);
  const state = randomToken();
  const auth = new URL('https://id.twitch.tv/oauth2/authorize');
  auth.searchParams.set('client_id', env.TWITCH_CLIENT_ID);
  auth.searchParams.set('redirect_uri', callbackUrl(env, url));
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', '');
  auth.searchParams.set('state', state);
  if (url.searchParams.has('add')) auth.searchParams.set('force_verify', 'true');
  return redirect(auth.toString(), [cookie(STATE_COOKIE, state, { maxAge: 600, path: '/auth' })]);
}

// Returns { response } on failure, or { user, response } on success; the
// caller saves the profile before sending the response.
export async function callback(req, env) {
  const url = new URL(req.url);
  const clearState = cookie(STATE_COOKIE, '', { maxAge: 0, path: '/auth' });
  const fail = msg => ({ response: redirect(`/?login_error=${encodeURIComponent(msg)}`, [clearState]) });

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = parseCookies(req)[STATE_COOKIE];
  if (url.searchParams.get('error')) return fail('Login was cancelled.');
  if (!code || !state || !expected || state !== expected) return fail('Login expired, please try again.');

  const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl(env, url),
    }),
  });
  if (!tokenRes.ok) return fail('Twitch did not accept the login.');
  const { access_token: token } = await tokenRes.json();

  let user;
  try {
    const r = await fetch('https://api.twitch.tv/helix/users', {
      headers: { authorization: `Bearer ${token}`, 'client-id': env.TWITCH_CLIENT_ID },
    });
    const u = (await r.json())?.data?.[0];
    if (!u?.id) return fail('Could not read your Twitch profile.');
    user = { id: u.id, login: u.login, name: u.display_name || u.login };
  } finally {
    // Revoke whatever happens: we never keep the token.
    await fetch('https://id.twitch.tv/oauth2/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, token }),
    }).catch(() => {});
  }

  return { user, response: redirect('/', [clearState, ...await addAccount(req, env, user)]) };
}

// DEV_MODE only: log in as a made-up channel, matching the dev Fossabot
// calls (/auth/dev-login?channel=42 pairs with /f/time?dev&channel=42).
export async function devLogin(req, env) {
  const q = new URL(req.url).searchParams;
  const id = q.get('channel') || 'dev-channel';
  const name = q.get('name') || `DevStreamer${id}`;
  return redirect('/', await addAccount(req, env, { id, login: name.toLowerCase(), name }, 1));
}

// POST id=<twitch id>: switch to another signed-in account.
export async function switchAccount(req, env) {
  const form = await req.formData().catch(() => null);
  const id = String(form?.get('id') || '');
  const accounts = await readAccounts(req, env);
  if (!accounts.some(a => a.user.id === id)) return redirect('/');
  return redirect('/', sessionCookies(accounts, id));
}

// POST: sign out the active account (or all=1 for every account). Any other
// signed-in account becomes active.
export async function logout(req, env) {
  const form = await req.formData().catch(() => null);
  if (form?.get('all')) return redirect('/', sessionCookies([]));
  const current = await readSession(req, env);
  const rest = (await readAccounts(req, env)).filter(a => a.user.id !== current?.id);
  return redirect('/', sessionCookies(rest));
}
