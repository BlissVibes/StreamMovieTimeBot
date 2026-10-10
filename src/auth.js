// Twitch login with zero scopes, and HMAC-signed session cookies.
// No Twitch token is ever stored: it is used once to read the user's ID and
// name, then revoked.

const SESSION_COOKIE = 'mc_session';
const STATE_COOKIE = 'mc_state';
const SESSION_DAYS = 30;

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

export async function signSession(env, user) {
  const payload = b64url(enc.encode(JSON.stringify({ ...user, exp: Date.now() + SESSION_DAYS * 86400e3 })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function readSession(req, env) {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), unb64url(sig), enc.encode(payload));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    return s.exp > Date.now() && s.id ? s : null;
  } catch {
    return null;
  }
}

function redirect(location, cookies = []) {
  const h = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status: 302, headers: h });
}

const callbackUrl = (env, url) => `${env.PUBLIC_URL || url.origin}/auth/callback`;

export function login(req, env) {
  const url = new URL(req.url);
  const state = randomToken();
  const auth = new URL('https://id.twitch.tv/oauth2/authorize');
  auth.searchParams.set('client_id', env.TWITCH_CLIENT_ID);
  auth.searchParams.set('redirect_uri', callbackUrl(env, url));
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', '');
  auth.searchParams.set('state', state);
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
    user = { id: u.id, login: u.login, name: u.display_name || u.login, avatar: u.profile_image_url || '' };
  } finally {
    // Revoke whatever happens: we never keep the token.
    await fetch('https://id.twitch.tv/oauth2/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, token }),
    }).catch(() => {});
  }

  const session = await signSession(env, { id: user.id, login: user.login, name: user.name });
  return {
    user,
    response: redirect('/', [clearState, cookie(SESSION_COOKIE, session, { maxAge: SESSION_DAYS * 86400 })]),
  };
}

// DEV_MODE only: log in as a made-up channel, matching the dev Fossabot
// calls (/auth/dev-login?channel=42 pairs with /f/time?dev&channel=42).
export async function devLogin(req, env) {
  const id = new URL(req.url).searchParams.get('channel') || 'dev-channel';
  const session = await signSession(env, { id, login: 'devstreamer', name: 'DevStreamer' });
  return redirect('/', [cookie(SESSION_COOKIE, session, { maxAge: 86400 })]);
}

export function logout() {
  return redirect('/', [cookie(SESSION_COOKIE, '', { maxAge: 0 })]);
}
