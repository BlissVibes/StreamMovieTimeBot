# Movie Clock: Build Plan

A Twitch movie-timer for **Fossabot** channels. Streamers paste a few chat commands, and the commands start working right away. A web dashboard handles everything else: picking the movie, editing message wording, renaming commands, and running the clock. Nothing to download. It runs 24/7 on Cloudflare's free tier.

---

## 1. How it works

```
Viewer types !movietime
      │
Fossabot runs  $(customapi https://moviec.lock/f/time)
      │   (sends x-fossabot-* headers: channel's Twitch ID, user, token)
      ▼
Cloudflare Worker ──► Durable Object (one per channel: timer, movie, settings)
      │
      ▼
Plain-text reply ──► Fossabot posts it in chat
```

- **Identity:** every Fossabot request carries `x-fossabot-channelproviderid` (the broadcaster's Twitch ID). That ID is the key for all of the channel's data.
- **Dashboard login:** "Log in with Twitch" returns the same Twitch ID, so chat and the dashboard share one record.
- **Command names live in Fossabot,** not in the Worker. The Worker only sees the URL path (`/f/time`, `/f/start`, …), so streamers can name commands anything.

---

## 2. Stack

| Piece | Cloudflare product | Why |
|---|---|---|
| API + login + Fossabot routes | Worker | Always on, free tier |
| Per-channel state | Durable Object (SQLite-backed, free plan) | Strongly consistent. `!startmovie` then `!movietime` a second later must agree (KV can lag up to ~60s). |
| Dashboard | Static assets served by the same Worker | One deploy, one domain |
| Movie data | TMDB API | Free for non-commercial use with attribution |
| Drag & drop | SortableJS (cdnjs) | Works on touch and phones |

**Secrets:** `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `SESSION_SECRET`, `TMDB_TOKEN`.

---

## 3. Chat commands

Default names are listed below. Every name can be changed per channel in the dashboard.

| Action | Default command | Who | What it does |
|---|---|---|---|
| time | `!movietime` | Everyone | Elapsed / runtime / remaining |
| movie | `!movie` | Everyone | Movie info (title, year, director, IMDb link…) |
| start | `!startmovie` | Mods | Starts from 0, or resumes if paused |
| pause | `!pausemovie` | Mods | Freezes the clock |
| stop | `!stopmovie` | Mods | Freezes the clock (own message, resumable) |
| resume | `!resumemovie` | Mods | Continues from where it paused |
| restart | `!restartmovie` | Mods | Back to 0:00 and running |
| reset | `!resetmovie` | Mods | Back to 0:00, not running |
| end | `!endmovie` | Mods | Marks the movie finished, keeps final time |
| settime | `!settime 1:05:00` | Mods | Jump to a time. Also `+5m`, `-30s`, `90m`. |
| setmovie | `!setmovie the matrix` | Mods | TMDB search, takes the top match |

**Timer states:** `idle → running ⇄ paused/stopped → ended`. Time is stored as a start timestamp, not a ticking counter, so it never drifts and survives restarts.

**Auto-end (optional):** once elapsed passes the runtime, the clock shows as ended.

### Paste block (what the streamer copies)
```
!addcmd !movietime $(customapi https://moviec.lock/f/time)
!addcmd !movie $(customapi https://moviec.lock/f/movie)
!addcmd !startmovie $(customapi https://moviec.lock/f/start)
...
```
The dashboard regenerates this block whenever a command is renamed, with a copy button on each line. A fallback note explains how to add commands in Fossabot's dashboard if `!addcmd` syntax differs.

---

## 4. Security

**Mod commands are verified server-side, not just by Fossabot permissions:**
1. Call Fossabot's validate endpoint with `x-fossabot-customapitoken`. The token is single-use and expires in 60s.
2. Fetch the context and check that the user's roles include `broadcaster` or `moderator`.
3. Read arguments (e.g. the movie title) from `message.content`.
4. Use `channel.provider_id` from the verified context, not the raw headers.

Viewer commands (`time`, `movie`) are read-only and skip validation, which keeps them fast and avoids Fossabot's rate limit.

**Twitch login (zero scopes):**
- `state` parameter: a random value is stored in a short-lived HttpOnly cookie and must match on callback. This blocks login CSRF.
- The code is exchanged for a token, the Twitch ID and name are read, and **the token is revoked immediately**. No Twitch token is ever stored.
- Session cookie: HMAC-signed, `HttpOnly; Secure; SameSite=Lax`, 30 days.
- Dashboard write requests must have a matching `Origin` header.
- The client secret lives only in Worker secrets.

**What the app can see:** public profile only (ID, username, display name, avatar). No email, stream key, subs, or chat access.

---

## 5. Movie data (TMDB)

- **Search:** dashboard search box with posters, or `!setmovie <title>` in chat.
- **Stored per channel:** title, year, runtime, director, rating, genres, top cast, tagline, IMDb ID (→ IMDb link), TMDB link, poster.
- **Custom movie:** a manual form (title, year, runtime, director, IMDb link, etc.) for anything not on TMDB.
- **Edit details:** any TMDB value can be overridden after picking.
- **Rules:** attribution notice plus TMDB logo on the About/Credits area. Cached data must not be older than 6 months, so stale entries are refreshed automatically.
- **Commercial use:** charging for the app requires TMDB's commercial license (~$149/mo under $1M revenue).

---

## 6. Dashboard

### 6.1 Now Playing
- Poster, title, and year, with a large live clock and progress bar
- Control buttons: Start · Pause · Resume · Restart · Reset · End · Set time. They run the same actions as chat.

### 6.2 Movie picker
- TMDB search with results list
- "Custom movie" toggle opens the manual form
- "Edit details" on the current movie

### 6.3 Message editor (the core feature)
- **Message selector**, in two groups:
  - **Viewer replies:** time, time-paused, time-ended, not-started, movie, no-movie
  - **Mod replies:** start, pause, stop, resume, restart, reset, end, settime, setmovie, already-running, not-allowed
- **Template row:** the selected message built from draggable **blocks**. Reorder by dragging; drop on the trash zone or tap ✕ to delete.
- **Block palette** (drag in, or tap to append):
  - **Movie:** Title · Year · Director · Runtime · Rating · Genres · Cast · Tagline · IMDb link · TMDB link
  - **Clock:** Elapsed · Remaining · Percent · Progress bar · Status
  - **Chat:** Who ran it · Streamer name · command-name blocks (e.g. "your time command")
  - **+ Text:** a custom text block. Tap it to type anything.
- **Emoji menu:** a grid of selectable emoji.
  - Tap while editing a text block: inserted at the cursor, inside the text.
  - Tap otherwise, or drag: added as its own movable block.
- **Smart spacing:** blocks are joined with spaces automatically, but not inside brackets or before punctuation. So `🎬` `Title` `(` `Year` `)` renders as "🎬 The Matrix (1999)".
- **Empty-value cleanup:** a missing field drops out cleanly, with no "()" or doubled spaces.
- **Reset to default** button per message.
- **Live chat preview:** a Twitch-styled dark chat panel showing a viewer typing the command and Fossabot's reply exactly as it will appear. Updates as you drag and ticks live with the clock. Includes a 500-character limit warning.
- **Autosave** with a "Saved" indicator.

### 6.4 Commands & settings
- Rename every command (validated, `!` added automatically)
- Toggle which commands are included in the paste block
- Time style: `1:23:45` or `1h 23m`
- Auto-end on/off
- Generated Fossabot paste block with per-line copy buttons

### 6.5 Footer
TMDB attribution notice and logo, plus a link to revoke access (Twitch → Settings → Connections).

---

## 7. Data model

Template storage: blocks, not `{placeholder}` strings, so users never type tokens.
```js
// one Durable Object per Twitch channel ID
{
  timer:    { status: 'idle'|'running'|'paused'|'stopped'|'ended', base: ms, frozen: ms },
  movie:    { source: 'tmdb'|'custom', title, year, runtime, director, rating,
              genres, cast, tagline, imdbId, tmdbId, poster, fetchedAt },
  settings: { commands: { time: '!movietime', ... }, enabled: {...},
              templates: { time: [ {t:'x', v:'🎬'}, {t:'f', k:'title'}, ... ] },  // overrides only
              timeStyle: 'clock'|'words', autoEnd: true },
  profile:  { login, displayName }
}
```
A shared `core.js` holds the timer logic, time parsing, field values, and template rendering. It is used by both the Worker (real replies) and the dashboard (preview), so the preview always matches chat exactly.

---

## 8. Routes

| Route | Purpose |
|---|---|
| `GET /f/:action` | Fossabot customapi endpoint, returns plain text (≤ 480 chars) |
| `GET /auth/login` | Sets `state` cookie, redirects to Twitch |
| `GET /auth/callback` | Checks `state`, exchanges code, revokes token, sets session |
| `POST /auth/logout` | Clears session |
| `GET /api/me` | User, channel state, settings |
| `PUT /api/settings` | Save templates, command names, options |
| `GET /api/search?q=` | TMDB search |
| `POST /api/movie` | Set by TMDB ID, set custom movie, or clear |
| `POST /api/action` | Run a timer action from the dashboard |

---

## 9. Build order

1. `core.js`: timer state machine, time-arg parsing, field values, smart-join renderer, default templates. Unit tests.
2. Worker: Durable Object, Fossabot routes + validation, TMDB client.
3. Twitch login with `state`, signed sessions, API routes.
4. Dashboard: now-playing, movie picker, block editor + emoji + preview, commands page.
5. Local end-to-end test with `wrangler dev`, using a dev-only flag that simulates Fossabot headers and roles.
6. Publish a **demo-mode** dashboard (sample movies, local clock) for trying the editor on a phone.
7. README: Twitch app setup, TMDB key, `wrangler deploy`, secrets.

---

## 10. Your setup to deploy

1. Cloudflare account (free) → `npx wrangler login`
2. Twitch app at dev.twitch.tv → redirect URL `https://<your-domain>/auth/callback`
3. TMDB account → API Read Access Token
4. `wrangler secret put` for the four secrets → `npx wrangler deploy`

---

## 11. Known limits / open items

- **Fossabot `!addcmd` syntax:** confirm on a real channel; the dashboard fallback covers it.
- **Twitch only:** Fossabot also serves other platforms, but the Twitch login ties this to Twitch.
- **TMDB logo:** download an approved logo from TMDB's logos page before launch.
- **Validation rate limits:** Fossabot rate-limits its validate/context endpoints. This only matters for mod commands, so it's low volume.
- **Commercial use:** going paid triggers TMDB's commercial license.
