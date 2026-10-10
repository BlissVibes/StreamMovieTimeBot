# Movie Clock — notes for Claude

## Every change ships with a version bump

The version lives in `public/version.js` (`VERSION` plus the `CHANGES`
list that `/changelog` renders). With every change that will be deployed:

1. Bump `VERSION` by **0.0.1** (0.1.0 → 0.1.1 → 0.1.2 …), every time,
   and set the same number in `package.json`.
2. Add an entry at the **top** of `CHANGES` with the version, today's date
   and plain-language items a streamer would understand.
3. Start the PR title with the version, e.g. `v0.1.1: Fix paused preview`.

When it merges to `main`, `.github/workflows/release.yml` tags the commit
`vX.Y.Z` and publishes a GitHub Release whose notes come from that entry.

`npm test` fails if `VERSION`, `package.json` and the newest entry disagree.

## Deploying

Live at https://movietimer.blissvibes.workers.dev (Worker `movietimer`).
`npm test` before every push. `.dev.vars` (gitignored) holds local
secrets; never commit them.
