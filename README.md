# Movie Clock

A movie timer for Twitch channels that use **Fossabot**. Viewers type
`!movietime` and get the elapsed time, runtime and time left. Mods start,
pause and set the clock from chat. Everything else is done in a web dashboard:
picking the movie, editing every reply with drag-and-drop blocks, and renaming
commands.

It runs on Cloudflare's free plan (one Worker plus one Durable Object per
channel). Nothing needs to be installed on a server.

The design is in [`PLAN.md`](PLAN.md).

## How it fits together

```
!movietime ─► Fossabot ─► $(customapi https://…/f/time) ─► Worker ─► Durable Object (this channel)
                                                              │
                                     plain-text reply ◄───────┘
```

| Path | What |
|---|---|
| `public/core.js` | Timer, time parsing, templates and renderer. Shared by the Worker and the dashboard, so the preview always matches chat. |
| `src/worker.js` | Routes: `/f/:action` for Fossabot, `/auth/*`, `/api/*`. |
| `src/channel.js` | The Durable Object: one per Twitch channel ID. |
| `src/tmdb.js` | TMDB search and details. Accepts a v4 read token or a v3 key. |
| `src/auth.js` | Twitch login (no scopes, token revoked at once), signed cookies, multiple accounts. |
| `public/` | The dashboard (static, served by Cloudflare for free). `/?demo` runs it entirely in the browser. |

## Set up (about 15 minutes, all free)

### 1. Cloudflare

1. Sign up at <https://dash.cloudflare.com/sign-up>. The free plan is enough.
2. **Workers & Pages** → open it once so Cloudflare asks you to choose your
   `workers.dev` subdomain (for example `markw`). The app will live at
   `https://streammovietimebot.<subdomain>.workers.dev`.

### 2. Twitch app

1. <https://dev.twitch.tv/console/apps> → **Register Your Application**.
2. Name: anything (for example *Movie Clock*). Category: *Chat Bot* or *Website Integration*.
3. OAuth Redirect URL: `https://streammovietimebot.<subdomain>.workers.dev/auth/callback`
4. Client type: **Confidential**.
5. Copy the **Client ID**, then **New Secret** → copy the **Client Secret**.

### 3. Secrets

| Name | Value |
|---|---|
| `TWITCH_CLIENT_ID` | from step 2 |
| `TWITCH_CLIENT_SECRET` | from step 2 |
| `SESSION_SECRET` | any random string of 32+ characters, e.g. `openssl rand -base64 48` |
| `TMDB_TOKEN` | TMDB → Settings → API → **API Read Access Token** (the long `eyJ…` one) |

### 4a. Deploy from GitHub (no command line)

1. Cloudflare → **My Profile → API Tokens → Create Token** → template
   **Edit Cloudflare Workers** → Create. Copy the token.
2. Cloudflare dashboard → **Workers & Pages** → the right-hand panel shows your **Account ID**. Copy it.
3. GitHub → this repo → **Settings → Secrets and variables → Actions** →
   add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the four secrets
   from step 3.
4. Merge to `main` (or **Actions → Deploy → Run workflow**). Each push to
   `main` runs the tests, deploys, and copies the four secrets into the Worker.

### 4b. Or deploy from your computer

```bash
npm install
npx wrangler login          # opens the browser once
npx wrangler secret put TWITCH_CLIENT_ID      # repeat for the other three
npm run deploy
```

### 5. Add the commands to your channel

Open the app, **Log in with Twitch**, go to **Commands**, and paste each line
into your own chat (Fossabot must be a mod). If `!addcmd` is not accepted,
add the commands in the Fossabot dashboard with the same names and responses.

## Chat commands

| Default | Who | Does |
|---|---|---|
| `!movietime` | everyone | elapsed / runtime / time left |
| `!movie` | everyone | title, year, director, runtime, rating, genres, IMDb link |
| `!startmovie` | mods | start from 0, or carry on if paused |
| `!pausemovie` / `!stopmovie` | mods | freeze the clock |
| `!resumemovie` | mods | carry on |
| `!restartmovie` | mods | back to 0:00 and running |
| `!resetmovie` | mods | back to 0:00, stopped |
| `!endmovie` | mods | mark it finished |
| `!settime 1:05:00` | mods | jump; also `90m`, `1h30m`, `+5m`, `-30s` |
| `!setmovie the matrix 1999` | mods | TMDB search, top match; an IMDb ID works too |

Mod commands are checked twice: by Fossabot's own permission, and by the
Worker, which asks Fossabot (with the single-use token it sends) who really
ran the command and whether they are the broadcaster or a moderator.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars    # fill in TMDB_TOKEN at least
npm test
npm run dev                       # http://localhost:8787
```

With `DEV_MODE=true` in `.dev.vars`:

- `http://localhost:8787/auth/dev-login?channel=42&name=Me` logs in without Twitch.
  Call it again with another channel to add a second account.
- `http://localhost:8787/f/start?dev&channel=42&user=Bob&roles=moderator` runs a
  chat command. Add `&msg=!settime%201:05:00` for arguments, or drop `roles`
  to see the viewer refusal.

`DEV_MODE` must never be set in production; it is only read from `.dev.vars`.

## Limits

- Free plan: 100,000 Worker requests a day, which is far more than a chat will use.
- Replies are cut at 480 characters, with a warning in the editor.
- TMDB data is refreshed after 6 months, as TMDB's terms require. This
  product uses the TMDB API but is not endorsed or certified by TMDB.
- Charging for the app would need TMDB's commercial licence.
