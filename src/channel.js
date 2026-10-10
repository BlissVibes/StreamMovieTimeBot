import { DurableObject } from 'cloudflare:workers';
import {
  defaultState, defaultSettings, applyAction, mergeSettings, renderMessage, TIMER_ACTIONS,
} from '../public/core.js';

// One instance per Twitch channel ID. Every read-modify-write below runs
// without awaiting anything but storage, so the input gate makes it atomic:
// "!startmovie" then "!movietime" a second later always agree.
export class Channel extends DurableObject {
  async load() {
    const s = (await this.ctx.storage.get('state')) || defaultState();
    // Fill in settings added since this channel was first saved.
    const d = defaultSettings();
    s.settings = {
      ...d, ...s.settings,
      commands: { ...d.commands, ...s.settings?.commands },
      enabled: { ...d.enabled, ...s.settings?.enabled },
      templates: { ...s.settings?.templates },
    };
    return s;
  }

  async save(s) {
    await this.ctx.storage.put('state', s);
    return s;
  }

  async getState() {
    return this.load();
  }

  // Runs a timer action and renders the reply in one step, so the message
  // describes exactly the state that was stored.
  async runAction(action, arg, chat = {}) {
    if (!TIMER_ACTIONS.has(action)) throw new Error(`Not a timer action: ${action}`);
    const s = await this.load();
    const now = Date.now();
    const r = applyAction(s, action, arg, now);
    s.timer = r.timer;
    await this.save(s);
    return { state: s, reply: renderMessage(s, r.reply, now, chat), key: r.reply, now };
  }

  async setMovie(movie) {
    const s = await this.load();
    s.movie = movie;
    return this.save(s);
  }

  // Refreshes TMDB data in place, keeping the streamer's overrides.
  async refreshMovie(fresh) {
    const s = await this.load();
    if (!s.movie || s.movie.source !== 'tmdb' || s.movie.tmdbId !== fresh.tmdbId) return s;
    s.movie = { ...fresh, overrides: s.movie.overrides };
    return this.save(s);
  }

  async setOverrides(patch) {
    const s = await this.load();
    if (!s.movie) return s;
    const o = { ...s.movie.overrides };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete o[k]; else o[k] = v;
    }
    s.movie.overrides = Object.keys(o).length ? o : undefined;
    return this.save(s);
  }

  async updateSettings(patch) {
    const s = await this.load();
    const { settings, errors } = mergeSettings(s.settings, patch);
    if (errors.length) return { settings: s.settings, errors };
    s.settings = settings;
    await this.save(s);
    return { settings, errors };
  }

  async setProfile(profile) {
    const s = await this.load();
    s.profile = profile;
    return this.save(s);
  }
}
