// The app's version and changelog: the one place both are kept. The header
// badge and /changelog read from here, and the tests check that
// package.json and the newest entry agree with VERSION.
//
// Every change that ships bumps VERSION by 0.0.1 and adds an entry at the
// top of CHANGES. Merging to main tags it vX.Y.Z and publishes a GitHub
// Release from that entry (.github/workflows/release.yml).

export const VERSION = '0.1.0';

export const CHANGES = [
  {
    version: '0.1.0',
    date: '2026-10-10',
    title: 'First release',
    sections: [
      {
        heading: 'Chat commands',
        items: [
          'Fossabot commands for everyone: !movietime (elapsed / runtime / time left) and !movie (title, year, director, rating, genres, IMDb link).',
          'Mod commands: start, pause, stop, resume, restart, reset, end, !settime (1:05:00, 90m, +5m, -30s) and !setmovie (TMDB search, or an IMDb ID).',
          'Mod status is checked with Fossabot on every mod command, not just by Fossabot\'s own permission setting.',
          'The clock is stored as a start time, so it never drifts, and can end itself when the runtime is reached.',
        ],
      },
      {
        heading: 'Dashboard',
        items: [
          'Log in with Twitch (public profile only; the Twitch token is thrown away at once). Up to five accounts can stay signed in, with a switcher and log out.',
          'Now playing: live clock, progress bar and controls that do the same as the chat commands.',
          'Movie: TMDB search with posters, custom movies, and editing any detail of a TMDB movie.',
          'Messages: build every reply from drag-and-drop blocks and emoji, with a live Twitch-style chat preview right below. Missing values drop out cleanly.',
          'With no movie picked, the preview uses a sample movie (The Matrix, Shrek and others).',
          'Commands: rename any command, choose which go in the paste block, and copy the Fossabot lines.',
          'Demo mode at /?demo runs the whole dashboard in the browser.',
          'The version number next to the title links to this changelog.',
        ],
      },
      {
        heading: 'Hosting',
        items: [
          'Runs on Cloudflare Workers with one Durable Object per channel, on the free plan.',
        ],
      },
    ],
  },
];
